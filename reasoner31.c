#include "reasoner31.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R31_ALL_ATOMS ((uint16_t)(R31_HYPOTHESIS_COUNT - 1U))
#define R31_MAX_ACTIVE_FEATURES 192
#define R31_MODEL_VERSION 1U
#define R31_NORMALIZE_SLOTS 131072U

typedef struct {
    uint64_t low;
    uint64_t high;
} R31StateSet;

typedef struct {
    uint16_t target_mask;
    R31StateSet safe_states;
    uint8_t stage;
    uint8_t initial_state;
    uint8_t successor[R31_STATE_COUNT];
} R31Program;

typedef struct {
    uint16_t program_index;
    uint16_t invariant_mask;
    uint16_t optimal_actions;
    R31Witness witness;
    uint8_t stage;
    uint8_t distance;
} R31Case;

typedef struct {
    R31Program programs[R31_MAX_PROGRAMS];
    R31Case cases[R31_MAX_CASES];
    uint16_t program_count;
    uint32_t case_count;
    uint32_t positive_cases;
    uint32_t negative_cases;
    uint32_t implication_cases;
} R31Corpus;

typedef struct {
    uint16_t count;
    uint32_t indices[R31_MAX_ACTIVE_FEATURES];
    int16_t values[R31_MAX_ACTIVE_FEATURES];
} R31FeatureVector;

typedef struct {
    uint32_t witness_key;
    uint16_t invariant_mask;
    uint16_t targets;
    uint8_t used;
} R31NormalizeSlot;

static const R31Atom R31_ATOMS[R31_ATOM_COUNT] = {
    {{1, 0, 0}, -1}, {{1, 0, 0}, 1},
    {{-1, 0, 0}, -1}, {{-1, 0, 0}, 1},
    {{0, 1, 0}, -1}, {{0, 1, 0}, 1},
    {{0, -1, 0}, -1}, {{0, -1, 0}, 1},
    {{0, 0, 1}, -1}, {{0, 0, 1}, 1},
    {{0, 0, -1}, -1}, {{0, 0, -1}, 1},
};

static const uint8_t R31_PERMUTATIONS[6][R31_DIMENSIONS] = {
    {0, 1, 2}, {0, 2, 1}, {1, 0, 2},
    {1, 2, 0}, {2, 0, 1}, {2, 1, 0},
};

static R31StateSet R31_HYPOTHESIS_STATES[R31_HYPOTHESIS_COUNT];
static R31Program R31_PROGRAMS[R31_MAX_PROGRAMS];
static uint16_t R31_PROGRAM_COUNT;
static uint16_t R31_PROGRAMS_BY_STAGE[R31_TEST_STAGE + 1];
static int R31_WORLD_READY;

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

static int set_has(R31StateSet set, int index)
{
    return index < 64 ? (int)((set.low >> index) & UINT64_C(1))
                      : (int)((set.high >> (index - 64)) & UINT64_C(1));
}

static void set_add(R31StateSet *set, int index)
{
    if (index < 64)
        set->low |= UINT64_C(1) << index;
    else
        set->high |= UINT64_C(1) << (index - 64);
}

static int set_equal(R31StateSet left, R31StateSet right)
{
    return left.low == right.low && left.high == right.high;
}

static int set_empty(R31StateSet set)
{
    return set.low == 0 && set.high == 0;
}

static int set_count(R31StateSet set)
{
    int count = 0;
    while (set.low != 0) {
        count += set.low & UINT64_C(1);
        set.low >>= 1;
    }
    while (set.high != 0) {
        count += set.high & UINT64_C(1);
        set.high >>= 1;
    }
    return count;
}

static R31State state_from_index(int index)
{
    R31State state;
    int width = R31_DOMAIN_MAX - R31_DOMAIN_MIN + 1;
    state.values[0] = (int8_t)(R31_DOMAIN_MIN + index / (width * width));
    state.values[1] =
        (int8_t)(R31_DOMAIN_MIN + (index / width) % width);
    state.values[2] = (int8_t)(R31_DOMAIN_MIN + index % width);
    return state;
}

static int atom_value(int atom, const R31State *state)
{
    int dimension;
    int value = 0;
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        value += R31_ATOMS[atom].coefficients[dimension] *
                 state->values[dimension];
    return value;
}

static int atom_holds(int atom, const R31State *state)
{
    return atom_value(atom, state) <= R31_ATOMS[atom].constant;
}

static int invariant_holds(uint16_t mask, const R31State *state)
{
    int atom;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom)
        if ((mask & (UINT16_C(1) << atom)) != 0 &&
            !atom_holds(atom, state))
            return 0;
    return 1;
}

static R31StateSet compute_invariant_states(uint16_t mask)
{
    R31StateSet states = {0, 0};
    int index;
    for (index = 0; index < R31_STATE_COUNT; ++index) {
        R31State state = state_from_index(index);
        if (invariant_holds(mask, &state)) set_add(&states, index);
    }
    return states;
}

static int mask_is_minimal(uint16_t mask, R31StateSet states)
{
    int atom;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom) {
        uint16_t bit = (uint16_t)(UINT16_C(1) << atom);
        if ((mask & bit) != 0 &&
            set_equal(R31_HYPOTHESIS_STATES[mask ^ bit], states))
            return 0;
    }
    return 1;
}

static int state_distance_to_set(int state_index, R31StateSet states)
{
    R31State source = state_from_index(state_index);
    int candidate, best = INT_MAX;
    for (candidate = 0; candidate < R31_STATE_COUNT; ++candidate) {
        R31State target;
        int dimension, distance = 0;
        if (!set_has(states, candidate)) continue;
        target = state_from_index(candidate);
        for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
            distance += abs(source.values[dimension] -
                            target.values[dimension]);
        if (distance < best) best = distance;
    }
    return best;
}

static int nearest_state_in_set(int state_index, R31StateSet states)
{
    R31State source = state_from_index(state_index);
    int candidate, best = -1, best_distance = INT_MAX;
    for (candidate = 0; candidate < R31_STATE_COUNT; ++candidate) {
        R31State target;
        int dimension, distance = 0;
        if (!set_has(states, candidate)) continue;
        target = state_from_index(candidate);
        for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
            distance += abs(source.values[dimension] -
                            target.values[dimension]);
        if (distance < best_distance) {
            best = candidate;
            best_distance = distance;
        }
    }
    return best;
}

static int add_program(uint16_t target_mask)
{
    R31StateSet safe = R31_HYPOTHESIS_STATES[target_mask];
    R31Program *program;
    int index, first = -1, previous = -1;
    uint8_t stage = (uint8_t)popcount16(target_mask);
    if (set_empty(safe) || !mask_is_minimal(target_mask, safe)) return 1;
    for (index = 0; index < R31_PROGRAM_COUNT; ++index)
        if (set_equal(R31_PROGRAMS[index].safe_states, safe)) return 1;
    if (R31_PROGRAM_COUNT >= R31_MAX_PROGRAMS) return 0;
    program = &R31_PROGRAMS[R31_PROGRAM_COUNT++];
    memset(program, 0, sizeof(*program));
    program->target_mask = target_mask;
    program->safe_states = safe;
    program->stage = stage;
    ++R31_PROGRAMS_BY_STAGE[stage];
    for (index = 0; index < R31_STATE_COUNT; ++index)
        program->successor[index] = (uint8_t)index;
    for (index = 0; index < R31_STATE_COUNT; ++index) {
        if (!set_has(safe, index)) continue;
        if (first < 0) first = index;
        if (previous >= 0) program->successor[previous] = (uint8_t)index;
        previous = index;
    }
    program->successor[previous] = (uint8_t)first;
    program->initial_state = (uint8_t)first;
    return 1;
}

