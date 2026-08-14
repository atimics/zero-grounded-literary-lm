#include <ctype.h>

#define main literary_lm_legacy_main
#include "literary_lm.c"
#undef main

#define Q31_SCHEMA "zero.zero4_q31_operation_head_event.v1"
#define Q31_INIT "teachers/zero3-balanced-final.teacher"
#define Q31_QUANTITY "corpus/faculty/q22/quantity-request.tok"
#define Q31_SEED 2
#define Q31_CLASSES 5
#define Q31_BASE_CONTEXT 512
#define Q31_FEATURE_CONTEXT 96
#define Q31_TRAIN_RECORDS 9000
#define Q31_HOLDOUT_RECORDS 500
#define Q31_BATCH 64
#define Q31_MAXIMUM_UPDATES 100
#define Q31_LEARNING_RATE 0.001f
#define Q31_CLIP 1.0f
#define Q31_OVERALL_MINIMUM 0.99
#define Q31_CLASS_MINIMUM 0.98

typedef struct {
    int input;
    int classes;
    float *w, *b;
    float *gw, *gb;
    float *mw, *mb;
    float *vw, *vb;
} Q31Head;

typedef struct {
    char magic[8];
    uint32_t version, vocab, base_context, feature_context;
    uint32_t dim, layers, classes, feature_dim;
    uint64_t step, base_state_digest, head_parameters;
} Q31CheckpointHeader;

typedef struct {
    double cross_entropy;
    double accuracy;
    double per_class[Q31_CLASSES];
    int correct[Q31_CLASSES];
    int count[Q31_CLASSES];
} Q31Measurement;

typedef struct {
    const char *out_prefix;
    const char *events_path;
    const char *authorization_sha256;
} Q31Options;

static const char Q31_CHECKPOINT_MAGIC[8] =
    {'Q', '3', '1', 'H', 'E', 'A', 'D', '1'};

static size_t q31_head_parameters(const Q31Head *head)
{
    return (size_t)head->classes * ((size_t)head->input + 1U);
}

static void q31_head_create(Q31Head *head, int input, int classes)
{
    size_t weights = (size_t)input * classes;
    head->input = input;
    head->classes = classes;
    head->w = zero_alloc(weights, sizeof(float));
    head->b = zero_alloc((size_t)classes, sizeof(float));
    head->gw = zero_alloc(weights, sizeof(float));
    head->gb = zero_alloc((size_t)classes, sizeof(float));
    head->mw = zero_alloc(weights, sizeof(float));
    head->mb = zero_alloc((size_t)classes, sizeof(float));
    head->vw = zero_alloc(weights, sizeof(float));
    head->vb = zero_alloc((size_t)classes, sizeof(float));
}

static void q31_head_destroy(Q31Head *head)
{
    free(head->w); free(head->b); free(head->gw); free(head->gb);
    free(head->mw); free(head->mb); free(head->vw); free(head->vb);
    memset(head, 0, sizeof(*head));
}

static void q31_head_zero_grad(Q31Head *head)
{
    memset(head->gw, 0, (size_t)head->input * head->classes * sizeof(float));
    memset(head->gb, 0, (size_t)head->classes * sizeof(float));
}

