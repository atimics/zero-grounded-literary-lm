#include "build/reasoner55_semantic_guide_embed.h"

enum { R55FT_FAMILIES = 128, R55FT_EPISODES = R55FT_FAMILIES * 4,
       R55FT_ARMS = 6, R55FT_PASSES = 12 };
static const char *r55ft_arms[R55FT_ARMS] = {"target_only", "source_free_jit",
    "semantic_frequency", "task_guide", "raw_lexical_task_guide",
    "task_without_prior_feature"};
static const char *r55ft_model_digest =
    "db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a";
typedef struct {
    r55d_corpus original;
    r55_family families[R55FT_FAMILIES];
    uint32_t nonces[R55FT_FAMILIES], minimum[R55FT_FAMILIES];
    uint32_t rejected[R55FT_FAMILIES][4];
} r55ft_corpus;

static int r55ft_dense(r55_affine *map, uint64_t seed, uint32_t role)
{
    r55_rng rng;
    r55_rng_init(&rng, seed, UINT64_C(0x64656e73652d7631) + role);
    memset(map, 0, sizeof(*map));
    for (uint32_t attempt = 0; attempt < 1024; ++attempt) {
        for (uint32_t i = 0; i < 9; ++i)
            map->matrix[i] = (uint8_t)(1 + r55_rng_index(&rng, 4));
        const uint8_t *m = map->matrix;
        int determinant = m[0]*(m[4]*m[8]-m[5]*m[7]) -
            m[1]*(m[3]*m[8]-m[5]*m[6]) + m[2]*(m[3]*m[7]-m[4]*m[6]);
        if (r55_mod(determinant) == 0) continue;
        if (role == 7)
            for (uint32_t i = 0; i < 3; ++i)
                map->bias[i] = (uint8_t)(1 + r55_rng_index(&rng, 4));
        return r55_role_of(map) != role;
    }
    return 1;
}

static uint32_t r55ft_minimum(const r55_family *family)
{
    r55_affine identity = r55_identity();
    if (r55_affine_equal(&identity, &family->target)) return 0;
    uint32_t width = 8;
    for (uint32_t length = 1; length < 4; ++length, width *= 8)
        for (uint32_t ast = 0; ast < width; ++ast) {
            r55_affine map = identity;
            for (int position = (int)length - 1; position >= 0; --position)
                map = r55_compose(&family->primitive_by_role[(ast >> (position * 3)) & 7], &map);
            if (r55_affine_equal(&map, &family->target)) return length;
        }
    return 4;
}

static int r55ft_make_corpus(r55ft_corpus *corpus)
{
    memset(corpus, 0, sizeof(*corpus));
    if (r55d_make_corpus(&corpus->original)) return 1;
    const r55_family *used[R55_TOTAL_FAMILIES + R55FT_FAMILIES];
    uint8_t seen_ast[R55_CANDIDATES] = {0};
    uint32_t count = 0;
    for (uint32_t gen = 0; gen < 2; ++gen) {
        for (uint32_t task = 0; task < 64; ++task) {
            const r55_family *f = &corpus->original.source[gen][task];
            uint16_t exact[R55_CANDIDATES];
            uint32_t n = r55d_exact_solutions(f, exact);
            if (!n) return 1;
            for (uint32_t i = 0; i < n; ++i) seen_ast[exact[i]] = 1;
            seen_ast[r55_ast_key(f->target_roles)] = 1;
            used[count++] = f;
        }
        for (uint32_t task = 0; task < 4; ++task) {
            const r55_family *f = &corpus->original.development[gen][task];
            seen_ast[r55_ast_key(f->target_roles)] = 1;
            used[count++] = f;
        }
    }
    for (uint32_t ordinal = 0; ordinal < R55FT_FAMILIES; ++ordinal) {
        r55_family *f = &corpus->families[ordinal];
        int accepted = 0;
        for (uint32_t nonce = 0; nonce < 65536 && !accepted; ++nonce) {
            if (r55_generate_family(f, UINT64_C(0x5533667265736831), 0, ordinal, nonce)) return 1;
            if (ordinal >= 64 && (r55ft_dense(&f->primitive_by_role[6], f->family_seed, 6) ||
                r55ft_dense(&f->primitive_by_role[7], f->family_seed, 7))) return 1;
            r55_rng rng;
            uint8_t binding[8] = {0,1,2,3,4,5,6,7};
            r55_rng_init(&rng, f->family_seed, UINT64_C(0x636f6d702d763031));
            for (uint32_t i = 7; i > 0; --i) {
                uint32_t j = r55_rng_index(&rng, i + 1);
                uint8_t temporary = binding[i]; binding[i] = binding[j]; binding[j] = temporary;
            }
            int mixing = 0;
            for (uint32_t i = 0; i < 4; ++i) {
                f->target_roles[i] = binding[(ordinal / 32) % 2 ? i % 2 : i];
                f->target_surface[i] = f->role_to_surface[f->target_roles[i]];
                mixing |= f->target_roles[i] >= 6;
            }
            f->target = r55_program_from_roles(f, f->target_roles);
            r55_apply(&f->target, f->example_input, f->example_output);
            if (!mixing) { ++corpus->rejected[ordinal][0]; continue; }
            if (seen_ast[r55_ast_key(f->target_roles)]) { ++corpus->rejected[ordinal][1]; continue; }
            int behavior_used = 0, operations_used = 0;
            for (uint32_t i = 0; i < count; ++i) {
                behavior_used |= r55_affine_equal(&used[i]->target, &f->target);
                operations_used |= memcmp(used[i]->primitive_by_role, f->primitive_by_role,
                    sizeof(f->primitive_by_role)) == 0;
            }
            if (behavior_used) { ++corpus->rejected[ordinal][2]; continue; }
            if (operations_used) { ++corpus->rejected[ordinal][3]; continue; }
            corpus->nonces[ordinal] = nonce;
            corpus->minimum[ordinal] = r55ft_minimum(f);
            used[count++] = f;
            accepted = 1;
        }
        if (!accepted) return 1;
    }
    return 0;
}

