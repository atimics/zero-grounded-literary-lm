#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"
#include "literary_infer.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define API EMSCRIPTEN_KEEPALIVE
#else
#define API
#endif

#define MAX_PARAMETERS 128
#define HOLO_DIMENSION 256
#define HOLO_CAPACITY 32
#define HOLO_PARTITIONS 4
#define HOLO_PARTITION_CAPACITY (HOLO_CAPACITY / HOLO_PARTITIONS)

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

/*
 * Browser-scale projection of holostuff's LocalAgentCore memory contract:
 * deterministic text hypervectors, an exact cosine index, and honest
 * abstention in the caller.  The transformer remains the summarizer; this
 * index only retrieves an older compressed episode that may be relevant.
 */
static float holo_vectors[HOLO_CAPACITY][HOLO_DIMENSION];
static int holo_count;
static int holo_next;
static float holo_score;
static int holo_mode = LM_HOLO_FLAT;
static int holo_partition_count[HOLO_PARTITIONS];
static int holo_partition_next[HOLO_PARTITIONS];

static uint64_t holo_mix(uint64_t value)
{
    value ^= value >> 30;
    value *= UINT64_C(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value *= UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

static int holo_stopword(const char *word, int length)
{
    static const char *words[] = {
        "and", "are", "but", "for", "from", "have", "not", "only",
        "that", "the", "then", "this", "was", "were", "what", "when",
        "where", "with", "you", "your"
    };
    size_t index;
    for (index = 0; index < sizeof(words) / sizeof(words[0]); ++index) {
        if ((int)strlen(words[index]) == length &&
            memcmp(word, words[index], (size_t)length) == 0) {
            return 1;
        }
    }
    return 0;
}

static void holo_add_feature(float *vector, uint64_t feature, int width,
                             float weight)
{
    uint64_t state = holo_mix(feature);
    int index;
    for (index = 0; index < width; ++index) {
        state = holo_mix(state + (uint64_t)index + UINT64_C(0x9e3779b97f4a7c15));
        vector[state & (HOLO_DIMENSION - 1)] +=
            (state & UINT64_C(0x100)) ? weight : -weight;
    }
}

static void holo_encode(const unsigned char *text, int length, float *vector)
{
    char word[48];
    int word_length = 0;
    uint64_t previous = 0;
    int have_previous = 0;
    int cursor;
    float norm = 0.0f;
    memset(vector, 0, HOLO_DIMENSION * sizeof(*vector));
    for (cursor = 0; cursor <= length; ++cursor) {
        int value = cursor < length ? text[cursor] : ' ';
        int alphanumeric = (value >= 'A' && value <= 'Z') ||
                           (value >= 'a' && value <= 'z') ||
                           (value >= '0' && value <= '9') || value == '_';
        if (alphanumeric && word_length < (int)sizeof(word) - 1) {
            word[word_length++] = (char)(value >= 'A' && value <= 'Z'
                                                    ? value + ('a' - 'A')
                                                    : value);
        } else if (word_length != 0) {
            uint64_t hash = UINT64_C(14695981039346656037);
            int index;
            word[word_length] = '\0';
            for (index = 0; index < word_length; ++index) {
                hash ^= (unsigned char)word[index];
                hash *= UINT64_C(1099511628211);
            }
            if (word_length >= 3 && !holo_stopword(word, word_length)) {
                uint64_t prefix_hash = UINT64_C(14695981039346656037);
                holo_add_feature(vector, hash, 16, 1.0f);
                for (index = 0; index < word_length && index < 6; ++index) {
                    prefix_hash ^= (unsigned char)word[index];
                    prefix_hash *= UINT64_C(1099511628211);
                    if (index >= 3 && index + 1 < word_length) {
                        holo_add_feature(vector, prefix_hash, 6, 0.45f);
                    }
                }
                if (have_previous) {
                    holo_add_feature(vector,
                                     holo_mix(previous ^ (hash << 1)),
                                     8, 0.65f);
                }
                previous = hash;
                have_previous = 1;
            }
            word_length = 0;
        }
    }
    for (cursor = 0; cursor < HOLO_DIMENSION; ++cursor) {
        norm += vector[cursor] * vector[cursor];
    }
    norm = sqrtf(norm);
    if (norm > 0.0f) {
        for (cursor = 0; cursor < HOLO_DIMENSION; ++cursor) {
            vector[cursor] /= norm;
        }
    }
}

/* Deterministic nearest-anchor routing. Similar normalized vectors tend to
 * choose the same partition, keeping each exact-search trace below the flat
 * memory's capacity while retaining one global 32-slot budget. */
static int holo_partition_for_vector(const float *vector)
{
    int best_partition = 0;
    float best_score = -INFINITY;
    int partition;
    for (partition = 0; partition < HOLO_PARTITIONS; ++partition) {
        uint64_t state = holo_mix(UINT64_C(0x7a65726f6d656d31) +
                                  (uint64_t)partition);
        float score = 0.0f;
        int index;
        for (index = 0; index < HOLO_DIMENSION; ++index) {
            state = holo_mix(state + (uint64_t)index +
                             UINT64_C(0x9e3779b97f4a7c15));
            score += vector[index] *
                     ((state & UINT64_C(1)) ? 1.0f : -1.0f);
        }
        if (score > best_score) {
            best_score = score;
            best_partition = partition;
        }
    }
    return best_partition;
}

API void lm_holo_reset(void)
{
    memset(holo_vectors, 0, sizeof(holo_vectors));
    memset(holo_partition_count, 0, sizeof(holo_partition_count));
    memset(holo_partition_next, 0, sizeof(holo_partition_next));
    holo_count = 0;
    holo_next = 0;
    holo_score = 0.0f;
}

API int lm_holo_set_mode(int mode)
{
    if (mode < LM_HOLO_DISABLED || mode > LM_HOLO_PARTITIONED) return -1;
    if (mode != holo_mode) {
        holo_mode = mode;
        lm_holo_reset();
    }
    return 0;
}

API int lm_holo_get_mode(void) { return holo_mode; }

API int lm_holo_remember(const unsigned char *text, int length)
{
    int slot;
    if (holo_mode == LM_HOLO_DISABLED || text == NULL || length <= 0 ||
        length > 8192) {
        return -1;
    }
    if (holo_mode == LM_HOLO_PARTITIONED) {
        float vector[HOLO_DIMENSION];
        int partition;
        holo_encode(text, length, vector);
        partition = holo_partition_for_vector(vector);
        slot = partition * HOLO_PARTITION_CAPACITY +
               holo_partition_next[partition];
        memcpy(holo_vectors[slot], vector, sizeof(vector));
        holo_partition_next[partition] =
            (holo_partition_next[partition] + 1) % HOLO_PARTITION_CAPACITY;
        if (holo_partition_count[partition] < HOLO_PARTITION_CAPACITY) {
            ++holo_partition_count[partition];
            ++holo_count;
        }
        return slot;
    }
    slot = holo_next;
    holo_encode(text, length, holo_vectors[slot]);
    holo_next = (holo_next + 1) % HOLO_CAPACITY;
    if (holo_count < HOLO_CAPACITY) ++holo_count;
    return slot;
}

API int lm_holo_recall(const unsigned char *text, int length)
{
    float query[HOLO_DIMENSION];
    float best = -1.0f;
    int best_slot = -1;
    int slot;
    if (holo_mode == LM_HOLO_DISABLED || text == NULL || length <= 0 ||
        length > 8192 || holo_count == 0) {
        holo_score = 0.0f;
        return -1;
    }
    holo_encode(text, length, query);
    if (holo_mode == LM_HOLO_PARTITIONED) {
        int partition = holo_partition_for_vector(query);
        int count = holo_partition_count[partition];
        int index;
        for (index = 0; index < count; ++index) {
            float score = 0.0f;
            int coordinate;
            slot = partition * HOLO_PARTITION_CAPACITY + index;
            for (coordinate = 0; coordinate < HOLO_DIMENSION; ++coordinate) {
                score += query[coordinate] * holo_vectors[slot][coordinate];
            }
            if (score > best) {
                best = score;
                best_slot = slot;
            }
        }
        holo_score = best_slot >= 0 ? best : 0.0f;
        return best_slot;
    }
    for (slot = 0; slot < holo_count; ++slot) {
        float score = 0.0f;
        int index;
        for (index = 0; index < HOLO_DIMENSION; ++index) {
            score += query[index] * holo_vectors[slot][index];
        }
        if (score > best) {
            best = score;
            best_slot = slot;
        }
    }
    holo_score = best;
    return best_slot;
}

API float lm_holo_get_score(void) { return holo_score; }
API int lm_holo_get_count(void) { return holo_count; }

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
    lm_holo_reset();
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
        if (repeated && token != CHANNEL_MESSAGE_END_TOKEN) {
            score -= logf(repetition_penalty);
        }
        if (!(token == CHANNEL_MESSAGE_END_TOKEN || token == '\n' ||
              (token >= 32 && token < 127))) {
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

API float lm_probability(int token)
{
    float maximum;
    float total = 0.0f;
    int index;
    if (!loaded || position == 0 || token < 0 || token >= (int)config.vocab) {
        return 0.0f;
    }
    maximum = logits[0];
    for (index = 1; index < (int)config.vocab; ++index) {
        if (logits[index] > maximum) maximum = logits[index];
    }
    for (index = 0; index < (int)config.vocab; ++index) {
        total += expf(logits[index] - maximum);
    }
    return expf(logits[token] - maximum) / total;
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

#if !defined(__EMSCRIPTEN__) && !defined(LITERARY_INFER_NO_MAIN)
static void feed_text(const char *text)
{
    int i;
    for (i = 0; text[i]; ++i) {
        unsigned char token = (unsigned char)text[i];
        lm_feed(token < config.vocab ? token : '?');
    }
}

static const char *style_summary(char style)
{
    if (style == 'S') return "Shakespearean dramatic scene";
    if (style == 'C') return "Crowleyan dramatic scene";
    if (style == 'B') return "Blakean visionary verse";
    if (style == 'K') {
        return "brainfuck channel uses strict bounded 8-bit semantics";
    }
    return "mixed literary conversation";
}

static int holo_self_test(void)
{
    static const unsigned char moon[] =
        "friends hear a silver gate answer beneath the moon";
    static const unsigned char crown[] =
        "the king wears a gold crown in the morning court";
    static const unsigned char query[] = "what answered at the moonlit gate";
    static const unsigned char unrelated[] = "winter rivers cross the forest";
    int result;
    float relevant_score;
    float unrelated_score;
    lm_holo_reset();
    if (lm_holo_remember(moon, (int)sizeof(moon) - 1) != 0 ||
        lm_holo_remember(crown, (int)sizeof(crown) - 1) != 1) {
        return 0;
    }
    result = lm_holo_recall(query, (int)sizeof(query) - 1);
    relevant_score = lm_holo_get_score();
    lm_holo_recall(unrelated, (int)sizeof(unrelated) - 1);
    unrelated_score = lm_holo_get_score();
    lm_holo_recall(query, (int)sizeof(query) - 1);
    return result == 0 && relevant_score > 0.22f &&
           unrelated_score < 0.22f && lm_holo_get_count() == 2;
}

int main(int argc, char **argv)
{
    FILE *file;
    long size;
    unsigned char *data;
    const char *prompt;
    const char *old_memory = NULL;
    const char *response = NULL;
    const char *channel_summary = NULL;
    int chat = 0;
    int channel = 0;
    int memory = 0;
    char style = 'D';
    int count;
    int i;
    if (argc == 2 && strcmp(argv[1], "--holo-self-test") == 0) {
        if (!holo_self_test()) {
            fprintf(stderr, "holographic memory self-test failed\n");
            return EXIT_FAILURE;
        }
        printf("holographic memory self-test passed (cosine %.3f)\n",
               lm_holo_get_score());
        return EXIT_SUCCESS;
    }
    if (argc == 8 && strcmp(argv[2], "--memory") == 0) {
        memory = 1;
        if (strlen(argv[3]) != 1) {
            fprintf(stderr, "error: memory style must be one character\n");
            return EXIT_FAILURE;
        }
        style = argv[3][0];
        old_memory = argv[4];
        prompt = argv[5];
        response = argv[6];
        count = atoi(argv[7]);
    } else if (argc == 7 && strcmp(argv[2], "--channel") == 0) {
        chat = 1;
        channel = 1;
        if (strlen(argv[3]) != 1) {
            fprintf(stderr, "error: channel style must be one character\n");
            return EXIT_FAILURE;
        }
        style = argv[3][0];
        channel_summary = argv[4];
        prompt = argv[5];
        count = atoi(argv[6]);
    } else if (argc == 6 && strcmp(argv[2], "--chat") == 0) {
        chat = 1;
        if (strlen(argv[3]) != 1) {
            fprintf(stderr, "error: chat style must be one character\n");
            return EXIT_FAILURE;
        }
        style = argv[3][0];
        prompt = argv[4];
        count = atoi(argv[5]);
    } else if (argc == 4) {
        prompt = argv[2];
        count = atoi(argv[3]);
    } else {
        fprintf(stderr,
                "usage: %s --holo-self-test\n"
                "       %s MODEL PROMPT TOKENS\n"
                "       %s MODEL --chat STYLE PROMPT TOKENS\n"
                "       %s MODEL --channel STYLE SUMMARY PROMPT TOKENS\n"
                "       %s MODEL --memory STYLE OLD USER REPLY TOKENS\n",
                argv[0], argv[0], argv[0], argv[0], argv[0]);
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
    if (memory) {
        lm_feed(CHANNEL_START_TOKEN);
        lm_feed(style);
        lm_feed(CHANNEL_SUMMARY_TOKEN);
        feed_text(old_memory);
        lm_feed(CHANNEL_MESSAGE_END_TOKEN);
        lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed('A');
        feed_text(prompt);
        lm_feed(CHANNEL_MESSAGE_END_TOKEN);
        lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed('Z');
        lm_feed(CHANNEL_REPLY_TOKEN);
        lm_feed('A');
        feed_text(response);
        lm_feed(CHANNEL_MESSAGE_END_TOKEN);
        lm_feed(CHANNEL_SUMMARY_TOKEN);
        lm_feed(CHANNEL_TARGET_TOKEN);
        printf("old memory: %s\nnew memory: ", old_memory);
    } else if (chat) {
        int speaker = style == 'K' ? 'U' : 'A';
        lm_feed(CHANNEL_START_TOKEN);
        lm_feed(style);
        lm_feed(CHANNEL_SUMMARY_TOKEN);
        feed_text(channel ? channel_summary : style_summary(style));
        lm_feed(CHANNEL_MESSAGE_END_TOKEN);
        lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed(speaker);
        feed_text(prompt);
        lm_feed(CHANNEL_MESSAGE_END_TOKEN);
        lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed('Z');
        lm_feed(CHANNEL_REPLY_TOKEN);
        lm_feed(speaker);
        lm_feed(CHANNEL_TARGET_TOKEN);
        printf("%c: %s\nZ: ", speaker, prompt);
    } else {
        for (i = 0; prompt[i]; ++i) {
            unsigned char token = (unsigned char)prompt[i];
            lm_feed(token < config.vocab ? token : '?');
            putchar(prompt[i]);
        }
    }
    for (i = 0; i < count; ++i) {
        int token = memory ? lm_sample(0.42f, 20, 1.04f)
                    : chat && style == 'K' ? lm_sample(0.0f, 1, 1.0f)
                                          : lm_sample(0.52f, 20, 1.12f);
        lm_feed(token);
        if ((chat || memory) && token == CHANNEL_MESSAGE_END_TOKEN) break;
        putchar(token);
    }
    putchar('\n');
    free(data);
    release_working_memory();
    return EXIT_SUCCESS;
}
#endif