static double q31_head_example(Q31Head *head, const float *feature, int label,
                               float gradient_scale, int accumulate,
                               int *prediction)
{
    float logits[Q31_CLASSES];
    float probabilities[Q31_CLASSES];
    float maximum;
    float total = 0.0f;
    int best = 0;
    int class_index;
    int input;
    if (head->classes != Q31_CLASSES || label < 0 || label >= head->classes)
        fail("Q3.1 invalid classifier shape or label");
    for (class_index = 0; class_index < head->classes; ++class_index) {
        double value = head->b[class_index];
        const float *row = head->w + (size_t)class_index * head->input;
        for (input = 0; input < head->input; ++input)
            value += row[input] * feature[input];
        logits[class_index] = (float)value;
    }
    maximum = logits[0];
    for (class_index = 1; class_index < head->classes; ++class_index)
        if (logits[class_index] > maximum) maximum = logits[class_index];
    for (class_index = 0; class_index < head->classes; ++class_index) {
        probabilities[class_index] = expf(logits[class_index] - maximum);
        total += probabilities[class_index];
    }
    for (class_index = 0; class_index < head->classes; ++class_index) {
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

static double q31_gradient_norm(const Q31Head *head)
{
    size_t weights = (size_t)head->input * head->classes;
    double total = 0.0;
    size_t index;
    for (index = 0; index < weights; ++index)
        total += head->gw[index] * head->gw[index];
    for (index = 0; index < (size_t)head->classes; ++index)
        total += head->gb[index] * head->gb[index];
    return sqrt(total);
}

static void q31_adam(float *values, const float *gradient, float *m, float *v,
                     size_t count, uint64_t step, float clip_scale)
{
    const float beta1 = 0.9f;
    const float beta2 = 0.999f;
    const float epsilon = 1.0e-8f;
    float correction = sqrtf(1.0f - powf(beta2, (float)step)) /
                       (1.0f - powf(beta1, (float)step));
    size_t index;
    for (index = 0; index < count; ++index) {
        float g = gradient[index] * clip_scale;
        m[index] = beta1 * m[index] + (1.0f - beta1) * g;
        v[index] = beta2 * v[index] + (1.0f - beta2) * g * g;
        values[index] -= Q31_LEARNING_RATE * correction * m[index] /
                         (sqrtf(v[index]) + epsilon);
    }
}

static void q31_head_update(Q31Head *head, uint64_t step)
{
    double norm = q31_gradient_norm(head);
    float clip = norm > Q31_CLIP ? (float)(Q31_CLIP / norm) : 1.0f;
    q31_adam(head->w, head->gw, head->mw, head->vw,
             (size_t)head->input * head->classes, step, clip);
    q31_adam(head->b, head->gb, head->mb, head->vb,
             (size_t)head->classes, step, clip);
}

static uint64_t q31_head_digest(const Q31Head *head)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    size_t weights = (size_t)head->input * head->classes * sizeof(float);
    size_t biases = (size_t)head->classes * sizeof(float);
    hash = hash_bytes(hash, head->w, weights);
    hash = hash_bytes(hash, head->b, biases);
    hash = hash_bytes(hash, head->mw, weights);
    hash = hash_bytes(hash, head->mb, biases);
    hash = hash_bytes(hash, head->vw, weights);
    return hash_bytes(hash, head->vb, biases);
}

static uint64_t q31_load_base(const char *path, Model *model)
{
    CheckpointHeader header;
    FILE *file = fopen(path, "rb");
    int weight_only;
    int parameter_index;
    if (file == NULL) fail_path("open", path);
    header = artifact_read_header(file, path, &weight_only);
    if ((int)header.context != Q31_BASE_CONTEXT ||
        (int)header.dim != model->cfg.dim ||
        (int)header.heads != model->cfg.heads ||
        (int)header.layers != model->cfg.layers ||
        (int)header.ff != model->cfg.ff ||
        (int)header.vocab != model->cfg.vocab ||
        (header.reserved & CHECKPOINT_ROTARY_FLAG) == 0 ||
        !model->cfg.rotary ||
        (int)header.parameter_count != model->parameter_count) {
        fclose(file);
        fail("Q3.1 base artifact architecture does not match");
    }
    if (!weight_only && header.version >= 4U) {
        CheckpointOrchestration orchestration;
        if (!read_items(file, &orchestration, sizeof(orchestration), 1))
            fail("Q3.1 base artifact orchestration state is corrupt");
    }
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        uint64_t count = 0;
        if (!read_items(file, &count, sizeof(count), 1) ||
            count != parameter->count ||
            !read_items(file, parameter->w, sizeof(float), parameter->count))
            fail("Q3.1 base artifact parameter is corrupt");
        if (!weight_only &&
            fseek(file, (long)(2 * parameter->count * sizeof(float)),
                  SEEK_CUR) != 0)
            fail_path("skip optimizer state in", path);
        memset(parameter->m, 0, parameter->count * sizeof(float));
        memset(parameter->v, 0, parameter->count * sizeof(float));
    }
    if (fclose(file) != 0) fail_path("close", path);
    return header.step;
}