static void r55ft_array(const uint8_t *bytes, size_t length)
{
    putchar('[');
    for (size_t i = 0; i < length; ++i) printf("%s%u", i ? "," : "", bytes[i]);
    putchar(']');
}

static void r55ft_emit_family(const r55ft_corpus *corpus, uint32_t ordinal)
{
    const r55_family *f = &corpus->families[ordinal];
    printf("{\"ordinal\":%u,\"cell\":%u,\"nonce\":%u,\"family_seed\":\"%016" PRIx64
        "\",\"minimum_length\":%u,\"rejections\":[%u,%u,%u,%u],\"primitive_by_role\":[",
        ordinal, ordinal / 32, corpus->nonces[ordinal], f->family_seed, corpus->minimum[ordinal],
        corpus->rejected[ordinal][0], corpus->rejected[ordinal][1],
        corpus->rejected[ordinal][2], corpus->rejected[ordinal][3]);
    for (uint32_t r = 0; r < 8; ++r) {
        printf("%s{\"matrix\":", r ? "," : ""); r55ft_array(f->primitive_by_role[r].matrix, 9);
        printf(",\"bias\":"); r55ft_array(f->primitive_by_role[r].bias, 3); putchar('}');
    }
    printf("],\"surface_to_role\":"); r55ft_array(f->surface_to_role, 8);
    printf(",\"surface_ids\":[");
    for (uint32_t r = 0; r < 8; ++r) printf("%s%u", r ? "," : "", f->surface_id[r]);
    printf("],\"target_roles\":"); r55ft_array(f->target_roles, 4);
    printf(",\"target\":{\"matrix\":"); r55ft_array(f->target.matrix, 9);
    printf(",\"bias\":"); r55ft_array(f->target.bias, 3); putchar('}');
    printf(",\"example_input\":"); r55ft_array(f->example_input, 3);
    printf(",\"example_output\":"); r55ft_array(f->example_output, 3);
    puts("}");
}

