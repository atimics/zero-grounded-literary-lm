#include "reasoner33.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R33_FNV_OFFSET UINT64_C(1469598103934665603)
#define R33_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    uint8_t dimensions;
    uint16_t target_mask;
    uint16_t invariant_mask;
    uint16_t optimal_actions;
    R33Witness witness;
} R33Case;

typedef struct {
    R33Case cases[R33_MAX_CASES];
    uint32_t count;
} R33Corpus;

typedef struct {
    uint16_t mask;
    uint16_t legal;
    uint16_t optimal;
    R33Witness witness;
    int8_t full_action;
    int8_t masked_action;
} R33Decision;

typedef struct {
    uint16_t count;
    uint32_t indices[9];
    int16_t values[9];
} R33HashFeatures;

static const uint8_t R33_LOCAL_MASKS[8] = {
    0, 1, 2, 4, 8, 9, 6, 10,
};

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static int popcount16(uint16_t value)
{
    int count = 0;
    while (value != 0) {
        count += value & 1U;
        value >>= 1;
    }
    return count;
}

static uint32_t integer_power(uint32_t base, uint8_t exponent)
{
    uint32_t value = 1;
    while (exponent-- > 0) value *= base;
    return value;
}

uint32_t r33_program_count(uint8_t dimensions)
{
    if (dimensions < 1 || dimensions > R33_MAX_DIMENSIONS) return 0;
    return integer_power(8, dimensions) - 1U;
}

static uint32_t state_count(uint8_t dimensions)
{
    return integer_power(5, dimensions);
}

static uint16_t program_target(uint8_t dimensions, uint32_t program_index)
{
    uint32_t code = program_index + 1U;
    uint16_t mask = 0;
    int dimension;
    for (dimension = dimensions - 1; dimension >= 0; --dimension) {
        uint8_t local = R33_LOCAL_MASKS[code % 8U];
        mask |= (uint16_t)local << (dimension * R33_ATOMS_PER_DIMENSION);
        code /= 8U;
    }
    return mask;
}

static R33State state_from_index(uint8_t dimensions, uint32_t index)
{
    R33State state;
    int dimension;
    memset(&state, 0, sizeof(state));
    for (dimension = dimensions - 1; dimension >= 0; --dimension) {
        state.values[dimension] =
            (int8_t)(R33_DOMAIN_MIN + (int)(index % 5U));
        index /= 5U;
    }
    return state;
}

static uint32_t pack_state(uint8_t dimensions, const R33State *state)
{
    uint32_t packed = 0;
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension)
        packed = packed * 5U +
                 (uint32_t)(state->values[dimension] - R33_DOMAIN_MIN);
    return packed;
}

static int atom_coefficient(int atom)
{
    return atom % 4 < 2 ? 1 : -1;
}

static int atom_constant(int atom)
{
    return atom % 2 == 0 ? -1 : 1;
}

static int atom_holds(int atom, const R33State *state)
{
    int dimension = atom / R33_ATOMS_PER_DIMENSION;
    return atom_coefficient(atom) * state->values[dimension] <=
           atom_constant(atom);
}

static int invariant_holds(uint8_t dimensions, uint16_t mask,
                           const R33State *state)
{
    int atom;
    for (atom = 0; atom < dimensions * R33_ATOMS_PER_DIMENSION; ++atom)
        if ((mask & (UINT16_C(1) << atom)) != 0 &&
            !atom_holds(atom, state))
            return 0;
    return 1;
}

static void target_bounds(uint8_t dimensions, uint16_t target,
                          int8_t low[R33_MAX_DIMENSIONS],
                          int8_t high[R33_MAX_DIMENSIONS])
{
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension) {
        uint8_t local =
            (uint8_t)((target >> (dimension * 4)) & UINT16_C(0x0f));
        low[dimension] = R33_DOMAIN_MIN;
        high[dimension] = R33_DOMAIN_MAX;
        if ((local & 1U) != 0) high[dimension] = -1;
        if ((local & 2U) != 0) high[dimension] = 1;
        if ((local & 4U) != 0) low[dimension] = 1;
        if ((local & 8U) != 0) low[dimension] = -1;
    }
}

static R33State initial_state(uint8_t dimensions, uint16_t target)
{
    int8_t low[R33_MAX_DIMENSIONS], high[R33_MAX_DIMENSIONS];
    R33State state;
    uint8_t dimension;
    memset(&state, 0, sizeof(state));
    target_bounds(dimensions, target, low, high);
    for (dimension = 0; dimension < dimensions; ++dimension)
        state.values[dimension] = low[dimension];
    return state;
}

static R33State nearest_safe_state(uint8_t dimensions, uint16_t target,
                                   const R33State *source)
{
    int8_t low[R33_MAX_DIMENSIONS], high[R33_MAX_DIMENSIONS];
    R33State nearest = *source;
    uint8_t dimension;
    target_bounds(dimensions, target, low, high);
    for (dimension = 0; dimension < dimensions; ++dimension) {
        if (nearest.values[dimension] < low[dimension])
            nearest.values[dimension] = low[dimension];
        if (nearest.values[dimension] > high[dimension])
            nearest.values[dimension] = high[dimension];
    }
    return nearest;
}

static int distance_to_safe(uint8_t dimensions, uint16_t target,
                            const R33State *source)
{
    R33State nearest = nearest_safe_state(dimensions, target, source);
    int distance = 0;
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension)
        distance += abs(source->values[dimension] -
                        nearest.values[dimension]);
    return distance;
}

