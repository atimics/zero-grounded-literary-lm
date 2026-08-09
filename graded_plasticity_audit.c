#define main literary_lm_legacy_main
#include "literary_lm.c"
#undef main

#define Q28_PROFILE_HEADER "zero.graded_plasticity_profile.v1"
#define Q28_MIN_PLASTICITY 0.05f

typedef struct {
    int count;
    float *coefficient;
    uint64_t digest;
} Q28Profile;

typedef struct {
    const char *init_path;
    const char *quantity_path;
    const char *audit_path;
    const char *profile_path;
    int samples;
} Q28AuditOptions;

static const char *Q28_REPLAY_PATHS[] = {
    "corpus/bpe/zero-foundation.tok",
    "corpus/bpe/shakespeare.tok",
    "corpus/bpe/blake.tok",
    "corpus/bpe/crowley.tok",
    "corpus/bpe/bible-kjv.tok",
    "corpus/channel/literary-dialogue.tok"
};

static uint64_t q28_profile_digest(const Model *model,
                                   const float *coefficient)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    int group;
    for (group = 0; group < model->parameter_count; ++group) {
        const char *name = model->parameters[group]->name;
        hash = hash_bytes(hash, name, strlen(name) + 1);
        hash = hash_bytes(hash, &coefficient[group], sizeof(float));
    }
    return hash;
}

static void q28_write_profile(const char *path, const Model *model,
                              const Q28Profile *profile)
{
    FILE *file = fopen(path, "w");
    int group;
    if (file == NULL) fail_path("open plasticity profile", path);
    fprintf(file, "%s\n", Q28_PROFILE_HEADER);
    for (group = 0; group < model->parameter_count; ++group) {
        fprintf(file, "%s\t%.9g\n", model->parameters[group]->name,
                profile->coefficient[group]);
    }
    if (fclose(file) != 0) fail_path("close plasticity profile", path);
}

static void q28_apply_candidate(const TransactionState *state, Model *model,
                                const Q28Profile *profile)
{
    size_t learned = 0;
    int group;
    for (group = 0; group < model->parameter_count; ++group) {
        Parameter *parameter = model->parameters[group];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double before = state->learned_before[learned + element];
            double delta = parameter->w[element] - before;
            double scaled = before + profile->coefficient[group] * delta;
            if (!isfinite(scaled)) fail("non-finite plasticity candidate");
            parameter->w[element] = (float)scaled;
        }
        learned += 3 * parameter->count;
    }
}

static void q28_project_candidate(
    const TransactionState *state, Model *model, const Q28Profile *profile,
    int *applied, double *coefficient, double *pre_dot, double *post_dot,
    double *removed_fraction)
{
    size_t gradient = 0;
    size_t learned = 0;
    double denominator = 0.0;
    double displacement_norm = 0.0;
    double removed_norm = 0.0;
    int group;
    *pre_dot = 0.0;
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double replay = state->replay_gradient[gradient + element];
            double delta = parameter->w[element] -
                           state->learned_before[learned + element];
            *pre_dot += replay * delta;
            denominator += profile->coefficient[group] * replay * replay;
            displacement_norm += delta * delta;
        }
        gradient += parameter->count;
        learned += 3 * parameter->count;
    }
    if (!isfinite(*pre_dot) || !isfinite(denominator) || denominator <= 0.0) {
        fail("invalid weighted projection inputs");
    }
    *applied = *pre_dot > 0.0;
    *coefficient = *applied ? *pre_dot / denominator : 0.0;
    if (*applied) {
        gradient = 0;
        for (group = 0; group < model->parameter_count; ++group) {
            Parameter *parameter = model->parameters[group];
            size_t element;
            for (element = 0; element < parameter->count; ++element) {
                double before = parameter->w[element];
                double projected = before - *coefficient *
                    profile->coefficient[group] *
                    state->replay_gradient[gradient + element];
                if (!isfinite(projected)) fail("non-finite projection");
                parameter->w[element] = (float)projected;
                {
                    double removed = before - parameter->w[element];
                    removed_norm += removed * removed;
                }
            }
            gradient += parameter->count;
        }
    }
    *post_dot = 0.0;
    gradient = 0;
    learned = 0;
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            *post_dot += state->replay_gradient[gradient + element] *
                (parameter->w[element] -
                 state->learned_before[learned + element]);
        }
        gradient += parameter->count;
        learned += 3 * parameter->count;
    }
    *removed_fraction = displacement_norm > 0.0
                            ? sqrt(removed_norm / displacement_norm)
                            : 0.0;
    if (!isfinite(*post_dot) || !isfinite(*removed_fraction)) {
        fail("non-finite projection diagnostics");
    }
}