static int q31_label_for_record(size_t record)
{
    return (int)(record % Q31_CLASSES);
}

static void q31_extract_feature(Model *model, const Corpus *corpus,
                                const CorpusRange *range, size_t record,
                                Token *tokens, float *feature)
{
    size_t start;
    size_t end;
    int target = -1;
    int time;
    int layer;
    if (record >= range->record_count)
        fail("Q3.1 feature record is out of range");
    start = range->record_starts[record];
    end = record + 1 < range->record_count
              ? range->record_starts[record + 1]
              : range->start + range->length;
    for (time = 0; time < model->cfg.context; ++time)
        tokens[time] = CHANNEL_RECORD_END_TOKEN;
    for (time = 0; start + (size_t)time < end; ++time) {
        Token token = corpus->data[start + (size_t)time];
        if (time >= model->cfg.context)
            fail("Q3.1 record target exceeds feature context");
        tokens[time] = token;
        if (token == CHANNEL_TARGET_TOKEN) {
            target = time;
            break;
        }
    }
    if (target < 0 || tokens[0] != CHANNEL_START_TOKEN || tokens[1] != 'Q')
        fail("Q3.1 record lacks a Q-routed target boundary");
    (void)model_forward(model, tokens, NULL, 0.0f, NULL);
    for (layer = 0; layer < model->cfg.layers; ++layer) {
        const float *source = layer + 1 < model->cfg.layers
                                  ? model->cache[layer + 1].x
                                  : model->final_x;
        const float *row = source + (size_t)target * model->cfg.dim;
        double squares = 0.0;
        float scale;
        int dimension;
        for (dimension = 0; dimension < model->cfg.dim; ++dimension)
            squares += row[dimension] * row[dimension];
        scale = 1.0f / sqrtf((float)(squares / model->cfg.dim) + 1.0e-8f);
        for (dimension = 0; dimension < model->cfg.dim; ++dimension)
            feature[(size_t)layer * model->cfg.dim + dimension] =
                row[dimension] * scale;
    }
}

static Q31Measurement q31_measure(Q31Head *head, const float *features)
{
    Q31Measurement result;
    int record;
    memset(&result, 0, sizeof(result));
    for (record = 0; record < Q31_HOLDOUT_RECORDS; ++record) {
        int label = q31_label_for_record(Q31_TRAIN_RECORDS + (size_t)record);
        int prediction;
        result.cross_entropy += q31_head_example(
            head, features + (size_t)record * head->input, label, 0.0f, 0,
            &prediction) / Q31_HOLDOUT_RECORDS;
        ++result.count[label];
        if (prediction == label) {
            ++result.correct[label];
            result.accuracy += 1.0 / Q31_HOLDOUT_RECORDS;
        }
    }
    for (record = 0; record < Q31_CLASSES; ++record) {
        if (result.count[record] != Q31_HOLDOUT_RECORDS / Q31_CLASSES)
            fail("Q3.1 holdout is not exactly class-balanced");
        result.per_class[record] =
            (double)result.correct[record] / result.count[record];
    }
    return result;
}

static int q31_qualifies(const Q31Measurement *measurement)
{
    int class_index;
    if (measurement->accuracy + 1.0e-12 < Q31_OVERALL_MINIMUM) return 0;
    for (class_index = 0; class_index < Q31_CLASSES; ++class_index)
        if (measurement->per_class[class_index] + 1.0e-12 < Q31_CLASS_MINIMUM)
            return 0;
    return 1;
}

static void q31_path(char *path, size_t capacity, const char *prefix,
                     int update)
{
    int written = snprintf(path, capacity, "%s-u%06d.q31", prefix, update);
    if (written < 0 || (size_t)written >= capacity)
        fail("Q3.1 checkpoint path is too long");
}

static void q31_require_absent(const char *path)
{
    FILE *file = fopen(path, "rb");
    if (file != NULL) { fclose(file); fail_path("refuse to overwrite", path); }
    if (errno != ENOENT) fail_path("inspect", path);
}

