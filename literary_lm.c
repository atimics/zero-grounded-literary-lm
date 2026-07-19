#include <errno.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "channel_protocol.h"
#include "zero1_protocol.h"

#ifdef USE_ACCELERATE
#include <Accelerate/Accelerate.h>
#endif

/*
 * literary_lm.c -- a small decoder-only transformer trainer in ISO C11.
 *
 * Input tokens are bytes in [0, 255], either literal bytes or the compact BPE
 * representation produced by bpe_tokenizer.  The model uses pre-normalized
 * causal self-attention, GELU feed-forward blocks, tied embeddings, rotary
 * positions, residual dropout, AdamW, validation, checkpointing, and
 * autoregressive generation.
 */

#define DEFAULT_VOCAB_SIZE 256
#define MAX_VOCAB_SIZE 2048
#define CHECKPOINT_VERSION 4U
#define RMS_EPSILON 1.0e-5f
#define BPE_BASE_TOKENS 128
#define BPE_MAX_MERGES (MAX_VOCAB_SIZE - BPE_BASE_TOKENS)
#define MAX_FACULTY_TEACHERS 3
#define MAX_SAME_ARCH_TEACHERS (MAX_FACULTY_TEACHERS - 1)

typedef uint16_t Token;

typedef struct {
    int context;
    int dim;
    int heads;
    int layers;
    int ff;
    int rotary;
    int vocab;
} Config;

typedef struct {
    uint64_t state;
} Rng;

typedef struct {
    const char *name;
    size_t count;
    int decay;
    float *w;
    float *g;
    float *m;
    float *v;
} Parameter;

typedef struct {
    Parameter norm1;
    Parameter wq;
    Parameter wk;
    Parameter wv;
    Parameter wo;
    Parameter norm2;
    Parameter w1;
    Parameter w2;
} TransformerLayer;

typedef struct {
    float *x;
    float *n1;
    float *q;
    float *k;
    float *v;
    float *att;
    float *prob;
    float *r1;
    float *n2;
    float *fpre;
    float *fact;
    float *attention_mask;
    float *feed_forward_mask;
} LayerCache;

typedef struct {
    float *dy;
    float *dx;
    float *dr1;
    float *dn2;
    float *datt;
    float *dq;
    float *dk;
    float *dv;
    float *dn1;
    float *dact;
    float *dfpre;
    float *tmp_td;
    float *attention_matrix;
} Work;

typedef struct {
    Config cfg;
    Parameter token_embedding;
    Parameter position_embedding;
    TransformerLayer *layer;
    Parameter final_norm;
    Parameter **parameters;
    int parameter_count;
    LayerCache *cache;
    float *final_x;
    float *final_n;
    float *probs;
    float *rope_cos;
    float *rope_sin;
    Work work;
} Model;

typedef struct {
    int loaded;
    int vocab;
    int char_to_token[ZERO1_MAX_VOCAB];
    unsigned char token_to_char[ZERO1_MAX_VOCAB];
    float *embedding;
    float *w1;
    float *b1;
    float *w2;
    float *b2;
    float x[ZERO1_CONTEXT * ZERO1_EMBED];
    float h[ZERO1_HIDDEN];
    float probs[ZERO1_MAX_VOCAB];
} Zero1Teacher;

typedef struct {
    int loaded;
    int merge_count;
    int vocab;
    int token_width;
    Token left[BPE_MAX_MERGES];
    Token right[BPE_MAX_MERGES];
} Tokenizer;

typedef struct {
    Token *data;
    size_t length;
    size_t capacity;
} Corpus;

typedef struct {
    size_t start;
    size_t length;
    size_t training_length;
    size_t validation_start;
    size_t validation_length;
    int channel;
    int foundation;
    int teacher_eligible;
    int distill_override;
    float distill_weights[MAX_FACULTY_TEACHERS];
    float weight;
    size_t *record_starts;
    size_t record_count;
    size_t training_record_count;
    size_t validation_record_index;
    size_t validation_record_count;
} CorpusRange;

enum {
    TRANSACTION_DISABLED = 0,
    TRANSACTION_OBSERVER = 1,
    TRANSACTION_GUARD = 2,
    TRANSACTION_CUMULATIVE_GUARD = 3
};

typedef struct {
    size_t parameter_total;
    float *learned_before;
    float *batch_gradient;
    float *replay_gradient;
    float *start_weights;
    double *group_drift;
    double *group_displacement_norm;
    double *group_fisher_drift;
    unsigned char *probe_mask;
    float *cumulative_baseline_losses;
    float *cumulative_candidate_losses;
    int cumulative_replay_count;
    double cumulative_baseline_mean;
    FILE *log;
    uint64_t attempts;
    uint64_t source_mask;
    uint32_t consecutive_rejections;
} TransactionState;

typedef struct {
    long steps;
    int batch;
    float learning_rate;
    float weight_decay;
    float clip;
    long warmup;
    long schedule_offset;
    long schedule_total;
    long report_every;
    int validation_batches;
    const char *save_path;
    long save_every;
    const char *resume_path;
    const char *init_path;
    int eval_only;
    const char *prompt;
    long generate_tokens;
    float temperature;
    int top_k;
    long seed;
    int self_test;
    float dropout;
    const char *best_path;
    long patience;
    int cosine_decay;
    long gradient_cosine_every;
    const char *tokenizer_path;
    float repetition_penalty;
    float channel_weight;
    float foundation_weight;
    int artifact_weight;
    const char *teacher_paths[MAX_SAME_ARCH_TEACHERS];
    float teacher_weights[MAX_SAME_ARCH_TEACHERS];
    int teacher_count;
    const char *zero1_teacher_path;
    float zero1_weight;
    int transaction_mode;
    const char *transaction_log_path;
    const char *transaction_phase;
    long transaction_probe_every;
    float transaction_guard_budget;
    long transaction_max_rejections;
} Options;

static volatile sig_atomic_t interrupted = 0;

static const char SAMPLE_TEXT[] =
    "zero is the empty beginning. one is the successor of zero. "
    "two contains zero and one. number grows by preserving what came before.\n"
    "a token is a finite symbol. a sequence is an ordered list of tokens. "
    "a vector is a finite function into numbers.\n"
    "a matrix transforms one vector into another. a layer composes a matrix "
    "with a nonlinearity. a network is a composition of layers.\n"
    "a language model predicts the next token. training changes parameters "
    "to reduce surprise. attention relates each position to earlier positions.\n"
    "structure is grounded in zero but is not equal to zero. difference is "
    "preserved by relation, position, and memory.\n"
    "zero is the empty beginning. one is the successor of zero. "
    "two contains zero and one. number grows by preserving what came before.\n"
    "a token is a finite symbol. a sequence is an ordered list of tokens. "
    "a vector is a finite function into numbers.\n"
    "a matrix transforms one vector into another. a layer composes a matrix "
    "with a nonlinearity. a network is a composition of layers.\n"
    "a language model predicts the next token. training changes parameters "
    "to reduce surprise. attention relates each position to earlier positions.\n"
    "structure is grounded in zero but is not equal to zero. difference is "
    "preserved by relation, position, and memory.\n";

static void on_interrupt(int signal_number)
{
    (void)signal_number;
    interrupted = 1;
}

static void fail(const char *message)
{
    fprintf(stderr, "error: %s\n", message);
    exit(EXIT_FAILURE);
}

static void fail_path(const char *action, const char *path)
{
    fprintf(stderr, "error: could not %s '%s': %s\n", action, path,
            strerror(errno));
    exit(EXIT_FAILURE);
}

static void *zero_alloc(size_t count, size_t size)
{
    void *memory;
    if (size != 0 && count > SIZE_MAX / size) {
        fail("allocation size overflow");
    }
    memory = calloc(count, size);
    if (memory == NULL) {
        fail("out of memory");
    }
    return memory;
}

static void *resize_alloc(void *memory, size_t count, size_t size)
{
    void *resized;
    if (size != 0 && count > SIZE_MAX / size) {
        fail("allocation size overflow");
    }
    resized = realloc(memory, count * size);
    if (resized == NULL) {
        fail("out of memory");
    }
    return resized;
}

static double wall_seconds(void)
{
    struct timespec value;
    if (timespec_get(&value, TIME_UTC) != TIME_UTC) {
        return (double)clock() / CLOCKS_PER_SEC;
    }
    return (double)value.tv_sec + (double)value.tv_nsec * 1.0e-9;
}

static void rng_seed(Rng *rng, uint64_t seed)
{
    uint64_t z = seed + UINT64_C(1);
    z += UINT64_C(0x9e3779b97f4a7c15);
    z = (z ^ (z >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)) * UINT64_C(0x94d049bb133111eb);
    rng->state = z ^ (z >> 31);
    if (rng->state == 0) {
        rng->state = 1;
    }
}

static uint64_t rng_next(Rng *rng)
{
    uint64_t x = rng->state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    rng->state = x;
    return x * UINT64_C(0x2545f4914f6cdd1d);
}

static float rng_unit(Rng *rng)
{
    return (float)((rng_next(rng) >> 40) * (1.0 / 16777216.0));
}

static float rng_symmetric(Rng *rng, float scale)
{
    return (2.0f * rng_unit(rng) - 1.0f) * scale;
}

static void parameter_create(Parameter *parameter, const char *name,
                             size_t count, int decay)
{
    parameter->name = name;
    parameter->count = count;
    parameter->decay = decay;
    parameter->w = zero_alloc(count, sizeof(float));
    parameter->g = zero_alloc(count, sizeof(float));
    parameter->m = zero_alloc(count, sizeof(float));
    parameter->v = zero_alloc(count, sizeof(float));
}

static void parameter_destroy(Parameter *parameter)
{
    free(parameter->w);
    free(parameter->g);
    free(parameter->m);
    free(parameter->v);
    memset(parameter, 0, sizeof(*parameter));
}

static void parameter_random(Parameter *parameter, Rng *rng, float scale)
{
    size_t i;
    for (i = 0; i < parameter->count; ++i) {
        parameter->w[i] = rng_symmetric(rng, scale);
    }
}

static void parameter_ones(Parameter *parameter)
{
    size_t i;
    for (i = 0; i < parameter->count; ++i) {
        parameter->w[i] = 1.0f;
    }
}

static void linear_forward(int rows, int input, int output, const float *x,
                           const float *w, float *y)
{
#ifdef USE_ACCELERATE
    cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasTrans, rows, output, input,
                1.0f, x, input, w, input, 0.0f, y, output);
#else
    int row;
    int out;
    int in;
    for (row = 0; row < rows; ++row) {
        for (out = 0; out < output; ++out) {
            float sum = 0.0f;
            for (in = 0; in < input; ++in) {
                sum += x[row * input + in] * w[out * input + in];
            }
            y[row * output + out] = sum;
        }
    }
#endif
}

/* Accumulates into both gw and dx; callers zero scratch dx when required. */
static void linear_backward(int rows, int input, int output, const float *x,
                            const float *w, const float *dy, float *gw,
                            float *dx)
{
#ifdef USE_ACCELERATE
    cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, output, input, rows,
                1.0f, dy, output, x, input, 1.0f, gw, input);
    cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, rows, input, output,
                1.0f, dy, output, w, input, 1.0f, dx, input);
#else
    int row;
    int out;
    int in;
    for (out = 0; out < output; ++out) {
        for (in = 0; in < input; ++in) {
            float sum = 0.0f;
            for (row = 0; row < rows; ++row) {
                sum += dy[row * output + out] * x[row * input + in];
            }
            gw[out * input + in] += sum;
        }
    }
    for (row = 0; row < rows; ++row) {
        for (in = 0; in < input; ++in) {
            float sum = 0.0f;
            for (out = 0; out < output; ++out) {
                sum += dy[row * output + out] * w[out * input + in];
            }
            dx[row * input + in] += sum;
        }
    }
#endif
}

static void rmsnorm_forward(const float *x, const float *gamma, float *y,
                            int rows, int width)
{
    int row;
    int i;
    for (row = 0; row < rows; ++row) {
        float mean_square = 0.0f;
        float inverse;
        for (i = 0; i < width; ++i) {
            float value = x[row * width + i];
            mean_square += value * value;
        }
        inverse = 1.0f / sqrtf(mean_square / width + RMS_EPSILON);
        for (i = 0; i < width; ++i) {
            y[row * width + i] = x[row * width + i] * inverse * gamma[i];
        }
    }
}

/* Accumulates gradients into dx and dgamma. */
static void rmsnorm_backward(const float *x, const float *gamma,
                             const float *dy, float *dx, float *dgamma,
                             int rows, int width)
{
    int row;
    int i;
    for (row = 0; row < rows; ++row) {
        float mean_square = 0.0f;
        float dot = 0.0f;
        float inverse;
        float coefficient;
        for (i = 0; i < width; ++i) {
            float value = x[row * width + i];
            mean_square += value * value;
        }
        inverse = 1.0f / sqrtf(mean_square / width + RMS_EPSILON);
        for (i = 0; i < width; ++i) {
            dot += dy[row * width + i] * gamma[i] * x[row * width + i];
            dgamma[i] += dy[row * width + i] * x[row * width + i] * inverse;
        }
        coefficient = inverse * inverse * inverse * dot / width;
        for (i = 0; i < width; ++i) {
            dx[row * width + i] +=
                inverse * dy[row * width + i] * gamma[i] -
                x[row * width + i] * coefficient;
        }
    }
}

static float gelu(float x)
{
    const float c = 0.7978845608028654f;
    const float a = 0.044715f;
    return 0.5f * x * (1.0f + tanhf(c * (x + a * x * x * x)));
}

static float gelu_derivative(float x)
{
    const float c = 0.7978845608028654f;
    const float a = 0.044715f;
    float u = c * (x + a * x * x * x);
    float t = tanhf(u);
    return 0.5f * (1.0f + t) +
           0.5f * x * (1.0f - t * t) * c * (1.0f + 3.0f * a * x * x);
}

static void layer_parameters_create(TransformerLayer *layer, int index,
                                    const Config *cfg, Rng *rng)
{
    size_t dd = (size_t)cfg->dim * cfg->dim;
    size_t fd = (size_t)cfg->ff * cfg->dim;
    float square_scale = sqrtf(6.0f / (2.0f * cfg->dim));
    float up_scale = sqrtf(6.0f / (cfg->dim + cfg->ff));
    char *names;
    const size_t name_width = 24;

    names = zero_alloc(8 * name_width, sizeof(char));
    snprintf(names + 0 * name_width, name_width, "layer.%d.norm1", index);
    snprintf(names + 1 * name_width, name_width, "layer.%d.wq", index);
    snprintf(names + 2 * name_width, name_width, "layer.%d.wk", index);
    snprintf(names + 3 * name_width, name_width, "layer.%d.wv", index);
    snprintf(names + 4 * name_width, name_width, "layer.%d.wo", index);
    snprintf(names + 5 * name_width, name_width, "layer.%d.norm2", index);
    snprintf(names + 6 * name_width, name_width, "layer.%d.w1", index);
    snprintf(names + 7 * name_width, name_width, "layer.%d.w2", index);

    parameter_create(&layer->norm1, names + 0 * name_width, cfg->dim, 0);
    parameter_create(&layer->wq, names + 1 * name_width, dd, 1);
    parameter_create(&layer->wk, names + 2 * name_width, dd, 1);
    parameter_create(&layer->wv, names + 3 * name_width, dd, 1);
    parameter_create(&layer->wo, names + 4 * name_width, dd, 1);
    parameter_create(&layer->norm2, names + 5 * name_width, cfg->dim, 0);
    parameter_create(&layer->w1, names + 6 * name_width, fd, 1);
    parameter_create(&layer->w2, names + 7 * name_width, fd, 1);

    parameter_ones(&layer->norm1);
    parameter_ones(&layer->norm2);
    parameter_random(&layer->wq, rng, square_scale);
    parameter_random(&layer->wk, rng, square_scale);
    parameter_random(&layer->wv, rng, square_scale);
    parameter_random(&layer->wo, rng, square_scale / sqrtf(2.0f * cfg->layers));
    parameter_random(&layer->w1, rng, up_scale);
    parameter_random(&layer->w2, rng,
                     up_scale / sqrtf(2.0f * cfg->layers));
}

static void layer_parameters_destroy(TransformerLayer *layer)
{
    char *names = (char *)layer->norm1.name;
    parameter_destroy(&layer->norm1);
    parameter_destroy(&layer->wq);
    parameter_destroy(&layer->wk);
    parameter_destroy(&layer->wv);
    parameter_destroy(&layer->wo);
    parameter_destroy(&layer->norm2);
    parameter_destroy(&layer->w1);
    parameter_destroy(&layer->w2);
    free(names);
}

static void cache_create(LayerCache *cache, const Config *cfg)
{
    size_t td = (size_t)cfg->context * cfg->dim;
    size_t tf = (size_t)cfg->context * cfg->ff;
    size_t htt = (size_t)cfg->heads * cfg->context * cfg->context;
    cache->x = zero_alloc(td, sizeof(float));
    cache->n1 = zero_alloc(td, sizeof(float));
    cache->q = zero_alloc(td, sizeof(float));
    cache->k = zero_alloc(td, sizeof(float));
    cache->v = zero_alloc(td, sizeof(float));
    cache->att = zero_alloc(td, sizeof(float));
    cache->prob = zero_alloc(htt, sizeof(float));
    cache->r1 = zero_alloc(td, sizeof(float));
    cache->n2 = zero_alloc(td, sizeof(float));
    cache->fpre = zero_alloc(tf, sizeof(float));
    cache->fact = zero_alloc(tf, sizeof(float));
    cache->attention_mask = zero_alloc(td, sizeof(float));
    cache->feed_forward_mask = zero_alloc(td, sizeof(float));
}

static void cache_destroy(LayerCache *cache)
{
    free(cache->x);
    free(cache->n1);
    free(cache->q);
    free(cache->k);
    free(cache->v);
    free(cache->att);
    free(cache->prob);
    free(cache->r1);
    free(cache->n2);
    free(cache->fpre);
    free(cache->fact);
    free(cache->attention_mask);
    free(cache->feed_forward_mask);
    memset(cache, 0, sizeof(*cache));
}

static void work_create(Work *work, const Config *cfg)
{
    size_t td = (size_t)cfg->context * cfg->dim;
    size_t tf = (size_t)cfg->context * cfg->ff;
    size_t htt = (size_t)cfg->heads * cfg->context * cfg->context;
    work->dy = zero_alloc(td, sizeof(float));
    work->dx = zero_alloc(td, sizeof(float));
    work->dr1 = zero_alloc(td, sizeof(float));
    work->dn2 = zero_alloc(td, sizeof(float));
    work->datt = zero_alloc(td, sizeof(float));
    work->dq = zero_alloc(td, sizeof(float));
    work->dk = zero_alloc(td, sizeof(float));
    work->dv = zero_alloc(td, sizeof(float));
    work->dn1 = zero_alloc(td, sizeof(float));
    work->dact = zero_alloc(tf, sizeof(float));
    work->dfpre = zero_alloc(tf, sizeof(float));
    work->tmp_td = zero_alloc(td, sizeof(float));
    work->attention_matrix = zero_alloc(htt, sizeof(float));
}

static void work_destroy(Work *work)
{
    free(work->dy);
    free(work->dx);
    free(work->dr1);
    free(work->dn2);
    free(work->datt);
    free(work->dq);
    free(work->dk);
    free(work->dv);
    free(work->dn1);
    free(work->dact);
    free(work->dfpre);
    free(work->tmp_td);
    free(work->attention_matrix);
    memset(work, 0, sizeof(*work));
}