static int build_world(void)
{
    uint16_t mask;
    if (R31_WORLD_READY) return 1;
    for (mask = 0; mask <= R31_ALL_ATOMS; ++mask)
        R31_HYPOTHESIS_STATES[mask] = compute_invariant_states(mask);
    memset(R31_PROGRAMS, 0, sizeof(R31_PROGRAMS));
    memset(R31_PROGRAMS_BY_STAGE, 0, sizeof(R31_PROGRAMS_BY_STAGE));
    R31_PROGRAM_COUNT = 0;
    for (mask = 1; mask <= R31_ALL_ATOMS; ++mask) {
        int stage = popcount16(mask);
        if (stage < 1 || stage > R31_TEST_STAGE) continue;
        if (!add_program(mask)) return 0;
    }
    R31_WORLD_READY = R31_PROGRAM_COUNT == R31_MAX_PROGRAMS;
    return R31_WORLD_READY;
}

const R31Atom *r31_atoms(void)
{
    return R31_ATOMS;
}

const char *r31_witness_name(uint8_t kind)
{
    switch (kind) {
    case R31_WITNESS_UNKNOWN: return "unknown";
    case R31_WITNESS_POSITIVE: return "positive";
    case R31_WITNESS_NEGATIVE: return "negative";
    case R31_WITNESS_IMPLICATION: return "implication";
    case R31_WITNESS_VALID: return "valid";
    default: return "invalid";
    }
}

const char *r31_feedback_name(uint8_t mode)
{
    switch (mode) {
    case R31_FEEDBACK_FULL: return "full";
    case R31_FEEDBACK_RANKER_MASKED: return "ranker_masked";
    case R31_FEEDBACK_NONE: return "none";
    case R31_FEEDBACK_TOOL_ONLY: return "tool_only";
    default: return "invalid";
    }
}

uint16_t r31_program_count(void)
{
    return build_world() ? R31_PROGRAM_COUNT : 0;
}

uint16_t r31_program_count_at_stage(uint8_t stage)
{
    if (!build_world() || stage < 1 || stage > R31_TEST_STAGE) return 0;
    return R31_PROGRAMS_BY_STAGE[stage];
}

uint8_t r31_program_stage(uint16_t program_index)
{
    if (!build_world() || program_index >= R31_PROGRAM_COUNT) return 0;
    return R31_PROGRAMS[program_index].stage;
}

static R0Status verify_program(const R31Program *program, uint16_t mask,
                               R31Verification *verification)
{
    R31StateSet hypothesis = R31_HYPOTHESIS_STATES[mask];
    int index, best = -1, best_distance = INT_MAX;
    memset(verification, 0, sizeof(*verification));
    verification->witness.nonce =
        (uint16_t)(mask * UINT16_C(257) + UINT16_C(0x0031));
    if (!set_has(hypothesis, program->initial_state)) {
        verification->witness.kind = R31_WITNESS_POSITIVE;
        verification->witness.source =
            state_from_index(program->initial_state);
        verification->witness.target = state_from_index(
            program->successor[program->initial_state]);
        return R0_OK;
    }
    for (index = 0; index < R31_STATE_COUNT; ++index) {
        int distance;
        if (set_has(program->safe_states, index) ||
            !set_has(hypothesis, index))
            continue;
        distance = state_distance_to_set(index, program->safe_states);
        if (distance < best_distance) {
            best = index;
            best_distance = distance;
        }
    }
    if (best >= 0) {
        int nearest = nearest_state_in_set(best, program->safe_states);
        verification->witness.kind = R31_WITNESS_NEGATIVE;
        verification->witness.source = state_from_index(best);
        verification->witness.target = state_from_index(nearest);
        return R0_OK;
    }
    for (index = 0; index < R31_STATE_COUNT; ++index) {
        int successor;
        if (!set_has(program->safe_states, index) ||
            !set_has(hypothesis, index))
            continue;
        successor = program->successor[index];
        if (!set_has(hypothesis, successor)) {
            verification->witness.kind = R31_WITNESS_IMPLICATION;
            verification->witness.source = state_from_index(index);
            verification->witness.target = state_from_index(successor);
            return R0_OK;
        }
    }
    verification->accepted = 1;
    verification->witness.kind = R31_WITNESS_VALID;
    return R0_OK;
}

R0Status r31_verify(uint16_t program_index, const R31Invariant *invariant,
                    R31Verification *verification, char *error,
                    size_t error_capacity)
{
    if (invariant == NULL || verification == NULL ||
        (invariant->atom_mask & ~R31_ALL_ATOMS) != 0)
        return R0_INVALID_ARGUMENT;
    if (!build_world() || program_index >= R31_PROGRAM_COUNT) {
        set_error(error, error_capacity, "program index %u is unavailable",
                  (unsigned)program_index);
        return R0_INVALID_ARGUMENT;
    }
    return verify_program(&R31_PROGRAMS[program_index], invariant->atom_mask,
                          verification);
}

static int witness_resolved(uint16_t mask, const R31Witness *witness)
{
    if (witness->kind == R31_WITNESS_POSITIVE)
        return invariant_holds(mask, &witness->source);
    if (witness->kind == R31_WITNESS_NEGATIVE)
        return !invariant_holds(mask, &witness->source);
    if (witness->kind == R31_WITNESS_IMPLICATION)
        return !invariant_holds(mask, &witness->source) ||
               invariant_holds(mask, &witness->target);
    return 0;
}

static uint16_t progress_actions(uint16_t mask, const R31Witness *witness)
{
    uint16_t actions = 0;
    int atom;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom)
        if (witness_resolved(
                mask ^ (uint16_t)(UINT16_C(1) << atom), witness))
            actions |= (uint16_t)(UINT16_C(1) << atom);
    return actions;
}

static R0Status compute_distances(
    const R31Program *program,
    uint8_t distances[R31_HYPOTHESIS_COUNT], char *error,
    size_t error_capacity)
{
    uint16_t queue[R31_HYPOTHESIS_COUNT];
    unsigned head = 0, tail = 0, mask;
    memset(distances, UINT8_MAX, R31_HYPOTHESIS_COUNT);
    for (mask = 0; mask <= R31_ALL_ATOMS; ++mask) {
        R31Verification verification;
        (void)verify_program(program, (uint16_t)mask, &verification);
        if (verification.accepted) {
            distances[mask] = 0;
            queue[tail++] = (uint16_t)mask;
        }
    }
    if (tail == 0) {
        set_error(error, error_capacity,
                  "3D program has no expressible invariant");
        return R0_VERIFIER_ERROR;
    }
    while (head < tail) {
        uint16_t current = queue[head++];
        int atom;
        for (atom = 0; atom < R31_ATOM_COUNT; ++atom) {
            uint16_t next =
                current ^ (uint16_t)(UINT16_C(1) << atom);
            if (distances[next] != UINT8_MAX) continue;
            distances[next] = (uint8_t)(distances[current] + 1U);
            queue[tail++] = next;
        }
    }
    return R0_OK;
}