static void q31_checkpoint_save(const char *path, const Q31Head *head,
                                uint32_t vocab, uint32_t dim, uint32_t layers,
                                uint64_t step, uint64_t base_digest)
{
    Q31CheckpointHeader header;
    char *temporary = zero_alloc(strlen(path) + 5, 1);
    FILE *file;
    size_t weights = (size_t)head->input * head->classes;
    snprintf(temporary, strlen(path) + 5, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) fail_path("create Q3.1 checkpoint", temporary);
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, Q31_CHECKPOINT_MAGIC, sizeof(header.magic));
    header.version = 1;
    header.vocab = vocab;
    header.base_context = Q31_BASE_CONTEXT;
    header.feature_context = Q31_FEATURE_CONTEXT;
    header.dim = dim;
    header.layers = layers;
    header.classes = (uint32_t)head->classes;
    header.feature_dim = (uint32_t)head->input;
    header.step = step;
    header.base_state_digest = base_digest;
    header.head_parameters = q31_head_parameters(head);
    if (!write_items(file, &header, sizeof(header), 1) ||
        !write_items(file, head->w, sizeof(float), weights) ||
        !write_items(file, head->b, sizeof(float), (size_t)head->classes) ||
        !write_items(file, head->mw, sizeof(float), weights) ||
        !write_items(file, head->mb, sizeof(float), (size_t)head->classes) ||
        !write_items(file, head->vw, sizeof(float), weights) ||
        !write_items(file, head->vb, sizeof(float), (size_t)head->classes))
        fail_path("write Q3.1 checkpoint", temporary);
    if (fclose(file) != 0 || rename(temporary, path) != 0)
        fail_path("install Q3.1 checkpoint", path);
    free(temporary);
}

static void q31_emit_measurement(FILE *events, int update,
                                 const Q31Measurement *measurement,
                                 uint64_t base_digest, uint64_t head_digest)
{
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"measurement\","
            "\"update\":%d,\"holdout_cross_entropy\":%.17g,"
            "\"holdout_accuracy\":%.17g,"
            "\"per_class_accuracy\":[%.17g,%.17g,%.17g,%.17g,%.17g],"
            "\"per_class_count\":[%d,%d,%d,%d,%d],"
            "\"base_state_digest\":\"%016llx\","
            "\"head_state_digest\":\"%016llx\"}\n",
            Q31_SCHEMA, update, measurement->cross_entropy,
            measurement->accuracy, measurement->per_class[0],
            measurement->per_class[1], measurement->per_class[2],
            measurement->per_class[3], measurement->per_class[4],
            measurement->count[0], measurement->count[1],
            measurement->count[2], measurement->count[3],
            measurement->count[4], (unsigned long long)base_digest,
            (unsigned long long)head_digest);
    fflush(events);
}

static void q31_shuffle(int *records, int count, Rng *rng)
{
    int index;
    for (index = 0; index < count; ++index) records[index] = index;
    for (index = count - 1; index > 0; --index) {
        int other = (int)(rng_next(rng) % (uint32_t)(index + 1));
        int temporary = records[index];
        records[index] = records[other]; records[other] = temporary;
    }
}

static int q31_measurement_update(int update)
{
    return update == 25 || update == 50 || update == 100;
}