static void model_create(Model *model, Config cfg, Rng *rng)
{
    int layer_index;
    int parameter_index = 0;
    size_t td = (size_t)cfg.context * cfg.dim;

    memset(model, 0, sizeof(*model));
    model->cfg = cfg;
    parameter_create(&model->token_embedding, "token_embedding",
                     (size_t)cfg.vocab * cfg.dim, 1);
    parameter_create(&model->final_norm, "final_norm", cfg.dim, 0);
    parameter_random(&model->token_embedding, rng, 0.02f);
    if (!cfg.rotary) {
        parameter_create(&model->position_embedding, "position_embedding", td,
                         1);
        parameter_random(&model->position_embedding, rng, 0.02f);
    }
    parameter_ones(&model->final_norm);

    model->layer = zero_alloc((size_t)cfg.layers, sizeof(*model->layer));
    model->cache = zero_alloc((size_t)cfg.layers, sizeof(*model->cache));
    for (layer_index = 0; layer_index < cfg.layers; ++layer_index) {
        layer_parameters_create(&model->layer[layer_index], layer_index, &cfg,
                                rng);
        cache_create(&model->cache[layer_index], &cfg);
    }

    model->parameter_count = (cfg.rotary ? 2 : 3) + cfg.layers * 8;
    model->parameters = zero_alloc((size_t)model->parameter_count,
                                   sizeof(*model->parameters));
    model->parameters[parameter_index++] = &model->token_embedding;
    if (!cfg.rotary) {
        model->parameters[parameter_index++] = &model->position_embedding;
    }
    for (layer_index = 0; layer_index < cfg.layers; ++layer_index) {
        TransformerLayer *layer = &model->layer[layer_index];
        model->parameters[parameter_index++] = &layer->norm1;
        model->parameters[parameter_index++] = &layer->wq;
        model->parameters[parameter_index++] = &layer->wk;
        model->parameters[parameter_index++] = &layer->wv;
        model->parameters[parameter_index++] = &layer->wo;
        model->parameters[parameter_index++] = &layer->norm2;
        model->parameters[parameter_index++] = &layer->w1;
        model->parameters[parameter_index++] = &layer->w2;
    }
    model->parameters[parameter_index++] = &model->final_norm;
    if (parameter_index != model->parameter_count) {
        fail("internal parameter registry mismatch");
    }

    model->final_x = zero_alloc(td, sizeof(float));
    model->final_n = zero_alloc(td, sizeof(float));
    model->probs = zero_alloc((size_t)cfg.context * cfg.vocab, sizeof(float));
    if (cfg.rotary) {
        int head_width = cfg.dim / cfg.heads;
        int pair_count = head_width / 2;
        int time;
        int pair;
        model->rope_cos = zero_alloc((size_t)cfg.context * pair_count,
                                     sizeof(float));
        model->rope_sin = zero_alloc((size_t)cfg.context * pair_count,
                                     sizeof(float));
        for (time = 0; time < cfg.context; ++time) {
            for (pair = 0; pair < pair_count; ++pair) {
                float frequency =
                    powf(10000.0f, -(2.0f * pair) / head_width);
                float angle = time * frequency;
                model->rope_cos[time * pair_count + pair] = cosf(angle);
                model->rope_sin[time * pair_count + pair] = sinf(angle);
            }
        }
    }
    work_create(&model->work, &cfg);
}

static void model_destroy(Model *model)
{
    int i;
    parameter_destroy(&model->token_embedding);
    if (!model->cfg.rotary) {
        parameter_destroy(&model->position_embedding);
    }
    for (i = 0; i < model->cfg.layers; ++i) {
        layer_parameters_destroy(&model->layer[i]);
        cache_destroy(&model->cache[i]);
    }
    parameter_destroy(&model->final_norm);
    free(model->layer);
    free(model->cache);
    free(model->parameters);
    free(model->final_x);
    free(model->final_n);
    free(model->probs);
    free(model->rope_cos);
    free(model->rope_sin);
    work_destroy(&model->work);
    memset(model, 0, sizeof(*model));
}

static size_t model_parameter_total(const Model *model)
{
    size_t total = 0;
    int i;
    for (i = 0; i < model->parameter_count; ++i) {
        total += model->parameters[i]->count;
    }
    return total;
}

static void model_zero_grad(Model *model)
{
    int i;
    for (i = 0; i < model->parameter_count; ++i) {
        Parameter *parameter = model->parameters[i];
        memset(parameter->g, 0, parameter->count * sizeof(float));
    }
}

static void rope_apply(const Model *model, float *values, int inverse)
{
    const Config *cfg = &model->cfg;
    int head_width = cfg->dim / cfg->heads;
    int pair_count = head_width / 2;
    int head;
    int time;
    int pair;
    for (time = 0; time < cfg->context; ++time) {
        for (head = 0; head < cfg->heads; ++head) {
            int head_offset = head * head_width;
            for (pair = 0; pair < pair_count; ++pair) {
                int offset = time * cfg->dim + head_offset + 2 * pair;
                float c = model->rope_cos[time * pair_count + pair];
                float s = model->rope_sin[time * pair_count + pair];
                float a = values[offset];
                float b = values[offset + 1];
                if (inverse) s = -s;
                values[offset] = a * c - b * s;
                values[offset + 1] = a * s + b * c;
            }
        }
    }
}

static void attention_forward(const Config *cfg, LayerCache *cache)
{
    int head;
    int time;
    int source;
    int i;
    int head_width = cfg->dim / cfg->heads;
    float scale = 1.0f / sqrtf((float)head_width);

#ifdef USE_ACCELERATE
    (void)i;
    for (head = 0; head < cfg->heads; ++head) {
        int offset = head * head_width;
        float *matrix =
            &cache->prob[(size_t)head * cfg->context * cfg->context];
        cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasTrans, cfg->context,
                    cfg->context, head_width, scale, cache->q + offset,
                    cfg->dim, cache->k + offset, cfg->dim, 0.0f, matrix,
                    cfg->context);
        for (time = 0; time < cfg->context; ++time) {
            float *row = matrix + (size_t)time * cfg->context;
            float maximum = -INFINITY;
            float total = 0.0f;
            for (source = 0; source <= time; ++source) {
                if (row[source] > maximum) maximum = row[source];
            }
            for (source = 0; source <= time; ++source) {
                row[source] = expf(row[source] - maximum);
                total += row[source];
            }
            for (source = 0; source <= time; ++source) row[source] /= total;
            for (source = time + 1; source < cfg->context; ++source) {
                row[source] = 0.0f;
            }
        }
        cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, cfg->context,
                    head_width, cfg->context, 1.0f, matrix, cfg->context,
                    cache->v + offset, cfg->dim, 0.0f, cache->att + offset,
                    cfg->dim);
    }
#else
    for (head = 0; head < cfg->heads; ++head) {
        int offset = head * head_width;
        for (time = 0; time < cfg->context; ++time) {
            float *row = &cache->prob[((size_t)head * cfg->context + time) *
                                     cfg->context];
            float maximum = -INFINITY;
            float total = 0.0f;
            for (source = 0; source <= time; ++source) {
                float score = 0.0f;
                for (i = 0; i < head_width; ++i) {
                    score += cache->q[time * cfg->dim + offset + i] *
                             cache->k[source * cfg->dim + offset + i];
                }
                row[source] = score * scale;
                if (row[source] > maximum) {
                    maximum = row[source];
                }
            }
            for (source = 0; source <= time; ++source) {
                row[source] = expf(row[source] - maximum);
                total += row[source];
            }
            for (source = 0; source <= time; ++source) {
                row[source] /= total;
            }
            for (i = 0; i < head_width; ++i) {
                float value = 0.0f;
                for (source = 0; source <= time; ++source) {
                    value += row[source] *
                             cache->v[source * cfg->dim + offset + i];
                }
                cache->att[time * cfg->dim + offset + i] = value;
            }
        }
    }
#endif
}

static void attention_backward(const Config *cfg, const LayerCache *cache,
                               const float *datt, float *dq, float *dk,
                               float *dv, float *scratch)
{
    int head;
    int time;
    int source;
    int i;
    int head_width = cfg->dim / cfg->heads;
    float scale = 1.0f / sqrtf((float)head_width);

#ifdef USE_ACCELERATE
    (void)i;
    for (head = 0; head < cfg->heads; ++head) {
        int offset = head * head_width;
        const float *prob =
            &cache->prob[(size_t)head * cfg->context * cfg->context];
        float *dscore =
            scratch + (size_t)head * cfg->context * cfg->context;
        cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasTrans, cfg->context,
                    cfg->context, head_width, 1.0f, datt + offset, cfg->dim,
                    cache->v + offset, cfg->dim, 0.0f, dscore, cfg->context);
        for (time = 0; time < cfg->context; ++time) {
            const float *prob_row = prob + (size_t)time * cfg->context;
            float *gradient_row = dscore + (size_t)time * cfg->context;
            float weighted_gradient = 0.0f;
            for (source = 0; source <= time; ++source) {
                weighted_gradient += prob_row[source] * gradient_row[source];
            }
            for (source = 0; source <= time; ++source) {
                gradient_row[source] =
                    prob_row[source] *
                    (gradient_row[source] - weighted_gradient) * scale;
            }
            for (source = time + 1; source < cfg->context; ++source) {
                gradient_row[source] = 0.0f;
            }
        }
        cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, cfg->context,
                    head_width, cfg->context, 1.0f, prob, cfg->context,
                    datt + offset, cfg->dim, 1.0f, dv + offset, cfg->dim);
        cblas_sgemm(CblasRowMajor, CblasNoTrans, CblasNoTrans, cfg->context,
                    head_width, cfg->context, 1.0f, dscore, cfg->context,
                    cache->k + offset, cfg->dim, 1.0f, dq + offset, cfg->dim);
        cblas_sgemm(CblasRowMajor, CblasTrans, CblasNoTrans, cfg->context,
                    head_width, cfg->context, 1.0f, dscore, cfg->context,
                    cache->q + offset, cfg->dim, 1.0f, dk + offset, cfg->dim);
    }
#else
    for (head = 0; head < cfg->heads; ++head) {
        int offset = head * head_width;
        for (time = 0; time < cfg->context; ++time) {
            const float *row =
                &cache->prob[((size_t)head * cfg->context + time) *
                             cfg->context];
            float weighted_gradient = 0.0f;
            for (source = 0; source <= time; ++source) {
                float dprob = 0.0f;
                for (i = 0; i < head_width; ++i) {
                    dprob += datt[time * cfg->dim + offset + i] *
                             cache->v[source * cfg->dim + offset + i];
                    dv[source * cfg->dim + offset + i] +=
                        row[source] * datt[time * cfg->dim + offset + i];
                }
                weighted_gradient += row[source] * dprob;
            }
            for (source = 0; source <= time; ++source) {
                float dprob = 0.0f;
                float dscore;
                for (i = 0; i < head_width; ++i) {
                    dprob += datt[time * cfg->dim + offset + i] *
                             cache->v[source * cfg->dim + offset + i];
                }
                dscore = row[source] * (dprob - weighted_gradient) * scale;
                for (i = 0; i < head_width; ++i) {
                    dq[time * cfg->dim + offset + i] +=
                        dscore * cache->k[source * cfg->dim + offset + i];
                    dk[source * cfg->dim + offset + i] +=
                        dscore * cache->q[time * cfg->dim + offset + i];
                }
            }
        }
    }
#endif
}

/* Forward returns mean next-token cross entropy when targets is non-NULL. */
static float model_forward_masked(Model *model, const Token *tokens,
                                  const Token *targets, float dropout,
                                  Rng *dropout_rng,
                                  const unsigned char *loss_mask)
{
    const Config *cfg = &model->cfg;
    size_t td = (size_t)cfg->context * cfg->dim;
    size_t tf = (size_t)cfg->context * cfg->ff;
    int time;
    int i;
    int layer_index;
    float loss_weight = (float)cfg->context;
    float loss = 0.0f;
    LayerCache *first = &model->cache[0];

    if (loss_mask != NULL) {
        loss_weight = 0.0f;
        for (time = 0; time < cfg->context; ++time) {
            loss_weight += loss_mask[time];
        }
        if (loss_weight == 0.0f) loss_weight = 1.0f;
    }

    for (time = 0; time < cfg->context; ++time) {
        int token = tokens[time];
        for (i = 0; i < cfg->dim; ++i) {
            first->x[time * cfg->dim + i] =
                model->token_embedding.w[token * cfg->dim + i];
            if (!cfg->rotary) {
                first->x[time * cfg->dim + i] +=
                    model->position_embedding.w[time * cfg->dim + i];
            }
        }
    }

    for (layer_index = 0; layer_index < cfg->layers; ++layer_index) {
        TransformerLayer *layer = &model->layer[layer_index];
        LayerCache *cache = &model->cache[layer_index];
        float *output = layer_index + 1 < cfg->layers
                            ? model->cache[layer_index + 1].x
                            : model->final_x;

        rmsnorm_forward(cache->x, layer->norm1.w, cache->n1, cfg->context,
                        cfg->dim);
        linear_forward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                       layer->wq.w, cache->q);
        linear_forward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                       layer->wk.w, cache->k);
        linear_forward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                       layer->wv.w, cache->v);
        if (cfg->rotary) {
            rope_apply(model, cache->q, 0);
            rope_apply(model, cache->k, 0);
        }
        attention_forward(cfg, cache);
        linear_forward(cfg->context, cfg->dim, cfg->dim, cache->att,
                       layer->wo.w, model->work.tmp_td);
        for (i = 0; i < (int)td; ++i) {
            float mask = 1.0f;
            if (dropout > 0.0f) {
                mask = rng_unit(dropout_rng) >= dropout
                           ? 1.0f / (1.0f - dropout)
                           : 0.0f;
            }
            cache->attention_mask[i] = mask;
            cache->r1[i] = cache->x[i] + model->work.tmp_td[i] * mask;
        }

        rmsnorm_forward(cache->r1, layer->norm2.w, cache->n2, cfg->context,
                        cfg->dim);
        linear_forward(cfg->context, cfg->dim, cfg->ff, cache->n2,
                       layer->w1.w, cache->fpre);
        for (i = 0; i < (int)tf; ++i) {
            cache->fact[i] = gelu(cache->fpre[i]);
        }
        linear_forward(cfg->context, cfg->ff, cfg->dim, cache->fact,
                       layer->w2.w, model->work.tmp_td);
        for (i = 0; i < (int)td; ++i) {
            float mask = 1.0f;
            if (dropout > 0.0f) {
                mask = rng_unit(dropout_rng) >= dropout
                           ? 1.0f / (1.0f - dropout)
                           : 0.0f;
            }
            cache->feed_forward_mask[i] = mask;
            output[i] = cache->r1[i] + model->work.tmp_td[i] * mask;
        }
    }

    rmsnorm_forward(model->final_x, model->final_norm.w, model->final_n,
                    cfg->context, cfg->dim);
    linear_forward(cfg->context, cfg->dim, cfg->vocab, model->final_n,
                   model->token_embedding.w, model->probs);

    for (time = 0; time < cfg->context; ++time) {
        float *row = &model->probs[time * cfg->vocab];
        float maximum = row[0];
        float total = 0.0f;
        int token;
        for (token = 1; token < cfg->vocab; ++token) {
            if (row[token] > maximum) {
                maximum = row[token];
            }
        }
        for (token = 0; token < cfg->vocab; ++token) {
            row[token] = expf(row[token] - maximum);
            total += row[token];
        }
        for (token = 0; token < cfg->vocab; ++token) {
            row[token] /= total;
        }
        if (targets != NULL &&
            (loss_mask == NULL || loss_mask[time] != 0)) {
            float probability = row[targets[time]];
            if (probability < 1.0e-20f) {
                probability = 1.0e-20f;
            }
            loss -= (loss_mask == NULL ? 1.0f : loss_mask[time]) *
                    logf(probability) / loss_weight;
        }
    }
    return loss;
}

static float model_forward(Model *model, const Token *tokens,
                           const Token *targets, float dropout,
                           Rng *dropout_rng)
{
    return model_forward_masked(model, tokens, targets, dropout, dropout_rng,
                                NULL);
}

static float model_blended_loss(const Model *model, const Token *targets,
                                const unsigned char *loss_mask,
                                const unsigned char *teacher_mask,
                                const float *const *teacher_probabilities,
                                const float *teacher_weights,
                                int teacher_count)
{
    const Config *cfg = &model->cfg;
    float loss = 0.0f;
    float loss_weight = (float)cfg->context;
    int time;
    int token;

    if (loss_mask != NULL) {
        loss_weight = 0.0f;
        for (time = 0; time < cfg->context; ++time) {
            loss_weight += loss_mask[time];
        }
        if (loss_weight == 0.0f) loss_weight = 1.0f;
    }
    for (time = 0; time < cfg->context; ++time) {
        const float *student = &model->probs[time * cfg->vocab];
        float soft_weight = 0.0f;
        float hard_weight;
        int teacher;
        if (loss_mask != NULL && !loss_mask[time]) continue;
        if (teacher_mask == NULL || teacher_mask[time]) {
            for (teacher = 0; teacher < teacher_count; ++teacher) {
                if (teacher_probabilities[teacher] != NULL) {
                    soft_weight += teacher_weights[teacher];
                }
            }
        }
        hard_weight = 1.0f - soft_weight;
        if (hard_weight > 0.0f) {
            float probability = student[targets[time]];
            if (probability < 1.0e-20f) probability = 1.0e-20f;
            loss -= (loss_mask == NULL ? 1.0f : loss_mask[time]) *
                    hard_weight * logf(probability) / loss_weight;
        }
        for (token = 0; token < cfg->vocab; ++token) {
            float probability = student[token];
            float target_probability = 0.0f;
            if (probability < 1.0e-20f) probability = 1.0e-20f;
            if (teacher_mask == NULL || teacher_mask[time]) {
                for (teacher = 0; teacher < teacher_count; ++teacher) {
                    if (teacher_probabilities[teacher] != NULL) {
                        target_probability += teacher_weights[teacher] *
                            teacher_probabilities[teacher]
                                [time * cfg->vocab + token];
                    }
                }
            }
            if (target_probability > 0.0f) {
                loss -= (loss_mask == NULL ? 1.0f : loss_mask[time]) *
                        target_probability * logf(probability) / loss_weight;
            }
        }
    }
    return loss;
}