static R0Status corpus_add_case(
    R31Corpus *corpus, uint16_t program_index, uint16_t mask,
    const uint8_t distances[R31_HYPOTHESIS_COUNT], char *error,
    size_t error_capacity)
{
    const R31Program *program = &corpus->programs[program_index];
    R31Verification verification;
    R31Case *item;
    uint16_t optimal = 0;
    uint32_t index;
    int atom;
    for (index = 0; index < corpus->case_count; ++index)
        if (corpus->cases[index].program_index == program_index &&
            corpus->cases[index].invariant_mask == mask)
            return R0_OK;
    (void)verify_program(program, mask, &verification);
    if (verification.accepted || distances[mask] == 0 ||
        distances[mask] > R31_MAX_REPAIR_STEPS)
        return R0_OK;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom) {
        uint16_t next = mask ^ (uint16_t)(UINT16_C(1) << atom);
        if (distances[next] + 1U == distances[mask] &&
            witness_resolved(next, &verification.witness))
            optimal |= (uint16_t)(UINT16_C(1) << atom);
    }
    if (optimal == 0) return R0_OK;
    if (corpus->case_count >= R31_MAX_CASES) {
        set_error(error, error_capacity, "3D corpus exceeds %u cases",
                  R31_MAX_CASES);
        return R0_LIMIT_ERROR;
    }
    item = &corpus->cases[corpus->case_count++];
    memset(item, 0, sizeof(*item));
    item->program_index = program_index;
    item->invariant_mask = mask;
    item->optimal_actions = optimal;
    item->witness = verification.witness;
    item->stage = program->stage;
    item->distance = distances[mask];
    if (item->witness.kind == R31_WITNESS_POSITIVE)
        ++corpus->positive_cases;
    else if (item->witness.kind == R31_WITNESS_NEGATIVE)
        ++corpus->negative_cases;
    else if (item->witness.kind == R31_WITNESS_IMPLICATION)
        ++corpus->implication_cases;
    return R0_OK;
}

static R31State transform_state(R31State state, int permutation)
{
    R31State transformed;
    int dimension;
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        transformed.values[dimension] =
            state.values[R31_PERMUTATIONS[permutation][dimension]];
    return transformed;
}

static R31Witness transform_witness(R31Witness witness, int permutation)
{
    witness.source = transform_state(witness.source, permutation);
    witness.target = transform_state(witness.target, permutation);
    return witness;
}

static int transform_atom(int atom, int permutation)
{
    int input_dimension = atom / 4;
    int local = atom % 4;
    int output_dimension;
    for (output_dimension = 0; output_dimension < R31_DIMENSIONS;
         ++output_dimension)
        if (R31_PERMUTATIONS[permutation][output_dimension] ==
            input_dimension)
            return output_dimension * 4 + local;
    return atom;
}

static uint16_t transform_mask(uint16_t mask, int permutation)
{
    uint16_t transformed = 0;
    int atom;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom)
        if ((mask & (UINT16_C(1) << atom)) != 0)
            transformed |= (uint16_t)(UINT16_C(1) <<
                                      transform_atom(atom, permutation));
    return transformed;
}

static uint16_t untransform_mask(uint16_t mask, int permutation)
{
    uint16_t transformed = 0;
    int canonical_atom;
    for (canonical_atom = 0; canonical_atom < R31_ATOM_COUNT;
         ++canonical_atom) {
        int output_dimension = canonical_atom / 4;
        int local = canonical_atom % 4;
        int input_dimension =
            R31_PERMUTATIONS[permutation][output_dimension];
        if ((mask & (UINT16_C(1) << canonical_atom)) != 0)
            transformed |= (uint16_t)(UINT16_C(1) <<
                                      (input_dimension * 4 + local));
    }
    return transformed;
}

static uint32_t pack_state(const R31State *state)
{
    uint32_t packed = 0;
    int dimension;
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        packed = packed * 5U +
                 (uint32_t)(state->values[dimension] - R31_DOMAIN_MIN);
    return packed;
}

static uint32_t pack_witness(const R31Witness *witness)
{
    return (uint32_t)witness->kind * 15625U +
           pack_state(&witness->source) * 125U +
           pack_state(&witness->target);
}

