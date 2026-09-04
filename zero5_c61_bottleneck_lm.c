#define main zero5_c32_embedded_main
#include "zero5_c32_lm.c"
#undef main

/*
 * C6.1 Shared-State Bottleneck runner.
 *
 * The frozen C3.2 trainer is included unchanged.  This translation unit adds
 * a 152-wide state bottleneck which is shared by a factorized state decoder
 * and a zero-initialized answer-token adapter.  The language checkpoint keeps
 * the established format; the bottleneck and its AdamW state live in a paired
 * .aux checkpoint.
 */

#define AUX_MAGIC "Z5AUX1\0"
#define AUX_HEAD_MAGIC "Z5SBV1\0"
#define AUX_EVAL_MAGIC "Z5AUEV1\0"
#define AUX_VERSION 1U
#define BOTTLENECK_WIDTH 152

typedef struct {
    uint16_t position;
    uint16_t tag;
    uint16_t family;
    uint16_t reserved;
} AuxEvent;

typedef struct {
    uint32_t vocab;
    uint32_t context;
    uint32_t pack_count;
    uint32_t target_count;
    uint32_t family_count;
    uint32_t *pack_offsets;
    uint32_t *family_offsets;
    uint16_t *family_tags;
    AuxEvent *events;
} AuxTargetSet;

typedef struct {
    Parameter down;
    Parameter down_bias;
    Parameter factor_output;
    Parameter factor_bias;
    Parameter bridge_output;
    float *adapted_hidden;
    float *bottleneck;
    float *bottleneck_gradient;
    float *logits;
    int vocab;
    int dim;
    int width;
} AuxHead;

typedef struct {
    const char *init_path;
    const char *resume_path;
    const char *train_path;
    const char *validation_path;
    const char *aux_path;
    const char *eval_path;
    const char *head_path;
    const char *best_path;
    const char *save_path;
    const char *contract_sha256;
    const char *scientific_contract_sha256;
    long steps;
    int batch;
    int parallel_batch;
    float learning_rate;
    float weight_decay;
    float clip;
    long warmup;
    long report_every;
    int validation_batches;
    float dropout;
    float auxiliary_weight;
    float bridge_scale;
    float claim_answer_weight;
    float cloze_answer_weight;
    float retrieval_answer_weight;
    long seed;
    long save_every;
    long max_run_steps;
    int eval_only;
    int bridge_off;
    int self_test;
    const char *completion_eval_path;
    const char *span_choice_eval_path;
    const char *packed_eval_path;
} AuxOptions;

typedef struct {
    double loss;
    uint64_t events;
    uint64_t correct;
} AuxScore;

static size_t aux_parameter_total(const AuxHead *head)
{
    return head->down.count + head->down_bias.count +
        head->factor_output.count + head->factor_bias.count +
        head->bridge_output.count;
}

static void aux_read_exact(FILE *file, void *value, size_t bytes,
                           const char *path)
{
    if (fread(value, 1, bytes, file) != bytes) {
        fail_path("read auxiliary artifact from", path);
    }
}

