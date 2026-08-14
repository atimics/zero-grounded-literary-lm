#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LITERARY_INFER_NO_MAIN
#define lm_load q30_base_lm_load
#define lm_reset q30_base_lm_reset
#define lm_feed q30_base_lm_feed
#include "literary_infer.c"
#undef lm_load
#undef lm_reset
#undef lm_feed

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t base_length;
    uint32_t base_padded_length;
    uint32_t vocab, context, dim, heads, layers, ff, rank;
    uint64_t step;
    uint64_t adapter_parameters;
} Q30PackageHeader;

typedef struct {
    const float *w1_a;
    const float *w1_b;
    const float *w2_a;
    const float *w2_b;
} Q30RuntimeLayer;

static Q30RuntimeLayer *q30_layer;
static int q30_rank;
static int q30_active;
static int q30_style_pending;
static float *q30_low;

static void q30_release(void)
{
    free(q30_layer);
    free(q30_low);
    q30_layer = NULL;
    q30_low = NULL;
    q30_rank = q30_active = q30_style_pending = 0;
}

API int lm_load(const unsigned char *data, int length)
{
    static const char magic[8] =
        {'L', 'I', 'T', 'Q', 'L', 'R', '1', '\0'};
    Q30PackageHeader package;
    const unsigned char *cursor = data;
    const unsigned char *end = data + length;
    uint32_t layer;
    q30_release();
    if (length < (int)sizeof(package)) return -20;
    memcpy(&package, cursor, sizeof(package));
    cursor += sizeof(package);
    if (memcmp(package.magic, magic, 8) != 0 || package.version != 1 ||
        package.rank != 4 || package.layers < 1 || package.dim < 2 ||
        package.base_length > package.base_padded_length ||
        package.base_padded_length > (uint32_t)(end - cursor) ||
        package.adapter_parameters !=
            (uint64_t)package.layers * package.rank *
                2U * (package.dim + package.ff)) return -21;
    if (q30_base_lm_load(cursor, (int)package.base_length) != 0) return -22;
    if (config.vocab != package.vocab || config.context != package.context ||
        config.dim != package.dim || config.heads != package.heads ||
        config.layers != package.layers || config.ff != package.ff) return -23;
    cursor += package.base_padded_length;
    q30_layer = calloc(package.layers, sizeof(*q30_layer));
    q30_low = calloc(package.rank, sizeof(*q30_low));
    if (q30_layer == NULL || q30_low == NULL) return -24;
    q30_rank = (int)package.rank;
    for (layer = 0; layer < package.layers; ++layer) {
        size_t w1a = (size_t)package.rank * package.dim;
        size_t w1b = (size_t)package.ff * package.rank;
        size_t w2a = (size_t)package.rank * package.ff;
        size_t w2b = (size_t)package.dim * package.rank;
        size_t amount = (w1a + w1b + w2a + w2b) * sizeof(float);
        if ((size_t)(end - cursor) < amount) return -25;
        q30_layer[layer].w1_a = (const float *)cursor; cursor += w1a * sizeof(float);
        q30_layer[layer].w1_b = (const float *)cursor; cursor += w1b * sizeof(float);
        q30_layer[layer].w2_a = (const float *)cursor; cursor += w2a * sizeof(float);
        q30_layer[layer].w2_b = (const float *)cursor; cursor += w2b * sizeof(float);
    }
    if (cursor != end) return -26;
    q30_active = q30_style_pending = 0;
    return 0;
}

API void lm_reset(void)
{
    q30_base_lm_reset();
    q30_active = q30_style_pending = 0;
}

static void q30_add_low_rank(const float *a, const float *b,
                             const float *input, int input_width,
                             float *output, int output_width)
{
    int low;
    int out;
    int in;
    for (low = 0; low < q30_rank; ++low) {
        float sum = 0.0f;
        for (in = 0; in < input_width; ++in)
            sum += a[low * input_width + in] * input[in];
        q30_low[low] = sum;
    }
    for (out = 0; out < output_width; ++out) {
        float sum = 0.0f;
        for (low = 0; low < q30_rank; ++low)
            sum += b[out * q30_rank + low] * q30_low[low];
        output[out] += sum;
    }
}

