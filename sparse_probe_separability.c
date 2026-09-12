/*
 * Q3.6 post-hoc class-separability diagnostic.
 *
 * Tests whether the frozen random projection preserves class structure. If
 * nearest-centroid classification works on raw features but not on expanded
 * features, the fixed-random-feature family is closed at this exposure. If it
 * survives, the constraint is optimization or exposure.
 *
 * Exploratory. Means from 1,000 records, test on the 500-record semantic
 * holdout. No training, no scientific decision.
 */

#define main q32_original_main
#include "runtime_operation_head_pilot.c"
#undef main

#include <math.h>

#define SEP_TOKENS "benchmarks/zero4-q34-semantic-head-v1/mixed-training.tok"
#define SEP_PROJECTION "benchmarks/zero4-q35-sparse-probe-v1/projection.bin"
#define SEP_INPUT 1536
#define SEP_EXPANSION 6144
#define SEP_TOP_K 307
#define SEP_MEAN_RECORDS 1000
#define SEP_TEST_RECORDS 500
#define SEP_TOTAL (SEP_MEAN_RECORDS + SEP_TEST_RECORDS)

typedef struct { float value; int index; } SepItem;

static int sep_item_compare(const void *left, const void *right)
{
    const SepItem *a = left, *b = right;
    if (a->value > b->value) return -1;
    if (a->value < b->value) return 1;
    return a->index - b->index;
}

static void sep_expand_one(const float *x, const signed char *projection,
                           float *out)
{
    int unit;
    for (unit = 0; unit < SEP_EXPANSION; ++unit) {
        const signed char *row = projection + (size_t)unit * SEP_INPUT;
        float sum = 0.0f;
        int input;
        for (input = 0; input < SEP_INPUT; ++input) {
            signed char weight = row[input];
            if (weight != 0) sum += (float)weight * x[input];
        }
        out[unit] = sum > 0.0f ? sum : 0.0f;
    }
}

static void sep_mask_topk(const float *row, SepItem *items, float *out)
{
    int unit;
    for (unit = 0; unit < SEP_EXPANSION; ++unit) {
        items[unit].value = row[unit];
        items[unit].index = unit;
    }
    qsort(items, SEP_EXPANSION, sizeof(*items), sep_item_compare);
    memset(out, 0, SEP_EXPANSION * sizeof(float));
    for (unit = 0; unit < SEP_TOP_K; ++unit)
        out[items[unit].index] = row[items[unit].index];
}

/* Multiply each unit by 1/sqrt(nonzeros in its projection row) when fanin. */
static void sep_scale(const float *source, float *destination,
                      const float *scales)
{
    int unit;
    for (unit = 0; unit < SEP_EXPANSION; ++unit)
        destination[unit] = source[unit] * scales[unit];
}

static void sep_means(float *means, const float *data, int dim)
{
    int record, input;
    memset(means, 0, (size_t)Q32_CLASSES * dim * sizeof(float));
    for (record = 0; record < SEP_MEAN_RECORDS; ++record) {
        const float *row = data + (size_t)record * dim;
        float *mean = means + (size_t)(record % Q32_CLASSES) * dim;
        for (input = 0; input < dim; ++input) mean[input] += row[input];
    }
    for (record = 0; record < Q32_CLASSES * dim; ++record)
        means[record] /= (SEP_MEAN_RECORDS / Q32_CLASSES);
}

static double sep_nearest_centroid(const float *means, const float *tests,
                                   int dim, int count)
{
    int correct = 0, record, class_index;
    for (record = 0; record < count; ++record) {
        const float *test = tests + (size_t)record * dim;
        int best = 0;
        double best_distance = 1.0e300;
        for (class_index = 0; class_index < Q32_CLASSES; ++class_index) {
            const float *mean = means + (size_t)class_index * dim;
            double distance = 0.0;
            int input;
            for (input = 0; input < dim; ++input) {
                double difference = test[input] - mean[input];
                distance += difference * difference;
            }
            if (distance < best_distance) { best_distance = distance; best = class_index; }
        }
        if (best == record % Q32_CLASSES) ++correct;
    }
    return (double)correct / count;
}