static R33State successor_state(uint8_t dimensions, uint16_t target,
                                const R33State *source)
{
    int8_t low[R33_MAX_DIMENSIONS], high[R33_MAX_DIMENSIONS];
    R33State next = *source;
    int dimension;
    target_bounds(dimensions, target, low, high);
    for (dimension = dimensions - 1; dimension >= 0; --dimension) {
        if (next.values[dimension] < high[dimension]) {
            ++next.values[dimension];
            return next;
        }
        next.values[dimension] = low[dimension];
    }
    return next;
}

static R0Status verify(uint8_t dimensions, uint16_t target,
                       uint16_t invariant, R33Verification *verification)
{
    uint32_t index, states;
    R33State initial;
    int best_distance = INT_MAX;
    int best = -1;
    if (dimensions < 1 || dimensions > R33_MAX_DIMENSIONS ||
        verification == NULL ||
        (invariant >> (dimensions * R33_ATOMS_PER_DIMENSION)) != 0)
        return R0_INVALID_ARGUMENT;
    memset(verification, 0, sizeof(*verification));
    initial = initial_state(dimensions, target);
    if (!invariant_holds(dimensions, invariant, &initial)) {
        verification->witness.kind = R31_WITNESS_POSITIVE;
        verification->witness.source = initial;
        verification->witness.target =
            successor_state(dimensions, target, &initial);
        return R0_OK;
    }
    states = state_count(dimensions);
    for (index = 0; index < states; ++index) {
        R33State candidate = state_from_index(dimensions, index);
        int distance;
        if (invariant_holds(dimensions, target, &candidate) ||
            !invariant_holds(dimensions, invariant, &candidate))
            continue;
        distance = distance_to_safe(dimensions, target, &candidate);
        if (distance < best_distance) {
            best = (int)index;
            best_distance = distance;
        }
    }
    if (best >= 0) {
        verification->witness.kind = R31_WITNESS_NEGATIVE;
        verification->witness.source =
            state_from_index(dimensions, (uint32_t)best);
        verification->witness.target = nearest_safe_state(
            dimensions, target, &verification->witness.source);
        return R0_OK;
    }
    for (index = 0; index < states; ++index) {
        R33State source = state_from_index(dimensions, index);
        R33State successor;
        if (!invariant_holds(dimensions, target, &source) ||
            !invariant_holds(dimensions, invariant, &source))
            continue;
        successor = successor_state(dimensions, target, &source);
        if (!invariant_holds(dimensions, invariant, &successor)) {
            verification->witness.kind = R31_WITNESS_IMPLICATION;
            verification->witness.source = source;
            verification->witness.target = successor;
            return R0_OK;
        }
    }
    verification->accepted = 1;
    verification->witness.kind = R31_WITNESS_VALID;
    return R0_OK;
}

static int witness_resolved(uint8_t dimensions, uint16_t mask,
                            const R33Witness *witness)
{
    if (witness->kind == R31_WITNESS_POSITIVE)
        return invariant_holds(dimensions, mask, &witness->source);
    if (witness->kind == R31_WITNESS_NEGATIVE)
        return !invariant_holds(dimensions, mask, &witness->source);
    if (witness->kind == R31_WITNESS_IMPLICATION)
        return !invariant_holds(dimensions, mask, &witness->source) ||
               invariant_holds(dimensions, mask, &witness->target);
    return 0;
}

static uint16_t progress_actions(uint8_t dimensions, uint16_t mask,
                                 const R33Witness *witness)
{
    uint16_t actions = 0;
    int atom;
    for (atom = 0; atom < dimensions * R33_ATOMS_PER_DIMENSION; ++atom) {
        uint16_t candidate =
            mask ^ (uint16_t)(UINT16_C(1) << atom);
        if (witness_resolved(dimensions, candidate, witness))
            actions |= (uint16_t)(UINT16_C(1) << atom);
    }
    return actions;
}

static int next_permutation(uint8_t *values, uint8_t count)
{
    int left = count - 2;
    int right = count - 1;
    while (left >= 0 && values[left] >= values[left + 1]) --left;
    if (left < 0) return 0;
    while (values[right] <= values[left]) --right;
    {
        uint8_t temporary = values[left];
        values[left] = values[right];
        values[right] = temporary;
    }
    for (right = count - 1, ++left; left < right; ++left, --right) {
        uint8_t temporary = values[left];
        values[left] = values[right];
        values[right] = temporary;
    }
    return 1;
}

static R33State transform_state(uint8_t dimensions, R33State state,
                                const uint8_t *permutation)
{
    R33State transformed;
    uint8_t dimension;
    memset(&transformed, 0, sizeof(transformed));
    for (dimension = 0; dimension < dimensions; ++dimension)
        transformed.values[dimension] =
            state.values[permutation[dimension]];
    return transformed;
}

static R33Witness transform_witness(uint8_t dimensions, R33Witness witness,
                                    const uint8_t *permutation)
{
    witness.source =
        transform_state(dimensions, witness.source, permutation);
    witness.target =
        transform_state(dimensions, witness.target, permutation);
    return witness;
}

static int transform_action(uint8_t dimensions, int action,
                            const uint8_t *permutation)
{
    int input_dimension = action / R33_ATOMS_PER_DIMENSION;
    int local = action % R33_ATOMS_PER_DIMENSION;
    uint8_t output_dimension;
    for (output_dimension = 0; output_dimension < dimensions;
         ++output_dimension)
        if (permutation[output_dimension] == input_dimension)
            return output_dimension * R33_ATOMS_PER_DIMENSION + local;
    return -1;
}

static uint16_t transform_mask(uint8_t dimensions, uint16_t mask,
                               const uint8_t *permutation)
{
    uint16_t transformed = 0;
    int atom;
    for (atom = 0; atom < dimensions * R33_ATOMS_PER_DIMENSION; ++atom)
        if ((mask & (UINT16_C(1) << atom)) != 0)
            transformed |= (uint16_t)(
                UINT16_C(1) <<
                transform_action(dimensions, atom, permutation));
    return transformed;
}

