#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define OPERATION_HEAD_INFER_NO_MAIN
#include "operation_head_infer.c"

#define Q32_SCHEMA "zero.zero4_q32_runtime_head_event.v1"
#define Q32_RUNTIME_SOURCE \
    "benchmarks/zero4-q31-v1/results/candidate.litqhead"
#define Q32_QUANTITY "corpus/faculty/q22/quantity-request.tok"
#define Q32_SEED 2
#define Q32_CLASSES 5
#define Q32_TRAIN_RECORDS 9000
#define Q32_HOLDOUT_RECORDS 500
#define Q32_PUBLIC_RECORDS 500
#define Q32_FEATURE_RECORDS (Q32_TRAIN_RECORDS + Q32_HOLDOUT_RECORDS)
#define Q32_BATCH 64
#define Q32_MAXIMUM_UPDATES 100
#define Q32_LEARNING_RATE 0.001f
#define Q32_CLIP 1.0f
#define Q32_OVERALL_MINIMUM 0.99
#define Q32_CLASS_MINIMUM 0.98
#define Q32_WORKERS 8

typedef struct {
    int input;
    float *w, *b, *gw, *gb, *mw, *mb, *vw, *vb;
} Q32Head;

typedef struct {
    char magic[8];
    uint32_t version, vocab, base_context, feature_context;
    uint32_t dim, layers, classes, feature_dim;
    uint64_t step, base_state_digest, head_parameters;
} Q32CheckpointHeader;

typedef struct {
    double cross_entropy, accuracy, per_class[Q32_CLASSES];
    int correct[Q32_CLASSES], count[Q32_CLASSES];
} Q32Measurement;

typedef struct {
    const char *out_prefix, *events_path, *authorization_sha256;
} Q32Options;

static const char Q32_CHECKPOINT_MAGIC[8] =
    {'Q', '3', '2', 'H', 'E', 'A', 'D', '1'};

static void q32_fail(const char *message)
{
    fprintf(stderr, "error: %s\n", message);
    exit(EXIT_FAILURE);
}

static void q32_fail_path(const char *action, const char *path)
{
    fprintf(stderr, "error: could not %s '%s': %s\n", action, path,
            strerror(errno));
    exit(EXIT_FAILURE);
}

static void *q32_alloc(size_t count, size_t size)
{
    void *result;
    if (count != 0 && size > SIZE_MAX / count) q32_fail("allocation overflow");
    result = calloc(count, size);
    if (result == NULL) q32_fail("out of memory");
    return result;
}

static unsigned char *q32_read_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0)
        q32_fail_path("open", path);
    data = q32_alloc((size_t)size, 1);
    if (fread(data, 1, (size_t)size, file) != (size_t)size)
        q32_fail_path("read", path);
    if (fclose(file) != 0) q32_fail_path("close", path);
    *length = (size_t)size;
    return data;
}