/* Adds this sequence's gradients; call model_zero_grad before a new batch. */
static void model_backward_blended_masked(
    Model *model, const Token *tokens, const Token *targets,
    const unsigned char *loss_mask, const unsigned char *teacher_mask,
    const float *const *teacher_probabilities, const float *teacher_weights,
    int teacher_count)
{
    const Config *cfg = &model->cfg;
    size_t td = (size_t)cfg->context * cfg->dim;
    size_t tf = (size_t)cfg->context * cfg->ff;
    Work *work = &model->work;
    float *dy = work->dy;
    float *dx = work->dx;
    int time;
    int token;
    int i;
    int layer_index;
    float loss_weight = (float)cfg->context;

    if (loss_mask != NULL) {
        loss_weight = 0.0f;
        for (time = 0; time < cfg->context; ++time) {
            loss_weight += loss_mask[time];
        }
        if (loss_weight == 0.0f) loss_weight = 1.0f;
    }

    memset(dy, 0, td * sizeof(float));
    for (time = 0; time < cfg->context; ++time) {
        float *row = &model->probs[time * cfg->vocab];
        float soft_weight = 0.0f;
        float hard_weight;
        int teacher;
        if (teacher_mask == NULL || teacher_mask[time]) {
            for (teacher = 0; teacher < teacher_count; ++teacher) {
                if (teacher_probabilities[teacher] != NULL) {
                    soft_weight += teacher_weights[teacher];
                }
            }
        }
        hard_weight = 1.0f - soft_weight;
        for (token = 0; token < cfg->vocab; ++token) {
            float target_probability =
                token == targets[time] ? hard_weight : 0.0f;
            if (teacher_mask == NULL || teacher_mask[time]) {
                for (teacher = 0; teacher < teacher_count; ++teacher) {
                    if (teacher_probabilities[teacher] != NULL) {
                        target_probability += teacher_weights[teacher] *
                            teacher_probabilities[teacher]
                                [time * cfg->vocab + token];
                    }
                }
            }
            row[token] = loss_mask != NULL && !loss_mask[time]
                             ? 0.0f
                             : (row[token] - target_probability) *
                                   (loss_mask == NULL ? 1.0f : loss_mask[time]) /
                                   loss_weight;
        }
    }
    linear_backward(cfg->context, cfg->dim, cfg->vocab, model->final_n,
                    model->token_embedding.w, model->probs,
                    model->token_embedding.g, dy);

    memset(dx, 0, td * sizeof(float));
    rmsnorm_backward(model->final_x, model->final_norm.w, dy, dx,
                     model->final_norm.g, cfg->context, cfg->dim);
    {
        float *swap = dy;
        dy = dx;
        dx = swap;
    }

    for (layer_index = cfg->layers - 1; layer_index >= 0; --layer_index) {
        TransformerLayer *layer = &model->layer[layer_index];
        LayerCache *cache = &model->cache[layer_index];

        memcpy(work->dr1, dy, td * sizeof(float));
        memset(work->dact, 0, tf * sizeof(float));
        for (i = 0; i < (int)td; ++i) {
            work->tmp_td[i] = dy[i] * cache->feed_forward_mask[i];
        }
        linear_backward(cfg->context, cfg->ff, cfg->dim, cache->fact,
                        layer->w2.w, work->tmp_td, layer->w2.g, work->dact);
        for (i = 0; i < (int)tf; ++i) {
            work->dfpre[i] =
                work->dact[i] * gelu_derivative(cache->fpre[i]);
        }
        memset(work->dn2, 0, td * sizeof(float));
        linear_backward(cfg->context, cfg->dim, cfg->ff, cache->n2,
                        layer->w1.w, work->dfpre, layer->w1.g, work->dn2);
        rmsnorm_backward(cache->r1, layer->norm2.w, work->dn2, work->dr1,
                         layer->norm2.g, cfg->context, cfg->dim);

        memcpy(dx, work->dr1, td * sizeof(float));
        memset(work->datt, 0, td * sizeof(float));
        for (i = 0; i < (int)td; ++i) {
            work->tmp_td[i] =
                work->dr1[i] * cache->attention_mask[i];
        }
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->att,
                        layer->wo.w, work->tmp_td, layer->wo.g, work->datt);
        memset(work->dq, 0, td * sizeof(float));
        memset(work->dk, 0, td * sizeof(float));
        memset(work->dv, 0, td * sizeof(float));
        attention_backward(cfg, cache, work->datt, work->dq, work->dk,
                           work->dv, work->attention_matrix);
        if (cfg->rotary) {
            rope_apply(model, work->dq, 1);
            rope_apply(model, work->dk, 1);
        }
        memset(work->dn1, 0, td * sizeof(float));
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wq.w, work->dq, layer->wq.g, work->dn1);
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wk.w, work->dk, layer->wk.g, work->dn1);
        linear_backward(cfg->context, cfg->dim, cfg->dim, cache->n1,
                        layer->wv.w, work->dv, layer->wv.g, work->dn1);
        rmsnorm_backward(cache->x, layer->norm1.w, work->dn1, dx,
                         layer->norm1.g, cfg->context, cfg->dim);

        {
            float *swap = dy;
            dy = dx;
            dx = swap;
        }
    }

    for (time = 0; time < cfg->context; ++time) {
        int input_token = tokens[time];
        for (i = 0; i < cfg->dim; ++i) {
            float gradient = dy[time * cfg->dim + i];
            model->token_embedding.g[input_token * cfg->dim + i] += gradient;
            if (!cfg->rotary) {
                model->position_embedding.g[time * cfg->dim + i] += gradient;
            }
        }
    }
}

static void model_backward_masked(Model *model, const Token *tokens,
                                  const Token *targets,
                                  const unsigned char *loss_mask)
{
    model_backward_blended_masked(model, tokens, targets, loss_mask, NULL,
                                  NULL, NULL, 0);
}

static void model_backward(Model *model, const Token *tokens,
                           const Token *targets)
{
    model_backward_masked(model, tokens, targets, NULL);
}

static float optimizer_update(Model *model, uint64_t step, float learning_rate,
                              float weight_decay, float clip_limit,
                              float batch_scale)
{
    const float beta1 = 0.9f;
    const float beta2 = 0.999f;
    const float epsilon = 1.0e-8f;
    double sum_squares = 0.0;
    float gradient_norm;
    float clip_scale = 1.0f;
    float correction;
    int parameter_index;

    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        size_t i;
        for (i = 0; i < parameter->count; ++i) {
            double gradient = parameter->g[i] * batch_scale;
            sum_squares += gradient * gradient;
        }
    }
    gradient_norm = (float)sqrt(sum_squares);
    if (clip_limit > 0.0f && gradient_norm > clip_limit) {
        clip_scale = clip_limit / gradient_norm;
    }
    correction = learning_rate *
                 sqrtf(1.0f - powf(beta2, (float)step)) /
                 (1.0f - powf(beta1, (float)step));

    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        size_t i;
        for (i = 0; i < parameter->count; ++i) {
            float gradient = parameter->g[i] * batch_scale * clip_scale;
            parameter->m[i] = beta1 * parameter->m[i] + (1.0f - beta1) * gradient;
            parameter->v[i] =
                beta2 * parameter->v[i] + (1.0f - beta2) * gradient * gradient;
            parameter->w[i] -=
                correction * parameter->m[i] /
                    (sqrtf(parameter->v[i]) + epsilon) +
                (parameter->decay ? learning_rate * weight_decay * parameter->w[i]
                                  : 0.0f);
        }
    }
    return gradient_norm;
}

static void corpus_reserve(Corpus *corpus, size_t required)
{
    size_t capacity;
    if (required <= corpus->capacity) {
        return;
    }
    capacity = corpus->capacity == 0 ? 4096 : corpus->capacity;
    while (capacity < required) {
        if (capacity > SIZE_MAX / 2) {
            capacity = required;
            break;
        }
        capacity *= 2;
    }
    corpus->data = resize_alloc(corpus->data, capacity, sizeof(Token));
    corpus->capacity = capacity;
}

static void corpus_append(Corpus *corpus, const Token *data,
                          size_t length)
{
    if (length > SIZE_MAX - corpus->length) {
        fail("corpus is too large");
    }
    corpus_reserve(corpus, corpus->length + length);
    memcpy(corpus->data + corpus->length, data, length * sizeof(Token));
    corpus->length += length;
}

static void corpus_add_file(Corpus *corpus, const char *path, int token_width)
{
    unsigned char byte_buffer[65536];
    Token token_buffer[32768];
    FILE *file = fopen(path, "rb");
    size_t amount;
    if (file == NULL) {
        fail_path("open", path);
    }
    if (corpus->length != 0) {
        static const Token separator[] = {'\n', '\n'};
        corpus_append(corpus, separator, 2);
    }
    for (;;) {
        amount = token_width == 2
                     ? fread(token_buffer, sizeof(Token),
                             sizeof(token_buffer) / sizeof(token_buffer[0]), file)
                     : fread(byte_buffer, 1, sizeof(byte_buffer), file);
        if (amount != 0) {
            if (token_width == 1) {
                size_t i;
                for (i = 0; i < amount; ++i) token_buffer[i] = byte_buffer[i];
            }
            corpus_append(corpus, token_buffer, amount);
        }
        if (amount < (token_width == 2
                          ? sizeof(token_buffer) / sizeof(token_buffer[0])
                          : sizeof(byte_buffer))) {
            if (ferror(file)) {
                fclose(file);
                fail_path("read", path);
            }
            break;
        }
    }
    if (fclose(file) != 0) {
        fail_path("close", path);
    }
}

static void corpus_use_sample(Corpus *corpus)
{
    size_t length = strlen(SAMPLE_TEXT);
    size_t i;
    corpus_reserve(corpus, length);
    for (i = 0; i < length; ++i) {
        corpus->data[corpus->length++] = (unsigned char)SAMPLE_TEXT[i];
    }
}

static void corpus_destroy(Corpus *corpus)
{
    free(corpus->data);
    memset(corpus, 0, sizeof(*corpus));
}

static int token_text_at(const Token *tokens, int start, int end,
                         const char *text)
{
    int index;
    for (index = 0; text[index] != '\0'; ++index) {
        if (start + index >= end ||
            tokens[start + index] != (unsigned char)text[index]) {
            return 0;
        }
    }
    return index;
}

static void weight_artifact_span(const Token *targets, unsigned char *mask,
                                 int start, int end, int artifact_weight)
{
    static const char prefix[] = "@artifact ";
    static const char suffix[] = " @summary ";
    int artifact_start = -1;
    int artifact_end = -1;
    int time;
    if (artifact_weight <= 1) return;
    for (time = start; time < end; ++time) {
        int length = token_text_at(targets, time, end, prefix);
        if (length != 0) {
            artifact_start = time + length;
            break;
        }
    }
    if (artifact_start < 0) return;
    for (time = artifact_start; time < end; ++time) {
        if (token_text_at(targets, time, end, suffix) != 0) {
            artifact_end = time;
            break;
        }
    }
    if (artifact_end < artifact_start) return;
    for (time = artifact_start; time < artifact_end; ++time) {
        mask[time] = (unsigned char)artifact_weight;
    }
}

static int channel_loss_mask(const Token *tokens, const Token *targets,
                             unsigned char *mask, int context,
                             int artifact_weight)
{
    int active = 0;
    int count = 0;
    int span_start = -1;
    int time;
    for (time = 0; time < context; ++time) {
        if (tokens[time] == CHANNEL_TARGET_TOKEN) {
            active = 1;
            span_start = time;
        }
        mask[time] = (unsigned char)active;
        if (active) ++count;
        if (targets[time] == CHANNEL_MESSAGE_END_TOKEN ||
            targets[time] == CHANNEL_RECORD_END_TOKEN) {
            if (span_start >= 0) {
                weight_artifact_span(targets, mask, span_start, time,
                                     artifact_weight);
            }
            active = 0;
            span_start = -1;
        }
    }
    if (span_start >= 0) {
        weight_artifact_span(targets, mask, span_start, context,
                             artifact_weight);
    }
    return count;
}

static int find_target_text(const Token *targets, int start, int end,
                            const char *text)
{
    int time;
    for (time = start; time < end; ++time) {
        if (token_text_at(targets, time, end, text) != 0) return time;
    }
    return -1;
}

/*
 * Historical channel replies contain only semantic reply bytes, so their
 * complete target span remains teacher-eligible. Structured faculty chunks
 * keep controller grammar hard: teachers may regularize artifact and summary
 * contents, but never @tags or executable @request spans.
 */
static void channel_teacher_mask(const Token *targets,
                                 const unsigned char *loss_mask,
                                 unsigned char *teacher_mask, int context)
{
    static const char artifact_prefix[] = "@artifact ";
    static const char summary_prefix[] = " @summary ";
    static const char close_prefix[] = " @close";
    static const char request_prefix[] = "@request ";
    int start = 0;
    int end = context;
    int artifact;
    int summary;
    int close;
    int request;
    int time;
    while (start < context && !loss_mask[start]) ++start;
    while (end > start && !loss_mask[end - 1]) --end;
    for (time = 0; time < context; ++time) {
        teacher_mask[time] = loss_mask[time] ? 1U : 0U;
    }
    if (start == end) return;
    artifact = find_target_text(targets, start, end, artifact_prefix);
    request = find_target_text(targets, start, end, request_prefix);
    if (artifact < 0 && request < 0) return;
    memset(teacher_mask, 0, (size_t)context);
    if (request >= 0) return;
    summary = find_target_text(targets, artifact, end, summary_prefix);
    close = find_target_text(targets,
                             summary >= 0 ? summary : artifact, end,
                             close_prefix);
    if (summary < 0) return;
    for (time = artifact + (int)strlen(artifact_prefix); time < summary;
         ++time) {
        teacher_mask[time] = 1U;
    }
    if (close < 0) close = end;
    for (time = summary + (int)strlen(summary_prefix); time < close; ++time) {
        teacher_mask[time] = 1U;
    }
}

static void prepare_channel_range(CorpusRange *range, const Corpus *corpus,
                                  int context, const char *path)
{
    size_t end = range->start + range->length;
    size_t index;
    size_t split;
    size_t training_records = 0;
    size_t validation_records = 0;
    for (index = range->start; index < end; ++index) {
        if (corpus->data[index] == CHANNEL_START_TOKEN) ++range->record_count;
    }
    if (range->record_count < 20) {
        fprintf(stderr, "error: channel file '%s' contains only %zu records\n",
                path, range->record_count);
        exit(EXIT_FAILURE);
    }
    range->record_starts = zero_alloc(range->record_count,
                                      sizeof(*range->record_starts));
    range->record_count = 0;
    for (index = range->start; index < end; ++index) {
        if (corpus->data[index] == CHANNEL_START_TOKEN) {
            range->record_starts[range->record_count++] = index;
        }
    }
    split = range->record_count * 95 / 100;
    if (split == 0) split = 1;
    if (split >= range->record_count) split = range->record_count - 1;
    range->validation_record_index = split;
    range->validation_start = range->record_starts[split];
    range->training_length = range->validation_start - range->start;
    range->validation_length = end - range->validation_start;
    for (index = 0; index < split; ++index) {
        if (range->record_starts[index] + (size_t)context + 1 <=
            range->validation_start) {
            ++training_records;
        }
    }
    for (index = split; index < range->record_count; ++index) {
        if (range->record_starts[index] + (size_t)context + 1 <= end) {
            ++validation_records;
        }
    }
    if (training_records == 0 || validation_records == 0) {
        fprintf(stderr,
                "error: channel file '%s' lacks complete %d-token windows\n",
                path, context);
        exit(EXIT_FAILURE);
    }
    range->training_record_count = training_records;
    range->validation_record_count = validation_records;
}

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t vocab;
    uint32_t context;
    uint32_t dim;
    uint32_t heads;
    uint32_t layers;
    uint32_t ff;
    uint32_t parameter_count;
    uint32_t reserved;
    uint64_t step;
    uint64_t rng_state;
} CheckpointHeader;

typedef struct {
    uint64_t attempts;
    uint32_t consecutive_rejections;
    uint32_t transaction_mode;
} CheckpointOrchestration;

static const char CHECKPOINT_MAGIC[8] = {'Z', 'E', 'R', 'O', 'L', 'M', '2', '\0'};
static const char TEACHER_MAGIC[8] = {'Z', 'E', 'R', 'O', 'T', 'C', 'H', '1'};

static int write_items(FILE *file, const void *data, size_t size, size_t count)
{
    return fwrite(data, size, count, file) == count;
}

static int read_items(FILE *file, void *data, size_t size, size_t count)
{
    return fread(data, size, count, file) == count;
}

static CheckpointHeader checkpoint_read_header(FILE *file, const char *path)
{
    CheckpointHeader header;
    if (!read_items(file, &header, sizeof(header), 1)) {
        fail_path("read checkpoint header from", path);
    }
    if (memcmp(header.magic, CHECKPOINT_MAGIC, sizeof(header.magic)) != 0 ||
        (header.version != 1U && header.version != 2U &&
         header.version != 3U &&
         header.version != CHECKPOINT_VERSION) ||
        header.vocab < 2 || header.vocab > MAX_VOCAB_SIZE) {
        fail("unsupported or corrupt checkpoint");
    }
    return header;
}

static CheckpointHeader artifact_read_header(FILE *file, const char *path,
                                             int *weight_only)
{
    CheckpointHeader header;
    if (!read_items(file, &header, sizeof(header), 1)) {
        fail_path("read model artifact header from", path);
    }
    *weight_only =
        memcmp(header.magic, TEACHER_MAGIC, sizeof(header.magic)) == 0;
    if (*weight_only) {
        if (header.version != 1U || header.vocab < 2 ||
            header.vocab > MAX_VOCAB_SIZE) {
            fail("unsupported or corrupt teacher artifact");
        }
    } else if (memcmp(header.magic, CHECKPOINT_MAGIC,
                      sizeof(header.magic)) != 0 ||
               (header.version != 1U && header.version != 2U &&
                header.version != 3U &&
                header.version != CHECKPOINT_VERSION) ||
               header.vocab < 2 || header.vocab > MAX_VOCAB_SIZE) {
        fail("unsupported or corrupt model artifact");
    }
    return header;
}

static Config checkpoint_peek(const char *path)
{
    Config cfg;
    CheckpointHeader header;
    FILE *file = fopen(path, "rb");
    if (file == NULL) {
        fail_path("open", path);
    }
    header = checkpoint_read_header(file, path);
    if (fclose(file) != 0) {
        fail_path("close", path);
    }
    cfg.context = (int)header.context;
    cfg.dim = (int)header.dim;
    cfg.heads = (int)header.heads;
    cfg.layers = (int)header.layers;
    cfg.ff = (int)header.ff;
    cfg.rotary = header.version >= 2U && (header.reserved & 1U) != 0;
    cfg.vocab = (int)header.vocab;
    return cfg;
}

static Config artifact_peek(const char *path)
{
    Config cfg;
    CheckpointHeader header;
    FILE *file = fopen(path, "rb");
    int weight_only;
    if (file == NULL) {
        fail_path("open", path);
    }
    header = artifact_read_header(file, path, &weight_only);
    (void)weight_only;
    if (fclose(file) != 0) {
        fail_path("close", path);
    }
    cfg.context = (int)header.context;
    cfg.dim = (int)header.dim;
    cfg.heads = (int)header.heads;
    cfg.layers = (int)header.layers;
    cfg.ff = (int)header.ff;
    cfg.rotary = header.version >= 2U && (header.reserved & 1U) != 0;
    if (memcmp(header.magic, TEACHER_MAGIC, sizeof(header.magic)) == 0) {
        cfg.rotary = (header.reserved & 1U) != 0;
    }
    cfg.vocab = (int)header.vocab;
    return cfg;
}

static void checkpoint_save(const char *path, const Model *model, uint64_t step,
                            const Rng *rng, uint64_t attempts,
                            uint32_t consecutive_rejections,
                            uint32_t transaction_mode)
{
    CheckpointHeader header;
    CheckpointOrchestration orchestration;
    char *temporary;
    FILE *file;
    int parameter_index;
    size_t path_length = strlen(path);

    temporary = zero_alloc(path_length + 5, sizeof(char));
    snprintf(temporary, path_length + 5, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) {
        free(temporary);
        fail_path("create checkpoint", path);
    }
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, CHECKPOINT_MAGIC, sizeof(header.magic));
    header.version = CHECKPOINT_VERSION;
    header.vocab = (uint32_t)model->cfg.vocab;
    header.context = (uint32_t)model->cfg.context;
    header.dim = (uint32_t)model->cfg.dim;
    header.heads = (uint32_t)model->cfg.heads;
    header.layers = (uint32_t)model->cfg.layers;
    header.ff = (uint32_t)model->cfg.ff;
    header.parameter_count = (uint32_t)model->parameter_count;
    header.reserved = model->cfg.rotary ? 1U : 0U;
    header.step = step;
    header.rng_state = rng->state;
    orchestration.attempts = attempts;
    orchestration.consecutive_rejections = consecutive_rejections;
    orchestration.transaction_mode = transaction_mode;

    if (!write_items(file, &header, sizeof(header), 1) ||
        !write_items(file, &orchestration, sizeof(orchestration), 1)) {
        fclose(file);
        remove(temporary);
        free(temporary);
        fail_path("write checkpoint", path);
    }
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        const Parameter *parameter = model->parameters[parameter_index];
        uint64_t count = (uint64_t)parameter->count;
        if (!write_items(file, &count, sizeof(count), 1) ||
            !write_items(file, parameter->w, sizeof(float), parameter->count) ||
            !write_items(file, parameter->m, sizeof(float), parameter->count) ||
            !write_items(file, parameter->v, sizeof(float), parameter->count)) {
            fclose(file);
            remove(temporary);
            free(temporary);
            fail_path("write checkpoint", path);
        }
    }
    if (fclose(file) != 0) {
        remove(temporary);
        free(temporary);
        fail_path("close checkpoint", path);
    }
    if (rename(temporary, path) != 0) {
        remove(temporary);
        free(temporary);
        fail_path("install checkpoint", path);
    }
    free(temporary);
}

