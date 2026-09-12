/*
 * Q3.5 post-hoc mechanism diagnostic.
 *
 * Explains why the frozen ReLU(P x) expansion produced a chance-level head.
 * It computes feature statistics on a subset of holdout records only. It does
 * not train, does not alter the frozen probe, and makes no scientific decision.
 *
 * Exploratory analysis. Not part of the preregistered intervention.
 */

#define main q32_original_main
#include "runtime_operation_head_pilot.c"
#undef main

#include <math.h>

#define Q35D_TOKENS "benchmarks/zero4-q34-semantic-head-v1/mixed-training.tok"
#define Q35D_PROJECTION "benchmarks/zero4-q35-sparse-probe-v1/projection.bin"
#define Q35D_INPUT 1536
#define Q35D_EXPANSION 6144
#define Q35D_SAMPLE 500

int main(void)
{
    unsigned char *package, *token_bytes, *projection_bytes;
    const uint16_t *tokens;
    const signed char *projection;
    size_t package_length, token_bytes_length, projection_length, token_count;
    size_t *starts, record_count;
    float *features;
    float *expansion;
    double raw_sum = 0.0, raw_square = 0.0, raw_abs = 0.0;
    double pre_sum = 0.0, pre_square = 0.0;
    double post_sum = 0.0, post_square = 0.0, post_nonzero = 0.0;
    double ratio_sum = 0.0;
    size_t elements = 0;
    int record, unit, input;
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("diagnostic could not load runtime source");
    if (q31_feature_dim != Q35D_INPUT)
        q32_fail("diagnostic runtime architecture drifted");
    projection_bytes = q32_read_file(Q35D_PROJECTION, &projection_length);
    if (projection_length != (size_t)Q35D_EXPANSION * Q35D_INPUT)
        q32_fail("diagnostic projection length drifted");
    projection = (const signed char *)projection_bytes;
    token_bytes = q32_read_file(Q35D_TOKENS, &token_bytes_length);
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    Q35D_INPUT);
    expansion = q32_alloc(Q35D_SAMPLE * Q35D_EXPANSION, sizeof(float));
    /* Raw feature statistics over the sample. */
    for (record = 0; record < Q35D_SAMPLE; ++record) {
        const float *x = features +
            (size_t)(Q32_TRAIN_RECORDS + record) * Q35D_INPUT;
        for (input = 0; input < Q35D_INPUT; ++input) {
            double value = x[input];
            raw_sum += value; raw_square += value * value;
            raw_abs += fabs(value); ++elements;
        }
    }
    /* Expansion over the sample. */
    for (record = 0; record < Q35D_SAMPLE; ++record) {
        const float *x = features +
            (size_t)(Q32_TRAIN_RECORDS + record) * Q35D_INPUT;
        float *destination = expansion + (size_t)record * Q35D_EXPANSION;
        for (unit = 0; unit < Q35D_EXPANSION; ++unit) {
            const signed char *row = projection + (size_t)unit * Q35D_INPUT;
            double sum = 0.0;
            for (input = 0; input < Q35D_INPUT; ++input)
                if (row[input] != 0) sum += (double)row[input] * x[input];
            destination[unit] = (float)sum;
            pre_sum += sum; pre_square += sum * sum;
        }
    }
    /* Across-record variability of each unit relative to its own mean. */
    for (unit = 0; unit < Q35D_EXPANSION; ++unit) {
        double mean = 0.0, variance = 0.0;
        for (record = 0; record < Q35D_SAMPLE; ++record)
            mean += expansion[(size_t)record * Q35D_EXPANSION + unit];
        mean /= Q35D_SAMPLE;
        for (record = 0; record < Q35D_SAMPLE; ++record) {
            double value = expansion[(size_t)record * Q35D_EXPANSION + unit];
            variance += (value - mean) * (value - mean);
        }
        variance /= Q35D_SAMPLE;
        ratio_sum += sqrt(variance) / (fabs(mean) + 1.0e-9);
        for (record = 0; record < Q35D_SAMPLE; ++record) {
            double value = expansion[(size_t)record * Q35D_EXPANSION + unit];
            double relu = value > 0.0 ? value : 0.0;
            post_sum += relu; post_square += relu * relu;
            if (relu > 0.0) post_nonzero += 1.0;
        }
    }
    printf("{\n");
    printf("  \"scope\": \"post-hoc exploratory mechanism diagnostic\",\n");
    printf("  \"sample_records\": %d,\n", Q35D_SAMPLE);
    printf("  \"raw\": {\"mean\": %.9g, \"std\": %.9g, \"abs_mean\": %.9g},\n",
        raw_sum / elements, sqrt(raw_square / elements -
        (raw_sum / elements) * (raw_sum / elements)), raw_abs / elements);
    printf("  \"expansion_pre_relu\": {\"mean\": %.9g, \"std\": %.9g},\n",
        pre_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION),
        sqrt(pre_square / (double)(Q35D_SAMPLE * Q35D_EXPANSION) -
        (pre_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION)) *
        (pre_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION))));
    printf("  \"expansion_post_relu\": {\"mean\": %.9g, \"std\": %.9g, "
        "\"nonzero_fraction\": %.9g},\n",
        post_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION),
        sqrt(post_square / (double)(Q35D_SAMPLE * Q35D_EXPANSION) -
        (post_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION)) *
        (post_sum / (double)(Q35D_SAMPLE * Q35D_EXPANSION))),
        post_nonzero / (double)(Q35D_SAMPLE * Q35D_EXPANSION));
    printf("  \"mean_unit_across_record_coefficient_of_variation\": %.9g\n",
        ratio_sum / Q35D_EXPANSION);
    printf("}\n");
    free(expansion);
    munmap(features, (size_t)Q32_FEATURE_RECORDS * Q35D_INPUT * sizeof(float));
    free(starts); free(token_bytes); free(projection_bytes); free(package);
    q31_release(); release_working_memory();
    return 0;
}