static uint64_t q32_digest(const void *data, size_t length)
{
    const unsigned char *bytes = data;
    uint64_t hash = UINT64_C(1469598103934665603);
    size_t index;
    for (index = 0; index < length; ++index) {
        hash ^= bytes[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static void q32_head_create(Q32Head *head, int input)
{
    size_t weights = (size_t)input * Q32_CLASSES;
    head->input = input;
    head->w = q32_alloc(weights, sizeof(float));
    head->b = q32_alloc(Q32_CLASSES, sizeof(float));
    head->gw = q32_alloc(weights, sizeof(float));
    head->gb = q32_alloc(Q32_CLASSES, sizeof(float));
    head->mw = q32_alloc(weights, sizeof(float));
    head->mb = q32_alloc(Q32_CLASSES, sizeof(float));
    head->vw = q32_alloc(weights, sizeof(float));
    head->vb = q32_alloc(Q32_CLASSES, sizeof(float));
}

static void q32_head_destroy(Q32Head *head)
{
    free(head->w); free(head->b); free(head->gw); free(head->gb);
    free(head->mw); free(head->mb); free(head->vw); free(head->vb);
    memset(head, 0, sizeof(*head));
}

static double q32_example(Q32Head *head, const float *feature, int label,
                          float gradient_scale, int accumulate,
                          int *prediction)
{
    float logits[Q32_CLASSES], probabilities[Q32_CLASSES];
    float maximum, total = 0.0f;
    int class_index, input, best = 0;
    for (class_index = 0; class_index < Q32_CLASSES; ++class_index) {
        double value = head->b[class_index];
        const float *row = head->w + (size_t)class_index * head->input;
        for (input = 0; input < head->input; ++input)
            value += row[input] * feature[input];
        logits[class_index] = (float)value;
    }
    maximum = logits[0];
    for (class_index = 1; class_index < Q32_CLASSES; ++class_index)
        if (logits[class_index] > maximum) maximum = logits[class_index];
    for (class_index = 0; class_index < Q32_CLASSES; ++class_index) {
        probabilities[class_index] = expf(logits[class_index] - maximum);
        total += probabilities[class_index];
    }
    for (class_index = 0; class_index < Q32_CLASSES; ++class_index) {
        float gradient;
        probabilities[class_index] /= total;
        if (probabilities[class_index] > probabilities[best]) best = class_index;
        if (!accumulate) continue;
        gradient = (probabilities[class_index] -
                    (class_index == label ? 1.0f : 0.0f)) * gradient_scale;
        head->gb[class_index] += gradient;
        for (input = 0; input < head->input; ++input)
            head->gw[(size_t)class_index * head->input + input] +=
                gradient * feature[input];
    }
    if (prediction != NULL) *prediction = best;
    return -log(fmax((double)probabilities[label], 1.0e-20));
}

static void q32_head_update(Q32Head *head, uint64_t step)
{
    const float beta1 = 0.9f, beta2 = 0.999f, epsilon = 1.0e-8f;
    size_t weights = (size_t)head->input * Q32_CLASSES;
    double squares = 0.0;
    float clip, correction;
    size_t index;
    for (index = 0; index < weights; ++index)
        squares += head->gw[index] * head->gw[index];
    for (index = 0; index < Q32_CLASSES; ++index)
        squares += head->gb[index] * head->gb[index];
    clip = squares > Q32_CLIP * Q32_CLIP
               ? (float)(Q32_CLIP / sqrt(squares)) : 1.0f;
    correction = sqrtf(1.0f - powf(beta2, (float)step)) /
                 (1.0f - powf(beta1, (float)step));
#define Q32_ADAM(values, gradients, moments, variances, count) do {           \
    size_t q32_i;                                                             \
    for (q32_i = 0; q32_i < (count); ++q32_i) {                              \
        float g = (gradients)[q32_i] * clip;                                  \
        (moments)[q32_i] = beta1 * (moments)[q32_i] + (1.0f - beta1) * g;     \
        (variances)[q32_i] = beta2 * (variances)[q32_i] +                     \
            (1.0f - beta2) * g * g;                                           \
        (values)[q32_i] -= Q32_LEARNING_RATE * correction *                  \
            (moments)[q32_i] / (sqrtf((variances)[q32_i]) + epsilon);         \
    }                                                                         \
} while (0)
    Q32_ADAM(head->w, head->gw, head->mw, head->vw, weights);
    Q32_ADAM(head->b, head->gb, head->mb, head->vb, Q32_CLASSES);
#undef Q32_ADAM
}

static uint64_t q32_head_digest(const Q32Head *head)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    const float *parts[] = {head->w, head->b, head->mw, head->mb,
                            head->vw, head->vb};
    size_t counts[] = {(size_t)head->input * Q32_CLASSES, Q32_CLASSES,
                       (size_t)head->input * Q32_CLASSES, Q32_CLASSES,
                       (size_t)head->input * Q32_CLASSES, Q32_CLASSES};
    int part;
    for (part = 0; part < 6; ++part) {
        const unsigned char *bytes = (const unsigned char *)parts[part];
        size_t index;
        for (index = 0; index < counts[part] * sizeof(float); ++index) {
            hash ^= bytes[index]; hash *= UINT64_C(1099511628211);
        }
    }
    return hash;
}

static size_t *q32_record_starts(const uint16_t *tokens, size_t token_count,
                                 size_t *record_count)
{
    size_t count = 0, index, next = 0;
    size_t *starts;
    for (index = 0; index < token_count; ++index)
        if (tokens[index] == CHANNEL_START_TOKEN) ++count;
    if (count != Q32_FEATURE_RECORDS + Q32_PUBLIC_RECORDS)
        q32_fail("Q3.2 quantity record count drifted");
    starts = q32_alloc(count, sizeof(*starts));
    for (index = 0; index < token_count; ++index)
        if (tokens[index] == CHANNEL_START_TOKEN) starts[next++] = index;
    *record_count = count;
    return starts;
}

static int q32_extract_one(const uint16_t *tokens, size_t start, size_t end,
                           float *feature)
{
    size_t index;
    int found = 0;
    lm_reset();
    for (index = start; index < end; ++index) {
        if (lm_feed(tokens[index]) != 0) return 0;
        if (tokens[index] == CHANNEL_TARGET_TOKEN) { found = 1; break; }
    }
    if (!found || q31_feature == NULL ||
        q31_feature_dim != (int)(config.layers * config.dim)) return 0;
    memcpy(feature, q31_feature, (size_t)q31_feature_dim * sizeof(float));
    return 1;
}

static float *q32_extract_features(const uint16_t *tokens, size_t token_count,
                                   const size_t *starts, size_t record_count,
                                   int feature_dim)
{
    size_t bytes = (size_t)Q32_FEATURE_RECORDS * feature_dim * sizeof(float);
    float *features = mmap(NULL, bytes, PROT_READ | PROT_WRITE,
                           MAP_SHARED | MAP_ANON, -1, 0);
    pid_t children[Q32_WORKERS];
    int worker;
    if (features == MAP_FAILED) q32_fail_path("map feature cache", "mmap");
    for (worker = 0; worker < Q32_WORKERS; ++worker) {
        pid_t child = fork();
        if (child < 0) q32_fail_path("fork feature worker", "fork");
        if (child == 0) {
            size_t record;
            for (record = (size_t)worker; record < Q32_FEATURE_RECORDS;
                 record += Q32_WORKERS) {
                size_t end = record + 1 < record_count
                                 ? starts[record + 1] : token_count;
                if (!q32_extract_one(tokens, starts[record], end,
                        features + record * (size_t)feature_dim)) _exit(111);
            }
            _exit(0);
        }
        children[worker] = child;
    }
    for (worker = 0; worker < Q32_WORKERS; ++worker) {
        int status;
        if (waitpid(children[worker], &status, 0) != children[worker] ||
            !WIFEXITED(status) || WEXITSTATUS(status) != 0)
            q32_fail("Q3.2 runtime feature worker failed");
    }
    return features;
}

static Q32Measurement q32_measure(Q32Head *head, const float *features)
{
    Q32Measurement result;
    int record, class_index;
    memset(&result, 0, sizeof(result));
    for (record = 0; record < Q32_HOLDOUT_RECORDS; ++record) {
        int label = (Q32_TRAIN_RECORDS + record) % Q32_CLASSES;
        int prediction;
        result.cross_entropy += q32_example(head,
            features + (size_t)(Q32_TRAIN_RECORDS + record) * head->input,
            label, 0.0f, 0, &prediction) / Q32_HOLDOUT_RECORDS;
        ++result.count[label];
        if (prediction == label) {
            ++result.correct[label]; result.accuracy += 1.0 / Q32_HOLDOUT_RECORDS;
        }
    }
    for (class_index = 0; class_index < Q32_CLASSES; ++class_index) {
        if (result.count[class_index] != 100)
            q32_fail("Q3.2 holdout class balance drifted");
        result.per_class[class_index] =
            (double)result.correct[class_index] / result.count[class_index];
    }
    return result;
}

static int q32_qualifies(const Q32Measurement *measurement)
{
    int class_index;
    if (measurement->accuracy + 1.0e-12 < Q32_OVERALL_MINIMUM) return 0;
    for (class_index = 0; class_index < Q32_CLASSES; ++class_index)
        if (measurement->per_class[class_index] + 1.0e-12 < Q32_CLASS_MINIMUM)
            return 0;
    return 1;
}

static void q32_path(char *path, size_t capacity, const char *prefix, int update)
{
    int written = snprintf(path, capacity, "%s-u%06d.q32", prefix, update);
    if (written < 0 || (size_t)written >= capacity)
        q32_fail("Q3.2 checkpoint path is too long");
}

static void q32_require_absent(const char *path)
{
    FILE *file = fopen(path, "rb");
    if (file != NULL) { fclose(file); q32_fail_path("refuse to overwrite", path); }
    if (errno != ENOENT) q32_fail_path("inspect", path);
}

static void q32_checkpoint_save(const char *path, const Q32Head *head,
                                uint64_t step, uint64_t base_digest)
{
    Q32CheckpointHeader header;
    char *temporary = q32_alloc(strlen(path) + 5, 1);
    size_t weights = (size_t)head->input * Q32_CLASSES;
    FILE *file;
    snprintf(temporary, strlen(path) + 5, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) q32_fail_path("create Q3.2 checkpoint", temporary);
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, Q32_CHECKPOINT_MAGIC, 8);
    header.version = 1; header.vocab = config.vocab;
    header.base_context = config.context; header.feature_context = config.context;
    header.dim = config.dim; header.layers = config.layers;
    header.classes = Q32_CLASSES; header.feature_dim = (uint32_t)head->input;
    header.step = step; header.base_state_digest = base_digest;
    header.head_parameters = (uint64_t)Q32_CLASSES * (head->input + 1U);
#define Q32_WRITE(data, count) \
    (fwrite((data), sizeof(*(data)), (count), file) == (count))
    if (!Q32_WRITE(&header, 1) || !Q32_WRITE(head->w, weights) ||
        !Q32_WRITE(head->b, Q32_CLASSES) || !Q32_WRITE(head->mw, weights) ||
        !Q32_WRITE(head->mb, Q32_CLASSES) || !Q32_WRITE(head->vw, weights) ||
        !Q32_WRITE(head->vb, Q32_CLASSES))
        q32_fail_path("write Q3.2 checkpoint", temporary);
#undef Q32_WRITE
    if (fclose(file) != 0 || rename(temporary, path) != 0)
        q32_fail_path("install Q3.2 checkpoint", path);
    free(temporary);
}