static uint64_t pack_witness(uint8_t dimensions,
                             const R33Witness *witness)
{
    uint64_t states = state_count(dimensions);
    return (uint64_t)witness->kind * states * states +
           (uint64_t)pack_state(dimensions, &witness->source) * states +
           pack_state(dimensions, &witness->target);
}

static int witness_less(uint8_t dimensions, const R33Witness *left,
                        const R33Witness *right)
{
    return pack_witness(dimensions, left) <
           pack_witness(dimensions, right);
}

static void canonicalize_context(uint8_t dimensions, uint16_t mask,
                                 const R33Witness *witness,
                                 uint16_t *canonical_mask,
                                 R33Witness *canonical_witness,
                                 uint8_t *best_permutation)
{
    uint8_t permutation[R33_MAX_DIMENSIONS];
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension)
        permutation[dimension] = dimension;
    *canonical_mask = transform_mask(dimensions, mask, permutation);
    *canonical_witness =
        transform_witness(dimensions, *witness, permutation);
    memcpy(best_permutation, permutation, dimensions);
    while (next_permutation(permutation, dimensions)) {
        uint16_t candidate_mask =
            transform_mask(dimensions, mask, permutation);
        R33Witness candidate_witness =
            transform_witness(dimensions, *witness, permutation);
        if (candidate_mask < *canonical_mask ||
            (candidate_mask == *canonical_mask &&
             witness_less(dimensions, &candidate_witness,
                          canonical_witness))) {
            *canonical_mask = candidate_mask;
            *canonical_witness = candidate_witness;
            memcpy(best_permutation, permutation, dimensions);
        }
    }
}

static int local_width(uint16_t mask, int action)
{
    int dimension = action / R33_ATOMS_PER_DIMENSION;
    int count = 0, value;
    R33State state;
    memset(&state, 0, sizeof(state));
    for (value = R33_DOMAIN_MIN; value <= R33_DOMAIN_MAX; ++value) {
        int local;
        state.values[dimension] = (int8_t)value;
        for (local = 0; local < R33_ATOMS_PER_DIMENSION; ++local) {
            int atom = dimension * R33_ATOMS_PER_DIMENSION + local;
            if ((mask & (UINT16_C(1) << atom)) != 0 &&
                !atom_holds(atom, &state))
                break;
        }
        if (local == R33_ATOMS_PER_DIMENSION) ++count;
    }
    return count;
}

static void semantic_features(uint8_t dimensions, uint16_t mask,
                              const R33Witness *witness, int action,
                              uint8_t feedback_mode,
                              int16_t features[R33_FEATURE_COUNT])
{
    uint16_t bit = (uint16_t)(UINT16_C(1) << action);
    uint16_t candidate = mask ^ bit;
    int adding = (mask & bit) == 0;
    int coefficient = atom_coefficient(action);
    int constant = atom_constant(action);
    int dimension = action / R33_ATOMS_PER_DIMENSION;
    memset(features, 0, R33_FEATURE_COUNT * sizeof(features[0]));
    features[0] = 1;
    features[1] = (int16_t)adding;
    features[2] = (int16_t)!adding;
    features[15] = (int16_t)local_width(candidate, action);
    if (feedback_mode != R31_FEEDBACK_FULL) return;
    features[3] = (int16_t)atom_holds(action, &witness->source);
    features[4] = (int16_t)atom_holds(action, &witness->target);
    features[5] = (int16_t)(constant - coefficient *
                            witness->source.values[dimension]);
    features[6] = (int16_t)(constant - coefficient *
                            witness->target.values[dimension]);
    features[7] = (int16_t)(witness->kind == R31_WITNESS_POSITIVE);
    features[8] = (int16_t)(witness->kind == R31_WITNESS_NEGATIVE);
    features[9] = (int16_t)(witness->kind == R31_WITNESS_IMPLICATION);
    features[10] = (int16_t)(features[8] && features[4]);
    features[11] = (int16_t)(features[8] ? features[6] : 0);
    features[12] = (int16_t)(features[7] && !adding && features[3]);
    features[13] =
        (int16_t)(features[9] && adding && !features[3]);
    features[14] =
        (int16_t)(features[9] && !adding && !features[4]);
    (void)dimensions;
}

static int64_t semantic_score(const R33Model *model,
                              const int16_t *features)
{
    int64_t score = 0;
    int feature;
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        score += (int64_t)model->weights[feature] * features[feature];
    return score;
}

static int canonical_action(uint8_t dimensions, uint16_t mask,
                            const R33Witness *witness, int action)
{
    uint16_t ignored_mask;
    R33Witness ignored_witness;
    uint8_t permutation[R33_MAX_DIMENSIONS];
    canonicalize_context(dimensions, mask, witness, &ignored_mask,
                         &ignored_witness, permutation);
    return transform_action(dimensions, action, permutation);
}

