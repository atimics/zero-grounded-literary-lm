#include "reasoner50.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Reuse the frozen Reasoner 4.2 grammar and exact affine verifier. */
#include "reasoner42.c"

#define R50_FNV_OFFSET UINT64_C(1469598103934665603)
#define R50_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    R42Target target;
    uint64_t digest;
} R50TargetEntry;

typedef struct {
    R42Engine target_engine;
    R42Macro library[R42_LIBRARY_SIZE];
    R50TargetEntry targets[R50_TARGET_PROGRAMS];
    int32_t source_weights[R50_FEATURES];
    int32_t residual_weights[R50_FEATURES];
    uint32_t raw_candidate_programs;
    uint64_t library_digest;
} R50Context;

typedef struct {
    uint32_t state[8];
    uint64_t bits;
    uint8_t block[64];
    size_t used;
} R50Sha256;

static uint32_t r50_rotr(uint32_t value, uint8_t bits)
{
    return (value >> bits) | (value << (32u - bits));
}

static void r50_sha256_transform(R50Sha256 *sha, const uint8_t block[64])
{
    static const uint32_t constants[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
        0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
        0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
        0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
        0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
        0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
        0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
        0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
        0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
        0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
        0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
        0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
        0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
    };
    uint32_t words[64];
    uint32_t a, b, c, d, e, f, g, h;
    uint8_t index;
    for (index = 0; index < 16; ++index) {
        size_t offset = (size_t)index * 4u;
        words[index] = ((uint32_t)block[offset] << 24u) |
                       ((uint32_t)block[offset + 1u] << 16u) |
                       ((uint32_t)block[offset + 2u] << 8u) |
                       (uint32_t)block[offset + 3u];
    }
    for (index = 16; index < 64; ++index) {
        uint32_t s0 = r50_rotr(words[index - 15u], 7) ^
                      r50_rotr(words[index - 15u], 18) ^
                      (words[index - 15u] >> 3u);
        uint32_t s1 = r50_rotr(words[index - 2u], 17) ^
                      r50_rotr(words[index - 2u], 19) ^
                      (words[index - 2u] >> 10u);
        words[index] = words[index - 16u] + s0 +
                       words[index - 7u] + s1;
    }
    a = sha->state[0]; b = sha->state[1]; c = sha->state[2];
    d = sha->state[3]; e = sha->state[4]; f = sha->state[5];
    g = sha->state[6]; h = sha->state[7];
    for (index = 0; index < 64; ++index) {
        uint32_t upper = r50_rotr(e, 6) ^ r50_rotr(e, 11) ^ r50_rotr(e, 25);
        uint32_t choose = (e & f) ^ ((~e) & g);
        uint32_t first = h + upper + choose + constants[index] + words[index];
        uint32_t lower = r50_rotr(a, 2) ^ r50_rotr(a, 13) ^ r50_rotr(a, 22);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t second = lower + majority;
        h = g; g = f; f = e; e = d + first;
        d = c; c = b; b = a; a = first + second;
    }
    sha->state[0] += a; sha->state[1] += b;
    sha->state[2] += c; sha->state[3] += d;
    sha->state[4] += e; sha->state[5] += f;
    sha->state[6] += g; sha->state[7] += h;
}

static void r50_sha256_init(R50Sha256 *sha)
{
    static const uint32_t initial[8] = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
    };
    memset(sha, 0, sizeof(*sha));
    memcpy(sha->state, initial, sizeof(initial));
}

static void r50_sha256_update(R50Sha256 *sha, const uint8_t *bytes,
                              size_t length)
{
    size_t index;
    sha->bits += (uint64_t)length * 8u;
    for (index = 0; index < length; ++index) {
        sha->block[sha->used++] = bytes[index];
        if (sha->used == sizeof(sha->block)) {
            r50_sha256_transform(sha, sha->block);
            sha->used = 0;
        }
    }
}