static uint32_t aux_read_u32(FILE *file, const char *path)
{
    unsigned char b[4];
    aux_read_exact(file, b, sizeof(b), path);
    return (uint32_t)b[0] | ((uint32_t)b[1] << 8) |
           ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

static uint64_t aux_read_u64(FILE *file, const char *path)
{
    uint64_t low = aux_read_u32(file, path);
    return low | ((uint64_t)aux_read_u32(file, path) << 32);
}

static void aux_write_u32(FILE *file, uint32_t value, const char *path)
{
    unsigned char b[4] = {(unsigned char)value, (unsigned char)(value >> 8),
        (unsigned char)(value >> 16), (unsigned char)(value >> 24)};
    if (fwrite(b, 1, sizeof(b), file) != sizeof(b)) {
        fail_path("write auxiliary checkpoint", path);
    }
}

static void aux_write_u64(FILE *file, uint64_t value, const char *path)
{
    aux_write_u32(file, (uint32_t)value, path);
    aux_write_u32(file, (uint32_t)(value >> 32), path);
}

static void aux_target_load(AuxTargetSet *set, const char *path,
                            const Config *cfg)
{
    unsigned char magic[8];
    FILE *file = fopen(path, "rb");
    uint32_t i;
    if (file == NULL) fail_path("open auxiliary targets", path);
    memset(set, 0, sizeof(*set));
    aux_read_exact(file, magic, sizeof(magic), path);
    if (memcmp(magic, AUX_MAGIC, sizeof(magic)) != 0 ||
        aux_read_u32(file, path) != AUX_VERSION) {
        fail("unsupported or corrupt auxiliary targets");
    }
    set->vocab = aux_read_u32(file, path);
    set->context = aux_read_u32(file, path);
    set->pack_count = aux_read_u32(file, path);
    set->target_count = aux_read_u32(file, path);
    set->family_count = aux_read_u32(file, path);
    if (set->vocab == 0U || set->vocab > 65535U ||
        set->context != (uint32_t)cfg->context || set->pack_count == 0U ||
        set->target_count == 0U || set->family_count == 0U ||
        set->family_count > set->vocab) {
        fail("auxiliary target contract does not match the model");
    }
    set->pack_offsets = zero_alloc((size_t)set->pack_count + 1U,
                                   sizeof(*set->pack_offsets));
    set->family_offsets = zero_alloc((size_t)set->family_count + 1U,
                                     sizeof(*set->family_offsets));
    set->family_tags = zero_alloc(set->vocab, sizeof(*set->family_tags));
    set->events = zero_alloc(set->target_count, sizeof(*set->events));
    for (i = 0; i <= set->pack_count; ++i) {
        set->pack_offsets[i] = aux_read_u32(file, path);
        if ((i == 0U && set->pack_offsets[i] != 0U) ||
            (i > 0U && set->pack_offsets[i] < set->pack_offsets[i - 1U]) ||
            set->pack_offsets[i] > set->target_count) {
            fail("invalid auxiliary pack offsets");
        }
    }
    if (set->pack_offsets[set->pack_count] != set->target_count) {
        fail("auxiliary pack offsets do not consume all targets");
    }
    for (i = 0; i <= set->family_count; ++i) {
        set->family_offsets[i] = aux_read_u32(file, path);
        if ((i == 0U && set->family_offsets[i] != 0U) ||
            (i > 0U && set->family_offsets[i] <=
                         set->family_offsets[i - 1U]) ||
            set->family_offsets[i] > set->vocab) {
            fail("invalid auxiliary family offsets");
        }
    }
    if (set->family_offsets[set->family_count] != set->vocab) {
        fail("auxiliary families do not cover the declared vocabulary");
    }
    aux_read_exact(file, set->family_tags,
                   (size_t)set->vocab * sizeof(*set->family_tags), path);
    aux_read_exact(file, set->events,
                   (size_t)set->target_count * sizeof(*set->events), path);
    if (fgetc(file) != EOF || fclose(file) != 0) {
        fail("auxiliary target artifact has trailing bytes");
    }
    for (i = 0; i < set->vocab; ++i) {
        if (set->family_tags[i] >= set->vocab) {
            fail("auxiliary family tag exceeds vocabulary");
        }
    }
    for (i = 0; i < set->target_count; ++i) {
        AuxEvent event = set->events[i];
        if (event.position >= set->context || event.tag >= set->vocab ||
            event.family >= set->family_count || event.reserved != 0U) {
            fail("invalid auxiliary target event");
        }
    }
}

static void aux_target_destroy(AuxTargetSet *set)
{
    free(set->pack_offsets);
    free(set->family_offsets);
    free(set->family_tags);
    free(set->events);
    memset(set, 0, sizeof(*set));
}

static void aux_head_create(AuxHead *head, int vocab, int dim, int context)
{
    int unit;
    memset(head, 0, sizeof(*head));
    head->vocab = vocab;
    head->dim = dim;
    head->width = BOTTLENECK_WIDTH;
    parameter_create(&head->down, "state_bottleneck_down",
                     (size_t)head->width * (size_t)dim, 1);
    parameter_create(&head->down_bias, "state_bottleneck_bias",
                     (size_t)head->width, 0);
    parameter_create(&head->factor_output, "state_factor_output",
                     (size_t)vocab * (size_t)head->width, 1);
    parameter_create(&head->factor_bias, "state_factor_bias",
                     (size_t)vocab, 0);
    parameter_create(&head->bridge_output, "state_answer_bridge",
                     (size_t)dim * (size_t)head->width, 1);
    head->adapted_hidden = zero_alloc((size_t)context * (size_t)dim,
                                      sizeof(*head->adapted_hidden));
    head->bottleneck = zero_alloc((size_t)context * (size_t)head->width,
                                  sizeof(*head->bottleneck));
    head->bottleneck_gradient = zero_alloc(
        (size_t)context * (size_t)head->width,
        sizeof(*head->bottleneck_gradient));
    head->logits = zero_alloc((size_t)vocab, sizeof(*head->logits));
    /* Deterministic identity slice: no random-number stream is consumed. */
    for (unit = 0; unit < head->width; ++unit)
        head->down.w[(size_t)unit * (size_t)dim +
                     (size_t)(unit % dim)] = 1.0f;
    /* Both outputs stay zero so the initial language path is unchanged. */
}

static void aux_head_worker_create(AuxHead *worker, AuxHead *primary,
                                   int context)
{
    aux_head_create(worker, primary->vocab, primary->dim, context);
    {
        Parameter *worker_parameters[5] = {&worker->down, &worker->down_bias,
            &worker->factor_output, &worker->factor_bias,
            &worker->bridge_output};
        Parameter *primary_parameters[5] = {&primary->down,
            &primary->down_bias, &primary->factor_output,
            &primary->factor_bias, &primary->bridge_output};
        int parameter;
        for (parameter = 0; parameter < 5; ++parameter) {
            free(worker_parameters[parameter]->w);
            free(worker_parameters[parameter]->m);
            free(worker_parameters[parameter]->v);
            worker_parameters[parameter]->w = primary_parameters[parameter]->w;
            worker_parameters[parameter]->m = NULL;
            worker_parameters[parameter]->v = NULL;
        }
    }
}

static void aux_head_destroy(AuxHead *head, int worker)
{
    if (worker) {
        head->down.w = NULL;
        head->down_bias.w = NULL;
        head->factor_output.w = NULL;
        head->factor_bias.w = NULL;
        head->bridge_output.w = NULL;
    }
    parameter_destroy(&head->down);
    parameter_destroy(&head->down_bias);
    parameter_destroy(&head->factor_output);
    parameter_destroy(&head->factor_bias);
    parameter_destroy(&head->bridge_output);
    free(head->adapted_hidden);
    free(head->bottleneck);
    free(head->bottleneck_gradient);
    free(head->logits);
    memset(head, 0, sizeof(*head));
}

static void aux_head_zero_grad(AuxHead *head, int context)
{
    Parameter *parameters[5] = {&head->down, &head->down_bias,
        &head->factor_output, &head->factor_bias, &head->bridge_output};
    int parameter;
    for (parameter = 0; parameter < 5; ++parameter)
        memset(parameters[parameter]->g, 0,
               parameters[parameter]->count * sizeof(float));
    memset(head->bottleneck_gradient, 0,
           (size_t)context * (size_t)head->width * sizeof(float));
}

static void aux_bottleneck_forward(AuxHead *head, const Model *model,
                                   const unsigned char *answer_classes,
                                   float bridge_scale)
{
    const Config *cfg = &model->cfg;
    int time, unit, d;
    for (time = 0; time < cfg->context; ++time) {
        const float *hidden = model->final_n + (size_t)time * cfg->dim;
        float *latent = head->bottleneck + (size_t)time * head->width;
        float *adapted = head->adapted_hidden + (size_t)time * cfg->dim;
        memcpy(adapted, hidden, (size_t)cfg->dim * sizeof(*adapted));
        for (unit = 0; unit < head->width; ++unit) {
            const float *weights = head->down.w +
                (size_t)unit * (size_t)cfg->dim;
            double value = head->down_bias.w[unit];
            for (d = 0; d < cfg->dim; ++d) value += weights[d] * hidden[d];
            latent[unit] = tanhf((float)value);
        }
        if (bridge_scale != 0.0f && answer_classes != NULL &&
            answer_classes[time] > 1U) {
            for (d = 0; d < cfg->dim; ++d) {
                const float *weights = head->bridge_output.w +
                    (size_t)d * (size_t)head->width;
                double value = 0.0;
                for (unit = 0; unit < head->width; ++unit)
                    value += weights[unit] * latent[unit];
                adapted[d] += bridge_scale * (float)value;
            }
        }
    }
}

static float aux_language_forward(AuxHead *head, Model *model,
                                  const Token *tokens, const Token *targets,
                                  float dropout, Rng *dropout_rng,
                                  const float *loss_mask,
                                  const unsigned char *answer_classes,
                                  float bridge_scale)
{
    const Config *cfg = &model->cfg;
    float loss_weight = (float)cfg->context;
    float loss = 0.0f;
    int time;
    (void)model_forward_masked(model, tokens, NULL, dropout, dropout_rng,
                               loss_mask);
    aux_bottleneck_forward(head, model, answer_classes, bridge_scale);
    linear_forward(cfg->context, cfg->dim, cfg->vocab, head->adapted_hidden,
                   model->token_embedding.w, model->probs);
    if (loss_mask != NULL) {
        loss_weight = 0.0f;
        for (time = 0; time < cfg->context; ++time)
            loss_weight += loss_mask[time];
        if (loss_weight == 0.0f) loss_weight = 1.0f;
    }
    for (time = 0; time < cfg->context; ++time) {
        float *row = model->probs + (size_t)time * cfg->vocab;
        softmax_prefix_inplace(row, cfg->vocab);
        if (targets != NULL &&
            (loss_mask == NULL || loss_mask[time] != 0.0f)) {
            float probability = row[targets[time]];
            if (probability < 1.0e-20f) probability = 1.0e-20f;
            loss -= (loss_mask == NULL ? 1.0f : loss_mask[time]) *
                    logf(probability) / loss_weight;
        }
    }
    return loss;
}

static AuxScore aux_head_score(AuxHead *head, const Model *model,
                               const AuxTargetSet *set, uint32_t pack,
                               float loss_weight, int backward)
{
    AuxScore score = {0};
    uint32_t begin = set->pack_offsets[pack];
    uint32_t end = set->pack_offsets[pack + 1U];
    uint32_t event_index;
    uint32_t event_count = end - begin;
    (void)model;
    for (event_index = begin; event_index < end; ++event_index) {
        AuxEvent event = set->events[event_index];
        uint32_t first = set->family_offsets[event.family];
        uint32_t last = set->family_offsets[event.family + 1U];
        const float *latent = head->bottleneck +
            (size_t)event.position * (size_t)head->width;
        float maximum = -INFINITY;
        double total = 0.0;
        float target_probability = 0.0f;
        uint16_t best_tag = set->family_tags[first];
        float best_probability = -1.0f;
        uint32_t candidate;
        int found = 0;
        for (candidate = first; candidate < last; ++candidate) {
            uint16_t tag = set->family_tags[candidate];
            const float *weights = head->factor_output.w +
                (size_t)tag * (size_t)head->width;
            double value = head->factor_bias.w[tag];
            int d;
            for (d = 0; d < head->width; ++d)
                value += weights[d] * latent[d];
            head->logits[candidate] = (float)value;
            if ((float)value > maximum) maximum = (float)value;
            if (tag == event.tag) found = 1;
        }
        if (!found) fail("auxiliary target is outside its family");
        for (candidate = first; candidate < last; ++candidate) {
            total += exp((double)head->logits[candidate] - maximum);
        }
        for (candidate = first; candidate < last; ++candidate) {
            uint16_t tag = set->family_tags[candidate];
            float probability = (float)(exp((double)head->logits[candidate] -
                                             maximum) / total);
            if (probability > best_probability) {
                best_probability = probability;
                best_tag = tag;
            }
            if (tag == event.tag) target_probability = probability;
            if (backward && loss_weight != 0.0f && event_count != 0U) {
                float dz = (probability - (tag == event.tag ? 1.0f : 0.0f)) *
                           loss_weight / (float)event_count;
                float *weights = head->factor_output.w +
                    (size_t)tag * (size_t)head->width;
                float *weight_gradient = head->factor_output.g +
                    (size_t)tag * (size_t)head->width;
                float *latent_gradient = head->bottleneck_gradient +
                    (size_t)event.position * (size_t)head->width;
                int d;
                head->factor_bias.g[tag] += dz;
                for (d = 0; d < head->width; ++d) {
                    weight_gradient[d] += dz * latent[d];
                    latent_gradient[d] += dz * weights[d];
                }
            }
        }
        if (target_probability < 1.0e-20f) target_probability = 1.0e-20f;
        score.loss -= log((double)target_probability);
        score.correct += best_tag == event.tag;
        ++score.events;
    }
    return score;
}

/* Backward through the tied language head and the shared state bottleneck. */
static void model_backward_with_aux(Model *model, AuxHead *head,
                                    const Token *tokens,
                                    const Token *targets,
                                    const float *loss_mask,
                                    const unsigned char *answer_classes,
                                    float bridge_scale)
{
    const Config *cfg = &model->cfg;
    size_t td = (size_t)cfg->context * cfg->dim;
    size_t tf = (size_t)cfg->context * cfg->ff;
    Work *work = &model->work;
    float *dy = work->dy;
    float *dx = work->dx;
    int time, token, i, layer_index;
    float loss_weight = 0.0f;
    for (time = 0; time < cfg->context; ++time) loss_weight += loss_mask[time];
    if (loss_weight == 0.0f) loss_weight = 1.0f;
    memset(dy, 0, td * sizeof(float));
    for (time = 0; time < cfg->context; ++time) {
        float *row = &model->probs[time * cfg->vocab];
        for (token = 0; token < cfg->vocab; ++token) {
            row[token] = loss_mask[time] == 0.0f ? 0.0f :
                (row[token] - (token == targets[time] ? 1.0f : 0.0f)) *
                loss_mask[time] / loss_weight;
        }
    }
    linear_backward(cfg->context, cfg->dim, cfg->vocab, head->adapted_hidden,
                    model->token_embedding.w, model->probs,
                    model->token_embedding.g, dy);
    for (time = 0; time < cfg->context; ++time) {
        float *latent = head->bottleneck + (size_t)time * head->width;
        float *latent_gradient = head->bottleneck_gradient +
            (size_t)time * head->width;
        const float *hidden = model->final_n + (size_t)time * cfg->dim;
        int unit, d;
        if (bridge_scale != 0.0f && answer_classes != NULL &&
            answer_classes[time] > 1U) {
            for (d = 0; d < cfg->dim; ++d) {
                float hidden_gradient = dy[(size_t)time * cfg->dim + d];
                float *weights = head->bridge_output.w +
                    (size_t)d * head->width;
                float *weight_gradient = head->bridge_output.g +
                    (size_t)d * head->width;
                for (unit = 0; unit < head->width; ++unit) {
                    weight_gradient[unit] += bridge_scale * hidden_gradient *
                        latent[unit];
                    latent_gradient[unit] += bridge_scale * hidden_gradient *
                        weights[unit];
                }
            }
        }
        for (unit = 0; unit < head->width; ++unit) {
            float gradient = latent_gradient[unit] *
                (1.0f - latent[unit] * latent[unit]);
            float *weights = head->down.w +
                (size_t)unit * (size_t)cfg->dim;
            float *weight_gradient = head->down.g +
                (size_t)unit * (size_t)cfg->dim;
            head->down_bias.g[unit] += gradient;
            for (d = 0; d < cfg->dim; ++d) {
                weight_gradient[d] += gradient * hidden[d];
                dy[(size_t)time * cfg->dim + d] += gradient * weights[d];
            }
        }
    }
    memset(dx, 0, td * sizeof(float));
    rmsnorm_backward(model->final_x, model->final_norm.w, dy, dx,
                     model->final_norm.g, cfg->context, cfg->dim);
    { float *swap = dy; dy = dx; dx = swap; }
    for (layer_index = cfg->layers - 1; layer_index >= 0; --layer_index) {
        TransformerLayer *layer = &model->layer[layer_index];
        LayerCache *cache = &model->cache[layer_index];
        memcpy(work->dr1, dy, td * sizeof(float));
        memset(work->dact, 0, tf * sizeof(float));
        for (i = 0; i < (int)td; ++i)
            work->tmp_td[i] = dy[i] * cache->feed_forward_mask[i];
        linear_backward(cfg->context, cfg->ff, cfg->dim, cache->fact,
                        layer->w2.w, work->tmp_td, layer->w2.g, work->dact);
        for (i = 0; i < (int)tf; ++i) {
            work->dfpre[i] = work->dact[i] *
                gelu_derivative_from_tanh(cache->fpre[i],
                                          cache->gelu_tanh[i]);
        }
        memset(work->dn2, 0, td * sizeof(float));
        linear_backward(cfg->context, cfg->dim, cfg->ff, cache->n2,
                        layer->w1.w, work->dfpre, layer->w1.g, work->dn2);
        rmsnorm_backward(cache->r1, layer->norm2.w, work->dn2, work->dr1,
                         layer->norm2.g, cfg->context, cfg->dim);
        memcpy(dx, work->dr1, td * sizeof(float));
        memset(work->datt, 0, td * sizeof(float));
        for (i = 0; i < (int)td; ++i)
            work->tmp_td[i] = work->dr1[i] * cache->attention_mask[i];
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->att,
                        layer->wo.w, work->tmp_td, layer->wo.g, work->datt);
        memset(work->dq, 0, td * sizeof(float));
        memset(work->dk, 0, td * sizeof(float));
        memset(work->dv, 0, td * sizeof(float));
        attention_backward(cfg, cache, work->datt, work->dq, work->dk,
                           work->dv, work->attention_matrix);
        if (cfg->rotary) {
            rope_apply(model, work->dq, cfg->dim, 1);
            rope_apply(model, work->dk, cfg->dim, 1);
        }
#if defined(USE_FUSED_QKV_BACKWARD)
        for (time = 0; time < cfg->context; ++time) {
            float *destination = work->dqkv +
                (size_t)time * 3U * cfg->dim;
            memcpy(destination, work->dq + (size_t)time * cfg->dim,
                   (size_t)cfg->dim * sizeof(float));
            memcpy(destination + cfg->dim,
                   work->dk + (size_t)time * cfg->dim,
                   (size_t)cfg->dim * sizeof(float));
            memcpy(destination + 2 * cfg->dim,
                   work->dv + (size_t)time * cfg->dim,
                   (size_t)cfg->dim * sizeof(float));
        }
        memset(work->dn1, 0, td * sizeof(float));
        linear_backward(cfg->context, cfg->dim, 3 * cfg->dim, cache->n1,
                        layer->wq.w, work->dqkv, layer->wq.g, work->dn1);
#else
        memset(work->dn1, 0, td * sizeof(float));
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wq.w, work->dq, layer->wq.g, work->dn1);
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wk.w, work->dk, layer->wk.g, work->dn1);
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wv.w, work->dv, layer->wv.g, work->dn1);
#endif
        rmsnorm_backward(cache->x, layer->norm1.w, work->dn1, dx,
                         layer->norm1.g, cfg->context, cfg->dim);
        { float *swap = dy; dy = dx; dx = swap; }
    }
    for (time = 0; time < cfg->context; ++time) {
        int input_token = tokens[time];
        for (i = 0; i < cfg->dim; ++i) {
            float gradient = dy[time * cfg->dim + i];
            model->token_embedding.g[input_token * cfg->dim + i] += gradient;
            if (!cfg->rotary)
                model->position_embedding.g[time * cfg->dim + i] += gradient;
        }
    }
}