static void q28_training_gradient(Model *model, const Corpus *corpus,
                                  const CorpusRange *range,
                                  unsigned char *mask, int sample,
                                  int samples)
{
    size_t start;
    model_zero_grad(model);
    if (range->channel) {
        size_t record = samples == 1 ? 0 : (size_t)sample *
            (range->training_record_count - 1) / (size_t)(samples - 1);
        start = range->record_starts[record];
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context, 1) == 0) {
            fail("audit channel sample has no target");
        }
        (void)model_forward_masked(model, corpus->data + start,
                                   corpus->data + start + 1, 0.0f, NULL, mask);
        model_backward_masked(model, corpus->data + start,
                              corpus->data + start + 1, mask);
    } else {
        size_t choices = range->training_length - model->cfg.context;
        size_t local = samples == 1 ? 0 : (size_t)sample * (choices - 1) /
            (size_t)(samples - 1);
        start = range->start + local;
        (void)model_forward(model, corpus->data + start,
                            corpus->data + start + 1, 0.0f, NULL);
        model_backward(model, corpus->data + start,
                       corpus->data + start + 1);
    }
}

static int q28_compare_double(const void *left, const void *right)
{
    double a = *(const double *)left;
    double b = *(const double *)right;
    return (a > b) - (a < b);
}

static double q28_median(const double *values, int count)
{
    double *copy = zero_alloc((size_t)count, sizeof(double));
    double result;
    memcpy(copy, values, (size_t)count * sizeof(double));
    qsort(copy, (size_t)count, sizeof(double), q28_compare_double);
    result = count % 2 ? copy[count / 2]
                       : 0.5 * (copy[count / 2 - 1] + copy[count / 2]);
    free(copy);
    if (!isfinite(result) || result <= 0.0) fail("invalid gradient median");
    return result;
}

static int q28_learned_matches(const TransactionState *state,
                               const Model *model)
{
    size_t offset = 0;
    int group;
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        size_t bytes = parameter->count * sizeof(float);
        if (memcmp(parameter->w, state->learned_before + offset, bytes) != 0)
            return 0;
        offset += parameter->count;
        if (memcmp(parameter->m, state->learned_before + offset, bytes) != 0)
            return 0;
        offset += parameter->count;
        if (memcmp(parameter->v, state->learned_before + offset, bytes) != 0)
            return 0;
        offset += parameter->count;
    }
    return 1;
}

static void q28_load_corpus(Corpus *corpus, CorpusRange ranges[7],
                            const Q28AuditOptions *options,
                            const Model *model, const Tokenizer *tokenizer)
{
    int index;
    memset(ranges, 0, 7 * sizeof(*ranges));
    for (index = 0; index < 7; ++index) {
        const char *path = index < 6 ? Q28_REPLAY_PATHS[index]
                                     : options->quantity_path;
        size_t before = corpus->length;
        int channel = index >= 5;
        corpus_add_file(corpus, path, channel ? 2 : tokenizer->token_width);
        ranges[index].start = before + (before != 0 ? 2 : 0);
        ranges[index].length = corpus->length - ranges[index].start;
        ranges[index].channel = channel;
        ranges[index].teacher_eligible = index < 6;
        if (channel) {
            prepare_channel_range(&ranges[index], corpus,
                                  model->cfg.context, path);
        } else {
            size_t minimum = 2 * ((size_t)model->cfg.context + 1);
            if (ranges[index].length < minimum) fail("replay file too short");
            ranges[index].validation_length = ranges[index].length / 20;
            if (ranges[index].validation_length <
                (size_t)model->cfg.context + 1) {
                ranges[index].validation_length =
                    (size_t)model->cfg.context + 1;
            }
            ranges[index].training_length = ranges[index].length -
                                             ranges[index].validation_length;
            ranges[index].validation_start = ranges[index].start +
                                              ranges[index].training_length;
        }
    }
}

static void q28_destroy_ranges(CorpusRange ranges[7])
{
    int index;
    for (index = 0; index < 7; ++index) free(ranges[index].record_starts);
}

