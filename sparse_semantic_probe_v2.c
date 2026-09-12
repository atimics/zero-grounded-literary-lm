/*
 * Q3.6 projection-scale and gradient-clip factorial probe.
 *
 * Follow-up to the Q3.5 feature_no_go. Q3.5 showed the expanded code is
 * healthy but both expanded heads froze at uniform logits under the unchanged
 * global gradient-norm clip. This probe separates two candidate constraints:
 *
 *   H-scale  (Q3.6): fan-in scaled projection, unchanged global clip
 *   H-clip   (Q3.7): unscaled projection, per-parameter clip
 *
 * Factorial arms over one feature extraction:
 *   linear (1536, anchor)
 *   dense / sparse x {unscaled, fanin} x {global, per-parameter}
 *
 * Feature-level diagnostic only. No candidate is packaged.
 */

#define main q32_original_main
#include "runtime_operation_head_pilot.c"
#undef main

#include <sys/stat.h>

#define Q36_SCHEMA "zero.zero4_q36_factorial_probe_event.v1"
#define Q36_TOKENS "benchmarks/zero4-q34-semantic-head-v1/mixed-training.tok"
#define Q36_PROJECTION "benchmarks/zero4-q35-sparse-probe-v1/projection.bin"
#define Q36_INPUT 1536
#define Q36_EXPANSION 6144
#define Q36_TOP_K 307
#define Q36_WORKERS 8

typedef struct {
    float value;
    int index;
} Q36Item;

static int q36_item_compare(const void *left, const void *right)
{
    const Q36Item *a = left, *b = right;
    if (a->value > b->value) return -1;
    if (a->value < b->value) return 1;
    return a->index - b->index;
}

static void q36_expand(const float *features, size_t records,
                       const signed char *projection, float *out)
{
    pid_t children[Q36_WORKERS];
    int worker;
    for (worker = 0; worker < Q36_WORKERS; ++worker) {
        pid_t child = fork();
        if (child < 0) q32_fail_path("fork Q3.6 expansion worker", "fork");
        if (child == 0) {
            size_t record;
            for (record = (size_t)worker; record < records;
                 record += Q36_WORKERS) {
                const float *x = features + record * Q36_INPUT;
                float *destination = out + record * Q36_EXPANSION;
                int unit;
                for (unit = 0; unit < Q36_EXPANSION; ++unit) {
                    const signed char *row =
                        projection + (size_t)unit * Q36_INPUT;
                    float sum = 0.0f;
                    int input;
                    for (input = 0; input < Q36_INPUT; ++input) {
                        signed char weight = row[input];
                        if (weight != 0) sum += (float)weight * x[input];
                    }
                    destination[unit] = sum > 0.0f ? sum : 0.0f;
                }
            }
            _exit(0);
        }
        children[worker] = child;
    }
    for (worker = 0; worker < Q36_WORKERS; ++worker) {
        int status;
        if (waitpid(children[worker], &status, 0) != children[worker] ||
            !WIFEXITED(status) || WEXITSTATUS(status) != 0)
            q32_fail("Q3.6 expansion worker failed");
    }
}

static void q36_mask_wta(const float *dense, size_t records, float *sparse)
{
    Q36Item *items = q32_alloc(Q36_EXPANSION, sizeof(*items));
    size_t record;
    for (record = 0; record < records; ++record) {
        const float *source = dense + record * Q36_EXPANSION;
        float *destination = sparse + record * Q36_EXPANSION;
        int unit;
        for (unit = 0; unit < Q36_EXPANSION; ++unit) {
            items[unit].value = source[unit];
            items[unit].index = unit;
        }
        qsort(items, Q36_EXPANSION, sizeof(*items), q36_item_compare);
        memset(destination, 0, Q36_EXPANSION * sizeof(float));
        for (unit = 0; unit < Q36_TOP_K; ++unit)
            destination[items[unit].index] = items[unit].value;
    }
    free(items);
}

/* Multiply unit i by 1/sqrt(nonzeros in projection row i). */
static void q36_scale_fanin(float *features, size_t records,
                            const signed char *projection)
{
    float scales[Q36_EXPANSION];
    int unit;
    for (unit = 0; unit < Q36_EXPANSION; ++unit) {
        const signed char *row = projection + (size_t)unit * Q36_INPUT;
        int input, count = 0;
        for (input = 0; input < Q36_INPUT; ++input)
            if (row[input] != 0) ++count;
        scales[unit] = count > 0 ? 1.0f / sqrtf((float)count) : 0.0f;
    }
    for (size_t record = 0; record < records; ++record) {
        float *row = features + record * Q36_EXPANSION;
        for (unit = 0; unit < Q36_EXPANSION; ++unit) row[unit] *= scales[unit];
    }
}