static int canonicalize_context(uint16_t mask, const R31Witness *witness,
                                uint16_t *canonical_mask,
                                R31Witness *canonical_witness)
{
    int permutation, best = 0;
    uint16_t best_mask = transform_mask(mask, 0);
    R31Witness best_witness = transform_witness(*witness, 0);
    uint32_t best_key = pack_witness(&best_witness);
    for (permutation = 1; permutation < 6; ++permutation) {
        uint16_t candidate_mask = transform_mask(mask, permutation);
        R31Witness candidate_witness =
            transform_witness(*witness, permutation);
        uint32_t candidate_key = pack_witness(&candidate_witness);
        if (candidate_mask < best_mask ||
            (candidate_mask == best_mask && candidate_key < best_key)) {
            best = permutation;
            best_mask = candidate_mask;
            best_witness = candidate_witness;
            best_key = candidate_key;
        }
    }
    *canonical_mask = best_mask;
    *canonical_witness = best_witness;
    canonical_witness->nonce = 0;
    return best;
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static R31NormalizeSlot *normalize_find(R31NormalizeSlot *slots,
                                        uint16_t mask, uint32_t witness_key)
{
    uint32_t index = mix32((uint32_t)mask * UINT32_C(131071) ^ witness_key) &
                     (R31_NORMALIZE_SLOTS - 1U);
    while (slots[index].used &&
           (slots[index].invariant_mask != mask ||
            slots[index].witness_key != witness_key))
        index = (index + 1U) & (R31_NORMALIZE_SLOTS - 1U);
    return &slots[index];
}

static R0Status normalize_targets(R31Corpus *corpus, char *error,
                                  size_t error_capacity)
{
    R31NormalizeSlot *slots =
        (R31NormalizeSlot *)calloc(R31_NORMALIZE_SLOTS, sizeof(*slots));
    uint32_t index;
    if (slots == NULL) return R0_LIMIT_ERROR;
    for (index = 0; index < corpus->case_count; ++index) {
        R31Case *item = &corpus->cases[index];
        uint16_t canonical_mask;
        R31Witness canonical_witness;
        int permutation = canonicalize_context(
            item->invariant_mask, &item->witness, &canonical_mask,
            &canonical_witness);
        uint32_t witness_key = pack_witness(&canonical_witness);
        uint16_t targets = transform_mask(item->optimal_actions, permutation);
        R31NormalizeSlot *slot =
            normalize_find(slots, canonical_mask, witness_key);
        if (!slot->used) {
            slot->used = 1;
            slot->invariant_mask = canonical_mask;
            slot->witness_key = witness_key;
            slot->targets = targets;
        } else {
            slot->targets &= targets;
        }
    }
    for (index = 0; index < corpus->case_count; ++index) {
        R31Case *item = &corpus->cases[index];
        uint16_t canonical_mask;
        R31Witness canonical_witness;
        int permutation = canonicalize_context(
            item->invariant_mask, &item->witness, &canonical_mask,
            &canonical_witness);
        R31NormalizeSlot *slot = normalize_find(
            slots, canonical_mask, pack_witness(&canonical_witness));
        if (slot->targets == 0) {
            free(slots);
            set_error(error, error_capacity,
                      "a 3D witness does not identify a consistent edit");
            return R0_POLICY_ERROR;
        }
        item->optimal_actions =
            untransform_mask(slot->targets, permutation);
    }
    free(slots);
    return R0_OK;
}

static R0Status build_corpus(uint8_t maximum_stage, R31Corpus *corpus,
                             char *error, size_t error_capacity)
{
    uint16_t global_program;
    if (maximum_stage < 1 || maximum_stage > R31_TEST_STAGE ||
        corpus == NULL)
        return R0_INVALID_ARGUMENT;
    if (!build_world()) return R0_LIMIT_ERROR;
    memset(corpus, 0, sizeof(*corpus));
    for (global_program = 0; global_program < R31_PROGRAM_COUNT;
         ++global_program) {
        const R31Program *source = &R31_PROGRAMS[global_program];
        uint8_t distances[R31_HYPOTHESIS_COUNT];
        uint16_t local_program;
        int first, second, extra;
        R0Status status;
        if (source->stage > maximum_stage) continue;
        local_program = corpus->program_count++;
        corpus->programs[local_program] = *source;
        status = compute_distances(&corpus->programs[local_program],
                                   distances, error, error_capacity);
        if (status != R0_OK) return status;
        status = corpus_add_case(corpus, local_program, 0, distances, error,
                                 error_capacity);
        if (status != R0_OK) return status;
        for (first = 0; first < R31_ATOM_COUNT; ++first) {
            uint16_t first_bit = (uint16_t)(UINT16_C(1) << first);
            uint16_t changed = source->target_mask ^ first_bit;
            status = corpus_add_case(corpus, local_program, changed,
                                     distances, error, error_capacity);
            if (status != R0_OK) return status;
            if ((source->target_mask & first_bit) == 0) continue;
            for (second = first + 1; second < R31_ATOM_COUNT; ++second) {
                uint16_t second_bit =
                    (uint16_t)(UINT16_C(1) << second);
                if ((source->target_mask & second_bit) == 0) continue;
                changed = source->target_mask ^ first_bit ^ second_bit;
                status = corpus_add_case(corpus, local_program, changed,
                                         distances, error, error_capacity);
                if (status != R0_OK) return status;
            }
            for (extra = 0; extra < R31_ATOM_COUNT; ++extra) {
                uint16_t extra_bit =
                    (uint16_t)(UINT16_C(1) << extra);
                if ((source->target_mask & extra_bit) != 0) continue;
                changed = (source->target_mask ^ first_bit) | extra_bit;
                status = corpus_add_case(corpus, local_program, changed,
                                         distances, error, error_capacity);
                if (status != R0_OK) return status;
            }
        }
    }
    return normalize_targets(corpus, error, error_capacity);
}

static void feature_add(R31FeatureVector *features, uint32_t key, int value)
{
    uint32_t index = mix32(key) % R31_FEATURE_COUNT;
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor) {
        if (features->indices[cursor] == index) {
            features->values[cursor] =
                (int16_t)(features->values[cursor] + value);
            return;
        }
    }
    if (features->count >= R31_MAX_ACTIVE_FEATURES) return;
    features->indices[features->count] = index;
    features->values[features->count] = (int16_t)value;
    ++features->count;
}

static R31Witness observed_witness(const R31Witness *witness,
                                   uint8_t feedback_mode)
{
    R31Witness observed = *witness;
    if (feedback_mode != R31_FEEDBACK_FULL) {
        memset(&observed, 0, sizeof(observed));
        observed.kind = R31_WITNESS_UNKNOWN;
    }
    return observed;
}

static int canonical_action_for_mode(uint16_t mask,
                                     const R31Witness *witness, int action,
                                     uint8_t feedback_mode)
{
    R31Witness observed = observed_witness(witness, feedback_mode);
    R31Witness ignored_witness;
    uint16_t ignored_mask;
    int permutation = canonicalize_context(mask, &observed, &ignored_mask,
                                           &ignored_witness);
    return transform_atom(action, permutation);
}

static void extract_features(uint16_t mask, const R31Witness *witness,
                             int action, uint8_t feedback_mode,
                             R31FeatureVector *features)
{
    R31Witness observed = observed_witness(witness, feedback_mode);
    R31Witness canonical_witness;
    uint16_t canonical_mask, candidate;
    uint32_t packed;
    int permutation, canonical_atom, adding;
    int source_slack, target_slack, source_holds, target_holds, resolves;
    memset(features, 0, sizeof(*features));
    permutation = canonicalize_context(mask, &observed, &canonical_mask,
                                       &canonical_witness);
    canonical_atom = transform_atom(action, permutation);
    packed = pack_witness(&canonical_witness);
    adding = (canonical_mask & (UINT16_C(1) << canonical_atom)) == 0;
    candidate = canonical_mask ^
                (uint16_t)(UINT16_C(1) << canonical_atom);
    source_slack = R31_ATOMS[canonical_atom].constant -
                   atom_value(canonical_atom, &canonical_witness.source);
    target_slack = R31_ATOMS[canonical_atom].constant -
                   atom_value(canonical_atom, &canonical_witness.target);
    source_holds = source_slack >= 0;
    target_holds = target_slack >= 0;
    resolves = feedback_mode == R31_FEEDBACK_FULL
                   ? witness_resolved(candidate, &canonical_witness)
                   : 0;

    feature_add(features, UINT32_C(0x01000000) | (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x02000000) |
                    ((uint32_t)canonical_mask << 4) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x03000000) |
                    ((packed & UINT32_C(0x1ffff)) << 4) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x04000000) |
                    ((uint32_t)canonical_witness.kind << 20) |
                    ((uint32_t)canonical_mask << 4) |
                    (uint32_t)canonical_atom,
                2);
    feature_add(features,
                UINT32_C(0x05000000) |
                    ((uint32_t)canonical_witness.kind << 12) |
                    ((uint32_t)(adding != 0) << 11) |
                    ((uint32_t)(source_holds != 0) << 10) |
                    ((uint32_t)(target_holds != 0) << 9) |
                    ((uint32_t)(resolves != 0) << 8) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x06000000) |
                    ((uint32_t)(popcount16(canonical_mask) & 15) << 12) |
                    ((uint32_t)(popcount16(candidate) & 15) << 8) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x07000000) |
                    ((uint32_t)(source_slack + 4) << 13) |
                    ((uint32_t)(target_slack + 4) << 9) |
                    ((uint32_t)(resolves != 0) << 8) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x08000000) |
                    ((uint32_t)set_count(
                         R31_HYPOTHESIS_STATES[canonical_mask])
                     << 12) |
                    ((uint32_t)set_count(R31_HYPOTHESIS_STATES[candidate])
                     << 4) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x09000000) |
                    ((uint32_t)(canonical_atom % 4) << 12) |
                    ((uint32_t)(adding != 0) << 11) |
                    ((uint32_t)canonical_witness.kind << 8) |
                    ((uint32_t)(resolves != 0) << 7),
                1);
}