static void r50_sha256_final(R50Sha256 *sha, uint8_t digest[32])
{
    uint8_t index;
    uint64_t bits = sha->bits;
    sha->block[sha->used++] = 0x80u;
    if (sha->used > 56u) {
        while (sha->used < 64u) sha->block[sha->used++] = 0;
        r50_sha256_transform(sha, sha->block);
        sha->used = 0;
    }
    while (sha->used < 56u) sha->block[sha->used++] = 0;
    for (index = 0; index < 8u; ++index)
        sha->block[56u + index] =
            (uint8_t)(bits >> (56u - (uint8_t)(index * 8u)));
    r50_sha256_transform(sha, sha->block);
    for (index = 0; index < 8u; ++index) {
        digest[index * 4u] = (uint8_t)(sha->state[index] >> 24u);
        digest[index * 4u + 1u] = (uint8_t)(sha->state[index] >> 16u);
        digest[index * 4u + 2u] = (uint8_t)(sha->state[index] >> 8u);
        digest[index * 4u + 3u] = (uint8_t)sha->state[index];
    }
}

static uint8_t r50_sha256_self_test(void)
{
    static const uint8_t expected[32] = {
        0xe3u, 0xb0u, 0xc4u, 0x42u, 0x98u, 0xfcu, 0x1cu, 0x14u,
        0x9au, 0xfbu, 0xf4u, 0xc8u, 0x99u, 0x6fu, 0xb9u, 0x24u,
        0x27u, 0xaeu, 0x41u, 0xe4u, 0x64u, 0x9bu, 0x93u, 0x4cu,
        0xa4u, 0x95u, 0x99u, 0x1bu, 0x78u, 0x52u, 0xb8u, 0x55u
    };
    R50Sha256 sha;
    uint8_t digest[32];
    r50_sha256_init(&sha);
    r50_sha256_final(&sha, digest);
    return (uint8_t)(memcmp(digest, expected, sizeof(expected)) == 0);
}

static void r50_artifact_bytes(const int32_t weights[R50_FEATURES],
                               uint8_t bytes[R50_ARTIFACT_BYTES])
{
    uint16_t feature;
    for (feature = 0; feature < R50_FEATURES; ++feature) {
        uint32_t value = (uint32_t)weights[feature];
        bytes[feature * 4u] = (uint8_t)value;
        bytes[feature * 4u + 1u] = (uint8_t)(value >> 8u);
        bytes[feature * 4u + 2u] = (uint8_t)(value >> 16u);
        bytes[feature * 4u + 3u] = (uint8_t)(value >> 24u);
    }
}

static void r50_artifact_sha256(const int32_t weights[R50_FEATURES],
                                char hex[65])
{
    static const char digits[] = "0123456789abcdef";
    uint8_t bytes[R50_ARTIFACT_BYTES];
    uint8_t digest[32];
    R50Sha256 sha;
    uint8_t index;
    r50_artifact_bytes(weights, bytes);
    r50_sha256_init(&sha);
    r50_sha256_update(&sha, bytes, sizeof(bytes));
    r50_sha256_final(&sha, digest);
    for (index = 0; index < 32u; ++index) {
        hex[index * 2u] = digits[digest[index] >> 4u];
        hex[index * 2u + 1u] = digits[digest[index] & 15u];
    }
    hex[64] = '\0';
}

static uint8_t r50_artifact_roundtrip(const int32_t weights[R50_FEATURES])
{
    uint8_t bytes[R50_ARTIFACT_BYTES];
    uint16_t feature;
    r50_artifact_bytes(weights, bytes);
    for (feature = 0; feature < R50_FEATURES; ++feature) {
        uint32_t value = (uint32_t)bytes[feature * 4u] |
            ((uint32_t)bytes[feature * 4u + 1u] << 8u) |
            ((uint32_t)bytes[feature * 4u + 2u] << 16u) |
            ((uint32_t)bytes[feature * 4u + 3u] << 24u);
        if ((int32_t)value != weights[feature]) return 0;
    }
    return 1;
}