static uint64_t checkpoint_load(const char *path, Model *model, Rng *rng,
                                uint64_t *attempts,
                                uint32_t *consecutive_rejections,
                                uint32_t *transaction_mode)
{
    CheckpointHeader header;
    CheckpointOrchestration orchestration = {0, 0, 0};
    FILE *file = fopen(path, "rb");
    int parameter_index;
    if (file == NULL) {
        fail_path("open", path);
    }
    header = checkpoint_read_header(file, path);
    if ((int)header.context != model->cfg.context ||
        (int)header.dim != model->cfg.dim ||
        (int)header.heads != model->cfg.heads ||
        (int)header.layers != model->cfg.layers ||
        (int)header.ff != model->cfg.ff ||
        (int)header.vocab != model->cfg.vocab ||
        ((header.version >= 2U && (header.reserved & 1U) != 0) !=
         model->cfg.rotary) ||
        (int)header.parameter_count != model->parameter_count) {
        fail("checkpoint architecture does not match model");
    }
    if (header.version >= 4U &&
        !read_items(file, &orchestration, sizeof(orchestration), 1)) {
        fclose(file);
        fail("checkpoint orchestration state is corrupt or incomplete");
    }
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        uint64_t count;
        if (!read_items(file, &count, sizeof(count), 1) ||
            count != parameter->count ||
            !read_items(file, parameter->w, sizeof(float), parameter->count) ||
            !read_items(file, parameter->m, sizeof(float), parameter->count) ||
            !read_items(file, parameter->v, sizeof(float), parameter->count)) {
            fclose(file);
            fprintf(stderr,
                    "error: checkpoint parameter %d (%s) is corrupt or "
                    "incomplete; file count=%llu expected=%zu\n",
                    parameter_index, parameter->name,
                    (unsigned long long)count, parameter->count);
            exit(EXIT_FAILURE);
        }
    }
    if (fclose(file) != 0) {
        fail_path("close", path);
    }
    rng->state = header.rng_state;
    *attempts = header.version >= 4U ? orchestration.attempts : header.step;
    *consecutive_rejections = orchestration.consecutive_rejections;
    *transaction_mode = orchestration.transaction_mode;
    return header.step;
}

static uint64_t artifact_load_weights(const char *path, Model *model)
{
    CheckpointHeader header;
    FILE *file = fopen(path, "rb");
    int parameter_index;
    int weight_only;
    if (file == NULL) {
        fail_path("open", path);
    }
    header = artifact_read_header(file, path, &weight_only);
    if ((int)header.context != model->cfg.context ||
        (int)header.dim != model->cfg.dim ||
        (int)header.heads != model->cfg.heads ||
        (int)header.layers != model->cfg.layers ||
        (int)header.ff != model->cfg.ff ||
        (int)header.vocab != model->cfg.vocab ||
        ((header.reserved & 1U) != 0) != model->cfg.rotary ||
        (int)header.parameter_count != model->parameter_count) {
        fclose(file);
        fail("model artifact architecture does not match model");
    }
    if (!weight_only && header.version >= 4U) {
        CheckpointOrchestration orchestration;
        if (!read_items(file, &orchestration, sizeof(orchestration), 1)) {
            fclose(file);
            fail("model artifact orchestration state is corrupt");
        }
    }
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        uint64_t count = 0;
        if (!read_items(file, &count, sizeof(count), 1) ||
            count != parameter->count ||
            !read_items(file, parameter->w, sizeof(float), parameter->count)) {
            fclose(file);
            fprintf(stderr,
                    "error: model artifact parameter %d (%s) is corrupt or "
                    "incomplete; file count=%llu expected=%zu\n",
                    parameter_index, parameter->name,
                    (unsigned long long)count, parameter->count);
            exit(EXIT_FAILURE);
        }
        if (!weight_only &&
            fseek(file, (long)(2 * parameter->count * sizeof(float)),
                  SEEK_CUR) != 0) {
            fclose(file);
            fail_path("skip optimizer state in", path);
        }
        memset(parameter->m, 0, parameter->count * sizeof(float));
        memset(parameter->v, 0, parameter->count * sizeof(float));
    }
    if (fclose(file) != 0) {
        fail_path("close", path);
    }
    return header.step;
}

static void zero1_teacher_load(Zero1Teacher *teacher, const char *path)
{
    Zero1CheckpointHeader header;
    FILE *file = fopen(path, "rb");
    size_t embedding_count;
    size_t w1_count = (size_t)ZERO1_HIDDEN * ZERO1_CONTEXT * ZERO1_EMBED;
    size_t w2_count;
    int token;

    if (file == NULL) fail_path("open ZERO.1 teacher", path);
    if (!read_items(file, &header, sizeof(header), 1) ||
        memcmp(header.magic, ZERO1_CHECKPOINT_MAGIC, sizeof(header.magic)) != 0 ||
        header.version != ZERO1_CHECKPOINT_VERSION ||
        header.vocab < 2 || header.vocab > ZERO1_MAX_VOCAB ||
        header.context != ZERO1_CONTEXT || header.embed != ZERO1_EMBED ||
        header.hidden != ZERO1_HIDDEN) {
        fclose(file);
        fail("unsupported or corrupt ZERO.1 teacher checkpoint");
    }
    memset(teacher, 0, sizeof(*teacher));
    teacher->vocab = (int)header.vocab;
    for (token = 0; token < ZERO1_MAX_VOCAB; ++token) {
        teacher->char_to_token[token] = -1;
    }
    for (token = 0; token < teacher->vocab; ++token) {
        unsigned char character = header.token_to_char[token];
        if (teacher->char_to_token[character] >= 0) {
            fclose(file);
            fail("ZERO.1 teacher vocabulary contains a duplicate character");
        }
        teacher->char_to_token[character] = token;
        teacher->token_to_char[token] = character;
    }
    if (teacher->char_to_token[(unsigned char)' '] < 0) {
        fclose(file);
        fail("ZERO.1 teacher vocabulary has no padding-space token");
    }

    embedding_count = (size_t)teacher->vocab * ZERO1_EMBED;
    w2_count = (size_t)teacher->vocab * ZERO1_HIDDEN;
    teacher->embedding = zero_alloc(embedding_count, sizeof(float));
    teacher->w1 = zero_alloc(w1_count, sizeof(float));
    teacher->b1 = zero_alloc(ZERO1_HIDDEN, sizeof(float));
    teacher->w2 = zero_alloc(w2_count, sizeof(float));
    teacher->b2 = zero_alloc((size_t)teacher->vocab, sizeof(float));
    if (!read_items(file, teacher->embedding, sizeof(float), embedding_count) ||
        !read_items(file, teacher->w1, sizeof(float), w1_count) ||
        !read_items(file, teacher->b1, sizeof(float), ZERO1_HIDDEN) ||
        !read_items(file, teacher->w2, sizeof(float), w2_count) ||
        !read_items(file, teacher->b2, sizeof(float),
                    (size_t)teacher->vocab) ||
        fgetc(file) != EOF) {
        fclose(file);
        fail("ZERO.1 teacher checkpoint is incomplete or has trailing data");
    }
    if (fclose(file) != 0) fail_path("close ZERO.1 teacher", path);
    teacher->loaded = 1;
    printf("loaded ZERO.1 teacher %s at update %llu\n", path,
           (unsigned long long)header.step);
}

static void zero1_teacher_destroy(Zero1Teacher *teacher)
{
    free(teacher->embedding);
    free(teacher->w1);
    free(teacher->b1);
    free(teacher->w2);
    free(teacher->b2);
    memset(teacher, 0, sizeof(*teacher));
}

static void zero1_teacher_forward(Zero1Teacher *teacher,
                                  const int context[ZERO1_CONTEXT],
                                  float *ascii_probs, int output_vocab)
{
    int position;
    int i;
    int hidden;
    int token;
    float maximum;
    float total = 0.0f;

    memset(ascii_probs, 0, (size_t)output_vocab * sizeof(float));
    for (position = 0; position < ZERO1_CONTEXT; ++position) {
        int input_token = context[position];
        for (i = 0; i < ZERO1_EMBED; ++i) {
            teacher->x[position * ZERO1_EMBED + i] =
                teacher->embedding[input_token * ZERO1_EMBED + i];
        }
    }
    for (hidden = 0; hidden < ZERO1_HIDDEN; ++hidden) {
        float activation = teacher->b1[hidden];
        const float *weights =
            teacher->w1 + (size_t)hidden * ZERO1_CONTEXT * ZERO1_EMBED;
        for (i = 0; i < ZERO1_CONTEXT * ZERO1_EMBED; ++i) {
            activation += weights[i] * teacher->x[i];
        }
        teacher->h[hidden] = tanhf(activation);
    }
    for (token = 0; token < teacher->vocab; ++token) {
        float logit = teacher->b2[token];
        for (hidden = 0; hidden < ZERO1_HIDDEN; ++hidden) {
            logit += teacher->w2[token * ZERO1_HIDDEN + hidden] *
                     teacher->h[hidden];
        }
        teacher->probs[token] = logit;
    }
    maximum = teacher->probs[0];
    for (token = 1; token < teacher->vocab; ++token) {
        if (teacher->probs[token] > maximum) maximum = teacher->probs[token];
    }
    for (token = 0; token < teacher->vocab; ++token) {
        teacher->probs[token] = expf(teacher->probs[token] - maximum);
        total += teacher->probs[token];
    }
    for (token = 0; token < teacher->vocab; ++token) {
        int character = teacher->token_to_char[token];
        teacher->probs[token] /= total;
        if (character >= 0 && character < output_vocab) {
            ascii_probs[character] = teacher->probs[token];
        }
    }
}

static void zero1_teacher_sequence(Zero1Teacher *teacher, const Token *tokens,
                                   int length, int output_vocab,
                                   float *probabilities)
{
    int padding = teacher->char_to_token[(unsigned char)' '];
    int time;
    for (time = 0; time < length; ++time) {
        int context[ZERO1_CONTEXT];
        int position;
        for (position = 0; position < ZERO1_CONTEXT; ++position) {
            int source = time + position - (ZERO1_CONTEXT - 1);
            int character = source < 0 ? ' ' : tokens[source];
            if (character < 0 || character >= ZERO1_MAX_VOCAB ||
                teacher->char_to_token[character] < 0) {
                fail("foundation corpus contains a character outside the ZERO.1 vocabulary");
            }
            context[position] = source < 0
                                    ? padding
                                    : teacher->char_to_token[character];
        }
        zero1_teacher_forward(
            teacher, context, probabilities + (size_t)time * output_vocab,
            output_vocab);
    }
}

static float evaluate(Model *model, const Token *data, size_t length,
                      int batches)
{
    int batch;
    float total = 0.0f;
    size_t choices;
    if (length <= (size_t)model->cfg.context) {
        return NAN;
    }
    choices = length - (size_t)model->cfg.context;
    for (batch = 0; batch < batches; ++batch) {
        size_t start = batches == 1
                           ? 0
                           : (size_t)batch * (choices - 1) / (size_t)(batches - 1);
        total += model_forward(model, data + start, data + start + 1, 0.0f,
                               NULL);
    }
    return total / batches;
}

static float evaluate_balanced(Model *model, const Corpus *corpus,
                               const CorpusRange *ranges, int range_count,
                               int batches, int artifact_weight)
{
    unsigned char *mask = zero_alloc((size_t)model->cfg.context, 1);
    int samples_per_range = batches / range_count;
    int range_index;
    float total = 0.0f;
    float total_weight = 0.0f;
    if (samples_per_range < 1) samples_per_range = 1;
    for (range_index = 0; range_index < range_count; ++range_index) {
        const CorpusRange *range = &ranges[range_index];
        float range_total = 0.0f;
        int sample;
        for (sample = 0; sample < samples_per_range; ++sample) {
            size_t start;
            if (range->channel) {
                size_t local = samples_per_range == 1
                                   ? 0
                                   : (size_t)sample *
                                         (range->validation_record_count - 1) /
                                         (size_t)(samples_per_range - 1);
                size_t record = range->validation_record_index + local;
                start = range->record_starts[record];
                if (channel_loss_mask(corpus->data + start,
                                      corpus->data + start + 1, mask,
                                      model->cfg.context,
                                      artifact_weight) == 0) {
                    fail("channel validation window has no reply target");
                }
                range_total += model_forward_masked(
                    model, corpus->data + start, corpus->data + start + 1,
                    0.0f, NULL, mask);
            } else {
                size_t choices =
                    range->validation_length - model->cfg.context;
                size_t offset = samples_per_range == 1
                                    ? 0
                                    : (size_t)sample * (choices - 1) /
                                          (size_t)(samples_per_range - 1);
                start = range->validation_start + offset;
                range_total += model_forward(
                    model, corpus->data + start, corpus->data + start + 1,
                    0.0f, NULL);
            }
        }
        total += range->weight * range_total / samples_per_range;
        total_weight += range->weight;
    }
    free(mask);
    return total / total_weight;
}

static void probe_range_gradient(Model *model, const Corpus *corpus,
                                 const CorpusRange *range,
                                 unsigned char *mask, int artifact_weight)
{
    size_t start;
    model_zero_grad(model);
    if (range->channel) {
        start = range->record_starts[range->validation_record_index];
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context,
                              artifact_weight) == 0) {
            fail("gradient-cosine channel probe has no target");
        }
        (void)model_forward_masked(model, corpus->data + start,
                                   corpus->data + start + 1, 0.0f, NULL, mask);
        model_backward_masked(model, corpus->data + start,
                              corpus->data + start + 1, mask);
    } else {
        start = range->validation_start;
        (void)model_forward(model, corpus->data + start,
                            corpus->data + start + 1, 0.0f, NULL);
        model_backward(model, corpus->data + start,
                       corpus->data + start + 1);
    }
}

static float faculty_replay_gradient_cosine(
    Model *model, const Corpus *corpus, const CorpusRange *ranges,
    int range_count, uint64_t probe_index, int artifact_weight,
    int *replay_range_index)
{
    const CorpusRange *faculty = NULL;
    const CorpusRange *replay = NULL;
    int eligible_count = 0;
    int chosen;
    int range_index;
    size_t parameter_total = model_parameter_total(model);
    float *replay_gradient = zero_alloc(parameter_total,
                                        sizeof(*replay_gradient));
    unsigned char *mask = zero_alloc((size_t)model->cfg.context, 1);
    size_t offset = 0;
    double dot = 0.0;
    double replay_norm = 0.0;
    double faculty_norm = 0.0;
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].channel &&
            !ranges[range_index].teacher_eligible && faculty == NULL) {
            faculty = &ranges[range_index];
        }
        if (ranges[range_index].teacher_eligible) ++eligible_count;
    }
    if (faculty == NULL || eligible_count == 0) {
        free(mask);
        free(replay_gradient);
        return NAN;
    }
    chosen = (int)(probe_index % (uint64_t)eligible_count);
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].teacher_eligible && chosen-- == 0) {
            replay = &ranges[range_index];
            *replay_range_index = range_index;
            break;
        }
    }
    probe_range_gradient(model, corpus, replay, mask, artifact_weight);
    for (range_index = 0; range_index < model->parameter_count; ++range_index) {
        Parameter *parameter = model->parameters[range_index];
        size_t element;
        memcpy(replay_gradient + offset, parameter->g,
               parameter->count * sizeof(*parameter->g));
        for (element = 0; element < parameter->count; ++element) {
            double value = parameter->g[element];
            replay_norm += value * value;
        }
        offset += parameter->count;
    }
    probe_range_gradient(model, corpus, faculty, mask, artifact_weight);
    offset = 0;
    for (range_index = 0; range_index < model->parameter_count; ++range_index) {
        Parameter *parameter = model->parameters[range_index];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double faculty_value = parameter->g[element];
            double replay_value = replay_gradient[offset + element];
            dot += faculty_value * replay_value;
            faculty_norm += faculty_value * faculty_value;
        }
        offset += parameter->count;
    }
    model_zero_grad(model);
    free(mask);
    free(replay_gradient);
    if (faculty_norm == 0.0 || replay_norm == 0.0) return NAN;
    return (float)(dot / sqrt(faculty_norm * replay_norm));
}

static uint64_t hash_bytes(uint64_t hash, const void *data, size_t size)
{
    const unsigned char *bytes = data;
    size_t i;
    for (i = 0; i < size; ++i) {
        hash ^= bytes[i];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static const char *json_number(double value, char buffer[32])
{
    if (!isfinite(value)) return "null";
    snprintf(buffer, 32, "%.17g", value);
    return buffer;
}

static uint64_t model_learned_state_digest(const Model *model)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        const Parameter *parameter = model->parameters[parameter_index];
        size_t bytes = parameter->count * sizeof(float);
        hash = hash_bytes(hash, parameter->w, bytes);
        hash = hash_bytes(hash, parameter->m, bytes);
        hash = hash_bytes(hash, parameter->v, bytes);
    }
    return hash;
}

static void transaction_copy_learned_from_model(TransactionState *state,
                                                const Model *model)
{
    size_t offset = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        const Parameter *parameter = model->parameters[parameter_index];
        size_t bytes = parameter->count * sizeof(float);
        memcpy(state->learned_before + offset, parameter->w, bytes);
        offset += parameter->count;
        memcpy(state->learned_before + offset, parameter->m, bytes);
        offset += parameter->count;
        memcpy(state->learned_before + offset, parameter->v, bytes);
        offset += parameter->count;
    }
}

static void transaction_restore_learned(Model *model,
                                        const TransactionState *state)
{
    size_t offset = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        size_t bytes = parameter->count * sizeof(float);
        memcpy(parameter->w, state->learned_before + offset, bytes);
        offset += parameter->count;
        memcpy(parameter->m, state->learned_before + offset, bytes);
        offset += parameter->count;
        memcpy(parameter->v, state->learned_before + offset, bytes);
        offset += parameter->count;
    }
}

static void transaction_copy_gradient(float *destination,
                                      const Model *model)
{
    size_t offset = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        const Parameter *parameter = model->parameters[parameter_index];
        memcpy(destination + offset, parameter->g,
               parameter->count * sizeof(float));
        offset += parameter->count;
    }
}

static void transaction_restore_gradient(Model *model, const float *source)
{
    size_t offset = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        memcpy(parameter->g, source + offset,
               parameter->count * sizeof(float));
        offset += parameter->count;
    }
}

static void transaction_copy_reference_weights(TransactionState *state,
                                               const Model *reference)
{
    size_t offset = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < reference->parameter_count;
         ++parameter_index) {
        const Parameter *parameter = reference->parameters[parameter_index];
        memcpy(state->start_weights + offset, parameter->w,
               parameter->count * sizeof(float));
        offset += parameter->count;
    }
}