typedef struct {
    Model *model;
    AuxHead *head;
    const PackedSet *train;
    const AuxTargetSet *auxiliary;
    uint32_t pack;
    float *mask;
    float dropout;
    float auxiliary_weight;
    float bridge_scale;
    float language_loss;
    AuxScore auxiliary_score;
} AuxTask;

static void *aux_task_run(void *argument)
{
    AuxTask *task = argument;
    size_t token_start = (size_t)task->pack *
        ((size_t)task->train->context + 1U);
    const Token *tokens = task->train->tokens + token_start;
    const Token *targets = tokens + 1;
    const unsigned char *answer_classes = task->train->target_classes +
        (size_t)task->pack * task->train->context;
    task->language_loss = aux_language_forward(
        task->head, task->model, tokens, targets, task->dropout, NULL,
        task->mask, answer_classes, task->bridge_scale);
    task->auxiliary_score = aux_head_score(
        task->head, task->model, task->auxiliary, task->pack,
        task->auxiliary_weight, 1);
    model_backward_with_aux(task->model, task->head, tokens, targets,
                            task->mask, answer_classes, task->bridge_scale);
    return NULL;
}

static void aux_merge_model_gradients(Model *primary, Model *worker)
{
    int p;
    for (p = 0; p < primary->parameter_count; ++p) {
        size_t i;
        Parameter *destination = primary->parameters[p];
        Parameter *source = worker->parameters[p];
        for (i = 0; i < destination->count; ++i) {
            destination->g[i] += source->g[i];
            source->g[i] = 0.0f;
        }
    }
}

static void aux_merge_head_gradients(AuxHead *primary, AuxHead *worker)
{
    Parameter *primary_parameters[5] = {&primary->down, &primary->down_bias,
        &primary->factor_output, &primary->factor_bias,
        &primary->bridge_output};
    Parameter *worker_parameters[5] = {&worker->down, &worker->down_bias,
        &worker->factor_output, &worker->factor_bias,
        &worker->bridge_output};
    int parameter;
    for (parameter = 0; parameter < 5; ++parameter) {
        size_t i;
        for (i = 0; i < primary_parameters[parameter]->count; ++i) {
            primary_parameters[parameter]->g[i] +=
                worker_parameters[parameter]->g[i];
            worker_parameters[parameter]->g[i] = 0.0f;
        }
    }
}