static void r50_program_features(const R42Program *program,
                                 int32_t features[R50_FEATURES])
{
    uint8_t token;
    memset(features, 0, R50_FEATURES * sizeof(features[0]));
    for (token = 0; token < program->token_count; ++token) {
        uint8_t value = program->tokens[token];
        if (value >= 1u && value <= 9u)
            ++features[value - 1u];
        if (token + 1u < program->token_count) {
            uint8_t next = program->tokens[token + 1u];
            if (value >= 1u && value <= 9u && next >= 1u && next <= 9u)
                ++features[9u + (value - 1u) * 9u + (next - 1u)];
        }
    }
    features[90] = program->token_count;
    features[91] = program->macro_uses;
}

static void r50_learn_counts(const R42Engine *engine,
                             const R42Target *targets, uint16_t count,
                             int32_t weights[R50_FEATURES])
{
    uint16_t target;
    memset(weights, 0, R50_FEATURES * sizeof(weights[0]));
    for (target = 0; target < count; ++target) {
        uint16_t program = r42_find_program(engine, targets[target].code,
                                            targets[target].length);
        int32_t features[R50_FEATURES];
        uint16_t feature;
        if (program == UINT16_MAX) continue;
        r50_program_features(&engine->programs[program], features);
        for (feature = 0; feature < R50_FEATURES; ++feature)
            weights[feature] += features[feature];
    }
}

static int r50_target_compare(const void *left_pointer,
                              const void *right_pointer)
{
    const R50TargetEntry *left = left_pointer;
    const R50TargetEntry *right = right_pointer;
    if (left->digest < right->digest) return -1;
    if (left->digest > right->digest) return 1;
    if (left->target.length != right->target.length)
        return left->target.length < right->target.length ? -1 : 1;
    return memcmp(left->target.code, right->target.code,
                  left->target.length);
}

static R0Status r50_prepare(R50Context *context, char *error,
                            size_t error_capacity)
{
    R42Engine curriculum_engine;
    R42Engine library_engine;
    R42Engine base_depth_four;
    R42Evaluation evaluation;
    R42Program curriculum_solutions[R42_CURRICULUM_TARGETS];
    R42Target development_targets[R42_LIBRARY_SIZE * R42_LIBRARY_SIZE];
    R42Target raw_targets[R42_SEALED_TARGETS];
    uint16_t curriculum_programs[R42_CURRICULUM_TARGETS];
    uint16_t development_count;
    uint16_t target_count;
    uint32_t base_tokens, library_tokens;
    uint8_t library_count;
    uint16_t index;
    R0Status status;
    memset(context, 0, sizeof(*context));
    status = r42_build_engine(&curriculum_engine, NULL, 0, 3, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    r42_evaluate_targets(&curriculum_engine, r42_curriculum_targets,
        R42_CURRICULUM_TARGETS, 1, R42_CONTROL_MODEL, &evaluation,
        curriculum_programs);
    if (!evaluation.exact) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 source curriculum did not replay exactly");
        return R0_POLICY_ERROR;
    }
    for (index = 0; index < R42_CURRICULUM_TARGETS; ++index) {
        if (curriculum_programs[index] == UINT16_MAX) {
            set_error(error, error_capacity,
                      "Reasoner 5.0 source solution missing");
            return R0_POLICY_ERROR;
        }
        curriculum_solutions[index] =
            curriculum_engine.programs[curriculum_programs[index]];
    }
    library_count = r42_learn_library(curriculum_solutions,
        R42_CURRICULUM_TARGETS, 0, context->library);
    if (!r42_library_matches_contract(context->library, library_count)) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 frozen library mismatch");
        return R0_POLICY_ERROR;
    }
    context->library_digest =
        r42_library_digest(context->library, library_count);
    status = r42_build_engine(&library_engine, context->library,
        library_count, 2, 2, error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&base_depth_four, NULL, 0, 4, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    development_count = r42_make_development_targets(context->library,
        &library_engine, &base_depth_four, development_targets,
        &base_tokens, &library_tokens);
    if (development_count != R50_SOURCE_PROGRAMS) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 source target census mismatch");
        return R0_POLICY_ERROR;
    }
    r50_learn_counts(&library_engine, development_targets,
                     development_count, context->source_weights);
    status = r42_build_engine(&context->target_engine, context->library,
        library_count, 3, 3, error, error_capacity);
    if (status != R0_OK) return status;
    target_count = r42_make_sealed_targets(&context->target_engine,
        raw_targets, &base_tokens, &library_tokens);
    if (target_count != R50_TARGET_PROGRAMS) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 target census mismatch");
        return R0_POLICY_ERROR;
    }
    for (index = 0; index < target_count; ++index) {
        context->targets[index].target = raw_targets[index];
        context->targets[index].digest =
            r42_program_digest(raw_targets[index].code,
                               raw_targets[index].length);
    }
    qsort(context->targets, target_count, sizeof(context->targets[0]),
          r50_target_compare);
    {
        R42Target calibration[R50_CALIBRATION_PROGRAMS];
        for (index = 0; index < R50_CALIBRATION_PROGRAMS; ++index)
            calibration[index] = context->targets[index].target;
        r50_learn_counts(&context->target_engine, calibration,
                         R50_CALIBRATION_PROGRAMS,
                         context->residual_weights);
    }
    context->raw_candidate_programs = context->target_engine.raw_programs;
    if (context->raw_candidate_programs != 820u ||
        context->target_engine.program_count == 0u ||
        !r50_artifact_roundtrip(context->source_weights) ||
        !r50_sha256_self_test()) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 deployment interface certificate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int64_t r50_score(const R42Program *program,
                         const int32_t weights[R50_FEATURES],
                         uint8_t runtime_mismatch)
{
    int32_t features[R50_FEATURES];
    int64_t score = 0;
    uint16_t feature;
    r50_program_features(program, features);
    if (runtime_mismatch) {
        int32_t swap = features[6];
        features[6] = features[8];
        features[8] = swap;
    }
    for (feature = 0; feature < R50_FEATURES; ++feature)
        score += (int64_t)features[feature] * weights[feature];
    return score;
}

