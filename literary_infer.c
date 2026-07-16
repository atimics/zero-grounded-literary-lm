#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

#define MAX_PARAMETERS 128

typedef struct {
    char magic[8];
    uint32_t version, vocab, context, dim, heads, layers, ff;
    uint32_t parameter_count;
    uint64_t step;
} InferenceHeader;

typedef struct {
    uint32_t encoding, rows, columns, count;
} TensorHeader;

typedef struct {
    uint32_t encoding, rows, columns, count;
    const float *values;
    const float *scales;
    const int8_t *quantized;
} Tensor;

typedef struct {
    int token;
    float score;
} Candidate;

static InferenceHeader config;
static Tensor parameters[MAX_PARAMETERS];
static float *key_cache;
static float *value_cache;
static float *x;
static float *normalized;
static float *query;
static float *key;
static float *value;
static float *attention;
static float *temporary;
static float *feed_forward_pre;
static float *feed_forward_act;
static float *scores;
static float *logits;
static Candidate *candidates;
static uint16_t recent[64];
static int recent_count;
static int recent_next;
static uint64_t position;
static uint32_t random_state = 1;
static int loaded;

static void release_working_memory(void)
{
    free(key_cache);
    free(value_cache);
    free(x);
    free(normalized);
    free(query);
    free(key);
    free(value);
    free(attention);
    free(temporary);
    free(feed_forward_pre);
    free(feed_forward_act);
    free(scores);
    free(logits);
    free(candidates);
    key_cache = NULL;
    value_cache = NULL;
    x = normalized = query = key = value = attention = temporary = NULL;
    feed_forward_pre = feed_forward_act = scores = logits = NULL;
    candidates = NULL;
    loaded = 0;
}

static void *allocate_zero(size_t count, size_t size)
{
    if (size != 0 && count > SIZE_MAX / size) return NULL;
    return calloc(count, size);
}

static int allocate_working_memory(void)
{
    size_t cache_count =
        (size_t)config.layers * config.context * config.dim;
    key_cache = allocate_zero(cache_count, sizeof(float));
    value_cache = allocate_zero(cache_count, sizeof(float));
    x = allocate_zero(config.dim, sizeof(float));
    normalized = allocate_zero(config.dim, sizeof(float));
    query = allocate_zero(config.dim, sizeof(float));
    key = allocate_zero(config.dim, sizeof(float));
    value = allocate_zero(config.dim, sizeof(float));
    attention = allocate_zero(config.dim, sizeof(float));
    temporary = allocate_zero(config.dim, sizeof(float));
    feed_forward_pre = allocate_zero(config.ff, sizeof(float));
    feed_forward_act = allocate_zero(config.ff, sizeof(float));
    scores = allocate_zero(config.context, sizeof(float));
    logits = allocate_zero(config.vocab, sizeof(float));
    candidates = allocate_zero(config.vocab, sizeof(*candidates));
    return key_cache && value_cache && x && normalized && query && key &&
           value && attention && temporary && feed_forward_pre &&
           feed_forward_act && scores && logits && candidates;
}

static void rmsnorm(const float *input, const Tensor *gamma, float *output,
                    int width)
{
    float square_sum = 0.0f;
    float inverse;
    int i;
    for (i = 0; i < width; ++i) square_sum += input[i] * input[i];
    inverse = 1.0f / sqrtf(square_sum / width + 1.0e-5f);
    for (i = 0; i < width; ++i) {
        output[i] = input[i] * inverse * gamma->values[i];
    }
}

static void matrix_vector(const Tensor *matrix, const float *input,
                          float *output)
{
    uint32_t row;
    for (row = 0; row < matrix->rows; ++row) {
        const int8_t *weights =
            matrix->quantized + (size_t)row * matrix->columns;
        float sum = 0.0f;
        uint32_t column;
        for (column = 0; column < matrix->columns; ++column) {
            sum += weights[column] * input[column];
        }
        output[row] = sum * matrix->scales[row];
    }
}