static void transaction_state_create(TransactionState *state,
                                     const Model *model,
                                     const Model *reference,
                                     const Options *options)
{
    size_t total = model_parameter_total(model);
    memset(state, 0, sizeof(*state));
    state->parameter_total = total;
    state->learned_before = zero_alloc(3 * total, sizeof(float));
    state->batch_gradient = zero_alloc(total, sizeof(float));
    state->replay_gradient = zero_alloc(total, sizeof(float));
    state->start_weights = zero_alloc(total, sizeof(float));
    state->group_drift = zero_alloc((size_t)model->parameter_count,
                                    sizeof(double));
    state->group_displacement_norm =
        zero_alloc((size_t)model->parameter_count, sizeof(double));
    state->group_fisher_drift = zero_alloc((size_t)model->parameter_count,
                                           sizeof(double));
    state->probe_mask = zero_alloc((size_t)model->cfg.context, 1);
    transaction_copy_reference_weights(state, reference);
    if (options->transaction_log_path != NULL) {
        state->log = fopen(options->transaction_log_path, "a");
        if (state->log == NULL) {
            fail_path("open transaction log", options->transaction_log_path);
        }
    }
}

static void transaction_state_destroy(TransactionState *state)
{
    if (state->log != NULL && fclose(state->log) != 0) {
        fail("could not close transaction log");
    }
    free(state->learned_before);
    free(state->batch_gradient);
    free(state->replay_gradient);
    free(state->start_weights);
    free(state->group_drift);
    free(state->group_displacement_norm);
    free(state->group_fisher_drift);
    free(state->probe_mask);
    free(state->cumulative_baseline_losses);
    free(state->cumulative_candidate_losses);
    memset(state, 0, sizeof(*state));
}

static const char *transaction_mode_name(int mode)
{
    if (mode == TRANSACTION_GUARD) return "guard";
    if (mode == TRANSACTION_CUMULATIVE_GUARD) return "cumulative-guard";
    if (mode == TRANSACTION_OBSERVER) return "observer";
    return "disabled";
}

static const CorpusRange *transaction_select_replay_range(
    const CorpusRange *ranges, int range_count, uint64_t attempt,
    int *replay_range_index)
{
    int eligible_count = 0;
    int chosen;
    int range_index;
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].teacher_eligible) ++eligible_count;
    }
    if (eligible_count == 0) return NULL;
    chosen = (int)((attempt - 1) % (uint64_t)eligible_count);
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].teacher_eligible && chosen-- == 0) {
            *replay_range_index = range_index;
            return &ranges[range_index];
        }
    }
    return NULL;
}

static const CorpusRange *transaction_select_faculty_range(
    const CorpusRange *ranges, int range_count)
{
    int range_index;
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].channel &&
            !ranges[range_index].teacher_eligible) {
            return &ranges[range_index];
        }
    }
    return NULL;
}

static float transaction_probe_loss(Model *model, const Corpus *corpus,
                                    const CorpusRange *range,
                                    unsigned char *mask, int artifact_weight)
{
    size_t start;
    if (range->channel) {
        start = range->record_starts[range->validation_record_index];
        if (channel_loss_mask(corpus->data + start, corpus->data + start + 1,
                              mask, model->cfg.context,
                              artifact_weight) == 0) {
            fail("transaction replay probe has no target");
        }
        return model_forward_masked(model, corpus->data + start,
                                    corpus->data + start + 1, 0.0f, NULL,
                                    mask);
    }
    start = range->validation_start;
    return model_forward(model, corpus->data + start,
                         corpus->data + start + 1, 0.0f, NULL);
}

static void transaction_initialize_cumulative_baseline(
    TransactionState *state, Model *reference, const Corpus *corpus,
    const CorpusRange *ranges, int range_count, int artifact_weight)
{
    double total = 0.0;
    int eligible_count = 0;
    int range_index;
    int probe_index = 0;
    for (range_index = 0; range_index < range_count; ++range_index) {
        if (ranges[range_index].teacher_eligible) ++eligible_count;
    }
    if (eligible_count == 0) {
        fail("cumulative guard requires replay data");
    }
    state->cumulative_baseline_losses =
        zero_alloc((size_t)eligible_count, sizeof(float));
    state->cumulative_candidate_losses =
        zero_alloc((size_t)eligible_count, sizeof(float));
    state->cumulative_replay_count = eligible_count;
    for (range_index = 0; range_index < range_count; ++range_index) {
        float loss;
        if (!ranges[range_index].teacher_eligible) continue;
        loss = transaction_probe_loss(reference, corpus, &ranges[range_index],
                                      state->probe_mask, artifact_weight);
        if (!isfinite(loss) || loss <= 0.0f) {
            fail("cumulative guard baseline probe is not finite and positive");
        }
        state->cumulative_baseline_losses[probe_index++] = loss;
        total += loss;
    }
    state->cumulative_baseline_mean = total / eligible_count;
}

static double transaction_cumulative_candidate_change(
    TransactionState *state, Model *model, const Corpus *corpus,
    const CorpusRange *ranges, int range_count, int artifact_weight,
    double *candidate_mean)
{
    double total = 0.0;
    int all_finite = 1;
    int range_index;
    int probe_index = 0;
    for (range_index = 0; range_index < range_count; ++range_index) {
        float loss;
        if (!ranges[range_index].teacher_eligible) continue;
        loss = transaction_probe_loss(model, corpus, &ranges[range_index],
                                      state->probe_mask, artifact_weight);
        state->cumulative_candidate_losses[probe_index++] = loss;
        if (isfinite(loss)) total += loss;
        else all_finite = 0;
    }
    if (probe_index != state->cumulative_replay_count) {
        fail("cumulative replay range count changed");
    }
    *candidate_mean = all_finite ? total / probe_index : NAN;
    if (!all_finite) return NAN;
    return (*candidate_mean - state->cumulative_baseline_mean) /
           state->cumulative_baseline_mean;
}

static float transaction_prepare_attempt(
    TransactionState *state, Model *model, const Corpus *corpus,
    const CorpusRange *ranges, int range_count, int artifact_weight,
    const CorpusRange **replay_range, int *replay_range_index,
    int functional_probe, float *probe_before)
{
    const CorpusRange *faculty = transaction_select_faculty_range(
        ranges, range_count);
    size_t offset = 0;
    double dot = 0.0;
    double faculty_norm = 0.0;
    double replay_norm = 0.0;
    int parameter_index;
    *replay_range = transaction_select_replay_range(
        ranges, range_count, state->attempts, replay_range_index);
    if (faculty == NULL || *replay_range == NULL) {
        fail("transaction mode requires a hard faculty channel and replay data");
    }
    transaction_copy_gradient(state->batch_gradient, model);
    if (functional_probe) {
        *probe_before = transaction_probe_loss(
            model, corpus, *replay_range, state->probe_mask, artifact_weight);
    } else {
        *probe_before = NAN;
    }
    probe_range_gradient(model, corpus, *replay_range, state->probe_mask,
                         artifact_weight);
    transaction_copy_gradient(state->replay_gradient, model);
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double value = parameter->g[element];
            replay_norm += value * value;
        }
    }
    probe_range_gradient(model, corpus, faculty, state->probe_mask,
                         artifact_weight);
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double faculty_value = parameter->g[element];
            double replay_value = state->replay_gradient[offset + element];
            dot += faculty_value * replay_value;
            faculty_norm += faculty_value * faculty_value;
        }
        offset += parameter->count;
    }
    transaction_restore_gradient(model, state->batch_gradient);
    transaction_copy_learned_from_model(state, model);
    if (faculty_norm == 0.0 || replay_norm == 0.0) return NAN;
    return (float)(dot / sqrt(faculty_norm * replay_norm));
}

static int transaction_decide_attempt(
    TransactionState *state, Model *model, const Corpus *corpus,
    const CorpusRange *ranges, int range_count,
    const CorpusRange *replay_range, int replay_range_index,
    const Options *options, uint64_t proposed_update, float learning_rate,
    float gradient_norm, float gradient_cosine, int functional_probe,
    float probe_before)
{
    size_t gradient_offset = 0;
    size_t learned_offset = 0;
    double total_drift = 0.0;
    double total_displacement_norm = 0.0;
    double total_fisher_drift = 0.0;
    float probe_after = NAN;
    double relative_change = NAN;
    double cumulative_candidate_mean = NAN;
    double cumulative_relative_change = NAN;
    uint64_t before_digest;
    uint64_t rollback_digest = 0;
    int accepted = 1;
    const char *reason = "observer-only";
    char probe_before_buffer[32];
    char probe_after_buffer[32];
    char relative_change_buffer[32];
    char cumulative_baseline_buffer[32];
    char cumulative_candidate_buffer[32];
    char cumulative_relative_buffer[32];
    char gradient_cosine_buffer[32];
    char source_ids[256];
    size_t source_ids_length = 0;
    int parameter_index;
    for (parameter_index = 0; parameter_index < model->parameter_count;
         ++parameter_index) {
        Parameter *parameter = model->parameters[parameter_index];
        double group_drift = 0.0;
        double group_norm = 0.0;
        double group_fisher = 0.0;
        size_t element;
        for (element = 0; element < parameter->count; ++element) {
            double displacement =
                parameter->w[element] - state->learned_before[learned_offset + element];
            double replay_gradient =
                state->replay_gradient[gradient_offset + element];
            double from_start =
                parameter->w[element] - state->start_weights[gradient_offset + element];
            group_drift += replay_gradient * displacement;
            group_norm += displacement * displacement;
            group_fisher += replay_gradient * replay_gradient *
                            from_start * from_start;
        }
        state->group_drift[parameter_index] = group_drift;
        state->group_displacement_norm[parameter_index] = group_norm;
        state->group_fisher_drift[parameter_index] = group_fisher;
        total_drift += group_drift;
        total_displacement_norm += group_norm;
        total_fisher_drift += group_fisher;
        gradient_offset += parameter->count;
        learned_offset += 3 * parameter->count;
    }
    before_digest = UINT64_C(1469598103934665603);
    before_digest = hash_bytes(before_digest, state->learned_before,
                               3 * state->parameter_total * sizeof(float));
    if (functional_probe) {
        probe_after = transaction_probe_loss(
            model, corpus, replay_range, state->probe_mask,
            options->artifact_weight);
        relative_change = probe_before > 0.0f
                              ? ((double)probe_after - probe_before) /
                                    probe_before
                              : 0.0;
    }
    if (options->transaction_mode == TRANSACTION_CUMULATIVE_GUARD) {
        cumulative_relative_change = transaction_cumulative_candidate_change(
            state, model, corpus, ranges, range_count,
            options->artifact_weight, &cumulative_candidate_mean);
    }
    if (options->transaction_mode == TRANSACTION_GUARD) {
        if (!functional_probe) {
            reason = "functional-probe-not-due";
        } else if (!isfinite(probe_after) ||
                   relative_change > options->transaction_guard_budget) {
            accepted = 0;
            reason = !isfinite(probe_after) ? "non-finite-replay-probe"
                                            : "replay-budget-exceeded";
        } else {
            reason = "within-replay-budget";
        }
    } else if (options->transaction_mode == TRANSACTION_CUMULATIVE_GUARD) {
        if (!isfinite(cumulative_candidate_mean) ||
            !isfinite(cumulative_relative_change)) {
            accepted = 0;
            reason = "non-finite-cumulative-replay-probe";
        } else if (cumulative_relative_change >
                   options->transaction_guard_budget) {
            accepted = 0;
            reason = "cumulative-replay-budget-exceeded";
        } else {
            reason = "within-cumulative-replay-budget";
        }
    }
    if (!accepted) {
        transaction_restore_learned(model, state);
        rollback_digest = model_learned_state_digest(model);
        if (rollback_digest != before_digest) {
            fail("transaction rollback digest mismatch");
        }
        ++state->consecutive_rejections;
    } else {
        state->consecutive_rejections = 0;
    }
    source_ids[source_ids_length++] = '[';
    for (parameter_index = 0; parameter_index < 64; ++parameter_index) {
        if ((state->source_mask & (UINT64_C(1) << parameter_index)) != 0) {
            int written = snprintf(
                source_ids + source_ids_length,
                sizeof(source_ids) - source_ids_length, "%s%d",
                source_ids_length == 1 ? "" : ",", parameter_index);
            if (written < 0 ||
                (size_t)written >= sizeof(source_ids) - source_ids_length) {
                fail("transaction source id buffer overflow");
            }
            source_ids_length += (size_t)written;
        }
    }
    source_ids[source_ids_length++] = ']';
    source_ids[source_ids_length] = '\0';
    if (state->log != NULL) {
        fprintf(state->log,
                "{\"schema\":\"%s\","
                "\"attempt\":%llu,\"proposed_committed_update\":%llu,"
                "\"committed_update\":%llu,\"phase\":\"%s\","
                "\"mode\":\"%s\","
                "\"source_mask\":\"%016llx\",\"source_ids\":%s,"
                "\"replay_range\":%d,"
                "\"learning_rate\":%.9g,"
                "\"guard_budget\":%.9g,\"functional_probe\":%s,"
                "\"probe_before\":%s,\"probe_after\":%s,"
                "\"relative_probe_change\":%s,"
                "\"faculty_replay_gradient_cosine\":%s,"
                "\"gradient_norm\":%.9g,\"displacement_norm\":%.9g,"
                "\"predicted_replay_drift\":%.17g,"
                "\"fisher_weighted_drift\":%.17g,"
                "\"decision\":\"%s\",\"reason\":\"%s\","
                "\"rollback_digest\":\"%016llx\"",
                options->transaction_mode == TRANSACTION_CUMULATIVE_GUARD
                    ? "zero.optimizer_attempt.v2"
                    : "zero.optimizer_attempt.v1",
                (unsigned long long)state->attempts,
                (unsigned long long)proposed_update,
                (unsigned long long)(accepted ? proposed_update
                                               : proposed_update - 1),
                options->transaction_phase,
                transaction_mode_name(options->transaction_mode),
                (unsigned long long)state->source_mask, source_ids,
                replay_range_index,
                learning_rate,
                options->transaction_guard_budget,
                functional_probe ? "true" : "false",
                json_number(probe_before, probe_before_buffer),
                json_number(probe_after, probe_after_buffer),
                json_number(relative_change, relative_change_buffer),
                json_number(gradient_cosine, gradient_cosine_buffer),
                gradient_norm,
                sqrt(total_displacement_norm), total_drift,
                total_fisher_drift, accepted ? "accept" : "reject", reason,
                (unsigned long long)rollback_digest);
        if (options->transaction_mode == TRANSACTION_CUMULATIVE_GUARD) {
            int range_index;
            int probe_index = 0;
            fprintf(state->log,
                    ",\"cumulative_probe_baseline\":%s,"
                    "\"cumulative_probe_after\":%s,"
                    "\"cumulative_relative_change\":%s,"
                    "\"cumulative_ranges\":[",
                    json_number(state->cumulative_baseline_mean,
                                cumulative_baseline_buffer),
                    json_number(cumulative_candidate_mean,
                                cumulative_candidate_buffer),
                    json_number(cumulative_relative_change,
                                cumulative_relative_buffer));
            for (range_index = 0; range_index < range_count; ++range_index) {
                char baseline_buffer[32];
                char candidate_buffer[32];
                char range_relative_buffer[32];
                double range_relative;
                if (!ranges[range_index].teacher_eligible) continue;
                range_relative =
                    (state->cumulative_candidate_losses[probe_index] -
                     state->cumulative_baseline_losses[probe_index]) /
                    state->cumulative_baseline_losses[probe_index];
                fprintf(state->log,
                        "%s{\"replay_range\":%d,\"baseline\":%s,"
                        "\"candidate\":%s,\"relative_change\":%s}",
                        probe_index == 0 ? "" : ",", range_index,
                        json_number(
                            state->cumulative_baseline_losses[probe_index],
                            baseline_buffer),
                        json_number(
                            state->cumulative_candidate_losses[probe_index],
                            candidate_buffer),
                        json_number(range_relative, range_relative_buffer));
                ++probe_index;
            }
            fputc(']', state->log);
        }
        fputs(",\"groups\":[", state->log);
        for (parameter_index = 0; parameter_index < model->parameter_count;
             ++parameter_index) {
            const Parameter *parameter = model->parameters[parameter_index];
            fprintf(state->log,
                    "%s{\"id\":\"%s\",\"replay_drift\":%.17g,"
                    "\"displacement_norm\":%.17g,"
                    "\"fisher_weighted_drift\":%.17g}",
                    parameter_index == 0 ? "" : ",", parameter->name,
                    state->group_drift[parameter_index],
                    sqrt(state->group_displacement_norm[parameter_index]),
                    state->group_fisher_drift[parameter_index]);
        }
        fputs("]}\n", state->log);
        fflush(state->log);
    }
    return accepted;
}

typedef struct {
    int token;
    float weight;
} Candidate;

static void tokenizer_load(Tokenizer *tokenizer, const char *path)
{
    static const unsigned char magic[8] = {
        'L', 'I', 'T', 'B', 'P', 'E', '1', '\0'
    };
    unsigned char actual_magic[8];
    uint32_t version = 0;
    uint32_t count = 0;
    FILE *file = fopen(path, "rb");
    int i;
    if (file == NULL) fail_path("open tokenizer", path);
    if (!read_items(file, actual_magic, 1, sizeof(actual_magic)) ||
        !read_items(file, &version, sizeof(version), 1) ||
        !read_items(file, &count, sizeof(count), 1) ||
        memcmp(actual_magic, magic, sizeof(magic)) != 0 ||
        (version != 1U && version != 2U) ||
        count > BPE_MAX_MERGES || BPE_BASE_TOKENS + count > MAX_VOCAB_SIZE) {
        fclose(file);
        fail("unsupported or corrupt tokenizer");
    }
    for (i = 0; i < (int)count; ++i) {
        Token left = 0;
        Token right = 0;
        if (version == 1U) {
            int a = fgetc(file);
            int b = fgetc(file);
            if (a == EOF || b == EOF) {
                fclose(file);
                fail("corrupt tokenizer merge table");
            }
            left = (Token)a;
            right = (Token)b;
        } else if (!read_items(file, &left, sizeof(left), 1) ||
                   !read_items(file, &right, sizeof(right), 1)) {
            fclose(file);
            fail("corrupt tokenizer merge table");
        }
        if (left >= BPE_BASE_TOKENS + i ||
            right >= BPE_BASE_TOKENS + i) {
            fclose(file);
            fail("invalid tokenizer merge ordering");
        }
        tokenizer->left[i] = left;
        tokenizer->right[i] = right;
    }
    if (fclose(file) != 0) fail_path("close tokenizer", path);
    tokenizer->loaded = 1;
    tokenizer->merge_count = (int)count;
    tokenizer->vocab = BPE_BASE_TOKENS + (int)count;
    tokenizer->token_width = version == 1U ? 1 : 2;
}

static size_t tokenizer_encode(const Tokenizer *tokenizer, const char *text,
                               Token **encoded)
{
    size_t input_length = strlen(text);
    Token *tokens = zero_alloc(input_length + 1, sizeof(*tokens));
    size_t read = 0;
    size_t length = 0;
    int merge;
    while (read < input_length) {
        unsigned char value = (unsigned char)text[read++];
        if (value < BPE_BASE_TOKENS) {
            tokens[length++] = value;
        } else {
            while (read < input_length &&
                   ((unsigned char)text[read] & 0xc0) == 0x80) {
                ++read;
            }
            tokens[length++] = '?';
        }
    }
    if (tokenizer->loaded) {
        for (merge = 0; merge < tokenizer->merge_count; ++merge) {
            size_t input = 0;
            size_t output = 0;
            while (input < length) {
                if (input + 1 < length &&
                    tokens[input] == tokenizer->left[merge] &&
                    tokens[input + 1] == tokenizer->right[merge]) {
                    tokens[output++] = (Token)(BPE_BASE_TOKENS + merge);
                    input += 2;
                } else {
                    tokens[output++] = tokens[input++];
                }
            }
            length = output;
        }
    }
    *encoded = tokens;
    return length;
}

