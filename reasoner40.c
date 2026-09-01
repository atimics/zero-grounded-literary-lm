#include "reasoner40.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Reasoner 4.0 embeds the exact Reasoner (3,9) implementation instead of
 * copying or approximating its law engine.  The contract checker pins the
 * source and header hashes.  This translation unit is deliberately not linked
 * with reasoner310.c a second time.
 */
#include "reasoner310.c"

#define R40_FROZEN_R310_DEVELOPMENT_DIGEST UINT64_C(0xc16b44a0ab50c456)
#define R40_FNV_OFFSET UINT64_C(1469598103934665603)
#define R40_FNV_PRIME UINT64_C(1099511628211)
#define R40_FAMILIAR_LAWS 16

typedef enum {
    R40_ADAPTER_REVERSE = 1,
    R40_ADAPTER_ROTATE_LEFT = 2,
    R40_ADAPTER_PREFIX_SUM = 3,
    R40_ADAPTER_PAIR_SHEAR = 4,
    R40_ADAPTER_ADD_17 = 5,
    R40_ADAPTER_MULTIPLY_3 = 6
} R40AdapterOp;

typedef struct {
    uint8_t code[R40_MAX_ADAPTER_CODE];
    uint8_t length;
    uint64_t semantic_digest;
} R40AdapterProgram;

typedef struct {
    R310Engine core;
    R40AdapterProgram adapters[R40_MAX_ADAPTER_PROGRAMS];
    uint16_t familiar_laws[R40_FAMILIAR_LAWS];
    uint16_t adapter_count;
    uint8_t familiar_law_count;
    uint32_t raw_adapter_programs;
    uint8_t canonicalization_passed;
    uint8_t unique_minimum_passed;
    uint8_t grammar_certificate_passed;
    uint8_t frozen_core_passed;
} R40Engine;

typedef struct {
    int16_t values[R310_MAX_DIMENSIONS];
} R40Prediction;

static uint16_t r40_field(int32_t value)
{
    int32_t reduced = value % R40_FIELD_MODULUS;
    if (reduced < 0) reduced += R40_FIELD_MODULUS;
    return (uint16_t)reduced;
}

static int16_t r40_centered(uint16_t value)
{
    return (int16_t)(value <= 128u ? value : (int16_t)value - 257);
}

static void r40_apply_forward(uint8_t operation, uint16_t *values,
                              uint8_t dimension)
{
    uint8_t index;
    switch (operation) {
    case R40_ADAPTER_REVERSE:
        for (index = 0; index < dimension / 2u; ++index) {
            uint16_t swap = values[index];
            values[index] = values[dimension - 1u - index];
            values[dimension - 1u - index] = swap;
        }
        break;
    case R40_ADAPTER_ROTATE_LEFT:
        if (dimension > 1) {
            uint16_t first = values[0];
            memmove(values, values + 1,
                    (dimension - 1u) * sizeof(values[0]));
            values[dimension - 1u] = first;
        }
        break;
    case R40_ADAPTER_PREFIX_SUM:
        for (index = 1; index < dimension; ++index)
            values[index] = r40_field(values[index] + values[index - 1u]);
        break;
    case R40_ADAPTER_PAIR_SHEAR:
        for (index = 0; index + 1u < dimension; index += 2u)
            values[index] = r40_field(values[index] + values[index + 1u]);
        break;
    case R40_ADAPTER_ADD_17:
        for (index = 0; index < dimension; ++index)
            values[index] = r40_field(values[index] + 17);
        break;
    case R40_ADAPTER_MULTIPLY_3:
        for (index = 0; index < dimension; ++index)
            values[index] = r40_field(3 * values[index]);
        break;
    }
}

static void r40_apply_inverse(uint8_t operation, uint16_t *values,
                              uint8_t dimension)
{
    uint8_t index;
    switch (operation) {
    case R40_ADAPTER_REVERSE:
        r40_apply_forward(operation, values, dimension);
        break;
    case R40_ADAPTER_ROTATE_LEFT:
        if (dimension > 1) {
            uint16_t last = values[dimension - 1u];
            memmove(values + 1, values,
                    (dimension - 1u) * sizeof(values[0]));
            values[0] = last;
        }
        break;
    case R40_ADAPTER_PREFIX_SUM:
        for (index = dimension; index > 1u; --index)
            values[index - 1u] =
                r40_field(values[index - 1u] - values[index - 2u]);
        break;
    case R40_ADAPTER_PAIR_SHEAR:
        for (index = 0; index + 1u < dimension; index += 2u)
            values[index] = r40_field(values[index] - values[index + 1u]);
        break;
    case R40_ADAPTER_ADD_17:
        for (index = 0; index < dimension; ++index)
            values[index] = r40_field(values[index] - 17);
        break;
    case R40_ADAPTER_MULTIPLY_3:
        for (index = 0; index < dimension; ++index)
            values[index] = r40_field(86 * values[index]);
        break;
    }
}

static void r40_encode(const R40AdapterProgram *adapter,
                       const int16_t *semantic, uint8_t dimension,
                       uint16_t *raw)
{
    uint8_t index;
    for (index = 0; index < dimension; ++index)
        raw[index] = r40_field(semantic[index]);
    for (index = 0; index < adapter->length; ++index)
        r40_apply_forward(adapter->code[index], raw, dimension);
}

static void r40_decode(const R40AdapterProgram *adapter,
                       const uint16_t *raw, uint8_t dimension,
                       int16_t *semantic)
{
    uint16_t working[R310_MAX_DIMENSIONS];
    uint8_t index;
    memcpy(working, raw, dimension * sizeof(working[0]));
    for (index = adapter->length; index > 0; --index)
        r40_apply_inverse(adapter->code[index - 1u], working, dimension);
    for (index = 0; index < dimension; ++index)
        semantic[index] = r40_centered(working[index]);
}