static void embedding_row(const Tensor *embedding, int token, float *output)
{
    const int8_t *weights =
        embedding->quantized + (size_t)token * embedding->columns;
    float scale = embedding->scales[token];
    uint32_t i;
    for (i = 0; i < embedding->columns; ++i) output[i] = weights[i] * scale;
}

static float gelu(float value)
{
    return 0.5f * value *
           (1.0f + tanhf(0.7978845608028654f *
                          (value + 0.044715f * value * value * value)));
}

static void apply_rope(float *vector, uint64_t token_position)
{
    int head_width = (int)config.dim / (int)config.heads;
    int head;
    for (head = 0; head < (int)config.heads; ++head) {
        int offset = head * head_width;
        int pair;
        for (pair = 0; pair < head_width / 2; ++pair) {
            float frequency = powf(10000.0f, -(2.0f * pair) / head_width);
            float angle = (float)token_position * frequency;
            float cosine = cosf(angle);
            float sine = sinf(angle);
            float a = vector[offset + 2 * pair];
            float b = vector[offset + 2 * pair + 1];
            vector[offset + 2 * pair] = a * cosine - b * sine;
            vector[offset + 2 * pair + 1] = a * sine + b * cosine;
        }
    }
}

static void causal_attention(int layer)
{
    int head_width = (int)config.dim / (int)config.heads;
    uint64_t first = position + 1 > config.context
                         ? position + 1 - config.context
                         : 0;
    int current_slot = (int)(position % config.context);
    size_t current_offset =
        ((size_t)layer * config.context + current_slot) * config.dim;
    int head;
    memcpy(key_cache + current_offset, key, config.dim * sizeof(float));
    memcpy(value_cache + current_offset, value, config.dim * sizeof(float));
    memset(attention, 0, config.dim * sizeof(float));

    for (head = 0; head < (int)config.heads; ++head) {
        int head_offset = head * head_width;
        float maximum = -INFINITY;
        float total = 0.0f;
        int count = 0;
        uint64_t source;
        for (source = first; source <= position; ++source) {
            int slot = (int)(source % config.context);
            const float *cached_key =
                key_cache +
                ((size_t)layer * config.context + slot) * config.dim +
                head_offset;
            float score = 0.0f;
            int i;
            for (i = 0; i < head_width; ++i) {
                score += query[head_offset + i] * cached_key[i];
            }
            score /= sqrtf((float)head_width);
            scores[count++] = score;
            if (score > maximum) maximum = score;
        }
        for (int index = 0; index < count; ++index) {
            scores[index] = expf(scores[index] - maximum);
            total += scores[index];
        }
        count = 0;
        for (source = first; source <= position; ++source) {
            int slot = (int)(source % config.context);
            const float *cached_value =
                value_cache +
                ((size_t)layer * config.context + slot) * config.dim +
                head_offset;
            float probability = scores[count++] / total;
            int i;
            for (i = 0; i < head_width; ++i) {
                attention[head_offset + i] += probability * cached_value[i];
            }
        }
    }
}

