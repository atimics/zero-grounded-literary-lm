#include "reasoner310.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R310_FNV_OFFSET UINT64_C(1469598103934665603)
#define R310_FNV_PRIME UINT64_C(1099511628211)

typedef enum {
    R310_OP_CANDIDATE = 1,
    R310_OP_GOAL = 2,
    R310_OP_SUBTRACT = 3,
    R310_OP_ABSOLUTE = 4,
    R310_OP_MULTIPLY = 5,
    R310_OP_NONZERO = 6
} R310Op;

typedef enum {
    R310_REDUCE_SUM = 1,
    R310_REDUCE_MAXIMUM = 2
} R310Reducer;

typedef enum {
    R310_CONTROL_MODEL = 0,
    R310_CONTROL_FIXED_QUADRATIC = 1,
    R310_CONTROL_CURRICULUM_LOOKUP = 2,
    R310_CONTROL_NO_QUERY = 3,
    R310_CONTROL_SHUFFLED_FEEDBACK = 4,
    R310_CONTROL_COEFFICIENT_ONLY = 5
} R310Control;

typedef struct {
    uint8_t code[R310_MAX_POINT_CODE];
    uint8_t length;
    int64_t signature[9];
} R310PointProgram;

typedef struct {
    R310PointProgram point;
    uint8_t reducer;
    uint16_t description_length;
    int64_t scores[R310_VECTOR_COUNT];
} R310FoldProgram;

typedef struct {
    uint8_t fold_indices[3];
    uint8_t term_count;
    uint16_t description_length;
    int64_t scores[R310_VECTOR_COUNT];
} R310Program;

typedef struct {
    R310PointProgram points[R310_MAX_POINT_PROGRAMS];
    R310FoldProgram folds[R310_MAX_FOLDS];
    R310Program programs[R310_MAX_PROGRAMS];
    int8_t outcomes[R310_MAX_PROGRAMS][R310_QUERY_COUNT];
    uint8_t query_left[R310_QUERY_COUNT];
    uint8_t query_right[R310_QUERY_COUNT];
    uint16_t point_count;
    uint16_t fold_count;
    uint16_t program_count;
    uint16_t quadratic_program;
    uint32_t raw_point_programs;
    uint32_t raw_fold_programs;
    uint32_t raw_aggregate_programs;
    uint8_t canonicalization_passed;
    uint8_t unique_minimum_passed;
    uint8_t grammar_certificate_passed;
} R310Engine;

typedef struct {
    R310Tool tool;
    uint16_t argument;
} R310Call;

static const int16_t vector_patterns[R310_VECTOR_COUNT][4] = {
    {0, 0, 0, 0}, {1, 0, 0, 0}, {2, 0, 0, 0}, {3, 0, 0, 0},
    {4, 0, 0, 0}, {1, 1, 0, 0}, {2, 1, 0, 0}, {2, 2, 0, 0},
    {3, 1, 0, 0}, {3, 2, 0, 0}, {3, 3, 0, 0}, {4, 1, 0, 0},
    {4, 2, 0, 0}, {4, 3, 0, 0}, {4, 4, 0, 0}, {1, 1, 1, 0},
    {2, 1, 1, 0}, {2, 2, 1, 0}, {2, 2, 2, 0}, {3, 1, 1, 0},
    {3, 2, 1, 0}, {3, 2, 2, 0}, {3, 3, 1, 0}, {4, 1, 1, 0},
    {1, 1, 1, 1}, {2, 1, 1, 1}, {2, 2, 1, 1}, {2, 2, 2, 1},
    {2, 2, 2, 2}, {3, 2, 1, 1}, {4, 2, 1, 1}, {4, 3, 2, 1}
};

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static int8_t compare_i64(int64_t left, int64_t right)
{
    return (int8_t)((left > right) - (left < right));
}

static int code_compare(const uint8_t *left, uint8_t left_length,
                        const uint8_t *right, uint8_t right_length)
{
    uint8_t common = left_length < right_length ? left_length : right_length;
    int compared = memcmp(left, right, common);
    if (compared != 0) return compared;
    return (int)left_length - (int)right_length;
}

static uint8_t evaluate_point_code(const uint8_t *code, uint8_t length,
                                   int64_t candidate, int64_t goal,
                                   int64_t *result)
{
    int64_t stack[R310_MAX_POINT_CODE];
    uint8_t depth = 0;
    uint8_t index;
    for (index = 0; index < length; ++index) {
        int64_t left, right;
        switch ((R310Op)code[index]) {
        case R310_OP_CANDIDATE:
            stack[depth++] = candidate;
            break;
        case R310_OP_GOAL:
            stack[depth++] = goal;
            break;
        case R310_OP_SUBTRACT:
            if (depth < 2) return 0;
            right = stack[--depth];
            left = stack[--depth];
            stack[depth++] = left - right;
            break;
        case R310_OP_ABSOLUTE:
            if (depth < 1 || stack[depth - 1] == INT64_MIN) return 0;
            if (stack[depth - 1] < 0) stack[depth - 1] = -stack[depth - 1];
            break;
        case R310_OP_MULTIPLY:
            if (depth < 2) return 0;
            right = stack[--depth];
            left = stack[--depth];
            if (left != 0 &&
                (right > INT32_MAX / (left > 0 ? left : -left) ||
                 right < -INT32_MAX / (left > 0 ? left : -left)))
                return 0;
            stack[depth++] = left * right;
            break;
        case R310_OP_NONZERO:
            if (depth < 1) return 0;
            stack[depth - 1] = stack[depth - 1] != 0;
            break;
        default:
            return 0;
        }
        if (depth >= R310_MAX_POINT_CODE) return 0;
    }
    if (depth != 1) return 0;
    *result = stack[0];
    return 1;
}

static uint8_t fill_point_signature(R310PointProgram *program)
{
    int delta;
    for (delta = -4; delta <= 4; ++delta) {
        if (!evaluate_point_code(program->code, program->length,
                                 delta, 0,
                                 &program->signature[delta + 4]))
            return 0;
    }
    return 1;
}

static uint8_t translation_invariant(const R310PointProgram *program)
{
    int candidate, goal, translation;
    for (candidate = -2; candidate <= 2; ++candidate) {
        for (goal = -2; goal <= 2; ++goal) {
            int64_t base;
            if (!evaluate_point_code(program->code, program->length,
                                     candidate, goal, &base))
                return 0;
            for (translation = -2; translation <= 2; ++translation) {
                int64_t moved;
                if (!evaluate_point_code(program->code, program->length,
                                         candidate + translation,
                                         goal + translation, &moved) ||
                    moved != base)
                    return 0;
            }
        }
    }
    return 1;
}