static int64_t feature_score(const R31Model *model,
                             const R31FeatureVector *features)
{
    int64_t score = 0;
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor)
        score += (int64_t)model->weights[features->indices[cursor]] *
                 features->values[cursor];
    return score;
}

static int select_tool_only(uint16_t mask, const R31Witness *witness)
{
    uint16_t admissible = progress_actions(mask, witness);
    int action, best = -1;
    for (action = 0; action < R31_ATOM_COUNT; ++action) {
        if ((admissible & (UINT16_C(1) << action)) == 0) continue;
        if (best < 0 ||
            canonical_action_for_mode(mask, witness, action,
                                      R31_FEEDBACK_RANKER_MASKED) <
                canonical_action_for_mode(mask, witness, best,
                                          R31_FEEDBACK_RANKER_MASKED))
            best = action;
    }
    return best;
}

static int select_action(const R31Model *model, uint16_t mask,
                         const R31Witness *witness, uint8_t feedback_mode)
{
    uint16_t admissible = R31_ALL_ATOMS;
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    if (feedback_mode == R31_FEEDBACK_TOOL_ONLY)
        return select_tool_only(mask, witness);
    if (feedback_mode == R31_FEEDBACK_FULL ||
        feedback_mode == R31_FEEDBACK_RANKER_MASKED)
        admissible = progress_actions(mask, witness);
    for (action = 0; action < R31_ATOM_COUNT; ++action) {
        R31FeatureVector features;
        int64_t score;
        if ((admissible & (UINT16_C(1) << action)) == 0) continue;
        extract_features(mask, witness, action, feedback_mode, &features);
        score = feature_score(model, &features);
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              canonical_action_for_mode(mask, witness, action,
                                        feedback_mode) <
                  canonical_action_for_mode(mask, witness, best,
                                            feedback_mode)))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static void update_action(R31Model *model, uint16_t mask,
                          const R31Witness *witness, int action,
                          int direction)
{
    R31FeatureVector features;
    uint16_t cursor;
    extract_features(mask, witness, action, R31_FEEDBACK_FULL, &features);
    for (cursor = 0; cursor < features.count; ++cursor)
        model->weights[features.indices[cursor]] +=
            direction * features.values[cursor];
}

static int best_target(const R31Model *model, const R31Case *item)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < R31_ATOM_COUNT; ++action) {
        R31FeatureVector features;
        int64_t score;
        if ((item->optimal_actions & (UINT16_C(1) << action)) == 0)
            continue;
        extract_features(item->invariant_mask, &item->witness, action,
                         R31_FEEDBACK_FULL, &features);
        score = feature_score(model, &features);
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              canonical_action_for_mode(item->invariant_mask,
                                        &item->witness, action,
                                        R31_FEEDBACK_FULL) <
                  canonical_action_for_mode(item->invariant_mask,
                                            &item->witness, best,
                                            R31_FEEDBACK_FULL)))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static uint32_t action_errors(const R31Model *model,
                              const R31Corpus *corpus,
                              uint8_t maximum_stage)
{
    uint32_t index, errors = 0;
    for (index = 0; index < corpus->case_count; ++index) {
        const R31Case *item = &corpus->cases[index];
        int action;
        if (item->stage > maximum_stage) continue;
        action = select_action(model, item->invariant_mask, &item->witness,
                               R31_FEEDBACK_FULL);
        if (action < 0 ||
            (item->optimal_actions & (UINT16_C(1) << action)) == 0)
            ++errors;
    }
    return errors;
}

static R0Status train_stage(R31Model *model, const R31Corpus *corpus,
                            uint8_t stage, uint32_t *epochs,
                            uint32_t *mistakes, char *error,
                            size_t error_capacity)
{
    uint32_t epoch;
    for (epoch = 0; epoch < R31_MAX_STAGE_EPOCHS; ++epoch) {
        uint32_t epoch_mistakes = 0;
        uint32_t index;
        for (index = 0; index < corpus->case_count; ++index) {
            const R31Case *item = &corpus->cases[index];
            int predicted, target;
            if (item->stage > stage) continue;
            predicted = select_action(model, item->invariant_mask,
                                      &item->witness, R31_FEEDBACK_FULL);
            if (predicted >= 0 &&
                (item->optimal_actions &
                 (UINT16_C(1) << predicted)) != 0)
                continue;
            target = best_target(model, item);
            if (target < 0) return R0_POLICY_ERROR;
            update_action(model, item->invariant_mask, &item->witness,
                          target, 1);
            if (predicted >= 0)
                update_action(model, item->invariant_mask, &item->witness,
                              predicted, -1);
            ++epoch_mistakes;
        }
        ++*epochs;
        *mistakes += epoch_mistakes;
        if (epoch_mistakes == 0) return R0_OK;
    }
    set_error(error, error_capacity,
              "3D stage %u did not separate within %u epochs",
              (unsigned)stage, R31_MAX_STAGE_EPOCHS);
    return R0_POLICY_ERROR;
}

