#include <ctype.h>

#define Q28_AUDIT_NO_MAIN
#include "graded_plasticity_audit.c"

#define Q28_PILOT_SCHEMA "zero.zero4_q28_pilot_event.v1"
#define Q28_PILOT_PROFILE "benchmarks/zero4-q28-v1/audit/profile.tsv"
#define Q28_PILOT_INIT "teachers/zero3-balanced-final.teacher"
#define Q28_PILOT_QUANTITY "corpus/faculty/q22/quantity-request.tok"
#define Q28_PILOT_SEED 2
#define Q28_PILOT_UPDATES 200
#define Q28_PILOT_BATCH 2
#define Q28_PILOT_MEASURE_SAMPLES 4
#define Q28_PILOT_LEARNING_RATE 0.00002f
#define Q28_PILOT_WEIGHT_DECAY 0.01f
#define Q28_PILOT_CLIP 1.0f

typedef struct {
    const char *out_prefix;
    const char *events_path;
    const char *authorization_sha256;
} Q28PilotOptions;

static int q28_pilot_hex_sha256(const char *value)
{
    int index;
    if (value == NULL || strlen(value) != 64) return 0;
    for (index = 0; index < 64; ++index) {
        if (!((value[index] >= '0' && value[index] <= '9') ||
              (value[index] >= 'a' && value[index] <= 'f'))) return 0;
    }
    return 1;
}

static void q28_pilot_validate_options(const Q28PilotOptions *options)
{
    if (options->out_prefix == NULL || options->events_path == NULL ||
        !q28_pilot_hex_sha256(options->authorization_sha256)) {
        fail("pilot requires output paths and an exact authorization SHA-256");
    }
    if (strstr(options->out_prefix, "promotion") != NULL ||
        strstr(options->events_path, "promotion") != NULL ||
        strstr(options->out_prefix, "language-gate") != NULL ||
        strstr(options->events_path, "language-gate") != NULL) {
        fail("pilot outputs cannot target evaluation or promotion paths");
    }
}

static void q28_pilot_load_profile(const char *path, const Model *model,
                                   Q28Profile *profile)
{
    char line[512];
    FILE *file = fopen(path, "r");
    int group;
    if (file == NULL) fail_path("open fixed plasticity profile", path);
    if (fgets(line, sizeof(line), file) == NULL ||
        strcmp(line, Q28_PROFILE_HEADER "\n") != 0) {
        fail("fixed plasticity profile header drifted");
    }
    profile->count = model->parameter_count;
    profile->coefficient = zero_alloc((size_t)profile->count, sizeof(float));
    for (group = 0; group < model->parameter_count; ++group) {
        char *tab;
        char *end;
        float coefficient;
        if (fgets(line, sizeof(line), file) == NULL) {
            fail("fixed plasticity profile is incomplete");
        }
        tab = strchr(line, '\t');
        if (tab == NULL || strchr(tab + 1, '\t') != NULL) {
            fail("fixed plasticity profile row is malformed");
        }
        *tab = '\0';
        if (strcmp(line, model->parameters[group]->name) != 0) {
            fail("fixed plasticity parameter ordering drifted");
        }
        errno = 0;
        coefficient = strtof(tab + 1, &end);
        if (errno != 0 || end == tab + 1 ||
            (*end != '\n' && *end != '\0') ||
            !isfinite(coefficient) || coefficient < Q28_MIN_PLASTICITY ||
            coefficient > 1.0f) {
            fail("fixed plasticity coefficient is invalid");
        }
        profile->coefficient[group] = coefficient;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        char *cursor = line;
        while (*cursor != '\0') {
            if (!isspace((unsigned char)*cursor)) {
                fail("fixed plasticity profile has trailing rows");
            }
            ++cursor;
        }
    }
    if (ferror(file) || fclose(file) != 0) {
        fail_path("read fixed plasticity profile", path);
    }
    profile->digest = q28_profile_digest(model, profile->coefficient);
}

static int q28_pilot_fresh_moments(const Model *model)
{
    int group;
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            if (parameter->m[element] != 0.0f || parameter->v[element] != 0.0f)
                return 0;
        }
    }
    return 1;
}

