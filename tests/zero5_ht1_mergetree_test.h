/* Tiny, synthetic mechanics checks; the experiment data stays separate. */
static void ht1_assert(int condition, const char *label)
{
    if (!condition) fail(label);
}

static Tokenizer ht1_test_tokenizer(void)
{
    Tokenizer tokenizer = {0};
    int merge;
    tokenizer.loaded = tokenizer.lossless_bytes = 1;
    tokenizer.base_tokens = HT1_BASE;
    tokenizer.vocab = HT1_VOCAB;
    tokenizer.merge_count = HT1_VOCAB - HT1_BASE;
    tokenizer.token_width = 2;
    tokenizer.document_token = 256;
    for (merge = 0; merge < tokenizer.merge_count; ++merge) {
        tokenizer.left[merge] = merge == 0 ? 'a' :
            (merge == 1 ? HT1_BASE : (Token)(8 + merge % 240));
        tokenizer.right[merge] = merge == 1 ? HT1_BASE : 'b';
    }
    return tokenizer;
}

static float ht1_test_loss(MergeTree *tree, Model *model,
                           const Token *tokens, const Token *targets, int backward)
{
    float loss;
    if (backward) model_zero_grad(model);
    ht1_bind(tree, model, NULL);
    loss = model_forward(model, tokens, targets, 0.0f, NULL);
    if (backward) model_backward(model, tokens, targets);
    ht1_release(tree, model, NULL);
    if (backward) ht1_backward(tree, model);
    return loss;
}

static int ht1_self_test(void)
{
    Config cfg = {4, 8, 2, 1, 16, 1, HT1_VOCAB};
    Tokenizer tokenizer = ht1_test_tokenizer();
    const Token tokens[4] = {'a', HT1_BASE, HT1_BASE + 1, 'b'};
    const Token targets[4] = {HT1_BASE, HT1_BASE + 1, 'b', 'a'};
    Model control, model;
    MergeTree tree;
    Rng control_rng, rng;
    int step, index;
    rng_seed(&control_rng, 0);
    rng_seed(&rng, 0);
    model_create(&control, cfg, &control_rng);
    model_create(&model, cfg, &rng);
    ht1_create(&tree, &model, &tokenizer, 1);
    ht1_assert(rng.state == control_rng.state, "HT1 initialization RNG identity");
    ht1_assert(tree.gates.count == HT1_GATES && tree.depth[265] == 2 &&
               tree.bytes[265] == 4 && tree.bytes[1] == 0 && tree.bytes[257] == 1,
               "HT1 parameter, depth, and byte counts");
    for (step = 1; step <= 10; ++step) {
        float control_loss, loss, norm, control_norm;
        model_zero_grad(&control);
        model_zero_grad(&model);
        control_loss = model_forward(&control, tokens, targets, 0.1f, &control_rng);
        ht1_bind(&tree, &model, NULL);
        loss = model_forward(&model, tokens, targets, 0.1f, &rng);
        ht1_assert(memcmp(&loss, &control_loss, sizeof(float)) == 0 &&
            memcmp(model.probs, control.probs,
                   (size_t)cfg.context * cfg.vocab * sizeof(float)) == 0,
            "HT1 gate-off output identity");
        model_backward(&control, tokens, targets);
        model_backward(&model, tokens, targets);
        ht1_release(&tree, &model, NULL);
        ht1_backward(&tree, &model);
        control_norm = optimizer_update(&control, step, .0003f, .01f, 1, 1, 1);
        ++model.parameter_count;
        norm = optimizer_update(&model, step, .0003f, .01f, 1, 1, 1);
        --model.parameter_count;
        ht1_assert(memcmp(&norm, &control_norm, sizeof(float)) == 0 &&
            model_learned_state_digest(&model) == model_learned_state_digest(&control) &&
            rng.state == control_rng.state, "HT1 ten-update shared-state identity");
    }
    tree.gate_off = 0;
    tree.gates.trainable = 1;
    /* Learned zero gates and fixed zero gates begin at the same function. */
    {
        float a = model_forward(&control, tokens, targets, 0, NULL);
        float b = ht1_test_loss(&tree, &model, tokens, targets, 1);
        ht1_assert(memcmp(&a, &b, sizeof(float)) == 0, "HT1 zero-gate identity");
        ht1_assert(tree.gates.g[0] != 0 || tree.gates.g[1] != 0 || tree.gates.g[2] != 0,
                   "HT1 gates receive gradients at zero");
    }
    tree.gates.w[0] = .12f;
    tree.gates.w[1] = -.23f;
    tree.gates.w[2] = .31f;
    ht1_test_loss(&tree, &model, tokens, targets, 1);
    for (index = 0; index < 15; ++index) {
        size_t cell = index < 3 ? (size_t)index :
            (size_t)(index < 9 ? 'a' : HT1_BASE + 1) * cfg.dim + (index % 6);
        Parameter *parameter = index < 3 ? &tree.gates : &model.token_embedding;
        float original = parameter->w[cell], analytic = parameter->g[cell];
        float plus, minus, numeric;
        parameter->w[cell] = original + .001f;
        plus = ht1_test_loss(&tree, &model, tokens, targets, 0);
        parameter->w[cell] = original - .001f;
        minus = ht1_test_loss(&tree, &model, tokens, targets, 0);
        parameter->w[cell] = original;
        numeric = (plus - minus) / .002f;
        ht1_assert(isfinite(analytic) && isfinite(numeric) &&
            fabsf(analytic - numeric) <= .002f + .08f * (fabsf(analytic) + fabsf(numeric)),
            "HT1 finite-difference gradient check");
    }
    /* The repeated child receives two half-adjoints at each merge. */
    model_zero_grad(&model);
    ht1_refresh(&tree);
    model.token_embedding.g[(size_t)265 * cfg.dim] = 1;
    ht1_backward(&tree, &model);
    ht1_assert(fabsf(model.token_embedding.g[(size_t)'a' * cfg.dim] - .155f) < 1e-6f &&
               fabsf(model.token_embedding.g[(size_t)'b' * cfg.dim] - .155f) < 1e-6f,
               "HT1 descendant and repeated-child gradients");
    {
        Token altered[4];
        float prefix[2 * HT1_VOCAB];
        memcpy(altered, tokens, sizeof(tokens));
        ht1_test_loss(&tree, &model, tokens, targets, 0);
        memcpy(prefix, model.probs, sizeof(prefix));
        altered[2] = 'q'; altered[3] = 'x';
        ht1_test_loss(&tree, &model, altered, targets, 0);
        ht1_assert(memcmp(prefix, model.probs, sizeof(prefix)) == 0,
                   "HT1 future-token causality");
    }
    ++model.parameter_count;
    ht1_assert(model_parameter_total(&model) == model_parameter_total(&control) + HT1_GATES,
               "HT1 total parameter count");
    --model.parameter_count;
    ht1_destroy(&tree);
    model_destroy(&model);
    model_destroy(&control);
    puts("HT1 MergeTree self-test passed: ten-update identity, gradients, tying, causality");
    return 0;
}