static int r50_lexical_compare(const R42Program *left,
                               const R42Program *right)
{
    uint8_t width = left->token_count < right->token_count
        ? left->token_count : right->token_count;
    int compared = memcmp(left->tokens, right->tokens, width);
    if (compared != 0) return compared;
    return 0;
}

static uint8_t r50_candidate_before(const R42Program *left,
                                    const R42Program *right,
                                    const int32_t weights[R50_FEATURES],
                                    uint8_t tie_order,
                                    uint8_t runtime_mismatch)
{
    int64_t left_score = r50_score(left, weights, runtime_mismatch);
    int64_t right_score = r50_score(right, weights, runtime_mismatch);
    int lexical;
    if (left_score != right_score) return left_score > right_score;
    lexical = r50_lexical_compare(left, right);
    if (tie_order == 0u) {
        if (left->token_count != right->token_count)
            return left->token_count < right->token_count;
        if (lexical != 0) return lexical < 0;
    } else {
        if (lexical != 0) return lexical > 0;
        if (left->token_count != right->token_count)
            return left->token_count < right->token_count;
    }
    return left->proof_digest < right->proof_digest;
}

static uint32_t r50_search(const R42Engine *engine,
                           const R42Target *target,
                           const int32_t weights[R50_FEATURES],
                           uint8_t tie_order, uint8_t runtime_mismatch,
                           uint16_t *selected_program,
                           uint8_t *invalid_top)
{
    uint8_t used[R42_MAX_PROGRAMS] = {0};
    uint32_t expansion;
    *selected_program = UINT16_MAX;
    *invalid_top = 0;
    for (expansion = 1; expansion <= engine->program_count; ++expansion) {
        uint16_t candidate;
        uint16_t best = UINT16_MAX;
        for (candidate = 0; candidate < engine->program_count; ++candidate) {
            if (used[candidate]) continue;
            if (best == UINT16_MAX ||
                r50_candidate_before(&engine->programs[candidate],
                    &engine->programs[best], weights, tie_order,
                    runtime_mismatch))
                best = candidate;
        }
        if (best == UINT16_MAX) break;
        used[best] = 1;
        if (expansion == 1u &&
            !r42_program_equal_code(engine->programs[best].base_code,
                engine->programs[best].base_length,
                target->code, target->length))
            *invalid_top = 1;
        if (r42_program_equal_code(engine->programs[best].base_code,
                engine->programs[best].base_length,
                target->code, target->length)) {
            *selected_program = best;
            return expansion;
        }
    }
    return engine->program_count + 1u;
}

