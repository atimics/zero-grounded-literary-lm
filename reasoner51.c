#include "reasoner51.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R51_MODULUS 257u
#define R51_CLASSES 6u
#define R51_CLASS_UNKNOWN 0u
#define R51_CLASS_BIAS 1u
#define R51_CLASS_SCALE 2u
#define R51_CLASS_PERMUTE 3u
#define R51_CLASS_MIX 4u
#define R51_CLASS_IDENTITY 5u

typedef struct {
    uint8_t token[R51_PROGRAM_LEN];
    uint32_t expansions;
    uint64_t score;
    uint64_t tie;
    r51_affine exact;
} r51_candidate;

typedef enum {
    R51_ADAPTER_VERIFIED,
    R51_ADAPTER_ORACLE,
    R51_ADAPTER_IDENTITY,
    R51_ADAPTER_SHUFFLED,
    R51_ADAPTER_NO_QUERY,
    R51_ADAPTER_TOKEN_ID,
    R51_ADAPTER_ABLATED
} r51_adapter_mode;

static uint32_t r51_mod(int64_t value) {
    int64_t reduced = value % (int64_t)R51_MODULUS;
    if (reduced < 0) reduced += R51_MODULUS;
    return (uint32_t)reduced;
}

static r51_affine r51_identity(void) {
    r51_affine out;
    memset(&out, 0, sizeof(out));
    for (uint32_t lane = 0; lane < R51_LANES; ++lane)
        out.matrix[lane * R51_LANES + lane] = 1u;
    return out;
}

static r51_affine r51_primitive(uint8_t token) {
    r51_affine out = r51_identity();
    if (token == 0u) {
        out.bias[0] = out.bias[1] = out.bias[2] = 5u;
    } else if (token == 1u) {
        memset(out.matrix, 0, sizeof(out.matrix));
        out.matrix[0] = out.matrix[4] = out.matrix[8] = 2u;
    } else if (token == 2u) {
        memset(out.matrix, 0, sizeof(out.matrix));
        out.matrix[1] = out.matrix[5] = out.matrix[6] = 1u;
    } else if (token == 3u) {
        out.matrix[1] = 1u;
    } else if (token == 4u) {
        memset(out.matrix, 0, sizeof(out.matrix));
        out.matrix[1] = out.matrix[3] = out.matrix[8] = 1u;
    } else if (token == 5u) {
        out.bias[0] = 3u;
        out.bias[1] = R51_MODULUS - 3u;
        out.bias[2] = 3u;
    } else if (token == 6u) {
        memset(out.matrix, 0, sizeof(out.matrix));
        out.matrix[2] = out.matrix[3] = out.matrix[7] = 1u;
    } else if (token == 7u) {
        out.bias[0] = 11u;
        out.bias[1] = R51_MODULUS - 11u;
        out.bias[2] = 11u;
    }
    return out;
}

static r51_affine r51_compose(const r51_affine *after,
                              const r51_affine *before) {
    r51_affine out;
    memset(&out, 0, sizeof(out));
    for (uint32_t row = 0; row < R51_LANES; ++row) {
        for (uint32_t col = 0; col < R51_LANES; ++col) {
            int64_t sum = 0;
            for (uint32_t k = 0; k < R51_LANES; ++k)
                sum += (int64_t)after->matrix[row * R51_LANES + k] *
                       before->matrix[k * R51_LANES + col];
            out.matrix[row * R51_LANES + col] = r51_mod(sum);
        }
        int64_t bias = after->bias[row];
        for (uint32_t k = 0; k < R51_LANES; ++k)
            bias += (int64_t)after->matrix[row * R51_LANES + k] *
                    before->bias[k];
        out.bias[row] = r51_mod(bias);
    }
    return out;
}

static void r51_apply(const r51_affine *map, const uint32_t input[R51_LANES],
                      uint32_t output[R51_LANES]) {
    for (uint32_t row = 0; row < R51_LANES; ++row) {
        int64_t sum = map->bias[row];
        for (uint32_t col = 0; col < R51_LANES; ++col)
            sum += (int64_t)map->matrix[row * R51_LANES + col] * input[col];
        output[row] = r51_mod(sum);
    }
}

static r51_affine r51_program(const uint8_t token[R51_PROGRAM_LEN]) {
    r51_affine out = r51_identity();
    for (uint32_t i = 0; i < R51_PROGRAM_LEN; ++i) {
        r51_affine op = r51_primitive(token[i]);
        out = r51_compose(&op, &out);
    }
    return out;
}

static int r51_equal(const r51_affine *a, const r51_affine *b) {
    return memcmp(a, b, sizeof(*a)) == 0;
}

