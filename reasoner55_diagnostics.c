/* Development experiments reuse the frozen R5.5 domain and search verbatim. */
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE
#include "reasoner55.c"
#include <errno.h>
#include <sys/resource.h>
#include <time.h>

#define R55D_SELECTION_STREAM UINT64_C(0x65717569762d7231)
enum { R55D_RANDOM_SEEDS = 8, R55D_BASE_ARMS = 6,
       R55D_ARMS = R55D_BASE_ARMS + R55D_RANDOM_SEEDS + 1 };
static const uint32_t r55d_base_arms[R55D_BASE_ARMS] = {
    R55_ARM_TARGET_ONLY, R55_ARM_ADAPTER_ONLY, R55_ARM_RAW_LEXICAL,
    R55_ARM_FULL, R55_ARM_FREQUENCY_LEXICAL, R55_ARM_SOURCE_FREE_JIT
};

typedef struct {
    r55_family source[R55_GENERATORS][R55_SOURCE_FAMILIES];
    r55_family development[R55_GENERATORS][R55_DEVELOPMENT_FAMILIES];
    uint8_t derangements[R55_DERANGEMENTS][R55_ROLES];
} r55d_corpus;

static uint64_t r55d_now(void)
{
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) {
        perror("clock_gettime");
        exit(1);
    }
    return (uint64_t)value.tv_sec * UINT64_C(1000000000) +
        (uint64_t)value.tv_nsec;
}

static uint64_t r55d_cpu(void)
{
    struct timespec value;
    if (clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &value) != 0) {
        perror("clock_gettime");
        exit(1);
    }
    return (uint64_t)value.tv_sec * UINT64_C(1000000000) +
        (uint64_t)value.tv_nsec;
}

static int r55d_make_corpus(r55d_corpus *corpus)
{
    r55_affine used[R55_TOTAL_FAMILIES];
    uint32_t ast[R55_TOTAL_FAMILIES], used_count = 0, ast_count = 0;
    if (r55_make_derangements(corpus->derangements) != 0) return 1;
    for (uint32_t generator = 0; generator < R55_GENERATORS; ++generator)
        for (uint32_t ordinal = 0; ordinal < R55_SOURCE_FAMILIES; ++ordinal)
            if (r55_make_unique_family(&corpus->source[generator][ordinal],
                    R55_SOURCE_ROOT, (uint8_t)generator, ordinal, used,
                    &used_count, ast, &ast_count) != 0) return 1;
    for (uint32_t generator = 0; generator < R55_GENERATORS; ++generator)
        for (uint32_t ordinal = 0; ordinal < R55_DEVELOPMENT_FAMILIES; ++ordinal)
            if (r55_make_unique_development_family(
                    &corpus->development[generator][ordinal],
                    (uint8_t)generator, ordinal, used, &used_count,
                    ast, &ast_count, corpus->derangements) != 0) return 1;
    return 0;
}

static uint32_t r55d_exact_solutions(const r55_family *family,
                                    uint16_t solutions[R55_CANDIDATES])
{
    uint32_t count = 0;
    for (uint32_t index = 0; index < R55_CANDIDATES; ++index) {
        uint8_t roles[R55_PROGRAM_LEN];
        r55_program_tokens((uint16_t)index, roles);
        r55_affine candidate = r55_program_from_roles(family, roles);
        if (r55_affine_equal(&candidate, &family->target))
            solutions[count++] = (uint16_t)index;
    }
    return count;
}

/* variant 0: first exact; 1..8: uniform exact; 9: last exact. */
static uint32_t r55d_select(const r55_family *family, uint32_t variant,
                            uint32_t count)
{
    if (variant == 0u) return 0u;
    if (variant == R55D_RANDOM_SEEDS + 1u) return count - 1u;
    r55_rng rng;
    r55_rng_init(&rng, family->family_seed,
        R55D_SELECTION_STREAM + variant - 1u);
    return r55_rng_index(&rng, count);
}