API int lm_load(const unsigned char *data, int length)
{
    static const char magic[8] = {'L', 'I', 'T', 'Q', '8', 'V', '1', '\0'};
    const unsigned char *cursor = data;
    const unsigned char *end = data + length;
    uint32_t index;
    release_working_memory();
    if (length < (int)sizeof(config)) return -1;
    memcpy(&config, cursor, sizeof(config));
    cursor += sizeof(config);
    if (memcmp(config.magic, magic, 8) != 0 || config.version != 1 ||
        config.vocab < 2 || config.vocab > 2048 || config.context < 2 ||
        config.context > 4096 || config.dim < 2 || config.layers < 1 ||
        config.parameter_count > MAX_PARAMETERS ||
        config.parameter_count != 2 + config.layers * 8) {
        return -2;
    }
    memset(parameters, 0, sizeof(parameters));
    for (index = 0; index < config.parameter_count; ++index) {
        TensorHeader header;
        Tensor *tensor = &parameters[index];
        size_t amount;
        if ((size_t)(end - cursor) < sizeof(header)) return -3;
        memcpy(&header, cursor, sizeof(header));
        cursor += sizeof(header);
        if (header.count != (uint64_t)header.rows * header.columns ||
            header.rows == 0 || header.columns == 0 || header.encoding > 1) {
            return -4;
        }
        tensor->encoding = header.encoding;
        tensor->rows = header.rows;
        tensor->columns = header.columns;
        tensor->count = header.count;
        if (header.encoding == 0) {
            amount = (size_t)header.count * sizeof(float);
            if ((size_t)(end - cursor) < amount) return -5;
            tensor->values = (const float *)cursor;
            cursor += amount;
        } else {
            amount = (size_t)header.rows * sizeof(float);
            if ((size_t)(end - cursor) < amount) return -6;
            tensor->scales = (const float *)cursor;
            cursor += amount;
            amount = header.count;
            if ((size_t)(end - cursor) < amount) return -7;
            tensor->quantized = (const int8_t *)cursor;
            cursor += amount;
        }
    }
    if (!allocate_working_memory()) {
        release_working_memory();
        return -8;
    }
    loaded = 1;
    position = 0;
    recent_count = recent_next = 0;
    return 0;
}

API void lm_reset(void)
{
    if (!loaded) return;
    memset(key_cache, 0,
           (size_t)config.layers * config.context * config.dim * sizeof(float));
    memset(value_cache, 0,
           (size_t)config.layers * config.context * config.dim * sizeof(float));
    position = 0;
    recent_count = recent_next = 0;
}

API void lm_seed(uint32_t seed)
{
    random_state = seed ? seed : 1;
}

API int lm_feed(int token)
{
    int layer;
    if (!loaded || token < 0 || token >= (int)config.vocab) return -1;
    embedding_row(&parameters[0], token, x);
    for (layer = 0; layer < (int)config.layers; ++layer) {
        int base = 1 + layer * 8;
        int i;
        rmsnorm(x, &parameters[base], normalized, (int)config.dim);
        matrix_vector(&parameters[base + 1], normalized, query);
        matrix_vector(&parameters[base + 2], normalized, key);
        matrix_vector(&parameters[base + 3], normalized, value);
        apply_rope(query, position);
        apply_rope(key, position);
        causal_attention(layer);
        matrix_vector(&parameters[base + 4], attention, temporary);
        for (i = 0; i < (int)config.dim; ++i) x[i] += temporary[i];

        rmsnorm(x, &parameters[base + 5], normalized, (int)config.dim);
        matrix_vector(&parameters[base + 6], normalized, feed_forward_pre);
        for (i = 0; i < (int)config.ff; ++i) {
            feed_forward_act[i] = gelu(feed_forward_pre[i]);
        }
        matrix_vector(&parameters[base + 7], feed_forward_act, temporary);
        for (i = 0; i < (int)config.dim; ++i) x[i] += temporary[i];
    }
    rmsnorm(x, &parameters[1 + config.layers * 8], normalized,
            (int)config.dim);
    {
        const Tensor *embedding = &parameters[0];
        int output_token;
        for (output_token = 0; output_token < (int)config.vocab;
             ++output_token) {
            const int8_t *weights =
                embedding->quantized +
                (size_t)output_token * embedding->columns;
            float sum = 0.0f;
            int i;
            for (i = 0; i < (int)config.dim; ++i) {
                sum += weights[i] * normalized[i];
            }
            logits[output_token] = sum * embedding->scales[output_token];
        }
    }
    recent[recent_next] = (uint16_t)token;
    recent_next = (recent_next + 1) % 64;
    if (recent_count < 64) ++recent_count;
    ++position;
    return 0;
}