static void tokenizer_write_token(const Tokenizer *tokenizer, int token)
{
    if (!tokenizer->loaded || token < BPE_BASE_TOKENS) {
        putchar(token);
        return;
    }
    tokenizer_write_token(tokenizer,
                          tokenizer->left[token - BPE_BASE_TOKENS]);
    tokenizer_write_token(tokenizer,
                          tokenizer->right[token - BPE_BASE_TOKENS]);
}

static int candidate_compare(const void *left, const void *right)
{
    const Candidate *a = (const Candidate *)left;
    const Candidate *b = (const Candidate *)right;
    if (a->weight < b->weight) {
        return 1;
    }
    if (a->weight > b->weight) {
        return -1;
    }
    return a->token - b->token;
}

static int sample_row(const float *probabilities, float temperature, int top_k,
                      int vocab, const Token *recent, int recent_count,
                      float repetition_penalty, Rng *rng)
{
    Candidate candidates[MAX_VOCAB_SIZE];
    int token;
    int limit;
    float total = 0.0f;
    float threshold;

    for (token = 0; token < vocab; ++token) {
        int i;
        int repeated = 0;
        float weight = probabilities[token];
        for (i = 0; i < recent_count; ++i) {
            if (recent[i] == token) {
                repeated = 1;
                break;
            }
        }
        candidates[token].token = token;
        if (repeated) weight /= repetition_penalty;
        candidates[token].weight = temperature <= 0.0f
                                       ? weight
                                       : powf(weight + 1.0e-30f,
                                              1.0f / temperature);
    }
    qsort(candidates, (size_t)vocab, sizeof(candidates[0]), candidate_compare);
    if (temperature <= 0.0f) return candidates[0].token;
    limit = top_k > 0 && top_k < vocab ? top_k : vocab;
    for (token = 0; token < limit; ++token) {
        total += candidates[token].weight;
    }
    threshold = rng_unit(rng) * total;
    for (token = 0; token < limit; ++token) {
        threshold -= candidates[token].weight;
        if (threshold <= 0.0f) {
            return candidates[token].token;
        }
    }
    return candidates[limit - 1].token;
}

static void generate(Model *model, const Tokenizer *tokenizer,
                     const char *prompt, long count, float temperature,
                     int top_k, float repetition_penalty, Rng *rng)
{
    Token *context = zero_alloc((size_t)model->cfg.context, sizeof(Token));
    Token *encoded_prompt;
    size_t prompt_length = strlen(prompt);
    size_t encoded_length =
        tokenizer_encode(tokenizer, prompt, &encoded_prompt);
    size_t i;
    long generated;

    for (i = 0; i < (size_t)model->cfg.context; ++i) context[i] = ' ';
    for (i = 0; i < encoded_length; ++i) {
        memmove(context, context + 1,
                ((size_t)model->cfg.context - 1) * sizeof(Token));
        context[model->cfg.context - 1] = encoded_prompt[i];
    }
    printf("\n--- generated ---\n");
    fwrite(prompt, 1, prompt_length, stdout);
    for (generated = 0; generated < count; ++generated) {
        const float *last_row;
        int next;
        int recent_count = model->cfg.context < 64 ? model->cfg.context : 64;
        model_forward(model, context, NULL, 0.0f, NULL);
        last_row = &model->probs[(model->cfg.context - 1) * model->cfg.vocab];
        next = sample_row(last_row, temperature, top_k,
                          model->cfg.vocab,
                          context + model->cfg.context - recent_count,
                          recent_count, repetition_penalty, rng);
        tokenizer_write_token(tokenizer, next);
        memmove(context, context + 1,
                ((size_t)model->cfg.context - 1) * sizeof(Token));
        context[model->cfg.context - 1] = (Token)next;
    }
    putchar('\n');
    free(encoded_prompt);
    free(context);
}

static Config preset_config(const char *name)
{
    Config cfg;
    if (strcmp(name, "tiny") == 0) {
        cfg.context = 64;
        cfg.dim = 64;
        cfg.heads = 4;
        cfg.layers = 2;
        cfg.ff = 256;
        cfg.rotary = 0;
        cfg.vocab = DEFAULT_VOCAB_SIZE;
    } else if (strcmp(name, "literary") == 0) {
        cfg.context = 512;
        cfg.dim = 256;
        cfg.heads = 8;
        cfg.layers = 6;
        cfg.ff = 1056;
        cfg.rotary = 1;
        cfg.vocab = 128;
    } else {
        fprintf(stderr, "error: unknown preset '%s'\n", name);
        exit(EXIT_FAILURE);
    }
    return cfg;
}

static void validate_config(const Config *cfg)
{
    if (cfg->context < 2 || cfg->context > 2048 || cfg->dim < 8 ||
        cfg->dim > 2048 || cfg->heads < 1 || cfg->heads > cfg->dim ||
        cfg->dim % cfg->heads != 0 || cfg->layers < 1 || cfg->layers > 48 ||
        cfg->ff < cfg->dim || cfg->ff > 8192 ||
        (cfg->rotary && (cfg->dim / cfg->heads) % 2 != 0) ||
        cfg->vocab < 2 || cfg->vocab > MAX_VOCAB_SIZE) {
        fail("invalid architecture; require context 2..2048, dim 8..2048, "
             "heads dividing dim with even head width, layers 1..48, and "
             "dim <= ff <= 8192, and vocab 2..2048");
    }
}