static void q28_run_audit(Model *model, const Corpus *corpus,
                          const CorpusRange ranges[7],
                          const Q28AuditOptions *options)
{
    const double epsilon = 1.0e-12;
    TransactionState state = {0};
    Q28Profile profile = {0};
    unsigned char *mask = zero_alloc((size_t)model->cfg.context, 1);
    double *values = zero_alloc((size_t)model->parameter_count * 9,
                                sizeof(double));
    double *quantity_energy = values + 0 * model->parameter_count;
    double *replay_energy = values + 1 * model->parameter_count;
    double *alignment = values + 2 * model->parameter_count;
    double *optimizer_delta = values + 3 * model->parameter_count;
    double *scaled_delta = values + 4 * model->parameter_count;
    double *scaled_drift = values + 5 * model->parameter_count;
    double *projected_delta = values + 6 * model->parameter_count;
    double *projected_drift = values + 7 * model->parameter_count;
    double *quantity_change = values + 8 * model->parameter_count;
    double quantity_median;
    double replay_median;
    double projection_coefficient;
    double projection_pre;
    double projection_post;
    double removed_fraction;
    uint64_t digest_before;
    uint64_t digest_after;
    size_t offset;
    int projection_applied;
    int group;
    int sample;
    FILE *audit;
    char number[32];

    state.parameter_total = model_parameter_total(model);
    state.learned_before = zero_alloc(3 * state.parameter_total, sizeof(float));
    state.batch_gradient = zero_alloc(state.parameter_total, sizeof(float));
    state.replay_gradient = zero_alloc(state.parameter_total, sizeof(float));
    profile.count = model->parameter_count;
    profile.coefficient = zero_alloc((size_t)profile.count, sizeof(float));
    digest_before = model_learned_state_digest(model);
    transaction_copy_learned_from_model(&state, model);

    for (sample = 0; sample < options->samples; ++sample) {
        q28_training_gradient(model, corpus, &ranges[6], mask, sample,
                              options->samples);
        offset = 0;
        for (group = 0; group < model->parameter_count; ++group) {
            const Parameter *parameter = model->parameters[group];
            size_t element;
            for (element = 0; element < parameter->count; ++element) {
                state.batch_gradient[offset + element] +=
                    parameter->g[element] / options->samples;
            }
            offset += parameter->count;
        }
    }
    for (group = 0; group < 6; ++group) {
        for (sample = 0; sample < options->samples; ++sample) {
            int parameter_index;
            q28_training_gradient(model, corpus, &ranges[group], mask, sample,
                                  options->samples);
            offset = 0;
            for (parameter_index = 0;
                 parameter_index < model->parameter_count;
                 ++parameter_index) {
                const Parameter *parameter = model->parameters[parameter_index];
                size_t element;
                for (element = 0; element < parameter->count; ++element) {
                    state.replay_gradient[offset + element] +=
                        parameter->g[element];
                }
                offset += parameter->count;
            }
        }
    }
    for (offset = 0; offset < state.parameter_total; ++offset) {
        state.replay_gradient[offset] /= 6 * options->samples;
    }
    offset = 0;
    for (group = 0; group < model->parameter_count; ++group) {
        const Parameter *parameter = model->parameters[group];
        double q2 = 0.0;
        double r2 = 0.0;
        double dot = 0.0;
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double q = state.batch_gradient[offset + element];
            double r = state.replay_gradient[offset + element];
            q2 += q * q;
            r2 += r * r;
            dot += q * r;
        }
        quantity_energy[group] = q2 / parameter->count;
        replay_energy[group] = r2 / parameter->count;
        alignment[group] = q2 > 0.0 && r2 > 0.0
                               ? dot / sqrt(q2 * r2) : NAN;
        offset += parameter->count;
    }
    quantity_median = q28_median(quantity_energy, model->parameter_count);
    replay_median = q28_median(replay_energy, model->parameter_count);
    for (group = 0; group < model->parameter_count; ++group) {
        double novelty = quantity_energy[group] / quantity_median;
        double preservation = replay_energy[group] / replay_median;
        profile.coefficient[group] = (float)(Q28_MIN_PLASTICITY +
            (1.0 - Q28_MIN_PLASTICITY) * novelty /
            (novelty + preservation + epsilon));
    }
    profile.digest = q28_profile_digest(model, profile.coefficient);

    transaction_restore_gradient(model, state.batch_gradient);
    (void)optimizer_update(model, 1, 0.00002f, 0.01f, 1.0f, 1.0f);
    {
        size_t learned = 0;
        for (group = 0; group < model->parameter_count; ++group) {
            const Parameter *parameter = model->parameters[group];
            size_t element;
            double norm = 0.0;
            for (element = 0; element < parameter->count; ++element) {
                double delta = parameter->w[element] -
                               state.learned_before[learned + element];
                norm += delta * delta;
            }
            optimizer_delta[group] = sqrt(norm);
            learned += 3 * parameter->count;
        }
    }
    q28_apply_candidate(&state, model, &profile);
    {
        size_t learned = 0;
        offset = 0;
        for (group = 0; group < model->parameter_count; ++group) {
            const Parameter *parameter = model->parameters[group];
            size_t element;
            double norm = 0.0;
            for (element = 0; element < parameter->count; ++element) {
                double delta = parameter->w[element] -
                               state.learned_before[learned + element];
                norm += delta * delta;
                scaled_drift[group] +=
                    state.replay_gradient[offset + element] * delta;
            }
            scaled_delta[group] = sqrt(norm);
            offset += parameter->count;
            learned += 3 * parameter->count;
        }
    }
    q28_project_candidate(&state, model, &profile, &projection_applied,
                          &projection_coefficient, &projection_pre,
                          &projection_post, &removed_fraction);
    {
        size_t learned = 0;
        offset = 0;
        for (group = 0; group < model->parameter_count; ++group) {
            const Parameter *parameter = model->parameters[group];
            size_t element;
            double norm = 0.0;
            for (element = 0; element < parameter->count; ++element) {
                double delta = parameter->w[element] -
                               state.learned_before[learned + element];
                norm += delta * delta;
                projected_drift[group] +=
                    state.replay_gradient[offset + element] * delta;
                quantity_change[group] +=
                    state.batch_gradient[offset + element] * delta;
            }
            projected_delta[group] = sqrt(norm);
            offset += parameter->count;
            learned += 3 * parameter->count;
        }
    }
    transaction_restore_learned(model, &state);
    model_zero_grad(model);
    digest_after = model_learned_state_digest(model);
    if (digest_after != digest_before || !q28_learned_matches(&state, model)) {
        fail("shadow audit mutated learned state");
    }
    q28_write_profile(options->profile_path, model, &profile);
    audit = fopen(options->audit_path, "w");
    if (audit == NULL) fail_path("open plasticity audit", options->audit_path);
    fprintf(audit,
            "{\n  \"schema\": \"zero.graded_plasticity_shadow_audit.v1\",\n"
            "  \"training_only\": true,\n  \"updates_committed\": 0,\n"
            "  \"replay_training_ranges\": 6,\n"
            "  \"deterministic_samples_per_range\": %d,\n"
            "  \"coefficient_formula\": \"p_g = 0.05 + 0.95 * N_g / (N_g + O_g + epsilon)\",\n"
            "  \"epsilon\": %.17g,\n"
            "  \"quantity_energy_median\": %.17g,\n"
            "  \"replay_energy_median\": %.17g,\n"
            "  \"profile_digest_fnv1a64\": \"%016llx\",\n"
            "  \"learned_state_digest_before\": \"%016llx\",\n"
            "  \"learned_state_digest_after\": \"%016llx\",\n"
            "  \"weights_and_optimizer_byte_identical\": true,\n"
            "  \"projection\": {\n    \"applied\": %s,\n"
            "    \"coefficient\": %.17g,\n    \"pre_dot\": %.17g,\n"
            "    \"post_dot\": %.17g,\n"
            "    \"removed_fraction\": %.17g\n  },\n"
            "  \"groups\": [\n",
            options->samples, epsilon, quantity_median, replay_median,
            (unsigned long long)profile.digest,
            (unsigned long long)digest_before,
            (unsigned long long)digest_after,
            projection_applied ? "true" : "false", projection_coefficient,
            projection_pre, projection_post, removed_fraction);
    for (group = 0; group < model->parameter_count; ++group) {
        fprintf(audit,
                "    {\"name\": \"%s\", \"parameters\": %zu, "
                "\"quantity_gradient_energy\": %.17g, "
                "\"replay_gradient_energy\": %.17g, "
                "\"gradient_alignment\": %s, \"plasticity\": %.9g, "
                "\"optimizer_delta_norm\": %.17g, "
                "\"scaled_delta_norm\": %.17g, "
                "\"scaled_replay_drift\": %.17g, "
                "\"projected_delta_norm\": %.17g, "
                "\"predicted_replay_drift\": %.17g, "
                "\"predicted_quantity_loss_change\": %.17g}%s\n",
                model->parameters[group]->name,
                model->parameters[group]->count, quantity_energy[group],
                replay_energy[group], json_number(alignment[group], number),
                profile.coefficient[group], optimizer_delta[group],
                scaled_delta[group], scaled_drift[group], projected_delta[group],
                projected_drift[group], quantity_change[group],
                group + 1 == model->parameter_count ? "" : ",");
    }
    fputs("  ]\n}\n", audit);
    if (fclose(audit) != 0) fail_path("close plasticity audit", options->audit_path);
    printf("Q2.8 audit wrote %s and %s; learned state unchanged %016llx\n",
           options->audit_path, options->profile_path,
           (unsigned long long)digest_after);
    free(profile.coefficient);
    free(values);
    free(mask);
    free(state.replay_gradient);
    free(state.batch_gradient);
    free(state.learned_before);
}