static int candidate_compare(const void *left, const void *right)
{
    const Candidate *a = (const Candidate *)left;
    const Candidate *b = (const Candidate *)right;
    if (a->score < b->score) return 1;
    if (a->score > b->score) return -1;
    return a->token - b->token;
}

static float random_unit(void)
{
    uint32_t value = random_state;
    value ^= value << 13;
    value ^= value >> 17;
    value ^= value << 5;
    random_state = value;
    return (value >> 8) * (1.0f / 16777216.0f);
}

API int lm_sample(float temperature, int top_k, float repetition_penalty)
{
    int token;
    int limit;
    float maximum;
    float total = 0.0f;
    float threshold;
    if (!loaded || repetition_penalty < 1.0f) return -1;
    for (token = 0; token < (int)config.vocab; ++token) {
        int repeated = 0;
        int i;
        float score = logits[token];
        for (i = 0; i < recent_count; ++i) {
            if (recent[i] == token) {
                repeated = 1;
                break;
            }
        }
        if (repeated) score -= logf(repetition_penalty);
        if (!(token == '\n' || (token >= 32 && token < 127))) {
            score = -INFINITY;
        }
        candidates[token].token = token;
        candidates[token].score = score;
    }
    qsort(candidates, config.vocab, sizeof(*candidates), candidate_compare);
    if (temperature <= 0.0f) return candidates[0].token;
    limit = top_k > 0 && top_k < (int)config.vocab ? top_k : (int)config.vocab;
    maximum = candidates[0].score;
    for (token = 0; token < limit; ++token) {
        candidates[token].score =
            expf((candidates[token].score - maximum) / temperature);
        total += candidates[token].score;
    }
    threshold = random_unit() * total;
    for (token = 0; token < limit; ++token) {
        threshold -= candidates[token].score;
        if (threshold <= 0.0f) return candidates[token].token;
    }
    return candidates[limit - 1].token;
}

API int lm_get_context(void) { return (int)config.context; }
API int lm_get_position(void) { return (int)position; }
API int lm_get_update(void) { return (int)config.step; }
API int lm_get_parameters(void)
{
    int index;
    uint64_t total = 0;
    for (index = 0; index < (int)config.parameter_count; ++index) {
        total += parameters[index].count;
    }
    return (int)total;
}

#ifndef __EMSCRIPTEN__
int main(int argc, char **argv)
{
    FILE *file;
    long size;
    unsigned char *data;
    const char *prompt;
    int count;
    int i;
    if (argc < 4) {
        fprintf(stderr, "usage: %s MODEL PROMPT TOKENS\n", argv[0]);
        return EXIT_FAILURE;
    }
    file = fopen(argv[1], "rb");
    if (!file || fseek(file, 0, SEEK_END) != 0 || (size = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0) {
        fprintf(stderr, "error: cannot open model\n");
        return EXIT_FAILURE;
    }
    data = malloc((size_t)size);
    if (!data || fread(data, 1, (size_t)size, file) != (size_t)size) {
        fprintf(stderr, "error: cannot read model\n");
        return EXIT_FAILURE;
    }
    fclose(file);
    if (lm_load(data, (int)size) != 0) {
        fprintf(stderr, "error: invalid model\n");
        return EXIT_FAILURE;
    }
    prompt = argv[2];
    count = atoi(argv[3]);
    for (i = 0; prompt[i]; ++i) {
        unsigned char token = (unsigned char)prompt[i];
        lm_feed(token < config.vocab ? token : '?');
        putchar(prompt[i]);
    }
    for (i = 0; i < count; ++i) {
        int token = lm_sample(0.62f, 28, 1.12f);
        putchar(token);
        lm_feed(token);
    }
    putchar('\n');
    free(data);
    release_working_memory();
    return EXIT_SUCCESS;
}
#endif