static void q32_emit(FILE *events, int update,
                     const Q32Measurement *measurement, uint64_t base_digest,
                     uint64_t head_digest)
{
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"measurement\",\"update\":%d,"
        "\"holdout_cross_entropy\":%.17g,\"holdout_accuracy\":%.17g,"
        "\"per_class_accuracy\":[%.17g,%.17g,%.17g,%.17g,%.17g],"
        "\"per_class_count\":[%d,%d,%d,%d,%d],"
        "\"base_runtime_digest\":\"%016llx\","
        "\"head_state_digest\":\"%016llx\"}\n",
        Q32_SCHEMA, update, measurement->cross_entropy, measurement->accuracy,
        measurement->per_class[0], measurement->per_class[1],
        measurement->per_class[2], measurement->per_class[3],
        measurement->per_class[4], measurement->count[0],
        measurement->count[1], measurement->count[2], measurement->count[3],
        measurement->count[4], (unsigned long long)base_digest,
        (unsigned long long)head_digest);
    fflush(events);
}

static uint32_t q32_random(uint32_t *state)
{
    uint32_t x = *state;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return *state = x;
}

static void q32_shuffle(int *records)
{
    uint32_t state = Q32_SEED;
    int index;
    for (index = 0; index < Q32_TRAIN_RECORDS; ++index) records[index] = index;
    for (index = Q32_TRAIN_RECORDS - 1; index > 0; --index) {
        int other = (int)(q32_random(&state) % (uint32_t)(index + 1));
        int temporary = records[index]; records[index] = records[other];
        records[other] = temporary;
    }
}