static long parse_long(const char *text, const char *option)
{
    char *end = NULL;
    long value;
    errno = 0;
    value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') {
        fprintf(stderr, "error: invalid value for %s: %s\n", option, text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static float parse_float(const char *text, const char *option)
{
    char *end = NULL;
    float value;
    errno = 0;
    value = strtof(text, &end);
    if (errno != 0 || end == text || *end != '\0' || !isfinite(value)) {
        fprintf(stderr, "error: invalid value for %s: %s\n", option, text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static void parse_distill_weights(const char *text,
                                  float weights[MAX_FACULTY_TEACHERS])
{
    int consumed = 0;
    int teacher;
    if (sscanf(text, "%f,%f,%f%n", &weights[0], &weights[1], &weights[2],
               &consumed) != MAX_FACULTY_TEACHERS || text[consumed] != '\0') {
        fail("--distill requires ZERO1,ZERO2,ZERO3 weights");
    }
    for (teacher = 0; teacher < MAX_FACULTY_TEACHERS; ++teacher) {
        if (!isfinite(weights[teacher]) || weights[teacher] < 0.0f ||
            weights[teacher] > 1.0f) {
            fail("--distill weights must be finite and between zero and one");
        }
    }
    if (weights[0] + weights[1] + weights[2] > 1.0f + 1.0e-6f) {
        fail("--distill teacher weights must sum to at most one");
    }
}

static int choose_weighted_range(const CorpusRange *ranges, int count,
                                 Rng *rng)
{
    float total = 0.0f;
    float choice;
    int index;
    for (index = 0; index < count; ++index) total += ranges[index].weight;
    choice = rng_unit(rng) * total;
    for (index = 0; index < count; ++index) {
        choice -= ranges[index].weight;
        if (choice <= 0.0f) return index;
    }
    return count - 1;
}

static void print_usage(const char *program)
{
    printf("usage: %s [options]\n\n", program);
    printf("data and architecture:\n");
    printf("  --text FILE          add a uniformly sampled training text (repeatable)\n");
    printf("  --foundation FILE    add ZERO.1 text with teacher distillation\n");
    printf("  --channel FILE       add a structured reply-record token file\n");
    printf("  --hard-channel FILE  add a channel excluded from teacher logits\n");
    printf("  --channel-weight X   sampling weight per channel file (default: 1)\n");
    printf("  --foundation-weight X sampling weight per foundation file (default: 2)\n");
    printf("  --sample-weight X    override the most recently added file weight\n");
    printf("  --distill A,B,C      ZERO.1, ZERO.2, ZERO.3 weights for the preceding file\n");
    printf("  --artifact-weight N  relative hard loss on @artifact contents (default: 1)\n");
    printf("  --preset NAME        tiny (default) or literary\n");
    printf("  --context N          sequence length\n");
    printf("  --dim N              embedding width\n");
    printf("  --heads N            attention heads; must divide dim\n");
    printf("  --layers N           transformer blocks\n");
    printf("  --ff N               feed-forward width\n\n");
    printf("  --tokenizer FILE     vocabulary produced by bpe_tokenizer\n\n");
    printf("training:\n");
    printf("  --steps N            additional optimizer updates (default: 1000)\n");
    printf("  --batch N            sequences accumulated per update (default: 1)\n");
    printf("  --lr X               peak learning rate (default: 0.0003)\n");
    printf("  --weight-decay X     AdamW decay (default: 0.01)\n");
    printf("  --clip X             global gradient norm limit (default: 1)\n");
    printf("  --warmup N           linear warmup updates (default: 100)\n");
    printf("  --schedule-offset N  completed phase updates before this run\n");
    printf("  --schedule-total N   total phase updates for chunk-stable LR decay\n");
    printf("  --report N           report interval (default: 100)\n");
    printf("  --validation N       validation sequences per report (default: 8)\n");
    printf("  --dropout X          residual dropout probability (default: 0.1)\n");
    printf("  --cosine             cosine-decay the learning rate over this run\n");
    printf("  --gradient-cosine N  report fixed faculty/replay probe cosine every N updates\n");
    printf("  --transaction-mode M disabled, observer, guard, or cumulative-guard (default: disabled)\n");
    printf("  --transaction-log F  append zero.optimizer_attempt.v1/v2 JSONL\n");
    printf("  --transaction-phase P observer, acquisition, consolidation, recovery, or smoke\n");
    printf("  --transaction-probe N functional replay probe cadence, 1..5 (default: 5)\n");
    printf("  --transaction-budget X maximum relative replay loss increase\n");
    printf("  --transaction-max-rejections N stop after consecutive rejects (default: 8)\n");
    printf("  --best FILE          save each new best-validation checkpoint\n");
    printf("  --patience N         early-stop after N stale validation reports\n");
    printf("  --seed N             deterministic seed (default: 0)\n\n");
    printf("distillation:\n");
    printf("  --teacher FILE       frozen same-architecture teacher; repeat for ZERO.2/3\n");
    printf("  --teacher-weight X   weight for the preceding --teacher (default: 0.15)\n");
    printf("  --zero1-teacher FILE checkpoint produced by zero_lm --save\n");
    printf("  --zero1-weight X     ZERO.1 weight on foundation data (default: 0.25)\n\n");
    printf("checkpoints and generation:\n");
    printf("  --save FILE          save model and AdamW state\n");
    printf("  --save-every N       periodic checkpoint interval\n");
    printf("  --resume FILE        resume architecture, weights, optimizer, and RNG\n");
    printf("  --init FILE          initialize weights with fresh optimizer and RNG\n");
    printf("  --eval-only          read-only validation; never updates or saves\n");
    printf("  --generate-only      equivalent to --steps 0\n");
    printf("  --prompt TEXT        generation prefix (default: zero)\n");
    printf("  --tokens N           tokens to generate (default: 256)\n");
    printf("  --temperature X      0 is greedy (default: 0.8)\n");
    printf("  --top-k N            restrict sampling; 0 disables (default: 40)\n");
    printf("  --repetition X       recent-token repetition penalty (default: 1.1)\n");
    printf("  --self-test          finite-difference gradient check\n");
    printf("  --help               show this message\n");
}

static int run_self_test(void)
{
    Config cfg = {4, 8, 2, 1, 16, 1, DEFAULT_VOCAB_SIZE};
    const Token tokens[4] = {'z', 'e', 'r', 'o'};
    const Token targets[4] = {'e', 'r', 'o', ' '};
    Rng rng;
    Model model;
    int parameter_index;
    int failures = 0;
    int checks = 0;
    const float epsilon = 0.001f;

    rng_seed(&rng, 0);
    model_create(&model, cfg, &rng);
    model_zero_grad(&model);
    model_forward(&model, tokens, targets, 0.0f, NULL);
    model_backward(&model, tokens, targets);

    for (parameter_index = 0; parameter_index < model.parameter_count;
         ++parameter_index) {
        Parameter *parameter = model.parameters[parameter_index];
        size_t indices[3] = {0, parameter->count / 2, parameter->count - 1};
        int sample;
        int check_every_value =
            strcmp(parameter->name, "position_embedding") == 0;
        int sample_count = check_every_value ? (int)parameter->count : 3;
        for (sample = 0; sample < sample_count; ++sample) {
            size_t index = check_every_value ? (size_t)sample : indices[sample];
            float original = parameter->w[index];
            float analytic = parameter->g[index];
            float plus;
            float minus;
            float numeric;
            float tolerance;
            parameter->w[index] = original + epsilon;
            plus = model_forward(&model, tokens, targets, 0.0f, NULL);
            parameter->w[index] = original - epsilon;
            minus = model_forward(&model, tokens, targets, 0.0f, NULL);
            parameter->w[index] = original;
            numeric = (plus - minus) / (2.0f * epsilon);
            tolerance = 0.002f + 0.08f * (fabsf(analytic) + fabsf(numeric));
            ++checks;
            if (!isfinite(numeric) || fabsf(analytic - numeric) > tolerance) {
                fprintf(stderr,
                        "gradient mismatch %s[%zu]: analytic=%g numeric=%g\n",
                        parameter->name, index, analytic, numeric);
                ++failures;
            }
        }
    }
    {
        const Token channel_tokens[4] = {
            CHANNEL_START_TOKEN, CHANNEL_TARGET_TOKEN, 'x', 'y'
        };
        const Token channel_targets[4] = {
            CHANNEL_TARGET_TOKEN, 'x', 'y', CHANNEL_MESSAGE_END_TOKEN
        };
        unsigned char mask[4];
        Parameter *parameter = &model.final_norm;
        float original = parameter->w[0];
        float analytic;
        float plus;
        float minus;
        float numeric;
        float tolerance;
        if (channel_loss_mask(channel_tokens, channel_targets, mask, 4, 1) != 3) {
            fprintf(stderr, "masked-loss self-test constructed a bad mask\n");
            ++failures;
        }
        model_zero_grad(&model);
        model_forward_masked(&model, channel_tokens, channel_targets, 0.0f,
                             NULL, mask);
        model_backward_masked(&model, channel_tokens, channel_targets, mask);
        analytic = parameter->g[0];
        parameter->w[0] = original + epsilon;
        plus = model_forward_masked(&model, channel_tokens, channel_targets,
                                    0.0f, NULL, mask);
        parameter->w[0] = original - epsilon;
        minus = model_forward_masked(&model, channel_tokens, channel_targets,
                                     0.0f, NULL, mask);
        parameter->w[0] = original;
        numeric = (plus - minus) / (2.0f * epsilon);
        tolerance = 0.002f + 0.08f * (fabsf(analytic) + fabsf(numeric));
        ++checks;
        if (!isfinite(numeric) || fabsf(analytic - numeric) > tolerance) {
            fprintf(stderr,
                    "masked gradient mismatch final_norm[0]: analytic=%g "
                    "numeric=%g\n",
                    analytic, numeric);
            ++failures;
        }
    }
    {
        static const char output[] =
            "@artifact result 5 @summary exact @close";
        Token weighted_tokens[sizeof(output) + 1];
        Token weighted_targets[sizeof(output) + 1];
        unsigned char weighted_mask[sizeof(output) + 1];
        int artifact_start = (int)strlen("@artifact ");
        int artifact_end = artifact_start + (int)strlen("result 5");
        int context = (int)strlen(output) + 1;
        int position;
        weighted_tokens[0] = CHANNEL_TARGET_TOKEN;
        for (position = 0; output[position] != '\0'; ++position) {
            weighted_targets[position] = (unsigned char)output[position];
            weighted_tokens[position + 1] = (unsigned char)output[position];
        }
        weighted_targets[context - 1] = CHANNEL_MESSAGE_END_TOKEN;
        if (channel_loss_mask(weighted_tokens, weighted_targets,
                              weighted_mask, context, 4) != context) {
            fprintf(stderr, "artifact-weight self-test lost target positions\n");
            ++failures;
        }
        for (position = 0; position < context; ++position) {
            int expected = position >= artifact_start &&
                                   position < artifact_end ? 4 : 1;
            if (weighted_mask[position] != expected) {
                fprintf(stderr,
                        "artifact-weight self-test mismatch at %d: %d != %d\n",
                        position, weighted_mask[position], expected);
                ++failures;
                break;
            }
        }
        ++checks;
    }
    {
        static const char output[] =
            "@request quantity.add 2 3 @close";
        Token request_tokens[sizeof(output) + 1];
        Token request_targets[sizeof(output) + 1];
        unsigned char request_loss_mask[sizeof(output) + 1];
        unsigned char request_teacher_mask[sizeof(output) + 1];
        int context = (int)strlen(output) + 1;
        int position;
        request_tokens[0] = CHANNEL_TARGET_TOKEN;
        for (position = 0; output[position] != '\0'; ++position) {
            request_targets[position] = (unsigned char)output[position];
            request_tokens[position + 1] = (unsigned char)output[position];
        }
        request_targets[context - 1] = CHANNEL_MESSAGE_END_TOKEN;
        if (channel_loss_mask(request_tokens, request_targets,
                              request_loss_mask, context, 1) != context) {
            fprintf(stderr, "request-mask self-test lost hard target positions\n");
            ++failures;
        }
        channel_teacher_mask(request_targets, request_loss_mask,
                             request_teacher_mask, context);
        for (position = 0; position < context; ++position) {
            if (request_teacher_mask[position] != 0) {
                fprintf(stderr,
                        "request-mask self-test leaked teacher mass at %d\n",
                        position);
                ++failures;
                break;
            }
        }
        ++checks;
    }
    {
        float soft_targets[4 * DEFAULT_VOCAB_SIZE];
        const float *teacher_probabilities[MAX_FACULTY_TEACHERS] = {
            soft_targets, soft_targets, NULL
        };
        const float teacher_weights[MAX_FACULTY_TEACHERS] = {
            0.1f, 0.1f, 0.0f
        };
        Parameter *parameter = &model.final_norm;
        float original = parameter->w[1];
        float analytic;
        float plus;
        float minus;
        float numeric;
        float tolerance;
        int i;
        for (i = 0; i < 4 * DEFAULT_VOCAB_SIZE; ++i) {
            soft_targets[i] = 1.0f / DEFAULT_VOCAB_SIZE;
        }
        model_zero_grad(&model);
        model_forward(&model, tokens, NULL, 0.0f, NULL);
        model_backward_blended_masked(
            &model, tokens, targets, NULL, NULL, teacher_probabilities,
            teacher_weights, MAX_FACULTY_TEACHERS);
        analytic = parameter->g[1];
        parameter->w[1] = original + epsilon;
        model_forward(&model, tokens, NULL, 0.0f, NULL);
        plus = model_blended_loss(
            &model, targets, NULL, NULL, teacher_probabilities,
            teacher_weights, MAX_FACULTY_TEACHERS);
        parameter->w[1] = original - epsilon;
        model_forward(&model, tokens, NULL, 0.0f, NULL);
        minus = model_blended_loss(
            &model, targets, NULL, NULL, teacher_probabilities,
            teacher_weights, MAX_FACULTY_TEACHERS);
        parameter->w[1] = original;
        numeric = (plus - minus) / (2.0f * epsilon);
        tolerance = 0.002f + 0.08f * (fabsf(analytic) + fabsf(numeric));
        ++checks;
        if (!isfinite(numeric) || fabsf(analytic - numeric) > tolerance) {
            fprintf(stderr,
                    "distillation gradient mismatch final_norm[1]: "
                    "analytic=%g numeric=%g\n",
                    analytic, numeric);
            ++failures;
        }
    }
    {
        Options transaction_options;
        TransactionState transaction_state;
        uint64_t before_digest;
        uint64_t candidate_digest;
        uint64_t restored_digest;
        uint64_t rng_before = rng.state;
        int index;
        memset(&transaction_options, 0, sizeof(transaction_options));
        transaction_state_create(&transaction_state, &model, &model,
                                 &transaction_options);
        model_zero_grad(&model);
        for (index = 0; index < model.parameter_count; ++index) {
            Parameter *parameter = model.parameters[index];
            size_t element;
            for (element = 0; element < parameter->count; ++element) {
                parameter->g[element] =
                    0.001f * (float)(1 + (element + (size_t)index) % 7);
            }
        }
        transaction_copy_learned_from_model(&transaction_state, &model);
        before_digest = model_learned_state_digest(&model);
        (void)rng_next(&rng);
        (void)optimizer_update(&model, 1, 0.001f, 0.01f, 1.0f, 1.0f);
        candidate_digest = model_learned_state_digest(&model);
        transaction_restore_learned(&model, &transaction_state);
        restored_digest = model_learned_state_digest(&model);
        ++checks;
        if (candidate_digest == before_digest ||
            restored_digest != before_digest || rng.state == rng_before) {
            fprintf(stderr,
                    "transaction rollback self-test failed: before=%016llx candidate=%016llx restored=%016llx\n",
                    (unsigned long long)before_digest,
                    (unsigned long long)candidate_digest,
                    (unsigned long long)restored_digest);
            ++failures;
        }
        transaction_state_destroy(&transaction_state);
    }
    model_destroy(&model);
    if (failures == 0) {
        printf("self-test: %d finite-difference gradient checks passed\n", checks);
        return 1;
    }
    fprintf(stderr, "self-test: %d of %d gradient checks failed\n", failures,
            checks);
    return 0;
}

int main(int argc, char **argv)
{
    const char *preset = "tiny";
    Config cfg;
    Options options;
    const char **text_paths;
    CorpusRange *text_ranges;
    unsigned char *text_channel;
    unsigned char *text_foundation;
    int text_count = 0;
    int foundation_count = 0;
    int i;
    Rng rng;
    Rng teacher_rng;
    Model model;
    Model teacher_models[MAX_SAME_ARCH_TEACHERS];
    int teacher_loaded[MAX_SAME_ARCH_TEACHERS] = {0};
    Zero1Teacher zero1_teacher = {0};
    Tokenizer tokenizer = {0};
    uint64_t update = 0;
    Corpus corpus = {0};
    size_t training_length = 0;
    size_t validation_length = 0;
    double training_start;
    double interval_start;
    uint64_t interval_tokens = 0;
    double interval_loss = 0.0;
    long interval_sequences = 0;
    long completed_steps = 0;
    float best_validation = INFINITY;
    long stale_reports = 0;
    int stop_training = 0;
    uint64_t checkpoint_attempts = 0;
    uint32_t checkpoint_rejections = 0;
    uint32_t checkpoint_transaction_mode = 0;
    TransactionState transaction = {0};

    memset(&options, 0, sizeof(options));
    options.steps = 1000;
    options.batch = 1;
    options.learning_rate = 3.0e-4f;
    options.weight_decay = 0.01f;
    options.clip = 1.0f;
    options.warmup = 100;
    options.schedule_offset = 0;
    options.schedule_total = 0;
    options.report_every = 100;
    options.validation_batches = 8;
    options.prompt = "zero";
    options.generate_tokens = 256;
    options.temperature = 0.8f;
    options.top_k = 40;
    options.seed = 0;
    options.dropout = 0.1f;
    options.repetition_penalty = 1.1f;
    options.channel_weight = 1.0f;
    options.foundation_weight = 2.0f;
    options.artifact_weight = 1;
    options.zero1_weight = 0.25f;
    options.transaction_probe_every = 5;
    options.transaction_phase = "observer";
    options.transaction_guard_budget = 0.0f;
    options.transaction_max_rejections = 8;
    text_paths = zero_alloc((size_t)(argc > 1 ? argc : 1), sizeof(*text_paths));
    text_ranges = zero_alloc((size_t)(argc > 1 ? argc : 1), sizeof(*text_ranges));
    text_channel = zero_alloc((size_t)(argc > 1 ? argc : 1),
                              sizeof(*text_channel));
    text_foundation = zero_alloc((size_t)(argc > 1 ? argc : 1),
                                 sizeof(*text_foundation));

    /* Apply the requested preset before individual dimension overrides. */
    for (i = 1; i + 1 < argc; ++i) {
        if (strcmp(argv[i], "--preset") == 0) {
            preset = argv[i + 1];
        }
    }
    cfg = preset_config(preset);

    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--help") == 0) {
            print_usage(argv[0]);
            free(text_paths);
            free(text_ranges);
            free(text_channel);
            free(text_foundation);
            return EXIT_SUCCESS;
        } else if (strcmp(argv[i], "--preset") == 0 && i + 1 < argc) {
            ++i;
        } else if (strcmp(argv[i], "--text") == 0 && i + 1 < argc) {
            text_ranges[text_count].teacher_eligible = 1;
            text_paths[text_count++] = argv[++i];
        } else if (strcmp(argv[i], "--foundation") == 0 && i + 1 < argc) {
            text_foundation[text_count] = 1;
            text_ranges[text_count].teacher_eligible = 1;
            text_paths[text_count++] = argv[++i];
            ++foundation_count;
        } else if (strcmp(argv[i], "--channel") == 0 && i + 1 < argc) {
            text_channel[text_count] = 1;
            text_ranges[text_count].teacher_eligible = 1;
            text_paths[text_count++] = argv[++i];
        } else if (strcmp(argv[i], "--hard-channel") == 0 &&
                   i + 1 < argc) {
            text_channel[text_count] = 1;
            text_ranges[text_count].teacher_eligible = 0;
            text_paths[text_count++] = argv[++i];
        } else if (strcmp(argv[i], "--channel-weight") == 0 &&
                   i + 1 < argc) {
            options.channel_weight =
                parse_float(argv[++i], "--channel-weight");
        } else if (strcmp(argv[i], "--foundation-weight") == 0 &&
                   i + 1 < argc) {
            options.foundation_weight =
                parse_float(argv[++i], "--foundation-weight");
        } else if (strcmp(argv[i], "--sample-weight") == 0 &&
                   i + 1 < argc) {
            float weight;
            if (text_count == 0) {
                fail("--sample-weight requires a preceding data file");
            }
            weight = parse_float(argv[++i], "--sample-weight");
            if (weight <= 0.0f) fail("--sample-weight must be positive");
            text_ranges[text_count - 1].weight = weight;
        } else if (strcmp(argv[i], "--distill") == 0 && i + 1 < argc) {
            if (text_count == 0) {
                fail("--distill requires a preceding data file");
            }
            parse_distill_weights(
                argv[++i], text_ranges[text_count - 1].distill_weights);
            text_ranges[text_count - 1].distill_override = 1;
        } else if (strcmp(argv[i], "--artifact-weight") == 0 &&
                   i + 1 < argc) {
            options.artifact_weight =
                (int)parse_long(argv[++i], "--artifact-weight");
        } else if (strcmp(argv[i], "--context") == 0 && i + 1 < argc) {
            cfg.context = (int)parse_long(argv[++i], "--context");
        } else if (strcmp(argv[i], "--dim") == 0 && i + 1 < argc) {
            cfg.dim = (int)parse_long(argv[++i], "--dim");
        } else if (strcmp(argv[i], "--heads") == 0 && i + 1 < argc) {
            cfg.heads = (int)parse_long(argv[++i], "--heads");
        } else if (strcmp(argv[i], "--layers") == 0 && i + 1 < argc) {
            cfg.layers = (int)parse_long(argv[++i], "--layers");
        } else if (strcmp(argv[i], "--ff") == 0 && i + 1 < argc) {
            cfg.ff = (int)parse_long(argv[++i], "--ff");
        } else if (strcmp(argv[i], "--tokenizer") == 0 && i + 1 < argc) {
            options.tokenizer_path = argv[++i];
        } else if (strcmp(argv[i], "--steps") == 0 && i + 1 < argc) {
            options.steps = parse_long(argv[++i], "--steps");
        } else if (strcmp(argv[i], "--batch") == 0 && i + 1 < argc) {
            options.batch = (int)parse_long(argv[++i], "--batch");
        } else if (strcmp(argv[i], "--lr") == 0 && i + 1 < argc) {
            options.learning_rate = parse_float(argv[++i], "--lr");
        } else if (strcmp(argv[i], "--weight-decay") == 0 && i + 1 < argc) {
            options.weight_decay = parse_float(argv[++i], "--weight-decay");
        } else if (strcmp(argv[i], "--clip") == 0 && i + 1 < argc) {
            options.clip = parse_float(argv[++i], "--clip");
        } else if (strcmp(argv[i], "--warmup") == 0 && i + 1 < argc) {
            options.warmup = parse_long(argv[++i], "--warmup");
        } else if (strcmp(argv[i], "--schedule-offset") == 0 &&
                   i + 1 < argc) {
            options.schedule_offset =
                parse_long(argv[++i], "--schedule-offset");
        } else if (strcmp(argv[i], "--schedule-total") == 0 &&
                   i + 1 < argc) {
            options.schedule_total = parse_long(argv[++i], "--schedule-total");
        } else if (strcmp(argv[i], "--report") == 0 && i + 1 < argc) {
            options.report_every = parse_long(argv[++i], "--report");
        } else if (strcmp(argv[i], "--validation") == 0 && i + 1 < argc) {
            options.validation_batches =
                (int)parse_long(argv[++i], "--validation");
        } else if (strcmp(argv[i], "--dropout") == 0 && i + 1 < argc) {
            options.dropout = parse_float(argv[++i], "--dropout");
        } else if (strcmp(argv[i], "--cosine") == 0) {
            options.cosine_decay = 1;
        } else if (strcmp(argv[i], "--gradient-cosine") == 0 &&
                   i + 1 < argc) {
            options.gradient_cosine_every =
                parse_long(argv[++i], "--gradient-cosine");
        } else if (strcmp(argv[i], "--transaction-mode") == 0 &&
                   i + 1 < argc) {
            const char *mode = argv[++i];
            if (strcmp(mode, "disabled") == 0) {
                options.transaction_mode = TRANSACTION_DISABLED;
            } else if (strcmp(mode, "observer") == 0) {
                options.transaction_mode = TRANSACTION_OBSERVER;
            } else if (strcmp(mode, "guard") == 0) {
                options.transaction_mode = TRANSACTION_GUARD;
            } else if (strcmp(mode, "cumulative-guard") == 0) {
                options.transaction_mode = TRANSACTION_CUMULATIVE_GUARD;
            } else {
                fail("--transaction-mode must be disabled, observer, guard, or cumulative-guard");
            }
        } else if (strcmp(argv[i], "--transaction-log") == 0 &&
                   i + 1 < argc) {
            options.transaction_log_path = argv[++i];
        } else if (strcmp(argv[i], "--transaction-phase") == 0 &&
                   i + 1 < argc) {
            const char *phase = argv[++i];
            if (strcmp(phase, "observer") != 0 &&
                strcmp(phase, "acquisition") != 0 &&
                strcmp(phase, "consolidation") != 0 &&
                strcmp(phase, "recovery") != 0 &&
                strcmp(phase, "smoke") != 0) {
                fail("unsupported --transaction-phase");
            }
            options.transaction_phase = phase;
        } else if (strcmp(argv[i], "--transaction-probe") == 0 &&
                   i + 1 < argc) {
            options.transaction_probe_every =
                parse_long(argv[++i], "--transaction-probe");
        } else if (strcmp(argv[i], "--transaction-budget") == 0 &&
                   i + 1 < argc) {
            options.transaction_guard_budget =
                parse_float(argv[++i], "--transaction-budget");
        } else if (strcmp(argv[i], "--transaction-max-rejections") == 0 &&
                   i + 1 < argc) {
            options.transaction_max_rejections =
                parse_long(argv[++i], "--transaction-max-rejections");
        } else if (strcmp(argv[i], "--best") == 0 && i + 1 < argc) {
            options.best_path = argv[++i];
        } else if (strcmp(argv[i], "--patience") == 0 && i + 1 < argc) {
            options.patience = parse_long(argv[++i], "--patience");
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            options.seed = parse_long(argv[++i], "--seed");
        } else if (strcmp(argv[i], "--teacher") == 0 && i + 1 < argc) {
            if (options.teacher_count >= MAX_SAME_ARCH_TEACHERS) {
                fail("at most two same-architecture teachers are allowed");
            }
            options.teacher_paths[options.teacher_count] = argv[++i];
            options.teacher_weights[options.teacher_count] = 0.15f;
            ++options.teacher_count;
        } else if (strcmp(argv[i], "--teacher-weight") == 0 &&
                   i + 1 < argc) {
            if (options.teacher_count == 0) {
                fail("--teacher-weight requires a preceding --teacher");
            }
            options.teacher_weights[options.teacher_count - 1] =
                parse_float(argv[++i], "--teacher-weight");
        } else if (strcmp(argv[i], "--zero1-teacher") == 0 &&
                   i + 1 < argc) {
            options.zero1_teacher_path = argv[++i];
        } else if (strcmp(argv[i], "--zero1-weight") == 0 &&
                   i + 1 < argc) {
            options.zero1_weight =
                parse_float(argv[++i], "--zero1-weight");
        } else if (strcmp(argv[i], "--save") == 0 && i + 1 < argc) {
            options.save_path = argv[++i];
        } else if (strcmp(argv[i], "--save-every") == 0 && i + 1 < argc) {
            options.save_every = parse_long(argv[++i], "--save-every");
        } else if (strcmp(argv[i], "--resume") == 0 && i + 1 < argc) {
            options.resume_path = argv[++i];
        } else if (strcmp(argv[i], "--init") == 0 && i + 1 < argc) {
            options.init_path = argv[++i];
        } else if (strcmp(argv[i], "--eval-only") == 0) {
            options.eval_only = 1;
        } else if (strcmp(argv[i], "--generate-only") == 0) {
            options.steps = 0;
        } else if (strcmp(argv[i], "--prompt") == 0 && i + 1 < argc) {
            options.prompt = argv[++i];
        } else if (strcmp(argv[i], "--tokens") == 0 && i + 1 < argc) {
            options.generate_tokens = parse_long(argv[++i], "--tokens");
        } else if (strcmp(argv[i], "--temperature") == 0 && i + 1 < argc) {
            options.temperature = parse_float(argv[++i], "--temperature");
        } else if (strcmp(argv[i], "--top-k") == 0 && i + 1 < argc) {
            options.top_k = (int)parse_long(argv[++i], "--top-k");
        } else if (strcmp(argv[i], "--repetition") == 0 && i + 1 < argc) {
            options.repetition_penalty =
                parse_float(argv[++i], "--repetition");
        } else if (strcmp(argv[i], "--self-test") == 0) {
            options.self_test = 1;
        } else {
            fprintf(stderr, "error: unknown or incomplete option: %s\n", argv[i]);
            print_usage(argv[0]);
            free(text_paths);
            free(text_ranges);
            free(text_channel);
            free(text_foundation);
            return EXIT_FAILURE;
        }
    }

    if (options.resume_path != NULL && options.init_path != NULL) {
        fail("--resume and --init are mutually exclusive");
    }
    if (options.eval_only) {
        options.steps = 0;
        options.generate_tokens = 0;
        if (options.resume_path == NULL && options.init_path == NULL) {
            fail("--eval-only requires --resume or --init");
        }
        if (text_count == 0) {
            fail("--eval-only requires at least one data file");
        }
    }
    if (options.resume_path != NULL) {
        cfg = checkpoint_peek(options.resume_path);
        if (options.save_path == NULL && !options.eval_only &&
            options.steps > 0) {
            options.save_path = options.resume_path;
        }
    } else if (options.init_path != NULL) {
        cfg = artifact_peek(options.init_path);
    }
    validate_config(&cfg);
    {
        float same_arch_total = 0.0f;
        int teacher;
        for (teacher = 0; teacher < options.teacher_count; ++teacher) {
            if (options.teacher_weights[teacher] < 0.0f ||
                options.teacher_weights[teacher] > 1.0f) {
                fail("teacher weights must be between zero and one");
            }
            same_arch_total += options.teacher_weights[teacher];
        }
        if (same_arch_total > 1.0f + 1.0e-6f ||
            (foundation_count > 0 &&
             same_arch_total + options.zero1_weight > 1.0f + 1.0e-6f)) {
            fail("active teacher weights must sum to at most one");
        }
    }
    if (options.steps < 0 || options.batch < 1 || options.learning_rate < 0.0f ||
        options.weight_decay < 0.0f || options.clip < 0.0f ||
        options.warmup < 0 || options.schedule_offset < 0 ||
        options.schedule_total < 0 || options.report_every < 1 ||
        options.validation_batches < 1 || options.save_every < 0 ||
        options.generate_tokens < 0 || options.temperature < 0.0f ||
        options.top_k < 0 || options.top_k > cfg.vocab ||
        options.dropout < 0.0f || options.dropout >= 1.0f ||
        options.patience < 0 || options.repetition_penalty < 1.0f ||
        options.channel_weight <= 0.0f || options.foundation_weight <= 0.0f ||
        options.artifact_weight < 1 || options.artifact_weight > 32 ||
        options.zero1_weight < 0.0f || options.zero1_weight > 1.0f ||
        options.gradient_cosine_every < 0 ||
        options.transaction_probe_every < 1 ||
        options.transaction_probe_every > 5 ||
        (options.transaction_mode == TRANSACTION_CUMULATIVE_GUARD &&
         options.transaction_probe_every != 1) ||
        options.transaction_guard_budget < 0.0f ||
        options.transaction_max_rejections < 1 ||
        (options.schedule_total > 0 &&
         options.schedule_offset + options.steps > options.schedule_total)) {
        fail("invalid training or generation option");
    }
    if (options.transaction_mode != TRANSACTION_DISABLED &&
        (options.teacher_count == 0 || text_count == 0 ||
         options.transaction_log_path == NULL)) {
        fail("transaction mode requires data, a final immutable reference teacher, and --transaction-log");
    }
    for (i = 0; i < text_count; ++i) {
        int teacher;
        float total = 0.0f;
        if (!text_ranges[i].distill_override) continue;
        if (!text_foundation[i] &&
            text_ranges[i].distill_weights[0] > 0.0f) {
            fail("ZERO.1 distillation is allowed only on --foundation data");
        }
        if (!text_ranges[i].teacher_eligible &&
            (text_ranges[i].distill_weights[1] > 0.0f ||
             text_ranges[i].distill_weights[2] > 0.0f)) {
            fail("--hard-channel cannot receive same-architecture teacher mass");
        }
        if (text_ranges[i].distill_weights[0] > 0.0f &&
            options.zero1_teacher_path == NULL) {
            fail("nonzero ZERO.1 route requires --zero1-teacher");
        }
        for (teacher = 0; teacher < MAX_FACULTY_TEACHERS; ++teacher) {
            total += text_ranges[i].distill_weights[teacher];
        }
        if (total > 1.0f + 1.0e-6f) {
            fail("per-file teacher weights must sum to at most one");
        }
        for (teacher = options.teacher_count + 1;
             teacher < MAX_FACULTY_TEACHERS; ++teacher) {
            if (text_ranges[i].distill_weights[teacher] > 0.0f) {
                fail("per-file route refers to an unloaded teacher");
            }
        }
    }
    if (options.steps > 0 && foundation_count > 0 &&
        options.zero1_weight > 0.0f &&
        options.zero1_teacher_path == NULL) {
        fail("--foundation with nonzero --zero1-weight requires --zero1-teacher");
    }
    if (foundation_count == 0 && options.zero1_teacher_path != NULL) {
        fail("--zero1-teacher requires at least one --foundation file");
    }
    if (options.save_every > 0 && options.save_path == NULL) {
        fail("--save-every requires --save");
    }
    if (options.self_test) {
        free(text_paths);
        free(text_ranges);
        free(text_channel);
        free(text_foundation);
        return run_self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }

    if (options.tokenizer_path != NULL) {
        tokenizer_load(&tokenizer, options.tokenizer_path);
        printf("loaded tokenizer %s\n", options.tokenizer_path);
    }
    if (tokenizer.loaded && tokenizer.vocab != cfg.vocab) {
        fail("tokenizer vocabulary does not match model vocabulary");
    }
    if (!tokenizer.loaded && cfg.vocab > DEFAULT_VOCAB_SIZE) {
        fail("this model requires --tokenizer FILE");
    }

    rng_seed(&rng, (uint64_t)options.seed);
    model_create(&model, cfg, &rng);
    if (options.resume_path != NULL) {
        update = checkpoint_load(options.resume_path, &model, &rng,
                                 &checkpoint_attempts,
                                 &checkpoint_rejections,
                                 &checkpoint_transaction_mode);
        if (!options.eval_only && checkpoint_transaction_mode != 0U &&
            checkpoint_transaction_mode !=
                (uint32_t)options.transaction_mode) {
            fail("resumed transaction checkpoint requires the same transaction mode");
        }
        if (checkpoint_transaction_mode == 0U &&
            options.transaction_mode != TRANSACTION_DISABLED) {
            checkpoint_attempts = update;
            checkpoint_rejections = 0;
        }
        printf("resumed %s at update %llu attempt %llu\n",
               options.resume_path, (unsigned long long)update,
               (unsigned long long)checkpoint_attempts);
    } else if (options.init_path != NULL) {
        uint64_t source_update = artifact_load_weights(options.init_path,
                                                       &model);
        printf("initialized weights from %s source-update=%llu; optimizer "
               "and RNG are fresh\n",
               options.init_path, (unsigned long long)source_update);
    }
    for (i = 0; i < options.teacher_count; ++i) {
        rng_seed(&teacher_rng, (uint64_t)i);
        model_create(&teacher_models[i], cfg, &teacher_rng);
        (void)artifact_load_weights(options.teacher_paths[i],
                                    &teacher_models[i]);
        teacher_loaded[i] = 1;
        printf("loaded frozen faculty teacher %d %s default-weight=%.3f\n",
               i + 2, options.teacher_paths[i], options.teacher_weights[i]);
    }
    if (options.zero1_teacher_path != NULL) {
        zero1_teacher_load(&zero1_teacher, options.zero1_teacher_path);
        printf("ZERO.1 foundation distillation weight=%.3f\n",
               options.zero1_weight);
    }
    if (options.transaction_mode != TRANSACTION_DISABLED) {
        transaction_state_create(
            &transaction, &model,
            &teacher_models[options.teacher_count - 1], &options);
        transaction.attempts = checkpoint_attempts;
        transaction.consecutive_rejections = checkpoint_rejections;
        printf("transaction mode=%s attempt=%llu committed=%llu probe-every=%ld budget=%.6g max-rejections=%ld reference=%s\n",
               transaction_mode_name(options.transaction_mode),
               (unsigned long long)transaction.attempts,
               (unsigned long long)update,
               options.transaction_probe_every,
               options.transaction_guard_budget,
               options.transaction_max_rejections,
               options.teacher_paths[options.teacher_count - 1]);
    }

#ifdef USE_ACCELERATE
    printf("literary_lm: backend=Accelerate");
#else
    printf("literary_lm: backend=portable-C");
#endif
    printf(" context=%d vocab=%d dim=%d heads=%d layers=%d ff=%d positions=%s "
           "parameters=%zu\n",
           cfg.context, cfg.vocab, cfg.dim, cfg.heads, cfg.layers, cfg.ff,
           cfg.rotary ? "rotary" : "learned",
           model_parameter_total(&model));

    if (options.steps > 0 || options.eval_only) {
        size_t minimum;
        if (text_count == 0) {
            corpus_use_sample(&corpus);
            printf("using embedded demonstration corpus; pass --text FILE for real training\n");
        } else {
            for (i = 0; i < text_count; ++i) {
                size_t before = corpus.length;
                corpus_add_file(&corpus, text_paths[i],
                                text_channel[i]
                                    ? 2
                                    : (tokenizer.loaded ? tokenizer.token_width
                                                        : 1));
                text_ranges[i].start = before + (before != 0 ? 2 : 0);
                text_ranges[i].length = corpus.length - text_ranges[i].start;
                text_ranges[i].channel = text_channel[i];
                text_ranges[i].foundation = text_foundation[i];
                if (text_ranges[i].weight == 0.0f) {
                    text_ranges[i].weight =
                        text_channel[i]
                            ? options.channel_weight
                            : (text_foundation[i] ? options.foundation_weight
                                                  : 1.0f);
                }
            }
        }
        for (i = 0; i < (int)corpus.length; ++i) {
            if (corpus.data[i] >= cfg.vocab) {
                fail("training corpus contains a token outside the vocabulary");
            }
        }
        minimum = 2 * ((size_t)cfg.context + 1);
        if (text_count == 0) {
            if (corpus.length < minimum) {
                fail("corpus is too short for separate training and validation windows");
            }
            validation_length = corpus.length / 20;
            if (validation_length < (size_t)cfg.context + 1) {
                validation_length = (size_t)cfg.context + 1;
            }
            training_length = corpus.length - validation_length;
        } else {
            for (i = 0; i < text_count; ++i) {
                CorpusRange *range = &text_ranges[i];
                if (range->channel) {
                    prepare_channel_range(range, &corpus, cfg.context,
                                          text_paths[i]);
                } else {
                    if (range->length < minimum) {
                        fprintf(stderr,
                                "error: training file '%s' is too short for a "
                                "per-file training/validation split\n",
                                text_paths[i]);
                        exit(EXIT_FAILURE);
                    }
                    range->validation_length = range->length / 20;
                    if (range->validation_length < (size_t)cfg.context + 1) {
                        range->validation_length = (size_t)cfg.context + 1;
                    }
                    range->training_length =
                        range->length - range->validation_length;
                    range->validation_start =
                        range->start + range->training_length;
                }
                training_length += range->training_length;
                validation_length += range->validation_length;
            }
        }
        printf("corpus=%zu tokens train=%zu validation=%zu tokens/update=%d "
               "sampling=%s\n",
               corpus.length, training_length, validation_length,
               cfg.context * options.batch,
               text_count > 0 ? "weighted-files-and-channel-records"
                              : "uniform-bytes");

        if (options.transaction_mode == TRANSACTION_CUMULATIVE_GUARD) {
            transaction_initialize_cumulative_baseline(
                &transaction, &teacher_models[options.teacher_count - 1],
                &corpus, text_ranges, text_count, options.artifact_weight);
            printf("cumulative replay baseline=%.9g ranges=%d\n",
                   transaction.cumulative_baseline_mean,
                   transaction.cumulative_replay_count);
        }

        if (options.eval_only) {
            float validation_loss;
            int validation_batches = options.validation_batches;
            if (text_count > 0) {
                if (validation_batches < text_count) {
                    validation_batches = text_count;
                }
                validation_loss = evaluate_balanced(
                    &model, &corpus, text_ranges, text_count,
                    validation_batches, options.artifact_weight);
            } else {
                validation_loss = evaluate(
                    &model, corpus.data + training_length, validation_length,
                    validation_batches);
            }
            printf("evaluation-only val %.4f batches=%d (no update, no save)\n",
                   validation_loss, validation_batches);
        } else {
        signal(SIGINT, on_interrupt);
        training_start = wall_seconds();
        interval_start = training_start;
        {
            unsigned char *loss_mask = zero_alloc((size_t)cfg.context, 1);
            unsigned char *teacher_mask = zero_alloc((size_t)cfg.context, 1);
            float *zero1_probabilities = zero1_teacher.loaded
                ? zero_alloc((size_t)cfg.context * cfg.vocab, sizeof(float))
                : NULL;
            while (completed_steps < options.steps && !interrupted &&
                   !stop_training) {
            int batch;
            float gradient_norm;
            float current_lr;
            int accepted = 1;
            int functional_probe = 0;
            int replay_range_index = -1;
            float gradient_cosine = NAN;
            float probe_before = NAN;
            const CorpusRange *replay_range = NULL;
            model_zero_grad(&model);
            transaction.source_mask = 0;
            for (batch = 0; batch < options.batch; ++batch) {
                size_t choices;
                size_t start;
                const unsigned char *active_mask = NULL;
                const unsigned char *active_teacher_mask = NULL;
                const CorpusRange *active_range = NULL;
                int foundation_sample = 0;
                int teacher_sample = 1;
                const float *teacher_probabilities[MAX_FACULTY_TEACHERS] = {
                    NULL, NULL, NULL
                };
                float active_teacher_weights[MAX_FACULTY_TEACHERS] = {
                    0.0f, 0.0f, 0.0f
                };
                int teacher;
                if (text_count > 0) {
                    int range_index = choose_weighted_range(
                        text_ranges, text_count, &rng);
                    const CorpusRange *range = &text_ranges[range_index];
                    if (options.transaction_mode != TRANSACTION_DISABLED) {
                        if (range_index >= 64) {
                            fail("transaction source mask supports at most 64 data ranges");
                        }
                        transaction.source_mask |= UINT64_C(1) << range_index;
                    }
                    active_range = range;
                    foundation_sample = range->foundation;
                    teacher_sample = range->teacher_eligible;
                    if (range->channel) {
                        size_t record = (size_t)(rng_next(&rng) %
                                                range->training_record_count);
                        start = range->record_starts[record];
                        if (channel_loss_mask(corpus.data + start,
                                              corpus.data + start + 1,
                                              loss_mask, cfg.context,
                                              options.artifact_weight) == 0) {
                            fail("channel training window has no reply target");
                        }
                        active_mask = loss_mask;
                        channel_teacher_mask(
                            corpus.data + start + 1, loss_mask, teacher_mask,
                            cfg.context);
                        active_teacher_mask = teacher_mask;
                    } else {
                        choices = range->training_length - (size_t)cfg.context;
                        start = range->start +
                                (size_t)(rng_next(&rng) % choices);
                    }
                } else {
                    choices = training_length - (size_t)cfg.context;
                    start = (size_t)(rng_next(&rng) % choices);
                }
                for (teacher = 0; teacher < options.teacher_count; ++teacher) {
                    float route_weight =
                        active_range != NULL && active_range->distill_override
                            ? active_range->distill_weights[teacher + 1]
                            : (teacher_sample
                                   ? options.teacher_weights[teacher]
                                   : 0.0f);
                    if (teacher_loaded[teacher] && route_weight > 0.0f) {
                        model_forward(&teacher_models[teacher],
                                      corpus.data + start, NULL, 0.0f, NULL);
                        teacher_probabilities[teacher + 1] =
                            teacher_models[teacher].probs;
                        active_teacher_weights[teacher + 1] = route_weight;
                    }
                }
                active_teacher_weights[0] =
                    active_range != NULL && active_range->distill_override
                        ? active_range->distill_weights[0]
                        : (foundation_sample ? options.zero1_weight : 0.0f);
                if (foundation_sample && zero1_teacher.loaded &&
                    active_teacher_weights[0] > 0.0f) {
                    zero1_teacher_sequence(
                        &zero1_teacher, corpus.data + start, cfg.context,
                        cfg.vocab, zero1_probabilities);
                    teacher_probabilities[0] = zero1_probabilities;
                }
                (void)model_forward_masked(
                    &model, corpus.data + start, corpus.data + start + 1,
                    options.dropout, &rng, active_mask);
                {
                    float loss = model_blended_loss(
                        &model, corpus.data + start + 1, active_mask,
                        active_teacher_mask, teacher_probabilities,
                        active_teacher_weights, MAX_FACULTY_TEACHERS);
                    model_backward_blended_masked(
                        &model, corpus.data + start,
                        corpus.data + start + 1, active_mask,
                        active_teacher_mask, teacher_probabilities,
                        active_teacher_weights, MAX_FACULTY_TEACHERS);
                    interval_loss += loss;
                }
                ++interval_sequences;
            }
            ++completed_steps;
            if (options.transaction_mode != TRANSACTION_DISABLED) {
                ++transaction.attempts;
                functional_probe =
                    (transaction.attempts - 1) %
                            (uint64_t)options.transaction_probe_every ==
                        0;
                gradient_cosine = transaction_prepare_attempt(
                    &transaction, &model, &corpus, text_ranges, text_count,
                    options.artifact_weight, &replay_range,
                    &replay_range_index, functional_probe, &probe_before);
            }
            current_lr = options.learning_rate;
            {
                long schedule_step = options.schedule_offset + completed_steps;
                long schedule_total = options.schedule_total > 0
                                          ? options.schedule_total
                                          : options.steps;
            if (options.warmup > 0 && schedule_step <= options.warmup) {
                current_lr *= (float)schedule_step / options.warmup;
            }
            if (options.cosine_decay && schedule_total > options.warmup &&
                schedule_step > options.warmup) {
                float progress =
                    (float)(schedule_step - options.warmup) /
                    (float)(schedule_total - options.warmup);
                const float pi = 3.14159265358979323846f;
                if (progress > 1.0f) progress = 1.0f;
                current_lr *= 0.5f * (1.0f + cosf(pi * progress));
            }
            }
            gradient_norm = optimizer_update(
                &model, update + 1, current_lr, options.weight_decay,
                options.clip,
                1.0f / options.batch);
            if (options.transaction_mode != TRANSACTION_DISABLED) {
                accepted = transaction_decide_attempt(
                    &transaction, &model, &corpus, text_ranges, text_count,
                    replay_range,
                    replay_range_index, &options, update + 1, current_lr,
                    gradient_norm, gradient_cosine, functional_probe,
                    probe_before);
                if (!accepted &&
                    transaction.consecutive_rejections >=
                        (uint32_t)options.transaction_max_rejections) {
                    printf("transaction fallback: stopping after %u consecutive rejections\n",
                           transaction.consecutive_rejections);
                    stop_training = 1;
                }
                printf("attempt %8llu candidate-update %8llu %s replay-range %d cosine %.6f\n",
                       (unsigned long long)transaction.attempts,
                       (unsigned long long)(update + 1),
                       accepted ? "accepted" : "rejected",
                       replay_range_index, gradient_cosine);
            }
            if (accepted) ++update;
            interval_tokens += (uint64_t)cfg.context * options.batch;

            if (options.transaction_mode == TRANSACTION_DISABLED &&
                options.gradient_cosine_every > 0 && text_count > 0 &&
                (options.schedule_offset + completed_steps) %
                        options.gradient_cosine_every ==
                    0) {
                int replay_range_index = -1;
                uint64_t probe_index =
                    (uint64_t)((options.schedule_offset + completed_steps) /
                               options.gradient_cosine_every - 1);
                float cosine = faculty_replay_gradient_cosine(
                    &model, &corpus, text_ranges, text_count, probe_index,
                    options.artifact_weight, &replay_range_index);
                printf("gradient-cosine update %llu phase-update %ld faculty-hard replay-range %d cosine %.6f\n",
                       (unsigned long long)update,
                       options.schedule_offset + completed_steps,
                       replay_range_index, cosine);
                fflush(stdout);
            }

            if ((accepted && update % (uint64_t)options.report_every == 0) ||
                completed_steps == options.steps || stop_training) {
                double now = wall_seconds();
                double elapsed = now - interval_start;
                float validation_loss;
                if (text_count > 0) {
                    int validation_batches = options.validation_batches;
                    if (validation_batches < text_count) {
                        validation_batches = text_count;
                    }
                    validation_loss = evaluate_balanced(
                        &model, &corpus, text_ranges, text_count,
                        validation_batches, options.artifact_weight);
                } else {
                    validation_loss = evaluate(
                        &model, corpus.data + training_length, validation_length,
                        options.validation_batches);
                }
                printf("update %8llu train %.4f val %.4f grad %.3f lr %.6g "
                       "tok/s %.0f\n",
                       (unsigned long long)update,
                       (float)(interval_loss / interval_sequences), validation_loss,
                       gradient_norm, current_lr,
                       elapsed > 0.0 ? interval_tokens / elapsed : 0.0);
                fflush(stdout);
                interval_loss = 0.0;
                interval_sequences = 0;
                interval_tokens = 0;
                interval_start = now;
                if (validation_loss < best_validation - 1.0e-5f) {
                    best_validation = validation_loss;
                    stale_reports = 0;
                    if (options.best_path != NULL) {
                        checkpoint_save(
                            options.best_path, &model, update, &rng,
                            options.transaction_mode != TRANSACTION_DISABLED
                                ? transaction.attempts
                                : checkpoint_attempts +
                                      (uint64_t)completed_steps,
                            options.transaction_mode != TRANSACTION_DISABLED
                                ? transaction.consecutive_rejections
                                : 0,
                            (uint32_t)options.transaction_mode);
                        printf("saved best %s (val %.4f)\n", options.best_path,
                               best_validation);
                    }
                } else {
                    ++stale_reports;
                    if (options.patience > 0 &&
                        stale_reports >= options.patience) {
                        printf("early stopping after %ld stale reports; best "
                               "val %.4f\n", stale_reports, best_validation);
                        stop_training = 1;
                    }
                }
            }
            if (options.save_path != NULL && options.save_every > 0 &&
                accepted && update % (uint64_t)options.save_every == 0) {
                checkpoint_save(
                    options.save_path, &model, update, &rng,
                    options.transaction_mode != TRANSACTION_DISABLED
                        ? transaction.attempts
                        : checkpoint_attempts + (uint64_t)completed_steps,
                    options.transaction_mode != TRANSACTION_DISABLED
                        ? transaction.consecutive_rejections
                        : 0,
                    (uint32_t)options.transaction_mode);
                printf("saved %s\n", options.save_path);
            }
            }
            free(zero1_probabilities);
            free(teacher_mask);
            free(loss_mask);
        }
        printf("training time %.2f seconds\n", wall_seconds() - training_start);
        if (interrupted) {
            printf("interrupted after update %llu\n", (unsigned long long)update);
        }
        if (options.save_path != NULL && completed_steps > 0) {
            checkpoint_save(
                options.save_path, &model, update, &rng,
                options.transaction_mode != TRANSACTION_DISABLED
                    ? transaction.attempts
                    : checkpoint_attempts + (uint64_t)completed_steps,
                options.transaction_mode != TRANSACTION_DISABLED
                    ? transaction.consecutive_rejections
                    : 0,
                (uint32_t)options.transaction_mode);
            printf("saved %s\n", options.save_path);
        }
        }
    }

    if (options.generate_tokens > 0) {
        generate(&model, &tokenizer, options.prompt, options.generate_tokens,
                 options.temperature, options.top_k,
                 options.repetition_penalty, &rng);
    }

    corpus_destroy(&corpus);
    if (options.transaction_mode != TRANSACTION_DISABLED) {
        transaction_state_destroy(&transaction);
    }
    model_destroy(&model);
    for (i = 0; i < options.teacher_count; ++i) {
        if (teacher_loaded[i]) model_destroy(&teacher_models[i]);
    }
    if (zero1_teacher.loaded) zero1_teacher_destroy(&zero1_teacher);
    for (i = 0; i < text_count; ++i) free(text_ranges[i].record_starts);
    free(text_paths);
    free(text_ranges);
    free(text_channel);
    free(text_foundation);
    return EXIT_SUCCESS;
}