static uint64_t r40_digest_byte(uint64_t hash, uint8_t value)
{
    hash ^= value;
    return hash * R40_FNV_PRIME;
}

static uint64_t r40_adapter_digest(const R40AdapterProgram *adapter)
{
    uint64_t hash = R40_FNV_OFFSET;
    uint8_t dimension;
    for (dimension = 4; dimension <= R310_MAX_DIMENSIONS; ++dimension) {
        uint8_t vector;
        for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
            int16_t semantic[R310_MAX_DIMENSIONS];
            uint16_t raw[R310_MAX_DIMENSIONS];
            uint8_t coordinate;
            make_pattern(vector, dimension, semantic);
            r40_encode(adapter, semantic, dimension, raw);
            hash = r40_digest_byte(hash, dimension);
            hash = r40_digest_byte(hash, vector);
            for (coordinate = 0; coordinate < dimension; ++coordinate) {
                hash = r40_digest_byte(hash, (uint8_t)raw[coordinate]);
                hash = r40_digest_byte(hash,
                    (uint8_t)(raw[coordinate] >> 8u));
            }
        }
    }
    return hash;
}

static uint8_t r40_adapter_equal(const R40AdapterProgram *left,
                                 const R40AdapterProgram *right)
{
    uint8_t dimension;
    if (left->semantic_digest != right->semantic_digest) return 0;
    for (dimension = 4; dimension <= R310_MAX_DIMENSIONS; ++dimension) {
        uint8_t vector;
        for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
            int16_t semantic[R310_MAX_DIMENSIONS];
            uint16_t left_raw[R310_MAX_DIMENSIONS];
            uint16_t right_raw[R310_MAX_DIMENSIONS];
            make_pattern(vector, dimension, semantic);
            r40_encode(left, semantic, dimension, left_raw);
            r40_encode(right, semantic, dimension, right_raw);
            if (memcmp(left_raw, right_raw,
                       dimension * sizeof(left_raw[0])) != 0)
                return 0;
        }
    }
    return 1;
}

static int r40_adapter_quality_compare(const R40AdapterProgram *left,
                                       const R40AdapterProgram *right)
{
    int compared;
    if (left->length != right->length)
        return (int)left->length - (int)right->length;
    compared = memcmp(left->code, right->code, left->length);
    return compared;
}

static R0Status r40_add_adapter(R40Engine *engine,
                                R40AdapterProgram *candidate,
                                char *error, size_t error_capacity)
{
    uint16_t existing;
    ++engine->raw_adapter_programs;
    candidate->semantic_digest = r40_adapter_digest(candidate);
    for (existing = 0; existing < engine->adapter_count; ++existing)
        if (r40_adapter_equal(candidate, &engine->adapters[existing])) {
            if (r40_adapter_quality_compare(
                    candidate, &engine->adapters[existing]) < 0)
                engine->unique_minimum_passed = 0;
            return R0_OK;
        }
    if (engine->adapter_count >= R40_MAX_ADAPTER_PROGRAMS) {
        set_error(error, error_capacity, "adapter program capacity exceeded");
        return R0_POLICY_ERROR;
    }
    engine->adapters[engine->adapter_count++] = *candidate;
    return R0_OK;
}

static R0Status r40_generate_adapters(R40Engine *engine, char *error,
                                      size_t error_capacity)
{
    R40AdapterProgram candidate;
    uint8_t first, second, third;
    engine->unique_minimum_passed = 1;
    memset(&candidate, 0, sizeof(candidate));
    if (r40_add_adapter(engine, &candidate, error, error_capacity) != R0_OK)
        return R0_POLICY_ERROR;
    for (first = 1; first <= R40_ADAPTER_PRIMITIVES; ++first) {
        memset(&candidate, 0, sizeof(candidate));
        candidate.code[0] = first;
        candidate.length = 1;
        if (r40_add_adapter(engine, &candidate, error, error_capacity) != R0_OK)
            return R0_POLICY_ERROR;
    }
    for (first = 1; first <= R40_ADAPTER_PRIMITIVES; ++first) {
        for (second = 1; second <= R40_ADAPTER_PRIMITIVES; ++second) {
            memset(&candidate, 0, sizeof(candidate));
            candidate.code[0] = first;
            candidate.code[1] = second;
            candidate.length = 2;
            if (r40_add_adapter(engine, &candidate, error,
                                error_capacity) != R0_OK)
                return R0_POLICY_ERROR;
        }
    }
    for (first = 1; first <= R40_ADAPTER_PRIMITIVES; ++first) {
        for (second = 1; second <= R40_ADAPTER_PRIMITIVES; ++second) {
            for (third = 1; third <= R40_ADAPTER_PRIMITIVES; ++third) {
                memset(&candidate, 0, sizeof(candidate));
                candidate.code[0] = first;
                candidate.code[1] = second;
                candidate.code[2] = third;
                candidate.length = 3;
                if (r40_add_adapter(engine, &candidate, error,
                                    error_capacity) != R0_OK)
                    return R0_POLICY_ERROR;
            }
        }
    }
    return R0_OK;
}

static uint32_t r40_count_adapters(const R40Engine *engine, uint8_t length)
{
    uint32_t count = 0;
    uint16_t adapter;
    for (adapter = 0; adapter < engine->adapter_count; ++adapter)
        if (engine->adapters[adapter].length == length) ++count;
    return count;
}