static int q32_measurement_update(int update)
{
    return update == 25 || update == 50 || update == 100;
}

static void q32_run(const Q32Options *options, const float *features,
                    int feature_dim, uint64_t base_digest)
{
    Q32Head head = {0};
    int *training = q32_alloc(Q32_TRAIN_RECORDS, sizeof(int));
    FILE *events;
    char checkpoint[4096];
    const char *stop_reason = "update-cap";
    int updates_committed = 0, update;
    q32_head_create(&head, feature_dim); q32_shuffle(training);
    for (update = 0; update <= Q32_MAXIMUM_UPDATES; ++update) {
        if (update != 0 && !q32_measurement_update(update)) continue;
        q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
        q32_require_absent(checkpoint);
    }
    q32_require_absent(options->events_path);
    events = fopen(options->events_path, "w");
    if (events == NULL) q32_fail_path("open Q3.2 events", options->events_path);
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"start\",\"seed\":%d,"
        "\"base_parameters\":4852992,\"trainable_parameters\":7685,"
        "\"classes\":5,\"feature_dim\":%d,\"feature_source\":"
        "\"deployment-exact-quantized-streaming\","
        "\"feature_records\":9500,\"feature_workers\":%d,"
        "\"training_records\":9000,\"holdout_records\":500,"
        "\"maximum_updates\":100,\"measurement_updates\":[0,25,50,100],"
        "\"authorization_sha256\":\"%s\","
        "\"base_runtime_digest\":\"%016llx\"}\n",
        Q32_SCHEMA, Q32_SEED, feature_dim, Q32_WORKERS,
        options->authorization_sha256, (unsigned long long)base_digest);
    q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, 0);
    q32_checkpoint_save(checkpoint, &head, 0, base_digest);
    {
        Q32Measurement measurement = q32_measure(&head, features);
        q32_emit(events, 0, &measurement, base_digest, q32_head_digest(&head));
    }
    for (update = 1; update <= Q32_MAXIMUM_UPDATES; ++update) {
        int sample;
        memset(head.gw, 0, (size_t)feature_dim * Q32_CLASSES * sizeof(float));
        memset(head.gb, 0, Q32_CLASSES * sizeof(float));
        for (sample = 0; sample < Q32_BATCH; ++sample) {
            int offset = (update - 1) * Q32_BATCH + sample;
            int selected = training[offset % Q32_TRAIN_RECORDS];
            q32_example(&head, features + (size_t)selected * feature_dim,
                        selected % Q32_CLASSES, 1.0f / Q32_BATCH, 1, NULL);
        }
        q32_head_update(&head, (uint64_t)update); updates_committed = update;
        if (q32_measurement_update(update)) {
            Q32Measurement measurement = q32_measure(&head, features);
            q32_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
            q32_checkpoint_save(checkpoint, &head, (uint64_t)update, base_digest);
            q32_emit(events, update, &measurement, base_digest,
                     q32_head_digest(&head));
            if (q32_qualifies(&measurement)) {
                stop_reason = "runtime-feature-holdout-first-hit"; break;
            }
        }
    }
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"complete\","
        "\"updates_committed\":%d,\"stop_reason\":\"%s\","
        "\"runtime_feature_checkpoint_available\":%s,"
        "\"packaged_runtime_gate_run\":false,"
        "\"public_quantity_run\":false,\"language_gate_run\":false,"
        "\"promotion_run\":false}\n", Q32_SCHEMA, updates_committed,
        stop_reason, strcmp(stop_reason, "runtime-feature-holdout-first-hit") == 0
                         ? "true" : "false");
    if (fclose(events) != 0) q32_fail_path("close Q3.2 events", options->events_path);
    free(training); q32_head_destroy(&head);
}