void r31_model_init(R31Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

typedef struct {
    uint8_t accepted;
    uint8_t edits;
    uint8_t repeats;
    uint8_t unresolved;
    uint8_t decisions;
    uint8_t singleton;
    uint8_t multiple;
} R31Rollout;

static R31Rollout rollout_case(const R31Model *model,
                               const R31Corpus *corpus,
                               const R31Case *item, uint8_t feedback_mode)
{
    const R31Program *program = &corpus->programs[item->program_index];
    R31Verification verification;
    R31Rollout rollout;
    uint8_t visited[R31_HYPOTHESIS_COUNT];
    uint16_t mask = item->invariant_mask;
    uint32_t step;
    memset(&rollout, 0, sizeof(rollout));
    memset(visited, 0, sizeof(visited));
    visited[mask] = 1;
    verification.accepted = 0;
    verification.witness = item->witness;
    for (step = 0; step < R31_MAX_REPAIR_STEPS; ++step) {
        uint16_t admissible = progress_actions(mask, &verification.witness);
        int action = select_action(model, mask, &verification.witness,
                                   feedback_mode);
        int choices = popcount16(admissible);
        ++rollout.decisions;
        if (choices == 1)
            ++rollout.singleton;
        else if (choices > 1)
            ++rollout.multiple;
        if (action < 0) break;
        if ((admissible & (UINT16_C(1) << action)) == 0)
            ++rollout.unresolved;
        mask ^= (uint16_t)(UINT16_C(1) << action);
        ++rollout.edits;
        if (visited[mask]) ++rollout.repeats;
        visited[mask] = 1;
        (void)verify_program(program, mask, &verification);
        if (verification.accepted) {
            rollout.accepted = 1;
            break;
        }
    }
    return rollout;
}

static R0Status evaluate_corpus(const R31Model *model,
                                const R31Corpus *corpus, uint8_t stage,
                                uint8_t feedback_mode,
                                R31EvaluationReport *report)
{
    uint32_t index;
    memset(report, 0, sizeof(*report));
    report->stage = stage;
    report->feedback_mode = feedback_mode;
    for (index = 0; index < corpus->case_count; ++index) {
        const R31Case *item = &corpus->cases[index];
        R31Rollout rollout;
        if (item->stage != stage) continue;
        ++report->cases;
        rollout = rollout_case(model, corpus, item, feedback_mode);
        report->verifier_calls += rollout.edits;
        report->repeated_states += rollout.repeats;
        report->unresolved_edits += rollout.unresolved;
        report->decisions += rollout.decisions;
        report->singleton_decisions += rollout.singleton;
        report->multiple_decisions += rollout.multiple;
        if (rollout.accepted) {
            ++report->solved;
            if (rollout.edits == item->distance)
                ++report->optimal;
            else if (rollout.edits > item->distance)
                report->excess_edits += rollout.edits - item->distance;
        } else {
            ++report->failed;
        }
    }
    if (report->cases != 0) {
        report->success_milli = report->solved * 1000U / report->cases;
        report->optimal_milli = report->optimal * 1000U / report->cases;
    }
    report->exact =
        (uint8_t)(report->cases != 0 && report->optimal == report->cases &&
                  report->repeated_states == 0 &&
                  report->unresolved_edits == 0);
    return R0_OK;
}

static void observable_key(const R31Case *item, uint16_t *mask,
                           uint32_t *witness_key)
{
    R31Witness witness;
    (void)canonicalize_context(item->invariant_mask, &item->witness, mask,
                               &witness);
    *witness_key = pack_witness(&witness);
}

static R0Status analyze_holdout(const R31Model *model,
                                const R31Corpus *training_corpus,
                                const R31Corpus *holdout_corpus,
                                uint8_t stage, R31HoldoutReport *report)
{
    R31NormalizeSlot *seen =
        (R31NormalizeSlot *)calloc(R31_NORMALIZE_SLOTS, sizeof(*seen));
    uint32_t index, right;
    if (seen == NULL) return R0_LIMIT_ERROR;
    memset(report, 0, sizeof(*report));
    report->stage = stage;
    (void)evaluate_corpus(model, holdout_corpus, stage, R31_FEEDBACK_FULL,
                          &report->full);
    (void)evaluate_corpus(model, holdout_corpus, stage,
                          R31_FEEDBACK_RANKER_MASKED,
                          &report->ranker_masked);
    (void)evaluate_corpus(model, holdout_corpus, stage, R31_FEEDBACK_NONE,
                          &report->no_feedback);
    (void)evaluate_corpus(model, holdout_corpus, stage,
                          R31_FEEDBACK_TOOL_ONLY, &report->tool_only);
    report->cases = report->full.cases;
    report->irrelevant_swap_exact = 1;
    report->permutation_exact = 1;

    for (index = 0; index < training_corpus->case_count; ++index) {
        uint16_t mask;
        uint32_t witness_key;
        R31NormalizeSlot *slot;
        observable_key(&training_corpus->cases[index], &mask, &witness_key);
        slot = normalize_find(seen, mask, witness_key);
        slot->used = 1;
        slot->invariant_mask = mask;
        slot->witness_key = witness_key;
    }
    for (index = 0; index < holdout_corpus->case_count; ++index) {
        const R31Case *item = &holdout_corpus->cases[index];
        uint16_t mask;
        uint32_t witness_key;
        R31NormalizeSlot *slot;
        R31Rollout rollout;
        int action, permutation;
        R31Witness changed;
        if (item->stage != stage) continue;
        observable_key(item, &mask, &witness_key);
        slot = normalize_find(seen, mask, witness_key);
        rollout = rollout_case(model, holdout_corpus, item,
                               R31_FEEDBACK_FULL);
        if (slot->used) {
            ++report->seen_observations;
            if (rollout.accepted && rollout.edits == item->distance)
                ++report->seen_optimal;
        } else {
            ++report->unseen_observations;
            if (rollout.accepted && rollout.edits == item->distance)
                ++report->unseen_optimal;
        }
        action = select_action(model, item->invariant_mask, &item->witness,
                               R31_FEEDBACK_FULL);
        changed = item->witness;
        changed.nonce ^= UINT16_C(0xa55a);
        if (select_action(model, item->invariant_mask, &changed,
                          R31_FEEDBACK_FULL) != action)
            report->irrelevant_swap_exact = 0;
        for (permutation = 1; permutation < 6; ++permutation) {
            uint16_t transformed_mask =
                transform_mask(item->invariant_mask, permutation);
            R31Witness transformed_witness =
                transform_witness(item->witness, permutation);
            int transformed_action =
                select_action(model, transformed_mask, &transformed_witness,
                              R31_FEEDBACK_FULL);
            if (action < 0 || transformed_action !=
                                  transform_atom(action, permutation))
                report->permutation_exact = 0;
        }
    }
    free(seen);

    for (index = 0; index < holdout_corpus->case_count; ++index) {
        const R31Case *left = &holdout_corpus->cases[index];
        uint16_t left_progress;
        if (left->stage != stage) continue;
        left_progress =
            progress_actions(left->invariant_mask, &left->witness);
        for (right = index + 1; right < holdout_corpus->case_count;
             ++right) {
            const R31Case *other = &holdout_corpus->cases[right];
            int left_action, right_action;
            int left_masked, right_masked;
            if (other->stage != stage ||
                other->invariant_mask != left->invariant_mask ||
                (other->optimal_actions & left->optimal_actions) != 0 ||
                progress_actions(other->invariant_mask, &other->witness) !=
                    left_progress)
                continue;
            ++report->equal_admissibility_pairs;
            left_action = select_action(model, left->invariant_mask,
                                        &left->witness,
                                        R31_FEEDBACK_FULL);
            right_action = select_action(model, other->invariant_mask,
                                         &other->witness,
                                         R31_FEEDBACK_FULL);
            if (left_action >= 0 && right_action >= 0 &&
                (left->optimal_actions &
                 (UINT16_C(1) << left_action)) != 0 &&
                (other->optimal_actions &
                 (UINT16_C(1) << right_action)) != 0)
                ++report->equal_admissibility_pairs_exact;
            left_masked = select_action(model, left->invariant_mask,
                                        &left->witness,
                                        R31_FEEDBACK_RANKER_MASKED);
            right_masked = select_action(model, other->invariant_mask,
                                         &other->witness,
                                         R31_FEEDBACK_RANKER_MASKED);
            if (left_masked >= 0 && right_masked >= 0 &&
                (left->optimal_actions &
                 (UINT16_C(1) << left_masked)) != 0 &&
                (other->optimal_actions &
                 (UINT16_C(1) << right_masked)) != 0)
                ++report->equal_admissibility_masked_both_correct;
        }
    }
    report->gate_passed =
        (uint8_t)(report->full.exact && report->unseen_observations > 0 &&
                  report->unseen_optimal == report->unseen_observations &&
                  report->equal_admissibility_pairs > 0 &&
                  report->equal_admissibility_pairs_exact ==
                      report->equal_admissibility_pairs &&
                  report->equal_admissibility_masked_both_correct == 0 &&
                  report->irrelevant_swap_exact &&
                  report->permutation_exact &&
                  !report->ranker_masked.exact &&
                  !report->no_feedback.exact && !report->tool_only.exact);
    return R0_OK;
}

R0Status r31_train(R31Model *model, R31TrainingReport *report,
                   char *error, size_t error_capacity)
{
    R31Corpus *training = NULL, *holdout = NULL;
    uint32_t epochs = 0, mistakes = 0;
    uint8_t stage;
    R0Status status = R0_OK;
    if (model == NULL || report == NULL) return R0_INVALID_ARGUMENT;
    r31_model_init(model);
    memset(report, 0, sizeof(*report));
    if (!build_world()) return R0_LIMIT_ERROR;
    report->programs = R31_PROGRAM_COUNT;
    for (stage = 1; stage <= R31_TEST_STAGE; ++stage)
        report->programs_by_stage[stage] =
            R31_PROGRAMS_BY_STAGE[stage];
    training = (R31Corpus *)malloc(sizeof(*training));
    holdout = (R31Corpus *)malloc(sizeof(*holdout));
    if (training == NULL || holdout == NULL) {
        status = R0_LIMIT_ERROR;
        goto done;
    }
    for (stage = 1; stage <= R31_TRAINING_STAGE; ++stage) {
        status = build_corpus(stage, training, error, error_capacity);
        if (status != R0_OK) goto done;
        status = train_stage(model, training, stage, &epochs, &mistakes,
                             error, error_capacity);
        if (status != R0_OK) goto done;
        model->trained_stage = stage;
        model->evaluated_stage = stage;
        ++report->curriculum_promotions;
    }
    status = build_corpus(R31_DEVELOPMENT_STAGE, holdout, error,
                          error_capacity);
    if (status != R0_OK) goto done;
    status = analyze_holdout(model, training, holdout,
                             R31_DEVELOPMENT_STAGE, &report->development);
    if (status != R0_OK) goto done;
    model->evaluated_stage = R31_DEVELOPMENT_STAGE;
    if (!report->development.gate_passed) goto completed;

    status = train_stage(model, holdout, R31_DEVELOPMENT_STAGE, &epochs,
                         &mistakes, error, error_capacity);
    if (status != R0_OK) goto done;
    model->trained_stage = R31_DEVELOPMENT_STAGE;
    model->evaluated_stage = R31_DEVELOPMENT_STAGE;
    ++report->curriculum_promotions;
    {
        R31Corpus *old_training = training;
        training = holdout;
        holdout = old_training;
    }
    status = build_corpus(R31_TEST_STAGE, holdout, error, error_capacity);
    if (status != R0_OK) goto done;
    status = analyze_holdout(model, training, holdout, R31_TEST_STAGE,
                             &report->sealed_test);
    if (status != R0_OK) goto done;
    model->evaluated_stage = R31_TEST_STAGE;
    model->sealed_test_passed = report->sealed_test.gate_passed;

completed:
    report->cases = training->case_count;
    report->positive_cases = training->positive_cases;
    report->negative_cases = training->negative_cases;
    report->implication_cases = training->implication_cases;
    report->final_action_errors =
        action_errors(model, training, model->trained_stage);
    report->trained_stage = model->trained_stage;
    report->epochs = epochs;
    report->mistakes = mistakes;
    report->experiment_passed =
        (uint8_t)(report->development.gate_passed &&
                  report->sealed_test.gate_passed &&
                  report->final_action_errors == 0);
    model->trained_epochs = epochs;
    model->training_mistakes = mistakes;
    if (report->final_action_errors != 0) {
        set_error(error, error_capacity,
                  "3D policy retains %u supervised action errors",
                  report->final_action_errors);
        status = R0_POLICY_ERROR;
    }
done:
    free(training);
    free(holdout);
    return status;
}

R0Status r31_evaluate(const R31Model *model, uint8_t stage,
                      uint8_t feedback_mode, R31EvaluationReport *report,
                      char *error, size_t error_capacity)
{
    R31Corpus *corpus;
    R0Status status;
    if (model == NULL || report == NULL || stage < 1 ||
        stage > R31_TEST_STAGE || stage > model->evaluated_stage ||
        feedback_mode > R31_FEEDBACK_TOOL_ONLY)
        return R0_INVALID_ARGUMENT;
    corpus = (R31Corpus *)malloc(sizeof(*corpus));
    if (corpus == NULL) return R0_LIMIT_ERROR;
    status = build_corpus(stage, corpus, error, error_capacity);
    if (status == R0_OK)
        status = evaluate_corpus(model, corpus, stage, feedback_mode, report);
    free(corpus);
    return status;
}

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t feature_count;
    uint8_t trained_stage;
    uint8_t evaluated_stage;
    uint8_t sealed_test_passed;
    uint8_t reserved;
    uint32_t trained_epochs;
    uint32_t training_mistakes;
} R31ModelHeader;