static uint8_t r40_certify_adapters(R40Engine *engine)
{
    uint16_t first, second;
    uint32_t counts[R40_MAX_ADAPTER_CODE + 1u] = {0};
    uint8_t inverse_passed = 1;
    engine->canonicalization_passed = 1;
    for (first = 0; first < engine->adapter_count; ++first) {
        uint8_t dimension;
        ++counts[engine->adapters[first].length];
        for (second = (uint16_t)(first + 1u);
             second < engine->adapter_count; ++second)
            if (r40_adapter_equal(&engine->adapters[first],
                                  &engine->adapters[second]))
                engine->canonicalization_passed = 0;
        for (dimension = 4; dimension <= R310_MAX_DIMENSIONS; ++dimension) {
            uint8_t vector;
            for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
                int16_t semantic[R310_MAX_DIMENSIONS];
                int16_t decoded[R310_MAX_DIMENSIONS];
                uint16_t raw[R310_MAX_DIMENSIONS];
                make_pattern(vector, dimension, semantic);
                r40_encode(&engine->adapters[first], semantic, dimension, raw);
                r40_decode(&engine->adapters[first], raw, dimension, decoded);
                if (memcmp(semantic, decoded,
                           dimension * sizeof(semantic[0])) != 0)
                    inverse_passed = 0;
            }
        }
    }
    if (counts[0] != 1 || counts[1] < 4 || counts[2] < 8 || counts[3] < 16)
        engine->unique_minimum_passed = 0;
    engine->grammar_certificate_passed =
        (uint8_t)(engine->canonicalization_passed &&
                  engine->unique_minimum_passed &&
                  inverse_passed &&
                  engine->raw_adapter_programs == 259u);
    return engine->grammar_certificate_passed;
}

static uint8_t r40_certify_frozen_core(R40Engine *engine)
{
    R310ExperimentReport report;
    char error[256] = {0};
    uint16_t program;
    if (r310_run_development(&report, error, sizeof(error)) != R0_OK ||
        report.result_digest != R40_FROZEN_R310_DEVELOPMENT_DIGEST ||
        report.canonical_programs != 52u || report.curriculum_programs != 6u)
        return 0;
    for (program = 0; program < engine->core.program_count; ++program) {
        uint8_t dimension;
        for (dimension = 4; dimension <= R310_MAX_DIMENSIONS; ++dimension) {
            uint8_t vector;
            for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
                int16_t semantic[R310_MAX_DIMENSIONS];
                int16_t zero[R310_MAX_DIMENSIONS] = {0};
                int64_t score;
                make_pattern(vector, dimension, semantic);
                if (!program_score_raw(&engine->core, program, semantic, zero,
                                       dimension, &score) ||
                    score != engine->core.programs[program].scores[vector])
                    return 0;
            }
        }
    }
    return 1;
}