API int lm_feed(int token)
{
    int layer;
    if (!loaded || token < 0 || token >= (int)config.vocab) return -1;
    if (token == CHANNEL_START_TOKEN) {
        q30_active = 0;
        q30_style_pending = 1;
    } else if (q30_style_pending) {
        q30_active = token == 'Q';
        q30_style_pending = 0;
    }
    if (!q30_active) return q30_base_lm_feed(token);
    embedding_row(&parameters[0], token, x);
    for (layer = 0; layer < (int)config.layers; ++layer) {
        int base = 1 + layer * 8;
        int i;
        rmsnorm(x, &parameters[base], normalized, (int)config.dim);
        matrix_vector(&parameters[base + 1], normalized, query);
        matrix_vector(&parameters[base + 2], normalized, key);
        matrix_vector(&parameters[base + 3], normalized, value);
        apply_rope(query, position); apply_rope(key, position);
        causal_attention(layer);
        matrix_vector(&parameters[base + 4], attention, temporary);
        for (i = 0; i < (int)config.dim; ++i) x[i] += temporary[i];
        rmsnorm(x, &parameters[base + 5], normalized, (int)config.dim);
        matrix_vector(&parameters[base + 6], normalized, feed_forward_pre);
        q30_add_low_rank(q30_layer[layer].w1_a, q30_layer[layer].w1_b,
                         normalized, (int)config.dim, feed_forward_pre,
                         (int)config.ff);
        for (i = 0; i < (int)config.ff; ++i)
            feed_forward_act[i] = gelu(feed_forward_pre[i]);
        matrix_vector(&parameters[base + 7], feed_forward_act, temporary);
        q30_add_low_rank(q30_layer[layer].w2_a, q30_layer[layer].w2_b,
                         feed_forward_act, (int)config.ff, temporary,
                         (int)config.dim);
        for (i = 0; i < (int)config.dim; ++i) x[i] += temporary[i];
    }
    rmsnorm(x, &parameters[1 + config.layers * 8], normalized,
            (int)config.dim);
    {
        const Tensor *embedding = &parameters[0];
        int output_token;
        for (output_token = 0; output_token < (int)config.vocab; ++output_token) {
            const int8_t *weights = embedding->quantized +
                (size_t)output_token * embedding->columns;
            float sum = 0.0f;
            int i;
            for (i = 0; i < (int)config.dim; ++i)
                sum += weights[i] * normalized[i];
            logits[output_token] = sum * embedding->scales[output_token];
        }
    }
    recent[recent_next] = (uint16_t)token;
    recent_next = (recent_next + 1) % 64;
    if (recent_count < 64) ++recent_count;
    ++position;
    return 0;
}

#if !defined(QUANTITY_ADAPTER_INFER_NO_MAIN)
static unsigned char *q30_read_file(const char *path, int *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) return NULL;
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) { free(data); return NULL; }
    *length = (int)size;
    return data;
}

int main(int argc, char **argv)
{
    unsigned char *data;
    int length;
    int index;
    char style;
    if (argc != 5 || strcmp(argv[2], "--chat") != 0 ||
        strlen(argv[3]) != 1) {
        fprintf(stderr, "usage: %s MODEL --chat STYLE PROMPT\n", argv[0]);
        return EXIT_FAILURE;
    }
    data = q30_read_file(argv[1], &length);
    if (data == NULL || lm_load(data, length) != 0) return EXIT_FAILURE;
    style = argv[3][0];
    lm_feed(CHANNEL_START_TOKEN); lm_feed(style);
    lm_feed(CHANNEL_SUMMARY_TOKEN);
    for (index = 0; argv[4][index] != '\0'; ++index)
        lm_feed((unsigned char)argv[4][index]);
    for (index = 0; index < 8; ++index)
        printf("%.9g\n", lm_probability(index + 32));
    free(data);
    q30_release();
    release_working_memory();
    return EXIT_SUCCESS;
}
#endif