int main(void)
{
    unsigned char *package, *token_bytes, *projection_bytes;
    const uint16_t *tokens;
    const signed char *projection;
    size_t package_length, token_bytes_length, projection_length, token_count;
    size_t *starts, record_count;
    float *features, *dense, *sparse, *dense_scaled, *sparse_scaled, *means;
    float *scales;
    SepItem *items;
    int record, unit;
    double raw_accuracy;
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("separability diagnostic could not load runtime");
    projection_bytes = q32_read_file(SEP_PROJECTION, &projection_length);
    if (projection_length != (size_t)SEP_EXPANSION * SEP_INPUT)
        q32_fail("separability projection length drifted");
    projection = (const signed char *)projection_bytes;
    token_bytes = q32_read_file(SEP_TOKENS, &token_bytes_length);
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    SEP_INPUT);
    means = q32_alloc((size_t)Q32_CLASSES * SEP_EXPANSION, sizeof(float));
    sep_means(means, features, SEP_INPUT);
    raw_accuracy = sep_nearest_centroid(means,
        features + (size_t)Q32_TRAIN_RECORDS * SEP_INPUT, SEP_INPUT,
        SEP_TEST_RECORDS);
    dense = q32_alloc((size_t)SEP_TOTAL * SEP_EXPANSION, sizeof(float));
    sparse = q32_alloc((size_t)SEP_TOTAL * SEP_EXPANSION, sizeof(float));
    dense_scaled = q32_alloc((size_t)SEP_TOTAL * SEP_EXPANSION, sizeof(float));
    sparse_scaled = q32_alloc((size_t)SEP_TOTAL * SEP_EXPANSION, sizeof(float));
    scales = q32_alloc(SEP_EXPANSION, sizeof(float));
    items = q32_alloc(SEP_EXPANSION, sizeof(*items));
    for (unit = 0; unit < SEP_EXPANSION; ++unit) {
        const signed char *row = projection + (size_t)unit * SEP_INPUT;
        int input, count = 0;
        for (input = 0; input < SEP_INPUT; ++input)
            if (row[input] != 0) ++count;
        scales[unit] = count > 0 ? 1.0f / sqrtf((float)count) : 0.0f;
    }
    for (record = 0; record < SEP_TOTAL; ++record) {
        size_t source_index = record < SEP_MEAN_RECORDS
            ? (size_t)record
            : (size_t)(Q32_TRAIN_RECORDS + record - SEP_MEAN_RECORDS);
        float *d = dense + (size_t)record * SEP_EXPANSION;
        sep_expand_one(features + source_index * SEP_INPUT, projection, d);
        sep_mask_topk(d, items, sparse + (size_t)record * SEP_EXPANSION);
        sep_scale(d, dense_scaled + (size_t)record * SEP_EXPANSION, scales);
        sep_scale(sparse + (size_t)record * SEP_EXPANSION,
                  sparse_scaled + (size_t)record * SEP_EXPANSION, scales);
    }
    printf("{\n  \"scope\": \"post-hoc class-separability diagnostic\",\n");
    printf("  \"method\": \"nearest class centroid; means from 1000 records, test on 500 holdout\",\n");
    printf("  \"chance\": 0.2,\n");
    printf("  \"raw_1536_accuracy\": %.6f,\n", raw_accuracy);
    sep_means(means, dense, SEP_EXPANSION);
    printf("  \"dense_unscaled_accuracy\": %.6f,\n",
        sep_nearest_centroid(means, dense + (size_t)SEP_MEAN_RECORDS * SEP_EXPANSION,
                             SEP_EXPANSION, SEP_TEST_RECORDS));
    sep_means(means, sparse, SEP_EXPANSION);
    printf("  \"sparse_unscaled_accuracy\": %.6f,\n",
        sep_nearest_centroid(means, sparse + (size_t)SEP_MEAN_RECORDS * SEP_EXPANSION,
                             SEP_EXPANSION, SEP_TEST_RECORDS));
    sep_means(means, dense_scaled, SEP_EXPANSION);
    printf("  \"dense_fanin_accuracy\": %.6f,\n",
        sep_nearest_centroid(means, dense_scaled + (size_t)SEP_MEAN_RECORDS * SEP_EXPANSION,
                             SEP_EXPANSION, SEP_TEST_RECORDS));
    sep_means(means, sparse_scaled, SEP_EXPANSION);
    printf("  \"sparse_fanin_accuracy\": %.6f\n",
        sep_nearest_centroid(means, sparse_scaled + (size_t)SEP_MEAN_RECORDS * SEP_EXPANSION,
                             SEP_EXPANSION, SEP_TEST_RECORDS));
    printf("}\n");
    q31_release(); release_working_memory();
    return 0;
}
