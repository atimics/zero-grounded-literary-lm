#define main zero5_c32_embedded_main
#include "zero5_c32_lm.c"
#undef main

/* HT1 uses the frozen C5.1 model, grouped batch worker, and AdamW code. */
#define HT1_BASE 264
#define HT1_VOCAB 512
#define HT1_GATES 249

typedef struct {
    Tokenizer tokenizer;
    unsigned depth[HT1_VOCAB];
    uint64_t bytes[HT1_VOCAB];
    Parameter gates;
    float *composition;
    float *effective;
    float *adjoint;
    float *ordinary;
    int dim;
    int gate_off;
    int bound;
} MergeTree;

static void ht1_create(MergeTree *tree, Model *model,
                       const Tokenizer *tokenizer, int gate_off)
{
    int token;
    size_t count = model->token_embedding.count;
    if (!tokenizer->loaded || !tokenizer->lossless_bytes ||
        tokenizer->base_tokens != HT1_BASE || tokenizer->vocab != HT1_VOCAB ||
        tokenizer->merge_count != HT1_VOCAB - HT1_BASE ||
        model->cfg.vocab != HT1_VOCAB) fail("HT1 requires byte-BPE512");
    memset(tree, 0, sizeof(*tree));
    tree->tokenizer = *tokenizer;
    tree->dim = model->cfg.dim;
    tree->gate_off = gate_off;
    tree->ordinary = model->token_embedding.w;
    parameter_create(&tree->gates, "merge_depth_gate", HT1_GATES, 0);
    tree->gates.trainable = !gate_off;
    tree->composition = zero_alloc(count, sizeof(float));
    tree->effective = zero_alloc(count, sizeof(float));
    tree->adjoint = zero_alloc(count, sizeof(float));
    for (token = 0; token < HT1_BASE; ++token) {
        tree->bytes[token] = ((token >= 1 && token <= 7) || token == 256)
                                 ? 0U : 1U;
    }
    for (token = HT1_BASE; token < HT1_VOCAB; ++token) {
        int merge = token - HT1_BASE;
        Token left = tokenizer->left[merge], right = tokenizer->right[merge];
        if (left >= token || right >= token ||
            tree->bytes[left] == 0U || tree->bytes[right] == 0U)
            fail("HT1 merge children must be earlier byte tokens");
        tree->depth[token] = 1U + (tree->depth[left] > tree->depth[right]
                                      ? tree->depth[left] : tree->depth[right]);
        if (tree->depth[token] >= HT1_GATES ||
            UINT64_MAX - tree->bytes[left] < tree->bytes[right])
            fail("HT1 merge depth or byte length exceeds its bound");
        tree->bytes[token] = tree->bytes[left] + tree->bytes[right];
    }
    /* Reserve a registry slot. Register gates only for optimizer and I/O. */
    model->parameters = resize_alloc(model->parameters,
        (size_t)model->parameter_count + 1U, sizeof(*model->parameters));
    model->parameters[model->parameter_count] = &tree->gates;
}

static void ht1_destroy(MergeTree *tree)
{
    if (tree->bound) fail("HT1 table must be released before cleanup");
    parameter_destroy(&tree->gates);
    free(tree->composition);
    free(tree->effective);
    free(tree->adjoint);
    memset(tree, 0, sizeof(*tree));
}

static void ht1_refresh(MergeTree *tree)
{
    int token, column;
    if (tree->gate_off) return;
    memcpy(tree->composition, tree->ordinary,
           (size_t)HT1_BASE * tree->dim * sizeof(float));
    for (token = HT1_BASE; token < HT1_VOCAB; ++token) {
        int merge = token - HT1_BASE;
        size_t left = (size_t)tree->tokenizer.left[merge] * tree->dim;
        size_t right = (size_t)tree->tokenizer.right[merge] * tree->dim;
        size_t row = (size_t)token * tree->dim;
        for (column = 0; column < tree->dim; ++column)
            tree->composition[row + column] =
                0.5f * (tree->composition[left + column] +
                        tree->composition[right + column]);
    }
    for (token = 0; token < HT1_VOCAB; ++token) {
        float gate = tree->gates.w[tree->depth[token]];
        size_t row = (size_t)token * tree->dim;
        for (column = 0; column < tree->dim; ++column) {
            /* Preserve every base bit when a gate is exactly zero. */
            tree->effective[row + column] = gate == 0.0f
                ? tree->ordinary[row + column]
                : tree->ordinary[row + column] +
                      gate * tree->composition[row + column];
        }
    }
}