static uint8_t point_target_certificate(const R310PointProgram *program)
{
    uint8_t nonzero = 0;
    int delta;
    if (program->signature[4] != 0) return 0;
    for (delta = 1; delta <= 4; ++delta) {
        int64_t positive = program->signature[delta + 4];
        int64_t negative = program->signature[4 - delta];
        if (positive < 0 || positive != negative) return 0;
        if (positive != 0) nonzero = 1;
    }
    return nonzero;
}

static int point_quality_compare(const R310PointProgram *left,
                                 const R310PointProgram *right)
{
    if (left->length != right->length)
        return (int)left->length - (int)right->length;
    return code_compare(left->code, left->length,
                        right->code, right->length);
}

static int add_point(R310Engine *engine, const R310PointProgram *candidate,
                     uint8_t *changed)
{
    uint16_t index;
    for (index = 0; index < engine->point_count; ++index) {
        if (memcmp(engine->points[index].signature,
                   candidate->signature, sizeof(candidate->signature)) == 0) {
            if (point_quality_compare(candidate, &engine->points[index]) < 0) {
                engine->points[index] = *candidate;
                *changed = 1;
            }
            return 1;
        }
    }
    if (engine->point_count >= R310_MAX_POINT_PROGRAMS) return 0;
    engine->points[engine->point_count++] = *candidate;
    *changed = 1;
    return 1;
}

static uint8_t make_unary_point(const R310PointProgram *source, R310Op op,
                                R310PointProgram *candidate)
{
    if ((uint8_t)(source->length + 1u) > R310_MAX_POINT_CODE) return 0;
    memset(candidate, 0, sizeof(*candidate));
    memcpy(candidate->code, source->code, source->length);
    candidate->code[source->length] = (uint8_t)op;
    candidate->length = (uint8_t)(source->length + 1u);
    return fill_point_signature(candidate);
}

static uint8_t make_multiply_point(const R310PointProgram *left,
                                   const R310PointProgram *right,
                                   R310PointProgram *candidate)
{
    const R310PointProgram *first = left;
    const R310PointProgram *second = right;
    uint8_t length = (uint8_t)(left->length + right->length + 1u);
    if (length > R310_MAX_POINT_CODE) return 0;
    if (code_compare(first->code, first->length,
                     second->code, second->length) > 0) {
        first = right;
        second = left;
    }
    memset(candidate, 0, sizeof(*candidate));
    memcpy(candidate->code, first->code, first->length);
    memcpy(candidate->code + first->length,
           second->code, second->length);
    candidate->code[length - 1u] = R310_OP_MULTIPLY;
    candidate->length = length;
    return fill_point_signature(candidate);
}