R0Status r31_model_save(const R31Model *model, const char *path,
                        char *error, size_t error_capacity)
{
    static const char magic[8] = {'R', '3', '1', 'I', 'C', 'E', '1', '\0'};
    R31ModelHeader header;
    R31EvaluationReport evaluation;
    FILE *file;
    uint8_t stage;
    R0Status status;
    if (model == NULL || path == NULL || model->trained_stage < 1 ||
        model->trained_stage > R31_DEVELOPMENT_STAGE ||
        model->evaluated_stage < model->trained_stage)
        return R0_INVALID_ARGUMENT;
    for (stage = 1; stage <= model->trained_stage; ++stage) {
        status = r31_evaluate(model, stage, R31_FEEDBACK_FULL, &evaluation,
                              error, error_capacity);
        if (status != R0_OK) return status;
        if (!evaluation.exact) {
            set_error(error, error_capacity,
                      "refusing to save a non-exact 3D policy");
            return R0_POLICY_ERROR;
        }
    }
    if (model->sealed_test_passed) {
        status = r31_evaluate(model, R31_TEST_STAGE, R31_FEEDBACK_FULL,
                              &evaluation, error, error_capacity);
        if (status != R0_OK || !evaluation.exact) {
            set_error(error, error_capacity,
                      "sealed stage-6 replay is no longer exact");
            return R0_POLICY_ERROR;
        }
    }
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, magic, sizeof(magic));
    header.version = R31_MODEL_VERSION;
    header.feature_count = R31_FEATURE_COUNT;
    header.trained_stage = model->trained_stage;
    header.evaluated_stage = model->evaluated_stage;
    header.sealed_test_passed = model->sealed_test_passed;
    header.trained_epochs = model->trained_epochs;
    header.training_mistakes = model->training_mistakes;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fwrite(&header, sizeof(header), 1, file) != 1 ||
        fwrite(model->weights, sizeof(model->weights), 1, file) != 1) {
        (void)fclose(file);
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot close %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}