static void r50_record_search(R50SearchMetrics *metrics,
                              uint32_t expansions)
{
    ++metrics->episodes;
    metrics->expansions += expansions;
    if (expansions > metrics->maximum_expansions)
        metrics->maximum_expansions = expansions;
    if (expansions > R50_MAX_EXPANSIONS) ++metrics->over_budget;
}

static void r50_combine_weights(const int32_t source[R50_FEATURES],
                                const int32_t residual[R50_FEATURES],
                                int32_t combined[R50_FEATURES])
{
    uint16_t feature;
    for (feature = 0; feature < R50_FEATURES; ++feature)
        combined[feature] = source[feature] + residual[feature];
}

static void r50_shuffle_source(const int32_t source[R50_FEATURES],
                               int32_t shuffled[R50_FEATURES])
{
    uint16_t feature;
    for (feature = 0; feature < R50_FEATURES; ++feature)
        shuffled[(feature + 17u) % R50_FEATURES] = source[feature];
}

static uint8_t r50_replay_selected(const R42Engine *engine,
                                   uint16_t selected,
                                   const R42Target *target,
                                   uint16_t target_number,
                                   uint8_t tie_order,
                                   R50ExperimentReport *report)
{
    uint16_t query;
    uint8_t action;
    uint16_t target_program = r42_find_program(engine, target->code,
                                               target->length);
    if (selected == UINT16_MAX || target_program == UINT16_MAX) return 0;
    for (query = 0; query < R42_QUERY_COUNT; ++query) {
        uint16_t selected_response[R42_MAX_DIMENSION];
        uint16_t target_response[R42_MAX_DIMENSION];
        uint8_t selected_dimension, target_dimension;
        r42_query_response(&engine->programs[selected], query,
                           selected_response, &selected_dimension);
        r42_query_response_code(target->code, target->length, query,
                                target_response, &target_dimension);
        ++report->affine_replay_checks;
        if (selected_dimension == target_dimension &&
            memcmp(selected_response, target_response,
                target_dimension * sizeof(target_response[0])) == 0)
            ++report->exact_affine_replays;
    }
    for (action = 0; action < 3u; ++action) {
        uint8_t dimension = (uint8_t)(5u +
            ((target_number + tie_order + action) % 4u));
        int16_t semantic[R42_MAX_DIMENSION];
        uint16_t raw[R42_MAX_DIMENSION];
        uint8_t coordinate;
        make_pattern((uint8_t)((target_number * 5u + action * 7u +
                     tie_order) % R310_VECTOR_COUNT), dimension, semantic);
        for (coordinate = 0; coordinate < dimension; ++coordinate)
            raw[coordinate] = r40_field(semantic[coordinate]);
        r42_apply_forward_code(target->code, target->length, raw, dimension);
        r42_apply_inverse_code(engine->programs[selected].base_code,
            engine->programs[selected].base_length, raw, dimension);
        ++report->applications;
        for (coordinate = 0; coordinate < dimension; ++coordinate)
            if (raw[coordinate] != r40_field(semantic[coordinate])) break;
        if (coordinate == dimension) ++report->exact_applications;
    }
    ++report->reports;
    {
        char selected_text[128];
        char target_text[128];
        if (r42_render_program(&engine->programs[selected], selected_text,
                               sizeof(selected_text)) &&
            r42_render_program(&engine->programs[target_program], target_text,
                               sizeof(target_text)) &&
            strcmp(selected_text, target_text) == 0)
            ++report->exact_reports;
    }
    return 1;
}

static uint64_t r50_digest_byte(uint64_t hash, uint8_t value)
{
    hash ^= value;
    return hash * R50_FNV_PRIME;
}

static uint64_t r50_digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t index;
    for (index = 0; index < 8u; ++index)
        hash = r50_digest_byte(hash, (uint8_t)(value >> (index * 8u)));
    return hash;
}