static int semantic_select(const R33Model *model, uint8_t dimensions,
                           uint16_t mask, const R33Witness *witness,
                           uint8_t feedback_mode)
{
    uint16_t legal = progress_actions(dimensions, mask, witness);
    uint16_t ignored_mask;
    R33Witness ignored_witness;
    uint8_t permutation[R33_MAX_DIMENSIONS];
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    canonicalize_context(dimensions, mask, witness, &ignored_mask,
                         &ignored_witness, permutation);
    for (action = 0; action < dimensions * R33_ATOMS_PER_DIMENSION;
         ++action) {
        int16_t features[R33_FEATURE_COUNT];
        int64_t score;
        if ((legal & (UINT16_C(1) << action)) == 0) continue;
        if (feedback_mode == R31_FEEDBACK_TOOL_ONLY) {
            score = 0;
        } else {
            semantic_features(dimensions, mask, witness, action,
                              feedback_mode, features);
            score = semantic_score(model, features);
        }
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              transform_action(dimensions, action, permutation) <
                  transform_action(dimensions, best, permutation)))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static R0Status corpus_add(R33Corpus *corpus, uint8_t dimensions,
                           uint16_t target, uint16_t mask)
{
    R33Verification verification;
    uint16_t legal, optimal;
    uint32_t index;
    if (verify(dimensions, target, mask, &verification) != R0_OK)
        return R0_VERIFIER_ERROR;
    if (verification.accepted) return R0_OK;
    legal = progress_actions(dimensions, mask, &verification.witness);
    optimal = legal & (uint16_t)(target ^ mask);
    if (optimal == 0) return R0_OK;
    for (index = 0; index < corpus->count; ++index)
        if (corpus->cases[index].dimensions == dimensions &&
            corpus->cases[index].target_mask == target &&
            corpus->cases[index].invariant_mask == mask)
            return R0_OK;
    if (corpus->count >= R33_MAX_CASES) return R0_LIMIT_ERROR;
    corpus->cases[corpus->count].dimensions = dimensions;
    corpus->cases[corpus->count].target_mask = target;
    corpus->cases[corpus->count].invariant_mask = mask;
    corpus->cases[corpus->count].optimal_actions = optimal;
    corpus->cases[corpus->count].witness = verification.witness;
    ++corpus->count;
    return R0_OK;
}

static R0Status build_corpus(uint8_t maximum_dimensions, R33Corpus *corpus)
{
    uint8_t dimensions;
    memset(corpus, 0, sizeof(*corpus));
    for (dimensions = 1; dimensions <= maximum_dimensions; ++dimensions) {
        uint32_t program;
        int atom_count = dimensions * R33_ATOMS_PER_DIMENSION;
        for (program = 0; program < r33_program_count(dimensions);
             ++program) {
            uint16_t target = program_target(dimensions, program);
            int first, second, extra;
            R0Status status = corpus_add(corpus, dimensions, target, 0);
            if (status != R0_OK) return status;
            for (first = 0; first < atom_count; ++first) {
                uint16_t first_bit =
                    (uint16_t)(UINT16_C(1) << first);
                uint16_t changed = target ^ first_bit;
                status = corpus_add(corpus, dimensions, target, changed);
                if (status != R0_OK) return status;
                if ((target & first_bit) == 0) continue;
                for (second = first + 1; second < atom_count; ++second) {
                    uint16_t second_bit =
                        (uint16_t)(UINT16_C(1) << second);
                    if ((target & second_bit) == 0) continue;
                    status = corpus_add(corpus, dimensions, target,
                                        target ^ first_bit ^ second_bit);
                    if (status != R0_OK) return status;
                }
                for (extra = 0; extra < atom_count; ++extra) {
                    uint16_t extra_bit =
                        (uint16_t)(UINT16_C(1) << extra);
                    if ((target & extra_bit) != 0) continue;
                    status = corpus_add(
                        corpus, dimensions, target,
                        (uint16_t)((target ^ first_bit) | extra_bit));
                    if (status != R0_OK) return status;
                }
            }
        }
    }
    return R0_OK;
}

static int best_target(const R33Model *model, const R33Case *item)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0;
         action < item->dimensions * R33_ATOMS_PER_DIMENSION; ++action) {
        int16_t features[R33_FEATURE_COUNT];
        int64_t score;
        if ((item->optimal_actions & (UINT16_C(1) << action)) == 0)
            continue;
        semantic_features(item->dimensions, item->invariant_mask,
                          &item->witness, action, R31_FEEDBACK_FULL,
                          features);
        score = semantic_score(model, features);
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              canonical_action(item->dimensions, item->invariant_mask,
                               &item->witness, action) <
                  canonical_action(item->dimensions,
                                   item->invariant_mask,
                                   &item->witness, best)))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static void update_action(R33Model *model, const R33Case *item, int action,
                          int direction)
{
    int16_t features[R33_FEATURE_COUNT];
    int feature;
    semantic_features(item->dimensions, item->invariant_mask,
                      &item->witness, action, R31_FEEDBACK_FULL, features);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        model->weights[feature] += direction * features[feature];
}

