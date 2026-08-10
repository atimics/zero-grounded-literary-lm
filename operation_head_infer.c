#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LITERARY_INFER_NO_MAIN
#define lm_load q31_base_lm_load
#define lm_reset q31_base_lm_reset
#define lm_seed q31_base_lm_seed
#define lm_feed q31_base_lm_feed
#define lm_sample q31_base_lm_sample
#define lm_probability q31_base_lm_probability
#include "literary_infer.c"
#undef lm_load
#undef lm_reset
#undef lm_seed
#undef lm_feed
#undef lm_sample
#undef lm_probability

#define Q31_CLASSES 5

typedef struct {
    char magic[8];
    uint32_t version, base_length, base_padded_length;
    uint32_t vocab, context, dim, heads, layers, ff;
    uint32_t classes, feature_dim;
    uint64_t step, head_parameters;
} Q31PackageHeader;

static const char *Q31_LABELS[Q31_CLASSES] = {
    "add", "multiply", "add-rational", "convert", "solve-linear"
};
static const char Q31_PREFIX[] = "@request quantity.";
static const char Q31_SUFFIX[] = " @close";

static const float *q31_head_w;
static const float *q31_head_b;
static float *q31_feature;
static float q31_posterior[Q31_CLASSES];
static uint32_t q31_active_classes;
static int q31_classes;
static int q31_feature_dim;
static int q31_active;
static int q31_style_pending;
static int q31_generating;
static int q31_generation_position;

static void q31_release(void)
{
    free(q31_feature);
    q31_feature = NULL;
    q31_head_w = q31_head_b = NULL;
    q31_classes = q31_feature_dim = 0;
    q31_active = q31_style_pending = q31_generating = 0;
    q31_generation_position = 0;
    q31_active_classes = 0;
}

static int q31_template_token(int class_index, int position)
{
    int prefix = (int)strlen(Q31_PREFIX);
    int label = (int)strlen(Q31_LABELS[class_index]);
    int suffix = (int)strlen(Q31_SUFFIX);
    if (position < prefix) return (unsigned char)Q31_PREFIX[position];
    position -= prefix;
    if (position < label)
        return (unsigned char)Q31_LABELS[class_index][position];
    position -= label;
    if (position < suffix) return (unsigned char)Q31_SUFFIX[position];
    if (position == suffix) return CHANNEL_MESSAGE_END_TOKEN;
    return -1;
}

static void q31_begin_generation(void)
{
    float logits[Q31_CLASSES];
    float maximum;
    float total = 0.0f;
    int class_index;
    int input;
    for (class_index = 0; class_index < q31_classes; ++class_index) {
        double value = q31_head_b[class_index];
        const float *row = q31_head_w +
                           (size_t)class_index * q31_feature_dim;
        for (input = 0; input < q31_feature_dim; ++input)
            value += row[input] * q31_feature[input];
        logits[class_index] = (float)value;
    }
    maximum = logits[0];
    for (class_index = 1; class_index < q31_classes; ++class_index)
        if (logits[class_index] > maximum) maximum = logits[class_index];
    for (class_index = 0; class_index < q31_classes; ++class_index) {
        q31_posterior[class_index] = expf(logits[class_index] - maximum);
        total += q31_posterior[class_index];
    }
    for (class_index = 0; class_index < q31_classes; ++class_index)
        q31_posterior[class_index] /= total;
    q31_active_classes = (UINT32_C(1) << q31_classes) - 1U;
    q31_generation_position = 0;
    q31_generating = 1;
}

static void q31_accept_generated(int token)
{
    uint32_t next = 0;
    int class_index;
    for (class_index = 0; class_index < q31_classes; ++class_index)
        if ((q31_active_classes & (UINT32_C(1) << class_index)) != 0 &&
            q31_template_token(class_index, q31_generation_position) == token)
            next |= UINT32_C(1) << class_index;
    q31_active_classes = next;
    ++q31_generation_position;
    if (next == 0 || token == CHANNEL_MESSAGE_END_TOKEN)
        q31_generating = 0;
}

API int lm_load(const unsigned char *data, int length)
{
    static const char magic[8] =
        {'L', 'I', 'T', 'Q', 'H', 'D', '1', '\0'};
    Q31PackageHeader package;
    const unsigned char *cursor = data;
    const unsigned char *end = data + length;
    size_t weights;
    q31_release();
    if (length < (int)sizeof(package)) return -30;
    memcpy(&package, cursor, sizeof(package)); cursor += sizeof(package);
    if (memcmp(package.magic, magic, 8) != 0 || package.version != 1 ||
        package.classes != Q31_CLASSES || package.layers < 1 ||
        package.dim < 2 || package.feature_dim != package.layers * package.dim ||
        package.head_parameters !=
            (uint64_t)package.classes * (package.feature_dim + 1U) ||
        package.base_length > package.base_padded_length ||
        package.base_padded_length > (uint32_t)(end - cursor)) return -31;
    if (q31_base_lm_load(cursor, (int)package.base_length) != 0) return -32;
    if (config.vocab != package.vocab || config.context != package.context ||
        config.dim != package.dim || config.heads != package.heads ||
        config.layers != package.layers || config.ff != package.ff) return -33;
    cursor += package.base_padded_length;
    weights = (size_t)package.classes * package.feature_dim;
    if ((size_t)(end - cursor) !=
        (weights + package.classes) * sizeof(float)) return -34;
    q31_head_w = (const float *)cursor; cursor += weights * sizeof(float);
    q31_head_b = (const float *)cursor;
    q31_feature = calloc(package.feature_dim, sizeof(float));
    if (q31_feature == NULL) return -35;
    q31_classes = (int)package.classes;
    q31_feature_dim = (int)package.feature_dim;
    q31_active = q31_style_pending = q31_generating = 0;
    return 0;
}