static uint64_t r50_report_digest(const R50ExperimentReport *report)
{
    uint64_t hash = R50_FNV_OFFSET;
    hash = r50_digest_u64(hash, report->full.expansions);
    hash = r50_digest_u64(hash, report->target_only.expansions);
    hash = r50_digest_u64(hash, report->source_only.expansions);
    hash = r50_digest_u64(hash, report->shuffled_source.expansions);
    hash = r50_digest_u64(hash, report->runtime_mismatch.expansions);
    hash = r50_digest_u64(hash, report->exact_identifications);
    hash = r50_digest_u64(hash, report->exact_affine_replays);
    hash = r50_digest_u64(hash, report->exact_applications);
    hash = r50_digest_u64(hash, report->individual_wins_over_target_only);
    hash = r50_digest_u64(hash, report->invalid_unverified_top_candidates);
    hash = r50_digest_byte(hash, report->gate_passed);
    return hash;
}

R0Status r50_run_preflight(char *error, size_t error_capacity)
{
    R50Context *context = calloc(1, sizeof(*context));
    R0Status status;
    if (context == NULL) {
        set_error(error, error_capacity, "Reasoner 5.0 preflight allocation failed");
        return R0_LIMIT_ERROR;
    }
    status = r50_prepare(context, error, error_capacity);
    free(context);
    return status;
}