static R0Status r40_build_engine(R40Engine *engine, char *error,
                                 size_t error_capacity)
{
    uint16_t program;
    R0Status status;
    memset(engine, 0, sizeof(*engine));
    status = build_engine(&engine->core, error, error_capacity);
    if (status != R0_OK) return status;
    status = r40_generate_adapters(engine, error, error_capacity);
    if (status != R0_OK) return status;
    if (!r40_certify_adapters(engine)) {
        set_error(error, error_capacity, "adapter grammar certificate failed");
        return R0_POLICY_ERROR;
    }
    for (program = 0; program < engine->core.program_count; ++program) {
        if (engine->core.programs[program].term_count != 1) continue;
        if (engine->familiar_law_count >= R40_FAMILIAR_LAWS) {
            set_error(error, error_capacity, "familiar-law capacity exceeded");
            return R0_POLICY_ERROR;
        }
        engine->familiar_laws[engine->familiar_law_count++] = program;
    }
    engine->frozen_core_passed = r40_certify_frozen_core(engine);
    if (!engine->frozen_core_passed) {
        set_error(error, error_capacity, "frozen Reasoner (3,9) core changed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static uint16_t r40_probe_semantic(uint16_t opaque, uint8_t variant,
                                   uint32_t salt)
{
    static const uint16_t factors[] = {5, 7, 11, 13, 17, 19};
    uint16_t factor = factors[variant %
        (sizeof(factors) / sizeof(factors[0]))];
    uint16_t offset = (uint16_t)(mix32(salt + (uint32_t)variant * 997u) %
                                 R40_ALIGN_QUERY_COUNT);
    return (uint16_t)(((uint32_t)opaque * factor + offset) %
                      R40_ALIGN_QUERY_COUNT);
}

static uint16_t r40_zero_probe(uint8_t variant, uint32_t salt)
{
    uint16_t opaque;
    for (opaque = 0; opaque < R40_ALIGN_QUERY_COUNT; ++opaque)
        if (r40_probe_semantic(opaque, variant, salt) %
                R310_VECTOR_COUNT == 0)
            return opaque;
    return 0;
}

static void r40_make_probe(const R40Engine *engine, uint16_t target_adapter,
                           uint16_t opaque, uint8_t variant, uint32_t salt,
                           uint16_t *raw, int16_t *semantic,
                           uint8_t *dimension)
{
    uint16_t mapped = r40_probe_semantic(opaque, variant, salt);
    uint8_t vector = (uint8_t)(mapped % R310_VECTOR_COUNT);
    *dimension = (uint8_t)(4u + mapped / R310_VECTOR_COUNT);
    make_pattern(vector, *dimension, semantic);
    r40_encode(&engine->adapters[target_adapter], semantic, *dimension, raw);
}

static int r40_prediction_compare(const void *left, const void *right)
{
    const R40Prediction *a = (const R40Prediction *)left;
    const R40Prediction *b = (const R40Prediction *)right;
    uint8_t coordinate;
    for (coordinate = 0; coordinate < R310_MAX_DIMENSIONS; ++coordinate) {
        if (a->values[coordinate] < b->values[coordinate]) return -1;
        if (a->values[coordinate] > b->values[coordinate]) return 1;
    }
    return 0;
}

static uint16_t r40_remaining_adapters(const uint8_t *consistent,
                                       uint16_t adapter_count)
{
    uint16_t count = 0;
    uint16_t adapter;
    for (adapter = 0; adapter < adapter_count; ++adapter)
        count = (uint16_t)(count + (consistent[adapter] != 0));
    return count;
}

static uint16_t r40_first_adapter(const uint8_t *consistent,
                                  uint16_t adapter_count)
{
    uint16_t adapter;
    for (adapter = 0; adapter < adapter_count; ++adapter)
        if (consistent[adapter]) return adapter;
    return UINT16_MAX;
}

static uint16_t r40_curriculum_adapter(const R40Engine *engine,
                                       const uint8_t *consistent)
{
    uint16_t adapter;
    for (adapter = 0; adapter < engine->adapter_count; ++adapter)
        if (consistent[adapter] && engine->adapters[adapter].length <= 1u)
            return adapter;
    return 0;
}

static void r40_filter_adapters(const R40Engine *engine, uint8_t *consistent,
                                const uint16_t *raw, const int16_t *response,
                                uint8_t dimension)
{
    uint16_t adapter;
    for (adapter = 0; adapter < engine->adapter_count; ++adapter) {
        int16_t decoded[R310_MAX_DIMENSIONS] = {0};
        if (!consistent[adapter]) continue;
        r40_decode(&engine->adapters[adapter], raw, dimension, decoded);
        if (memcmp(decoded, response,
                   dimension * sizeof(decoded[0])) != 0)
            consistent[adapter] = 0;
    }
}

static uint16_t r40_choose_alignment(const R40Engine *engine,
                                     uint16_t target_adapter,
                                     const uint8_t *consistent,
                                     const uint8_t *used, uint8_t variant,
                                     uint32_t salt)
{
    R40Prediction predictions[R40_MAX_ADAPTER_PROGRAMS];
    uint16_t best = UINT16_MAX;
    uint16_t best_largest = UINT16_MAX;
    uint16_t opaque;
    for (opaque = 0; opaque < R40_ALIGN_QUERY_COUNT; ++opaque) {
        uint16_t raw[R310_MAX_DIMENSIONS];
        int16_t semantic[R310_MAX_DIMENSIONS];
        uint8_t dimension;
        uint16_t count = 0;
        uint16_t adapter;
        uint16_t largest = 0;
        uint16_t start;
        if (used[opaque]) continue;
        r40_make_probe(engine, target_adapter, opaque, variant, salt, raw,
                       semantic, &dimension);
        for (adapter = 0; adapter < engine->adapter_count; ++adapter) {
            if (!consistent[adapter]) continue;
            memset(&predictions[count], 0, sizeof(predictions[count]));
            r40_decode(&engine->adapters[adapter], raw, dimension,
                       predictions[count].values);
            ++count;
        }
        qsort(predictions, count, sizeof(predictions[0]),
              r40_prediction_compare);
        for (start = 0; start < count;) {
            uint16_t end = (uint16_t)(start + 1u);
            while (end < count &&
                   r40_prediction_compare(&predictions[start],
                                          &predictions[end]) == 0)
                ++end;
            if ((uint16_t)(end - start) > largest)
                largest = (uint16_t)(end - start);
            start = end;
        }
        if (largest < best_largest) {
            best_largest = largest;
            best = opaque;
        }
    }
    return best;
}

static uint8_t r40_raw_equal(const uint16_t *left, const uint16_t *right,
                             uint8_t dimension)
{
    return (uint8_t)(memcmp(left, right,
                            dimension * sizeof(left[0])) == 0);
}

static int8_t r40_score_comparison(const R40Engine *engine, uint16_t law,
                                   const int16_t *left,
                                   const int16_t *right, uint8_t dimension)
{
    int16_t zero[R310_MAX_DIMENSIONS] = {0};
    int64_t left_score = 0, right_score = 0;
    if (!program_score_raw(&engine->core, law, left, zero, dimension,
                           &left_score) ||
        !program_score_raw(&engine->core, law, right, zero, dimension,
                           &right_score))
        return 2;
    return compare_i64(left_score, right_score);
}

static void r40_filter_laws(const R40Engine *engine, uint8_t *consistent,
                            uint16_t selected_adapter,
                            uint16_t target_adapter, uint16_t query,
                            uint8_t dimension, int8_t observed)
{
    int16_t left_semantic[R310_MAX_DIMENSIONS];
    int16_t right_semantic[R310_MAX_DIMENSIONS];
    int16_t left_decoded[R310_MAX_DIMENSIONS];
    int16_t right_decoded[R310_MAX_DIMENSIONS];
    uint16_t left_raw[R310_MAX_DIMENSIONS];
    uint16_t right_raw[R310_MAX_DIMENSIONS];
    uint16_t law;
    make_pattern(engine->core.query_left[query], dimension, left_semantic);
    make_pattern(engine->core.query_right[query], dimension, right_semantic);
    r40_encode(&engine->adapters[target_adapter], left_semantic, dimension,
               left_raw);
    r40_encode(&engine->adapters[target_adapter], right_semantic, dimension,
               right_raw);
    r40_decode(&engine->adapters[selected_adapter], left_raw, dimension,
               left_decoded);
    r40_decode(&engine->adapters[selected_adapter], right_raw, dimension,
               right_decoded);
    for (law = 0; law < engine->core.program_count; ++law) {
        int8_t predicted;
        if (!consistent[law]) continue;
        predicted = r40_score_comparison(engine, law, left_decoded,
                                         right_decoded, dimension);
        if (predicted != observed) consistent[law] = 0;
    }
}

static int8_t r40_active_outcome(const R40Engine *engine,
                                 uint16_t selected_adapter,
                                 uint16_t target_adapter,
                                 uint16_t target_law, uint16_t query,
                                 uint8_t dimension, uint8_t *exact_request)
{
    int16_t left_semantic[R310_MAX_DIMENSIONS];
    int16_t right_semantic[R310_MAX_DIMENSIONS];
    int16_t left_received[R310_MAX_DIMENSIONS];
    int16_t right_received[R310_MAX_DIMENSIONS];
    uint16_t left_request[R310_MAX_DIMENSIONS];
    uint16_t right_request[R310_MAX_DIMENSIONS];
    uint16_t left_expected[R310_MAX_DIMENSIONS];
    uint16_t right_expected[R310_MAX_DIMENSIONS];
    make_pattern(engine->core.query_left[query], dimension, left_semantic);
    make_pattern(engine->core.query_right[query], dimension, right_semantic);
    r40_encode(&engine->adapters[selected_adapter], left_semantic, dimension,
               left_request);
    r40_encode(&engine->adapters[selected_adapter], right_semantic, dimension,
               right_request);
    r40_encode(&engine->adapters[target_adapter], left_semantic, dimension,
               left_expected);
    r40_encode(&engine->adapters[target_adapter], right_semantic, dimension,
               right_expected);
    *exact_request = (uint8_t)(r40_raw_equal(left_request, left_expected,
                                             dimension) &&
                               r40_raw_equal(right_request, right_expected,
                                             dimension));
    r40_decode(&engine->adapters[target_adapter], left_request, dimension,
               left_received);
    r40_decode(&engine->adapters[target_adapter], right_request, dimension,
               right_received);
    return r40_score_comparison(engine, target_law, left_received,
                                right_received, dimension);
}

static uint8_t r40_choose_raw_action(const R40Engine *engine,
                                     uint16_t selected_adapter,
                                     uint16_t target_adapter,
                                     uint16_t selected_law,
                                     const uint8_t *vectors,
                                     uint8_t dimension)
{
    int64_t best_score = INT64_MAX;
    uint8_t best = UINT8_MAX;
    uint8_t candidate;
    for (candidate = 0; candidate < R310_ACTION_CANDIDATES; ++candidate) {
        int16_t semantic[R310_MAX_DIMENSIONS];
        int16_t decoded[R310_MAX_DIMENSIONS];
        int16_t zero[R310_MAX_DIMENSIONS] = {0};
        uint16_t raw[R310_MAX_DIMENSIONS];
        int64_t score;
        make_pattern(vectors[candidate], dimension, semantic);
        r40_encode(&engine->adapters[target_adapter], semantic, dimension, raw);
        r40_decode(&engine->adapters[selected_adapter], raw, dimension,
                   decoded);
        if (!program_score_raw(&engine->core, selected_law, decoded, zero,
                               dimension, &score))
            continue;
        if (best == UINT8_MAX || score < best_score ||
            (score == best_score && candidate < best)) {
            best = candidate;
            best_score = score;
        }
    }
    return best;
}

static uint8_t r40_choose_semantic_action(const R40Engine *engine,
                                          uint16_t law,
                                          const uint8_t *vectors)
{
    int64_t best_score = INT64_MAX;
    uint8_t best = UINT8_MAX;
    uint8_t candidate;
    for (candidate = 0; candidate < R310_ACTION_CANDIDATES; ++candidate) {
        int64_t score = engine->core.programs[law].scores[vectors[candidate]];
        if (best == UINT8_MAX || score < best_score ||
            (score == best_score && candidate < best)) {
            best = candidate;
            best_score = score;
        }
    }
    return best;
}

static const char *r40_adapter_name(uint8_t operation)
{
    switch (operation) {
    case R40_ADAPTER_REVERSE: return "reverse";
    case R40_ADAPTER_ROTATE_LEFT: return "rotate-left";
    case R40_ADAPTER_PREFIX_SUM: return "prefix-sum";
    case R40_ADAPTER_PAIR_SHEAR: return "pair-shear";
    case R40_ADAPTER_ADD_17: return "add-17";
    case R40_ADAPTER_MULTIPLY_3: return "multiply-3";
    default: return "identity";
    }
}

static uint8_t r40_render_adapter(const R40AdapterProgram *adapter,
                                  char *output, size_t capacity)
{
    size_t used = 0;
    uint8_t index;
    if (capacity == 0) return 0;
    if (adapter->length == 0)
        return (uint8_t)(snprintf(output, capacity, "identity") > 0);
    output[0] = '\0';
    for (index = 0; index < adapter->length; ++index) {
        int written = snprintf(output + used, capacity - used, "%s%s",
            index == 0 ? "" : "|", r40_adapter_name(adapter->code[index]));
        if (written < 0 || (size_t)written >= capacity - used) return 0;
        used += (size_t)written;
    }
    return 1;
}

static void r40_evaluate_episode(const R40Engine *engine,
                                 uint16_t target_adapter,
                                 uint16_t target_law, uint8_t dimension,
                                 uint8_t variant, uint32_t salt,
                                 R40Control control,
                                 R40Evaluation *evaluation)
{
    uint8_t adapter_consistent[R40_MAX_ADAPTER_PROGRAMS];
    uint8_t align_used[R40_ALIGN_QUERY_COUNT];
    uint8_t law_consistent[R310_MAX_PROGRAMS];
    uint8_t law_used[R310_QUERY_COUNT];
    uint16_t adapter_remaining;
    uint16_t selected_adapter = UINT16_MAX;
    uint16_t law_remaining;
    uint16_t selected_law = UINT16_MAX;
    uint32_t adapter_steps = 0;
    uint32_t law_steps = 0;
    uint8_t all_actions_exact = 1;
    uint8_t replay_exact = 1;
    uint16_t initial_alignment;
    uint8_t demonstration;
    memset(adapter_consistent, 1, engine->adapter_count);
    memset(align_used, 0, sizeof(align_used));
    memset(law_consistent, 0, sizeof(law_consistent));
    memset(law_used, 0, sizeof(law_used));
    ++evaluation->episodes;

    initial_alignment = r40_zero_probe(variant, salt);
    {
        uint16_t raw[R310_MAX_DIMENSIONS];
        int16_t response[R310_MAX_DIMENSIONS];
        uint8_t response_dimension;
        r40_make_probe(engine, target_adapter, initial_alignment, variant,
                       salt, raw, response, &response_dimension);
        align_used[initial_alignment] = 1;
        r40_filter_adapters(engine, adapter_consistent, raw, response,
                            response_dimension);
        ++evaluation->alignment_demonstrations;
    }
    adapter_remaining = r40_remaining_adapters(adapter_consistent,
                                               engine->adapter_count);
    if (control == R40_CONTROL_MODEL ||
        control == R40_CONTROL_SHUFFLED_ALIGNMENT) {
        while (adapter_remaining > 1 &&
               adapter_steps < R40_MAX_ALIGN_QUERIES) {
            uint16_t query = r40_choose_alignment(engine, target_adapter,
                adapter_consistent, align_used, variant, salt);
            uint16_t raw[R310_MAX_DIMENSIONS];
            int16_t response[R310_MAX_DIMENSIONS];
            uint8_t response_dimension;
            if (query == UINT16_MAX) break;
            align_used[query] = 1;
            r40_make_probe(engine, target_adapter, query, variant, salt, raw,
                           response, &response_dimension);
            if (control == R40_CONTROL_SHUFFLED_ALIGNMENT) {
                uint16_t shifted = (uint16_t)((query + 37u) %
                                              R40_ALIGN_QUERY_COUNT);
                uint16_t ignored_raw[R310_MAX_DIMENSIONS];
                r40_make_probe(engine, target_adapter, shifted, variant, salt,
                               ignored_raw, response, &response_dimension);
            }
            ++evaluation->adapter_queries;
            ++evaluation->exact_adapter_queries;
            r40_filter_adapters(engine, adapter_consistent, raw, response,
                                response_dimension);
            adapter_remaining = r40_remaining_adapters(adapter_consistent,
                                                       engine->adapter_count);
            ++adapter_steps;
        }
    }
    if (adapter_steps > evaluation->maximum_adapter_queries)
        evaluation->maximum_adapter_queries = adapter_steps;
    switch (control) {
    case R40_CONTROL_ORACLE_ADAPTER:
        selected_adapter = target_adapter;
        adapter_remaining = 1;
        break;
    case R40_CONTROL_IDENTITY_ADAPTER:
        selected_adapter = 0;
        break;
    case R40_CONTROL_CURRICULUM_LOOKUP:
        selected_adapter = r40_curriculum_adapter(engine,
                                                  adapter_consistent);
        break;
    case R40_CONTROL_MODEL:
    case R40_CONTROL_NO_ADAPTER_QUERY:
    case R40_CONTROL_SHUFFLED_ALIGNMENT:
        selected_adapter = r40_first_adapter(adapter_consistent,
                                             engine->adapter_count);
        break;
    }
    ++evaluation->adapter_identifications;
    if (adapter_remaining == 1 && selected_adapter == target_adapter)
        ++evaluation->exact_adapter_identifications;

    if (selected_adapter != UINT16_MAX) {
        uint16_t opaque;
        for (opaque = 0; opaque < R40_ALIGN_QUERY_COUNT; ++opaque) {
            uint16_t raw[R310_MAX_DIMENSIONS];
            int16_t semantic[R310_MAX_DIMENSIONS];
            int16_t decoded[R310_MAX_DIMENSIONS];
            uint8_t replay_dimension;
            r40_make_probe(engine, target_adapter, opaque, variant, salt, raw,
                           semantic, &replay_dimension);
            r40_decode(&engine->adapters[selected_adapter], raw,
                       replay_dimension, decoded);
            ++evaluation->replay_checks;
            if (memcmp(semantic, decoded,
                       replay_dimension * sizeof(semantic[0])) == 0)
                ++evaluation->exact_replays;
            else
                replay_exact = 0;
        }
    } else {
        replay_exact = 0;
    }

    {
        uint8_t law_index;
        for (law_index = 0; law_index < engine->familiar_law_count;
             ++law_index)
            law_consistent[engine->familiar_laws[law_index]] = 1;
    }
    for (demonstration = 0; demonstration < R310_INITIAL_DEMOS;
         ++demonstration) {
        uint16_t query = (uint16_t)(mix32(
            salt + (uint32_t)variant * 409u +
            (uint32_t)demonstration * 811u) % R310_QUERY_COUNT);
        int8_t observed;
        while (law_used[query])
            query = (uint16_t)((query + 1u) % R310_QUERY_COUNT);
        law_used[query] = 1;
        observed = engine->core.outcomes[target_law][query];
        if (selected_adapter != UINT16_MAX)
            r40_filter_laws(engine, law_consistent, selected_adapter,
                            target_adapter, query, dimension, observed);
        ++evaluation->law_demonstrations;
    }
    law_remaining = consistent_count(law_consistent,
                                     engine->core.program_count);
    while (law_remaining > 1 && law_steps < 64u &&
           selected_adapter != UINT16_MAX) {
        uint16_t query = choose_query(&engine->core, law_consistent, law_used);
        int8_t observed;
        uint8_t exact_request = 0;
        if (query == UINT16_MAX) break;
        law_used[query] = 1;
        observed = r40_active_outcome(engine, selected_adapter,
            target_adapter, target_law, query, dimension, &exact_request);
        ++evaluation->law_queries;
        if (exact_request) ++evaluation->exact_law_queries;
        filter_programs(&engine->core, law_consistent, query, observed);
        law_remaining = consistent_count(law_consistent,
                                         engine->core.program_count);
        ++law_steps;
    }
    if (law_steps > evaluation->maximum_law_queries)
        evaluation->maximum_law_queries = law_steps;
    selected_law = first_consistent(law_consistent,
                                    engine->core.program_count);
    ++evaluation->law_identifications;
    if (law_remaining == 1 && selected_law == target_law)
        ++evaluation->exact_law_identifications;

    {
        uint8_t action_case;
        for (action_case = 0; action_case < R310_ACTION_CASES;
             ++action_case) {
            uint8_t vectors[R310_ACTION_CANDIDATES];
            uint8_t predicted = UINT8_MAX;
            uint8_t expected;
            make_action_vectors(action_case, variant, salt, vectors);
            expected = r40_choose_semantic_action(engine, target_law, vectors);
            if (selected_adapter != UINT16_MAX && selected_law != UINT16_MAX)
                predicted = r40_choose_raw_action(engine, selected_adapter,
                    target_adapter, selected_law, vectors, dimension);
            ++evaluation->actions;
            if (predicted == expected)
                ++evaluation->exact_actions;
            else
                all_actions_exact = 0;
        }
    }
    ++evaluation->commits;
    if (adapter_remaining > 1 || law_remaining > 1)
        ++evaluation->premature_commits;
    if (adapter_remaining == 1 && law_remaining == 1 &&
        selected_adapter == target_adapter && selected_law == target_law &&
        replay_exact && all_actions_exact)
        ++evaluation->exact_commits;
    ++evaluation->reports;
    if (selected_adapter != UINT16_MAX && selected_law != UINT16_MAX) {
        char selected_adapter_text[128];
        char target_adapter_text[128];
        char selected_law_text[R310_MAX_REPORT_TEXT];
        char target_law_text[R310_MAX_REPORT_TEXT];
        if (r40_render_adapter(&engine->adapters[selected_adapter],
                               selected_adapter_text,
                               sizeof(selected_adapter_text)) &&
            r40_render_adapter(&engine->adapters[target_adapter],
                               target_adapter_text,
                               sizeof(target_adapter_text)) &&
            render_program(&engine->core, selected_law, selected_law_text) &&
            render_program(&engine->core, target_law, target_law_text) &&
            strcmp(selected_adapter_text, target_adapter_text) == 0 &&
            strcmp(selected_law_text, target_law_text) == 0)
            ++evaluation->exact_reports;
    }
}

static void r40_finish_evaluation(R40Evaluation *evaluation)
{
    evaluation->exact = (uint8_t)(
        evaluation->episodes > 0 &&
        evaluation->adapter_identifications == evaluation->episodes &&
        evaluation->exact_adapter_identifications == evaluation->episodes &&
        evaluation->replay_checks == evaluation->exact_replays &&
        evaluation->law_identifications == evaluation->episodes &&
        evaluation->exact_law_identifications == evaluation->episodes &&
        evaluation->adapter_queries == evaluation->exact_adapter_queries &&
        evaluation->law_queries == evaluation->exact_law_queries &&
        evaluation->actions == evaluation->episodes * R310_ACTION_CASES &&
        evaluation->actions == evaluation->exact_actions &&
        evaluation->commits == evaluation->episodes &&
        evaluation->commits == evaluation->exact_commits &&
        evaluation->reports == evaluation->episodes &&
        evaluation->reports == evaluation->exact_reports &&
        evaluation->premature_commits == 0);
}

static void r40_evaluate_split(const R40Engine *engine,
                               uint8_t adapter_length,
                               uint8_t minimum_dimension,
                               uint8_t maximum_dimension, uint8_t variants,
                               uint32_t salt, R40Control control,
                               R40Evaluation *evaluation)
{
    uint16_t adapter;
    memset(evaluation, 0, sizeof(*evaluation));
    evaluation->target_adapters = r40_count_adapters(engine, adapter_length);
    evaluation->target_laws = engine->familiar_law_count;
    for (adapter = 0; adapter < engine->adapter_count; ++adapter) {
        uint8_t law_index;
        if (engine->adapters[adapter].length != adapter_length) continue;
        for (law_index = 0; law_index < engine->familiar_law_count;
             ++law_index) {
            uint8_t dimension;
            for (dimension = minimum_dimension;
                 dimension <= maximum_dimension; ++dimension) {
                uint8_t variant;
                for (variant = 0; variant < variants; ++variant)
                    r40_evaluate_episode(engine, adapter,
                        engine->familiar_laws[law_index], dimension, variant,
                        salt, control, evaluation);
            }
        }
    }
    r40_finish_evaluation(evaluation);
}

static uint64_t r40_digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte)
        hash = r40_digest_byte(hash, (uint8_t)(value >> (8u * byte)));
    return hash;
}