static float aux_optimizer_update(Model *model, AuxHead *head, uint64_t step,
                                  float learning_rate, float weight_decay,
                                  float clip_limit, float batch_scale)
{
    const float beta1 = 0.9f, beta2 = 0.999f, epsilon = 1.0e-8f;
    Parameter *extra[5] = {&head->down, &head->down_bias,
        &head->factor_output, &head->factor_bias, &head->bridge_output};
    double sum_squares = 0.0;
    float norm, clip_scale = 1.0f;
    float correction;
    int p;
    for (p = 0; p < model->parameter_count; ++p) {
        Parameter *parameter = model->parameters[p];
        size_t i;
        for (i = 0; i < parameter->count; ++i) {
            double value = parameter->g[i] * batch_scale;
            sum_squares += value * value;
        }
    }
    for (p = 0; p < 5; ++p) {
        size_t i;
        for (i = 0; i < extra[p]->count; ++i) {
            double value = extra[p]->g[i] * batch_scale;
            sum_squares += value * value;
        }
    }
    norm = (float)sqrt(sum_squares);
    if (clip_limit > 0.0f && norm > clip_limit) clip_scale = clip_limit / norm;
    correction = learning_rate * sqrtf(1.0f - powf(beta2, (float)step)) /
                 (1.0f - powf(beta1, (float)step));
    optimizer_apply_slice(model, learning_rate, weight_decay, batch_scale,
                          clip_scale, correction, 0, 1, 1);
    for (p = 0; p < 5; ++p) {
        Parameter *parameter = extra[p];
        size_t i;
        for (i = 0; i < parameter->count; ++i) {
            float gradient = parameter->g[i] * batch_scale * clip_scale;
            parameter->m[i] = beta1 * parameter->m[i] +
                              (1.0f - beta1) * gradient;
            parameter->v[i] = beta2 * parameter->v[i] +
                (1.0f - beta2) * gradient * gradient;
            parameter->w[i] -= correction * parameter->m[i] /
                (sqrtf(parameter->v[i]) + epsilon) +
                (parameter->decay ? learning_rate * weight_decay *
                                    parameter->w[i] : 0.0f);
            parameter->g[i] = 0.0f;
        }
    }
    return norm;
}

static void aux_head_save(const char *path, const AuxHead *head,
                          uint64_t step, uint64_t completed_steps,
                          uint64_t best_update, float best_validation)
{
    size_t path_length = strlen(path);
    char *temporary = zero_alloc(path_length + 5U, 1);
    FILE *file;
    const Parameter *parameters[5] = {&head->down, &head->down_bias,
        &head->factor_output, &head->factor_bias, &head->bridge_output};
    int p;
    snprintf(temporary, path_length + 5U, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) fail_path("create auxiliary checkpoint", path);
    if (fwrite(AUX_HEAD_MAGIC, 1, 8, file) != 8)
        fail_path("write auxiliary checkpoint", path);
    aux_write_u32(file, AUX_VERSION, path);
    aux_write_u32(file, (uint32_t)head->vocab, path);
    aux_write_u32(file, (uint32_t)head->dim, path);
    aux_write_u32(file, (uint32_t)head->width, path);
    aux_write_u32(file, 5U, path);
    aux_write_u64(file, step, path);
    aux_write_u64(file, completed_steps, path);
    aux_write_u64(file, best_update, path);
    if (fwrite(&best_validation, sizeof(best_validation), 1, file) != 1)
        fail_path("write auxiliary checkpoint", path);
    for (p = 0; p < 5; ++p) {
        uint64_t count = parameters[p]->count;
        aux_write_u64(file, count, path);
        if (fwrite(parameters[p]->w, sizeof(float), (size_t)count, file) !=
                count ||
            fwrite(parameters[p]->m, sizeof(float), (size_t)count, file) !=
                count ||
            fwrite(parameters[p]->v, sizeof(float), (size_t)count, file) !=
                count) fail_path("write auxiliary checkpoint", path);
    }
    if (fclose(file) != 0 || rename(temporary, path) != 0)
        fail_path("install auxiliary checkpoint", path);
    free(temporary);
}

static void aux_head_load(const char *path, AuxHead *head, uint64_t step,
                          uint64_t *completed_steps, uint64_t *best_update,
                          float *best_validation)
{
    unsigned char magic[8];
    FILE *file = fopen(path, "rb");
    Parameter *parameters[5] = {&head->down, &head->down_bias,
        &head->factor_output, &head->factor_bias, &head->bridge_output};
    uint64_t observed_step;
    int p;
    if (file == NULL) fail_path("open auxiliary checkpoint", path);
    aux_read_exact(file, magic, 8, path);
    if (memcmp(magic, AUX_HEAD_MAGIC, 8) != 0 ||
        aux_read_u32(file, path) != AUX_VERSION ||
        aux_read_u32(file, path) != (uint32_t)head->vocab ||
        aux_read_u32(file, path) != (uint32_t)head->dim ||
        aux_read_u32(file, path) != (uint32_t)head->width ||
        aux_read_u32(file, path) != 5U) fail("auxiliary checkpoint mismatch");
    observed_step = aux_read_u64(file, path);
    *completed_steps = aux_read_u64(file, path);
    *best_update = aux_read_u64(file, path);
    aux_read_exact(file, best_validation, sizeof(*best_validation), path);
    if (observed_step != step) fail("base and auxiliary checkpoints differ");
    for (p = 0; p < 5; ++p) {
        uint64_t count = aux_read_u64(file, path);
        if (count != parameters[p]->count) fail("auxiliary parameter mismatch");
        aux_read_exact(file, parameters[p]->w, (size_t)count * sizeof(float), path);
        aux_read_exact(file, parameters[p]->m, (size_t)count * sizeof(float), path);
        aux_read_exact(file, parameters[p]->v, (size_t)count * sizeof(float), path);
    }
    if (fgetc(file) != EOF || fclose(file) != 0)
        fail("auxiliary checkpoint has trailing bytes");
}

static const char *aux_pair_path(const char *base, char *buffer, size_t size)
{
    if (snprintf(buffer, size, "%s.aux", base) >= (int)size)
        fail("auxiliary checkpoint path is too long");
    return buffer;
}

static void aux_save_pair(const char *base_path, Model *model, AuxHead *head,
                          uint64_t update, Rng *rng, uint64_t completed,
                          uint64_t best_update, float best_validation,
                          const AuxOptions *options)
{
    CheckpointOrchestrationV6 state;
    char head_path[4096];
    memset(&state, 0, sizeof(state));
    state.packed_mode = 1U;
    state.packed_batch = (uint32_t)options->batch;
    state.packed_total_steps = (uint64_t)options->steps;
    state.packed_completed_steps = completed;
    state.packed_best_update = best_update;
    state.packed_best_validation = best_validation;
    state.reserved = (uint32_t)options->parallel_batch;
    const char *bound_hash = options->scientific_contract_sha256 != NULL
        ? options->scientific_contract_sha256 : options->contract_sha256;
    memcpy(state.run_contract_sha256, bound_hash,
           sizeof(state.run_contract_sha256));
    checkpoint_save(base_path, model, update, rng, completed, 0U, 0U, &state);
    aux_head_save(aux_pair_path(base_path, head_path, sizeof(head_path)), head,
                  update, completed, best_update, best_validation);
}

static AuxScore aux_eval_records(Model *model, AuxHead *head,
                                 const char *path)
{
    unsigned char magic[8];
    FILE *file = fopen(path, "rb");
    AuxTargetSet families = {0};
    AuxScore total = {0};
    uint32_t record_count, target_count, record;
    Token *tokens;
    if (file == NULL) fail_path("open auxiliary evaluation", path);
    aux_read_exact(file, magic, 8, path);
    if (memcmp(magic, AUX_EVAL_MAGIC, 8) != 0 ||
        aux_read_u32(file, path) != AUX_VERSION ||
        aux_read_u32(file, path) != (uint32_t)head->vocab ||
        aux_read_u32(file, path) != (uint32_t)model->cfg.context) {
        fail("auxiliary evaluation contract mismatch");
    }
    record_count = aux_read_u32(file, path);
    target_count = aux_read_u32(file, path);
    families.family_count = aux_read_u32(file, path);
    families.vocab = (uint32_t)head->vocab;
    families.family_offsets = zero_alloc((size_t)families.family_count + 1U,
                                         sizeof(*families.family_offsets));
    families.family_tags = zero_alloc(families.vocab,
                                      sizeof(*families.family_tags));
    for (record = 0; record <= families.family_count; ++record)
        families.family_offsets[record] = aux_read_u32(file, path);
    aux_read_exact(file, families.family_tags,
                   families.vocab * sizeof(*families.family_tags), path);
    tokens = zero_alloc((size_t)model->cfg.context, sizeof(*tokens));
    for (record = 0; record < record_count; ++record) {
        uint32_t token_count = aux_read_u32(file, path);
        uint32_t input_positions = aux_read_u32(file, path);
        uint32_t event_count = aux_read_u32(file, path);
        AuxEvent *events = zero_alloc(event_count, sizeof(*events));
        uint32_t i;
        if (token_count == 0U || token_count > (uint32_t)model->cfg.context ||
            input_positions == 0U || input_positions > token_count ||
            event_count == 0U) fail("invalid auxiliary evaluation record");
        for (i = 0; i < (uint32_t)model->cfg.context; ++i)
            tokens[i] = (Token)256;
        aux_read_exact(file, tokens, token_count * sizeof(*tokens), path);
        aux_read_exact(file, events, event_count * sizeof(*events), path);
        for (i = 0; i < event_count; ++i)
            events[i].position = (uint16_t)(input_positions - 1U);
        (void)aux_language_forward(head, model, tokens, NULL, 0.0f, NULL,
                                   NULL, NULL, 0.0f);
        families.pack_count = 1U;
        families.target_count = event_count;
        families.pack_offsets = zero_alloc(2U, sizeof(*families.pack_offsets));
        families.pack_offsets[1] = event_count;
        families.events = events;
        {
            AuxScore score = aux_head_score(head, model, &families, 0U, 0.0f, 0);
            total.loss += score.loss;
            total.events += score.events;
            total.correct += score.correct;
        }
        free(families.pack_offsets);
        families.pack_offsets = NULL;
        free(events);
    }
    if (total.events != target_count || fgetc(file) != EOF || fclose(file) != 0)
        fail("auxiliary evaluation accounting changed");
    free(tokens);
    free(families.family_offsets);
    free(families.family_tags);
    return total;
}