static uint32_t r55ft_u32(const uint8_t *b)
{
    return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

static int r55ft_load_model(r55_artifact *artifact, r55sg_model *model)
{
    FILE *file = fopen("benchmarks/reasoner55-semantic-guide-v1/MODEL.hex", "rb");
    uint8_t bytes[1863];
    if (!file) return 1;
    for (uint32_t i = 0; i < sizeof(bytes); ++i) {
        unsigned value = 0;
        for (uint32_t j = 0; j < 2; ++j) {
            int c = fgetc(file);
            if (c >= '0' && c <= '9') value = value * 16 + (unsigned)(c - '0');
            else if (c >= 'a' && c <= 'f') value = value * 16 + (unsigned)(c - 'a' + 10);
            else { fclose(file); return 1; }
        }
        bytes[i] = (uint8_t)value;
    }
    int c = fgetc(file);
    if (c == '\n') c = fgetc(file);
    int invalid = c != EOF || ferror(file); fclose(file);
    if (invalid) return 1;
    r55_sha256 sha;
    char digest[65];
    r55_sha256_init(&sha); r55_sha256_update(&sha, bytes, sizeof(bytes));
    r55_sha256_final(&sha, model->artifact_sha256); r55_hex(model->artifact_sha256, digest);
    if (strcmp(digest, r55ft_model_digest)) return 1;
    memset(artifact, 0, sizeof(*artifact));
    r55_sha256_init(&sha); r55_sha256_update(&sha, bytes + 8, 1823);
    r55_sha256_final(&sha, artifact->digest); artifact->canonical_bytes = 1823;
    size_t offset = 21;
    for (uint32_t gen = 0; gen < 2; ++gen) {
        r55_guide *g = &artifact->guides[gen];
        g->generator_id = bytes[offset++];
        g->source_families = r55ft_u32(bytes + offset); offset += 4;
        g->source_solutions = r55ft_u32(bytes + offset); offset += 4;
        for (uint32_t p = 0; p < 4; ++p)
            for (uint32_t r = 0; r < 8; ++r) { g->position_count[p][r] = r55ft_u32(bytes + offset); offset += 4; }
        for (uint32_t p = 0; p < 3; ++p)
            for (uint32_t r = 0; r < 8; ++r)
                for (uint32_t n = 0; n < 8; ++n) { g->transition_count[p][r][n] = r55ft_u32(bytes + offset); offset += 4; }
    }
    for (uint32_t gen = 0; gen < 2; ++gen)
        for (uint32_t f = 0; f < 4; ++f) {
            uint32_t value = r55ft_u32(bytes + offset); offset += 4;
            model->weights[gen][f] = (int32_t)(value > INT32_MAX ? (int64_t)value - INT64_C(4294967296) : value);
        }
    return offset != sizeof(bytes);
}

static int r55ft_episode(const r55ft_corpus *corpus, uint32_t index, uint32_t arm,
    const r55_artifact *artifact, const r55sg_model *model, r55_search_result *result,
    r55sg_timing *timing, uint32_t *groups, uint8_t features[32], uint64_t *jit_ns)
{
    const r55_family *family = &corpus->families[index / 4];
    uint32_t source = (index / 2) % 2, tie = index % 2;
    *groups = 0; *jit_ns = 0; memset(features, 0, 32); memset(timing, 0, sizeof(*timing));
    if (arm >= 2) {
        static const uint32_t mapped[4] = {1,3,5,7};
        return r55sg_episode(family, source, tie, mapped[arm - 2], &corpus->original,
            artifact, model, result, timing, groups, features);
    }
    r55_public_episode episode;
    r55_affine recovered[8];
    uint8_t roles[8] = {0};
    r55_guide jit;
    uint32_t checks = 0;
    uint64_t cpu = r55d_cpu(), wall = r55d_now();
    r55_make_public_episode(family, &episode);
    if (arm == 1) {
        uint64_t phase = r55d_now();
        if (r55_reconstruct_adapter(family, recovered, roles, &checks)) return 1;
        timing->adapter = r55d_now() - phase;
        phase = r55d_now();
        if (r55_build_jit_guide(&episode, roles, &jit)) return 1;
        *jit_ns = r55d_now() - phase;
    }
    uint64_t phase = r55d_now();
    uint64_t salt = r55_mix64(family->family_seed ^ ((uint64_t)source << 48u) ^ tie ^ R55_TIE_NAMESPACE);
    int failed = r55_search(&episode, &family->target, family->surface_to_role, roles,
        &artifact->guides[source], arm == 1 ? &jit : NULL,
        arm == 1 ? R55_ARM_SOURCE_FREE_JIT : R55_ARM_TARGET_ONLY, corpus->original.derangements,
        salt, R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, result);
    timing->search = r55d_now() - phase;
    timing->wall = r55d_now() - wall; timing->cpu = r55d_cpu() - cpu;
    result->observation_queries = arm == 1 ? 32 : 0;
    result->source_artifact_reads = 0;
    return failed || !result->exact || !result->certificate_valid || !result->invalid_first_rejected;
}

static int r55ft_run(const r55ft_corpus *corpus, uint32_t arm, uint32_t pass,
    uint64_t corpus_ns, uint64_t corpus_cpu_ns)
{
    r55_artifact artifact = {0};
    r55sg_model model = {0};
    uint64_t load_ns = 0, load_cpu_ns = 0;
    if (arm >= 3) {
        uint64_t cpu = r55d_cpu(), start = r55d_now();
        if (r55ft_load_model(&artifact, &model)) return 1;
        load_ns = r55d_now() - start; load_cpu_ns = r55d_cpu() - cpu;
    }
    printf("{\"kind\":\"metadata\",\"arm\":\"%s\",\"pass\":%u,\"corpus_ns\":%" PRIu64
        ",\"corpus_cpu_ns\":%" PRIu64 ",\"model_load_ns\":%" PRIu64
        ",\"model_load_cpu_ns\":%" PRIu64 ",\"model_bytes\":%u}\n",
        r55ft_arms[arm], pass, corpus_ns, corpus_cpu_ns, load_ns, load_cpu_ns, arm >= 3 ? 1863 : 0);
    uint32_t order[R55FT_EPISODES];
    for (uint32_t i = 0; i < R55FT_EPISODES; ++i) order[i] = i;
    r55_rng rng; r55_rng_init(&rng, UINT64_C(0x74696d652d763031), pass);
    for (uint32_t i = R55FT_EPISODES - 1; i > 0; --i) {
        uint32_t j = r55_rng_index(&rng, i + 1), temp = order[i]; order[i] = order[j]; order[j] = temp;
    }
    for (uint32_t warmup = 0; warmup < 2; ++warmup)
        for (uint32_t i = 0; i < R55FT_EPISODES; ++i) {
            uint32_t index = order[i], groups;
            r55_search_result result;
            r55sg_timing timing;
            uint8_t features[32]; uint64_t jit_ns;
            if (r55ft_episode(corpus, index, arm, &artifact, &model, &result,
                &timing, &groups, features, &jit_ns)) return 1;
            if (!warmup) continue;
            char feature_hash[65], rank[65], accepted[65];
            r55_hex(features, feature_hash); r55_hex(result.proposal_order, rank);
            r55_hex(result.accepted_semantic, accepted);
            printf("{\"kind\":\"row\",\"episode\":%u,\"groups\":%u,\"primary_cost\":%u"
                ",\"verifier_checks\":%u,\"partial_expansions\":%u"
                ",\"observation_queries\":%u,\"source_artifact_reads\":%u,\"exact\":true,"
                "\"certificate_valid\":true,\"injected_invalid_rejected\":true,\"fallback_started\":%s,"
                "\"global_cap_hit\":%s,\"fallback_exhausted\":%s,\"injected_counterexample_index\":%u,"
                "\"features_sha256\":\"%s\",\"proposal_order_sha256\":\"%s\",\"accepted_semantic_sha256\":\"%s\","
                "\"adapter_ns\":%" PRIu64 ",\"jit_ns\":%" PRIu64 ",\"enumerate_ns\":%" PRIu64
                ",\"group_ns\":%" PRIu64 ",\"score_ns\":%" PRIu64 ",\"sort_ns\":%" PRIu64
                ",\"receipt_ns\":%" PRIu64 ",\"search_ns\":%" PRIu64 ",\"wall_ns\":%" PRIu64
                ",\"cpu_ns\":%" PRIu64 "}\n", index, groups, result.primary_cost, result.verifier_checks,
                result.partial_expansions, result.observation_queries, result.source_artifact_reads,
                result.fallback_started ? "true" : "false", result.global_cap_hit ? "true" : "false",
                result.fallback_exhausted ? "true" : "false", result.first_counterexample,
                feature_hash, rank, accepted, timing.adapter, jit_ns, timing.enumerate, timing.group,
                timing.score, timing.sort, timing.receipt, timing.search, timing.wall, timing.cpu);
        }
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage)) return 1;
    uint64_t peak = (uint64_t)usage.ru_maxrss;