static uint64_t r40_digest_evaluation(uint64_t hash,
                                      const R40Evaluation *evaluation)
{
    hash = r40_digest_u64(hash, evaluation->episodes);
    hash = r40_digest_u64(hash, evaluation->target_adapters);
    hash = r40_digest_u64(hash, evaluation->target_laws);
    hash = r40_digest_u64(hash, evaluation->alignment_demonstrations);
    hash = r40_digest_u64(hash, evaluation->adapter_queries);
    hash = r40_digest_u64(hash, evaluation->exact_adapter_queries);
    hash = r40_digest_u64(hash, evaluation->exact_adapter_identifications);
    hash = r40_digest_u64(hash, evaluation->replay_checks);
    hash = r40_digest_u64(hash, evaluation->exact_replays);
    hash = r40_digest_u64(hash, evaluation->law_queries);
    hash = r40_digest_u64(hash, evaluation->exact_law_queries);
    hash = r40_digest_u64(hash, evaluation->exact_law_identifications);
    hash = r40_digest_u64(hash, evaluation->exact_actions);
    hash = r40_digest_u64(hash, evaluation->exact_commits);
    hash = r40_digest_u64(hash, evaluation->exact_reports);
    hash = r40_digest_u64(hash, evaluation->premature_commits);
    hash = r40_digest_u64(hash, evaluation->maximum_adapter_queries);
    hash = r40_digest_u64(hash, evaluation->maximum_law_queries);
    return r40_digest_u64(hash, evaluation->exact);
}

