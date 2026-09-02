#include "reasoner42.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Reasoner 4.2 keeps the registered Reasoner 4.0 adapter semantics unchanged.
 * It replaces probe-relative identity with an exact affine certificate and
 * learns reusable macros from solved curriculum programs.
 */
#include "reasoner40.c"

#define R42_FROZEN_R40_DEVELOPMENT_DIGEST UINT64_C(0x6af623f4d0e176fe)
#define R42_FNV_OFFSET UINT64_C(1469598103934665603)
#define R42_FNV_PRIME UINT64_C(1099511628211)
#define R42_SEARCH_BUDGET 100u

typedef struct {
    uint8_t code[R42_MAX_MACRO_CODE];
    uint8_t length;
    uint16_t occurrences;
    uint16_t mdl_gain;
    uint64_t proof_digest;
} R42Macro;

typedef struct {
    uint8_t base_code[R42_MAX_BASE_CODE];
    uint8_t base_length;
    uint8_t tokens[R42_MAX_TOKENS];
    uint8_t token_count;
    uint8_t macro_uses;
    uint64_t proof_digest;
} R42Program;

typedef struct {
    uint16_t matrix[R42_MAX_DIMENSION][R42_MAX_DIMENSION];
    uint16_t offset[R42_MAX_DIMENSION];
    uint8_t dimension;
} R42Affine;

typedef struct {
    R42Program programs[R42_MAX_PROGRAMS];
    R42Macro library[R42_LIBRARY_SIZE];
    uint16_t program_count;
    uint8_t library_count;
    uint8_t vocabulary_size;
    uint8_t maximum_tokens;
    uint8_t maximum_macro_uses;
    uint32_t raw_programs;
    uint8_t canonicalization_passed;
    uint8_t affine_certificate_passed;
} R42Engine;

typedef struct {
    uint8_t code[R42_MAX_BASE_CODE];
    uint8_t length;
} R42Target;

static const R42Target r42_curriculum_targets[R42_CURRICULUM_TARGETS] = {
    {{R40_ADAPTER_REVERSE, R40_ADAPTER_ROTATE_LEFT}, 2},
    {{R40_ADAPTER_REVERSE, R40_ADAPTER_ROTATE_LEFT,
      R40_ADAPTER_ADD_17}, 3},
    {{R40_ADAPTER_PREFIX_SUM, R40_ADAPTER_REVERSE,
      R40_ADAPTER_ROTATE_LEFT}, 3},
    {{R40_ADAPTER_PREFIX_SUM, R40_ADAPTER_ADD_17}, 2},
    {{R40_ADAPTER_PREFIX_SUM, R40_ADAPTER_ADD_17,
      R40_ADAPTER_PAIR_SHEAR}, 3},
    {{R40_ADAPTER_PAIR_SHEAR, R40_ADAPTER_PREFIX_SUM,
      R40_ADAPTER_ADD_17}, 3},
    {{R40_ADAPTER_PAIR_SHEAR, R40_ADAPTER_ROTATE_LEFT}, 2},
    {{R40_ADAPTER_PAIR_SHEAR, R40_ADAPTER_ROTATE_LEFT,
      R40_ADAPTER_PREFIX_SUM}, 3},
    {{R40_ADAPTER_ADD_17, R40_ADAPTER_PAIR_SHEAR,
      R40_ADAPTER_ROTATE_LEFT}, 3}
};

static const uint8_t r42_expected_library[R42_LIBRARY_SIZE][2] = {
    {R40_ADAPTER_REVERSE, R40_ADAPTER_ROTATE_LEFT},
    {R40_ADAPTER_PREFIX_SUM, R40_ADAPTER_ADD_17},
    {R40_ADAPTER_PAIR_SHEAR, R40_ADAPTER_ROTATE_LEFT}
};

static uint16_t r42_mod(int32_t value)
{
    int32_t reduced = value % R40_FIELD_MODULUS;
    if (reduced < 0) reduced += R40_FIELD_MODULUS;
    return (uint16_t)reduced;
}

static uint64_t r42_digest_byte(uint64_t hash, uint8_t value)
{
    hash ^= value;
    return hash * R42_FNV_PRIME;
}

static uint64_t r42_digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte)
        hash = r42_digest_byte(hash, (uint8_t)(value >> (8u * byte)));
    return hash;
}

static void r42_affine_identity(R42Affine *affine, uint8_t dimension)
{
    uint8_t row;
    memset(affine, 0, sizeof(*affine));
    affine->dimension = dimension;
    for (row = 0; row < dimension; ++row)
        affine->matrix[row][row] = 1;
}

static void r42_primitive_affine(uint8_t operation, uint8_t inverse,
                                 uint8_t dimension, R42Affine *affine)
{
    uint8_t index;
    r42_affine_identity(affine, dimension);
    switch (operation) {
    case R40_ADAPTER_REVERSE:
        memset(affine->matrix, 0, sizeof(affine->matrix));
        for (index = 0; index < dimension; ++index)
            affine->matrix[index][dimension - 1u - index] = 1;
        break;
    case R40_ADAPTER_ROTATE_LEFT:
        memset(affine->matrix, 0, sizeof(affine->matrix));
        if (!inverse) {
            for (index = 0; index + 1u < dimension; ++index)
                affine->matrix[index][index + 1u] = 1;
            affine->matrix[dimension - 1u][0] = 1;
        } else {
            affine->matrix[0][dimension - 1u] = 1;
            for (index = 1; index < dimension; ++index)
                affine->matrix[index][index - 1u] = 1;
        }
        break;
    case R40_ADAPTER_PREFIX_SUM:
        memset(affine->matrix, 0, sizeof(affine->matrix));
        if (!inverse) {
            uint8_t column;
            for (index = 0; index < dimension; ++index)
                for (column = 0; column <= index; ++column)
                    affine->matrix[index][column] = 1;
        } else {
            for (index = 0; index < dimension; ++index) {
                affine->matrix[index][index] = 1;
                if (index > 0)
                    affine->matrix[index][index - 1u] =
                        R40_FIELD_MODULUS - 1u;
            }
        }
        break;
    case R40_ADAPTER_PAIR_SHEAR:
        for (index = 0; index + 1u < dimension; index += 2u)
            affine->matrix[index][index + 1u] =
                inverse ? R40_FIELD_MODULUS - 1u : 1u;
        break;
    case R40_ADAPTER_ADD_17:
        for (index = 0; index < dimension; ++index)
            affine->offset[index] = inverse ? R40_FIELD_MODULUS - 17u : 17u;
        break;
    case R40_ADAPTER_MULTIPLY_3:
        for (index = 0; index < dimension; ++index)
            affine->matrix[index][index] = inverse ? 86u : 3u;
        break;
    }
}

static void r42_affine_compose(const R42Affine *outer,
                               const R42Affine *inner, R42Affine *result)
{
    uint8_t row, column, middle;
    memset(result, 0, sizeof(*result));
    result->dimension = inner->dimension;
    for (row = 0; row < result->dimension; ++row) {
        int32_t offset = outer->offset[row];
        for (middle = 0; middle < result->dimension; ++middle)
            offset += (int32_t)outer->matrix[row][middle] *
                      inner->offset[middle];
        result->offset[row] = r42_mod(offset);
        for (column = 0; column < result->dimension; ++column) {
            int32_t coefficient = 0;
            for (middle = 0; middle < result->dimension; ++middle)
                coefficient += (int32_t)outer->matrix[row][middle] *
                               inner->matrix[middle][column];
            result->matrix[row][column] = r42_mod(coefficient);
        }
    }
}

static void r42_program_affine(const uint8_t *code, uint8_t length,
                               uint8_t dimension, uint8_t inverse,
                               R42Affine *affine)
{
    uint8_t step;
    r42_affine_identity(affine, dimension);
    for (step = 0; step < length; ++step) {
        uint8_t index = inverse ? (uint8_t)(length - 1u - step) : step;
        R42Affine primitive;
        R42Affine composed;
        r42_primitive_affine(code[index], inverse, dimension, &primitive);
        r42_affine_compose(&primitive, affine, &composed);
        *affine = composed;
    }
}