#ifndef __APPLE__
    peak *= 1024;
#endif
    printf("{\"kind\":\"process\",\"peak_rss_bytes\":%" PRIu64 "}\n", peak);
    return ferror(stdout) != 0;
}

static int r55ft_parity(const r55ft_corpus *corpus)
{
    r55sg_universe *u = calloc(1, sizeof(*u));
    if (!u) return 1;
    int failed = 0;
    for (uint32_t task = 0; task < R55FT_FAMILIES && !failed; ++task) {
        r55_public_episode episode;
        uint8_t roles[8];
        failed = r55sg_public(&corpus->families[task], &episode, roles) ||
            r55sg_enumerate(&episode, roles, u);
        for (uint32_t ast = 0; ast < 4096 && !failed; ++ast) {
            r55_candidate direct;
            r55_fill_candidate(&episode, roles, NULL, 0, 0, 0, (uint16_t)ast, &direct);
            uint8_t value[3], matches = 0;
            memcpy(value, episode.example_input, 3);
            for (uint32_t p = 0; p < 3; ++p) {
                uint8_t next[3]; r55_apply(&episode.primitive_by_surface[direct.token[p]], value, next);
                for (uint32_t lane = 0; lane < 3; ++lane) matches += next[lane] == episode.example_output[lane];
                memcpy(value, next, 3);
            }
            const r55_candidate *cached = &u->programs[ast].candidate;
            failed = !r55_affine_equal(&direct.semantic, &cached->semantic) ||
                direct.evidence_loss != cached->evidence_loss ||
                memcmp(direct.role, cached->role, 4) || matches != u->programs[ast].prefix_matches;
        }
    }
    free(u); return failed;
}