static int q32_self_test(const char *prefix)
{
    Q32Head head = {0};
    float feature[Q32_CLASSES] = {0};
    int update, label;
    q32_head_create(&head, Q32_CLASSES);
    for (update = 1; update <= 100; ++update) {
        memset(head.gw, 0, Q32_CLASSES * Q32_CLASSES * sizeof(float));
        memset(head.gb, 0, Q32_CLASSES * sizeof(float));
        for (label = 0; label < Q32_CLASSES; ++label) {
            memset(feature, 0, sizeof(feature)); feature[label] = 8.0f;
            q32_example(&head, feature, label, 0.2f, 1, NULL);
        }
        q32_head_update(&head, (uint64_t)update);
    }
    for (label = 0; label < Q32_CLASSES; ++label) {
        int prediction;
        memset(feature, 0, sizeof(feature)); feature[label] = 8.0f;
        q32_example(&head, feature, label, 0.0f, 0, &prediction);
        if (prediction != label) q32_fail("Q3.2 classifier self-test failed");
    }
    q32_head_destroy(&head);
    if (prefix != NULL) {
        char path[4096]; Q32Head artifact = {0};
        config.vocab = 128; config.context = 512; config.dim = 256;
        config.layers = 6;
        q32_head_create(&artifact, 1536); artifact.b[2] = 4.0f;
        snprintf(path, sizeof(path), "%s.q32", prefix);
        q32_checkpoint_save(path, &artifact, 1,
                            UINT64_C(0x0123456789abcdef));
        q32_head_destroy(&artifact);
    }
    puts("Q3.2 deployment-exact operation-head mechanics self-test passed");
    return 1;
}

