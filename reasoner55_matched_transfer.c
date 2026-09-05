/* Matched controls reuse the frozen domain, model, and both search backends. */
#include "build/reasoner55_fast_fixed.h"

static int r55m_hash_check(void)
{
    static const char input[] = "Reasoner matched controls";
    r55_ref_sha256 reference; r55_sha256 actual;
    uint8_t expected[32], observed[32]; char hex[65];
    r55_ref_sha256_init(&reference); r55_ref_sha256_update(&reference, input, sizeof(input) - 1);
    r55_ref_sha256_final(&reference, expected);
    r55_sha256_init(&actual); r55_sha256_update(&actual, input, sizeof(input) - 1);
    r55_sha256_final(&actual, observed); r55_hex(observed, hex);
    printf("{\"sha256\":\"%s\",\"hash\":\"%s\",\"typed_sort\":%s}\n",
        hex, R55FAST_HASH_BACKEND, R55FAST_SORT ? "true" : "false");
    return memcmp(expected, observed, 32) != 0 || ferror(stdout);
}

static int r55m_make_corpus(r55ft_corpus *corpus, uint64_t root, uint32_t per_cell)
{
    r55ft_corpus *previous = calloc(1, sizeof(*previous));
    if (!previous) return 1;
    if (r55ft_make_corpus(previous)) { free(previous); return 1; }
    memset(corpus, 0, sizeof(*corpus));
    corpus->original = previous->original;
    const r55_family *used[R55_TOTAL_FAMILIES + 2 * R55FT_FAMILIES];
    uint8_t seen_ast[R55_CANDIDATES] = {0};
    uint32_t used_count = 0;
    for (uint32_t gen = 0; gen < 2; ++gen) {
        for (uint32_t task = 0; task < 64; ++task) {
            const r55_family *family = &corpus->original.source[gen][task];
            uint16_t exact[R55_CANDIDATES];
            uint32_t count = r55d_exact_solutions(family, exact);
            if (!count) { free(previous); return 1; }
            for (uint32_t i = 0; i < count; ++i) seen_ast[exact[i]] = 1;
            seen_ast[r55_ast_key(family->target_roles)] = 1;
            used[used_count++] = family;
        }
        for (uint32_t task = 0; task < 4; ++task) {
            const r55_family *family = &corpus->original.development[gen][task];
            seen_ast[r55_ast_key(family->target_roles)] = 1;
            used[used_count++] = family;
        }
    }
    for (uint32_t i = 0; i < R55FT_FAMILIES; ++i) used[used_count++] = &previous->families[i];
    int failed = 0;
    for (uint32_t cell = 0; cell < 4 && !failed; ++cell)
        for (uint32_t within = 0; within < per_cell && !failed; ++within) {
            uint32_t ordinal = cell * 32 + within;
            r55_family *family = &corpus->families[ordinal];
            int accepted = 0;
            for (uint32_t nonce = 0; nonce < 65536 && !accepted; ++nonce) {
                if (r55_generate_family(family, root, 0, ordinal, nonce)) { failed = 1; break; }
                if (cell >= 2 && (r55ft_dense(&family->primitive_by_role[6], family->family_seed, 6) ||
                    r55ft_dense(&family->primitive_by_role[7], family->family_seed, 7))) { failed = 1; break; }
                r55_rng rng;
                uint8_t binding[8] = {0,1,2,3,4,5,6,7};
                r55_rng_init(&rng, family->family_seed, UINT64_C(0x636f6d702d763031));
                for (uint32_t i = 7; i > 0; --i) {
                    uint32_t j = r55_rng_index(&rng, i + 1), temporary = binding[i];
                    binding[i] = binding[j]; binding[j] = (uint8_t)temporary;
                }
                int mixing = 0;
                for (uint32_t i = 0; i < 4; ++i) {
                    family->target_roles[i] = binding[cell % 2 ? i % 2 : i];
                    family->target_surface[i] = family->role_to_surface[family->target_roles[i]];
                    mixing |= family->target_roles[i] >= 6;
                }
                family->target = r55_program_from_roles(family, family->target_roles);
                r55_apply(&family->target, family->example_input, family->example_output);
                if (!mixing) { ++corpus->rejected[ordinal][0]; continue; }
                if (seen_ast[r55_ast_key(family->target_roles)]) { ++corpus->rejected[ordinal][1]; continue; }
                int behavior_used = 0, operations_used = 0;
                for (uint32_t i = 0; i < used_count; ++i) {
                    behavior_used |= r55_affine_equal(&used[i]->target, &family->target);
                    operations_used |= memcmp(used[i]->primitive_by_role, family->primitive_by_role,
                        sizeof(family->primitive_by_role)) == 0;
                }
                if (behavior_used) { ++corpus->rejected[ordinal][2]; continue; }
                if (operations_used) { ++corpus->rejected[ordinal][3]; continue; }
                corpus->nonces[ordinal] = nonce;
                corpus->minimum[ordinal] = r55ft_minimum(family);
                used[used_count++] = family;
                accepted = 1;
            }
            if (!accepted) {
                fprintf(stderr, "{\"kind\":\"generation_failure\",\"ordinal\":%u,\"rejections\":[%u,%u,%u,%u]}\n",
                    ordinal, corpus->rejected[ordinal][0], corpus->rejected[ordinal][1],
                    corpus->rejected[ordinal][2], corpus->rejected[ordinal][3]);
                failed = 1;
            }
        }
    free(previous);
    return failed;
}