static uint8_t r42_affine_equal(const R42Affine *left,
                                const R42Affine *right)
{
    uint8_t row;
    if (left->dimension != right->dimension) return 0;
    for (row = 0; row < left->dimension; ++row) {
        if (left->offset[row] != right->offset[row]) return 0;
        if (memcmp(left->matrix[row], right->matrix[row],
                   left->dimension * sizeof(left->matrix[row][0])) != 0)
            return 0;
    }
    return 1;
}

static uint8_t r42_affine_is_identity(const R42Affine *affine)
{
    uint8_t row, column;
    for (row = 0; row < affine->dimension; ++row) {
        if (affine->offset[row] != 0) return 0;
        for (column = 0; column < affine->dimension; ++column)
            if (affine->matrix[row][column] !=
                (uint16_t)(row == column ? 1u : 0u))
                return 0;
    }
    return 1;
}

static uint64_t r42_program_digest(const uint8_t *code, uint8_t length)
{
    uint64_t hash = R42_FNV_OFFSET;
    uint8_t dimension;
    for (dimension = R42_MIN_DIMENSION;
         dimension <= R42_MAX_DIMENSION; ++dimension) {
        R42Affine affine;
        uint8_t row, column;
        r42_program_affine(code, length, dimension, 0, &affine);
        hash = r42_digest_byte(hash, dimension);
        for (row = 0; row < dimension; ++row) {
            for (column = 0; column < dimension; ++column) {
                hash = r42_digest_byte(hash,
                    (uint8_t)affine.matrix[row][column]);
                hash = r42_digest_byte(hash,
                    (uint8_t)(affine.matrix[row][column] >> 8u));
            }
            hash = r42_digest_byte(hash, (uint8_t)affine.offset[row]);
            hash = r42_digest_byte(hash,
                (uint8_t)(affine.offset[row] >> 8u));
        }
    }
    return hash;
}

static uint8_t r42_program_equal_code(const uint8_t *left,
                                      uint8_t left_length,
                                      const uint8_t *right,
                                      uint8_t right_length)
{
    uint8_t dimension;
    if (r42_program_digest(left, left_length) !=
        r42_program_digest(right, right_length))
        return 0;
    for (dimension = R42_MIN_DIMENSION;
         dimension <= R42_MAX_DIMENSION; ++dimension) {
        R42Affine left_affine, right_affine;
        r42_program_affine(left, left_length, dimension, 0, &left_affine);
        r42_program_affine(right, right_length, dimension, 0, &right_affine);
        if (!r42_affine_equal(&left_affine, &right_affine)) return 0;
    }
    return 1;
}

static void r42_apply_forward_code(const uint8_t *code, uint8_t length,
                                   uint16_t *values, uint8_t dimension)
{
    uint8_t index;
    for (index = 0; index < length; ++index)
        r40_apply_forward(code[index], values, dimension);
}

static void r42_apply_inverse_code(const uint8_t *code, uint8_t length,
                                   uint16_t *values, uint8_t dimension)
{
    uint8_t index;
    for (index = length; index > 0; --index)
        r40_apply_inverse(code[index - 1u], values, dimension);
}

static uint8_t r42_certify_program(const R42Program *program)
{
    uint8_t dimension;
    for (dimension = R42_MIN_DIMENSION;
         dimension <= R42_MAX_DIMENSION; ++dimension) {
        R42Affine forward, inverse, inverse_after_forward;
        R42Affine forward_after_inverse;
        uint8_t basis;
        r42_program_affine(program->base_code, program->base_length,
                           dimension, 0, &forward);
        r42_program_affine(program->base_code, program->base_length,
                           dimension, 1, &inverse);
        r42_affine_compose(&inverse, &forward, &inverse_after_forward);
        r42_affine_compose(&forward, &inverse, &forward_after_inverse);
        if (!r42_affine_is_identity(&inverse_after_forward) ||
            !r42_affine_is_identity(&forward_after_inverse))
            return 0;
        for (basis = 0; basis <= dimension; ++basis) {
            uint16_t values[R42_MAX_DIMENSION] = {0};
            uint8_t row, column;
            if (basis < dimension) values[basis] = 1;
            r42_apply_forward_code(program->base_code,
                                   program->base_length, values, dimension);
            for (row = 0; row < dimension; ++row) {
                int32_t expected = forward.offset[row];
                if (basis < dimension) {
                    for (column = 0; column < dimension; ++column)
                        expected += (int32_t)forward.matrix[row][column] *
                                    (column == basis ? 1 : 0);
                }
                if (values[row] != r42_mod(expected)) return 0;
            }
            r42_apply_inverse_code(program->base_code,
                                   program->base_length, values, dimension);
            for (row = 0; row < dimension; ++row)
                if (values[row] !=
                    (uint16_t)(basis < dimension && row == basis ? 1u : 0u))
                    return 0;
        }
    }
    return 1;
}

static uint8_t r42_expand_token(const R42Engine *engine, uint8_t token,
                                uint8_t *code, uint8_t *length)
{
    if (token >= 1u && token <= R40_ADAPTER_PRIMITIVES) {
        if (*length >= R42_MAX_BASE_CODE) return 0;
        code[(*length)++] = token;
        return 1;
    }
    if (token > R40_ADAPTER_PRIMITIVES &&
        token <= R40_ADAPTER_PRIMITIVES + engine->library_count) {
        const R42Macro *macro =
            &engine->library[token - R40_ADAPTER_PRIMITIVES - 1u];
        if ((uint8_t)(*length + macro->length) > R42_MAX_BASE_CODE)
            return 0;
        memcpy(code + *length, macro->code, macro->length);
        *length = (uint8_t)(*length + macro->length);
        return 1;
    }
    return 0;
}

static uint8_t r42_program_equal(const R42Program *left,
                                 const R42Program *right)
{
    if (left->proof_digest != right->proof_digest) return 0;
    return r42_program_equal_code(left->base_code, left->base_length,
                                  right->base_code, right->base_length);
}

static R0Status r42_add_program(R42Engine *engine,
                                const uint8_t *tokens, uint8_t token_count,
                                char *error, size_t error_capacity)
{
    R42Program candidate;
    uint8_t index;
    uint16_t existing;
    memset(&candidate, 0, sizeof(candidate));
    candidate.token_count = token_count;
    memcpy(candidate.tokens, tokens, token_count);
    for (index = 0; index < token_count; ++index) {
        if (tokens[index] > R40_ADAPTER_PRIMITIVES)
            ++candidate.macro_uses;
        if (!r42_expand_token(engine, tokens[index], candidate.base_code,
                              &candidate.base_length))
            return R0_OK;
    }
    if (candidate.macro_uses > engine->maximum_macro_uses) return R0_OK;
    ++engine->raw_programs;
    candidate.proof_digest = r42_program_digest(candidate.base_code,
                                                 candidate.base_length);
    for (existing = 0; existing < engine->program_count; ++existing)
        if (r42_program_equal(&candidate, &engine->programs[existing]))
            return R0_OK;
    if (engine->program_count >= R42_MAX_PROGRAMS) {
        set_error(error, error_capacity, "Reasoner 4.2 program capacity exceeded");
        return R0_LIMIT_ERROR;
    }
    engine->programs[engine->program_count++] = candidate;
    return R0_OK;
}

static R0Status r42_generate_level(R42Engine *engine, uint8_t depth,
                                   uint8_t *tokens, uint8_t position,
                                   char *error, size_t error_capacity)
{
    uint8_t token;
    if (position == depth)
        return r42_add_program(engine, tokens, depth, error, error_capacity);
    for (token = 1; token <= engine->vocabulary_size; ++token) {
        R0Status status;
        tokens[position] = token;
        status = r42_generate_level(engine, depth, tokens,
                                    (uint8_t)(position + 1u), error,
                                    error_capacity);
        if (status != R0_OK) return status;
    }
    return R0_OK;
}