static int r55d_train(const r55d_corpus *corpus, uint32_t variant,
                      r55_artifact *artifact, uint64_t *training_ns)
{
    uint16_t selected[R55_GENERATORS][R55_SOURCE_FAMILIES];
    uint32_t counts[R55_GENERATORS][R55_SOURCE_FAMILIES];
    uint64_t start = r55d_now();
    memset(artifact, 0, sizeof(*artifact));
    for (uint32_t generator = 0; generator < R55_GENERATORS; ++generator) {
        r55_guide *guide = &artifact->guides[generator];
        guide->generator_id = (uint8_t)generator;
        for (uint32_t ordinal = 0; ordinal < R55_SOURCE_FAMILIES; ++ordinal) {
            const r55_family *family = &corpus->source[generator][ordinal];
            uint16_t solutions[R55_CANDIDATES];
            uint32_t count = r55d_exact_solutions(family, solutions);
            uint8_t roles[R55_PROGRAM_LEN];
            if (count == 0u) return 1;
            uint16_t choice = solutions[r55d_select(family, variant, count)];
            selected[generator][ordinal] = choice;
            counts[generator][ordinal] = count;
            r55_program_tokens(choice, roles);
            r55_guide_add(guide, roles);
            ++guide->source_families;
        }
    }
    r55_finish_artifact(artifact);
    *training_ns = r55d_now() - start;
    for (uint32_t generator = 0; generator < R55_GENERATORS; ++generator)
        for (uint32_t ordinal = 0; ordinal < R55_SOURCE_FAMILIES; ++ordinal)
            printf("{\"kind\":\"source\",\"generator\":%u,\"ordinal\":%u,"
                   "\"family_seed\":\"%016" PRIx64 "\",\"exact_count\":%u,"
                   "\"selected_syntax\":%u}\n", generator, ordinal,
                corpus->source[generator][ordinal].family_seed,
                counts[generator][ordinal], selected[generator][ordinal]);
    return 0;
}

static const char *r55d_arm_name(uint32_t arm, char buffer[32])
{
    if (arm < R55D_BASE_ARMS) return r55_arm_name(r55d_base_arms[arm], buffer);
    if (arm == R55D_ARMS - 1u) return "last_exact";
    snprintf(buffer, 32, "uniform_exact_%02u", arm - R55D_BASE_ARMS);
    return buffer;
}

static void r55d_emit_measurement(const r55_family *family,
    uint32_t source, uint32_t tie, uint32_t repeat, const r55_search_result *r,
    uint64_t adapter_ns, uint64_t jit_ns, uint64_t search_ns,
    uint64_t wall_ns, uint64_t cpu_ns)
{
    char order[65], accepted[65];
    r55_hex(r->proposal_order, order);
    r55_hex(r->accepted_semantic, accepted);
    printf("{\"kind\":\"measurement\",\"target_generator\":%u,\"ordinal\":%u,"
        "\"source_generator\":%u,\"tie\":%u,\"repeat\":%u,"
        "\"family_seed\":\"%016" PRIx64 "\","
        "\"primary_cost\":%u,\"verifier_checks\":%u,\"partial_expansions\":%u,"
        "\"observation_queries\":%u,\"source_artifact_reads\":%u,"
        "\"exact\":%s,\"certificate_valid\":%s,\"fallback_started\":%s,"
        "\"global_cap_hit\":%s,\"fallback_exhausted\":%s,"
        "\"injected_invalid_rejected\":%s,\"injected_counterexample_index\":%u,"
        "\"proposal_order_sha256\":\"%s\",\"accepted_semantic_sha256\":\"%s\","
        "\"adapter_ns\":%" PRIu64 ",\"jit_ns\":%" PRIu64 ","
        "\"search_ns\":%" PRIu64 ",\"wall_ns\":%" PRIu64 ",\"cpu_ns\":%" PRIu64 "}\n",
        family->generator_id, family->ordinal, source, tie, repeat,
        family->family_seed, r->primary_cost, r->verifier_checks,
        r->partial_expansions, r->observation_queries, r->source_artifact_reads,
        r->exact ? "true" : "false", r->certificate_valid ? "true" : "false",
        r->fallback_started ? "true" : "false", r->global_cap_hit ? "true" : "false",
        r->fallback_exhausted ? "true" : "false",
        r->invalid_first_rejected ? "true" : "false", r->first_counterexample,
        order, accepted, adapter_ns, jit_ns, search_ns, wall_ns, cpu_ns);
}

