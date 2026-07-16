#include <errno.h>
#include <math.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "channel_protocol.h"

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
#define CHECKPOINT_VERSION 3U
#define RMS_EPSILON 1.0e-5f
#define BPE_BASE_TOKENS 128
#define BPE_MAX_MERGES (MAX_VOCAB_SIZE - BPE_BASE_TOKENS)

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
    float weight;
    size_t *record_starts;
    size_t record_count;
    size_t training_record_count;
    size_t validation_record_index;
    size_t validation_record_count;
} CorpusRange;

typedef struct {
    long steps;
    int batch;
    float learning_rate;
    float weight_decay;
    float clip;
    long warmup;
    long report_every;
    int validation_batches;
    const char *save_path;
    long save_every;
    const char *resume_path;
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
    const char *tokenizer_path;
    float repetition_penalty;
    float channel_weight;
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
    int loss_count = cfg->context;
    float loss = 0.0f;
    LayerCache *first = &model->cache[0];

    if (loss_mask != NULL) {
        loss_count = 0;
        for (time = 0; time < cfg->context; ++time) {
            if (loss_mask[time]) ++loss_count;
        }
        if (loss_count == 0) loss_count = 1;
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
            loss -= logf(probability) / loss_count;
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

/* Adds this sequence's gradients; call model_zero_grad before a new batch. */
static void model_backward_masked(Model *model, const Token *tokens,
                                  const Token *targets,
                                  const unsigned char *loss_mask)
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
    int loss_count = cfg->context;

    if (loss_mask != NULL) {
        loss_count = 0;
        for (time = 0; time < cfg->context; ++time) {
            if (loss_mask[time]) ++loss_count;
        }
        if (loss_count == 0) loss_count = 1;
    }

    memset(dy, 0, td * sizeof(float));
    for (time = 0; time < cfg->context; ++time) {
        float *row = &model->probs[time * cfg->vocab];
        for (token = 0; token < cfg->vocab; ++token) {
            row[token] = loss_mask != NULL && !loss_mask[time]
                             ? 0.0f
                             : (row[token] -
                                (token == targets[time] ? 1.0f : 0.0f)) /
                                   loss_count;
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

static int channel_loss_mask(const Token *tokens, const Token *targets,
                             unsigned char *mask, int context)
{
    int active = 0;
    int count = 0;
    int time;
    for (time = 0; time < context; ++time) {
        if (tokens[time] == CHANNEL_TARGET_TOKEN) active = 1;
        mask[time] = (unsigned char)active;
        if (active) ++count;
        if (targets[time] == CHANNEL_MESSAGE_END_TOKEN ||
            targets[time] == CHANNEL_RECORD_END_TOKEN) {
            active = 0;
        }
    }
    return count;
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

static const char CHECKPOINT_MAGIC[8] = {'Z', 'E', 'R', 'O', 'L', 'M', '2', '\0'};

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
         header.version != CHECKPOINT_VERSION) ||
        header.vocab < 2 || header.vocab > MAX_VOCAB_SIZE) {
        fail("unsupported or corrupt checkpoint");
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

static void checkpoint_save(const char *path, const Model *model, uint64_t step,
                            const Rng *rng)
{
    CheckpointHeader header;
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

    if (!write_items(file, &header, sizeof(header), 1)) {
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

static uint64_t checkpoint_load(const char *path, Model *model, Rng *rng)
{
    CheckpointHeader header;
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
    return header.step;
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
                               int batches)
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
                                      model->cfg.context) == 0) {
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
    printf("  --channel FILE       add a structured reply-record token file\n");
    printf("  --channel-weight X   sampling weight per channel file (default: 1)\n");
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
    printf("  --report N           report interval (default: 100)\n");
    printf("  --validation N       validation sequences per report (default: 8)\n");
    printf("  --dropout X          residual dropout probability (default: 0.1)\n");
    printf("  --cosine             cosine-decay the learning rate over this run\n");
    printf("  --best FILE          save each new best-validation checkpoint\n");
    printf("  --patience N         early-stop after N stale validation reports\n");
    printf("  --seed N             deterministic seed (default: 0)\n\n");
    printf("checkpoints and generation:\n");
    printf("  --save FILE          save model and AdamW state\n");
    printf("  --save-every N       periodic checkpoint interval\n");
    printf("  --resume FILE        resume architecture, weights, optimizer, and RNG\n");
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
        if (channel_loss_mask(channel_tokens, channel_targets, mask, 4) != 3) {
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
    int text_count = 0;
    int i;
    Rng rng;
    Model model;
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

    memset(&options, 0, sizeof(options));
    options.steps = 1000;
    options.batch = 1;
    options.learning_rate = 3.0e-4f;
    options.weight_decay = 0.01f;
    options.clip = 1.0f;
    options.warmup = 100;
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
    text_paths = zero_alloc((size_t)(argc > 1 ? argc : 1), sizeof(*text_paths));
    text_ranges = zero_alloc((size_t)(argc > 1 ? argc : 1), sizeof(*text_ranges));
    text_channel = zero_alloc((size_t)(argc > 1 ? argc : 1),
                              sizeof(*text_channel));

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
            return EXIT_SUCCESS;
        } else if (strcmp(argv[i], "--preset") == 0 && i + 1 < argc) {
            ++i;
        } else if (strcmp(argv[i], "--text") == 0 && i + 1 < argc) {
            text_paths[text_count++] = argv[++i];
        } else if (strcmp(argv[i], "--channel") == 0 && i + 1 < argc) {
            text_channel[text_count] = 1;
            text_paths[text_count++] = argv[++i];
        } else if (strcmp(argv[i], "--channel-weight") == 0 &&
                   i + 1 < argc) {
            options.channel_weight =
                parse_float(argv[++i], "--channel-weight");
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
        } else if (strcmp(argv[i], "--report") == 0 && i + 1 < argc) {
            options.report_every = parse_long(argv[++i], "--report");
        } else if (strcmp(argv[i], "--validation") == 0 && i + 1 < argc) {
            options.validation_batches =
                (int)parse_long(argv[++i], "--validation");
        } else if (strcmp(argv[i], "--dropout") == 0 && i + 1 < argc) {
            options.dropout = parse_float(argv[++i], "--dropout");
        } else if (strcmp(argv[i], "--cosine") == 0) {
            options.cosine_decay = 1;
        } else if (strcmp(argv[i], "--best") == 0 && i + 1 < argc) {
            options.best_path = argv[++i];
        } else if (strcmp(argv[i], "--patience") == 0 && i + 1 < argc) {
            options.patience = parse_long(argv[++i], "--patience");
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            options.seed = parse_long(argv[++i], "--seed");
        } else if (strcmp(argv[i], "--save") == 0 && i + 1 < argc) {
            options.save_path = argv[++i];
        } else if (strcmp(argv[i], "--save-every") == 0 && i + 1 < argc) {
            options.save_every = parse_long(argv[++i], "--save-every");
        } else if (strcmp(argv[i], "--resume") == 0 && i + 1 < argc) {
            options.resume_path = argv[++i];
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
            return EXIT_FAILURE;
        }
    }

    if (options.resume_path != NULL) {
        cfg = checkpoint_peek(options.resume_path);
        if (options.save_path == NULL) {
            options.save_path = options.resume_path;
        }
    }
    validate_config(&cfg);
    if (options.steps < 0 || options.batch < 1 || options.learning_rate < 0.0f ||
        options.weight_decay < 0.0f || options.clip < 0.0f ||
        options.warmup < 0 || options.report_every < 1 ||
        options.validation_batches < 1 || options.save_every < 0 ||
        options.generate_tokens < 0 || options.temperature < 0.0f ||
        options.top_k < 0 || options.top_k > cfg.vocab ||
        options.dropout < 0.0f || options.dropout >= 1.0f ||
        options.patience < 0 || options.repetition_penalty < 1.0f ||
        options.channel_weight <= 0.0f) {
        fail("invalid training or generation option");
    }
    if (options.save_every > 0 && options.save_path == NULL) {
        fail("--save-every requires --save");
    }
    if (options.self_test) {
        free(text_paths);
        free(text_ranges);
        free(text_channel);
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
        update = checkpoint_load(options.resume_path, &model, &rng);
        printf("resumed %s at update %llu\n", options.resume_path,
               (unsigned long long)update);
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

    if (options.steps > 0) {
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
                text_ranges[i].weight = text_channel[i]
                                            ? options.channel_weight
                                            : 1.0f;
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

        signal(SIGINT, on_interrupt);
        training_start = wall_seconds();
        interval_start = training_start;
        {
            unsigned char *loss_mask = zero_alloc((size_t)cfg.context, 1);
            while (completed_steps < options.steps && !interrupted &&
                   !stop_training) {
            int batch;
            float gradient_norm;
            float current_lr;
            model_zero_grad(&model);
            for (batch = 0; batch < options.batch; ++batch) {
                size_t choices;
                size_t start;
                const unsigned char *active_mask = NULL;
                if (text_count > 0) {
                    int range_index = choose_weighted_range(
                        text_ranges, text_count, &rng);
                    const CorpusRange *range = &text_ranges[range_index];
                    if (range->channel) {
                        size_t record = (size_t)(rng_next(&rng) %
                                                range->training_record_count);
                        start = range->record_starts[record];
                        if (channel_loss_mask(corpus.data + start,
                                              corpus.data + start + 1,
                                              loss_mask, cfg.context) == 0) {
                            fail("channel training window has no reply target");
                        }
                        active_mask = loss_mask;
                    } else {
                        choices = range->training_length - (size_t)cfg.context;
                        start = range->start +
                                (size_t)(rng_next(&rng) % choices);
                    }
                } else {
                    choices = training_length - (size_t)cfg.context;
                    start = (size_t)(rng_next(&rng) % choices);
                }
                float loss = model_forward_masked(
                    &model, corpus.data + start, corpus.data + start + 1,
                    options.dropout, &rng, active_mask);
                model_backward_masked(&model, corpus.data + start,
                                      corpus.data + start + 1, active_mask);
                interval_loss += loss;
                ++interval_sequences;
            }
            ++update;
            ++completed_steps;
            current_lr = options.learning_rate;
            if (options.warmup > 0 && update < (uint64_t)options.warmup) {
                current_lr *= (float)update / options.warmup;
            }
            if (options.cosine_decay && options.steps > options.warmup &&
                completed_steps > options.warmup) {
                float progress =
                    (float)(completed_steps - options.warmup) /
                    (float)(options.steps - options.warmup);
                const float pi = 3.14159265358979323846f;
                if (progress > 1.0f) progress = 1.0f;
                current_lr *= 0.5f * (1.0f + cosf(pi * progress));
            }
            gradient_norm = optimizer_update(
                &model, update, current_lr, options.weight_decay, options.clip,
                1.0f / options.batch);
            interval_tokens += (uint64_t)cfg.context * options.batch;

            if (update % (uint64_t)options.report_every == 0 ||
                completed_steps == options.steps) {
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
                        validation_batches);
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
                        checkpoint_save(options.best_path, &model, update, &rng);
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
                update % (uint64_t)options.save_every == 0) {
                checkpoint_save(options.save_path, &model, update, &rng);
                printf("saved %s\n", options.save_path);
            }
            }
            free(loss_mask);
        }
        printf("training time %.2f seconds\n", wall_seconds() - training_start);
        if (interrupted) {
            printf("interrupted after update %llu\n", (unsigned long long)update);
        }
        if (options.save_path != NULL && completed_steps > 0) {
            checkpoint_save(options.save_path, &model, update, &rng);
            printf("saved %s\n", options.save_path);
        }
    }

    if (options.generate_tokens > 0) {
        generate(&model, &tokenizer, options.prompt, options.generate_tokens,
                 options.temperature, options.top_k,
                 options.repetition_penalty, &rng);
    }

    corpus_destroy(&corpus);
    model_destroy(&model);
    for (i = 0; i < text_count; ++i) free(text_ranges[i].record_starts);
    free(text_paths);
    free(text_ranges);
    free(text_channel);
    return EXIT_SUCCESS;
}