static void q28_pilot_accumulate_gradient(
    Model *model, const Corpus *corpus, const CorpusRange *range,
    unsigned char *mask, Rng *rng, float *destination, float scale)
{
    size_t start;
    size_t offset = 0;
    int group;
    model_zero_grad(model);
    if (range->channel) {
        size_t record;
        if (range->training_record_count == 0) {
            fail("pilot channel range has no training records");
        }
        record = (size_t)(rng_next(rng) % range->training_record_count);
        start = range->record_starts[record];
        memset(mask, 0, (size_t)model->cfg.context);
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context, 1) == 0) {
            fail("pilot channel sample has no target");
        }
        (void)model_forward_masked(model, corpus->data + start,
                                   corpus->data + start + 1, 0.0f, NULL, mask);
        model_backward_masked(model, corpus->data + start,
                              corpus->data + start + 1, mask);
    } else {
        size_t choices = range->training_length - model->cfg.context;
        size_t local = (size_t)(rng_next(rng) % choices);
        start = range->start + local;
        (void)model_forward(model, corpus->data + start,
                            corpus->data + start + 1, 0.0f, NULL);
        model_backward(model, corpus->data + start,
                       corpus->data + start + 1);
    }
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            destination[offset + element] += scale * parameter->g[element];
        }
        offset += parameter->count;
    }
}

static double q28_pilot_sample_loss(Model *model, const Corpus *corpus,
                                    const CorpusRange *range,
                                    unsigned char *mask, int sample,
                                    int samples)
{
    size_t start;
    if (range->channel) {
        size_t record = samples == 1 ? 0 : (size_t)sample *
            (range->training_record_count - 1) / (size_t)(samples - 1);
        start = range->record_starts[record];
        memset(mask, 0, (size_t)model->cfg.context);
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context, 1) == 0) {
            fail("pilot measurement sample has no target");
        }
        return model_forward_masked(model, corpus->data + start,
                                    corpus->data + start + 1, 0.0f, NULL,
                                    mask);
    }
    {
        size_t choices = range->training_length - model->cfg.context;
        size_t local = samples == 1 ? 0 : (size_t)sample * (choices - 1) /
            (size_t)(samples - 1);
        start = range->start + local;
    }
    return model_forward(model, corpus->data + start,
                         corpus->data + start + 1, 0.0f, NULL);
}

static void q28_pilot_measure(Model *model, const Corpus *corpus,
                              const CorpusRange ranges[7],
                              unsigned char *mask, double *quantity_loss,
                              double *replay_loss)
{
    int sample;
    int range;
    *quantity_loss = 0.0;
    *replay_loss = 0.0;
    for (sample = 0; sample < Q28_PILOT_MEASURE_SAMPLES; ++sample) {
        *quantity_loss += q28_pilot_sample_loss(
            model, corpus, &ranges[6], mask, sample,
            Q28_PILOT_MEASURE_SAMPLES) / Q28_PILOT_MEASURE_SAMPLES;
    }
    for (range = 0; range < 6; ++range) {
        for (sample = 0; sample < Q28_PILOT_MEASURE_SAMPLES; ++sample) {
            *replay_loss += q28_pilot_sample_loss(
                model, corpus, &ranges[range], mask, sample,
                Q28_PILOT_MEASURE_SAMPLES) /
                (6 * Q28_PILOT_MEASURE_SAMPLES);
        }
    }
    if (!isfinite(*quantity_loss) || !isfinite(*replay_loss)) {
        fail("pilot measurement produced a non-finite loss");
    }
}

static void q28_pilot_checkpoint_path(char *path, size_t capacity,
                                      const char *prefix, int update)
{
    int written = snprintf(path, capacity, "%s-u%06d.ckpt", prefix, update);
    if (written < 0 || (size_t)written >= capacity) {
        fail("pilot checkpoint path is too long");
    }
}

static void q28_pilot_require_absent(const char *path)
{
    FILE *file;
    errno = 0;
    file = fopen(path, "rb");
    if (file != NULL) {
        fclose(file);
        fail_path("refuse to overwrite pilot output", path);
    }
    if (errno != ENOENT) fail_path("inspect pilot output", path);
}

static void q28_pilot_write_measurement(
    FILE *events, Model *model, const Corpus *corpus,
    const CorpusRange ranges[7], unsigned char *mask, int update)
{
    double quantity_loss;
    double replay_loss;
    q28_pilot_measure(model, corpus, ranges, mask, &quantity_loss,
                      &replay_loss);
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"measurement\","
            "\"update\":%d,\"quantity_training_loss\":%.17g,"
            "\"replay_training_loss\":%.17g,"
            "\"learned_state_digest\":\"%016llx\"}\n",
            Q28_PILOT_SCHEMA, update, quantity_loss, replay_loss,
            (unsigned long long)model_learned_state_digest(model));
    fflush(events);
}