/* Adam with either the inherited global gradient-norm clip or an
 * elementwise per-parameter clip to [-1, 1]. */
static void q36_head_update(Q32Head *head, uint64_t step, int per_parameter)
{
    const float beta1 = 0.9f, beta2 = 0.999f, epsilon = 1.0e-8f;
    size_t weights = (size_t)head->input * Q32_CLASSES;
    double squares = 0.0;
    float global_clip = 1.0f, correction;
    size_t index;
    int class_index;
    if (!per_parameter) {
        for (index = 0; index < weights; ++index)
            squares += head->gw[index] * head->gw[index];
        for (class_index = 0; class_index < Q32_CLASSES; ++class_index)
            squares += head->gb[class_index] * head->gb[class_index];
        if (squares > Q32_CLIP * Q32_CLIP)
            global_clip = (float)(Q32_CLIP / sqrt(squares));
    }
    correction = sqrtf(1.0f - powf(beta2, (float)step)) /
                 (1.0f - powf(beta1, (float)step));
#define Q36_ADAM(values, gradients, moments, variances, count) do {           \
    size_t q36_i;                                                             \
    for (q36_i = 0; q36_i < (count); ++q36_i) {                              \
        float g = (gradients)[q36_i];                                         \
        if (per_parameter) {                                                  \
            if (g > Q32_CLIP) g = Q32_CLIP;                                   \
            if (g < -Q32_CLIP) g = -Q32_CLIP;                                 \
        } else {                                                              \
            g *= global_clip;                                                 \
        }                                                                     \
        (moments)[q36_i] = beta1 * (moments)[q36_i] + (1.0f - beta1) * g;     \
        (variances)[q36_i] = beta2 * (variances)[q36_i] +                     \
            (1.0f - beta2) * g * g;                                           \
        (values)[q36_i] -= Q32_LEARNING_RATE * correction *                  \
            (moments)[q36_i] / (sqrtf((variances)[q36_i]) + epsilon);         \
    }                                                                         \
} while (0)
    Q36_ADAM(head->w, head->gw, head->mw, head->vw, weights);
    Q36_ADAM(head->b, head->gb, head->mb, head->vb, Q32_CLASSES);
#undef Q36_ADAM
}

static void q36_run(const char *arm, const char *feature_source,
                    const char *scale_mode, const char *clip_mode,
                    int per_parameter, const Q32Options *options,
                    const float *features, int feature_dim, uint64_t base_digest)
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
    if (events == NULL) q32_fail_path("open Q3.6 events", options->events_path);
    fprintf(events,
        "{\"schema\":\"%s\",\"type\":\"start\",\"arm\":\"%s\","
        "\"scale_mode\":\"%s\",\"clip_mode\":\"%s\",\"seed\":%d,"
        "\"base_parameters\":4852992,\"trainable_parameters\":%d,"
        "\"classes\":5,\"feature_dim\":%d,\"feature_source\":\"%s\","
        "\"feature_records\":9500,\"feature_workers\":%d,"
        "\"training_records\":9000,\"holdout_records\":500,"
        "\"maximum_updates\":100,\"measurement_updates\":[0,25,50,100],"
        "\"authorization_sha256\":\"%s\","
        "\"base_runtime_digest\":\"%016llx\"}\n",
        Q36_SCHEMA, arm, scale_mode, clip_mode, Q32_SEED,
        Q32_CLASSES * (feature_dim + 1), feature_dim, feature_source,
        Q36_WORKERS, options->authorization_sha256,
        (unsigned long long)base_digest);
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
        q36_head_update(&head, (uint64_t)update, per_parameter);
        updates_committed = update;
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
        "{\"schema\":\"%s\",\"type\":\"complete\",\"arm\":\"%s\","
        "\"updates_committed\":%d,\"stop_reason\":\"%s\","
        "\"runtime_feature_checkpoint_available\":%s,"
        "\"packaged_runtime_gate_run\":false,"
        "\"public_quantity_run\":false,\"language_gate_run\":false,"
        "\"promotion_run\":false}\n", Q36_SCHEMA, arm, updates_committed,
        stop_reason, strcmp(stop_reason, "runtime-feature-holdout-first-hit") == 0
                         ? "true" : "false");
    if (fclose(events) != 0)
        q32_fail_path("close Q3.6 events", options->events_path);
    free(training); q32_head_destroy(&head);
}

static void q36_make_directory(const char *path)
{
    if (mkdir(path, 0755) != 0 && errno != EEXIST)
        q32_fail_path("create Q3.6 directory", path);
}