static void aux_eval_completions(Model *model, AuxHead *head,
                                 const char *path, float bridge_scale)
{
    static const unsigned char expected[8] =
        {'Z', '5', 'C', 'E', 'V', '1', '\0', '\0'};
    unsigned char magic[8];
    FILE *file = fopen(path, "rb");
    Token *sequence, *context;
    unsigned char *answer_classes;
    uint32_t version, vocab, declared_context, record_count, record;
    uint64_t target_tokens = 0, correct_tokens = 0, exact_records = 0;
    uint64_t last_token_correct = 0;
    double total_loss = 0.0;
    if (file == NULL) fail_path("open completion evaluation", path);
    aux_read_exact(file, magic, 8, path);
    version = aux_read_u32(file, path);
    vocab = aux_read_u32(file, path);
    declared_context = aux_read_u32(file, path);
    record_count = aux_read_u32(file, path);
    if (memcmp(magic, expected, 8) != 0 || version != 1U ||
        vocab != (uint32_t)model->cfg.vocab ||
        declared_context != (uint32_t)model->cfg.context ||
        record_count == 0U) fail("completion evaluation contract mismatch");
    sequence = zero_alloc((size_t)model->cfg.context + 1U, sizeof(*sequence));
    context = zero_alloc((size_t)model->cfg.context, sizeof(*context));
    answer_classes = zero_alloc((size_t)model->cfg.context,
                                sizeof(*answer_classes));
    for (record = 0; record < record_count; ++record) {
        uint32_t token_count = aux_read_u32(file, path);
        uint32_t target_start = aux_read_u32(file, path);
        uint32_t target_count = aux_read_u32(file, path);
        uint32_t reserved = aux_read_u32(file, path);
        uint32_t offset, token;
        int exact = 1;
        if (token_count < 2U ||
            token_count > (uint32_t)model->cfg.context + 1U ||
            (target_start == 0U &&
             token_count == (uint32_t)model->cfg.context + 1U) ||
            target_count == 0U ||
            target_start + target_count > token_count || reserved != 0U)
            fail("invalid completion evaluation record");
        for (token = 0; token < token_count; ++token) {
            sequence[token] = (Token)completion_read_u16(file, path);
            if (sequence[token] >= (Token)model->cfg.vocab)
                fail("completion token exceeds model vocabulary");
        }
        offset = (uint32_t)model->cfg.context + 1U - token_count;
        for (token = 0; token < (uint32_t)model->cfg.context; ++token) {
            context[token] = (Token)' ';
            answer_classes[token] = 0U;
        }
        for (token = 0; token < token_count; ++token) {
            uint32_t destination = offset + token;
            if (destination < (uint32_t)model->cfg.context)
                context[destination] = sequence[token];
        }
        for (token = target_start; token < target_start + target_count; ++token)
            answer_classes[offset + token - 1U] = 2U;
        (void)aux_language_forward(head, model, context, NULL, 0.0f, NULL,
                                   NULL, answer_classes, bridge_scale);
        for (token = target_start; token < target_start + target_count; ++token) {
            uint32_t time = offset + token - 1U;
            const float *row = model->probs +
                (size_t)time * (size_t)model->cfg.vocab;
            Token target = sequence[token];
            float probability = row[target];
            int best = 0, candidate;
            if (probability < 1.0e-20f) probability = 1.0e-20f;
            total_loss -= log((double)probability);
            for (candidate = 1; candidate < model->cfg.vocab; ++candidate)
                if (row[candidate] > row[best]) best = candidate;
            if ((Token)best == target) {
                ++correct_tokens;
                if (token + 1U == target_start + target_count)
                    ++last_token_correct;
            } else exact = 0;
            ++target_tokens;
        }
        if (exact) ++exact_records;
    }
    if (fgetc(file) != EOF || fclose(file) != 0)
        fail("completion evaluation has trailing bytes");
    printf("{\"schema\":\"zero.c3_completion_eval.v1\"," \
           "\"records\":%u,\"target_tokens\":%llu," \
           "\"nats_per_target_token\":%.9g," \
           "\"top1_token_accuracy\":%.9g," \
           "\"teacher_forced_exact_accuracy\":%.9g," \
           "\"last_target_token_accuracy\":%.9g}\n",
           record_count, (unsigned long long)target_tokens,
           total_loss / (double)target_tokens,
           (double)correct_tokens / (double)target_tokens,
           (double)exact_records / (double)record_count,
           (double)last_token_correct / (double)record_count);
    free(answer_classes);
    free(context);
    free(sequence);
}

static void aux_eval_span_choices(Model *model, AuxHead *head,
                                  const char *path, float bridge_scale)
{
    static const unsigned char expected[8] =
        {'Z', '5', 'S', 'C', 'V', '1', '\0', '\0'};
    unsigned char magic[8];
    FILE *file = fopen(path, "rb");
    Token *sequence, *context;
    unsigned char *answer_classes;
    uint32_t version, vocab, declared_context, pair_count, pair;
    uint64_t correct_target_tokens = 0, alternative_target_tokens = 0;
    uint64_t correct_tokens = 0, exact_records = 0, choice_correct = 0;
    uint64_t position_0_correct = 0, position_1_correct = 0;
    uint64_t position_0_records = 0, position_1_records = 0;
    uint64_t swap_consistent = 0, pair_exact = 0;
    double correct_loss = 0.0, alternative_loss = 0.0, choice_loss = 0.0;
    if (file == NULL) fail_path("open span-choice evaluation", path);
    aux_read_exact(file, magic, 8, path);
    version = aux_read_u32(file, path);
    vocab = aux_read_u32(file, path);
    declared_context = aux_read_u32(file, path);
    pair_count = aux_read_u32(file, path);
    if (memcmp(magic, expected, 8) != 0 || version != 1U ||
        vocab != (uint32_t)model->cfg.vocab ||
        declared_context != (uint32_t)model->cfg.context || pair_count == 0U)
        fail("span-choice evaluation contract mismatch");
    sequence = zero_alloc((size_t)model->cfg.context + 1U, sizeof(*sequence));
    context = zero_alloc((size_t)model->cfg.context, sizeof(*context));
    answer_classes = zero_alloc((size_t)model->cfg.context,
                                sizeof(*answer_classes));
    for (pair = 0; pair < pair_count; ++pair) {
        uint32_t labels[2], predictions[2];
        int choices_correct[2];
        uint32_t orientation;
        for (orientation = 0; orientation < 2U; ++orientation) {
            uint32_t token_count = aux_read_u32(file, path);
            uint32_t correct_start = aux_read_u32(file, path);
            uint32_t correct_count = aux_read_u32(file, path);
            uint32_t alternative_start = aux_read_u32(file, path);
            uint32_t alternative_count = aux_read_u32(file, path);
            uint32_t label = aux_read_u32(file, path);
            uint32_t offset, token;
            SpanScore correct, alternative;
            double difference;
            if (token_count < 2U ||
                token_count > (uint32_t)model->cfg.context + 1U ||
                correct_start == 0U || correct_count == 0U ||
                correct_start + correct_count > token_count ||
                alternative_start == 0U || alternative_count == 0U ||
                alternative_start + alternative_count > token_count ||
                label > 1U) fail("invalid span-choice evaluation record");
            for (token = 0; token < token_count; ++token) {
                sequence[token] = (Token)completion_read_u16(file, path);
                if (sequence[token] >= (Token)model->cfg.vocab)
                    fail("span-choice token exceeds model vocabulary");
            }
            offset = (uint32_t)model->cfg.context + 1U - token_count;
            for (token = 0; token < (uint32_t)model->cfg.context; ++token) {
                context[token] = (Token)' ';
                answer_classes[token] = 0U;
            }
            for (token = 0; token < token_count; ++token) {
                uint32_t destination = offset + token;
                if (destination < (uint32_t)model->cfg.context)
                    context[destination] = sequence[token];
            }
            for (token = correct_start; token < correct_start + correct_count;
                 ++token) answer_classes[offset + token - 1U] = 2U;
            for (token = alternative_start;
                 token < alternative_start + alternative_count; ++token)
                answer_classes[offset + token - 1U] = 2U;
            (void)aux_language_forward(head, model, context, NULL, 0.0f, NULL,
                                       NULL, answer_classes, bridge_scale);
            correct = score_span(model, sequence, correct_start,
                                 correct_count, offset, 1);
            alternative = score_span(model, sequence, alternative_start,
                                     alternative_count, offset, 0);
            difference = correct.loss / (double)correct.target_count -
                         alternative.loss / (double)alternative.target_count;
            labels[orientation] = label;
            predictions[orientation] = difference <= 0.0 ? label : 1U - label;
            choices_correct[orientation] = difference <= 0.0;
            correct_loss += correct.loss;
            alternative_loss += alternative.loss;
            correct_target_tokens += correct.target_count;
            alternative_target_tokens += alternative.target_count;
            correct_tokens += correct.correct_tokens;
            if (correct.exact) ++exact_records;
            if (choices_correct[orientation]) ++choice_correct;
            choice_loss += difference > 0.0
                ? difference + log1p(exp(-difference)) : log1p(exp(difference));
            if (label == 0U) {
                ++position_0_records;
                if (choices_correct[orientation]) ++position_0_correct;
            } else {
                ++position_1_records;
                if (choices_correct[orientation]) ++position_1_correct;
            }
        }
        if (labels[0] == labels[1]) fail("span-choice labels are not mirrored");
        if (predictions[0] != predictions[1]) ++swap_consistent;
        if (choices_correct[0] && choices_correct[1]) ++pair_exact;
    }
    if (position_0_records != pair_count || position_1_records != pair_count ||
        fgetc(file) != EOF || fclose(file) != 0)
        fail("span-choice evaluation accounting changed");
    printf("{\"schema\":\"zero.c42_span_choice_eval.v1\"," \
           "\"pairs\":%u,\"records\":%llu," \
           "\"correct_target_tokens\":%llu," \
           "\"alternative_target_tokens\":%llu," \
           "\"correct_nats_per_target_token\":%.9g," \
           "\"alternative_nats_per_target_token\":%.9g," \
           "\"top1_token_accuracy\":%.9g," \
           "\"teacher_forced_exact_accuracy\":%.9g," \
           "\"forced_choice_nats\":%.9g,\"choice_accuracy\":%.9g," \
           "\"position_0_accuracy\":%.9g,\"position_1_accuracy\":%.9g," \
           "\"swap_consistency_accuracy\":%.9g," \
           "\"pair_exact_accuracy\":%.9g}\n",
           pair_count, (unsigned long long)pair_count * 2ULL,
           (unsigned long long)correct_target_tokens,
           (unsigned long long)alternative_target_tokens,
           correct_loss / (double)correct_target_tokens,
           alternative_loss / (double)alternative_target_tokens,
           (double)correct_tokens / (double)correct_target_tokens,
           (double)exact_records / ((double)pair_count * 2.0),
           choice_loss / ((double)pair_count * 2.0),
           (double)choice_correct / ((double)pair_count * 2.0),
           (double)position_0_correct / (double)position_0_records,
           (double)position_1_correct / (double)position_1_records,
           (double)swap_consistent / (double)pair_count,
           (double)pair_exact / (double)pair_count);
    free(answer_classes);
    free(context);
    free(sequence);
}

