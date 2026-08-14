#define main q32_original_main
#include "runtime_operation_head_pilot.c"
#undef main

#define Q34_TOKENS "benchmarks/zero4-q34-semantic-head-v1/mixed-training.tok"

int main(int argc, char **argv)
{
    Q32Options options = {0};
    unsigned char *package, *token_bytes;
    const uint16_t *tokens;
    size_t package_length, token_bytes_length, token_count;
    size_t *starts, record_count;
    float *features;
    uint64_t base_digest;
    int index;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return q32_self_test(NULL) ? 0 : 1;
    for (index = 1; index < argc; ++index) {
        if (index + 1 >= argc) q32_fail("incomplete Q3.4 option");
        if (strcmp(argv[index], "--out-prefix") == 0)
            options.out_prefix = argv[++index];
        else if (strcmp(argv[index], "--events") == 0)
            options.events_path = argv[++index];
        else if (strcmp(argv[index], "--authorization-sha256") == 0)
            options.authorization_sha256 = argv[++index];
        else q32_fail("unknown Q3.4 option");
    }
    q32_validate_options(&options);
    package = q32_read_file(Q32_RUNTIME_SOURCE, &package_length);
    if (package_length > INT32_MAX || lm_load(package, (int)package_length) != 0)
        q32_fail("Q3.4 could not load fixed quantized runtime source");
    if (q31_feature_dim != 1536 || config.layers != 6 || config.dim != 256)
        q32_fail("Q3.4 fixed runtime architecture drifted");
    base_digest = q32_digest(package, package_length);
    token_bytes = q32_read_file(Q34_TOKENS, &token_bytes_length);
    if ((token_bytes_length & 1U) != 0) q32_fail("Q3.4 token file is truncated");
    tokens = (const uint16_t *)token_bytes;
    token_count = token_bytes_length / sizeof(uint16_t);
    starts = q32_record_starts(tokens, token_count, &record_count);
    features = q32_extract_features(tokens, token_count, starts, record_count,
                                    q31_feature_dim);
    q32_run(&options, features, q31_feature_dim, base_digest);
    if (munmap(features, (size_t)Q32_FEATURE_RECORDS * q31_feature_dim *
                             sizeof(float)) != 0)
        q32_fail_path("unmap Q3.4 feature cache", "mmap");
    free(starts); free(token_bytes); free(package);
    q31_release(); release_working_memory();
    return 0;
}