API void lm_reset(void)
{
    q31_base_lm_reset();
    q31_active = q31_style_pending = q31_generating = 0;
    q31_generation_position = 0;
    q31_active_classes = 0;
}

API void lm_seed(uint32_t seed)
{
    q31_base_lm_seed(seed);
}

API int lm_feed(int token)
{
    int layer;
    if (!loaded || token < 0 || token >= (int)config.vocab) return -1;
    if (q31_generating) q31_accept_generated(token);
    if (token == CHANNEL_START_TOKEN) {
        q31_active = 0;
        q31_style_pending = 1;
        q31_generating = 0;
    } else if (q31_style_pending) {
        q31_active = token == 'Q';
        q31_style_pending = 0;
    }
    if (!q31_active) return q31_base_lm_feed(token);
    embedding_row(&parameters[0], token, x);
    for (layer = 0; layer < (int)config.layers; ++layer) {
        int base = 1 + layer * 8;
        double squares = 0.0;
        float scale;
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
        for (i = 0; i < (int)config.ff; ++i)
            feed_forward_act[i] = gelu(feed_forward_pre[i]);
        matrix_vector(&parameters[base + 7], feed_forward_act, temporary);
        for (i = 0; i < (int)config.dim; ++i) {
            x[i] += temporary[i];
            squares += x[i] * x[i];
        }
        scale = 1.0f /
                sqrtf((float)(squares / (int)config.dim) + 1.0e-8f);
        for (i = 0; i < (int)config.dim; ++i)
            q31_feature[(size_t)layer * config.dim + i] = x[i] * scale;
    }
    rmsnorm(x, &parameters[1 + config.layers * 8], normalized,
            (int)config.dim);
    {
        const Tensor *embedding = &parameters[0];
        int output_token;
        for (output_token = 0; output_token < (int)config.vocab;
             ++output_token) {
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
    if (token == CHANNEL_TARGET_TOKEN) q31_begin_generation();
    return 0;
}

API float lm_probability(int token)
{
    double numerator = 0.0;
    double denominator = 0.0;
    int class_index;
    if (!q31_generating) return q31_base_lm_probability(token);
    for (class_index = 0; class_index < q31_classes; ++class_index) {
        if ((q31_active_classes & (UINT32_C(1) << class_index)) == 0)
            continue;
        denominator += q31_posterior[class_index];
        if (q31_template_token(class_index, q31_generation_position) == token)
            numerator += q31_posterior[class_index];
    }
    return denominator > 0.0 ? (float)(numerator / denominator) : 0.0f;
}

API int lm_sample(float temperature, int top_k, float repetition_penalty)
{
    int token;
    int best = 0;
    float best_probability = -1.0f;
    if (!q31_generating)
        return q31_base_lm_sample(temperature, top_k, repetition_penalty);
    (void)temperature; (void)top_k; (void)repetition_penalty;
    for (token = 0; token < (int)config.vocab; ++token) {
        float probability = lm_probability(token);
        if (probability > best_probability) {
            best_probability = probability;
            best = token;
        }
    }
    return best;
}

#if !defined(OPERATION_HEAD_INFER_NO_MAIN)
static unsigned char *q31_read_file(const char *path, int *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) return NULL;
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) { free(data); return NULL; }
    *length = (int)size;
    return data;
}

static void q31_feed_text(const char *text)
{
    int index;
    for (index = 0; text[index] != '\0'; ++index)
        lm_feed((unsigned char)text[index]);
}

int main(int argc, char **argv)
{
    unsigned char *data;
    int length;
    int index;
    char style;
    if (argc != 5 || strcmp(argv[2], "--chat") != 0 ||
        strlen(argv[3]) != 1) return EXIT_FAILURE;
    data = q31_read_file(argv[1], &length);
    if (data == NULL || lm_load(data, length) != 0) return EXIT_FAILURE;
    style = argv[3][0];
    lm_feed(CHANNEL_START_TOKEN); lm_feed(style);
    if (style == 'Q') {
        lm_feed(CHANNEL_SUMMARY_TOKEN);
        q31_feed_text("quantity channel has no prior committed result");
        lm_feed(CHANNEL_MESSAGE_END_TOKEN); lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed('U'); q31_feed_text(argv[4]);
        lm_feed(CHANNEL_MESSAGE_END_TOKEN); lm_feed(CHANNEL_MESSAGE_TOKEN);
        lm_feed('Z'); lm_feed(CHANNEL_REPLY_TOKEN); lm_feed('U');
        lm_feed(CHANNEL_TARGET_TOKEN); q31_feed_text(Q31_PREFIX);
        printf("%.9g\n", lm_probability('a'));
        printf("%.9g\n", lm_probability('m'));
        printf("%.9g\n", lm_probability('c'));
        printf("%.9g\n", lm_probability('s'));
    } else {
        lm_feed(CHANNEL_SUMMARY_TOKEN); q31_feed_text(argv[4]);
        for (index = 0; index < 8; ++index)
            printf("%.9g\n", lm_probability(index + 32));
    }
    free(data);
    q31_release(); release_working_memory();
    return EXIT_SUCCESS;
}
#endif