static float aux_evaluate_packed(Model *model, AuxHead *head,
                                 const PackedSet *set, int batches,
                                 float bridge_scale)
{
    float *mask = zero_alloc((size_t)model->cfg.context, sizeof(*mask));
    double total_loss = 0.0;
    uint64_t total_targets = 0;
    int sample;
    if (batches > (int)set->pack_count) batches = (int)set->pack_count;
    for (sample = 0; sample < batches; ++sample) {
        uint32_t pack = batches == 1 ? 0U :
            (uint32_t)((uint64_t)sample * (set->pack_count - 1U) /
                       (uint64_t)(batches - 1));
        size_t token_start = (size_t)pack * ((size_t)set->context + 1U);
        const unsigned char *classes = set->target_classes +
            (size_t)pack * set->context;
        uint64_t active = packed_mask(set, pack, mask, 1.0f, 1.0f, 1.0f);
        float loss;
        if (active == 0U) continue;
        loss = aux_language_forward(head, model, set->tokens + token_start,
            set->tokens + token_start + 1U, 0.0f, NULL, mask, classes,
            bridge_scale);
        total_loss += (double)loss * (double)active;
        total_targets += active;
    }
    if (total_targets == 0U) fail("packed evaluation selected no targets");
    free(mask);
    return (float)(total_loss / (double)total_targets);
}

static void aux_eval_packed(Model *model, AuxHead *head, const char *path,
                            int batches, float bridge_scale)
{
    PackedSet set = {0};
    float loss;
    packed_set_load(&set, path, &model->cfg);
    if (batches > (int)set.pack_count) batches = (int)set.pack_count;
    loss = aux_evaluate_packed(model, head, &set, batches, bridge_scale);
    printf("{\"schema\":\"zero.c61_packed_eval.v1\"," \
           "\"nats_per_token\":%.9g,\"batches\":%d}\n",
           loss, batches);
    packed_set_destroy(&set);
}

static long aux_parse_long(const char *value, const char *name)
{
    return parse_long(value, name);
}

static float aux_parse_float(const char *value, const char *name)
{
    return parse_float(value, name);
}

static void aux_usage(const char *program)
{
    printf("usage: %s --init CKPT --packed-train PACK --aux-targets AUX [options]\n",
           program);
    printf("       %s --init CKPT --head HEAD --aux-eval FILE --eval-only\n",
           program);
    printf("       %s --resume CKPT --span-choice-eval FILE [--bridge-off]\n",
           program);
}

static AuxOptions aux_options(int argc, char **argv)
{
    AuxOptions options = {0};
    int i;
    options.steps = 1000;
    options.batch = 2;
    options.parallel_batch = 2;
    options.learning_rate = 0.0003f;
    options.weight_decay = 0.01f;
    options.clip = 1.0f;
    options.warmup = 100;
    options.report_every = 500;
    options.validation_batches = 256;
    options.dropout = 0.1f;
    options.auxiliary_weight = 0.1f;
    options.bridge_scale = 0.1f;
    options.claim_answer_weight = 1.0f;
    options.cloze_answer_weight = 1.0f;
    options.retrieval_answer_weight = 1.0f;
    options.save_every = 1000;
    for (i = 1; i < argc; ++i) {
#define AUX_VALUE(name, field) \
        if (strcmp(argv[i], name) == 0 && i + 1 < argc) { \
            options.field = argv[++i]; \
        } else
        AUX_VALUE("--init", init_path)
        AUX_VALUE("--resume", resume_path)
        AUX_VALUE("--packed-train", train_path)
        AUX_VALUE("--packed-validation", validation_path)
        AUX_VALUE("--aux-targets", aux_path)
        AUX_VALUE("--aux-eval", eval_path)
        AUX_VALUE("--completion-eval", completion_eval_path)
        AUX_VALUE("--span-choice-eval", span_choice_eval_path)
        AUX_VALUE("--packed-eval", packed_eval_path)
        AUX_VALUE("--head", head_path)
        AUX_VALUE("--best", best_path)
        AUX_VALUE("--save", save_path)
        AUX_VALUE("--run-contract-sha256", contract_sha256)
        AUX_VALUE("--scientific-contract-sha256", scientific_contract_sha256)
        if (strcmp(argv[i], "--steps") == 0 && i + 1 < argc)
            options.steps = aux_parse_long(argv[++i], "--steps");
        else if (strcmp(argv[i], "--batch") == 0 && i + 1 < argc)
            options.batch = (int)aux_parse_long(argv[++i], "--batch");
        else if (strcmp(argv[i], "--parallel-batch") == 0 && i + 1 < argc)
            options.parallel_batch = (int)aux_parse_long(argv[++i], "--parallel-batch");
        else if (strcmp(argv[i], "--lr") == 0 && i + 1 < argc)
            options.learning_rate = aux_parse_float(argv[++i], "--lr");
        else if (strcmp(argv[i], "--weight-decay") == 0 && i + 1 < argc)
            options.weight_decay = aux_parse_float(argv[++i], "--weight-decay");
        else if (strcmp(argv[i], "--clip") == 0 && i + 1 < argc)
            options.clip = aux_parse_float(argv[++i], "--clip");
        else if (strcmp(argv[i], "--warmup") == 0 && i + 1 < argc)
            options.warmup = aux_parse_long(argv[++i], "--warmup");
        else if (strcmp(argv[i], "--report") == 0 && i + 1 < argc)
            options.report_every = aux_parse_long(argv[++i], "--report");
        else if (strcmp(argv[i], "--validation") == 0 && i + 1 < argc)
            options.validation_batches = (int)aux_parse_long(argv[++i], "--validation");
        else if (strcmp(argv[i], "--dropout") == 0 && i + 1 < argc)
            options.dropout = aux_parse_float(argv[++i], "--dropout");
        else if (strcmp(argv[i], "--aux-weight") == 0 && i + 1 < argc)
            options.auxiliary_weight = aux_parse_float(argv[++i], "--aux-weight");
        else if (strcmp(argv[i], "--bridge-scale") == 0 && i + 1 < argc)
            options.bridge_scale = aux_parse_float(argv[++i], "--bridge-scale");
        else if (strcmp(argv[i], "--claim-answer-weight") == 0 && i + 1 < argc)
            options.claim_answer_weight = aux_parse_float(argv[++i], "--claim-answer-weight");
        else if (strcmp(argv[i], "--cloze-answer-weight") == 0 && i + 1 < argc)
            options.cloze_answer_weight = aux_parse_float(argv[++i], "--cloze-answer-weight");
        else if (strcmp(argv[i], "--retrieval-answer-weight") == 0 && i + 1 < argc)
            options.retrieval_answer_weight = aux_parse_float(argv[++i], "--retrieval-answer-weight");
        else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc)
            options.seed = aux_parse_long(argv[++i], "--seed");
        else if (strcmp(argv[i], "--save-every") == 0 && i + 1 < argc)
            options.save_every = aux_parse_long(argv[++i], "--save-every");
        else if (strcmp(argv[i], "--max-run-steps") == 0 && i + 1 < argc)
            options.max_run_steps = aux_parse_long(argv[++i], "--max-run-steps");
        else if (strcmp(argv[i], "--eval-only") == 0) options.eval_only = 1;
        else if (strcmp(argv[i], "--bridge-off") == 0) options.bridge_off = 1;
        else if (strcmp(argv[i], "--self-test") == 0) options.self_test = 1;
        else if (strcmp(argv[i], "--help") == 0) { aux_usage(argv[0]); exit(0); }
        else fail("unknown or incomplete TargetBridge option");
#undef AUX_VALUE
    }
    return options;
}