R0Status r50_run_experiment(R50ExperimentReport *report,
                            int32_t source_artifact[R50_FEATURES],
                            char *error, size_t error_capacity)
{
    R50Context *context = calloc(1, sizeof(*context));
    int32_t frozen_copy[R50_FEATURES];
    int32_t full_weights[R50_FEATURES];
    int32_t shuffled_source[R50_FEATURES];
    int32_t shuffled_weights[R50_FEATURES];
    uint16_t target_index;
    R0Status status;
    if (report == NULL || source_artifact == NULL || context == NULL) {
        free(context);
        set_error(error, error_capacity, "Reasoner 5.0 invalid experiment storage");
        return R0_INVALID_ARGUMENT;
    }
    memset(report, 0, sizeof(*report));
    status = r50_prepare(context, error, error_capacity);
    if (status != R0_OK) {
        free(context);
        return status;
    }
    memcpy(frozen_copy, context->source_weights, sizeof(frozen_copy));
    memcpy(source_artifact, context->source_weights,
           R50_FEATURES * sizeof(source_artifact[0]));
    r50_combine_weights(context->source_weights, context->residual_weights,
                        full_weights);
    r50_shuffle_source(context->source_weights, shuffled_source);
    r50_combine_weights(shuffled_source, context->residual_weights,
                        shuffled_weights);
    report->source_programs = R50_SOURCE_PROGRAMS;
    report->calibration_programs = R50_CALIBRATION_PROGRAMS;
    report->held_out_programs = R50_HELD_OUT_PROGRAMS;
    report->raw_candidate_programs = context->raw_candidate_programs;
    report->canonical_candidate_programs = context->target_engine.program_count;
    report->feature_slots = R50_FEATURES;
    report->artifact_bytes = R50_ARTIFACT_BYTES;
    report->frozen_library_digest = context->library_digest;
    r50_artifact_sha256(context->source_weights,
                        report->source_artifact_sha256);
    report->deployment_exact_score_passed =
        r50_artifact_roundtrip(context->source_weights);
    for (target_index = R50_CALIBRATION_PROGRAMS;
         target_index < R50_TARGET_PROGRAMS; ++target_index) {
        uint8_t tie_order;
        const R42Target *target = &context->targets[target_index].target;
        for (tie_order = 0; tie_order < R50_EVIDENCE_ORDERS; ++tie_order) {
            uint16_t selected;
            uint8_t invalid_top;
            uint32_t full_expansions = r50_search(&context->target_engine,
                target, full_weights, tie_order, 0, &selected, &invalid_top);
            uint32_t target_only_expansions;
            uint32_t source_only_expansions;
            uint32_t ablated_expansions;
            uint32_t shuffled_expansions;
            uint32_t mismatch_expansions;
            r50_record_search(&report->full, full_expansions);
            report->invalid_unverified_top_candidates += invalid_top;
            if (selected != UINT16_MAX &&
                r50_replay_selected(&context->target_engine, selected, target,
                    target_index, tie_order, report))
                ++report->exact_identifications;
            target_only_expansions = r50_search(&context->target_engine,
                target, context->residual_weights, tie_order, 0,
                &selected, &invalid_top);
            r50_record_search(&report->target_only, target_only_expansions);
            source_only_expansions = r50_search(&context->target_engine,
                target, context->source_weights, tie_order, 0,
                &selected, &invalid_top);
            r50_record_search(&report->source_only, source_only_expansions);
            ablated_expansions = r50_search(&context->target_engine,
                target, context->residual_weights, tie_order, 0,
                &selected, &invalid_top);
            r50_record_search(&report->source_ablation,
                              ablated_expansions);
            shuffled_expansions = r50_search(&context->target_engine,
                target, shuffled_weights, tie_order, 0,
                &selected, &invalid_top);
            r50_record_search(&report->shuffled_source,
                              shuffled_expansions);
            mismatch_expansions = r50_search(&context->target_engine,
                target, full_weights, tie_order, 1,
                &selected, &invalid_top);
            r50_record_search(&report->runtime_mismatch,
                              mismatch_expansions);
            r50_record_search(&report->oracle, 1u);
            if (full_expansions < target_only_expansions)
                ++report->individual_wins_over_target_only;
        }
    }
    report->source_artifact_frozen =
        (uint8_t)(memcmp(frozen_copy, context->source_weights,
                         sizeof(frozen_copy)) == 0);
    report->verifier_authority_passed =
        (uint8_t)(report->invalid_unverified_top_candidates > 0u &&
                  report->exact_identifications == R50_HELD_OUT_EPISODES);
    report->source_ablation_control_passed =
        (uint8_t)(report->source_ablation.expansions ==
                      report->target_only.expansions &&
                  report->source_ablation.maximum_expansions ==
                      report->target_only.maximum_expansions &&
                  report->source_ablation.over_budget ==
                      report->target_only.over_budget);
    report->gate_passed = (uint8_t)(
        report->source_artifact_frozen &&
        report->deployment_exact_score_passed &&
        report->verifier_authority_passed &&
        report->source_ablation_control_passed &&
        report->full.episodes == R50_HELD_OUT_EPISODES &&
        report->exact_identifications == R50_HELD_OUT_EPISODES &&
        report->affine_replay_checks ==
            (uint32_t)(R50_HELD_OUT_EPISODES * R42_QUERY_COUNT) &&
        report->exact_affine_replays == report->affine_replay_checks &&
        report->applications == R50_HELD_OUT_EPISODES * 3u &&
        report->exact_applications == report->applications &&
        report->reports == R50_HELD_OUT_EPISODES &&
        report->exact_reports == report->reports &&
        report->premature_commits == 0u &&
        report->full.over_budget == 0u &&
        report->full.expansions * 10u <=
            report->target_only.expansions * 8u &&
        report->full.expansions < report->source_only.expansions &&
        report->full.expansions < report->shuffled_source.expansions &&
        report->full.expansions < report->runtime_mismatch.expansions &&
        report->individual_wins_over_target_only >= 12u &&
        report->target_only.over_budget > 0u &&
        report->shuffled_source.over_budget > 0u &&
        report->oracle.expansions == R50_HELD_OUT_EPISODES &&
        report->oracle.maximum_expansions == 1u);
    report->result_digest = r50_report_digest(report);
    free(context);
    return R0_OK;
}

R0Status r50_write_artifact(
    const int32_t source_artifact[R50_FEATURES], const char *path,
    char *error, size_t error_capacity)
{
    uint8_t bytes[R50_ARTIFACT_BYTES];
    FILE *file;
    if (source_artifact == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    r50_artifact_bytes(source_artifact, bytes);
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 cannot create source artifact");
        return R0_IO_ERROR;
    }
    if (fwrite(bytes, 1, sizeof(bytes), file) != sizeof(bytes) ||
        fclose(file) != 0) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 cannot write source artifact");
        return R0_IO_ERROR;
    }
    return R0_OK;
}