void r33_model_init(R33Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

R0Status r33_train(R33Model *model, uint8_t maximum_dimensions,
                   R33TrainingReport *report, char *error,
                   size_t error_capacity)
{
    R33Corpus *corpus;
    uint8_t stage;
    uint32_t total_epochs = 0, total_mistakes = 0;
    if (model == NULL || report == NULL || maximum_dimensions < 1 ||
        maximum_dimensions >= R33_MAX_DIMENSIONS)
        return R0_INVALID_ARGUMENT;
    r33_model_init(model);
    memset(report, 0, sizeof(*report));
    corpus = malloc(sizeof(*corpus));
    if (corpus == NULL) return R0_LIMIT_ERROR;
    for (stage = 1; stage <= maximum_dimensions; ++stage) {
        uint32_t epoch;
        R0Status status = build_corpus(stage, corpus);
        if (status != R0_OK) {
            free(corpus);
            return status;
        }
        for (epoch = 0; epoch < R33_MAX_EPOCHS; ++epoch) {
            uint32_t index, mistakes = 0;
            for (index = 0; index < corpus->count; ++index) {
                R33Case *item = &corpus->cases[index];
                int predicted = semantic_select(
                    model, item->dimensions, item->invariant_mask,
                    &item->witness, R31_FEEDBACK_FULL);
                if (predicted >= 0 &&
                    (item->optimal_actions &
                     (UINT16_C(1) << predicted)) != 0)
                    continue;
                {
                    int target = best_target(model, item);
                    if (target < 0 || predicted < 0) {
                        free(corpus);
                        return R0_POLICY_ERROR;
                    }
                    update_action(model, item, target, 1);
                    update_action(model, item, predicted, -1);
                    ++mistakes;
                }
            }
            ++total_epochs;
            total_mistakes += mistakes;
            if (mistakes == 0) break;
        }
        model->trained_dimensions = stage;
    }
    report->cases = corpus->count;
    report->epochs = total_epochs;
    report->mistakes = total_mistakes;
    report->maximum_training_dimensions = maximum_dimensions;
    {
        uint32_t index;
        for (index = 0; index < corpus->count; ++index) {
            R33Case *item = &corpus->cases[index];
            int action = semantic_select(model, item->dimensions,
                                         item->invariant_mask,
                                         &item->witness,
                                         R31_FEEDBACK_FULL);
            if (action < 0 ||
                (item->optimal_actions &
                 (UINT16_C(1) << action)) == 0)
                ++report->final_errors;
        }
        for (index = 0; index < R33_FEATURE_COUNT; ++index)
            if (model->weights[index] != 0) ++report->nonzero_weights;
    }
    report->active_weight_bytes =
        R33_FEATURE_COUNT * (uint32_t)sizeof(model->weights[0]);
    free(corpus);
    if (report->final_errors != 0) {
        set_error(error, error_capacity,
                  "shared policy has %u final training errors",
                  report->final_errors);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int check_permutations(const R33Model *model, uint8_t dimensions,
                              uint16_t mask, const R33Witness *witness,
                              int action, uint32_t *cases,
                              uint32_t *exact)
{
    uint8_t permutation[R33_MAX_DIMENSIONS];
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension)
        permutation[dimension] = dimension;
    while (next_permutation(permutation, dimensions)) {
        uint16_t changed_mask =
            transform_mask(dimensions, mask, permutation);
        R33Witness changed_witness =
            transform_witness(dimensions, *witness, permutation);
        int changed_action = semantic_select(
            model, dimensions, changed_mask, &changed_witness,
            R31_FEEDBACK_FULL);
        ++*cases;
        if (changed_action ==
            transform_action(dimensions, action, permutation))
            ++*exact;
    }
    return 1;
}

R0Status r33_evaluate(const R33Model *model, uint8_t dimensions,
                      uint8_t feedback_mode, R33Evaluation *report,
                      char *error, size_t error_capacity)
{
    uint32_t program;
    if (model == NULL || report == NULL || dimensions < 1 ||
        dimensions > R33_MAX_DIMENSIONS ||
        feedback_mode > R31_FEEDBACK_TOOL_ONLY)
        return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    report->dimensions = dimensions;
    report->programs = r33_program_count(dimensions);
    for (program = 0; program < report->programs; ++program) {
        uint16_t target = program_target(dimensions, program);
        uint16_t mask = 0;
        uint32_t calls = 0;
        int accepted = 0;
        while (calls <= R33_MAX_STEPS) {
            R33Verification verification;
            int action;
            if (verify(dimensions, target, mask, &verification) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (verification.accepted) {
                accepted = 1;
                break;
            }
            if (calls == R33_MAX_STEPS) break;
            action = semantic_select(model, dimensions, mask,
                                     &verification.witness,
                                     feedback_mode);
            if (action < 0) break;
            if (feedback_mode == R31_FEEDBACK_FULL)
                (void)check_permutations(
                    model, dimensions, mask, &verification.witness,
                    action, &report->permutation_cases,
                    &report->permutation_exact);
            mask ^= (uint16_t)(UINT16_C(1) << action);
            ++calls;
        }
        report->verifier_calls += calls;
        if (!accepted) {
            if (getenv("R33_TRACE_FAILURES") != NULL)
                fprintf(stderr,
                        "R33 failure dimensions=%u program=%u "
                        "target=0x%04x mask=0x%04x calls=%u mode=%u\n",
                        dimensions, program, target, mask, calls,
                        feedback_mode);
            ++report->failed;
            continue;
        }
        ++report->solved;
        if (calls == (uint32_t)popcount16(target))
            ++report->minimal;
        else {
            ++report->excess_edits;
        }
    }
    report->exact =
        (uint8_t)(report->solved == report->programs &&
                  report->minimal == report->programs &&
                  report->permutation_exact == report->permutation_cases);
    if (feedback_mode != R31_FEEDBACK_FULL)
        report->exact =
            (uint8_t)(report->solved == report->programs &&
                      report->minimal == report->programs);
    if (report->failed != 0)
        set_error(error, error_capacity,
                  "%u of %u dimension-%u programs failed",
                  report->failed, report->programs, dimensions);
    return R0_OK;
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static void hash_feature_add(R33HashFeatures *features, uint32_t key,
                             int value)
{
    uint32_t index = mix32(key) % R31_FEATURE_COUNT;
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor)
        if (features->indices[cursor] == index) {
            features->values[cursor] =
                (int16_t)(features->values[cursor] + value);
            return;
        }
    features->indices[features->count] = index;
    features->values[features->count] = (int16_t)value;
    ++features->count;
}

static int invariant_state_count(uint8_t dimensions, uint16_t mask)
{
    uint32_t states = state_count(dimensions), index;
    int count = 0;
    for (index = 0; index < states; ++index) {
        R33State state = state_from_index(dimensions, index);
        if (invariant_holds(dimensions, mask, &state)) ++count;
    }
    return count;
}

static void hashed_features(uint8_t dimensions, uint16_t mask,
                            const R33Witness *witness, int action,
                            R33HashFeatures *features)
{
    uint16_t canonical_mask, candidate;
    R33Witness canonical_witness;
    uint8_t permutation[R33_MAX_DIMENSIONS];
    uint64_t packed;
    int canonical_atom, adding, source_slack, target_slack;
    int source_holds, target_holds, resolves;
    memset(features, 0, sizeof(*features));
    canonicalize_context(dimensions, mask, witness, &canonical_mask,
                         &canonical_witness, permutation);
    canonical_atom =
        transform_action(dimensions, action, permutation);
    if (canonical_atom < 0 ||
        canonical_atom >= (int)dimensions * R33_ATOMS_PER_DIMENSION)
        return;
    candidate = canonical_mask ^
                (uint16_t)(UINT16_C(1) << canonical_atom);
    adding = (canonical_mask &
              (UINT16_C(1) << canonical_atom)) == 0;
    source_slack = atom_constant(canonical_atom) -
                   atom_coefficient(canonical_atom) *
                       canonical_witness.source
                           .values[canonical_atom / 4];
    target_slack = atom_constant(canonical_atom) -
                   atom_coefficient(canonical_atom) *
                       canonical_witness.target
                           .values[canonical_atom / 4];
    source_holds = source_slack >= 0;
    target_holds = target_slack >= 0;
    resolves = witness_resolved(dimensions, candidate,
                                &canonical_witness);
    packed = pack_witness(dimensions, &canonical_witness);
    hash_feature_add(features,
                     UINT32_C(0x01000000) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x02000000) |
                         ((uint32_t)canonical_mask << 4) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x03000000) |
                         (((uint32_t)packed & UINT32_C(0x1ffff)) << 4) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x04000000) |
                         ((uint32_t)canonical_witness.kind << 20) |
                         ((uint32_t)canonical_mask << 4) |
                         (uint32_t)canonical_atom,
                     2);
    hash_feature_add(features,
                     UINT32_C(0x05000000) |
                         ((uint32_t)canonical_witness.kind << 12) |
                         ((uint32_t)(adding != 0) << 11) |
                         ((uint32_t)(source_holds != 0) << 10) |
                         ((uint32_t)(target_holds != 0) << 9) |
                         ((uint32_t)(resolves != 0) << 8) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x06000000) |
                         ((uint32_t)(popcount16(canonical_mask) & 15)
                          << 12) |
                         ((uint32_t)(popcount16(candidate) & 15) << 8) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x07000000) |
                         ((uint32_t)(source_slack + 4) << 13) |
                         ((uint32_t)(target_slack + 4) << 9) |
                         ((uint32_t)(resolves != 0) << 8) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x08000000) |
                         ((uint32_t)invariant_state_count(
                              dimensions, canonical_mask)
                          << 12) |
                         ((uint32_t)invariant_state_count(
                              dimensions, candidate)
                          << 4) |
                         (uint32_t)canonical_atom,
                     1);
    hash_feature_add(features,
                     UINT32_C(0x09000000) |
                         ((uint32_t)(canonical_atom % 4) << 12) |
                         ((uint32_t)(adding != 0) << 11) |
                         ((uint32_t)canonical_witness.kind << 8) |
                         ((uint32_t)(resolves != 0) << 7),
                     1);
}