static void r55m_row(uint32_t index, uint32_t phase, uint32_t groups, int failed,
    const r55_search_result *result, const r55sg_timing *timing,
    const uint8_t features[32], uint64_t jit_ns)
{
    char feature_hash[65], rank[65], accepted[65];
    r55_hex(features, feature_hash); r55_hex(result->proposal_order, rank);
    r55_hex(result->accepted_semantic, accepted);
    printf("{\"kind\":\"row\",\"phase\":\"%s\",\"episode\":%u,\"groups\":%u,\"primary_cost\":%u"
        ",\"verifier_checks\":%u,\"partial_expansions\":%u,\"observation_queries\":%u,\"source_artifact_reads\":%u,"
        "\"failed\":%s,\"exact\":%s,\"certificate_valid\":%s,\"injected_invalid_rejected\":%s,"
        "\"fallback_started\":%s,\"global_cap_hit\":%s,\"fallback_exhausted\":%s,\"injected_counterexample_index\":%u,"
        "\"features_sha256\":\"%s\",\"proposal_order_sha256\":\"%s\",\"accepted_semantic_sha256\":\"%s\","
        "\"adapter_ns\":%" PRIu64 ",\"jit_ns\":%" PRIu64 ",\"enumerate_ns\":%" PRIu64
        ",\"group_ns\":%" PRIu64 ",\"score_ns\":%" PRIu64 ",\"sort_ns\":%" PRIu64
        ",\"receipt_ns\":%" PRIu64 ",\"search_ns\":%" PRIu64 ",\"wall_ns\":%" PRIu64 ",\"cpu_ns\":%" PRIu64 "}\n",
        phase ? "measured" : "warmup", index, groups, result->primary_cost,
        result->verifier_checks, result->partial_expansions, result->observation_queries, result->source_artifact_reads,
        failed ? "true" : "false", result->exact ? "true" : "false", result->certificate_valid ? "true" : "false",
        result->invalid_first_rejected ? "true" : "false", result->fallback_started ? "true" : "false",
        result->global_cap_hit ? "true" : "false", result->fallback_exhausted ? "true" : "false", result->first_counterexample,
        feature_hash, rank, accepted, timing->adapter, jit_ns, timing->enumerate, timing->group,
        timing->score, timing->sort, timing->receipt, timing->search, timing->wall, timing->cpu);
    fflush(stdout);
}