R0Status r31_model_load(R31Model *model, const char *path,
                        char *error, size_t error_capacity)
{
    static const char magic[8] = {'R', '3', '1', 'I', 'C', 'E', '1', '\0'};
    R31ModelHeader header;
    R31EvaluationReport evaluation;
    FILE *file;
    uint8_t stage;
    R0Status status;
    if (model == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    file = fopen(path, "rb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    memset(model, 0, sizeof(*model));
    if (fread(&header, sizeof(header), 1, file) != 1 ||
        memcmp(header.magic, magic, sizeof(magic)) != 0 ||
        header.version != R31_MODEL_VERSION ||
        header.feature_count != R31_FEATURE_COUNT ||
        header.trained_stage < 1 ||
        header.trained_stage > R31_DEVELOPMENT_STAGE ||
        header.evaluated_stage < header.trained_stage ||
        header.evaluated_stage > R31_TEST_STAGE ||
        fread(model->weights, sizeof(model->weights), 1, file) != 1 ||
        fgetc(file) != EOF) {
        (void)fclose(file);
        set_error(error, error_capacity, "invalid Reasoner-3.1 model %s",
                  path);
        return R0_IO_ERROR;
    }
    if (fclose(file) != 0) return R0_IO_ERROR;
    model->trained_stage = header.trained_stage;
    model->evaluated_stage = header.evaluated_stage;
    model->sealed_test_passed = header.sealed_test_passed;
    model->trained_epochs = header.trained_epochs;
    model->training_mistakes = header.training_mistakes;
    for (stage = 1; stage <= model->trained_stage; ++stage) {
        status = r31_evaluate(model, stage, R31_FEEDBACK_FULL, &evaluation,
                              error, error_capacity);
        if (status != R0_OK || !evaluation.exact) {
            set_error(error, error_capacity,
                      "Reasoner-3.1 model fails exact replay");
            return R0_POLICY_ERROR;
        }
    }
    if (model->sealed_test_passed) {
        status = r31_evaluate(model, R31_TEST_STAGE, R31_FEEDBACK_FULL,
                              &evaluation, error, error_capacity);
        if (status != R0_OK || !evaluation.exact) {
            set_error(error, error_capacity,
                      "Reasoner-3.1 model fails sealed replay");
            return R0_POLICY_ERROR;
        }
    }
    return R0_OK;
}

R0Status r31_solve(const R31Model *model, uint16_t program_index,
                   R31Invariant *invariant, uint32_t *verifier_calls,
                   char *error, size_t error_capacity)
{
    const R31Program *program;
    R31Verification verification;
    uint16_t mask = 0;
    uint32_t calls = 0, step;
    if (model == NULL || invariant == NULL || !build_world() ||
        program_index >= R31_PROGRAM_COUNT)
        return R0_INVALID_ARGUMENT;
    program = &R31_PROGRAMS[program_index];
    if (program->stage > model->trained_stage &&
        !(program->stage == R31_TEST_STAGE &&
          model->sealed_test_passed &&
          model->evaluated_stage == R31_TEST_STAGE))
        return R0_INVALID_ARGUMENT;
    (void)verify_program(program, mask, &verification);
    for (step = 0; step < R31_MAX_REPAIR_STEPS && !verification.accepted;
         ++step) {
        int action = select_action(model, mask, &verification.witness,
                                   R31_FEEDBACK_FULL);
        if (action < 0) break;
        mask ^= (uint16_t)(UINT16_C(1) << action);
        ++calls;
        (void)verify_program(program, mask, &verification);
    }
    if (!verification.accepted) {
        set_error(error, error_capacity,
                  "policy did not synthesize a 3D invariant in %u edits",
                  R31_MAX_REPAIR_STEPS);
        return R0_POLICY_ERROR;
    }
    invariant->atom_mask = mask;
    if (verifier_calls != NULL) *verifier_calls = calls;
    return R0_OK;
}

static uint64_t answer_checksum(uint16_t program_index, uint16_t mask)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    unsigned byte;
    for (byte = 0; byte < 2; ++byte) {
        hash ^= (program_index >> (8U * byte)) & UINT16_C(0xff);
        hash *= UINT64_C(1099511628211);
    }
    for (byte = 0; byte < 2; ++byte) {
        hash ^= (mask >> (8U * byte)) & UINT16_C(0xff);
        hash *= UINT64_C(1099511628211);
    }
    hash ^= UINT64_C(0x5245415333313344);
    return hash;
}

R0Status r31_answer_seal(uint16_t program_index,
                         const R31Invariant *invariant,
                         R31AnswerIR *answer, char *error,
                         size_t error_capacity)
{
    R31Verification verification;
    R0Status status;
    if (invariant == NULL || answer == NULL) return R0_INVALID_ARGUMENT;
    status = r31_verify(program_index, invariant, &verification, error,
                        error_capacity);
    if (status != R0_OK) return status;
    if (!verification.accepted) {
        set_error(error, error_capacity,
                  "only a verifier-accepted 3D invariant can be sealed");
        return R0_SEAL_ERROR;
    }
    memset(answer, 0, sizeof(*answer));
    answer->program_index = program_index;
    answer->atom_mask = invariant->atom_mask;
    answer->checksum = answer_checksum(program_index, invariant->atom_mask);
    answer->sealed = 1;
    return R0_OK;
}

static int append_text(char *output, size_t capacity, size_t *length,
                       const char *format, ...)
{
    int written;
    va_list arguments;
    if (*length >= capacity) return 0;
    va_start(arguments, format);
    written = vsnprintf(output + *length, capacity - *length, format,
                        arguments);
    va_end(arguments);
    if (written < 0 || (size_t)written >= capacity - *length) return 0;
    *length += (size_t)written;
    return 1;
}

R0Status r31_language_render(const R31AnswerIR *answer, char *output,
                             size_t output_capacity, char *error,
                             size_t error_capacity)
{
    static const char *variables[R31_DIMENSIONS] = {"x", "y", "z"};
    R31Invariant invariant;
    R31Verification verification;
    size_t length = 0;
    int atom, count = 0;
    if (answer == NULL || output == NULL || output_capacity == 0)
        return R0_INVALID_ARGUMENT;
    if (!answer->sealed ||
        answer->checksum !=
            answer_checksum(answer->program_index, answer->atom_mask)) {
        set_error(error, error_capacity,
                  "language rendering requires an intact sealed answer");
        return R0_SEAL_ERROR;
    }
    invariant.atom_mask = answer->atom_mask;
    if (r31_verify(answer->program_index, &invariant, &verification, error,
                   error_capacity) != R0_OK ||
        !verification.accepted) {
        set_error(error, error_capacity,
                  "sealed 3D answer no longer passes its verifier");
        return R0_SEAL_ERROR;
    }
    if (!append_text(output, output_capacity, &length,
                     "The verified invariant is "))
        return R0_LIMIT_ERROR;
    for (atom = 0; atom < R31_ATOM_COUNT; ++atom) {
        int dimension, coefficient, bound;
        if ((answer->atom_mask & (UINT16_C(1) << atom)) == 0) continue;
        dimension = atom / 4;
        coefficient = R31_ATOMS[atom].coefficients[dimension];
        bound = coefficient > 0 ? R31_ATOMS[atom].constant
                                : -R31_ATOMS[atom].constant;
        if (!append_text(output, output_capacity, &length, "%s%s %s %d",
                         count == 0 ? "" : " and ", variables[dimension],
                         coefficient > 0 ? "<=" : ">=", bound))
            return R0_LIMIT_ERROR;
        ++count;
    }
    if (count == 0 &&
        !append_text(output, output_capacity, &length, "true"))
        return R0_LIMIT_ERROR;
    if (!append_text(output, output_capacity, &length, "."))
        return R0_LIMIT_ERROR;
    return R0_OK;
}
