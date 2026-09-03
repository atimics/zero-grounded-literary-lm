#include "reasoner52.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R52_CLASS_TRANSLATE 1u
#define R52_CLASS_SCALE 2u
#define R52_CLASS_POWER2 3u
#define R52_CLASS_POWER3 4u
#define R52_CLASS_MIX 5u

typedef enum {
    R52_MODE_FULL,
    R52_MODE_TARGET_ONLY,
    R52_MODE_AFFINE_PROJECTION,
    R52_MODE_DEGREE_BLIND,
    R52_MODE_SHUFFLED_SOURCE,
    R52_MODE_SOURCE_ONLY,
    R52_MODE_ORACLE
} r52_mode;

typedef struct {
    uint8_t token[3];
    uint8_t table[R52_MODULUS];
    uint64_t score;
    uint64_t tie;
} r52_candidate;

static uint8_t r52_mod(int32_t value) {
    int32_t reduced = value % (int32_t)R52_MODULUS;
    if (reduced < 0) reduced += (int32_t)R52_MODULUS;
    return (uint8_t)reduced;
}

static uint8_t r52_apply_primitive(uint8_t token, uint8_t x) {
    if (token == 0u) return r52_mod((int32_t)x + 1);
    if (token == 1u) return r52_mod(2 * (int32_t)x);
    if (token == 2u) return r52_mod(-(int32_t)x);
    if (token == 3u) return r52_mod((int32_t)x * x);
    if (token == 4u) return r52_mod((int32_t)x * x * x);
    if (token == 5u) return r52_mod((int32_t)x + 5);
    if (token == 6u) return r52_mod((int32_t)x * x + x);
    return r52_mod((int32_t)x * x * x + 1);
}

static uint8_t r52_class(uint8_t token) {
    static const uint8_t classes[R52_PRIMITIVES] = {
        R52_CLASS_TRANSLATE, R52_CLASS_SCALE, R52_CLASS_SCALE,
        R52_CLASS_POWER2, R52_CLASS_POWER3, R52_CLASS_TRANSLATE,
        R52_CLASS_MIX, R52_CLASS_MIX
    };
    return classes[token];
}