static int aux_gradient_self_test(void)
{
    Config cfg = {4, 8, 2, 1, 16, 1, 32};
    Rng rng;
    Model model;
    AuxHead head;
    AuxTargetSet set = {0};
    Token tokens[4] = {1, 2, 3, 4};
    uint32_t pack_offsets[2] = {0, 1};
    uint32_t family_offsets[2] = {0, 2};
    uint16_t family_tags[2] = {0, 1};
    AuxEvent event = {1, 1, 0, 0};
    float zero_mask[4] = {0};
    float answer_mask[4] = {0, 1, 0, 0};
    unsigned char answer_classes[4] = {0, 2, 0, 0};
    float epsilon = 0.001f, analytic, plus, minus, original;
    float base_analytic, base_plus, base_minus, base_original;
    float bridge_analytic, bridge_plus, bridge_minus, bridge_original;
    rng_seed(&rng, 7);
    model_create(&model, cfg, &rng);
    aux_head_create(&head, 2, cfg.dim, cfg.context);
    head.factor_output.w[0] = 0.03f;
    head.factor_output.w[head.width] = -0.02f;
    set.vocab = 2; set.context = 4; set.pack_count = 1; set.target_count = 1;
    set.family_count = 1; set.pack_offsets = pack_offsets;
    set.family_offsets = family_offsets; set.family_tags = family_tags;
    set.events = &event;
    (void)aux_language_forward(&head, &model, tokens, NULL, 0.0f, NULL,
                               NULL, NULL, 0.0f);
    aux_head_zero_grad(&head, cfg.context);
    (void)aux_head_score(&head, &model, &set, 0, 1.0f, 1);
    analytic = head.factor_output.g[0];
    original = head.factor_output.w[0];
    head.factor_output.w[0] = original + epsilon;
    plus = (float)aux_head_score(&head, &model, &set, 0, 0.0f, 0).loss;
    head.factor_output.w[0] = original - epsilon;
    minus = (float)aux_head_score(&head, &model, &set, 0, 0.0f, 0).loss;
    head.factor_output.w[0] = original;
    model_zero_grad(&model);
    aux_head_zero_grad(&head, cfg.context);
    (void)aux_language_forward(&head, &model, tokens, NULL, 0.0f, NULL,
                               NULL, NULL, 0.0f);
    (void)aux_head_score(&head, &model, &set, 0, 1.0f, 1);
    model_backward_with_aux(&model, &head, tokens, tokens, zero_mask,
                            NULL, 0.0f);
    base_analytic = model.final_norm.g[0];
    base_original = model.final_norm.w[0];
    model.final_norm.w[0] = base_original + epsilon;
    (void)aux_language_forward(&head, &model, tokens, NULL, 0.0f, NULL,
                               NULL, NULL, 0.0f);
    base_plus = (float)aux_head_score(&head, &model, &set, 0, 0.0f, 0).loss;
    model.final_norm.w[0] = base_original - epsilon;
    (void)aux_language_forward(&head, &model, tokens, NULL, 0.0f, NULL,
                               NULL, NULL, 0.0f);
    base_minus = (float)aux_head_score(&head, &model, &set, 0, 0.0f, 0).loss;
    model.final_norm.w[0] = base_original;
    model_zero_grad(&model);
    aux_head_zero_grad(&head, cfg.context);
    head.bridge_output.w[0] = 0.05f;
    (void)aux_language_forward(&head, &model, tokens, tokens, 0.0f, NULL,
                               answer_mask, answer_classes, 0.1f);
    model_backward_with_aux(&model, &head, tokens, tokens, answer_mask,
                            answer_classes, 0.1f);
    bridge_analytic = head.bridge_output.g[0];
    bridge_original = head.bridge_output.w[0];
    head.bridge_output.w[0] = bridge_original + epsilon;
    bridge_plus = aux_language_forward(&head, &model, tokens, tokens, 0.0f,
        NULL, answer_mask, answer_classes, 0.1f);
    head.bridge_output.w[0] = bridge_original - epsilon;
    bridge_minus = aux_language_forward(&head, &model, tokens, tokens, 0.0f,
        NULL, answer_mask, answer_classes, 0.1f);
    head.bridge_output.w[0] = bridge_original;
    aux_head_destroy(&head, 0);
    model_destroy(&model);
    if (fabsf(analytic - (plus - minus) / (2.0f * epsilon)) > 0.002f ||
        fabsf(base_analytic - (base_plus - base_minus) /
               (2.0f * epsilon)) > 0.002f ||
        fabsf(bridge_analytic - (bridge_plus - bridge_minus) /
               (2.0f * epsilon)) > 0.002f)
        fail("Shared-State Bottleneck gradient self-test failed");
    printf("ZERO.5 C6.1 Shared-State Bottleneck self-test passed\n");
    return 1;
}