static void q31_run(Model *model, Q31Head *head, const Corpus *corpus,
                    const CorpusRange *range, Rng *rng,
                    const Q31Options *options)
{
    Token *tokens = zero_alloc((size_t)model->cfg.context, sizeof(Token));
    float *feature = zero_alloc((size_t)head->input, sizeof(float));
    float *holdout = zero_alloc((size_t)Q31_HOLDOUT_RECORDS * head->input,
                                sizeof(float));
    int *training = zero_alloc(Q31_TRAIN_RECORDS, sizeof(int));
    uint64_t base_digest = model_learned_state_digest(model);
    const char *stop_reason = "update-cap";
    FILE *events;
    char checkpoint[4096];
    int updates_committed = 0;
    int update;
    int record;
    if (range->record_count != Q31_TRAIN_RECORDS + Q31_HOLDOUT_RECORDS + 500 ||
        range->validation_record_index != Q31_TRAIN_RECORDS +
                                                   Q31_HOLDOUT_RECORDS)
        fail("Q3.1 quantity corpus split drifted");
    for (record = 0; record < Q31_HOLDOUT_RECORDS; ++record)
        q31_extract_feature(model, corpus, range,
                            Q31_TRAIN_RECORDS + (size_t)record, tokens,
                            holdout + (size_t)record * head->input);
    if (model_learned_state_digest(model) != base_digest)
        fail("Q3.1 feature extraction changed frozen ZERO.3 state");
    q31_shuffle(training, Q31_TRAIN_RECORDS, rng);
    for (update = 0; update <= Q31_MAXIMUM_UPDATES; ++update) {
        if (update != 0 && !q31_measurement_update(update)) continue;
        q31_path(checkpoint, sizeof(checkpoint), options->out_prefix, update);
        q31_require_absent(checkpoint);
    }
    q31_require_absent(options->events_path);
    events = fopen(options->events_path, "w");
    if (events == NULL) fail_path("open Q3.1 events", options->events_path);
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"start\",\"seed\":%d,"
            "\"base_parameters\":%zu,\"trainable_parameters\":%zu,"
            "\"classes\":%d,\"feature_dim\":%d,"
            "\"training_records\":%d,\"holdout_records\":%d,"
            "\"maximum_updates\":%d,"
            "\"measurement_updates\":[0,25,50,100],"
            "\"authorization_sha256\":\"%s\","
            "\"base_state_digest\":\"%016llx\"}\n",
            Q31_SCHEMA, Q31_SEED, model_parameter_total(model),
            q31_head_parameters(head), Q31_CLASSES, head->input,
            Q31_TRAIN_RECORDS, Q31_HOLDOUT_RECORDS, Q31_MAXIMUM_UPDATES,
            options->authorization_sha256, (unsigned long long)base_digest);
    q31_path(checkpoint, sizeof(checkpoint), options->out_prefix, 0);
    q31_checkpoint_save(checkpoint, head, (uint32_t)model->cfg.vocab,
                        (uint32_t)model->cfg.dim, (uint32_t)model->cfg.layers,
                        0, base_digest);
    {
        Q31Measurement measurement = q31_measure(head, holdout);
        q31_emit_measurement(events, 0, &measurement, base_digest,
                             q31_head_digest(head));
    }
    for (update = 1; update <= Q31_MAXIMUM_UPDATES; ++update) {
        int sample;
        q31_head_zero_grad(head);
        for (sample = 0; sample < Q31_BATCH; ++sample) {
            int training_index = (update - 1) * Q31_BATCH + sample;
            int selected = training[training_index % Q31_TRAIN_RECORDS];
            int label = q31_label_for_record((size_t)selected);
            q31_extract_feature(model, corpus, range, (size_t)selected,
                                tokens, feature);
            (void)q31_head_example(head, feature, label,
                                   1.0f / Q31_BATCH, 1, NULL);
        }
        q31_head_update(head, (uint64_t)update);
        updates_committed = update;
        if (model_learned_state_digest(model) != base_digest)
            fail("Q3.1 changed frozen ZERO.3 state");
        if (q31_measurement_update(update)) {
            Q31Measurement measurement = q31_measure(head, holdout);
            q31_path(checkpoint, sizeof(checkpoint), options->out_prefix,
                     update);
            q31_checkpoint_save(checkpoint, head, (uint32_t)model->cfg.vocab,
                                (uint32_t)model->cfg.dim,
                                (uint32_t)model->cfg.layers,
                                (uint64_t)update, base_digest);
            q31_emit_measurement(events, update, &measurement, base_digest,
                                 q31_head_digest(head));
            if (q31_qualifies(&measurement)) {
                stop_reason = "holdout-first-hit";
                break;
            }
        }
    }
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"complete\","
            "\"updates_committed\":%d,\"stop_reason\":\"%s\","
            "\"candidate_checkpoint_available\":%s,"
            "\"public_quantity_run\":false,\"language_gate_run\":false,"
            "\"promotion_run\":false}\n",
            Q31_SCHEMA, updates_committed, stop_reason,
            strcmp(stop_reason, "holdout-first-hit") == 0 ? "true" :
                                                               "false");
    if (fclose(events) != 0) fail_path("close Q3.1 events",
                                      options->events_path);
    free(training); free(holdout); free(feature); free(tokens);
}