static R0Status generate_points(R310Engine *engine, char *error,
                                size_t error_capacity)
{
    const uint8_t roots[2] = {R310_OP_CANDIDATE, R310_OP_GOAL};
    uint8_t left, right;
    uint8_t changed = 1;
    for (left = 0; left < 2; ++left) {
        R310PointProgram load;
        memset(&load, 0, sizeof(load));
        load.code[0] = roots[left];
        load.length = 1;
        ++engine->raw_point_programs;
    }
    for (left = 0; left < 2; ++left) {
        for (right = 0; right < 2; ++right) {
            R310PointProgram candidate;
            memset(&candidate, 0, sizeof(candidate));
            candidate.code[0] = roots[left];
            candidate.code[1] = roots[right];
            candidate.code[2] = R310_OP_SUBTRACT;
            candidate.length = 3;
            ++engine->raw_point_programs;
            if (!fill_point_signature(&candidate)) continue;
            if (!translation_invariant(&candidate)) continue;
            if (memcmp(candidate.signature,
                       (int64_t[9]){0}, sizeof(candidate.signature)) == 0)
                continue;
            if (!add_point(engine, &candidate, &changed)) {
                set_error(error, error_capacity, "point grammar exceeded capacity");
                return R0_LIMIT_ERROR;
            }
        }
    }
    while (changed) {
        uint16_t snapshot = engine->point_count;
        uint16_t first, second;
        changed = 0;
        for (first = 0; first < snapshot; ++first) {
            R310PointProgram candidate;
            ++engine->raw_point_programs;
            if (make_unary_point(&engine->points[first],
                                 R310_OP_ABSOLUTE, &candidate) &&
                !add_point(engine, &candidate, &changed)) {
                set_error(error, error_capacity, "point grammar exceeded capacity");
                return R0_LIMIT_ERROR;
            }
            ++engine->raw_point_programs;
            if (make_unary_point(&engine->points[first],
                                 R310_OP_NONZERO, &candidate) &&
                !add_point(engine, &candidate, &changed)) {
                set_error(error, error_capacity, "point grammar exceeded capacity");
                return R0_LIMIT_ERROR;
            }
        }
        for (first = 0; first < snapshot; ++first) {
            for (second = first; second < snapshot; ++second) {
                R310PointProgram candidate;
                ++engine->raw_point_programs;
                if (make_multiply_point(&engine->points[first],
                                        &engine->points[second],
                                        &candidate) &&
                    !add_point(engine, &candidate, &changed)) {
                    set_error(error, error_capacity,
                              "point grammar exceeded capacity");
                    return R0_LIMIT_ERROR;
                }
            }
        }
    }
    if (engine->point_count < 4) {
        set_error(error, error_capacity, "point grammar is degenerate");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static void make_pattern(uint8_t vector, uint8_t dimension,
                         int16_t values[R310_MAX_DIMENSIONS])
{
    uint8_t coordinate;
    memset(values, 0, R310_MAX_DIMENSIONS * sizeof(values[0]));
    for (coordinate = 0; coordinate < dimension && coordinate < 4;
         ++coordinate)
        values[coordinate] = vector_patterns[vector][coordinate];
}

static uint8_t fold_score_pattern(const R310FoldProgram *fold,
                                  uint8_t vector, uint8_t dimension,
                                  int64_t *score)
{
    int16_t values[R310_MAX_DIMENSIONS];
    int64_t result = 0;
    uint8_t coordinate;
    make_pattern(vector, dimension, values);
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        int64_t item;
        if (!evaluate_point_code(fold->point.code, fold->point.length,
                                 values[coordinate], 0, &item))
            return 0;
        if (fold->reducer == R310_REDUCE_SUM)
            result += item;
        else if (coordinate == 0 || item > result)
            result = item;
    }
    *score = result;
    return 1;
}

static int fold_quality_compare(const R310FoldProgram *left,
                                const R310FoldProgram *right)
{
    int compared;
    if (left->description_length != right->description_length)
        return (int)left->description_length -
               (int)right->description_length;
    compared = code_compare(left->point.code, left->point.length,
                            right->point.code, right->point.length);
    if (compared != 0) return compared;
    return (int)left->reducer - (int)right->reducer;
}

static int fold_sort_compare(const void *left, const void *right)
{
    return fold_quality_compare((const R310FoldProgram *)left,
                                (const R310FoldProgram *)right);
}

static R0Status generate_folds(R310Engine *engine, char *error,
                               size_t error_capacity)
{
    uint16_t point;
    for (point = 0; point < engine->point_count; ++point) {
        uint8_t reducer;
        if (!point_target_certificate(&engine->points[point])) continue;
        for (reducer = R310_REDUCE_SUM;
             reducer <= R310_REDUCE_MAXIMUM; ++reducer) {
            R310FoldProgram candidate;
            uint8_t vector;
            uint16_t existing;
            uint8_t duplicate = 0;
            memset(&candidate, 0, sizeof(candidate));
            candidate.point = engine->points[point];
            candidate.reducer = reducer;
            candidate.description_length =
                (uint16_t)(candidate.point.length + 1u);
            ++engine->raw_fold_programs;
            for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
                if (!fold_score_pattern(&candidate, vector, 4,
                                        &candidate.scores[vector])) {
                    set_error(error, error_capacity, "fold evaluation failed");
                    return R0_POLICY_ERROR;
                }
            }
            for (existing = 0; existing < engine->fold_count; ++existing) {
                if (memcmp(candidate.scores, engine->folds[existing].scores,
                           sizeof(candidate.scores)) == 0) {
                    duplicate = 1;
                    if (fold_quality_compare(&candidate,
                                             &engine->folds[existing]) < 0)
                        engine->folds[existing] = candidate;
                    break;
                }
            }
            if (duplicate) continue;
            if (engine->fold_count >= R310_MAX_FOLDS) {
                set_error(error, error_capacity, "fold grammar exceeded capacity");
                return R0_LIMIT_ERROR;
            }
            engine->folds[engine->fold_count++] = candidate;
        }
    }
    qsort(engine->folds, engine->fold_count, sizeof(engine->folds[0]),
          fold_sort_compare);
    if (engine->fold_count < 6) {
        set_error(error, error_capacity, "fold grammar is too small");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int program_quality_compare(const R310Program *left,
                                   const R310Program *right)
{
    uint8_t index;
    if (left->description_length != right->description_length)
        return (int)left->description_length -
               (int)right->description_length;
    if (left->term_count != right->term_count)
        return (int)left->term_count - (int)right->term_count;
    for (index = 0; index < left->term_count; ++index) {
        if (left->fold_indices[index] != right->fold_indices[index])
            return (int)left->fold_indices[index] -
                   (int)right->fold_indices[index];
    }
    return 0;
}

static int program_sort_compare(const void *left, const void *right)
{
    return program_quality_compare((const R310Program *)left,
                                   (const R310Program *)right);
}

static uint8_t ranking_equal(const R310Program *left,
                             const R310Program *right)
{
    uint8_t first, second;
    for (first = 0; first < R310_VECTOR_COUNT; ++first) {
        for (second = (uint8_t)(first + 1u);
             second < R310_VECTOR_COUNT; ++second) {
            if (compare_i64(left->scores[first], left->scores[second]) !=
                compare_i64(right->scores[first], right->scores[second]))
                return 0;
        }
    }
    return 1;
}

static uint8_t add_raw_program(R310Engine *engine, R310Program *raw,
                               uint16_t *raw_count)
{
    uint8_t term, vector;
    raw->description_length = (uint16_t)(raw->term_count - 1u);
    for (term = 0; term < raw->term_count; ++term)
        raw->description_length =
            (uint16_t)(raw->description_length +
                       engine->folds[raw->fold_indices[term]].description_length);
    for (vector = 0; vector < R310_VECTOR_COUNT; ++vector) {
        raw->scores[vector] = 0;
        for (term = 0; term < raw->term_count; ++term)
            raw->scores[vector] +=
                engine->folds[raw->fold_indices[term]].scores[vector];
    }
    if (*raw_count >= R310_MAX_PROGRAMS) return 0;
    engine->programs[(*raw_count)++] = *raw;
    ++engine->raw_aggregate_programs;
    return 1;
}

static uint8_t fold_is_quadratic(const R310FoldProgram *fold)
{
    int delta;
    if (fold->reducer != R310_REDUCE_SUM) return 0;
    for (delta = -4; delta <= 4; ++delta) {
        if (fold->point.signature[delta + 4] != (int64_t)delta * delta)
            return 0;
    }
    return 1;
}

static R0Status generate_programs(R310Engine *engine, char *error,
                                  size_t error_capacity)
{
    R310Program raw_programs[R310_MAX_PROGRAMS];
    uint16_t raw_count = 0;
    uint16_t first, second, third, candidate;
    memset(raw_programs, 0, sizeof(raw_programs));
    for (first = 0; first < engine->fold_count; ++first) {
        R310Program raw;
        memset(&raw, 0, sizeof(raw));
        raw.term_count = 1;
        raw.fold_indices[0] = (uint8_t)first;
        if (!add_raw_program(engine, &raw, &raw_count)) goto capacity;
    }
    for (first = 0; first < engine->fold_count; ++first) {
        for (second = first; second < engine->fold_count; ++second) {
            R310Program raw;
            memset(&raw, 0, sizeof(raw));
            raw.term_count = 2;
            raw.fold_indices[0] = (uint8_t)first;
            raw.fold_indices[1] = (uint8_t)second;
            if (!add_raw_program(engine, &raw, &raw_count)) goto capacity;
        }
    }
    for (first = 0; first < engine->fold_count; ++first) {
        for (second = first; second < engine->fold_count; ++second) {
            for (third = second; third < engine->fold_count; ++third) {
                R310Program raw;
                memset(&raw, 0, sizeof(raw));
                raw.term_count = 3;
                raw.fold_indices[0] = (uint8_t)first;
                raw.fold_indices[1] = (uint8_t)second;
                raw.fold_indices[2] = (uint8_t)third;
                if (!add_raw_program(engine, &raw, &raw_count)) goto capacity;
            }
        }
    }
    memcpy(raw_programs, engine->programs,
           raw_count * sizeof(raw_programs[0]));
    qsort(raw_programs, raw_count, sizeof(raw_programs[0]),
          program_sort_compare);
    engine->program_count = 0;
    engine->quadratic_program = UINT16_MAX;
    for (candidate = 0; candidate < raw_count; ++candidate) {
        uint16_t canonical;
        uint8_t duplicate = 0;
        for (canonical = 0; canonical < engine->program_count; ++canonical) {
            if (ranking_equal(&raw_programs[candidate],
                              &engine->programs[canonical])) {
                duplicate = 1;
                if (program_quality_compare(&raw_programs[candidate],
                                            &engine->programs[canonical]) < 0)
                    engine->unique_minimum_passed = 0;
                break;
            }
        }
        if (duplicate) continue;
        if (engine->program_count >= R310_MAX_PROGRAMS) goto capacity;
        engine->programs[engine->program_count++] = raw_programs[candidate];
    }
    engine->canonicalization_passed = 1;
    for (first = 0; first < engine->program_count; ++first) {
        for (second = (uint16_t)(first + 1u);
             second < engine->program_count; ++second) {
            if (ranking_equal(&engine->programs[first],
                              &engine->programs[second]))
                engine->canonicalization_passed = 0;
        }
        if (engine->programs[first].term_count == 1 &&
            fold_is_quadratic(
                &engine->folds[engine->programs[first].fold_indices[0]]))
            engine->quadratic_program = first;
    }
    if (engine->quadratic_program == UINT16_MAX) {
        set_error(error, error_capacity, "quadratic control was not generated");
        return R0_POLICY_ERROR;
    }
    return R0_OK;

capacity:
    set_error(error, error_capacity, "aggregate grammar exceeded capacity");
    return R0_LIMIT_ERROR;
}

static void initialize_queries(R310Engine *engine)
{
    uint16_t query = 0;
    uint8_t left, right;
    for (left = 0; left < R310_VECTOR_COUNT; ++left) {
        for (right = (uint8_t)(left + 1u);
             right < R310_VECTOR_COUNT; ++right) {
            uint16_t program;
            engine->query_left[query] = left;
            engine->query_right[query] = right;
            for (program = 0; program < engine->program_count; ++program)
                engine->outcomes[program][query] =
                    compare_i64(engine->programs[program].scores[left],
                                engine->programs[program].scores[right]);
            ++query;
        }
    }
}

static R0Status build_engine(R310Engine *engine, char *error,
                             size_t error_capacity)
{
    R0Status status;
    uint16_t program;
    uint32_t term_counts[4] = {0};
    memset(engine, 0, sizeof(*engine));
    engine->unique_minimum_passed = 1;
    status = generate_points(engine, error, error_capacity);
    if (status != R0_OK) return status;
    status = generate_folds(engine, error, error_capacity);
    if (status != R0_OK) return status;
    status = generate_programs(engine, error, error_capacity);
    if (status != R0_OK) return status;
    initialize_queries(engine);
    for (program = 0; program < engine->program_count; ++program)
        ++term_counts[engine->programs[program].term_count];
    engine->grammar_certificate_passed =
        (uint8_t)(engine->point_count >= 4 && engine->fold_count >= 6 &&
                  term_counts[1] >= 3 && term_counts[2] >= 3 &&
                  term_counts[3] >= 3 &&
                  engine->canonicalization_passed &&
                  engine->unique_minimum_passed);
    if (!engine->grammar_certificate_passed) {
        set_error(error, error_capacity, "program grammar certificate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static uint8_t permuted_index(uint8_t index, uint8_t count,
                              uint8_t permutation)
{
    if ((permutation & 1u) == 0u)
        return (uint8_t)((index + permutation) % count);
    return (uint8_t)((count - 1u - index + permutation) % count);
}

static void make_raw_observation(uint8_t vector, uint8_t dimension,
                                 uint8_t variant, uint32_t salt,
                                 int16_t candidate[R310_MAX_DIMENSIONS],
                                 int16_t goal[R310_MAX_DIMENSIONS])
{
    int16_t pattern[R310_MAX_DIMENSIONS];
    int8_t sign = (int8_t)((variant & 1u) == 0u ? 1 : -1);
    int16_t translation = (int16_t)(3 * ((int)(variant % 5u) - 2));
    uint8_t permutation = (uint8_t)((variant + (salt >> 8)) % dimension);
    uint8_t coordinate;
    make_pattern(vector, dimension, pattern);
    memset(candidate, 0, R310_MAX_DIMENSIONS * sizeof(candidate[0]));
    memset(goal, 0, R310_MAX_DIMENSIONS * sizeof(goal[0]));
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        uint8_t field = permuted_index(coordinate, dimension, permutation);
        int16_t raw_goal =
            (int16_t)((int)(mix32(salt + (uint32_t)variant * 97u +
                                  (uint32_t)coordinate * 193u) % 9u) - 4);
        goal[field] = (int16_t)(sign * raw_goal + translation);
        candidate[field] =
            (int16_t)(sign * (raw_goal + pattern[coordinate]) + translation);
    }
}

static uint8_t fold_score_raw(const R310FoldProgram *fold,
                              const int16_t *candidate, const int16_t *goal,
                              uint8_t dimension, int64_t *score)
{
    int64_t result = 0;
    uint8_t coordinate;
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        int64_t item;
        if (!evaluate_point_code(fold->point.code, fold->point.length,
                                 candidate[coordinate], goal[coordinate],
                                 &item))
            return 0;
        if (fold->reducer == R310_REDUCE_SUM)
            result += item;
        else if (coordinate == 0 || item > result)
            result = item;
    }
    *score = result;
    return 1;
}

static uint8_t program_score_raw(const R310Engine *engine, uint16_t program,
                                 const int16_t *candidate,
                                 const int16_t *goal, uint8_t dimension,
                                 int64_t *score)
{
    const R310Program *item = &engine->programs[program];
    uint8_t term;
    *score = 0;
    for (term = 0; term < item->term_count; ++term) {
        int64_t folded;
        if (!fold_score_raw(&engine->folds[item->fold_indices[term]],
                            candidate, goal, dimension, &folded))
            return 0;
        *score += folded;
    }
    return 1;
}

static int8_t raw_query_outcome(const R310Engine *engine, uint16_t program,
                                uint16_t query, uint8_t dimension,
                                uint8_t variant, uint32_t salt)
{
    int16_t left[R310_MAX_DIMENSIONS], right[R310_MAX_DIMENSIONS];
    int16_t left_goal[R310_MAX_DIMENSIONS], right_goal[R310_MAX_DIMENSIONS];
    int64_t left_score = 0, right_score = 0;
    make_raw_observation(engine->query_left[query], dimension, variant, salt,
                         left, left_goal);
    make_raw_observation(engine->query_right[query], dimension, variant, salt,
                         right, right_goal);
    if (!program_score_raw(engine, program, left, left_goal, dimension,
                           &left_score) ||
        !program_score_raw(engine, program, right, right_goal, dimension,
                           &right_score))
        return 2;
    return compare_i64(left_score, right_score);
}

static uint8_t certify_semantic_oracle(const R310Engine *engine)
{
    uint16_t program, query;
    for (program = 0; program < engine->program_count; ++program) {
        for (query = 0; query < R310_QUERY_COUNT; ++query) {
            if (raw_query_outcome(engine, program, query, 8, 3,
                                  UINT32_C(0x310ce471)) !=
                engine->outcomes[program][query])
                return 0;
        }
    }
    return 1;
}

static uint16_t consistent_count(const uint8_t *consistent,
                                 uint16_t program_count)
{
    uint16_t count = 0;
    uint16_t program;
    for (program = 0; program < program_count; ++program)
        count = (uint16_t)(count + (consistent[program] != 0));
    return count;
}

static void filter_programs(const R310Engine *engine, uint8_t *consistent,
                            uint16_t query, int8_t outcome)
{
    uint16_t program;
    for (program = 0; program < engine->program_count; ++program) {
        if (consistent[program] && engine->outcomes[program][query] != outcome)
            consistent[program] = 0;
    }
}

static uint16_t choose_query(const R310Engine *engine,
                             const uint8_t *consistent,
                             const uint8_t *used)
{
    uint16_t best = UINT16_MAX;
    uint16_t best_worst = UINT16_MAX;
    uint16_t query;
    for (query = 0; query < R310_QUERY_COUNT; ++query) {
        uint16_t buckets[3] = {0, 0, 0};
        uint16_t worst;
        uint16_t program;
        if (used[query]) continue;
        for (program = 0; program < engine->program_count; ++program) {
            if (consistent[program])
                ++buckets[engine->outcomes[program][query] + 1];
        }
        worst = buckets[0];
        if (buckets[1] > worst) worst = buckets[1];
        if (buckets[2] > worst) worst = buckets[2];
        if (worst < best_worst) {
            best = query;
            best_worst = worst;
        }
    }
    return best;
}

static uint16_t first_consistent(const uint8_t *consistent,
                                 uint16_t program_count)
{
    uint16_t program;
    for (program = 0; program < program_count; ++program)
        if (consistent[program]) return program;
    return UINT16_MAX;
}

static uint16_t curriculum_lookup(const R310Engine *engine,
                                  const uint8_t *consistent)
{
    uint16_t program;
    for (program = 0; program < engine->program_count; ++program) {
        if (consistent[program] && engine->programs[program].term_count == 1)
            return program;
    }
    return UINT16_MAX;
}

static int append_text(char *output, size_t capacity, size_t *used,
                       const char *text)
{
    int written;
    if (*used >= capacity) return 0;
    written = snprintf(output + *used, capacity - *used,
                       "%s%s", *used == 0 ? "" : " ", text);
    if (written < 0 || (size_t)written >= capacity - *used) return 0;
    *used += (size_t)written;
    return 1;
}

static uint8_t render_program(const R310Engine *engine, uint16_t program,
                              char output[R310_MAX_REPORT_TEXT])
{
    static const char *const op_names[] = {
        "?", "C", "G", "SUB", "ABS", "MUL", "NZ"};
    const R310Program *item;
    size_t used = 0;
    uint8_t term;
    output[0] = '\0';
    if (program >= engine->program_count) return 0;
    item = &engine->programs[program];
    for (term = 0; term < item->term_count; ++term) {
        const R310FoldProgram *fold =
            &engine->folds[item->fold_indices[term]];
        uint8_t instruction;
        for (instruction = 0; instruction < fold->point.length;
             ++instruction) {
            uint8_t op = fold->point.code[instruction];
            if (op > R310_OP_NONZERO ||
                !append_text(output, R310_MAX_REPORT_TEXT, &used,
                             op_names[op]))
                return 0;
        }
        if (!append_text(output, R310_MAX_REPORT_TEXT, &used,
                         fold->reducer == R310_REDUCE_SUM ? "SUM" : "MAX"))
            return 0;
        if (term > 0 &&
            !append_text(output, R310_MAX_REPORT_TEXT, &used, "ADD"))
            return 0;
    }
    return 1;
}

static uint8_t choose_action(const R310Engine *engine, uint16_t program,
                             const uint8_t vectors[R310_ACTION_CANDIDATES],
                             uint8_t dimension, uint8_t variant,
                             uint32_t salt)
{
    uint8_t candidate_index;
    uint8_t best = 0;
    int64_t best_score = INT64_MAX;
    for (candidate_index = 0;
         candidate_index < R310_ACTION_CANDIDATES; ++candidate_index) {
        int16_t candidate[R310_MAX_DIMENSIONS], goal[R310_MAX_DIMENSIONS];
        int64_t score;
        make_raw_observation(vectors[candidate_index], dimension, variant,
                             salt, candidate, goal);
        if (!program_score_raw(engine, program, candidate, goal,
                               dimension, &score))
            return UINT8_MAX;
        if (score < best_score) {
            best_score = score;
            best = candidate_index;
        }
    }
    return best;
}

static void make_action_vectors(uint8_t action_case, uint8_t variant,
                                uint32_t salt,
                                uint8_t vectors[R310_ACTION_CANDIDATES])
{
    uint32_t state = mix32(salt + (uint32_t)action_case * 313u +
                           (uint32_t)variant * 47u);
    uint8_t count = 0;
    while (count < R310_ACTION_CANDIDATES) {
        uint8_t vector = (uint8_t)(1u + state % (R310_VECTOR_COUNT - 1u));
        uint8_t existing;
        uint8_t duplicate = 0;
        for (existing = 0; existing < count; ++existing)
            if (vectors[existing] == vector) duplicate = 1;
        if (!duplicate) vectors[count++] = vector;
        state = mix32(state + 0x9e3779b9u);
    }
}

static void check_program_invariance(const R310Engine *engine,
                                     uint16_t program, uint8_t vector,
                                     uint8_t dimension, uint8_t variant,
                                     uint32_t salt,
                                     R310Evaluation *evaluation)
{
    int16_t candidate[R310_MAX_DIMENSIONS], goal[R310_MAX_DIMENSIONS];
    int64_t transformed;
    ++evaluation->invariance_checks;
    make_raw_observation(vector, dimension, variant, salt, candidate, goal);
    if (program_score_raw(engine, program, candidate, goal, dimension,
                          &transformed) &&
        transformed == engine->programs[program].scores[vector])
        ++evaluation->exact_invariance_checks;
}

static void evaluate_episode(const R310Engine *engine, uint16_t target,
                             uint8_t dimension, uint8_t variant,
                             uint32_t salt, R310Control control,
                             R310Evaluation *evaluation)
{
    uint8_t consistent[R310_MAX_PROGRAMS];
    uint8_t used[R310_QUERY_COUNT];
    uint16_t remaining;
    uint16_t selected = UINT16_MAX;
    uint32_t query_steps = 0;
    uint8_t action_case;
    uint8_t all_actions_exact = 1;
    uint8_t demonstration;
    char selected_text[R310_MAX_REPORT_TEXT];
    char target_text[R310_MAX_REPORT_TEXT];
    memset(consistent, 1, engine->program_count);
    memset(used, 0, sizeof(used));
    ++evaluation->episodes;
    for (demonstration = 0; demonstration < R310_INITIAL_DEMOS;
         ++demonstration) {
        uint16_t query = (uint16_t)(mix32(
            salt + (uint32_t)variant * 409u +
            (uint32_t)demonstration * 811u) % R310_QUERY_COUNT);
        int8_t observed;
        while (used[query]) query = (uint16_t)((query + 1u) % R310_QUERY_COUNT);
        used[query] = 1;
        observed = raw_query_outcome(engine, target, query, dimension,
                                     variant, salt);
        ++evaluation->demonstrations;
        check_program_invariance(engine, target,
                                 engine->query_left[query], dimension,
                                 variant, salt, evaluation);
        check_program_invariance(engine, target,
                                 engine->query_right[query], dimension,
                                 variant, salt, evaluation);
        filter_programs(engine, consistent, query, observed);
    }
    remaining = consistent_count(consistent, engine->program_count);
    if (control == R310_CONTROL_MODEL ||
        control == R310_CONTROL_SHUFFLED_FEEDBACK) {
        while (remaining > 1 && query_steps < 64) {
            uint16_t query = choose_query(engine, consistent, used);
            R310Call call;
            int8_t observed;
            if (query == UINT16_MAX) break;
            call.tool = R310_TOOL_QUERY;
            call.argument = query;
            used[call.argument] = 1;
            observed = raw_query_outcome(engine, target, call.argument, dimension,
                                         variant, salt);
            if (control == R310_CONTROL_SHUFFLED_FEEDBACK) {
                uint16_t shifted =
                    (uint16_t)((call.argument + 37u) % R310_QUERY_COUNT);
                observed = raw_query_outcome(engine, target, shifted,
                                             dimension, variant, salt);
            }
            ++evaluation->queries;
            if (call.tool == R310_TOOL_QUERY && call.argument == query)
                ++evaluation->exact_queries;
            check_program_invariance(engine, target,
                                     engine->query_left[call.argument], dimension,
                                     variant, salt, evaluation);
            check_program_invariance(engine, target,
                                     engine->query_right[call.argument], dimension,
                                     variant, salt, evaluation);
            filter_programs(engine, consistent, call.argument, observed);
            remaining = consistent_count(consistent, engine->program_count);
            ++query_steps;
        }
    }
    if (query_steps > evaluation->maximum_queries)
        evaluation->maximum_queries = query_steps;
    switch (control) {
    case R310_CONTROL_MODEL:
    case R310_CONTROL_SHUFFLED_FEEDBACK:
    case R310_CONTROL_NO_QUERY:
        selected = first_consistent(consistent, engine->program_count);
        break;
    case R310_CONTROL_CURRICULUM_LOOKUP:
        selected = curriculum_lookup(engine, consistent);
        break;
    case R310_CONTROL_FIXED_QUADRATIC:
    case R310_CONTROL_COEFFICIENT_ONLY:
        selected = engine->quadratic_program;
        break;
    }
    ++evaluation->identifications;
    if (remaining == 1 && selected == target)
        ++evaluation->exact_identifications;
    for (action_case = 0; action_case < R310_ACTION_CASES; ++action_case) {
        uint8_t vectors[R310_ACTION_CANDIDATES];
        uint8_t predicted = UINT8_MAX;
        uint8_t expected;
        R310Call call;
        make_action_vectors(action_case, variant, salt, vectors);
        expected = choose_action(engine, target, vectors, dimension,
                                 variant, salt);
        if (selected != UINT16_MAX)
            predicted = choose_action(engine, selected, vectors, dimension,
                                      variant, salt);
        call.tool = R310_TOOL_APPLY;
        call.argument = predicted;
        ++evaluation->actions;
        if (call.tool == R310_TOOL_APPLY && call.argument == expected)
            ++evaluation->exact_actions;
        else all_actions_exact = 0;
        check_program_invariance(engine, target, vectors[0], dimension,
                                 variant, salt, evaluation);
    }
    {
        R310Call call = {R310_TOOL_COMMIT, selected};
        ++evaluation->commits;
        if (remaining > 1) ++evaluation->premature_commits;
        if (call.tool == R310_TOOL_COMMIT && remaining == 1 &&
            call.argument == target && all_actions_exact)
            ++evaluation->exact_commits;
    }
    {
        R310Call call = {R310_TOOL_REPORT, selected};
        ++evaluation->reports;
        if (call.tool == R310_TOOL_REPORT && call.argument != UINT16_MAX &&
            render_program(engine, call.argument, selected_text) &&
            render_program(engine, target, target_text) &&
            strcmp(selected_text, target_text) == 0)
            ++evaluation->exact_reports;
    }
}

static void finish_evaluation(R310Evaluation *evaluation)
{
    evaluation->exact =
        (uint8_t)(evaluation->episodes > 0 &&
                  evaluation->identifications == evaluation->episodes &&
                  evaluation->exact_identifications == evaluation->episodes &&
                  evaluation->actions ==
                      evaluation->episodes * R310_ACTION_CASES &&
                  evaluation->exact_actions == evaluation->actions &&
                  evaluation->commits == evaluation->episodes &&
                  evaluation->exact_commits == evaluation->commits &&
                  evaluation->reports == evaluation->episodes &&
                  evaluation->exact_reports == evaluation->reports &&
                  evaluation->queries == evaluation->exact_queries &&
                  evaluation->premature_commits == 0 &&
                  evaluation->invariance_checks ==
                      evaluation->exact_invariance_checks);
}

static void evaluate_split(const R310Engine *engine, uint8_t term_count,
                           uint8_t minimum_dimension,
                           uint8_t maximum_dimension, uint8_t variants,
                           uint32_t salt, R310Control control,
                           R310Evaluation *evaluation)
{
    uint16_t target;
    memset(evaluation, 0, sizeof(*evaluation));
    for (target = 0; target < engine->program_count; ++target) {
        uint8_t dimension;
        if (engine->programs[target].term_count != term_count) continue;
        ++evaluation->target_programs;
        for (dimension = minimum_dimension;
             dimension <= maximum_dimension; ++dimension) {
            uint8_t variant;
            for (variant = 0; variant < variants; ++variant)
                evaluate_episode(engine, target, dimension, variant, salt,
                                 control, evaluation);
        }
    }
    finish_evaluation(evaluation);
}

static uint32_t count_term_programs(const R310Engine *engine,
                                    uint8_t term_count)
{
    uint32_t count = 0;
    uint16_t program;
    for (program = 0; program < engine->program_count; ++program)
        if (engine->programs[program].term_count == term_count) ++count;
    return count;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (8u * byte));
        hash *= R310_FNV_PRIME;
    }
    return hash;
}