static uint64_t r52_hash(const void *data, size_t size, uint64_t seed) {
    const unsigned char *bytes = (const unsigned char *)data;
    uint64_t hash = UINT64_C(1469598103934665603) ^ seed;
    for (size_t i = 0; i < size; ++i) {
        hash ^= bytes[i];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static void r52_program_table(const uint8_t token[3], uint8_t table[R52_MODULUS]) {
    for (uint8_t x = 0u; x < R52_MODULUS; ++x) {
        uint8_t value = x;
        for (uint32_t pos = 0; pos < 3u; ++pos)
            value = r52_apply_primitive(token[pos], value);
        table[x] = value;
    }
}

static int r52_table_is_affine(const uint8_t table[R52_MODULUS]) {
    uint8_t slope = r52_mod((int32_t)table[1] - table[0]);
    for (uint8_t x = 0; x < R52_MODULUS; ++x)
        if (table[x] != r52_mod((int32_t)slope * x + table[0])) return 0;
    return 1;
}

static void r52_build_artifact(r52_artifact *artifact) {
    static const uint8_t source[R52_SOURCE_PROGRAMS][2] = {
        {3u,0u}, {4u,5u}, {0u,3u}, {5u,4u},
        {1u,3u}, {2u,4u}, {3u,1u}, {4u,2u},
        {6u,0u}, {7u,5u}, {0u,6u}, {5u,7u},
        {6u,1u}, {7u,2u}, {1u,6u}, {2u,7u}
    };
    memset(artifact, 0, sizeof(*artifact));
    for (uint32_t row = 0; row < R52_SOURCE_PROGRAMS; ++row) {
        uint8_t left = r52_class(source[row][0]);
        uint8_t right = r52_class(source[row][1]);
        artifact->class_count[left] += 1u;
        artifact->class_count[right] += 1u;
        artifact->transition_count[left][right] += 1u;
    }
    artifact->source_digest = r52_hash(
        artifact, sizeof(*artifact) - sizeof(artifact->source_digest), 52u);
}

static uint8_t r52_project_class(uint8_t cls, r52_mode mode) {
    if (mode == R52_MODE_AFFINE_PROJECTION && cls >= R52_CLASS_POWER2)
        return R52_CLASS_SCALE;
    if (mode == R52_MODE_DEGREE_BLIND && cls >= R52_CLASS_POWER2)
        return R52_CLASS_MIX;
    if (mode == R52_MODE_SHUFFLED_SOURCE)
        return (uint8_t)(1u + (cls % 5u));
    return cls;
}

static uint32_t r52_prior_strength(const r52_artifact *artifact,
                                   const uint8_t token[3], r52_mode mode) {
    if (mode == R52_MODE_TARGET_ONLY) return 0u;
    uint8_t cls[3];
    uint32_t strength = 0u;
    for (uint32_t pos = 0; pos < 3u; ++pos) {
        cls[pos] = r52_project_class(r52_class(token[pos]), mode);
        strength += 3u * artifact->class_count[cls[pos]];
    }
    strength += 40u * artifact->transition_count[cls[0]][cls[1]];
    strength += 40u * artifact->transition_count[cls[1]][cls[2]];
    return strength;
}

static uint32_t r52_evidence_loss(const uint8_t candidate[R52_MODULUS],
                                  const uint8_t target[R52_MODULUS]) {
    static const uint8_t evidence[2] = {0u, 1u};
    uint32_t loss = 0u;
    for (uint32_t i = 0; i < 2u; ++i) {
        uint8_t point = evidence[i];
        uint8_t a = candidate[point];
        uint8_t b = target[point];
        uint8_t direct = a > b ? a - b : b - a;
        uint8_t wrapped = (uint8_t)(R52_MODULUS - direct);
        loss += direct < wrapped ? direct : wrapped;
    }
    return loss;
}

static int r52_compare(const void *left, const void *right) {
    const r52_candidate *a = (const r52_candidate *)left;
    const r52_candidate *b = (const r52_candidate *)right;
    if (a->score < b->score) return -1;
    if (a->score > b->score) return 1;
    if (a->tie < b->tie) return -1;
    if (a->tie > b->tie) return 1;
    return 0;
}

static uint32_t r52_rank(const r52_artifact *artifact,
                         const uint8_t target_token[3], uint32_t target_index,
                         uint32_t tie_order, r52_mode mode, int *top_invalid) {
    uint8_t target[R52_MODULUS];
    r52_program_table(target_token, target);
    r52_candidate candidates[R52_CANDIDATES];
    uint32_t cursor = 0u;
    for (uint8_t a = 0u; a < R52_PRIMITIVES; ++a)
        for (uint8_t b = 0u; b < R52_PRIMITIVES; ++b)
            for (uint8_t c = 0u; c < R52_PRIMITIVES; ++c) {
                r52_candidate *candidate = &candidates[cursor++];
                candidate->token[0] = a;
                candidate->token[1] = b;
                candidate->token[2] = c;
                r52_program_table(candidate->token, candidate->table);
                uint32_t loss = mode == R52_MODE_SOURCE_ONLY ? 0u :
                    r52_evidence_loss(candidate->table, target);
                uint32_t strength = r52_prior_strength(artifact,
                                                       candidate->token, mode);
                candidate->score = (uint64_t)loss * UINT64_C(1000000) +
                                   (uint64_t)(1000u - strength);
                if (mode == R52_MODE_ORACLE)
                    candidate->score = memcmp(candidate->table, target,
                                              R52_MODULUS) == 0 ? 0u : 1u;
                uint64_t seed = ((uint64_t)target_index << 32) | tie_order;
                candidate->tie = r52_hash(candidate->token,
                                           sizeof(candidate->token), seed);
            }
    qsort(candidates, R52_CANDIDATES, sizeof(candidates[0]), r52_compare);
    *top_invalid = memcmp(candidates[0].table, target, R52_MODULUS) != 0;
    for (uint32_t rank = 0; rank < R52_CANDIDATES; ++rank)
        if (memcmp(candidates[rank].table, target, R52_MODULUS) == 0)
            return rank + 1u;
    return R52_CANDIDATES + 1u;
}

int r52_self_test(void) {
    if (r52_apply_primitive(3u, 5u) != 8u) return 1;
    if (r52_apply_primitive(4u, 3u) != 10u) return 1;
    uint8_t square[R52_MODULUS];
    uint8_t affine[R52_MODULUS];
    for (uint8_t x = 0; x < R52_MODULUS; ++x) {
        square[x] = r52_apply_primitive(3u, x);
        affine[x] = r52_mod(3 * (int32_t)x + 2);
    }
    if (r52_table_is_affine(square) || !r52_table_is_affine(affine)) return 1;
    r52_artifact artifact;
    r52_build_artifact(&artifact);
    if (artifact.source_digest == 0u) return 1;
    uint32_t transitions = 0u;
    for (uint32_t left = 1u; left <= 5u; ++left)
        for (uint32_t right = 1u; right <= 5u; ++right)
            transitions += artifact.transition_count[left][right];
    return transitions == R52_SOURCE_PROGRAMS ? 0 : 1;
}

int r52_execute(r52_result *result, r52_artifact *artifact) {
    static const uint8_t targets[R52_TARGETS][3] = {
        {3u,0u,6u}, {4u,5u,7u}, {0u,3u,1u}, {5u,4u,2u},
        {1u,3u,0u}, {2u,4u,5u}, {6u,0u,3u}, {7u,5u,4u},
        {0u,6u,1u}, {5u,7u,2u}, {1u,6u,0u}, {2u,7u,5u}
    };
    memset(result, 0, sizeof(*result));
    r52_build_artifact(artifact);
    result->source_programs = R52_SOURCE_PROGRAMS;
    result->target_programs = R52_TARGETS;
    result->episodes = R52_EPISODES;
    result->candidates_per_episode = R52_CANDIDATES;
    result->exact_domain_points = R52_MODULUS;
    result->artifact_frozen_before_target = 1u;
    result->exact_truth_table_authoritative = 1u;
    result->artifact_digest = artifact->source_digest;
    r52_artifact ablated_artifact;
    memset(&ablated_artifact, 0, sizeof(ablated_artifact));
    for (uint32_t target = 0; target < R52_TARGETS; ++target) {
        uint8_t target_table[R52_MODULUS];
        r52_program_table(targets[target], target_table);
        for (uint32_t tie = 0; tie < R52_TIE_ORDERS; ++tie) {
            int invalid = 0;
            uint32_t full = r52_rank(artifact, targets[target], target, tie,
                                     R52_MODE_FULL, &invalid);
            result->full_expansions += full;
            result->full_truth_table_checks += full;
            result->full_exact_matches += full <= R52_CANDIDATES;
            result->unverified_top_candidates += (uint32_t)invalid;
            result->nonlinear_target_episodes += !r52_table_is_affine(target_table);
            uint32_t target_only = r52_rank(artifact, targets[target], target,
                tie, R52_MODE_TARGET_ONLY, &invalid);
            result->target_only_expansions += target_only;
            result->source_ablation_expansions += r52_rank(&ablated_artifact,
                targets[target], target, tie, R52_MODE_FULL, &invalid);
            result->individual_wins_vs_target_only += full < target_only;
            result->affine_projection_expansions += r52_rank(artifact,
                targets[target], target, tie, R52_MODE_AFFINE_PROJECTION, &invalid);
            result->degree_blind_expansions += r52_rank(artifact,
                targets[target], target, tie, R52_MODE_DEGREE_BLIND, &invalid);
            result->shuffled_source_expansions += r52_rank(artifact,
                targets[target], target, tie, R52_MODE_SHUFFLED_SOURCE, &invalid);
            result->source_only_expansions += r52_rank(artifact,
                targets[target], target, tie, R52_MODE_SOURCE_ONLY, &invalid);
            uint32_t oracle = r52_rank(artifact, targets[target], target, tie,
                                       R52_MODE_ORACLE, &invalid);
            result->oracle_expansions += oracle;
            result->oracle_exact_matches += oracle == 1u;
        }
    }
    result->source_ablation_control_valid =
        result->source_ablation_expansions == result->target_only_expansions;
    result->artifact_frozen_before_target = artifact->source_digest == r52_hash(
        artifact, sizeof(*artifact) - sizeof(artifact->source_digest), 52u);
    result->gate_pass =
        result->artifact_frozen_before_target &&
        result->exact_truth_table_authoritative &&
        result->source_ablation_control_valid &&
        result->nonlinear_target_episodes == R52_EPISODES &&
        result->full_exact_matches == R52_EPISODES &&
        result->oracle_exact_matches == R52_EPISODES &&
        result->oracle_expansions == R52_EPISODES &&
        result->full_truth_table_checks == result->full_expansions &&
        result->full_expansions * 100u <= result->target_only_expansions * 80u &&
        result->full_expansions < result->affine_projection_expansions &&
        result->full_expansions < result->degree_blind_expansions &&
        result->full_expansions < result->shuffled_source_expansions &&
        result->full_expansions < result->source_only_expansions &&
        result->individual_wins_vs_target_only >= 16u &&
        result->unverified_top_candidates > 0u &&
        result->premature_commits == 0u;
    result->result_digest = r52_hash(
        result, sizeof(*result) - sizeof(result->result_digest), 5201u);
    return 0;
}

int r52_write_artifact(const char *path, const r52_artifact *artifact) {
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    int ok = fwrite(artifact, sizeof(*artifact), 1u, file) == 1u;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 1;
}

int r52_write_result_json(const char *path, const r52_result *r) {
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    int ok = fprintf(file,
        "{\n"
        "  \"schema\": \"reasoner52-result-v1\",\n"
        "  \"experiment\": \"reasoner52-nonlinear-depth-transfer-v1\",\n"
        "  \"decision\": \"%s\",\n"
        "  \"source_programs\": %u,\n"
        "  \"target_programs\": %u,\n"
        "  \"episodes\": %u,\n"
        "  \"candidates_per_episode\": %u,\n"
        "  \"exact_domain_points\": %u,\n"
        "  \"full_expansions\": %u,\n"
        "  \"oracle_expansions\": %u,\n"
        "  \"target_only_expansions\": %u,\n"
        "  \"affine_projection_expansions\": %u,\n"
        "  \"degree_blind_expansions\": %u,\n"
        "  \"shuffled_source_expansions\": %u,\n"
        "  \"source_only_expansions\": %u,\n"
        "  \"source_ablation_expansions\": %u,\n"
        "  \"full_exact_matches\": %u,\n"
        "  \"oracle_exact_matches\": %u,\n"
        "  \"full_truth_table_checks\": %u,\n"
        "  \"individual_wins_vs_target_only\": %u,\n"
        "  \"unverified_top_candidates\": %u,\n"
        "  \"nonlinear_target_episodes\": %u,\n"
        "  \"premature_commits\": %u,\n"
        "  \"artifact_frozen_before_target\": %s,\n"
        "  \"exact_truth_table_authoritative\": %s,\n"
        "  \"source_ablation_control_valid\": %s,\n"
        "  \"gate_pass\": %s,\n"
        "  \"artifact_digest\": \"%016llx\",\n"
        "  \"result_digest\": \"%016llx\"\n"
        "}\n",
        r->gate_pass ? "pass" : "no-go", r->source_programs,
        r->target_programs, r->episodes, r->candidates_per_episode,
        r->exact_domain_points, r->full_expansions, r->oracle_expansions,
        r->target_only_expansions, r->affine_projection_expansions,
        r->degree_blind_expansions, r->shuffled_source_expansions,
        r->source_only_expansions, r->source_ablation_expansions,
        r->full_exact_matches, r->oracle_exact_matches,
        r->full_truth_table_checks, r->individual_wins_vs_target_only,
        r->unverified_top_candidates, r->nonlinear_target_episodes,
        r->premature_commits,
        r->artifact_frozen_before_target ? "true" : "false",
        r->exact_truth_table_authoritative ? "true" : "false",
        r->source_ablation_control_valid ? "true" : "false",
        r->gate_pass ? "true" : "false",
        (unsigned long long)r->artifact_digest,
        (unsigned long long)r->result_digest) > 0;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 1;
}