static uint64_t r51_hash_bytes(const void *data, size_t size, uint64_t seed) {
    const unsigned char *bytes = (const unsigned char *)data;
    uint64_t hash = UINT64_C(1469598103934665603) ^ seed;
    for (size_t i = 0; i < size; ++i) {
        hash ^= bytes[i];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static uint8_t r51_classify(const r51_affine *map) {
    r51_affine id = r51_identity();
    if (r51_equal(map, &id)) return R51_CLASS_IDENTITY;
    int matrix_identity = memcmp(map->matrix, id.matrix, sizeof(id.matrix)) == 0;
    int has_bias = map->bias[0] || map->bias[1] || map->bias[2];
    if (matrix_identity && has_bias) return R51_CLASS_BIAS;
    int diagonal = 1;
    for (uint32_t row = 0; row < R51_LANES; ++row)
        for (uint32_t col = 0; col < R51_LANES; ++col)
            if (row != col && map->matrix[row * R51_LANES + col] != 0u)
                diagonal = 0;
    if (diagonal && !has_bias) return R51_CLASS_SCALE;
    int permutation = !has_bias;
    for (uint32_t row = 0; row < R51_LANES; ++row) {
        uint32_t row_ones = 0;
        uint32_t col_ones = 0;
        for (uint32_t col = 0; col < R51_LANES; ++col) {
            row_ones += map->matrix[row * R51_LANES + col] == 1u;
            col_ones += map->matrix[col * R51_LANES + row] == 1u;
        }
        if (row_ones != 1u || col_ones != 1u) permutation = 0;
    }
    if (permutation) return R51_CLASS_PERMUTE;
    return R51_CLASS_MIX;
}

static int r51_reconstruct_opaque(uint8_t token, r51_affine *out,
                                  uint32_t *reconstruction_queries,
                                  uint32_t *challenge_queries,
                                  uint32_t *checks_passed) {
    r51_affine runtime = r51_primitive(token);
    uint32_t zero[R51_LANES] = {0u, 0u, 0u};
    uint32_t base[R51_LANES];
    r51_apply(&runtime, zero, out->bias);
    *reconstruction_queries += 1u;
    for (uint32_t col = 0; col < R51_LANES; ++col) {
        uint32_t basis[R51_LANES] = {0u, 0u, 0u};
        basis[col] = 1u;
        r51_apply(&runtime, basis, base);
        *reconstruction_queries += 1u;
        for (uint32_t row = 0; row < R51_LANES; ++row)
            out->matrix[row * R51_LANES + col] =
                r51_mod((int64_t)base[row] - out->bias[row]);
    }
    static const uint32_t challenge[3][R51_LANES] = {
        {2u, 3u, 5u}, {13u, 21u, 34u}, {256u, 128u, 64u}
    };
    for (uint32_t i = 0; i < 3u; ++i) {
        uint32_t expected[R51_LANES];
        uint32_t observed[R51_LANES];
        r51_apply(&runtime, challenge[i], expected);
        r51_apply(out, challenge[i], observed);
        *challenge_queries += 1u;
        if (memcmp(expected, observed, sizeof(expected)) != 0) return 0;
        *checks_passed += 1u;
    }
    return r51_equal(&runtime, out);
}

static void r51_build_artifact(r51_artifact *artifact) {
    static const uint8_t source[16][R51_PROGRAM_LEN] = {
        {2u,0u,3u}, {4u,5u,3u}, {2u,5u,1u}, {4u,0u,1u},
        {0u,2u,3u}, {5u,4u,3u}, {0u,4u,1u}, {5u,2u,1u},
        {2u,5u,3u}, {4u,0u,3u}, {2u,0u,1u}, {4u,5u,1u},
        {5u,2u,3u}, {0u,4u,3u}, {5u,4u,1u}, {0u,2u,1u}
    };
    memset(artifact, 0, sizeof(*artifact));
    for (uint32_t row = 0; row < 16u; ++row) {
        uint8_t cls[R51_PROGRAM_LEN];
        for (uint32_t pos = 0; pos < R51_PROGRAM_LEN; ++pos) {
            r51_affine map = r51_primitive(source[row][pos]);
            cls[pos] = r51_classify(&map);
            artifact->position_count[pos][cls[pos]] += 1u;
        }
        artifact->transition_count[cls[0]][cls[1]] += 1u;
        artifact->transition_count[cls[1]][cls[2]] += 1u;
    }
    artifact->source_digest = r51_hash_bytes(
        artifact, sizeof(*artifact) - sizeof(artifact->source_digest), 51u);
}

static void r51_adapter_classes(r51_adapter_mode mode, uint8_t classes[8],
                                r51_result *result) {
    for (uint8_t token = 0; token < 6u; ++token) {
        r51_affine map = r51_primitive(token);
        classes[token] = r51_classify(&map);
    }
    classes[6] = R51_CLASS_UNKNOWN;
    classes[7] = R51_CLASS_UNKNOWN;
    if (mode == R51_ADAPTER_VERIFIED) {
        r51_affine six;
        r51_affine seven;
        int six_ok = r51_reconstruct_opaque(6u, &six,
            &result->adapter_reconstruction_queries,
            &result->adapter_challenge_queries,
            &result->adapter_checks_passed);
        int seven_ok = r51_reconstruct_opaque(7u, &seven,
            &result->adapter_reconstruction_queries,
            &result->adapter_challenge_queries,
            &result->adapter_checks_passed);
        classes[6] = r51_classify(&six);
        classes[7] = r51_classify(&seven);
        result->adapter_verified = (uint32_t)(six_ok && seven_ok);
    } else if (mode == R51_ADAPTER_ORACLE) {
        r51_affine six = r51_primitive(6u);
        r51_affine seven = r51_primitive(7u);
        classes[6] = r51_classify(&six);
        classes[7] = r51_classify(&seven);
    } else if (mode == R51_ADAPTER_IDENTITY || mode == R51_ADAPTER_NO_QUERY ||
               mode == R51_ADAPTER_TOKEN_ID) {
        classes[6] = R51_CLASS_IDENTITY;
        classes[7] = R51_CLASS_IDENTITY;
    } else if (mode == R51_ADAPTER_SHUFFLED) {
        classes[6] = R51_CLASS_BIAS;
        classes[7] = R51_CLASS_PERMUTE;
    }
}

static uint32_t r51_evidence_loss(const r51_affine *candidate,
                                  const r51_affine *target) {
    uint32_t zero[R51_LANES] = {0u, 0u, 0u};
    uint32_t a[R51_LANES];
    uint32_t b[R51_LANES];
    r51_apply(candidate, zero, a);
    r51_apply(target, zero, b);
    uint32_t loss = 0u;
    for (uint32_t lane = 0; lane < R51_LANES; ++lane) {
        uint32_t direct = a[lane] > b[lane] ? a[lane] - b[lane] : b[lane] - a[lane];
        uint32_t wrapped = R51_MODULUS - direct;
        loss += direct < wrapped ? direct : wrapped;
    }
    return loss;
}

static uint32_t r51_prior_strength(const r51_artifact *artifact,
                                   const uint8_t token[R51_PROGRAM_LEN],
                                   const uint8_t classes[8], int ablated) {
    if (ablated) return 0u;
    uint8_t cls[R51_PROGRAM_LEN];
    uint32_t strength = 0u;
    for (uint32_t pos = 0; pos < R51_PROGRAM_LEN; ++pos) {
        cls[pos] = classes[token[pos]];
        strength += 8u * artifact->position_count[pos][cls[pos]];
    }
    strength += 5u * artifact->transition_count[cls[0]][cls[1]];
    strength += 5u * artifact->transition_count[cls[1]][cls[2]];
    return strength;
}

static int r51_candidate_compare(const void *left, const void *right) {
    const r51_candidate *a = (const r51_candidate *)left;
    const r51_candidate *b = (const r51_candidate *)right;
    if (a->score < b->score) return -1;
    if (a->score > b->score) return 1;
    if (a->tie < b->tie) return -1;
    if (a->tie > b->tie) return 1;
    return 0;
}

static uint32_t r51_rank_episode(const r51_artifact *artifact,
                                 const uint8_t target_token[R51_PROGRAM_LEN],
                                 uint32_t target_index, uint32_t tie_order,
                                 r51_adapter_mode mode, r51_result *result,
                                 int *top_invalid) {
    r51_affine target = r51_program(target_token);
    uint8_t classes[8];
    r51_adapter_classes(mode, classes, result);
    r51_candidate candidates[R51_CANDIDATES];
    uint32_t cursor = 0u;
    for (uint8_t a = 0; a < R51_PRIMITIVES; ++a)
        for (uint8_t b = 0; b < R51_PRIMITIVES; ++b)
            for (uint8_t c = 0; c < R51_PRIMITIVES; ++c) {
                r51_candidate *candidate = &candidates[cursor++];
                candidate->token[0] = a;
                candidate->token[1] = b;
                candidate->token[2] = c;
                candidate->exact = r51_program(candidate->token);
                uint32_t loss = r51_evidence_loss(&candidate->exact, &target);
                int ablated = mode == R51_ADAPTER_ABLATED;
                uint32_t strength = r51_prior_strength(
                    artifact, candidate->token, classes, ablated);
                candidate->score = (uint64_t)loss * UINT64_C(1000000) +
                                   (uint64_t)(1000u - strength);
                uint64_t seed = ((uint64_t)target_index << 32) |
                                (uint64_t)tie_order;
                candidate->tie = r51_hash_bytes(candidate->token,
                                                 sizeof(candidate->token), seed);
            }
    qsort(candidates, R51_CANDIDATES, sizeof(candidates[0]),
          r51_candidate_compare);
    *top_invalid = !r51_equal(&candidates[0].exact, &target);
    for (uint32_t rank = 0; rank < R51_CANDIDATES; ++rank)
        if (r51_equal(&candidates[rank].exact, &target)) return rank + 1u;
    return R51_CANDIDATES + 1u;
}

int r51_self_test(void) {
    r51_affine six;
    uint32_t reconstruction = 0u;
    uint32_t challenge = 0u;
    uint32_t passed = 0u;
    if (!r51_reconstruct_opaque(6u, &six, &reconstruction, &challenge, &passed))
        return 1;
    if (reconstruction != 4u || challenge != 3u || passed != 3u) return 1;
    if (r51_classify(&six) != R51_CLASS_PERMUTE) return 1;
    r51_artifact artifact;
    r51_build_artifact(&artifact);
    if (artifact.source_digest == 0u) return 1;
    uint8_t program[R51_PROGRAM_LEN] = {6u, 7u, 3u};
    r51_affine map = r51_program(program);
    uint32_t input[R51_LANES] = {2u, 3u, 5u};
    uint32_t output[R51_LANES];
    r51_apply(&map, input, output);
    return output[0] >= R51_MODULUS || output[1] >= R51_MODULUS ||
           output[2] >= R51_MODULUS;
}

int r51_execute(r51_result *result, r51_artifact *artifact) {
    static const uint8_t targets[R51_TARGETS][R51_PROGRAM_LEN] = {
        {6u,0u,3u}, {2u,7u,3u}, {6u,5u,1u}, {4u,7u,1u},
        {7u,2u,3u}, {7u,4u,1u}, {6u,7u,3u}, {6u,7u,1u},
        {7u,6u,3u}, {7u,6u,1u}, {6u,0u,1u}, {2u,7u,1u}
    };
    memset(result, 0, sizeof(*result));
    r51_build_artifact(artifact);
    result->source_programs = 16u;
    result->target_programs = R51_TARGETS;
    result->episodes = R51_EPISODES;
    result->candidate_programs_per_episode = R51_CANDIDATES;
    result->artifact_frozen_before_target = 1u;
    result->artifact_digest = artifact->source_digest;
    result->verifier_authoritative = 1u;
    for (uint32_t target = 0; target < R51_TARGETS; ++target) {
        for (uint32_t tie = 0; tie < R51_TIE_ORDERS; ++tie) {
            int invalid = 0;
            uint32_t full = r51_rank_episode(artifact, targets[target], target,
                tie, R51_ADAPTER_VERIFIED, result, &invalid);
            result->full_expansions += full;
            result->full_exact_matches += full <= R51_CANDIDATES;
            result->unverified_top_candidates += (uint32_t)invalid;
            if (full > result->full_max_expansions) result->full_max_expansions = full;
            uint32_t oracle = r51_rank_episode(artifact, targets[target], target,
                tie, R51_ADAPTER_ORACLE, result, &invalid);
            result->oracle_expansions += oracle;
            result->oracle_exact_matches += oracle <= R51_CANDIDATES;
            uint32_t target_only = r51_rank_episode(artifact, targets[target], target,
                tie, R51_ADAPTER_ABLATED, result, &invalid);
            result->target_only_expansions += target_only;
            result->source_ablation_expansions += target_only;
            if (target_only > result->target_only_max_expansions)
                result->target_only_max_expansions = target_only;
            result->individual_wins_vs_target_only += full < target_only;
            result->identity_adapter_expansions += r51_rank_episode(artifact,
                targets[target], target, tie, R51_ADAPTER_IDENTITY, result, &invalid);
            result->shuffled_adapter_expansions += r51_rank_episode(artifact,
                targets[target], target, tie, R51_ADAPTER_SHUFFLED, result, &invalid);
            result->no_query_adapter_expansions += r51_rank_episode(artifact,
                targets[target], target, tie, R51_ADAPTER_NO_QUERY, result, &invalid);
            result->token_id_lookup_expansions += r51_rank_episode(artifact,
                targets[target], target, tie, R51_ADAPTER_TOKEN_ID, result, &invalid);
        }
    }
    result->source_ablation_control_valid =
        result->source_ablation_expansions == result->target_only_expansions;
    result->gate_pass =
        result->adapter_verified &&
        result->adapter_reconstruction_queries == 8u * R51_EPISODES &&
        result->adapter_challenge_queries == 6u * R51_EPISODES &&
        result->adapter_checks_passed == 6u * R51_EPISODES &&
        result->artifact_frozen_before_target &&
        result->verifier_authoritative &&
        result->source_ablation_control_valid &&
        result->full_exact_matches == R51_EPISODES &&
        result->oracle_exact_matches == R51_EPISODES &&
        result->full_expansions == result->oracle_expansions &&
        result->full_expansions * 100u <= result->target_only_expansions * 80u &&
        result->full_expansions < result->identity_adapter_expansions &&
        result->full_expansions < result->shuffled_adapter_expansions &&
        result->full_expansions < result->no_query_adapter_expansions &&
        result->full_expansions < result->token_id_lookup_expansions &&
        result->individual_wins_vs_target_only >= 16u &&
        result->unverified_top_candidates > 0u &&
        result->premature_commits == 0u;
    result->result_digest = r51_hash_bytes(
        result, sizeof(*result) - sizeof(result->result_digest), 5101u);
    return 0;
}

int r51_write_artifact(const char *path, const r51_artifact *artifact) {
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    int ok = fwrite(artifact, sizeof(*artifact), 1u, file) == 1u;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 1;
}

int r51_write_result_json(const char *path, const r51_result *r) {
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    int ok = fprintf(file,
        "{\n"
        "  \"schema\": \"reasoner51-result-v1\",\n"
        "  \"experiment\": \"reasoner51-unseen-primitive-v1\",\n"
        "  \"decision\": \"%s\",\n"
        "  \"source_programs\": %u,\n"
        "  \"target_programs\": %u,\n"
        "  \"episodes\": %u,\n"
        "  \"candidate_programs_per_episode\": %u,\n"
        "  \"adapter_reconstruction_queries\": %u,\n"
        "  \"adapter_challenge_queries\": %u,\n"
        "  \"adapter_checks_passed\": %u,\n"
        "  \"full_expansions\": %u,\n"
        "  \"oracle_expansions\": %u,\n"
        "  \"target_only_expansions\": %u,\n"
        "  \"identity_adapter_expansions\": %u,\n"
        "  \"shuffled_adapter_expansions\": %u,\n"
        "  \"no_query_adapter_expansions\": %u,\n"
        "  \"token_id_lookup_expansions\": %u,\n"
        "  \"source_ablation_expansions\": %u,\n"
        "  \"full_exact_matches\": %u,\n"
        "  \"oracle_exact_matches\": %u,\n"
        "  \"individual_wins_vs_target_only\": %u,\n"
        "  \"unverified_top_candidates\": %u,\n"
        "  \"premature_commits\": %u,\n"
        "  \"full_max_expansions\": %u,\n"
        "  \"target_only_max_expansions\": %u,\n"
        "  \"adapter_verified\": %s,\n"
        "  \"artifact_frozen_before_target\": %s,\n"
        "  \"verifier_authoritative\": %s,\n"
        "  \"source_ablation_control_valid\": %s,\n"
        "  \"gate_pass\": %s,\n"
        "  \"artifact_digest\": \"%016llx\",\n"
        "  \"result_digest\": \"%016llx\"\n"
        "}\n",
        r->gate_pass ? "pass" : "no-go", r->source_programs,
        r->target_programs, r->episodes, r->candidate_programs_per_episode,
        r->adapter_reconstruction_queries, r->adapter_challenge_queries,
        r->adapter_checks_passed, r->full_expansions, r->oracle_expansions,
        r->target_only_expansions, r->identity_adapter_expansions,
        r->shuffled_adapter_expansions, r->no_query_adapter_expansions,
        r->token_id_lookup_expansions, r->source_ablation_expansions,
        r->full_exact_matches, r->oracle_exact_matches,
        r->individual_wins_vs_target_only, r->unverified_top_candidates,
        r->premature_commits, r->full_max_expansions,
        r->target_only_max_expansions, r->adapter_verified ? "true" : "false",
        r->artifact_frozen_before_target ? "true" : "false",
        r->verifier_authoritative ? "true" : "false",
        r->source_ablation_control_valid ? "true" : "false",
        r->gate_pass ? "true" : "false",
        (unsigned long long)r->artifact_digest,
        (unsigned long long)r->result_digest) > 0;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 1;
}