static uint64_t digest_evaluation(uint64_t hash,
                                  const R310Evaluation *evaluation)
{
    hash = digest_u64(hash, evaluation->episodes);
    hash = digest_u64(hash, evaluation->target_programs);
    hash = digest_u64(hash, evaluation->demonstrations);
    hash = digest_u64(hash, evaluation->queries);
    hash = digest_u64(hash, evaluation->exact_queries);
    hash = digest_u64(hash, evaluation->exact_identifications);
    hash = digest_u64(hash, evaluation->exact_actions);
    hash = digest_u64(hash, evaluation->exact_commits);
    hash = digest_u64(hash, evaluation->exact_reports);
    hash = digest_u64(hash, evaluation->premature_commits);
    hash = digest_u64(hash, evaluation->exact_invariance_checks);
    hash = digest_u64(hash, evaluation->maximum_queries);
    return digest_u64(hash, evaluation->exact);
}

static uint64_t experiment_digest(const R310ExperimentReport *report)
{
    uint64_t hash = R310_FNV_OFFSET;
    hash = digest_u64(hash, report->raw_point_programs);
    hash = digest_u64(hash, report->canonical_point_programs);
    hash = digest_u64(hash, report->canonical_fold_programs);
    hash = digest_u64(hash, report->raw_aggregate_programs);
    hash = digest_u64(hash, report->canonical_programs);
    hash = digest_u64(hash, report->curriculum_programs);
    hash = digest_u64(hash, report->open_programs);
    hash = digest_u64(hash, report->sealed_programs);
    hash = digest_u64(hash, report->canonicalization_passed);
    hash = digest_u64(hash, report->unique_minimum_passed);
    hash = digest_u64(hash, report->grammar_certificate_passed);
    hash = digest_u64(hash, report->semantic_oracle_passed);
    hash = digest_u64(hash, report->fixed_quadratic_control_passed);
    hash = digest_u64(hash, report->curriculum_lookup_control_passed);
    hash = digest_u64(hash, report->no_query_control_passed);
    hash = digest_u64(hash, report->shuffled_feedback_control_passed);
    hash = digest_u64(hash, report->coefficient_only_control_passed);
    hash = digest_evaluation(hash, &report->curriculum);
    hash = digest_evaluation(hash, &report->development);
    hash = digest_evaluation(hash, &report->sealed);
    hash = digest_u64(hash, report->development_gate_passed);
    return digest_u64(hash, report->sealed_gate_passed);
}