static void q28_pilot_run(Model *model, const Corpus *corpus,
                          const CorpusRange ranges[7], Rng *rng,
                          const Q28Profile *profile,
                          const Q28PilotOptions *options)
{
    TransactionState state = {0};
    unsigned char *mask = zero_alloc((size_t)model->cfg.context, 1);
    FILE *events;
    char checkpoint[4096];
    int update;
    state.parameter_total = model_parameter_total(model);
    state.learned_before = zero_alloc(3 * state.parameter_total,
                                      sizeof(float));
    state.batch_gradient = zero_alloc(state.parameter_total, sizeof(float));
    state.replay_gradient = zero_alloc(state.parameter_total, sizeof(float));
    if (!q28_pilot_fresh_moments(model)) {
        fail("Q2.8 pilot must start with fresh AdamW moments");
    }
    q28_pilot_require_absent(options->events_path);
    for (update = 0; update <= Q28_PILOT_UPDATES; update += 100) {
        q28_pilot_checkpoint_path(checkpoint, sizeof(checkpoint),
                                  options->out_prefix, update);
        q28_pilot_require_absent(checkpoint);
    }
    events = fopen(options->events_path, "w");
    if (events == NULL) fail_path("open pilot events", options->events_path);
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"start\","
            "\"seed\":%d,\"maximum_updates\":%d,"
            "\"measurement_updates\":[0,100,200],"
            "\"authorization_sha256\":\"%s\","
            "\"profile_digest\":\"%016llx\"}\n",
            Q28_PILOT_SCHEMA, Q28_PILOT_SEED, Q28_PILOT_UPDATES,
            options->authorization_sha256,
            (unsigned long long)profile->digest);
    q28_pilot_checkpoint_path(checkpoint, sizeof(checkpoint),
                              options->out_prefix, 0);
    checkpoint_save(checkpoint, model, 0, rng, 0, 0, 0);
    q28_pilot_write_measurement(events, model, corpus, ranges, mask, 0);
    for (update = 1; update <= Q28_PILOT_UPDATES; ++update) {
        double coefficient;
        double pre_dot;
        double post_dot;
        double removed_fraction;
        int projection_applied;
        int sample;
        int range;
        memset(state.batch_gradient, 0,
               state.parameter_total * sizeof(float));
        memset(state.replay_gradient, 0,
               state.parameter_total * sizeof(float));
        transaction_copy_learned_from_model(&state, model);
        for (sample = 0; sample < Q28_PILOT_BATCH; ++sample) {
            q28_pilot_accumulate_gradient(
                model, corpus, &ranges[6], mask, rng, state.batch_gradient,
                1.0f / Q28_PILOT_BATCH);
        }
        for (range = 0; range < 6; ++range) {
            q28_pilot_accumulate_gradient(
                model, corpus, &ranges[range], mask, rng,
                state.replay_gradient, 1.0f / 6.0f);
        }
        transaction_restore_gradient(model, state.batch_gradient);
        (void)optimizer_update(model, (uint64_t)update,
                               Q28_PILOT_LEARNING_RATE,
                               Q28_PILOT_WEIGHT_DECAY, Q28_PILOT_CLIP, 1.0f);
        q28_apply_candidate(&state, model, profile);
        q28_project_candidate(&state, model, profile, &projection_applied,
                              &coefficient, &pre_dot, &post_dot,
                              &removed_fraction);
        if (pre_dot > 0.0 &&
            fabs(post_dot) > 1.0e-3 * (1.0 + fabs(pre_dot))) {
            fail("pilot weighted projection invariant failed");
        }
        fprintf(events,
                "{\"schema\":\"%s\",\"type\":\"update\","
                "\"update\":%d,\"projection_applied\":%s,"
                "\"projection_coefficient\":%.17g,"
                "\"projection_pre_dot\":%.17g,"
                "\"projection_post_dot\":%.17g,"
                "\"projection_removed_fraction\":%.17g}\n",
                Q28_PILOT_SCHEMA, update,
                projection_applied ? "true" : "false", coefficient,
                pre_dot, post_dot, removed_fraction);
        if (update == 100 || update == 200) {
            q28_pilot_checkpoint_path(checkpoint, sizeof(checkpoint),
                                      options->out_prefix, update);
            checkpoint_save(checkpoint, model, (uint64_t)update, rng,
                            (uint64_t)update, 0, 0);
            q28_pilot_write_measurement(events, model, corpus, ranges, mask,
                                        update);
        }
    }
    fprintf(events,
            "{\"schema\":\"%s\",\"type\":\"complete\","
            "\"updates_committed\":%d,\"language_gate_run\":false,"
            "\"promotion_run\":false}\n",
            Q28_PILOT_SCHEMA, Q28_PILOT_UPDATES);
    if (fclose(events) != 0) fail_path("close pilot events",
                                      options->events_path);
    free(mask);
    free(state.replay_gradient);
    free(state.batch_gradient);
    free(state.learned_before);
}