static int q36_self_test(void)
{
    if (!q32_self_test(NULL)) q32_fail("Q3.6 inherited self-test failed");
    puts("Q3.6 factorial-probe mechanics self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    Q32Options options = {0};
    char prefix[4096], events[4096], directory[4096];
    unsigned char *package, *token_bytes, *projection_bytes;
    const uint16_t *tokens;
    const signed char *projection;
    size_t package_length, token_bytes_length, projection_length, token_count;
    size_t *starts, record_count;
    float *features, *dense, *sparse;
    uint64_t base_digest;
    int index;
    const char *out = NULL, *authorization = NULL;
    static const struct {
        const char *name;
        int is_dense;
        int fanin;
        int perparam;
    } arms[] = {
        {"dense-unscaled-global", 1, 0, 0},
        {"sparse-unscaled-global", 0, 0, 0},
        {"dense-unscaled-perparam", 1, 0, 1},
        {"sparse-unscaled-perparam", 0, 0, 1},
        {"dense-fanin-global", 1, 1, 0},
        {"sparse-fanin-global", 0, 1, 0},
        {"dense-fanin-perparam", 1, 1, 1},
        {"sparse-fanin-perparam", 0, 1, 1}
    };
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return q36_self_test() ? 0 : 1;
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) q32_fail("incomplete Q3.6 option");
        if (strcmp(argv[index], "--out") == 0) out = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            authorization = argv[++index];
        else q32_fail("unknown Q3.6 option");
    }
    if (out == NULL || authorization == NULL || strlen(authorization) != 64)
        q32_fail("Q3.6 requires --out and a 64-hex authorization digest");
    {
        int digit;
        for (digit = 0; digit < 64; ++digit)
            if (!isxdigit((unsigned char)authorization[digit]))
                q32_fail("Q3.6 authorization digest is not hexadecimal");
    }
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("Q3.6 could not load fixed quantized runtime source");
    if (q31_feature_dim != Q36_INPUT || config.layers != 6 || config.dim != 256)
        q32_fail("Q3.6 fixed runtime architecture drifted");
    base_digest = q32_digest(package, package_length);
    projection_bytes = q32_read_file(Q36_PROJECTION, &projection_length);
    if (projection_length != (size_t)Q36_EXPANSION * Q36_INPUT)
        q32_fail("Q3.6 projection length drifted");
    projection = (const signed char *)projection_bytes;
    token_bytes = q32_read_file(Q36_TOKENS, &token_bytes_length);
    if ((token_bytes_length & 1U) != 0) q32_fail("Q3.6 token file is truncated");
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    Q36_INPUT);
    dense = q32_alloc((size_t)Q32_FEATURE_RECORDS * Q36_EXPANSION,
                      sizeof(float));
    sparse = q32_alloc((size_t)Q32_FEATURE_RECORDS * Q36_EXPANSION,
                       sizeof(float));
    q36_expand(features, Q32_FEATURE_RECORDS, projection, dense);
    q36_mask_wta(dense, Q32_FEATURE_RECORDS, sparse);
    q36_make_directory(out);
    for (index = 0; index < 8; ++index) {
        if (index == 4) {
            q36_scale_fanin(dense, Q32_FEATURE_RECORDS, projection);
            q36_scale_fanin(sparse, Q32_FEATURE_RECORDS, projection);
        }
        snprintf(directory, sizeof(directory), "%s/%s", out, arms[index].name);
        q36_make_directory(directory);
        snprintf(prefix, sizeof(prefix), "%s/%s/checkpoint", out,
                 arms[index].name);
        snprintf(events, sizeof(events), "%s/%s/events.jsonl", out,
                 arms[index].name);
        options.out_prefix = prefix; options.events_path = events;
        options.authorization_sha256 = authorization;
        q36_run(arms[index].name,
                arms[index].is_dense ? "frozen-dense-expansion"
                                     : "frozen-sparse-expansion-wta",
                arms[index].fanin ? "fanin" : "unscaled",
                arms[index].perparam ? "perparam" : "global",
                arms[index].perparam, &options,
                arms[index].is_dense ? dense : sparse,
                Q36_EXPANSION, base_digest);
    }
    /* Linear anchor uses the raw 1536 features and the inherited global clip. */
    snprintf(directory, sizeof(directory), "%s/linear", out);
    q36_make_directory(directory);
    snprintf(prefix, sizeof(prefix), "%s/linear/checkpoint", out);
    snprintf(events, sizeof(events), "%s/linear/events.jsonl", out);
    options.out_prefix = prefix; options.events_path = events;
    options.authorization_sha256 = authorization;
    q36_run("linear", "deployment-exact-quantized-streaming", "unscaled",
            "global", 0, &options, features, Q36_INPUT, base_digest);
    free(dense); free(sparse);
    if (munmap(features, (size_t)Q32_FEATURE_RECORDS * Q36_INPUT *
                             sizeof(float)) != 0)
        q32_fail_path("unmap Q3.6 feature cache", "mmap");
    free(starts); free(token_bytes); free(projection_bytes); free(package);
    q31_release(); release_working_memory();
    return 0;
}