static int r55m_run(const r55ft_corpus *corpus, uint64_t root, uint32_t per_cell,
    uint32_t arm, uint32_t pass, uint64_t corpus_ns, uint64_t corpus_cpu_ns,
    uint64_t process_start, uint64_t process_cpu)
{
    r55_artifact artifact = {0};
    r55sg_model model = {0};
    uint64_t load_ns = 0, load_cpu_ns = 0;
    if (arm >= 3) {
        uint64_t cpu = r55d_cpu(), start = r55d_now();
        if (r55ft_load_model(&artifact, &model)) {
            puts("{\"kind\":\"model_failure\"}"); return 1;
        }
        load_ns = r55d_now() - start; load_cpu_ns = r55d_cpu() - cpu;
    }
    printf("{\"kind\":\"metadata\",\"arm\":\"%s\",\"pass\":%u,\"seed\":\"%016" PRIx64 "\",\"families_per_cell\":%u,"
        "\"hash\":\"%s\",\"typed_sort\":%s,\"corpus_ns\":%" PRIu64
        ",\"corpus_cpu_ns\":%" PRIu64 ",\"model_load_ns\":%" PRIu64
        ",\"model_load_cpu_ns\":%" PRIu64 ",\"model_bytes\":%u}\n",
        r55ft_arms[arm], pass, root, per_cell, R55FAST_HASH_BACKEND, R55FAST_SORT ? "true" : "false",
        corpus_ns, corpus_cpu_ns, load_ns, load_cpu_ns, arm >= 3 ? 1863 : 0);
    fflush(stdout);
    uint32_t order[R55FT_EPISODES], count = 0;
    for (uint32_t cell = 0; cell < 4; ++cell)
        for (uint32_t family = 0; family < per_cell; ++family)
            for (uint32_t view = 0; view < 4; ++view) order[count++] = (cell * 32 + family) * 4 + view;
    r55_rng rng; r55_rng_init(&rng, UINT64_C(0x74696d652d763031), pass);
    for (uint32_t i = count - 1; i > 0; --i) {
        uint32_t j = r55_rng_index(&rng, i + 1), temporary = order[i]; order[i] = order[j]; order[j] = temporary;
    }
    int failed = 0;
    uint32_t completed = 0;
    for (uint32_t phase = 0; phase < 2 && !failed; ++phase)
        for (uint32_t i = 0; i < count && !failed; ++i) {
            uint32_t groups = 0;
            r55_search_result result = {0};
            r55sg_timing timing = {0};
            uint8_t features[32] = {0}; uint64_t jit_ns = 0;
            failed = r55ft_episode(corpus, order[i], arm, &artifact, &model, &result,
                &timing, &groups, features, &jit_ns);
            ++completed;
            r55m_row(order[i], phase, groups, failed, &result, &timing, features, jit_ns);
        }
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage)) return 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024;
#endif
    printf("{\"kind\":\"process\",\"failed\":%s,\"completed_episodes\":%u,\"peak_rss_bytes\":%" PRIu64
        ",\"process_wall_ns\":%" PRIu64 ",\"process_cpu_ns\":%" PRIu64 "}\n",
        failed ? "true" : "false", completed, peak, r55d_now() - process_start, r55d_cpu() - process_cpu);
    return failed || ferror(stdout);
}

static int r55m_number(const char *text, int base, uint64_t maximum, uint64_t *value)
{
    if (!text[0]) return 1;
    for (const char *p = text; *p; ++p)
        if (!(*p >= '0' && *p <= '9') && !(base == 16 &&
            ((*p >= 'a' && *p <= 'f') || (*p >= 'A' && *p <= 'F')))) return 1;
    char *end; errno = 0;
    unsigned long long parsed = strtoull(text, &end, base);
    if (errno || *end || parsed > maximum) return 1;
    *value = (uint64_t)parsed;
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && !strcmp(argv[1], "--hash-self-test")) return r55m_hash_check();
    uint64_t seed = 0, per_cell = 0, pass = 0;
    uint32_t arm = 0;
    int cohort = argc == 4 && !strcmp(argv[1], "cohort");
    int benchmark = argc == 6 && !strcmp(argv[1], "benchmark");
    if ((!cohort && !benchmark) || strlen(argv[2]) != 16 ||
        r55m_number(argv[2], 16, UINT64_MAX, &seed) ||
        r55m_number(argv[3], 10, 32, &per_cell) || !per_cell) goto usage;
    if (benchmark) {
        for (; arm < R55FT_ARMS && strcmp(argv[4], r55ft_arms[arm]); ++arm) {}
        if (arm == R55FT_ARMS || r55m_number(argv[5], 10, 11, &pass)) goto usage;
    }
    r55ft_corpus *corpus = calloc(1, sizeof(*corpus));
    if (!corpus) return 1;
    uint64_t cpu = r55d_cpu(), start = r55d_now();
    int failed = r55m_make_corpus(corpus, seed, (uint32_t)per_cell);
    uint64_t corpus_ns = r55d_now() - start, corpus_cpu_ns = r55d_cpu() - cpu;
    if (!failed && cohort)
        for (uint32_t cell = 0; cell < 4; ++cell)
            for (uint32_t within = 0; within < per_cell; ++within) r55ft_emit_family(corpus, cell * 32 + within);
    if (!failed && benchmark) failed = r55m_run(corpus, seed, (uint32_t)per_cell, arm, (uint32_t)pass,
        corpus_ns, corpus_cpu_ns, start, cpu);
    free(corpus);
    return failed || ferror(stdout) ? 1 : 0;
usage:
    fprintf(stderr, "usage: %s cohort SEED_HEX_16 FAMILIES_PER_CELL(1..32) | benchmark SEED_HEX_16 FAMILIES_PER_CELL ARM PASS(0..11)\n", argv[0]);
    return 2;
}