static void q32_validate_options(const Q32Options *options)
{
    int index;
    if (options->out_prefix == NULL || options->events_path == NULL ||
        options->authorization_sha256 == NULL ||
        strlen(options->authorization_sha256) != 64)
        q32_fail("Q3.2 requires fixed output and authorization bindings");
    for (index = 0; index < 64; ++index)
        if (!isxdigit((unsigned char)options->authorization_sha256[index]))
            q32_fail("Q3.2 authorization digest is not hexadecimal");
}

int main(int argc, char **argv)
{
    Q32Options options = {0};
    unsigned char *package, *token_bytes;
    const uint16_t *tokens;
    size_t package_length, token_bytes_length, token_count;
    size_t *starts, record_count;
    float *features;
    uint64_t base_digest;
    int index;
    if ((argc == 2 && strcmp(argv[1], "--self-test") == 0) ||
        (argc == 3 && strcmp(argv[1], "--self-test-artifact") == 0))
        return q32_self_test(argc == 3 ? argv[2] : NULL) ? 0 : 1;
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) q32_fail("incomplete Q3.2 option");
        if (strcmp(argv[index], "--out-prefix") == 0)
            options.out_prefix = argv[++index];
        else if (strcmp(argv[index], "--events") == 0)
            options.events_path = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            options.authorization_sha256 = argv[++index];
        else q32_fail("unknown Q3.2 option");
    }
    q32_validate_options(&options);
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("Q3.2 could not load fixed quantized runtime source");
    if (q31_feature_dim != 1536 || config.layers != 6 || config.dim != 256)
        q32_fail("Q3.2 fixed runtime architecture drifted");
    base_digest = q32_digest(package, package_length);
    token_bytes = q32_read_file(Q32_QUANTITY, &token_bytes_length);
    if ((token_bytes_length & 1U) != 0) q32_fail("Q3.2 token file is truncated");
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    q31_feature_dim);
    q32_run(&options, features, q31_feature_dim, base_digest);
    if (munmap(features, (size_t)Q32_FEATURE_RECORDS * q31_feature_dim *
                             sizeof(float)) != 0)
        q32_fail_path("unmap feature cache", "mmap");
    free(starts); free(token_bytes); free(package);
    q31_release(); release_working_memory();
    return 0;
}