static R0Status r42_build_engine(R42Engine *engine,
                                 const R42Macro *library,
                                 uint8_t library_count,
                                 uint8_t maximum_tokens,
                                 uint8_t maximum_macro_uses,
                                 char *error, size_t error_capacity)
{
    uint8_t depth;
    uint8_t tokens[R42_MAX_TOKENS] = {0};
    memset(engine, 0, sizeof(*engine));
    engine->library_count = library_count;
    engine->maximum_tokens = maximum_tokens;
    engine->maximum_macro_uses = maximum_macro_uses;
    engine->vocabulary_size =
        (uint8_t)(R40_ADAPTER_PRIMITIVES + library_count);
    if (library_count > 0)
        memcpy(engine->library, library,
               library_count * sizeof(engine->library[0]));
    for (depth = 0; depth <= maximum_tokens; ++depth) {
        R0Status status = r42_generate_level(engine, depth, tokens, 0,
                                             error, error_capacity);
        if (status != R0_OK) return status;
    }
    engine->canonicalization_passed = 1;
    engine->affine_certificate_passed = 1;
    {
        uint16_t first;
        for (first = 0; first < engine->program_count; ++first) {
            uint16_t second;
            if (!r42_certify_program(&engine->programs[first]))
                engine->affine_certificate_passed = 0;
            for (second = (uint16_t)(first + 1u);
                 second < engine->program_count; ++second)
                if (r42_program_equal(&engine->programs[first],
                                      &engine->programs[second]))
                    engine->canonicalization_passed = 0;
        }
    }
    if (!engine->canonicalization_passed ||
        !engine->affine_certificate_passed) {
        set_error(error, error_capacity,
                  "Reasoner 4.2 affine grammar certificate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static uint16_t r42_find_program(const R42Engine *engine,
                                 const uint8_t *code, uint8_t length)
{
    uint64_t digest = r42_program_digest(code, length);
    uint16_t program;
    for (program = 0; program < engine->program_count; ++program)
        if (engine->programs[program].proof_digest == digest &&
            r42_program_equal_code(engine->programs[program].base_code,
                                   engine->programs[program].base_length,
                                   code, length))
            return program;
    return UINT16_MAX;
}

static uint8_t r42_query_definition(uint16_t query, uint8_t *dimension,
                                    uint8_t *basis)
{
    uint8_t current_dimension;
    uint16_t offset = 0;
    for (current_dimension = R42_MIN_DIMENSION;
         current_dimension <= R42_MAX_DIMENSION; ++current_dimension) {
        uint16_t width = (uint16_t)(current_dimension + 1u);
        if (query < offset + width) {
            *dimension = current_dimension;
            *basis = (uint8_t)(query - offset);
            return 1;
        }
        offset = (uint16_t)(offset + width);
    }
    return 0;
}

static void r42_query_response_code(const uint8_t *code, uint8_t length,
                                    uint16_t query, uint16_t *response,
                                    uint8_t *dimension)
{
    uint8_t basis;
    memset(response, 0, R42_MAX_DIMENSION * sizeof(response[0]));
    if (!r42_query_definition(query, dimension, &basis)) return;
    if (basis < *dimension) response[basis] = 1;
    r42_apply_forward_code(code, length, response, *dimension);
}

static void r42_query_response(const R42Program *program, uint16_t query,
                               uint16_t *response, uint8_t *dimension)
{
    r42_query_response_code(program->base_code, program->base_length,
                            query, response, dimension);
}

static uint8_t r42_same_response(const R42Program *left,
                                 const R42Program *right, uint16_t query)
{
    uint16_t left_response[R42_MAX_DIMENSION];
    uint16_t right_response[R42_MAX_DIMENSION];
    uint8_t left_dimension, right_dimension;
    r42_query_response(left, query, left_response, &left_dimension);
    r42_query_response(right, query, right_response, &right_dimension);
    return (uint8_t)(left_dimension == right_dimension &&
        memcmp(left_response, right_response,
               left_dimension * sizeof(left_response[0])) == 0);
}

static uint16_t r42_remaining(const uint8_t *consistent, uint16_t count)
{
    uint16_t remaining = 0;
    uint16_t index;
    for (index = 0; index < count; ++index)
        if (consistent[index]) ++remaining;
    return remaining;
}

static uint16_t r42_first_consistent(const uint8_t *consistent,
                                     uint16_t count)
{
    uint16_t index;
    for (index = 0; index < count; ++index)
        if (consistent[index]) return index;
    return UINT16_MAX;
}

static uint16_t r42_choose_query(const R42Engine *engine,
                                 const uint8_t *consistent,
                                 const uint8_t *used)
{
    uint16_t best = UINT16_MAX;
    uint16_t best_worst = UINT16_MAX;
    uint16_t query;
    for (query = 0; query < R42_QUERY_COUNT; ++query) {
        uint16_t worst = 0;
        uint16_t first;
        if (used[query]) continue;
        for (first = 0; first < engine->program_count; ++first) {
            uint16_t group = 0;
            uint16_t second;
            if (!consistent[first]) continue;
            for (second = 0; second < engine->program_count; ++second)
                if (consistent[second] &&
                    r42_same_response(&engine->programs[first],
                                      &engine->programs[second], query))
                    ++group;
            if (group > worst) worst = group;
        }
        if (worst < best_worst) {
            best_worst = worst;
            best = query;
        }
    }
    return best;
}

static void r42_filter(const R42Engine *engine, uint8_t *consistent,
                       const uint8_t *target_code, uint8_t target_length,
                       uint16_t query)
{
    uint16_t target_response[R42_MAX_DIMENSION];
    uint8_t target_dimension;
    uint16_t program;
    r42_query_response_code(target_code, target_length, query,
                            target_response, &target_dimension);
    for (program = 0; program < engine->program_count; ++program) {
        uint16_t response[R42_MAX_DIMENSION];
        uint8_t dimension;
        if (!consistent[program]) continue;
        r42_query_response(&engine->programs[program], query,
                           response, &dimension);
        if (dimension != target_dimension ||
            memcmp(response, target_response,
                   dimension * sizeof(response[0])) != 0)
            consistent[program] = 0;
    }
}

static uint8_t r42_render_program(const R42Program *program,
                                  char *text, size_t capacity)
{
    static const char *const names[] = {
        "", "reverse", "rotate-left", "prefix-sum", "pair-shear",
        "add-17", "multiply-3", "library-1", "library-2", "library-3"
    };
    size_t used = 0;
    uint8_t token;
    if (capacity == 0) return 0;
    text[0] = '\0';
    for (token = 0; token < program->token_count; ++token) {
        int written = snprintf(text + used, capacity - used, "%s%s",
            token == 0 ? "" : " -> ", names[program->tokens[token]]);
        if (written < 0 || (size_t)written >= capacity - used) return 0;
        used += (size_t)written;
    }
    if (program->token_count == 0) {
        if (capacity < 9) return 0;
        memcpy(text, "identity", 9);
    }
    return 1;
}

static void r42_finish_evaluation(R42Evaluation *evaluation)
{
    evaluation->exact = (uint8_t)(evaluation->episodes > 0 &&
        evaluation->identifications == evaluation->episodes &&
        evaluation->exact_identifications == evaluation->episodes &&
        evaluation->commits == evaluation->episodes &&
        evaluation->exact_commits == evaluation->episodes &&
        evaluation->premature_commits == 0 &&
        evaluation->queries == evaluation->exact_queries &&
        evaluation->replay_checks == evaluation->exact_replays &&
        evaluation->applications == evaluation->exact_applications &&
        evaluation->reports == evaluation->exact_reports);
}

static void r42_evaluate_targets(const R42Engine *engine,
                                 const R42Target *targets,
                                 uint16_t target_count, uint8_t variants,
                                 R42Control control,
                                 R42Evaluation *evaluation,
                                 uint16_t *identified_programs)
{
    uint16_t target;
    memset(evaluation, 0, sizeof(*evaluation));
    evaluation->target_programs = target_count;
    for (target = 0; target < target_count; ++target) {
        uint8_t variant;
        uint16_t target_program = r42_find_program(engine,
            targets[target].code, targets[target].length);
        if (identified_programs != NULL)
            identified_programs[target] = UINT16_MAX;
        for (variant = 0; variant < variants; ++variant) {
            uint8_t consistent[R42_MAX_PROGRAMS];
            uint8_t used[R42_QUERY_COUNT] = {0};
            uint16_t remaining;
            uint16_t selected = UINT16_MAX;
            uint32_t query_steps = 0;
            uint16_t initial = (uint16_t)((target * 17u + variant * 29u + 7u)
                                          % R42_QUERY_COUNT);
            memset(consistent, 1, engine->program_count);
            ++evaluation->episodes;
            used[initial] = 1;
            r42_filter(engine, consistent, targets[target].code,
                       targets[target].length, initial);
            ++evaluation->demonstrations;
            remaining = r42_remaining(consistent, engine->program_count);
            if (control != R42_CONTROL_NO_QUERY &&
                control != R42_CONTROL_SEMANTIC_ORACLE &&
                control != R42_CONTROL_CURRICULUM_LOOKUP) {
                while (remaining > 1 && query_steps < R42_QUERY_COUNT) {
                    uint16_t query = r42_choose_query(engine, consistent,
                                                      used);
                    if (query == UINT16_MAX) break;
                    used[query] = 1;
                    ++evaluation->queries;
                    ++evaluation->exact_queries;
                    r42_filter(engine, consistent, targets[target].code,
                               targets[target].length, query);
                    remaining = r42_remaining(consistent,
                                              engine->program_count);
                    ++query_steps;
                }
            }
            if (query_steps > evaluation->maximum_queries)
                evaluation->maximum_queries = query_steps;
            if (control == R42_CONTROL_SEMANTIC_ORACLE &&
                target_program != UINT16_MAX) {
                selected = target_program;
                remaining = 1;
            } else if (control == R42_CONTROL_CURRICULUM_LOOKUP) {
                selected = engine->program_count > 1 ? 1 : 0;
            } else {
                selected = r42_first_consistent(consistent,
                                                engine->program_count);
            }
            if (identified_programs != NULL && variant == 0)
                identified_programs[target] = selected;
            ++evaluation->identifications;
            ++evaluation->commits;
            if (remaining != 1) {
                ++evaluation->premature_commits;
            } else if (selected == target_program &&
                       target_program != UINT16_MAX) {
                ++evaluation->exact_identifications;
                ++evaluation->exact_commits;
            }
            if (selected != UINT16_MAX) {
                uint16_t query;
                for (query = 0; query < R42_QUERY_COUNT; ++query) {
                    uint16_t selected_response[R42_MAX_DIMENSION];
                    uint16_t target_response[R42_MAX_DIMENSION];
                    uint8_t selected_dimension, target_dimension;
                    r42_query_response(&engine->programs[selected], query,
                                       selected_response,
                                       &selected_dimension);
                    r42_query_response_code(targets[target].code,
                        targets[target].length, query, target_response,
                        &target_dimension);
                    ++evaluation->replay_checks;
                    if (selected_dimension == target_dimension &&
                        memcmp(selected_response, target_response,
                            target_dimension * sizeof(target_response[0])) == 0)
                        ++evaluation->exact_replays;
                }
                {
                    uint8_t action;
                    for (action = 0; action < 3; ++action) {
                        uint8_t dimension = (uint8_t)(5u +
                            ((target + variant + action) % 4u));
                        int16_t semantic[R42_MAX_DIMENSION];
                        uint16_t raw[R42_MAX_DIMENSION];
                        uint8_t coordinate;
                        make_pattern((uint8_t)((target * 3u + action * 7u +
                                     variant) % R310_VECTOR_COUNT),
                                     dimension, semantic);
                        for (coordinate = 0; coordinate < dimension;
                             ++coordinate)
                            raw[coordinate] = r40_field(semantic[coordinate]);
                        r42_apply_forward_code(targets[target].code,
                            targets[target].length, raw, dimension);
                        r42_apply_inverse_code(
                            engine->programs[selected].base_code,
                            engine->programs[selected].base_length,
                            raw, dimension);
                        ++evaluation->applications;
                        for (coordinate = 0; coordinate < dimension;
                             ++coordinate)
                            if (raw[coordinate] !=
                                r40_field(semantic[coordinate]))
                                break;
                        if (coordinate == dimension)
                            ++evaluation->exact_applications;
                    }
                }
                ++evaluation->reports;
                if (target_program != UINT16_MAX) {
                    char selected_text[128];
                    char target_text[128];
                    if (r42_render_program(&engine->programs[selected],
                                           selected_text,
                                           sizeof(selected_text)) &&
                        r42_render_program(&engine->programs[target_program],
                                           target_text,
                                           sizeof(target_text)) &&
                        strcmp(selected_text, target_text) == 0)
                        ++evaluation->exact_reports;
                }
            }
        }
    }
    r42_finish_evaluation(evaluation);
}

static uint8_t r42_pair_compare(const uint8_t left[2],
                                const uint8_t right[2])
{
    if (left[0] != right[0]) return (uint8_t)(left[0] < right[0]);
    return (uint8_t)(left[1] < right[1]);
}

static uint8_t r42_learn_library(const R42Program *solutions,
                                 uint16_t solution_count,
                                 uint8_t reverse_curriculum,
                                 R42Macro library[R42_LIBRARY_SIZE])
{
    uint16_t counts[R40_ADAPTER_PRIMITIVES + 1u]
                   [R40_ADAPTER_PRIMITIVES + 1u] = {{0}};
    uint8_t selected_count = 0;
    uint16_t solution;
    memset(library, 0, R42_LIBRARY_SIZE * sizeof(library[0]));
    for (solution = 0; solution < solution_count; ++solution) {
        uint8_t position;
        for (position = 0; position + 1u < solutions[solution].base_length;
             ++position) {
            uint8_t left = reverse_curriculum
                ? solutions[solution].base_code[
                    solutions[solution].base_length - 1u - position]
                : solutions[solution].base_code[position];
            uint8_t right = reverse_curriculum
                ? solutions[solution].base_code[
                    solutions[solution].base_length - 2u - position]
                : solutions[solution].base_code[position + 1u];
            ++counts[left][right];
        }
    }
    while (selected_count < R42_LIBRARY_SIZE) {
        uint8_t best_pair[2] = {0, 0};
        uint16_t best_count = 0;
        uint8_t left, right;
        for (left = 1; left <= R40_ADAPTER_PRIMITIVES; ++left) {
            for (right = 1; right <= R40_ADAPTER_PRIMITIVES; ++right) {
                uint8_t pair[2] = {left, right};
                uint8_t already = 0;
                uint8_t index;
                if (counts[left][right] < 3u) continue;
                for (index = 0; index < selected_count; ++index)
                    if (library[index].code[0] == left &&
                        library[index].code[1] == right)
                        already = 1;
                if (already) continue;
                if (counts[left][right] > best_count ||
                    (counts[left][right] == best_count &&
                     (best_pair[0] == 0 ||
                      r42_pair_compare(pair, best_pair)))) {
                    best_pair[0] = left;
                    best_pair[1] = right;
                    best_count = counts[left][right];
                }
            }
        }
        if (best_count < 3u) break;
        library[selected_count].code[0] = best_pair[0];
        library[selected_count].code[1] = best_pair[1];
        library[selected_count].length = 2;
        library[selected_count].occurrences = best_count;
        library[selected_count].mdl_gain = (uint16_t)(best_count - 2u);
        library[selected_count].proof_digest =
            r42_program_digest(library[selected_count].code, 2);
        ++selected_count;
    }
    return selected_count;
}

static uint32_t r42_compressed_corpus_tokens(const R42Program *solutions,
                                             uint16_t solution_count,
                                             const R42Macro *library,
                                             uint8_t library_count,
                                             uint32_t *uses)
{
    uint32_t tokens = 0;
    uint16_t solution;
    *uses = 0;
    for (solution = 0; solution < solution_count; ++solution) {
        uint8_t position = 0;
        while (position < solutions[solution].base_length) {
            uint8_t macro;
            uint8_t matched = 0;
            for (macro = 0; macro < library_count; ++macro) {
                if ((uint8_t)(position + library[macro].length) <=
                        solutions[solution].base_length &&
                    memcmp(solutions[solution].base_code + position,
                           library[macro].code,
                           library[macro].length) == 0) {
                    position = (uint8_t)(position + library[macro].length);
                    ++tokens;
                    ++*uses;
                    matched = 1;
                    break;
                }
            }
            if (!matched) {
                ++position;
                ++tokens;
            }
        }
    }
    return tokens;
}

static uint64_t r42_library_digest(const R42Macro *library,
                                   uint8_t library_count)
{
    uint64_t hash = R42_FNV_OFFSET;
    uint8_t macro;
    for (macro = 0; macro < library_count; ++macro) {
        uint8_t index;
        hash = r42_digest_byte(hash, library[macro].length);
        for (index = 0; index < library[macro].length; ++index)
            hash = r42_digest_byte(hash, library[macro].code[index]);
        hash = r42_digest_u64(hash, library[macro].occurrences);
        hash = r42_digest_u64(hash, library[macro].mdl_gain);
        hash = r42_digest_u64(hash, library[macro].proof_digest);
    }
    return hash;
}

static uint8_t r42_library_matches_contract(const R42Macro *library,
                                            uint8_t library_count)
{
    uint8_t macro;
    if (library_count != R42_LIBRARY_SIZE) return 0;
    for (macro = 0; macro < library_count; ++macro)
        if (library[macro].length != 2u ||
            library[macro].occurrences != 3u ||
            library[macro].mdl_gain != 1u ||
            memcmp(library[macro].code, r42_expected_library[macro], 2) != 0 ||
            library[macro].proof_digest !=
                r42_program_digest(library[macro].code,
                                   library[macro].length))
            return 0;
    return 1;
}

static uint16_t r42_make_development_targets(const R42Macro *library,
                                             const R42Engine *library_engine,
                                             const R42Engine *base_depth_four,
                                             R42Target *targets,
                                             uint32_t *base_tokens,
                                             uint32_t *library_tokens)
{
    uint8_t first, second;
    uint16_t count = 0;
    *base_tokens = 0;
    *library_tokens = 0;
    for (first = 0; first < R42_LIBRARY_SIZE; ++first) {
        for (second = 0; second < R42_LIBRARY_SIZE; ++second) {
            R42Target candidate;
            uint16_t library_program, base_program;
            memset(&candidate, 0, sizeof(candidate));
            memcpy(candidate.code, library[first].code,
                   library[first].length);
            candidate.length = library[first].length;
            memcpy(candidate.code + candidate.length,
                   library[second].code, library[second].length);
            candidate.length = (uint8_t)(candidate.length +
                                         library[second].length);
            library_program = r42_find_program(library_engine,
                candidate.code, candidate.length);
            base_program = r42_find_program(base_depth_four,
                candidate.code, candidate.length);
            if (library_program == UINT16_MAX || base_program == UINT16_MAX)
                continue;
            if (library_engine->programs[library_program].token_count != 2u ||
                library_engine->programs[library_program].macro_uses != 2u ||
                base_depth_four->programs[base_program].token_count != 4u)
                continue;
            targets[count++] = candidate;
            *base_tokens += 4u;
            *library_tokens += 2u;
        }
    }
    return count;
}

static uint16_t r42_make_sealed_targets(const R42Engine *engine,
                                        R42Target *targets,
                                        uint32_t *base_tokens,
                                        uint32_t *library_tokens)
{
    uint16_t count = 0;
    uint16_t program;
    *base_tokens = 0;
    *library_tokens = 0;
    for (program = 0; program < engine->program_count; ++program) {
        if (engine->programs[program].token_count == 3u &&
            engine->programs[program].macro_uses == 3u &&
            engine->programs[program].base_length == 6u) {
            if (targets != NULL && count < R42_SEALED_TARGETS) {
                memcpy(targets[count].code,
                       engine->programs[program].base_code,
                       engine->programs[program].base_length);
                targets[count].length = engine->programs[program].base_length;
            }
            ++count;
            *base_tokens += 6u;
            *library_tokens += 3u;
        }
    }
    return count;
}

typedef struct {
    const R42Target *targets;
    uint16_t target_count;
    uint64_t target_digests[R42_SEALED_TARGETS];
    uint8_t minimum_depths[R42_SEALED_TARGETS];
    uint32_t raw_programs;
} R42BaseOracle;

static void r42_visit_base_program(R42BaseOracle *oracle,
                                   const uint8_t *code, uint8_t length)
{
    uint64_t digest = r42_program_digest(code, length);
    uint16_t target;
    ++oracle->raw_programs;
    for (target = 0; target < oracle->target_count; ++target) {
        if (oracle->minimum_depths[target] != UINT8_MAX ||
            digest != oracle->target_digests[target])
            continue;
        if (r42_program_equal_code(code, length,
                                   oracle->targets[target].code,
                                   oracle->targets[target].length))
            oracle->minimum_depths[target] = length;
    }
}

static void r42_enumerate_base_level(R42BaseOracle *oracle, uint8_t depth,
                                     uint8_t *code, uint8_t position)
{
    uint8_t operation;
    if (position == depth) {
        r42_visit_base_program(oracle, code, depth);
        return;
    }
    for (operation = 1; operation <= R40_ADAPTER_PRIMITIVES; ++operation) {
        code[position] = operation;
        r42_enumerate_base_level(oracle, depth, code,
                                 (uint8_t)(position + 1u));
    }
}

static uint8_t r42_certify_sealed_base_minimum(const R42Target *targets,
                                                uint16_t target_count,
                                                uint32_t *raw_programs)
{
    R42BaseOracle oracle;
    uint8_t code[R42_MAX_BASE_CODE] = {0};
    uint8_t depth;
    uint16_t target;
    memset(&oracle, 0, sizeof(oracle));
    if (target_count != R42_SEALED_TARGETS) {
        *raw_programs = 0;
        return 0;
    }
    oracle.targets = targets;
    oracle.target_count = target_count;
    memset(oracle.minimum_depths, UINT8_MAX,
           sizeof(oracle.minimum_depths));
    for (target = 0; target < target_count; ++target)
        oracle.target_digests[target] =
            r42_program_digest(targets[target].code, targets[target].length);
    for (depth = 0; depth <= R42_MAX_BASE_CODE; ++depth)
        r42_enumerate_base_level(&oracle, depth, code, 0);
    *raw_programs = oracle.raw_programs;
    if (oracle.raw_programs != 55987u)
        return 0;
    for (target = 0; target < target_count; ++target)
        if (oracle.minimum_depths[target] != R42_MAX_BASE_CODE)
            return 0;
    return 1;
}

static uint8_t r42_certify_frozen_base(void)
{
    R40ExperimentReport report;
    char error[256] = {0};
    return (uint8_t)(r40_run_development(&report, error, sizeof(error)) ==
                         R0_OK &&
                     report.result_digest ==
                         R42_FROZEN_R40_DEVELOPMENT_DIGEST &&
                     report.canonical_adapter_programs == 170u &&
                     report.development_gate_passed);
}

static uint64_t r42_digest_evaluation(uint64_t hash,
                                      const R42Evaluation *evaluation)
{
    hash = r42_digest_u64(hash, evaluation->target_programs);
    hash = r42_digest_u64(hash, evaluation->episodes);
    hash = r42_digest_u64(hash, evaluation->demonstrations);
    hash = r42_digest_u64(hash, evaluation->queries);
    hash = r42_digest_u64(hash, evaluation->exact_queries);
    hash = r42_digest_u64(hash, evaluation->exact_identifications);
    hash = r42_digest_u64(hash, evaluation->exact_commits);
    hash = r42_digest_u64(hash, evaluation->premature_commits);
    hash = r42_digest_u64(hash, evaluation->exact_replays);
    hash = r42_digest_u64(hash, evaluation->exact_applications);
    hash = r42_digest_u64(hash, evaluation->exact_reports);
    hash = r42_digest_u64(hash, evaluation->maximum_queries);
    return r42_digest_u64(hash, evaluation->exact);
}

static uint64_t r42_experiment_digest(const R42ExperimentReport *report)
{
    uint64_t hash = R42_FNV_OFFSET;
    hash = r42_digest_u64(hash, report->frozen_base_programs);
    hash = r42_digest_u64(hash, report->curriculum_raw_programs);
    hash = r42_digest_u64(hash, report->curriculum_canonical_programs);
    hash = r42_digest_u64(hash, report->curriculum_solution_tokens);
    hash = r42_digest_u64(hash, report->learned_library_entries);
    hash = r42_digest_u64(hash, report->learned_library_definition_tokens);
    hash = r42_digest_u64(hash, report->learned_library_occurrences);
    hash = r42_digest_u64(hash, report->learned_library_mdl_gain);
    hash = r42_digest_u64(hash, report->development_raw_programs);
    hash = r42_digest_u64(hash, report->development_canonical_programs);
    hash = r42_digest_u64(hash, report->development_target_programs);
    hash = r42_digest_u64(hash, report->development_base_tokens);
    hash = r42_digest_u64(hash, report->development_library_tokens);
    hash = r42_digest_u64(hash, report->base_depth_four_raw_programs);
    hash = r42_digest_u64(hash, report->planned_sealed_raw_programs);
    hash = r42_digest_u64(hash, report->planned_sealed_base_raw_programs);
    hash = r42_digest_u64(hash, report->sealed.target_programs);
    hash = r42_digest_u64(hash, report->frozen_base_certificate_passed);
    hash = r42_digest_u64(hash, report->affine_certificate_passed);
    hash = r42_digest_u64(hash, report->library_discovery_certificate_passed);
    hash = r42_digest_u64(hash, report->library_freeze_certificate_passed);
    hash = r42_digest_u64(hash, report->compression_certificate_passed);
    hash = r42_digest_u64(hash, report->search_budget_certificate_passed);
    hash = r42_digest_u64(hash, report->semantic_oracle_control_passed);
    hash = r42_digest_u64(hash, report->no_library_control_passed);
    hash = r42_digest_u64(hash, report->shuffled_curriculum_control_passed);
    hash = r42_digest_u64(hash, report->single_use_library_control_passed);
    hash = r42_digest_u64(hash, report->curriculum_lookup_control_passed);
    hash = r42_digest_u64(hash, report->no_query_control_passed);
    hash = r42_digest_u64(hash, report->library_digest);
    hash = r42_digest_evaluation(hash, &report->curriculum);
    hash = r42_digest_evaluation(hash, &report->development);
    hash = r42_digest_u64(hash, report->development_gate_passed);
    return r42_digest_u64(hash, report->sealed_execution_locked);
}

static uint64_t r42_sealed_digest(const R42ExperimentReport *report)
{
    uint64_t hash = r42_experiment_digest(report);
    hash = r42_digest_evaluation(hash, &report->sealed);
    hash = r42_digest_u64(hash, report->sealed_base_tokens);
    hash = r42_digest_u64(hash, report->sealed_library_tokens);
    hash = r42_digest_u64(hash,
                          report->sealed_minimum_certificate_passed);
    return r42_digest_u64(hash, report->sealed_gate_passed);
}

R0Status r42_run_development(R42ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R42Engine curriculum_engine;
    R42Engine library_engine;
    R42Engine base_depth_four;
    R42Engine sealed_plan_engine;
    R42Engine no_library_engine;
    R42Engine shuffled_engine;
    R42Engine single_use_engine;
    R42Program solutions[R42_CURRICULUM_TARGETS];
    uint16_t identified_curriculum[R42_CURRICULUM_TARGETS];
    R42Macro library[R42_LIBRARY_SIZE];
    R42Macro shuffled_library[R42_LIBRARY_SIZE];
    R42Target development_targets[R42_LIBRARY_SIZE * R42_LIBRARY_SIZE];
    R42Evaluation control;
    uint8_t library_count;
    uint8_t shuffled_count;
    uint16_t target;
    uint32_t compressed_tokens;
    uint32_t library_uses;
    uint64_t frozen_library_digest;
    R0Status status;
    if (report == NULL) {
        set_error(error, error_capacity, "Reasoner 4.2 report is required");
        return R0_INVALID_ARGUMENT;
    }
    memset(report, 0, sizeof(*report));
    status = r42_build_engine(&curriculum_engine, NULL, 0, 3, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    r42_evaluate_targets(&curriculum_engine, r42_curriculum_targets,
                         R42_CURRICULUM_TARGETS, 1, R42_CONTROL_MODEL,
                         &report->curriculum, identified_curriculum);
    if (!report->curriculum.exact) {
        set_error(error, error_capacity,
                  "curriculum must solve before library discovery");
        return R0_POLICY_ERROR;
    }
    for (target = 0; target < R42_CURRICULUM_TARGETS; ++target) {
        if (identified_curriculum[target] == UINT16_MAX) {
            set_error(error, error_capacity,
                      "curriculum identification is missing");
            return R0_POLICY_ERROR;
        }
        solutions[target] =
            curriculum_engine.programs[identified_curriculum[target]];
        report->curriculum_solution_tokens += solutions[target].base_length;
    }
    library_count = r42_learn_library(solutions, R42_CURRICULUM_TARGETS, 0,
                                      library);
    shuffled_count = r42_learn_library(solutions, R42_CURRICULUM_TARGETS, 1,
                                       shuffled_library);
    report->learned_library_entries = library_count;
    report->learned_library_definition_tokens = 0;
    report->learned_library_occurrences = 0;
    report->learned_library_mdl_gain = 0;
    for (target = 0; target < library_count; ++target) {
        report->learned_library_definition_tokens += library[target].length;
        report->learned_library_occurrences += library[target].occurrences;
        report->learned_library_mdl_gain += library[target].mdl_gain;
    }
    compressed_tokens = r42_compressed_corpus_tokens(solutions,
        R42_CURRICULUM_TARGETS, library, library_count, &library_uses);
    report->library_digest = r42_library_digest(library, library_count);
    frozen_library_digest = report->library_digest;
    status = r42_build_engine(&library_engine, library, library_count, 2,
                              R42_MAX_TOKENS, error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&base_depth_four, NULL, 0, 4, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&sealed_plan_engine, library, library_count, 3,
                              R42_MAX_TOKENS, error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&no_library_engine, NULL, 0, 3, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&shuffled_engine, shuffled_library,
                              shuffled_count, 2, R42_MAX_TOKENS,
                              error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&single_use_engine, library, library_count, 2,
                              1, error, error_capacity);
    if (status != R0_OK) return status;

    report->development_target_programs = r42_make_development_targets(
        library, &library_engine, &base_depth_four, development_targets,
        &report->development_base_tokens,
        &report->development_library_tokens);
    r42_evaluate_targets(&library_engine, development_targets,
        (uint16_t)report->development_target_programs,
        R42_DEVELOPMENT_VARIANTS, R42_CONTROL_MODEL,
        &report->development, NULL);
    r42_evaluate_targets(&base_depth_four, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_SEMANTIC_ORACLE, &control, NULL);
    report->semantic_oracle_control_passed = control.exact;
    r42_evaluate_targets(&no_library_engine, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_MODEL, &control, NULL);
    report->no_library_control_passed = (uint8_t)!control.exact;
    r42_evaluate_targets(&shuffled_engine, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_MODEL, &control, NULL);
    report->shuffled_curriculum_control_passed = (uint8_t)!control.exact;
    r42_evaluate_targets(&single_use_engine, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_MODEL, &control, NULL);
    report->single_use_library_control_passed = (uint8_t)!control.exact;
    r42_evaluate_targets(&library_engine, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_CURRICULUM_LOOKUP, &control, NULL);
    report->curriculum_lookup_control_passed = (uint8_t)!control.exact;
    r42_evaluate_targets(&library_engine, development_targets,
        (uint16_t)report->development_target_programs, 1,
        R42_CONTROL_NO_QUERY, &control, NULL);
    report->no_query_control_passed = (uint8_t)!control.exact;

    report->frozen_base_programs = 170;
    report->curriculum_raw_programs = curriculum_engine.raw_programs;
    report->curriculum_canonical_programs = curriculum_engine.program_count;
    report->development_raw_programs = library_engine.raw_programs;
    report->development_canonical_programs = library_engine.program_count;
    report->base_depth_four_raw_programs = base_depth_four.raw_programs;
    report->planned_sealed_raw_programs = sealed_plan_engine.raw_programs;
    report->planned_sealed_base_raw_programs = 55987u;
    report->sealed.target_programs = r42_make_sealed_targets(
        &sealed_plan_engine, NULL, &report->sealed_base_tokens,
        &report->sealed_library_tokens);
    report->frozen_base_certificate_passed = r42_certify_frozen_base();
    report->affine_certificate_passed = (uint8_t)(
        curriculum_engine.affine_certificate_passed &&
        library_engine.affine_certificate_passed &&
        base_depth_four.affine_certificate_passed &&
        sealed_plan_engine.affine_certificate_passed);
    report->library_discovery_certificate_passed = (uint8_t)(
        r42_library_matches_contract(library, library_count) &&
        library_uses == 9u &&
        report->learned_library_mdl_gain > 0u &&
        report->curriculum.exact);
    report->library_freeze_certificate_passed = (uint8_t)(
        frozen_library_digest == r42_library_digest(library, library_count));
    report->compression_certificate_passed = (uint8_t)(
        compressed_tokens + report->learned_library_definition_tokens <
            report->curriculum_solution_tokens &&
        report->development_library_tokens +
            report->learned_library_definition_tokens <
            report->development_base_tokens);
    report->search_budget_certificate_passed = (uint8_t)(
        library_engine.raw_programs <= R42_SEARCH_BUDGET &&
        base_depth_four.raw_programs > R42_SEARCH_BUDGET &&
        report->development_target_programs >= 3u);
    report->sealed_execution_locked = 1;
    report->development_gate_passed = (uint8_t)(
        report->frozen_base_certificate_passed &&
        report->affine_certificate_passed &&
        report->library_discovery_certificate_passed &&
        report->library_freeze_certificate_passed &&
        report->compression_certificate_passed &&
        report->search_budget_certificate_passed &&
        report->semantic_oracle_control_passed &&
        report->no_library_control_passed &&
        report->shuffled_curriculum_control_passed &&
        report->single_use_library_control_passed &&
        report->curriculum_lookup_control_passed &&
        report->no_query_control_passed &&
        report->development.exact &&
        report->sealed.target_programs > 0u);
    report->result_digest = r42_experiment_digest(report);
    if (!report->development_gate_passed) {
        if (error != NULL && error_capacity > 0)
            (void)snprintf(error, error_capacity,
                "Reasoner 4.2 gate failed: library=%u uses=%u gain=%u "
                "targets=%u raw=%u base4=%u curriculum=%u development=%u "
                "certificates=%u%u%u%u%u%u controls=%u%u%u%u%u%u",
                report->learned_library_entries,
                report->learned_library_occurrences,
                report->learned_library_mdl_gain,
                report->development_target_programs,
                report->development_raw_programs,
                report->base_depth_four_raw_programs,
                report->curriculum.exact, report->development.exact,
                report->frozen_base_certificate_passed,
                report->affine_certificate_passed,
                report->library_discovery_certificate_passed,
                report->library_freeze_certificate_passed,
                report->compression_certificate_passed,
                report->search_budget_certificate_passed,
                report->semantic_oracle_control_passed,
                report->no_library_control_passed,
                report->shuffled_curriculum_control_passed,
                report->single_use_library_control_passed,
                report->curriculum_lookup_control_passed,
                report->no_query_control_passed);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r42_run_sealed(R42ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R42Engine curriculum_engine;
    R42Engine sealed_engine;
    R42Engine no_library_engine;
    R42Engine shuffled_engine;
    R42Engine single_use_engine;
    R42Program solutions[R42_CURRICULUM_TARGETS];
    uint16_t identified_curriculum[R42_CURRICULUM_TARGETS];
    R42Macro library[R42_LIBRARY_SIZE];
    R42Macro shuffled_library[R42_LIBRARY_SIZE];
    R42Target targets[R42_SEALED_TARGETS];
    R42Evaluation control;
    uint8_t library_count;
    uint8_t shuffled_count;
    uint16_t target;
    uint32_t base_raw_programs = 0;
    uint32_t base_tokens = 0;
    uint32_t library_tokens = 0;
    R0Status status;

    status = r42_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&curriculum_engine, NULL, 0, 3, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    r42_evaluate_targets(&curriculum_engine, r42_curriculum_targets,
                         R42_CURRICULUM_TARGETS, 1, R42_CONTROL_MODEL,
                         &control, identified_curriculum);
    if (!control.exact) {
        set_error(error, error_capacity,
                  "sealed library curriculum replay failed");
        return R0_POLICY_ERROR;
    }
    for (target = 0; target < R42_CURRICULUM_TARGETS; ++target) {
        if (identified_curriculum[target] == UINT16_MAX) {
            set_error(error, error_capacity,
                      "sealed curriculum identification is missing");
            return R0_POLICY_ERROR;
        }
        solutions[target] =
            curriculum_engine.programs[identified_curriculum[target]];
    }
    library_count = r42_learn_library(solutions, R42_CURRICULUM_TARGETS, 0,
                                      library);
    shuffled_count = r42_learn_library(solutions, R42_CURRICULUM_TARGETS, 1,
                                       shuffled_library);
    if (!r42_library_matches_contract(library, library_count) ||
        r42_library_digest(library, library_count) != report->library_digest) {
        set_error(error, error_capacity,
                  "sealed library differs from the frozen library");
        return R0_POLICY_ERROR;
    }
    status = r42_build_engine(&sealed_engine, library, library_count, 3,
                              R42_MAX_TOKENS, error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&no_library_engine, NULL, 0, 3, 0,
                              error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&shuffled_engine, shuffled_library,
                              shuffled_count, 3, R42_MAX_TOKENS,
                              error, error_capacity);
    if (status != R0_OK) return status;
    status = r42_build_engine(&single_use_engine, library, library_count, 3,
                              1, error, error_capacity);
    if (status != R0_OK) return status;

    report->sealed.target_programs = r42_make_sealed_targets(
        &sealed_engine, targets, &base_tokens, &library_tokens);
    if (report->sealed.target_programs != R42_SEALED_TARGETS) {
        set_error(error, error_capacity,
                  "sealed target census differs from the frozen census");
        return R0_POLICY_ERROR;
    }
    report->sealed_base_tokens = base_tokens;
    report->sealed_library_tokens = library_tokens;
    report->sealed_minimum_certificate_passed =
        r42_certify_sealed_base_minimum(targets,
                                        (uint16_t)report->sealed.target_programs,
                                        &base_raw_programs);
    report->planned_sealed_base_raw_programs = base_raw_programs;

    r42_evaluate_targets(&sealed_engine, targets,
        (uint16_t)report->sealed.target_programs, R42_SEALED_VARIANTS,
        R42_CONTROL_MODEL, &report->sealed, NULL);
    r42_evaluate_targets(&no_library_engine, targets,
        (uint16_t)report->sealed.target_programs, 1, R42_CONTROL_MODEL,
        &control, NULL);
    report->no_library_control_passed = (uint8_t)(
        report->no_library_control_passed && !control.exact);
    r42_evaluate_targets(&shuffled_engine, targets,
        (uint16_t)report->sealed.target_programs, 1, R42_CONTROL_MODEL,
        &control, NULL);
    report->shuffled_curriculum_control_passed = (uint8_t)(
        report->shuffled_curriculum_control_passed && !control.exact);
    r42_evaluate_targets(&single_use_engine, targets,
        (uint16_t)report->sealed.target_programs, 1, R42_CONTROL_MODEL,
        &control, NULL);
    report->single_use_library_control_passed = (uint8_t)(
        report->single_use_library_control_passed && !control.exact);
    r42_evaluate_targets(&sealed_engine, targets,
        (uint16_t)report->sealed.target_programs, 1,
        R42_CONTROL_CURRICULUM_LOOKUP, &control, NULL);
    report->curriculum_lookup_control_passed = (uint8_t)(
        report->curriculum_lookup_control_passed && !control.exact);
    r42_evaluate_targets(&sealed_engine, targets,
        (uint16_t)report->sealed.target_programs, 1,
        R42_CONTROL_NO_QUERY, &control, NULL);
    report->no_query_control_passed = (uint8_t)(
        report->no_query_control_passed && !control.exact);
    report->semantic_oracle_control_passed = (uint8_t)(
        report->semantic_oracle_control_passed &&
        report->sealed_minimum_certificate_passed);
    report->sealed_gate_passed = (uint8_t)(
        report->development_gate_passed &&
        report->library_digest == UINT64_C(0x3cf6bb033d68d2a3) &&
        report->planned_sealed_raw_programs == 820u &&
        report->planned_sealed_base_raw_programs == 55987u &&
        report->sealed.target_programs == R42_SEALED_TARGETS &&
        report->sealed_base_tokens == 102u &&
        report->sealed_library_tokens == 51u &&
        report->sealed_minimum_certificate_passed &&
        report->semantic_oracle_control_passed &&
        report->no_library_control_passed &&
        report->shuffled_curriculum_control_passed &&
        report->single_use_library_control_passed &&
        report->curriculum_lookup_control_passed &&
        report->no_query_control_passed &&
        report->sealed.episodes ==
            R42_SEALED_TARGETS * R42_SEALED_VARIANTS &&
        report->sealed.maximum_queries <= R42_SEALED_MAXIMUM_QUERIES &&
        report->sealed.exact);
    report->result_digest = r42_sealed_digest(report);
    if (!report->sealed_gate_passed) {
        if (error != NULL && error_capacity > 0)
            (void)snprintf(error, error_capacity,
                "Reasoner 4.2 sealed gate failed: targets=%u episodes=%u "
                "queries=%u raw=%u base=%u exact=%u minimum=%u "
                "controls=%u%u%u%u%u%u",
                report->sealed.target_programs, report->sealed.episodes,
                report->sealed.maximum_queries,
                report->planned_sealed_raw_programs,
                report->planned_sealed_base_raw_programs,
                report->sealed.exact,
                report->sealed_minimum_certificate_passed,
                report->semantic_oracle_control_passed,
                report->no_library_control_passed,
                report->shuffled_curriculum_control_passed,
                report->single_use_library_control_passed,
                report->curriculum_lookup_control_passed,
                report->no_query_control_passed);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int r42_write_evaluation(FILE *file,
                                const R42Evaluation *evaluation)
{
    return fprintf(file,
        "{\"target_programs\":%u,\"episodes\":%u,"
        "\"demonstrations\":%u,\"queries\":%u,"
        "\"exact_queries\":%u,\"identifications\":%u,"
        "\"exact_identifications\":%u,\"commits\":%u,"
        "\"exact_commits\":%u,\"premature_commits\":%u,"
        "\"replay_checks\":%u,\"exact_replays\":%u,"
        "\"applications\":%u,\"exact_applications\":%u,"
        "\"reports\":%u,\"exact_reports\":%u,"
        "\"maximum_queries\":%u,\"exact\":%s}",
        evaluation->target_programs, evaluation->episodes,
        evaluation->demonstrations, evaluation->queries,
        evaluation->exact_queries, evaluation->identifications,
        evaluation->exact_identifications, evaluation->commits,
        evaluation->exact_commits, evaluation->premature_commits,
        evaluation->replay_checks, evaluation->exact_replays,
        evaluation->applications, evaluation->exact_applications,
        evaluation->reports, evaluation->exact_reports,
        evaluation->maximum_queries,
        evaluation->exact ? "true" : "false");
}

R0Status r42_write_result(const R42ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    int failed = 0;
    if (report == NULL || path == NULL) {
        set_error(error, error_capacity,
                  "Reasoner 4.2 report and path are required");
        return R0_INVALID_ARGUMENT;
    }
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity,
                  "cannot open Reasoner 4.2 result path");
        return R0_IO_ERROR;
    }
    if (fprintf(file,
        "{\n  \"schema\": \"zero.reasoner42_abstraction_library.v1\",\n"
        "  \"version\": \"4.2\",\n"
        "  \"frozen_base_programs\": %u,\n"
        "  \"curriculum_raw_programs\": %u,\n"
        "  \"curriculum_canonical_programs\": %u,\n"
        "  \"curriculum_solution_tokens\": %u,\n"
        "  \"learned_library_entries\": %u,\n"
        "  \"learned_library_definition_tokens\": %u,\n"
        "  \"learned_library_occurrences\": %u,\n"
        "  \"learned_library_mdl_gain\": %u,\n"
        "  \"development_raw_programs\": %u,\n"
        "  \"development_canonical_programs\": %u,\n"
        "  \"development_target_programs\": %u,\n"
        "  \"development_base_tokens\": %u,\n"
        "  \"development_library_tokens\": %u,\n"
        "  \"base_depth_four_raw_programs\": %u,\n"
        "  \"planned_sealed_raw_programs\": %u,\n"
        "  \"planned_sealed_base_raw_programs\": %u,\n"
        "  \"sealed_base_tokens\": %u,\n"
        "  \"sealed_library_tokens\": %u,\n"
        "  \"frozen_base_certificate_passed\": %s,\n"
        "  \"affine_certificate_passed\": %s,\n"
        "  \"library_discovery_certificate_passed\": %s,\n"
        "  \"library_freeze_certificate_passed\": %s,\n"
        "  \"compression_certificate_passed\": %s,\n"
        "  \"search_budget_certificate_passed\": %s,\n"
        "  \"semantic_oracle_control_passed\": %s,\n"
        "  \"no_library_control_passed\": %s,\n"
        "  \"shuffled_curriculum_control_passed\": %s,\n"
        "  \"single_use_library_control_passed\": %s,\n"
        "  \"curriculum_lookup_control_passed\": %s,\n"
        "  \"no_query_control_passed\": %s,\n"
        "  \"sealed_minimum_certificate_passed\": %s,\n"
        "  \"development_gate_passed\": %s,\n"
        "  \"sealed_gate_passed\": %s,\n"
        "  \"sealed_execution_locked\": %s,\n"
        "  \"library_digest\": \"%016" PRIx64 "\",\n"
        "  \"result_digest\": \"%016" PRIx64 "\",\n"
        "  \"curriculum\": ",
        report->frozen_base_programs,
        report->curriculum_raw_programs,
        report->curriculum_canonical_programs,
        report->curriculum_solution_tokens,
        report->learned_library_entries,
        report->learned_library_definition_tokens,
        report->learned_library_occurrences,
        report->learned_library_mdl_gain,
        report->development_raw_programs,
        report->development_canonical_programs,
        report->development_target_programs,
        report->development_base_tokens,
        report->development_library_tokens,
        report->base_depth_four_raw_programs,
        report->planned_sealed_raw_programs,
        report->planned_sealed_base_raw_programs,
        report->sealed_base_tokens,
        report->sealed_library_tokens,
        report->frozen_base_certificate_passed ? "true" : "false",
        report->affine_certificate_passed ? "true" : "false",
        report->library_discovery_certificate_passed ? "true" : "false",
        report->library_freeze_certificate_passed ? "true" : "false",
        report->compression_certificate_passed ? "true" : "false",
        report->search_budget_certificate_passed ? "true" : "false",
        report->semantic_oracle_control_passed ? "true" : "false",
        report->no_library_control_passed ? "true" : "false",
        report->shuffled_curriculum_control_passed ? "true" : "false",
        report->single_use_library_control_passed ? "true" : "false",
        report->curriculum_lookup_control_passed ? "true" : "false",
        report->no_query_control_passed ? "true" : "false",
        report->sealed_minimum_certificate_passed ? "true" : "false",
        report->development_gate_passed ? "true" : "false",
        report->sealed_gate_passed ? "true" : "false",
        report->sealed_execution_locked ? "true" : "false",
        report->library_digest, report->result_digest) < 0)
        failed = 1;
    if (!failed && r42_write_evaluation(file, &report->curriculum) < 0)
        failed = 1;
    if (!failed && fprintf(file, ",\n  \"development\": ") < 0)
        failed = 1;
    if (!failed && r42_write_evaluation(file, &report->development) < 0)
        failed = 1;
    if (!failed && fprintf(file, ",\n  \"sealed\": ") < 0)
        failed = 1;
    if (!failed && report->sealed.episodes > 0) {
        if (r42_write_evaluation(file, &report->sealed) < 0)
            failed = 1;
    } else if (!failed && fprintf(file,
        "{\"target_programs\":%u,\"executed\":false}",
        report->sealed.target_programs) < 0) {
        failed = 1;
    }
    if (!failed && fprintf(file, "\n}\n") < 0)
        failed = 1;
    if (fclose(file) != 0) failed = 1;
    if (failed) {
        set_error(error, error_capacity,
                  "cannot write Reasoner 4.2 result");
        return R0_IO_ERROR;
    }
    return R0_OK;
}