int main(int argc, char **argv)
{
    int mode = 0; uint32_t arm = 0, pass = 0;
    if (argc == 2 && !strcmp(argv[1], "--cohort")) mode = 1;
    else if (argc == 2 && !strcmp(argv[1], "--self-test")) mode = 2;
    else if (argc == 2 && !strcmp(argv[1], "--training-cost")) mode = 3;
    else if (argc == 4 && !strcmp(argv[1], "benchmark")) {
        for (; arm < R55FT_ARMS && strcmp(argv[2], r55ft_arms[arm]); ++arm) {}
        char *end; errno = 0; unsigned long value = strtoul(argv[3], &end, 10);
        if (arm < R55FT_ARMS && !errno && argv[3][0] && !*end && value < R55FT_PASSES) {
            mode = 4; pass = (uint32_t)value;
        }
    }
    if (!mode) { fprintf(stderr, "usage: %s --cohort | --self-test | --training-cost | benchmark ARM PASS(0..11)\n", argv[0]); return 2; }
    r55ft_corpus *corpus = calloc(1, sizeof(*corpus));
    if (!corpus) return 1;
    uint64_t cpu = r55d_cpu(), start = r55d_now();
    int failed = r55ft_make_corpus(corpus);
    uint64_t corpus_ns = r55d_now() - start, corpus_cpu_ns = r55d_cpu() - cpu;
    if (!failed && mode == 1)
        for (uint32_t i = 0; i < R55FT_FAMILIES; ++i) r55ft_emit_family(corpus, i);
    if (!failed && mode == 2) {
        failed = r55ft_parity(corpus) || r55sg_self_test();
        if (!failed) puts("Reasoner 5.5 fixed transfer: 524288 new program maps and prefix features passed");
    }
    if (!failed && mode == 3) {
        r55_artifact artifact; r55sg_model model = {0};
        cpu = r55d_cpu(); start = r55d_now();
        failed = r55sg_train(&corpus->original, &artifact, &model);
        uint64_t wall_ns = r55d_now() - start, cpu_ns = r55d_cpu() - cpu;
        char digest[65]; r55_hex(model.artifact_sha256, digest);
        failed |= strcmp(digest, r55ft_model_digest) != 0;
        if (!failed) printf("{\"model_sha256\":\"%s\",\"training_wall_ns\":%" PRIu64
            ",\"training_cpu_ns\":%" PRIu64 ",\"corpus_ns\":%" PRIu64
            ",\"corpus_cpu_ns\":%" PRIu64 "}\n", digest, wall_ns, cpu_ns, corpus_ns, corpus_cpu_ns);
    }
    if (!failed && mode == 4) failed = r55ft_run(corpus, arm, pass, corpus_ns, corpus_cpu_ns);
    free(corpus); return failed || ferror(stdout) ? 1 : 0;
}