R0Status r310_run_development(R310ExperimentReport *report, char *error,
                              size_t error_capacity)
{
    R310Engine engine;
    R310Evaluation control;
    R0Status status;
    if (report == NULL) {
        set_error(error, error_capacity, "report is required");
        return R0_INVALID_ARGUMENT;
    }
    memset(report, 0, sizeof(*report));
    status = build_engine(&engine, error, error_capacity);
    if (status != R0_OK) return status;
    report->raw_point_programs = engine.raw_point_programs;
    report->canonical_point_programs = engine.point_count;
    report->raw_fold_programs = engine.raw_fold_programs;
    report->canonical_fold_programs = engine.fold_count;
    report->raw_aggregate_programs = engine.raw_aggregate_programs;
    report->canonical_programs = engine.program_count;
    report->curriculum_programs = count_term_programs(&engine, 1);
    report->open_programs = count_term_programs(&engine, 2);
    report->sealed_programs = count_term_programs(&engine, 3);
    report->canonicalization_passed = engine.canonicalization_passed;
    report->unique_minimum_passed = engine.unique_minimum_passed;
    report->grammar_certificate_passed = engine.grammar_certificate_passed;
    report->semantic_oracle_passed = certify_semantic_oracle(&engine);
    evaluate_split(&engine, 1, 4, 4, 4, UINT32_C(0x3100a11),
                   R310_CONTROL_MODEL, &report->curriculum);
    evaluate_split(&engine, 2, 5, 8, 4, UINT32_C(0x3100b22),
                   R310_CONTROL_MODEL, &report->development);
    evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x3100c33),
                   R310_CONTROL_FIXED_QUADRATIC, &control);
    report->fixed_quadratic_control_passed = control.exact;
    evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x3100c33),
                   R310_CONTROL_CURRICULUM_LOOKUP, &control);
    report->curriculum_lookup_control_passed = control.exact;
    evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x3100c33),
                   R310_CONTROL_NO_QUERY, &control);
    report->no_query_control_passed = control.exact;
    evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x3100c33),
                   R310_CONTROL_SHUFFLED_FEEDBACK, &control);
    report->shuffled_feedback_control_passed = control.exact;
    evaluate_split(&engine, 2, 5, 5, 1, UINT32_C(0x3100c33),
                   R310_CONTROL_COEFFICIENT_ONLY, &control);
    report->coefficient_only_control_passed = control.exact;
    report->development_gate_passed =
        (uint8_t)(report->canonicalization_passed &&
                  report->unique_minimum_passed &&
                  report->grammar_certificate_passed &&
                  report->semantic_oracle_passed &&
                  report->curriculum.exact && report->development.exact &&
                  !report->fixed_quadratic_control_passed &&
                  !report->curriculum_lookup_control_passed &&
                  !report->no_query_control_passed &&
                  !report->shuffled_feedback_control_passed &&
                  !report->coefficient_only_control_passed);
    report->result_digest = experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity, "active-law development gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r310_run_sealed(R310ExperimentReport *report, char *error,
                         size_t error_capacity)
{
    R310Engine engine;
    R0Status status = r310_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    status = build_engine(&engine, error, error_capacity);
    if (status != R0_OK) return status;
    evaluate_split(&engine, 3, 9, 12, 6, UINT32_C(0x3105ea17),
                   R310_CONTROL_MODEL, &report->sealed);
    report->sealed_gate_passed =
        (uint8_t)(report->development_gate_passed && report->sealed.exact);
    report->result_digest = experiment_digest(report);
    if (!report->sealed_gate_passed) {
        set_error(error, error_capacity, "active-law sealed gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int write_evaluation(FILE *file, const R310Evaluation *evaluation)
{
    return fprintf(file,
                   "{\"episodes\":%u,\"target_programs\":%u,"
                   "\"demonstrations\":%u,\"queries\":%u,"
                   "\"exact_queries\":%u,\"identifications\":%u,"
                   "\"exact_identifications\":%u,\"actions\":%u,"
                   "\"exact_actions\":%u,\"commits\":%u,"
                   "\"exact_commits\":%u,\"reports\":%u,"
                   "\"exact_reports\":%u,\"premature_commits\":%u,"
                   "\"invariance_checks\":%u,"
                   "\"exact_invariance_checks\":%u,"
                   "\"maximum_queries\":%u,\"exact\":%s}",
                   evaluation->episodes, evaluation->target_programs,
                   evaluation->demonstrations, evaluation->queries,
                   evaluation->exact_queries, evaluation->identifications,
                   evaluation->exact_identifications, evaluation->actions,
                   evaluation->exact_actions, evaluation->commits,
                   evaluation->exact_commits, evaluation->reports,
                   evaluation->exact_reports, evaluation->premature_commits,
                   evaluation->invariance_checks,
                   evaluation->exact_invariance_checks,
                   evaluation->maximum_queries,
                   evaluation->exact ? "true" : "false");
}

R0Status r310_write_result(const R310ExperimentReport *report,
                           const char *path, char *error,
                           size_t error_capacity)
{
    FILE *file;
    int failed = 0;
    if (report == NULL || path == NULL) {
        set_error(error, error_capacity, "report and path are required");
        return R0_INVALID_ARGUMENT;
    }
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fprintf(file,
                "{\"schema\":\"zero.reasoner310_active_law.v1\","
                "\"version\":\"(3,9)\","
                "\"raw_point_programs\":%u,"
                "\"canonical_point_programs\":%u,"
                "\"raw_fold_programs\":%u,"
                "\"canonical_fold_programs\":%u,"
                "\"raw_aggregate_programs\":%u,"
                "\"canonical_programs\":%u,"
                "\"curriculum_programs\":%u,"
                "\"open_programs\":%u,\"sealed_programs\":%u,"
                "\"canonicalization_passed\":%s,"
                "\"unique_minimum_passed\":%s,"
                "\"grammar_certificate_passed\":%s,"
                "\"semantic_oracle_passed\":%s,"
                "\"fixed_quadratic_control_passed\":%s,"
                "\"curriculum_lookup_control_passed\":%s,"
                "\"no_query_control_passed\":%s,"
                "\"shuffled_feedback_control_passed\":%s,"
                "\"coefficient_only_control_passed\":%s,"
                "\"development_gate_passed\":%s,"
                "\"sealed_gate_passed\":%s,\"curriculum\":",
                report->raw_point_programs,
                report->canonical_point_programs,
                report->raw_fold_programs,
                report->canonical_fold_programs,
                report->raw_aggregate_programs,
                report->canonical_programs,
                report->curriculum_programs, report->open_programs,
                report->sealed_programs,
                report->canonicalization_passed ? "true" : "false",
                report->unique_minimum_passed ? "true" : "false",
                report->grammar_certificate_passed ? "true" : "false",
                report->semantic_oracle_passed ? "true" : "false",
                report->fixed_quadratic_control_passed ? "true" : "false",
                report->curriculum_lookup_control_passed ? "true" : "false",
                report->no_query_control_passed ? "true" : "false",
                report->shuffled_feedback_control_passed ? "true" : "false",
                report->coefficient_only_control_passed ? "true" : "false",
                report->development_gate_passed ? "true" : "false",
                report->sealed_gate_passed ? "true" : "false") < 0)
        failed = 1;
    if (!failed && write_evaluation(file, &report->curriculum) < 0) failed = 1;
    if (!failed && fprintf(file, ",\"development\":") < 0) failed = 1;
    if (!failed && write_evaluation(file, &report->development) < 0) failed = 1;
    if (!failed && fprintf(file, ",\"sealed\":") < 0) failed = 1;
    if (!failed && write_evaluation(file, &report->sealed) < 0) failed = 1;
    if (!failed &&
        fprintf(file, ",\"result_digest\":\"%016" PRIx64 "\"}\n",
                report->result_digest) < 0)
        failed = 1;
    if (fclose(file) != 0) failed = 1;
    if (failed) {
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