static int r50_write_metrics(FILE *file, const R50SearchMetrics *metrics)
{
    return fprintf(file,
        "{\"episodes\":%u,\"expansions\":%" PRIu64
        ",\"maximum_expansions\":%u,\"over_budget\":%u}",
        metrics->episodes, metrics->expansions,
        metrics->maximum_expansions, metrics->over_budget) < 0 ? -1 : 0;
}

R0Status r50_write_result(const R50ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    if (report == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 cannot create result");
        return R0_IO_ERROR;
    }
    if (fprintf(file,
        "{\n  \"schema\": \"zero.reasoner50_residual_transfer.v1\",\n"
        "  \"version\": \"5.0\",\n"
        "  \"decision\": \"%s\",\n"
        "  \"source_programs\": %u,\n"
        "  \"calibration_programs\": %u,\n"
        "  \"held_out_programs\": %u,\n"
        "  \"raw_candidate_programs\": %u,\n"
        "  \"canonical_candidate_programs\": %u,\n"
        "  \"feature_slots\": %u,\n"
        "  \"artifact_bytes\": %u,\n"
        "  \"source_artifact_sha256\": \"%s\",\n"
        "  \"frozen_library_digest\": \"%016" PRIx64 "\",\n"
        "  \"full\": ",
        report->gate_passed ? "pass" : "no-go",
        report->source_programs, report->calibration_programs,
        report->held_out_programs, report->raw_candidate_programs,
        report->canonical_candidate_programs, report->feature_slots,
        report->artifact_bytes, report->source_artifact_sha256,
        report->frozen_library_digest) < 0 ||
        r50_write_metrics(file, &report->full) != 0 ||
        fprintf(file, ",\n  \"target_only\": ") < 0 ||
        r50_write_metrics(file, &report->target_only) != 0 ||
        fprintf(file, ",\n  \"source_only\": ") < 0 ||
        r50_write_metrics(file, &report->source_only) != 0 ||
        fprintf(file, ",\n  \"source_ablation\": ") < 0 ||
        r50_write_metrics(file, &report->source_ablation) != 0 ||
        fprintf(file, ",\n  \"shuffled_source\": ") < 0 ||
        r50_write_metrics(file, &report->shuffled_source) != 0 ||
        fprintf(file, ",\n  \"runtime_mismatch\": ") < 0 ||
        r50_write_metrics(file, &report->runtime_mismatch) != 0 ||
        fprintf(file, ",\n  \"oracle\": ") < 0 ||
        r50_write_metrics(file, &report->oracle) != 0 ||
        fprintf(file,
        ",\n  \"exact_identifications\": %u,\n"
        "  \"affine_replay_checks\": %u,\n"
        "  \"exact_affine_replays\": %u,\n"
        "  \"applications\": %u,\n"
        "  \"exact_applications\": %u,\n"
        "  \"reports\": %u,\n"
        "  \"exact_reports\": %u,\n"
        "  \"premature_commits\": %u,\n"
        "  \"individual_wins_over_target_only\": %u,\n"
        "  \"invalid_unverified_top_candidates\": %u,\n"
        "  \"source_artifact_frozen\": %s,\n"
        "  \"deployment_exact_score_passed\": %s,\n"
        "  \"verifier_authority_passed\": %s,\n"
        "  \"source_ablation_control_passed\": %s,\n"
        "  \"gate_passed\": %s,\n"
        "  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
        report->exact_identifications, report->affine_replay_checks,
        report->exact_affine_replays, report->applications,
        report->exact_applications, report->reports, report->exact_reports,
        report->premature_commits,
        report->individual_wins_over_target_only,
        report->invalid_unverified_top_candidates,
        report->source_artifact_frozen ? "true" : "false",
        report->deployment_exact_score_passed ? "true" : "false",
        report->verifier_authority_passed ? "true" : "false",
        report->source_ablation_control_passed ? "true" : "false",
        report->gate_passed ? "true" : "false",
        report->result_digest) < 0 || fclose(file) != 0) {
        set_error(error, error_capacity,
                  "Reasoner 5.0 cannot write result");
        return R0_IO_ERROR;
    }
    return R0_OK;
}