static int r55d_run(uint32_t diagnostic_arm, uint32_t repeats)
{
    r55d_corpus corpus;
    r55_artifact artifact;
    uint32_t arm = diagnostic_arm < R55D_BASE_ARMS ?
        r55d_base_arms[diagnostic_arm] : R55_ARM_FULL;
    uint32_t variant = diagnostic_arm < R55D_BASE_ARMS ? 0u :
        diagnostic_arm - R55D_BASE_ARMS + 1u;
    char name[32], digest[65];
    uint64_t start = r55d_now(), training_ns;
    if (r55d_make_corpus(&corpus) != 0) return 1;
    uint64_t corpus_ns = r55d_now() - start;
    if (r55d_train(&corpus, variant, &artifact, &training_ns) != 0) return 1;
    r55_hex(artifact.digest, digest);
    uint8_t bytes[R55_ARTIFACT_MAX_BYTES];
    size_t length = r55_artifact_bytes(&artifact, bytes);
    printf("{\"kind\":\"metadata\",\"schema\":\"zero.reasoner55_diagnostics.v1\","
        "\"lane\":\"development\",\"arm\":\"%s\",\"variant\":%u,\"repeats\":%u,"
        "\"warmup_passes\":1,\"corpus_ns\":%" PRIu64 ",\"training_ns\":%" PRIu64 ","
        "\"artifact_sha256\":\"%s\",\"artifact_hex\":\"",
        r55d_arm_name(diagnostic_arm, name), variant, repeats,
        corpus_ns, training_ns, digest);
    for (size_t index = 0; index < length; ++index) printf("%02x", bytes[index]);
    puts("\"}");
    for (uint32_t repeat = 0; repeat <= repeats; ++repeat)
        for (uint32_t generator = 0; generator < R55_GENERATORS; ++generator)
            for (uint32_t ordinal = 0; ordinal < R55_DEVELOPMENT_FAMILIES; ++ordinal)
                for (uint32_t source = 0; source < R55_GENERATORS; ++source)
                    for (uint32_t tie = 0; tie < R55_TIE_REPEATS; ++tie) {
                        const r55_family *family = &corpus.development[generator][ordinal];
                        r55_public_episode public_episode;
                        r55_affine recovered[R55_PRIMITIVES];
                        uint8_t roles[R55_PRIMITIVES] = {0};
                        r55_guide jit;
                        r55_search_result result;
                        uint32_t checks = 0;
                        uint64_t adapter_ns = 0, jit_ns = 0;
                        uint64_t salt = r55_mix64(family->family_seed ^
                            ((uint64_t)source << 48u) ^ tie ^ R55_TIE_NAMESPACE);
                        uint64_t cpu_start = r55d_cpu(), wall_start = r55d_now();
                        r55_make_public_episode(family, &public_episode);
                        if (arm == R55_ARM_ADAPTER_ONLY || arm == R55_ARM_FULL ||
                            arm == R55_ARM_SOURCE_FREE_JIT) {
                            start = r55d_now();
                            if (r55_reconstruct_adapter(family, recovered, roles, &checks) != 0)
                                return 1;
                            adapter_ns = r55d_now() - start;
                        }
                        if (arm == R55_ARM_SOURCE_FREE_JIT) {
                            start = r55d_now();
                            if (r55_build_jit_guide(&public_episode, roles, &jit) != 0)
                                return 1;
                            jit_ns = r55d_now() - start;
                        }
                        start = r55d_now();
                        if (r55_search(&public_episode, &family->target,
                                family->surface_to_role, roles, &artifact.guides[source],
                                arm == R55_ARM_SOURCE_FREE_JIT ? &jit : NULL, arm,
                                corpus.derangements, salt, R55_PROPOSAL_BUDGET,
                                R55_GLOBAL_CAP, &result) != 0) return 1;
                        uint64_t search_ns = r55d_now() - start;
                        uint64_t wall_ns = r55d_now() - wall_start;
                        uint64_t cpu_ns = r55d_cpu() - cpu_start;
                        if (!result.exact || !result.certificate_valid ||
                            !result.invalid_first_rejected) return 1;
                        if (repeat > 0u)
                            r55d_emit_measurement(family, source, tie, repeat - 1u,
                                &result, adapter_ns, jit_ns, search_ns, wall_ns, cpu_ns);
                    }
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0) return 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024u;
#endif
    printf("{\"kind\":\"process\",\"peak_rss_bytes\":%" PRIu64 "}\n", peak);
    return ferror(stdout) ? 1 : 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--list-arms") == 0) {
        for (uint32_t arm = 0; arm < R55D_ARMS; ++arm) {
            char name[32];
            puts(r55d_arm_name(arm, name));
        }
        return 0;
    }
    if (argc == 4 && strcmp(argv[1], "development") == 0) {
        char *end;
        errno = 0;
        unsigned long repeats = strtoul(argv[3], &end, 10);
        if (errno || !argv[3][0] || *end || repeats < 1 || repeats > 31) return 2;
        for (uint32_t arm = 0; arm < R55D_ARMS; ++arm) {
            char name[32];
            if (strcmp(argv[2], r55d_arm_name(arm, name)) == 0)
                return r55d_run(arm, (uint32_t)repeats);
        }
    }
    fprintf(stderr, "usage: %s --list-arms | development ARM REPEATS(1..31)\n", argv[0]);
    return 2;
}