static void ht1_bind(MergeTree *tree, Model *model,
                     PackedParallelBatch *parallel)
{
    int worker;
    if (tree->bound || model->token_embedding.w != tree->ordinary)
        fail("HT1 table ownership changed");
    ht1_refresh(tree);
    tree->bound = 1;
    model->token_embedding.w = tree->gate_off ? tree->ordinary : tree->effective;
    if (parallel != NULL) {
        for (worker = 1; worker < parallel->count; ++worker)
            parallel->models[worker]->token_embedding.w = model->token_embedding.w;
    }
}

static void ht1_release(MergeTree *tree, Model *model,
                        PackedParallelBatch *parallel)
{
    int worker;
    if (!tree->bound) fail("HT1 table must be bound before release");
    model->token_embedding.w = tree->ordinary;
    if (parallel != NULL) {
        for (worker = 1; worker < parallel->count; ++worker)
            parallel->models[worker]->token_embedding.w = tree->ordinary;
    }
    tree->bound = 0;
}

static void ht1_backward(MergeTree *tree, Model *model)
{
    int token, column;
    float *gradient = model->token_embedding.g;
    if (tree->bound) fail("HT1 gradients require the ordinary table");
    memset(tree->gates.g, 0, HT1_GATES * sizeof(float));
    if (tree->gate_off) return;
    for (token = 0; token < HT1_VOCAB; ++token) {
        unsigned depth = tree->depth[token];
        size_t row = (size_t)token * tree->dim;
        double gate_gradient = 0.0;
        for (column = 0; column < tree->dim; ++column) {
            size_t index = row + column;
            gate_gradient += (double)gradient[index] * tree->composition[index];
            tree->adjoint[index] = tree->gates.w[depth] * gradient[index];
        }
        tree->gates.g[depth] += (float)gate_gradient;
    }
    for (token = HT1_VOCAB - 1; token >= HT1_BASE; --token) {
        int merge = token - HT1_BASE;
        size_t row = (size_t)token * tree->dim;
        size_t left = (size_t)tree->tokenizer.left[merge] * tree->dim;
        size_t right = (size_t)tree->tokenizer.right[merge] * tree->dim;
        for (column = 0; column < tree->dim; ++column) {
            float child_gradient = 0.5f * tree->adjoint[row + column];
            tree->adjoint[left + column] += child_gradient;
            tree->adjoint[right + column] += child_gradient;
        }
    }
    for (token = 0; token < HT1_BASE; ++token) {
        for (column = 0; column < tree->dim; ++column) {
            size_t index = (size_t)token * tree->dim + column;
            /* Zero adjoints preserve the exact control accumulation. */
            if (tree->adjoint[index] != 0.0f) gradient[index] += tree->adjoint[index];
        }
    }
}

static float ht1_validation(MergeTree *tree, Model *model,
                             const PackedSet *set, int batches)
{
    float loss;
    ht1_bind(tree, model, NULL);
    loss = evaluate_packed(model, set, batches);
    ht1_release(tree, model, NULL);
    return loss;
}

/* A stable digest lets the artifact preflight compare every validation logit
   and loss bit after loading the two different checkpoint layouts. */
static void ht1_identity_evaluation(MergeTree *tree, Model *model,
                                    const PackedSet *set, int batches)
{
    float *mask = zero_alloc((size_t)set->context, sizeof(*mask));
    uint64_t hash = UINT64_C(1469598103934665603), active_total = 0;
    int sample;
    if (batches > (int)set->pack_count) batches = (int)set->pack_count;
    ht1_bind(tree, model, NULL);
    for (sample = 0; sample < batches; ++sample) {
        uint32_t pack = batches == 1
                            ? 0U
                            : (uint32_t)((uint64_t)sample *
                                         (set->pack_count - 1U) /
                                         (uint64_t)(batches - 1));
        size_t token_start = (size_t)pack * ((size_t)set->context + 1U);
        uint64_t active = packed_mask(set, pack, mask, 1.0f, 1.0f, 1.0f);
        float loss;
        if (active == 0U) continue;
        loss = model_forward_masked(model, set->tokens + token_start,
                                    set->tokens + token_start + 1U,
                                    0.0f, NULL, mask);
        hash = hash_bytes(hash, &pack, sizeof(pack));
        hash = hash_bytes(hash, &active, sizeof(active));
        hash = hash_bytes(hash, &loss, sizeof(loss));
        hash = hash_bytes(hash, model->probs,
                          (size_t)model->cfg.context * model->cfg.vocab *
                              sizeof(*model->probs));
        active_total += active;
    }
    ht1_release(tree, model, NULL);
    free(mask);
    if (active_total == 0U) fail("HT1 identity evaluation selected no targets");
    printf("{\"schema\":\"zero.ht1_identity_eval.v1\",\"batches\":%d,"
           "\"active_targets\":%llu,\"logits_and_loss_fnv1a64\":\"%016llx\"}\n",
           batches, (unsigned long long)active_total,
           (unsigned long long)hash);
}