static int q28_pilot_self_test(void)
{
    Config cfg = {4, 8, 2, 1, 16, 1, DEFAULT_VOCAB_SIZE};
    Rng rng;
    Model model;
    TransactionState state = {0};
    Q28Profile profile = {0};
    Q28PilotOptions options = {
        "/tmp/q28-self-test", "/tmp/q28-self-test.jsonl",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    };
    uint64_t before;
    int group;
    int applied;
    double coefficient;
    double pre;
    double post;
    double removed;
    size_t offset = 0;
    (void)q28_run_audit;
    q28_pilot_validate_options(&options);
    if (q28_pilot_hex_sha256("ABC") ||
        q28_pilot_hex_sha256(
            "g123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")) {
        fail("Q2.8 authorization digest self-test failed");
    }
    rng_seed(&rng, 29);
    model_create(&model, cfg, &rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    if (!q28_pilot_fresh_moments(&model)) {
        fail("Q2.8 fresh-moment self-test failed");
    }
    state.parameter_total = model_parameter_total(&model);
    state.learned_before = zero_alloc(3 * state.parameter_total,
                                      sizeof(float));
    state.replay_gradient = zero_alloc(state.parameter_total, sizeof(float));
    profile.count = model.parameter_count;
    profile.coefficient = zero_alloc((size_t)profile.count, sizeof(float));
    for (group = 0; group < model.parameter_count; ++group) {
        Parameter *parameter = model.parameters[group];
        size_t element;
        profile.coefficient[group] = 0.1f +
            0.8f * (float)(group + 1) / model.parameter_count;
        for (element = 0; element < parameter->count; ++element) {
            parameter->g[element] = 0.001f * (float)(1 + element % 7);
            state.replay_gradient[offset + element] = -parameter->g[element];
        }
        offset += parameter->count;
    }
    transaction_copy_learned_from_model(&state, &model);
    before = model_learned_state_digest(&model);
    (void)optimizer_update(&model, 1, Q28_PILOT_LEARNING_RATE,
                           Q28_PILOT_WEIGHT_DECAY, Q28_PILOT_CLIP, 1.0f);
    q28_apply_candidate(&state, &model, &profile);
    q28_project_candidate(&state, &model, &profile, &applied, &coefficient,
                          &pre, &post, &removed);
    if (!applied || before == model_learned_state_digest(&model) ||
        q28_pilot_fresh_moments(&model) || pre <= 0.0 ||
        fabs(post) > 1.0e-5 * (1.0 + fabs(pre))) {
        fail("Q2.8 committed-update self-test failed");
    }
    free(profile.coefficient);
    free(state.replay_gradient);
    free(state.learned_before);
    model_destroy(&model);
    puts("Q2.8 fixed graded-plasticity pilot mechanics self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    Q28PilotOptions options = {0};
    Q28AuditOptions corpus_options = {0};
    Config cfg = preset_config("literary");
    Rng model_rng;
    Rng sample_rng;
    Model model;
    Tokenizer tokenizer = {0};
    Corpus corpus = {0};
    CorpusRange ranges[7];
    Q28Profile profile = {0};
    int index;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        return run_self_test() && q28_self_test() && q28_pilot_self_test()
                   ? 0 : 1;
    }
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) fail("incomplete pilot option");
        if (strcmp(argv[index], "--out-prefix") == 0)
            options.out_prefix = argv[++index];
        else if (strcmp(argv[index], "--events") == 0)
            options.events_path = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            options.authorization_sha256 = argv[++index];
        else fail("unknown pilot option");
    }
    q28_pilot_validate_options(&options);
    tokenizer_load(&tokenizer, "corpus/literary.bpe");
    rng_seed(&model_rng, 0);
    model_create(&model, cfg, &model_rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    (void)artifact_load_weights(Q28_PILOT_INIT, &model);
    if (!q28_pilot_fresh_moments(&model)) {
        fail("initialization did not provide fresh optimizer moments");
    }
    q28_pilot_load_profile(Q28_PILOT_PROFILE, &model, &profile);
    corpus_options.quantity_path = Q28_PILOT_QUANTITY;
    q28_load_corpus(&corpus, ranges, &corpus_options, &model, &tokenizer);
    rng_seed(&sample_rng, Q28_PILOT_SEED);
    q28_pilot_run(&model, &corpus, ranges, &sample_rng, &profile, &options);
    free(profile.coefficient);
    q28_destroy_ranges(ranges);
    corpus_destroy(&corpus);
    model_destroy(&model);
    return 0;
}