static int8_t sparse_weight(const R32Model *model, uint32_t index)
{
    unsigned low = 0, high = model->count;
    while (low < high) {
        unsigned middle = low + (high - low) / 2U;
        if (model->indices[middle] < index)
            low = middle + 1U;
        else
            high = middle;
    }
    if (low < model->count && model->indices[low] == index)
        return model->values[low];
    return 0;
}

static int hashed_select(const R32Model *model, uint8_t dimensions,
                         uint16_t mask, const R33Witness *witness)
{
    uint16_t legal = progress_actions(dimensions, mask, witness);
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < dimensions * R33_ATOMS_PER_DIMENSION;
         ++action) {
        R33HashFeatures features;
        int64_t score = 0;
        uint16_t feature;
        if ((legal & (UINT16_C(1) << action)) == 0) continue;
        hashed_features(dimensions, mask, witness, action, &features);
        for (feature = 0; feature < features.count; ++feature)
            score += (int64_t)sparse_weight(
                         model, features.indices[feature]) *
                     features.values[feature];
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              canonical_action(dimensions, mask, witness, action) <
                  canonical_action(dimensions, mask, witness, best)))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static R0Status evaluate_hashed(const R32Model *model, uint8_t dimensions,
                                R33Evaluation *report)
{
    uint32_t program;
    memset(report, 0, sizeof(*report));
    report->dimensions = dimensions;
    report->programs = r33_program_count(dimensions);
    for (program = 0; program < report->programs; ++program) {
        uint16_t target = program_target(dimensions, program), mask = 0;
        uint32_t calls = 0;
        int accepted = 0;
        while (calls <= R33_MAX_STEPS) {
            R33Verification verification;
            int action;
            if (verify(dimensions, target, mask, &verification) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (verification.accepted) {
                accepted = 1;
                break;
            }
            if (calls == R33_MAX_STEPS) break;
            action = hashed_select(model, dimensions, mask,
                                   &verification.witness);
            if (action < 0) break;
            mask ^= (uint16_t)(UINT16_C(1) << action);
            ++calls;
        }
        report->verifier_calls += calls;
        if (!accepted) {
            ++report->failed;
            continue;
        }
        ++report->solved;
        if (calls == (uint32_t)popcount16(target))
            ++report->minimal;
        else
            ++report->excess_edits;
    }
    report->exact = (uint8_t)(report->solved == report->programs &&
                              report->minimal == report->programs);
    return R0_OK;
}

R0Status r33_check_hashed_3d(R33Evaluation *report, char *error,
                             size_t error_capacity)
{
    R31Model dense;
    R31TrainingReport training;
    R32Model sparse;
    R32CompressionReport compression;
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    status = r31_train(&dense, &training, error, error_capacity);
    if (status == R0_OK)
        status = r32_compress(&dense, &sparse, &compression, error,
                              error_capacity);
    if (status == R0_OK) status = evaluate_hashed(&sparse, 3, report);
    if (status == R0_OK && !report->exact) {
        set_error(error, error_capacity,
                  "generic hashed control does not reproduce (3,2)");
        return R0_POLICY_ERROR;
    }
    return status;
}

static int compare_decisions(const void *left_pointer,
                             const void *right_pointer)
{
    const R33Decision *left = left_pointer;
    const R33Decision *right = right_pointer;
    if (left->mask != right->mask)
        return left->mask < right->mask ? -1 : 1;
    if (left->legal != right->legal)
        return left->legal < right->legal ? -1 : 1;
    return 0;
}

static R0Status equal_admissibility(const R33Model *model,
                                    uint8_t dimensions,
                                    R33ExperimentReport *report)
{
    size_t capacity =
        (size_t)r33_program_count(dimensions) * R33_MAX_STEPS;
    R33Decision *decisions = calloc(capacity, sizeof(*decisions));
    size_t count = 0, group_start, left, right;
    uint32_t program;
    if (decisions == NULL) return R0_LIMIT_ERROR;
    for (program = 0; program < r33_program_count(dimensions); ++program) {
        uint16_t target = program_target(dimensions, program), mask = 0;
        uint32_t step;
        for (step = 0; step < R33_MAX_STEPS; ++step) {
            R33Verification verification;
            uint16_t legal, optimal;
            int action;
            if (verify(dimensions, target, mask, &verification) != R0_OK) {
                free(decisions);
                return R0_VERIFIER_ERROR;
            }
            if (verification.accepted) break;
            legal = progress_actions(dimensions, mask,
                                     &verification.witness);
            optimal = legal & (uint16_t)(target ^ mask);
            action = semantic_select(model, dimensions, mask,
                                     &verification.witness,
                                     R31_FEEDBACK_FULL);
            if (optimal == 0 || action < 0) break;
            decisions[count].mask = mask;
            decisions[count].legal = legal;
            decisions[count].optimal = optimal;
            decisions[count].witness = verification.witness;
            decisions[count].full_action = (int8_t)action;
            decisions[count].masked_action = (int8_t)semantic_select(
                model, dimensions, mask, &verification.witness,
                R31_FEEDBACK_RANKER_MASKED);
            ++count;
            mask ^= (uint16_t)(UINT16_C(1) << action);
        }
    }
    qsort(decisions, count, sizeof(*decisions), compare_decisions);
    for (group_start = 0; group_start < count;) {
        size_t group_end = group_start + 1;
        while (group_end < count &&
               compare_decisions(&decisions[group_start],
                                 &decisions[group_end]) == 0)
            ++group_end;
        for (left = group_start; left < group_end; ++left)
            for (right = left + 1; right < group_end; ++right) {
                uint16_t left_action = (uint16_t)(
                    UINT16_C(1) << decisions[left].full_action);
                uint16_t right_action = (uint16_t)(
                    UINT16_C(1) << decisions[right].full_action);
                uint16_t masked_action = (uint16_t)(
                    UINT16_C(1) << decisions[left].masked_action);
                if ((decisions[left].optimal &
                     decisions[right].optimal) != 0)
                    continue;
                ++report->equal_admissibility_pairs;
                if ((decisions[left].optimal & left_action) != 0 &&
                    (decisions[right].optimal & right_action) != 0)
                    ++report->equal_admissibility_pairs_exact;
                if ((decisions[left].optimal & masked_action) != 0 &&
                    (decisions[right].optimal & masked_action) != 0)
                    ++report
                          ->equal_admissibility_masked_both_correct;
            }
        group_start = group_end;
    }
    free(decisions);
    return R0_OK;
}

static void digest_u32(uint64_t *digest, uint32_t value)
{
    unsigned byte;
    for (byte = 0; byte < 4; ++byte) {
        *digest ^= (uint8_t)(value >> (byte * 8U));
        *digest *= R33_FNV_PRIME;
    }
}

R0Status r33_run_sealed(R33ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R33Model development_model, final_model;
    R31Model dense;
    R31TrainingReport dense_training;
    R32Model sparse;
    R32CompressionReport compression;
    R0Status status;
    uint64_t digest = R33_FNV_OFFSET;
    uint32_t feature;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = r33_train(&development_model, 2,
                       &report->development_training, error,
                       error_capacity);
    if (status != R0_OK) return status;
    status = r33_evaluate(&development_model, 3, R31_FEEDBACK_FULL,
                          &report->development, error, error_capacity);
    if (status != R0_OK) return status;
    report->development_gate_passed = report->development.exact;
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "sealed 4D test remains closed because 3D failed");
        return R0_POLICY_ERROR;
    }
    status = r33_train(&final_model, 3, &report->final_training, error,
                       error_capacity);
    if (status != R0_OK) return status;
    status = r31_train(&dense, &dense_training, error, error_capacity);
    if (status == R0_OK)
        status = r32_compress(&dense, &sparse, &compression, error,
                              error_capacity);
    if (status != R0_OK) return status;
    status = evaluate_hashed(&sparse, 3, &report->hashed_control);
    if (status != R0_OK || !report->hashed_control.exact) {
        set_error(error, error_capacity,
                  "generic hashed control does not reproduce (3,2)");
        return R0_POLICY_ERROR;
    }

    /* The sealed dimension is first opened below this line. */
    status = r33_evaluate(&final_model, 4, R31_FEEDBACK_FULL,
                          &report->semantic, error, error_capacity);
    if (status == R0_OK)
        status = evaluate_hashed(&sparse, 4,
                                 &report->hashed_control);
    if (status == R0_OK)
        status = r33_evaluate(&final_model, 4,
                              R31_FEEDBACK_RANKER_MASKED,
                              &report->witness_masked, error,
                              error_capacity);
    if (status == R0_OK)
        status = r33_evaluate(&final_model, 4, R31_FEEDBACK_TOOL_ONLY,
                              &report->tool_only, error,
                              error_capacity);
    if (status == R0_OK)
        status = equal_admissibility(&final_model, 4, report);
    if (status != R0_OK) return status;
    memcpy(report->semantic_weights, final_model.weights,
           sizeof(report->semantic_weights));
    report->semantic_nonzero_weights =
        report->final_training.nonzero_weights;
    report->semantic_active_weight_bytes =
        report->final_training.active_weight_bytes;
    report->hashed_control_weights = sparse.count;
    report->hashed_control_active_weight_bytes =
        sparse.count * ((uint32_t)sizeof(uint32_t) + sizeof(int8_t));
    report->sealed_gate_passed =
        (uint8_t)(report->semantic.exact &&
                  !report->hashed_control.exact &&
                  !report->witness_masked.exact &&
                  !report->tool_only.exact &&
                  report->equal_admissibility_pairs > 0 &&
                  report->equal_admissibility_pairs_exact ==
                      report->equal_admissibility_pairs &&
                  report->equal_admissibility_masked_both_correct == 0 &&
                  report->semantic_active_weight_bytes <=
                      report->hashed_control_active_weight_bytes);
    digest_u32(&digest, report->development.programs);
    digest_u32(&digest, report->development.minimal);
    digest_u32(&digest, report->semantic.programs);
    digest_u32(&digest, report->semantic.minimal);
    digest_u32(&digest, report->hashed_control.minimal);
    digest_u32(&digest, report->witness_masked.minimal);
    digest_u32(&digest, report->tool_only.minimal);
    digest_u32(&digest, report->equal_admissibility_pairs);
    digest_u32(&digest, report->equal_admissibility_pairs_exact);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        digest_u32(&digest, (uint32_t)final_model.weights[feature]);
    report->result_digest = digest;
    return R0_OK;
}