int main(int argc, char **argv)
{
    AuxOptions options = aux_options(argc, argv);
    Config cfg;
    Rng rng;
    Model model, worker_model;
    AuxHead head, worker_head;
    AuxTargetSet auxiliary = {0};
    PackedSet train = {0}, validation = {0};
    uint64_t update = 0, completed = 0, best_update = 0;
    float best_validation = INFINITY;
    CheckpointOrchestrationV6 resume_state;
    uint64_t attempts = 0;
    uint32_t rejections = 0, mode = 0;
    double training_start, interval_start, interval_lm = 0.0, interval_aux = 0.0;
    uint64_t interval_sequences = 0, interval_events = 0, interval_correct = 0;
    uint64_t interval_tokens = 0;
    uint64_t attempt_steps = 0;
    float *masks[2] = {NULL, NULL};
    memset(&resume_state, 0, sizeof(resume_state));
    if (options.self_test) return aux_gradient_self_test() ? 0 : 1;
    if (options.init_path == NULL && options.resume_path == NULL)
        fail("Shared-State Bottleneck requires --init or --resume");
    cfg = options.resume_path != NULL ? checkpoint_peek(options.resume_path) :
                                       artifact_peek(options.init_path);
    validate_config(&cfg);
    rng_seed(&rng, (uint64_t)options.seed);
    model_create(&model, cfg, &rng);
    model_set_trainable_scope(&model, TRAINABLE_SCOPE_ALL);
    aux_head_create(&head, 752, cfg.dim, cfg.context);
    if (options.resume_path != NULL) {
        char paired[4096];
        update = checkpoint_load(options.resume_path, &model, &rng, &attempts,
                                 &rejections, &mode, &resume_state);
        aux_head_load(aux_pair_path(options.resume_path, paired, sizeof(paired)),
                      &head, update, &completed, &best_update, &best_validation);
        if (completed != resume_state.packed_completed_steps)
            fail("resume cursors differ");
    } else {
        (void)artifact_load_weights(options.init_path, &model);
    }
    if (options.eval_only) {
        int modes = (options.eval_path != NULL) +
            (options.completion_eval_path != NULL) +
            (options.span_choice_eval_path != NULL) +
            (options.packed_eval_path != NULL);
        float bridge_scale = options.bridge_off ? 0.0f : options.bridge_scale;
        if (options.head_path != NULL) {
            uint64_t ignored_completed, ignored_best;
            float ignored_validation;
            aux_head_load(options.head_path, &head, update, &ignored_completed,
                          &ignored_best, &ignored_validation);
        }
        if (modes != 1) fail("--eval-only requires exactly one evaluation");
        if (options.eval_path != NULL) {
            AuxScore score = aux_eval_records(&model, &head, options.eval_path);
            printf("{\"schema\":\"zero.c61_state_eval.v1\","
                   "\"events\":%llu,\"nats_per_event\":%.9g,"
                   "\"accuracy\":%.9g}\n",
                   (unsigned long long)score.events, score.loss / score.events,
                   (double)score.correct / score.events);
        } else if (options.completion_eval_path != NULL) {
            aux_eval_completions(&model, &head, options.completion_eval_path,
                                 bridge_scale);
        } else if (options.span_choice_eval_path != NULL) {
            aux_eval_span_choices(&model, &head,
                                  options.span_choice_eval_path,
                                  bridge_scale);
        } else {
            aux_eval_packed(&model, &head, options.packed_eval_path,
                            options.validation_batches, bridge_scale);
        }
        aux_head_destroy(&head, 0);
        model_destroy(&model);
        return 0;
    }
    if (options.train_path == NULL || options.validation_path == NULL ||
        options.aux_path == NULL || options.contract_sha256 == NULL ||
        strlen(options.contract_sha256) != 64U || options.steps <= 0 ||
        options.batch != 2 || options.parallel_batch != 2 ||
        options.auxiliary_weight < 0.0f ||
        options.auxiliary_weight > 1.0f || options.bridge_scale < 0.0f ||
        options.bridge_scale > 1.0f || options.claim_answer_weight < 1.0f ||
        options.cloze_answer_weight < 1.0f ||
        options.retrieval_answer_weight < 1.0f)
        fail("invalid Shared-State Bottleneck run contract");
    if (options.resume_path != NULL) {
        const char *resume_hash = options.scientific_contract_sha256 != NULL
            ? options.scientific_contract_sha256 : options.contract_sha256;
        if (strlen(resume_hash) != 64U ||
            memcmp(resume_state.run_contract_sha256, resume_hash,
                   sizeof(resume_state.run_contract_sha256)) != 0)
            fail("resume checkpoint belongs to a different C6.1 contract "
                 "scientific invariant tier");
    }
    packed_set_load(&train, options.train_path, &cfg);
    packed_set_load(&validation, options.validation_path, &cfg);
    aux_target_load(&auxiliary, options.aux_path, &cfg);
    if (auxiliary.pack_count != train.pack_count ||
        train.update_count != (uint32_t)options.steps)
        fail("Shared-State Bottleneck train artifacts are not aligned");
    masks[0] = zero_alloc((size_t)cfg.context, sizeof(float));
    masks[1] = zero_alloc((size_t)cfg.context, sizeof(float));
    if (options.parallel_batch == 2) {
        model_worker_create(&worker_model, &model);
        aux_head_worker_create(&worker_head, &head, cfg.context);
    }
    printf("Shared-State parameters base=%zu auxiliary=%zu total=%zu "
           "aux-weight=%.9g bridge-scale=%.9g\n",
           model_parameter_total(&model), aux_parameter_total(&head),
           model_parameter_total(&model) + aux_parameter_total(&head),
           options.auxiliary_weight, options.bridge_scale);
    training_start = interval_start = wall_seconds();
    signal(SIGINT, on_interrupt);
    signal(SIGTERM, on_interrupt);
    while (completed < (uint64_t)options.steps && !interrupted &&
           (options.max_run_steps == 0 ||
            attempt_steps < (uint64_t)options.max_run_steps)) {
        uint32_t first = packed_update_start(&train, completed, options.batch);
        uint32_t count = packed_update_size(&train, completed, options.batch);
        AuxTask tasks[2] = {0};
        pthread_t thread;
        uint32_t item;
        float current_lr = options.learning_rate;
        float gradient_norm;
        if (count == 0U || count > 2U)
            fail("invalid Shared-State update group");
        model_zero_grad(&model);
        aux_head_zero_grad(&head, cfg.context);
        for (item = 0; item < count; ++item) {
            Model *task_model = item == 0U ? &model : &worker_model;
            AuxHead *task_head = item == 0U ? &head : &worker_head;
            (void)packed_mask(&train, first + item, masks[item],
                options.claim_answer_weight, options.cloze_answer_weight,
                options.retrieval_answer_weight);
            if (item > 0U) {
                model_zero_grad(task_model);
                aux_head_zero_grad(task_head, cfg.context);
            }
            if (options.dropout > 0.0f)
                model_prepare_dropout(task_model, options.dropout, &rng);
            tasks[item].model = task_model;
            tasks[item].head = task_head;
            tasks[item].train = &train;
            tasks[item].auxiliary = &auxiliary;
            tasks[item].pack = first + item;
            tasks[item].mask = masks[item];
            tasks[item].dropout = options.dropout;
            tasks[item].auxiliary_weight = options.auxiliary_weight;
            tasks[item].bridge_scale = options.bridge_scale;
        }
        if (count == 2U && options.parallel_batch == 2) {
            if (pthread_create(&thread, NULL, aux_task_run, &tasks[1]) != 0)
                fail("create Shared-State worker");
            (void)aux_task_run(&tasks[0]);
            if (pthread_join(thread, NULL) != 0)
                fail("join Shared-State worker");
            aux_merge_model_gradients(&model, &worker_model);
            aux_merge_head_gradients(&head, &worker_head);
        } else {
            for (item = 0; item < count; ++item) (void)aux_task_run(&tasks[item]);
        }
        ++completed;
        ++attempt_steps;
        if (options.warmup > 0 && completed <= (uint64_t)options.warmup)
            current_lr *= (float)completed / (float)options.warmup;
        if (options.steps > options.warmup && completed > (uint64_t)options.warmup) {
            float progress = (float)(completed - (uint64_t)options.warmup) /
                (float)(options.steps - options.warmup);
            current_lr *= 0.5f * (1.0f + cosf(3.14159265358979323846f * progress));
        }
        gradient_norm = aux_optimizer_update(&model, &head, update + 1U,
            current_lr, options.weight_decay, options.clip, 1.0f / count);
        ++update;
        for (item = 0; item < count; ++item) {
            interval_lm += tasks[item].language_loss;
            interval_aux += tasks[item].auxiliary_score.loss;
            interval_events += tasks[item].auxiliary_score.events;
            interval_correct += tasks[item].auxiliary_score.correct;
            ++interval_sequences;
            interval_tokens += train.context;
        }
        if (update % (uint64_t)options.report_every == 0U ||
            completed == (uint64_t)options.steps) {
            double now = wall_seconds();
            float val = aux_evaluate_packed(&model, &head, &validation,
                options.validation_batches, options.bridge_scale);
            printf("update %8llu lm %.4f aux %.4f aux-acc %.4f val %.4f grad %.3f lr %.6g tok/s %.0f\n",
                (unsigned long long)update,
                interval_lm / interval_sequences,
                interval_events ? interval_aux / interval_events : 0.0,
                interval_events ? (double)interval_correct / interval_events : 0.0,
                val, gradient_norm, current_lr,
                interval_tokens / (now - interval_start));
            fflush(stdout);
            interval_lm = interval_aux = 0.0;
            interval_sequences = interval_events = interval_correct = 0;
            interval_tokens = 0;
            interval_start = now;
            if (val < best_validation - 1.0e-5f) {
                best_validation = val;
                best_update = update;
                if (options.best_path != NULL)
                    aux_save_pair(options.best_path, &model, &head, update, &rng,
                                  completed, best_update, best_validation, &options);
            }
        }
        if (options.save_path != NULL && options.save_every > 0 &&
            completed % (uint64_t)options.save_every == 0U)
            aux_save_pair(options.save_path, &model, &head, update, &rng,
                          completed, best_update, best_validation, &options);
    }
    if (options.save_path != NULL)
        aux_save_pair(options.save_path, &model, &head, update, &rng,
                      completed, best_update, best_validation, &options);
    printf("Shared-State sampling sequences=%u compute-token-exposures=%llu auxiliary-events=%u wraps=0\n",
           train.pack_count,
           (unsigned long long)train.pack_count * train.context,
           auxiliary.target_count);
    printf("training time %.2f seconds\n", wall_seconds() - training_start);
    if (options.parallel_batch == 2) {
        aux_head_destroy(&worker_head, 1);
        model_worker_destroy(&worker_model);
    }
    free(masks[0]); free(masks[1]);
    aux_target_destroy(&auxiliary);
    packed_set_destroy(&train);
    packed_set_destroy(&validation);
    aux_head_destroy(&head, 0);
    model_destroy(&model);
    return interrupted ? 2 : 0;
}