static int q28_self_test(void)
{
    Config cfg = {4, 8, 2, 1, 16, 1, DEFAULT_VOCAB_SIZE};
    Rng rng;
    Model model;
    TransactionState state = {0};
    Q28Profile profile = {0};
    uint64_t before;
    size_t offset = 0;
    int group;
    int applied;
    double coefficient;
    double pre;
    double post;
    double removed;
    rng_seed(&rng, 17);
    model_create(&model, cfg, &rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    state.parameter_total = model_parameter_total(&model);
    state.learned_before = zero_alloc(3 * state.parameter_total, sizeof(float));
    state.replay_gradient = zero_alloc(state.parameter_total, sizeof(float));
    profile.count = model.parameter_count;
    profile.coefficient = zero_alloc((size_t)profile.count, sizeof(float));
    for (group = 0; group < model.parameter_count; ++group) {
        Parameter *parameter = model.parameters[group];
        size_t element;
        profile.coefficient[group] = 0.05f + 0.9f *
            (float)(group + 1) / model.parameter_count;
        for (element = 0; element < parameter->count; ++element) {
            parameter->g[element] = 0.001f * (float)(1 + element % 5);
            state.replay_gradient[offset + element] = -parameter->g[element];
        }
        offset += parameter->count;
    }
    transaction_copy_learned_from_model(&state, &model);
    before = model_learned_state_digest(&model);
    (void)optimizer_update(&model, 1, 0.001f, 0.01f, 1.0f, 1.0f);
    q28_apply_candidate(&state, &model, &profile);
    q28_project_candidate(&state, &model, &profile, &applied, &coefficient,
                          &pre, &post, &removed);
    if (!applied || coefficient <= 0.0 || pre <= 0.0 ||
        fabs(post) > 1.0e-5 * (1.0 + fabs(pre)) || removed <= 0.0) {
        fail("Q2.8 weighted projection self-test failed");
    }
    transaction_restore_learned(&model, &state);
    if (model_learned_state_digest(&model) != before ||
        !q28_learned_matches(&state, &model)) {
        fail("Q2.8 rollback self-test failed");
    }
    free(profile.coefficient);
    free(state.replay_gradient);
    free(state.learned_before);
    model_destroy(&model);
    puts("Q2.8 graded-plasticity audit mechanics self-test passed");
    return 1;
}

#ifndef Q28_AUDIT_NO_MAIN
int main(int argc, char **argv)
{
    Q28AuditOptions options = {0};
    Config cfg = preset_config("literary");
    Rng rng;
    Model model;
    Tokenizer tokenizer = {0};
    Corpus corpus = {0};
    CorpusRange ranges[7];
    int index;
    options.samples = 4;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        return run_self_test() && q28_self_test() ? 0 : 1;
    }
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) fail("incomplete audit option");
        if (strcmp(argv[index], "--init") == 0)
            options.init_path = argv[++index];
        else if (strcmp(argv[index], "--quantity") == 0)
            options.quantity_path = argv[++index];
        else if (strcmp(argv[index], "--audit-json") == 0)
            options.audit_path = argv[++index];
        else if (strcmp(argv[index], "--profile-out") == 0)
            options.profile_path = argv[++index];
        else if (strcmp(argv[index], "--samples") == 0)
            options.samples = (int)parse_long(argv[++index], "--samples");
        else fail("unknown audit option");
    }
    if (options.init_path == NULL || options.quantity_path == NULL ||
        options.audit_path == NULL || options.profile_path == NULL ||
        options.samples < 1 || options.samples > 16) {
        fail("audit requires init, quantity, outputs, and 1..16 samples");
    }
    if (strstr(options.quantity_path, "public") != NULL ||
        strstr(options.quantity_path, "promotion") != NULL ||
        strstr(options.quantity_path, "blimp") != NULL ||
        strstr(options.quantity_path, "tinystories") != NULL) {
        fail("forbidden evaluation input supplied to audit");
    }
    tokenizer_load(&tokenizer, "corpus/literary.bpe");
    rng_seed(&rng, 0);
    model_create(&model, cfg, &rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    (void)artifact_load_weights(options.init_path, &model);
    q28_load_corpus(&corpus, ranges, &options, &model, &tokenizer);
    q28_run_audit(&model, &corpus, ranges, &options);
    q28_destroy_ranges(ranges);
    corpus_destroy(&corpus);
    model_destroy(&model);
    return 0;
}
#endif