R0Status r33_write_result(const R33ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    int feature;
    if (report == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    fprintf(file,
            "{\n"
            "  \"schema\": \"zero.reasoner33_dimension_transfer.v1\",\n"
            "  \"version\": \"(3,3)\",\n"
            "  \"sealed_dimension\": 4,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"development\": {\"programs\": %u, \"solved\": %u, "
            "\"minimal\": %u, \"permutation_cases\": %u, "
            "\"permutation_exact\": %u},\n"
            "  \"semantic\": {\"programs\": %u, \"solved\": %u, "
            "\"minimal\": %u, \"failed\": %u, "
            "\"verifier_calls\": %u, \"permutation_cases\": %u, "
            "\"permutation_exact\": %u},\n"
            "  \"hashed_control\": {\"programs\": %u, "
            "\"solved\": %u, \"minimal\": %u, \"failed\": %u},\n"
            "  \"witness_masked\": {\"programs\": %u, "
            "\"solved\": %u, \"minimal\": %u, \"failed\": %u},\n"
            "  \"tool_only\": {\"programs\": %u, \"solved\": %u, "
            "\"minimal\": %u, \"failed\": %u},\n"
            "  \"equal_admissibility\": {\"pairs\": %u, "
            "\"full_exact\": %u, \"masked_both_correct\": %u},\n"
            "  \"capacity\": {\"semantic_nonzero_weights\": %u, "
            "\"semantic_active_weight_bytes\": %u, "
            "\"hashed_control_weights\": %u, "
            "\"hashed_control_active_weight_bytes\": %u},\n"
            "  \"semantic_weights\": [",
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->development.programs, report->development.solved,
            report->development.minimal,
            report->development.permutation_cases,
            report->development.permutation_exact,
            report->semantic.programs, report->semantic.solved,
            report->semantic.minimal, report->semantic.failed,
            report->semantic.verifier_calls,
            report->semantic.permutation_cases,
            report->semantic.permutation_exact,
            report->hashed_control.programs,
            report->hashed_control.solved,
            report->hashed_control.minimal,
            report->hashed_control.failed,
            report->witness_masked.programs,
            report->witness_masked.solved,
            report->witness_masked.minimal,
            report->witness_masked.failed, report->tool_only.programs,
            report->tool_only.solved, report->tool_only.minimal,
            report->tool_only.failed,
            report->equal_admissibility_pairs,
            report->equal_admissibility_pairs_exact,
            report->equal_admissibility_masked_both_correct,
            report->semantic_nonzero_weights,
            report->semantic_active_weight_bytes,
            report->hashed_control_weights,
            report->hashed_control_active_weight_bytes);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        fprintf(file, "%s%d", feature == 0 ? "" : ",",
                report->semantic_weights[feature]);
    fprintf(file,
            "],\n  \"result_digest\": \"%016llx\"\n}\n",
            (unsigned long long)report->result_digest);
    if (ferror(file)) {
        set_error(error, error_capacity, "cannot write %s", path);
        fclose(file);
        return R0_IO_ERROR;
    }
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot close %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
