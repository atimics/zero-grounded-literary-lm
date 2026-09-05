#include "build/reasoner55_fast_fixed.h"

static int r55fast_hash_tests(int emit)
{
    static const size_t lengths[] = {0,1,3,55,56,63,64,65,127,128,129,
        4095,4096,4097,65537,131072,1048576};
    static const size_t strides[] = {1,4,31,64,4095,4096,65536};
    uint8_t *bytes = malloc(1048576);
    if (!bytes) return 1;
    for (size_t i = 0; i < 1048576; ++i) bytes[i] = (uint8_t)((i * 31 + i / 251) & 255);
    int failed = 0;
    for (size_t n = 0; n < sizeof(lengths) / sizeof(lengths[0]); ++n) {
        size_t length = lengths[n];
        r55_ref_sha256 reference;
        uint8_t expected[32];
        r55_ref_sha256_init(&reference);
        r55_ref_sha256_update(&reference, bytes, length);
        r55_ref_sha256_final(&reference, expected);
        for (size_t s = 0; s < sizeof(strides) / sizeof(strides[0]); ++s) {
            r55_sha256 actual;
            uint8_t digest[32];
            r55_sha256_init(&actual);
            r55_sha256_update(&actual, NULL, 0);
            for (size_t offset = 0; offset < length;) {
                size_t take = length - offset < strides[s] ? length - offset : strides[s];
                r55_sha256_update(&actual, bytes + offset, take);
                offset += take;
            }
            r55_sha256_update(&actual, NULL, 0);
            r55_sha256_final(&actual, digest);
            failed |= memcmp(digest, expected, 32) != 0;
            if (emit) {
                char hex[65]; r55_hex(digest, hex);
                printf("{\"length\":%zu,\"stride\":%zu,\"sha256\":\"%s\"}\n", length, strides[s], hex);
            }
        }
    }
    free(bytes);
    return failed || ferror(stdout);
}

static int r55fast_sort_tests(void)
{
    static const uint32_t counts[] = {0,1,2,15,16,17,31,32,33,255,256,257,4095,4096};
    r55_candidate *candidates = calloc(R55_CANDIDATES, sizeof(*candidates));
    r55_candidate *candidate_reference = calloc(R55_CANDIDATES, sizeof(*candidates));
    r55sg_group *groups = calloc(R55_CANDIDATES, sizeof(*groups));
    r55sg_group *group_reference = calloc(R55_CANDIDATES, sizeof(*groups));
    if (!candidates || !candidate_reference || !groups || !group_reference) {
        free(candidates); free(candidate_reference); free(groups); free(group_reference);
        return 1;
    }
    int failed = 0;
    for (uint32_t pattern = 0; pattern < 16 && !failed; ++pattern)
        for (uint32_t n = 0; n < sizeof(counts) / sizeof(counts[0]) && !failed; ++n) {
            uint32_t count = counts[n];
            r55_rng random;
            r55_rng_init(&random, UINT64_C(0x66617374736f7274), pattern);
            memset(candidates, 0, R55_CANDIDATES * sizeof(*candidates));
            memset(groups, 0, R55_CANDIDATES * sizeof(*groups));
            for (uint32_t i = 0; i < count; ++i) {
                r55_candidate *c = &candidates[i];
                r55sg_group *g = &groups[i];
                c->syntax_index = (uint16_t)i;
                g->key = i;
                c->token[0] = (uint8_t)i;
                g->representative = (uint16_t)i;
                c->evidence_loss = g->evidence_loss = (uint8_t)r55_rng_index(&random, 2);
                c->prior = r55_mix64(i + pattern);
                g->score = i % 3 == 0 ? INT64_MIN : i % 3 == 1 ? INT64_MAX : (int64_t)i;
                c->tie = g->tie = r55_mix64(pattern + i);
                if (pattern == 0 || pattern == 1) {
                    c->evidence_loss = g->evidence_loss = 0;
                    c->prior = c->tie = g->tie = 0;
                    g->score = 0;
                } else if (pattern == 2) {
                    c->evidence_loss = g->evidence_loss = 1;
                    c->prior = UINT64_MAX;
                    g->score = INT64_MIN;
                    c->tie = g->tie = UINT64_MAX;
                }
            }
            if (pattern == 1)
                for (uint32_t i = 0; i < count / 2; ++i) {
                    r55_candidate c = candidates[i]; candidates[i] = candidates[count-1-i]; candidates[count-1-i] = c;
                    r55sg_group g = groups[i]; groups[i] = groups[count-1-i]; groups[count-1-i] = g;
                }
            memcpy(candidate_reference, candidates, count * sizeof(*candidates));
            memcpy(group_reference, groups, count * sizeof(*groups));
            qsort(candidate_reference, count, sizeof(*candidates), r55_candidate_compare);
            qsort(group_reference, count, sizeof(*groups), r55sg_group_compare);
            r55fast_sort_candidates(candidates, count);
            r55fast_sort_groups(groups, count);
            failed |= memcmp(candidates, candidate_reference, count * sizeof(*candidates)) != 0;
            failed |= memcmp(groups, group_reference, count * sizeof(*groups)) != 0;
        }
    free(candidates); free(candidate_reference); free(groups); free(group_reference);
    return failed;
}

int main(int argc, char **argv)
{
    if (argc == 2 && !strcmp(argv[1], "--backend")) {
        printf("{\"hash\":\"%s\",\"sort\":\"%s\",\"buffer_bytes\":%u}",
            R55FAST_HASH_BACKEND, R55FAST_SORT ? "typed index merge sort" : "original qsort",
            R55FAST_HASH ? 4096 : 0);
        putchar('\n');
        return ferror(stdout) != 0;
    }
    if (argc == 2 && !strcmp(argv[1], "--hash-vectors")) return r55fast_hash_tests(1);
    if (argc == 2 && !strcmp(argv[1], "--fast-self-test")) {
        if (r55fast_hash_tests(0) || r55fast_sort_tests()) return 1;
        puts("Reasoner 5.5 fast primitives passed: 119 SHA vectors and 448 sort cases");
        return 0;
    }
    return r55fast_fixed_main(argc, argv);
}