/* All active targets count once, including structural targets with zero bytes. */
static void ht1_depth_evaluation(MergeTree *tree, Model *model,
                                 const PackedSet *set)
{
    uint64_t targets[3] = {0}, bytes[3] = {0}, structural[3] = {0};
    double nats[3] = {0};
    uint32_t pack, time;
    int band;
    ht1_bind(tree, model, NULL);
    for (pack = 0; pack < set->pack_count; ++pack) {
        const Token *tokens = set->tokens + (size_t)pack * (set->context + 1U);
        model_forward(model, tokens, tokens + 1, 0.0f, NULL);
        for (time = 0; time < set->context; ++time) {
            Token target = tokens[time + 1U];
            float probability;
            if (set->target_classes[(size_t)pack * set->context + time] == 0U)
                continue;
            band = tree->depth[target] < 2U ? (int)tree->depth[target] : 2;
            probability = model->probs[(size_t)time * model->cfg.vocab + target];
            if (!isfinite(probability) || probability < 0.0f || probability > 1.0f)
                fail("HT1 score must be a finite probability");
            nats[band] += -log(fmax((double)probability, 1.0e-20));
            ++targets[band];
            if (UINT64_MAX - bytes[band] < tree->bytes[target])
                fail("HT1 byte count exceeds its bound");
            bytes[band] += tree->bytes[target];
            structural[band] += tree->bytes[target] == 0U;
        }
    }
    ht1_release(tree, model, NULL);
    if (targets[0] + targets[1] + targets[2] != set->active_targets)
        fail("HT1 target accounting changed");
    printf("{\"schema\":\"zero.ht1_depth_eval.v1\",\"packs\":%u,\"bands\":[",
           set->pack_count);
    for (band = 0; band < 3; ++band) {
        printf("%s{\"depth\":\"%s\",\"targets\":%llu,\"raw_bytes\":%llu,"
               "\"structural_targets\":%llu,\"total_nats\":%.17g}",
               band == 0 ? "" : ",", band == 2 ? "2+" : (band == 1 ? "1" : "0"),
               (unsigned long long)targets[band], (unsigned long long)bytes[band],
               (unsigned long long)structural[band], nats[band]);
    }
    printf("]}\n");
}

static float ht1_learning_rate(const Options *options, uint64_t step)
{
    float rate = options->learning_rate;
    if (options->warmup > 0 && step <= (uint64_t)options->warmup)
        rate *= (float)step / options->warmup;
    if (options->steps > options->warmup && step > (uint64_t)options->warmup) {
        float progress = (float)(step - options->warmup) /
                         (float)(options->steps - options->warmup);
        rate *= 0.5f * (1.0f + cosf(3.14159265358979323846f * progress));
    }
    return rate;
}

static void ht1_save(const char *path, Model *model, uint64_t step,
                     const Rng *rng, uint64_t best_step, float best_loss,
                     const Options *options)
{
    ++model->parameter_count;
    packed_checkpoint_save(path, model, step, rng, step, best_step,
                           best_loss, options);
    --model->parameter_count;
}