static uint64_t r40_experiment_digest(const R40ExperimentReport *report)
{
    uint64_t hash = R40_FNV_OFFSET;
    hash = r40_digest_u64(hash, report->raw_adapter_programs);
    hash = r40_digest_u64(hash, report->canonical_adapter_programs);
    hash = r40_digest_u64(hash, report->identity_adapters);
    hash = r40_digest_u64(hash, report->curriculum_adapters);
    hash = r40_digest_u64(hash, report->development_adapters);
    hash = r40_digest_u64(hash, report->sealed_adapters);
    hash = r40_digest_u64(hash, report->frozen_core_programs);
    hash = r40_digest_u64(hash, report->familiar_laws);
    hash = r40_digest_u64(hash, report->planned_sealed_episodes);
    hash = r40_digest_u64(hash, report->adapter_canonicalization_passed);
    hash = r40_digest_u64(hash, report->adapter_unique_minimum_passed);
    hash = r40_digest_u64(hash, report->adapter_grammar_certificate_passed);
    hash = r40_digest_u64(hash, report->frozen_core_certificate_passed);
    hash = r40_digest_u64(hash, report->oracle_adapter_control_passed);
    hash = r40_digest_u64(hash, report->identity_adapter_control_passed);
    hash = r40_digest_u64(hash, report->curriculum_lookup_control_passed);
    hash = r40_digest_u64(hash, report->no_adapter_query_control_passed);
    hash = r40_digest_u64(hash, report->shuffled_alignment_control_passed);
    hash = r40_digest_evaluation(hash, &report->curriculum);
    hash = r40_digest_evaluation(hash, &report->development);
    hash = r40_digest_u64(hash, report->development_gate_passed);
    return r40_digest_u64(hash, report->sealed_execution_locked);
}