static int q31_self_test(const char *artifact_prefix)
{
    Q31Head head = {0};
    float feature[Q31_CLASSES] = {0};
    int update;
    int label;
    q31_head_create(&head, Q31_CLASSES, Q31_CLASSES);
    for (update = 1; update <= 100; ++update) {
        q31_head_zero_grad(&head);
        for (label = 0; label < Q31_CLASSES; ++label) {
            int prediction;
            memset(feature, 0, sizeof(feature)); feature[label] = 8.0f;
            (void)q31_head_example(&head, feature, label,
                                   1.0f / Q31_CLASSES, 1, &prediction);
        }
        q31_head_update(&head, (uint64_t)update);
    }
    for (label = 0; label < Q31_CLASSES; ++label) {
        int prediction;
        memset(feature, 0, sizeof(feature)); feature[label] = 8.0f;
        (void)q31_head_example(&head, feature, label, 0.0f, 0, &prediction);
        if (prediction != label) fail("Q3.1 classifier self-test failed");
    }
    q31_head_destroy(&head);
    if (artifact_prefix != NULL) {
        char path[4096];
        Q31Head artifact = {0};
        q31_head_create(&artifact, 6 * 256, Q31_CLASSES);
        snprintf(path, sizeof(path), "%s-head0.q31", artifact_prefix);
        q31_checkpoint_save(path, &artifact, 128, 256, 6, 0,
                            UINT64_C(0x0123456789abcdef));
        artifact.b[3] = 4.0f;
        snprintf(path, sizeof(path), "%s-head1.q31", artifact_prefix);
        q31_checkpoint_save(path, &artifact, 128, 256, 6, 1,
                            UINT64_C(0x0123456789abcdef));
        q31_head_destroy(&artifact);
    }
    puts("Q3.1 routed operation-head mechanics self-test passed");
    return 1;
}

static void q31_validate_options(const Q31Options *options)
{
    int index;
    if (options->out_prefix == NULL || options->events_path == NULL ||
        options->authorization_sha256 == NULL ||
        strlen(options->authorization_sha256) != 64)
        fail("Q3.1 requires fixed output and authorization bindings");
    for (index = 0; index < 64; ++index)
        if (!isxdigit((unsigned char)options->authorization_sha256[index]))
            fail("Q3.1 authorization digest is not hexadecimal");
}

int main(int argc, char **argv)
{
    Q31Options options = {0};
    Config cfg = preset_config("literary");
    Rng initialization_rng;
    Rng sample_rng;
    Model model;
    Q31Head head = {0};
    Corpus corpus = {0};
    CorpusRange range = {0};
    int index;
    if ((argc == 2 && strcmp(argv[1], "--self-test") == 0) ||
        (argc == 3 && strcmp(argv[1], "--self-test-artifacts") == 0))
        return q31_self_test(argc == 3 ? argv[2] : NULL) ? 0 : 1;
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) fail("incomplete Q3.1 option");
        if (strcmp(argv[index], "--out-prefix") == 0)
            options.out_prefix = argv[++index];
        else if (strcmp(argv[index], "--events") == 0)
            options.events_path = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            options.authorization_sha256 = argv[++index];
        else fail("unknown Q3.1 option");
    }
    q31_validate_options(&options);
    cfg.context = Q31_FEATURE_CONTEXT;
    rng_seed(&initialization_rng, 0);
    model_create(&model, cfg, &initialization_rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    (void)q31_load_base(Q31_INIT, &model);
    for (index = 0; index < model.parameter_count; ++index)
        model.parameters[index]->trainable = 0;
    q31_head_create(&head, model.cfg.layers * model.cfg.dim, Q31_CLASSES);
    corpus_add_file(&corpus, Q31_QUANTITY, 2);
    range.start = 0; range.length = corpus.length; range.channel = 1;
    prepare_channel_range(&range, &corpus, model.cfg.context, Q31_QUANTITY);
    rng_seed(&sample_rng, Q31_SEED);
    q31_run(&model, &head, &corpus, &range, &sample_rng, &options);
    free(range.record_starts);
    corpus_destroy(&corpus);
    q31_head_destroy(&head);
    model_destroy(&model);
    return 0;
}