static void ht1_train(MergeTree *tree, Model *model, Rng *rng,
                      uint64_t *step, const PackedSet *train,
                      const PackedSet *validation, const Options *options,
                      const CheckpointOrchestrationV6 *resume)
{
    PackedParallelBatch parallel;
    uint64_t attempts = 0, sequences = 0, active = 0, best_step = 0;
    double loss_sum = 0.0, started = wall_seconds();
    float best_loss = INFINITY;
    uint32_t group;
    if (train->update_offsets == NULL || train->update_count != options->steps)
        fail("HT1 requires the complete grouped schedule");
    for (group = 0; group < train->update_count; ++group) {
        if (packed_update_size(train, group, options->batch) > (uint32_t)options->batch)
            fail("HT1 group exceeds batch capacity");
    }
    if (*step > (uint64_t)options->steps) fail("HT1 cursor exceeds schedule");
    if (resume != NULL) {
        best_loss = resume->packed_best_validation;
        best_step = resume->packed_best_update;
    }
    packed_parallel_create(&parallel, model, options->parallel_batch);
    signal(SIGINT, on_interrupt);
    signal(SIGTERM, on_interrupt);
    while (*step < (uint64_t)options->steps && !interrupted &&
           (options->max_run_steps == 0 || attempts < (uint64_t)options->max_run_steps)) {
        uint32_t first = packed_update_start(train, *step, options->batch);
        uint32_t count = packed_update_size(train, *step, options->batch);
        float gradient_norm, rate = ht1_learning_rate(options, *step + 1U);
        ht1_bind(tree, model, &parallel);
        packed_parallel_train_update(&parallel, rng, train, first, (int)count,
                                     options, &loss_sum, &sequences, &active);
        ht1_release(tree, model, &parallel);
        ht1_backward(tree, model);
        ++model->parameter_count;
        gradient_norm = packed_parallel_optimizer_update(&parallel, *step + 1U,
            rate, options->weight_decay, options->clip, 1.0f / count);
        --model->parameter_count;
        if (!isfinite(gradient_norm)) fail("HT1 gradient norm must be finite");
        ++*step;
        ++attempts;
        if (*step % options->report_every == 0U || *step == (uint64_t)options->steps) {
            float validation_loss = ht1_validation(tree, model, validation,
                                                    options->validation_batches);
            printf("update %llu train %.9g val %.9g grad %.9g lr %.9g\n",
                   (unsigned long long)*step, sequences ? loss_sum / sequences : 0.0,
                   validation_loss, gradient_norm, rate);
            if (validation_loss < best_loss - 1.0e-5f) {
                best_loss = validation_loss;
                best_step = *step;
                if (options->best_path != NULL)
                    ht1_save(options->best_path, model, *step, rng,
                             best_step, best_loss, options);
            }
            loss_sum = 0.0;
            sequences = active = 0;
            fflush(stdout);
        }
        if (options->save_path != NULL && options->save_every > 0 &&
            *step % options->save_every == 0U)
            ht1_save(options->save_path, model, *step, rng,
                     best_step, best_loss, options);
    }
    if (options->save_path != NULL && attempts > 0U)
        ht1_save(options->save_path, model, *step, rng, best_step, best_loss, options);
    printf("{\"schema\":\"zero.ht1_training_progress.v1\",\"updates\":%llu,"
           "\"next_pack\":%u,\"compute_token_exposures\":%llu,\"wraps\":0,"
           "\"attempt_seconds\":%.9g}\n", (unsigned long long)*step,
           packed_update_start(train, *step, options->batch),
           (unsigned long long)packed_update_start(train, *step, options->batch) *
               train->context, wall_seconds() - started);
    packed_parallel_destroy(&parallel);
}

static int ht1_self_test(void);