R0Status r40_run_development(R40ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R40Engine engine;
    R40Evaluation control;
    R0Status status;
    if (report == NULL) {
        set_error(error, error_capacity, "report is required");
        return R0_INVALID_ARGUMENT;
    }
    memset(report, 0, sizeof(*report));
    status = r40_build_engine(&engine, error, error_capacity);
    if (status != R0_OK) return status;
    report->raw_adapter_programs = engine.raw_adapter_programs;
    report->canonical_adapter_programs = engine.adapter_count;
    report->identity_adapters = r40_count_adapters(&engine, 0);
    report->curriculum_adapters = r40_count_adapters(&engine, 1);
    report->development_adapters = r40_count_adapters(&engine, 2);
    report->sealed_adapters = r40_count_adapters(&engine, 3);
    report->frozen_core_programs = engine.core.program_count;
    report->familiar_laws = engine.familiar_law_count;
    report->planned_sealed_episodes =
        report->sealed_adapters * report->familiar_laws * 4u * 2u;
    report->adapter_canonicalization_passed =
        engine.canonicalization_passed;
    report->adapter_unique_minimum_passed = engine.unique_minimum_passed;
    report->adapter_grammar_certificate_passed =
        engine.grammar_certificate_passed;
    report->frozen_core_certificate_passed = engine.frozen_core_passed;
    report->sealed_execution_locked = 1;
    r40_evaluate_split(&engine, 1, 4, 4, 2, UINT32_C(0x4000a11),
                       R40_CONTROL_MODEL, &report->curriculum);
    r40_evaluate_split(&engine, 2, 5, 8, 2, UINT32_C(0x4000b22),
                       R40_CONTROL_MODEL, &report->development);
    r40_evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x4000c33),
                       R40_CONTROL_ORACLE_ADAPTER, &control);
    report->oracle_adapter_control_passed = control.exact;
    r40_evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x4000c33),
                       R40_CONTROL_IDENTITY_ADAPTER, &control);
    report->identity_adapter_control_passed = control.exact;
    r40_evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x4000c33),
                       R40_CONTROL_CURRICULUM_LOOKUP, &control);
    report->curriculum_lookup_control_passed = control.exact;
    r40_evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x4000c33),
                       R40_CONTROL_NO_ADAPTER_QUERY, &control);
    report->no_adapter_query_control_passed = control.exact;
    r40_evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x4000c33),
                       R40_CONTROL_SHUFFLED_ALIGNMENT, &control);
    report->shuffled_alignment_control_passed = control.exact;
    report->development_gate_passed = (uint8_t)(
        report->adapter_canonicalization_passed &&
        report->adapter_unique_minimum_passed &&
        report->adapter_grammar_certificate_passed &&
        report->frozen_core_certificate_passed &&
        report->curriculum.exact && report->development.exact &&
        report->oracle_adapter_control_passed &&
        !report->identity_adapter_control_passed &&
        !report->curriculum_lookup_control_passed &&
        !report->no_adapter_query_control_passed &&
        !report->shuffled_alignment_control_passed &&
        report->sealed_execution_locked);
    report->result_digest = r40_experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "active representation development gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r40_run_sealed(R40ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    (void)report;
    set_error(error, error_capacity,
              "Reasoner 4.0 sealed execution is locked and unauthorized");
    return R0_POLICY_ERROR;
}