int main(int argc, char **argv)
{
    Options options = {0};
    Tokenizer tokenizer = {0};
    Model model;
    MergeTree tree;
    Rng rng;
    Config cfg;
    CheckpointOrchestrationV6 resume = {0};
    const char *depth_path = NULL, *identity_path = NULL, *text_path = NULL;
    uint64_t step = 0, attempts = 0;
    uint32_t rejections = 0, transaction = 0;
    int i, gate_off = 0, extended = 0, training;
    options.steps = 28707;
    options.batch = options.parallel_batch = 2;
    options.tensor_batch = 1;
    options.learning_rate = 0.0003f;
    options.weight_decay = 0.01f;
    options.clip = 1.0f;
    options.warmup = 1000;
    options.report_every = 500;
    options.validation_batches = 64;
    options.dropout = 0.1f;
    options.claim_answer_weight = 2.229423406f;
    options.cloze_answer_weight = 5.253416128f;
    options.retrieval_answer_weight = 1.429401038f;
    for (i = 1; i < argc; ++i) {
        const char *key = argv[i], *value;
        if (strcmp(key, "--self-test") == 0) return ht1_self_test();
        if (strcmp(key, "--gate-off") == 0) { gate_off = 1; continue; }
        if (strcmp(key, "--eval-only") == 0) { options.eval_only = 1; continue; }
        if (strcmp(key, "--help") == 0) {
            puts("HT1: --init/--resume FILE --tokenizer FILE\n"
                 "  --depth-eval PACKS | --identity-eval PACKS | --completion-eval FILE\n"
                 "  --span-choice-eval FILE\n"
                 "  --packed-validation PACKS --eval-only [--validation N]\n"
                 "  --validation-text TOKENS --eval-only [--validation N]\n"
                 "  --packed-train PACKS --packed-validation PACKS --run-contract-sha256 HASH\n"
                 "  --save FILE --best FILE [--max-run-steps N] [--gate-off]\n"
                 "  --self-test");
            return 0;
        }
        if (++i >= argc) fail("HT1 option requires a value");
        value = argv[i];
#define HT1_PATH(flag, member) if (strcmp(key, flag) == 0) options.member = value
#define HT1_LONG(flag, member) if (strcmp(key, flag) == 0) options.member = parse_long(value, key)
#define HT1_FLOAT(flag, member) if (strcmp(key, flag) == 0) options.member = parse_float(value, key)
        HT1_PATH("--init", init_path);
        else HT1_PATH("--resume", resume_path);
        else HT1_PATH("--tokenizer", tokenizer_path);
        else HT1_PATH("--packed-train", packed_train_path);
        else HT1_PATH("--packed-validation", packed_validation_path);
        else HT1_PATH("--completion-eval", completion_eval_path);
        else HT1_PATH("--span-choice-eval", span_choice_eval_path);
        else HT1_PATH("--paired-eval", paired_eval_path);
        else HT1_PATH("--save", save_path);
        else HT1_PATH("--best", best_path);
        else HT1_PATH("--run-contract-sha256", run_contract_sha256);
        else HT1_PATH("--require-math-backend", required_math_backend);
        else HT1_PATH("--require-attention-backend", required_attention_backend);
        else HT1_LONG("--steps", steps);
        else HT1_LONG("--batch", batch);
        else HT1_LONG("--parallel-batch", parallel_batch);
        else HT1_LONG("--seed", seed);
        else HT1_LONG("--warmup", warmup);
        else HT1_LONG("--report", report_every);
        else HT1_LONG("--validation", validation_batches);
        else HT1_LONG("--save-every", save_every);
        else HT1_LONG("--max-run-steps", max_run_steps);
        else HT1_FLOAT("--lr", learning_rate);
        else HT1_FLOAT("--weight-decay", weight_decay);
        else HT1_FLOAT("--clip", clip);
        else HT1_FLOAT("--dropout", dropout);
        else HT1_FLOAT("--claim-answer-weight", claim_answer_weight);
        else HT1_FLOAT("--cloze-answer-weight", cloze_answer_weight);
        else HT1_FLOAT("--retrieval-answer-weight", retrieval_answer_weight);
        else if (strcmp(key, "--depth-eval") == 0) depth_path = value;
        else if (strcmp(key, "--identity-eval") == 0) identity_path = value;
        else if (strcmp(key, "--validation-text") == 0) text_path = value;
        else if (strcmp(key, "--text") == 0) { /* C4.3 scorer supplies train text too. */ }
        else fail("unknown HT1 option");
#undef HT1_PATH
#undef HT1_LONG
#undef HT1_FLOAT
    }
    training = options.packed_train_path != NULL && !options.eval_only;
    if ((options.init_path == NULL) == (options.resume_path == NULL) ||
        options.tokenizer_path == NULL) fail("HT1 requires one model and a tokenizer");
    if (options.steps <= 0 || options.batch < 1 || options.batch > 2 ||
        options.parallel_batch < 1 || options.parallel_batch > 2 ||
        options.report_every < 1 || options.validation_batches < 1 ||
        options.warmup < 0 || options.max_run_steps < 0 || options.save_every < 0 ||
        options.dropout < 0.0f || options.dropout >= 1.0f ||
        options.learning_rate <= 0.0f || options.weight_decay < 0.0f ||
        options.clip <= 0.0f || options.claim_answer_weight <= 0.0f ||
        options.cloze_answer_weight <= 0.0f || options.retrieval_answer_weight <= 0.0f)
        fail("HT1 numeric options exceed their bounds");
    if (training && (options.packed_validation_path == NULL ||
        options.run_contract_sha256 == NULL || !valid_sha256(options.run_contract_sha256)))
        fail("HT1 training requires validation and a bound contract hash");
    if (options.required_math_backend != NULL &&
        strcmp(options.required_math_backend, math_backend_name()) != 0)
        fail("HT1 math backend differs from the requested backend");
    if (options.required_attention_backend != NULL &&
        strcmp(options.required_attention_backend, attention_backend_name()) != 0)
        fail("HT1 attention backend differs from the requested backend");
    cfg = artifact_peek(options.init_path ? options.init_path : options.resume_path);
    validate_config(&cfg);
    tokenizer_load(&tokenizer, options.tokenizer_path);
    {
        FILE *file = fopen(options.tokenizer_path, "rb");
        if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
            ftell(file) != 24 + 4 * (HT1_VOCAB - HT1_BASE))
            fail("HT1 tokenizer requires an exact header and merge table");
        fclose(file);
    }
    rng_seed(&rng, (uint64_t)options.seed);
    model_create(&model, cfg, &rng);
    ht1_create(&tree, &model, &tokenizer, gate_off);
    {
        const char *path = options.init_path ? options.init_path : options.resume_path;
        FILE *file = fopen(path, "rb");
        int weight_only;
        CheckpointHeader header;
        if (file == NULL) fail_path("open HT1 model", path);
        header = artifact_read_header(file, path, &weight_only);
        fclose(file);
        extended = header.parameter_count == (uint32_t)model.parameter_count + 1U;
    }
    if (extended) ++model.parameter_count;
    if (options.resume_path != NULL) {
        if (!extended) fail("HT1 resume requires a gate-bearing checkpoint");
        step = checkpoint_load(options.resume_path, &model, &rng, &attempts,
                               &rejections, &transaction, &resume);
    } else {
        artifact_load_weights(options.init_path, &model);
        if (training && extended) fail("HT1 treatment starts from the C2 base model");
    }
    if (extended) --model.parameter_count;
    if (gate_off) memset(tree.gates.w, 0, HT1_GATES * sizeof(float));
    if (training && options.resume_path != NULL &&
        (resume.packed_mode != 1U || transaction != 0U || rejections != 0U ||
         resume.packed_batch != (uint32_t)options.batch ||
         resume.reserved != (options.parallel_batch > 1 ? (uint32_t)options.parallel_batch : 0U) ||
         resume.packed_total_steps != (uint64_t)options.steps ||
         resume.packed_completed_steps != step || attempts != step ||
         resume.math_backend != math_backend_id() ||
         resume.attention_backend != attention_backend_id() ||
         memcmp(resume.run_contract_sha256, options.run_contract_sha256, 64U) != 0))
        fail("HT1 resume requires matching schedule, cursor, backend, and contract");
    if (training) {
        PackedSet train = {0}, validation = {0};
        packed_set_load(&train, options.packed_train_path, &cfg);
        packed_set_load(&validation, options.packed_validation_path, &cfg);
        ht1_train(&tree, &model, &rng, &step, &train, &validation, &options,
                  options.resume_path ? &resume : NULL);
        packed_set_destroy(&train);
        packed_set_destroy(&validation);
    } else {
        ht1_bind(&tree, &model, NULL);
        if (options.completion_eval_path)
            evaluate_completions(&model, options.completion_eval_path);
        if (options.span_choice_eval_path)
            evaluate_span_choices(&model, options.span_choice_eval_path);
        if (options.paired_eval_path)
            evaluate_paired_choices(&model, options.paired_eval_path);
        if (text_path) {
            Corpus corpus = {0};
            size_t position;
            corpus_add_file(&corpus, text_path, tokenizer.token_width);
            if (corpus.length <= (size_t)cfg.context) fail("HT1 retention input is too short");
            for (position = 0; position < corpus.length; ++position)
                if (corpus.data[position] >= cfg.vocab)
                    fail("HT1 retention token exceeds the vocabulary");
            printf("evaluation-only val %.9g batches=%d\n", evaluate(&model, corpus.data,
                   corpus.length, options.validation_batches), options.validation_batches);
            free(corpus.data);
        }
        ht1_release(&tree, &model, NULL);
        if (options.packed_validation_path) {
            PackedSet set = {0};
            packed_set_load(&set, options.packed_validation_path, &cfg);
            printf("packed-evaluation-only val %.9g batches=%d\n",
                   ht1_validation(&tree, &model, &set, options.validation_batches),
                   options.validation_batches);
            packed_set_destroy(&set);
        }
        if (depth_path) {
            PackedSet set = {0};
            packed_set_load(&set, depth_path, &cfg);
            ht1_depth_evaluation(&tree, &model, &set);
            packed_set_destroy(&set);
        }
        if (identity_path) {
            PackedSet set = {0};
            packed_set_load(&set, identity_path, &cfg);
            ht1_identity_evaluation(&tree, &model, &set,
                                    options.validation_batches);
            packed_set_destroy(&set);
        }
    }
    ht1_destroy(&tree);
    model_destroy(&model);
    return 0;
}

#include "tests/zero5_ht1_mergetree_test.h"
