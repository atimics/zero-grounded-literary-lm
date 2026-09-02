#include "reasoner3.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R3_ALL_ATOMS ((uint16_t)((UINT16_C(1) << R3_ATOM_COUNT) - 1U))
#define R3_MAX_ACTIVE_FEATURES 192
#define R3_MODEL_VERSION 1U

typedef struct {
    uint16_t target_mask;
    uint32_t safe_states;
    uint8_t stage;
    uint8_t initial_state;
    uint8_t successor[R3_STATE_COUNT];
} R3Program;

typedef struct {
    uint16_t program_index;
    uint16_t invariant_mask;
    uint16_t optimal_actions;
    R3Witness witness;
    uint8_t stage;
    uint8_t distance;
} R3Case;

typedef struct {
    R3Program programs[R3_MAX_PROGRAMS];
    R3Case cases[R3_MAX_CASES];
    uint16_t program_count;
    uint16_t case_count;
    uint32_t positive_cases;
    uint32_t negative_cases;
    uint32_t implication_cases;
} R3Corpus;

typedef struct {
    uint16_t count;
    uint16_t indices[R3_MAX_ACTIVE_FEATURES];
    int16_t values[R3_MAX_ACTIVE_FEATURES];
} R3FeatureVector;

static const R3Atom R3_ATOMS[R3_ATOM_COUNT] = {
    {{1, 0}, -1}, {{1, 0}, 0}, {{1, 0}, 1},
    {{-1, 0}, -1}, {{-1, 0}, 0}, {{-1, 0}, 1},
    {{0, 1}, -1}, {{0, 1}, 0}, {{0, 1}, 1},
    {{0, -1}, -1}, {{0, -1}, 0}, {{0, -1}, 1},
};

static R3Program R3_PROGRAMS[R3_MAX_PROGRAMS];
static uint16_t R3_PROGRAM_COUNT;
static int R3_PROGRAMS_READY;

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

static R3State state_from_index(int index)
{
    R3State state;
    state.values[0] =
        (int8_t)(R3_DOMAIN_MIN + index / (R3_DOMAIN_MAX - R3_DOMAIN_MIN + 1));
    state.values[1] =
        (int8_t)(R3_DOMAIN_MIN + index % (R3_DOMAIN_MAX - R3_DOMAIN_MIN + 1));
    return state;
}

static int atom_holds(int atom_index, const R3State *state)
{
    const R3Atom *atom = &R3_ATOMS[atom_index];
    int value = atom->coefficients[0] * state->values[0] +
                atom->coefficients[1] * state->values[1];
    return value <= atom->constant;
}

static int invariant_holds(uint16_t mask, const R3State *state)
{
    int atom;
    for (atom = 0; atom < R3_ATOM_COUNT; ++atom)
        if ((mask & (UINT16_C(1) << atom)) != 0 &&
            !atom_holds(atom, state))
            return 0;
    return 1;
}

static uint32_t invariant_states(uint16_t mask)
{
    uint32_t states = 0;
    int index;
    for (index = 0; index < R3_STATE_COUNT; ++index) {
        R3State state = state_from_index(index);
        if (invariant_holds(mask, &state))
            states |= UINT32_C(1) << index;
    }
    return states;
}

static int popcount32(uint32_t value)
{
    int count = 0;
    while (value != 0) {
        count += value & 1U;
        value >>= 1;
    }
    return count;
}

static int state_distance_to_set(int state, uint32_t set)
{
    R3State source = state_from_index(state);
    int best = INT_MAX, candidate;
    for (candidate = 0; candidate < R3_STATE_COUNT; ++candidate) {
        R3State target;
        int distance;
        if ((set & (UINT32_C(1) << candidate)) == 0) continue;
        target = state_from_index(candidate);
        distance = abs(source.values[0] - target.values[0]) +
                   abs(source.values[1] - target.values[1]);
        if (distance < best) best = distance;
    }
    return best;
}

static int nearest_state_in_set(int state, uint32_t set)
{
    R3State source = state_from_index(state);
    int best = -1, best_distance = INT_MAX, candidate;
    for (candidate = 0; candidate < R3_STATE_COUNT; ++candidate) {
        R3State target;
        int distance;
        if ((set & (UINT32_C(1) << candidate)) == 0) continue;
        target = state_from_index(candidate);
        distance = abs(source.values[0] - target.values[0]) +
                   abs(source.values[1] - target.values[1]);
        if (distance < best_distance) {
            best = candidate;
            best_distance = distance;
        }
    }
    return best;
}

static int mask_is_minimal(uint16_t mask, uint32_t states)
{
    int atom;
    for (atom = 0; atom < R3_ATOM_COUNT; ++atom) {
        uint16_t bit = (uint16_t)(UINT16_C(1) << atom);
        if ((mask & bit) != 0 && invariant_states(mask ^ bit) == states)
            return 0;
    }
    return 1;
}

static int program_add(uint16_t target_mask, uint8_t stage)
{
    R3Program *program;
    uint32_t safe = invariant_states(target_mask);
    int index, first = -1, previous = -1;
    if (safe == 0 || !mask_is_minimal(target_mask, safe)) return 1;
    for (index = 0; index < R3_PROGRAM_COUNT; ++index)
        if (R3_PROGRAMS[index].safe_states == safe) return 1;
    if (R3_PROGRAM_COUNT >= R3_MAX_PROGRAMS) return 0;
    program = &R3_PROGRAMS[R3_PROGRAM_COUNT++];
    memset(program, 0, sizeof(*program));
    program->target_mask = target_mask;
    program->safe_states = safe;
    program->stage = stage;
    for (index = 0; index < R3_STATE_COUNT; ++index)
        program->successor[index] = (uint8_t)index;
    for (index = 0; index < R3_STATE_COUNT; ++index) {
        if ((safe & (UINT32_C(1) << index)) == 0) continue;
        if (first < 0) first = index;
        if (previous >= 0) program->successor[previous] = (uint8_t)index;
        previous = index;
    }
    program->successor[previous] = (uint8_t)first;
    program->initial_state = (uint8_t)first;
    return 1;
}

static int build_programs(void)
{
    uint16_t mask;
    if (R3_PROGRAMS_READY) return 1;
    R3_PROGRAM_COUNT = 0;
    memset(R3_PROGRAMS, 0, sizeof(R3_PROGRAMS));
    for (mask = 1; mask <= R3_ALL_ATOMS; ++mask) {
        int stage = popcount16(mask);
        if (stage < 1 || stage > R3_MAX_STAGE) continue;
        if (!program_add(mask, (uint8_t)stage)) return 0;
    }
    R3_PROGRAMS_READY = 1;
    return R3_PROGRAM_COUNT > 0;
}

const R3Atom *r3_atoms(void)
{
    return R3_ATOMS;
}

const char *r3_witness_name(uint8_t kind)
{
    switch (kind) {
    case R3_WITNESS_UNKNOWN: return "unknown";
    case R3_WITNESS_POSITIVE: return "positive";
    case R3_WITNESS_NEGATIVE: return "negative";
    case R3_WITNESS_IMPLICATION: return "implication";
    case R3_WITNESS_VALID: return "valid";
    default: return "invalid";
    }
}

uint16_t r3_program_count(void)
{
    return build_programs() ? R3_PROGRAM_COUNT : 0;
}

uint8_t r3_program_stage(uint16_t program_index)
{
    if (!build_programs() || program_index >= R3_PROGRAM_COUNT) return 0;
    return R3_PROGRAMS[program_index].stage;
}

static R0Status verify_program(const R3Program *program, uint16_t mask,
                               R3Verification *verification)
{
    R3State initial = state_from_index(program->initial_state);
    int index, best = -1, best_distance = INT_MAX;
    memset(verification, 0, sizeof(*verification));
    verification->witness.nonce =
        (uint16_t)(mask * UINT16_C(257) + UINT16_C(0x00a5));
    if (!invariant_holds(mask, &initial)) {
        verification->witness.kind = R3_WITNESS_POSITIVE;
        verification->witness.source = initial;
        verification->witness.target =
            state_from_index(program->successor[program->initial_state]);
        return R0_OK;
    }
    for (index = 0; index < R3_STATE_COUNT; ++index) {
        R3State state;
        int distance;
        if ((program->safe_states & (UINT32_C(1) << index)) != 0)
            continue;
        state = state_from_index(index);
        if (!invariant_holds(mask, &state)) continue;
        distance = state_distance_to_set(index, program->safe_states);
        if (distance < best_distance) {
            best_distance = distance;
            best = index;
        }
    }
    if (best >= 0) {
        int nearest = nearest_state_in_set(best, program->safe_states);
        verification->witness.kind = R3_WITNESS_NEGATIVE;
        verification->witness.source = state_from_index(best);
        verification->witness.target = state_from_index(nearest);
        return R0_OK;
    }
    for (index = 0; index < R3_STATE_COUNT; ++index) {
        R3State source, target;
        if ((program->safe_states & (UINT32_C(1) << index)) == 0)
            continue;
        source = state_from_index(index);
        target = state_from_index(program->successor[index]);
        if (invariant_holds(mask, &source) &&
            !invariant_holds(mask, &target)) {
            verification->witness.kind = R3_WITNESS_IMPLICATION;
            verification->witness.source = source;
            verification->witness.target = target;
            return R0_OK;
        }
    }
    verification->accepted = 1;
    verification->witness.kind = R3_WITNESS_VALID;
    return R0_OK;
}

R0Status r3_verify(uint16_t program_index, const R3Invariant *invariant,
                   R3Verification *verification, char *error,
                   size_t error_capacity)
{
    if (invariant == NULL || verification == NULL ||
        (invariant->atom_mask & ~R3_ALL_ATOMS) != 0)
        return R0_INVALID_ARGUMENT;
    if (!build_programs() || program_index >= R3_PROGRAM_COUNT) {
        set_error(error, error_capacity, "program index %u is unavailable",
                  (unsigned)program_index);
        return R0_INVALID_ARGUMENT;
    }
    return verify_program(&R3_PROGRAMS[program_index], invariant->atom_mask,
                          verification);
}

static int witness_resolved(uint16_t mask, const R3Witness *witness)
{
    if (witness->kind == R3_WITNESS_POSITIVE)
        return invariant_holds(mask, &witness->source);
    if (witness->kind == R3_WITNESS_NEGATIVE)
        return !invariant_holds(mask, &witness->source);
    if (witness->kind == R3_WITNESS_IMPLICATION)
        return !invariant_holds(mask, &witness->source) ||
               invariant_holds(mask, &witness->target);
    return 0;
}

static R0Status compute_distances(const R3Program *program,
                                  uint8_t distances[1U << R3_ATOM_COUNT],
                                  char *error, size_t error_capacity)
{
    uint16_t queue[1U << R3_ATOM_COUNT];
    unsigned head = 0, tail = 0, mask;
    memset(distances, UINT8_MAX, UINT16_C(1) << R3_ATOM_COUNT);
    for (mask = 0; mask <= R3_ALL_ATOMS; ++mask) {
        R3Verification verification;
        R0Status status = verify_program(program, (uint16_t)mask,
                                         &verification);
        if (status != R0_OK) return status;
        if (verification.accepted) {
            distances[mask] = 0;
            queue[tail++] = (uint16_t)mask;
        }
    }
    if (tail == 0) {
        set_error(error, error_capacity,
                  "ICE program has no expressible invariant");
        return R0_VERIFIER_ERROR;
    }
    while (head < tail) {
        uint16_t current = queue[head++];
        int atom;
        for (atom = 0; atom < R3_ATOM_COUNT; ++atom) {
            uint16_t next =
                (uint16_t)(current ^ (UINT16_C(1) << atom));
            if (distances[next] != UINT8_MAX) continue;
            distances[next] = (uint8_t)(distances[current] + 1U);
            queue[tail++] = next;
        }
    }
    return R0_OK;
}

static R0Status corpus_add_case(
    R3Corpus *corpus, uint16_t program_index, uint16_t mask,
    const uint8_t distances[1U << R3_ATOM_COUNT], char *error,
    size_t error_capacity)
{
    const R3Program *program = &corpus->programs[program_index];
    R3Verification verification;
    R3Case *item;
    uint16_t optimal = 0;
    int atom, index;
    R0Status status;
    for (index = 0; index < corpus->case_count; ++index)
        if (corpus->cases[index].program_index == program_index &&
            corpus->cases[index].invariant_mask == mask)
            return R0_OK;
    status = verify_program(program, mask, &verification);
    if (status != R0_OK || verification.accepted) return status;
    if (distances[mask] == 0 ||
        distances[mask] > R3_MAX_REPAIR_STEPS)
        return R0_OK;
    for (atom = 0; atom < R3_ATOM_COUNT; ++atom) {
        uint16_t next = (uint16_t)(mask ^ (UINT16_C(1) << atom));
        if (distances[next] + 1U == distances[mask] &&
            witness_resolved(next, &verification.witness))
            optimal |= (uint16_t)(UINT16_C(1) << atom);
    }
    if (optimal == 0) return R0_OK;
    if (corpus->case_count >= R3_MAX_CASES) {
        set_error(error, error_capacity, "ICE corpus exceeds %u cases",
                  R3_MAX_CASES);
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
    if (item->witness.kind == R3_WITNESS_POSITIVE)
        ++corpus->positive_cases;
    else if (item->witness.kind == R3_WITNESS_NEGATIVE)
        ++corpus->negative_cases;
    else if (item->witness.kind == R3_WITNESS_IMPLICATION)
        ++corpus->implication_cases;
    return R0_OK;
}

static int swap_atom(int atom)
{
    return atom < 6 ? atom + 6 : atom - 6;
}

static uint16_t swap_mask(uint16_t mask)
{
    return (uint16_t)(((mask & UINT16_C(0x003f)) << 6) |
                      ((mask & UINT16_C(0x0fc0)) >> 6));
}

static R3State swap_state(R3State state)
{
    int8_t value = state.values[0];
    state.values[0] = state.values[1];
    state.values[1] = value;
    return state;
}

static R3Witness swap_witness(R3Witness witness)
{
    witness.source = swap_state(witness.source);
    witness.target = swap_state(witness.target);
    return witness;
}

static uint32_t pack_state(const R3State *state)
{
    return (uint32_t)(state->values[0] - R3_DOMAIN_MIN) * 5U +
           (uint32_t)(state->values[1] - R3_DOMAIN_MIN);
}

static uint32_t pack_witness(const R3Witness *witness)
{
    return (uint32_t)witness->kind * 625U +
           pack_state(&witness->source) * 25U +
           pack_state(&witness->target);
}

static int canonicalize_context(uint16_t mask, const R3Witness *witness,
                                uint16_t *canonical_mask,
                                R3Witness *canonical_witness)
{
    uint16_t swapped_mask = swap_mask(mask);
    R3Witness swapped_witness = swap_witness(*witness);
    uint32_t original_witness = pack_witness(witness);
    uint32_t swapped_witness_key = pack_witness(&swapped_witness);
    int swapped = swapped_mask < mask ||
                  (swapped_mask == mask &&
                   swapped_witness_key < original_witness);
    if (swapped) {
        *canonical_mask = swapped_mask;
        *canonical_witness = swapped_witness;
    } else {
        *canonical_mask = mask;
        *canonical_witness = *witness;
    }
    canonical_witness->nonce = 0;
    return swapped;
}

static int same_observable(const R3Case *left, const R3Case *right)
{
    uint16_t left_mask, right_mask;
    R3Witness left_witness, right_witness;
    (void)canonicalize_context(left->invariant_mask, &left->witness,
                               &left_mask, &left_witness);
    (void)canonicalize_context(right->invariant_mask, &right->witness,
                               &right_mask, &right_witness);
    return left_mask == right_mask &&
           pack_witness(&left_witness) == pack_witness(&right_witness);
}

static R0Status normalize_targets(R3Corpus *corpus, char *error,
                                  size_t error_capacity)
{
    int first, second;
    uint8_t done[R3_MAX_CASES];
    memset(done, 0, sizeof(done));
    for (first = 0; first < corpus->case_count; ++first) {
        uint16_t canonical_targets;
        int first_swapped;
        uint16_t ignored_mask;
        R3Witness ignored_witness;
        if (done[first]) continue;
        first_swapped = canonicalize_context(
            corpus->cases[first].invariant_mask, &corpus->cases[first].witness,
            &ignored_mask, &ignored_witness);
        canonical_targets = first_swapped
                                ? swap_mask(corpus->cases[first].optimal_actions)
                                : corpus->cases[first].optimal_actions;
        for (second = first + 1; second < corpus->case_count; ++second) {
            uint16_t targets;
            int swapped;
            if (!same_observable(&corpus->cases[first],
                                 &corpus->cases[second]))
                continue;
            swapped = canonicalize_context(
                corpus->cases[second].invariant_mask,
                &corpus->cases[second].witness, &ignored_mask,
                &ignored_witness);
            targets = swapped
                          ? swap_mask(corpus->cases[second].optimal_actions)
                          : corpus->cases[second].optimal_actions;
            canonical_targets &= targets;
        }
        if (canonical_targets == 0) {
            set_error(error, error_capacity,
                      "verifier witness does not identify a consistent edit");
            return R0_POLICY_ERROR;
        }
        for (second = first; second < corpus->case_count; ++second) {
            int swapped;
            if (!same_observable(&corpus->cases[first],
                                 &corpus->cases[second]))
                continue;
            swapped = canonicalize_context(
                corpus->cases[second].invariant_mask,
                &corpus->cases[second].witness, &ignored_mask,
                &ignored_witness);
            corpus->cases[second].optimal_actions =
                swapped ? swap_mask(canonical_targets) : canonical_targets;
            done[second] = 1;
        }
    }
    return R0_OK;
}

static R0Status build_corpus(uint8_t maximum_stage, R3Corpus *corpus,
                             char *error, size_t error_capacity)
{
    uint16_t program_index;
    if (maximum_stage < 1 || maximum_stage > R3_MAX_STAGE ||
        corpus == NULL)
        return R0_INVALID_ARGUMENT;
    if (!build_programs()) return R0_LIMIT_ERROR;
    memset(corpus, 0, sizeof(*corpus));
    for (program_index = 0; program_index < R3_PROGRAM_COUNT;
         ++program_index) {
        const R3Program *source = &R3_PROGRAMS[program_index];
        uint8_t distances[1U << R3_ATOM_COUNT];
        uint16_t local_program;
        int first, second, extra;
        R0Status status;
        if (source->stage > maximum_stage) continue;
        if (corpus->program_count >= R3_MAX_PROGRAMS)
            return R0_LIMIT_ERROR;
        local_program = corpus->program_count++;
        corpus->programs[local_program] = *source;
        status = compute_distances(&corpus->programs[local_program],
                                   distances, error, error_capacity);
        if (status != R0_OK) return status;
        status = corpus_add_case(corpus, local_program, 0, distances, error,
                                 error_capacity);
        if (status != R0_OK) return status;
        for (first = 0; first < R3_ATOM_COUNT; ++first) {
            uint16_t first_bit = (uint16_t)(UINT16_C(1) << first);
            uint16_t changed = (uint16_t)(source->target_mask ^ first_bit);
            status = corpus_add_case(corpus, local_program, changed,
                                     distances, error, error_capacity);
            if (status != R0_OK) return status;
            if ((source->target_mask & first_bit) == 0) continue;
            for (second = first + 1; second < R3_ATOM_COUNT; ++second) {
                uint16_t second_bit =
                    (uint16_t)(UINT16_C(1) << second);
                if ((source->target_mask & second_bit) == 0) continue;
                changed = (uint16_t)(source->target_mask ^ first_bit ^
                                     second_bit);
                status = corpus_add_case(corpus, local_program, changed,
                                         distances, error, error_capacity);
                if (status != R0_OK) return status;
            }
            for (extra = 0; extra < R3_ATOM_COUNT; ++extra) {
                uint16_t extra_bit =
                    (uint16_t)(UINT16_C(1) << extra);
                if ((source->target_mask & extra_bit) != 0) continue;
                changed = (uint16_t)((source->target_mask ^ first_bit) |
                                     extra_bit);
                status = corpus_add_case(corpus, local_program, changed,
                                         distances, error, error_capacity);
                if (status != R0_OK) return status;
            }
        }
    }
    return normalize_targets(corpus, error, error_capacity);
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static void feature_add(R3FeatureVector *features, uint32_t key, int value)
{
    uint16_t index = (uint16_t)(mix32(key) % R3_FEATURE_COUNT);
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor) {
        if (features->indices[cursor] == index) {
            features->values[cursor] =
                (int16_t)(features->values[cursor] + value);
            return;
        }
    }
    if (features->count >= R3_MAX_ACTIVE_FEATURES) return;
    features->indices[features->count] = index;
    features->values[features->count] = (int16_t)value;
    ++features->count;
}

static int atom_value(int atom, const R3State *state)
{
    return R3_ATOMS[atom].coefficients[0] * state->values[0] +
           R3_ATOMS[atom].coefficients[1] * state->values[1];
}

static int canonical_action(uint16_t mask, const R3Witness *witness,
                            int action)
{
    uint16_t ignored_mask;
    R3Witness ignored_witness;
    return canonicalize_context(mask, witness, &ignored_mask,
                                &ignored_witness)
               ? swap_atom(action)
               : action;
}

static void extract_features(uint16_t mask, const R3Witness *observed,
                             int action, int mask_feedback,
                             R3FeatureVector *features)
{
    R3Witness witness = *observed;
    R3Witness canonical_witness;
    uint16_t canonical_mask;
    uint16_t candidate;
    uint32_t packed;
    int canonical_atom, adding, source_slack, target_slack;
    int source_holds, target_holds, resolves;
    memset(features, 0, sizeof(*features));
    if (mask_feedback) {
        memset(&witness, 0, sizeof(witness));
        witness.kind = R3_WITNESS_UNKNOWN;
    }
    if (canonicalize_context(mask, &witness, &canonical_mask,
                             &canonical_witness))
        canonical_atom = swap_atom(action);
    else
        canonical_atom = action;
    packed = pack_witness(&canonical_witness);
    adding = (canonical_mask & (UINT16_C(1) << canonical_atom)) == 0;
    candidate = (uint16_t)(canonical_mask ^
                           (UINT16_C(1) << canonical_atom));
    source_slack = R3_ATOMS[canonical_atom].constant -
                   atom_value(canonical_atom, &canonical_witness.source);
    target_slack = R3_ATOMS[canonical_atom].constant -
                   atom_value(canonical_atom, &canonical_witness.target);
    source_holds = source_slack >= 0;
    target_holds = target_slack >= 0;
    resolves = mask_feedback
                   ? 0
                   : witness_resolved(candidate, &canonical_witness);

    feature_add(features, UINT32_C(0x01000000) | (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x02000000) |
                    ((uint32_t)canonical_mask << 4) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x03000000) | ((packed & UINT32_C(0xffff)) << 4) |
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
                    ((uint32_t)(source_slack + 4) << 12) |
                    ((uint32_t)(target_slack + 4) << 8) |
                    ((uint32_t)(resolves != 0) << 7) |
                    (uint32_t)canonical_atom,
                1);
    feature_add(features,
                UINT32_C(0x08000000) |
                    ((uint32_t)popcount32(invariant_states(canonical_mask))
                     << 12) |
                    ((uint32_t)popcount32(invariant_states(candidate))
                     << 6) |
                    (uint32_t)canonical_atom,
                1);
}

static int64_t feature_score(const R3Model *model,
                             const R3FeatureVector *features)
{
    int64_t score = 0;
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor)
        score += (int64_t)model->weights[features->indices[cursor]] *
                 features->values[cursor];
    return score;
}

static int select_action(const R3Model *model, uint16_t mask,
                         const R3Witness *witness, int mask_feedback)
{
    int action, best = 0;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < R3_ATOM_COUNT; ++action) {
        R3FeatureVector features;
        int64_t score;
        extract_features(mask, witness, action, mask_feedback, &features);
        score = feature_score(model, &features);
        if (score > best_score ||
            (score == best_score &&
             canonical_action(mask, witness, action) <
                 canonical_action(mask, witness, best))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static void update_action(R3Model *model, uint16_t mask,
                          const R3Witness *witness, int action,
                          int mask_feedback, int direction)
{
    R3FeatureVector features;
    uint16_t cursor;
    extract_features(mask, witness, action, mask_feedback, &features);
    for (cursor = 0; cursor < features.count; ++cursor)
        model->weights[features.indices[cursor]] +=
            direction * features.values[cursor];
}

static int best_target(const R3Model *model, const R3Case *item,
                       int mask_feedback)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < R3_ATOM_COUNT; ++action) {
        R3FeatureVector features;
        int64_t score;
        if ((item->optimal_actions & (UINT16_C(1) << action)) == 0)
            continue;
        extract_features(item->invariant_mask, &item->witness, action,
                         mask_feedback, &features);
        score = feature_score(model, &features);
        if (score > best_score ||
            (score == best_score &&
             canonical_action(item->invariant_mask, &item->witness, action) <
                 canonical_action(item->invariant_mask, &item->witness,
                                  best))) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static uint32_t action_errors(const R3Model *model, const R3Corpus *corpus,
                              uint8_t maximum_stage, int mask_feedback)
{
    uint32_t errors = 0;
    uint16_t index;
    for (index = 0; index < corpus->case_count; ++index) {
        const R3Case *item = &corpus->cases[index];
        int action;
        if (item->stage > maximum_stage) continue;
        action = select_action(model, item->invariant_mask, &item->witness,
                               mask_feedback);
        if ((item->optimal_actions & (UINT16_C(1) << action)) == 0)
            ++errors;
    }
    return errors;
}

static R0Status train_stage(R3Model *model, const R3Corpus *corpus,
                            uint8_t stage, int mask_feedback,
                            uint32_t epoch_limit, int require_exact,
                            uint32_t *epochs, uint32_t *mistakes,
                            char *error, size_t error_capacity)
{
    uint32_t epoch;
    for (epoch = 0; epoch < epoch_limit; ++epoch) {
        uint32_t epoch_mistakes = 0;
        uint16_t index;
        for (index = 0; index < corpus->case_count; ++index) {
            const R3Case *item = &corpus->cases[index];
            int predicted, target;
            if (item->stage > stage) continue;
            predicted = select_action(model, item->invariant_mask,
                                      &item->witness, mask_feedback);
            if ((item->optimal_actions &
                 (UINT16_C(1) << predicted)) != 0)
                continue;
            target = best_target(model, item, mask_feedback);
            if (target < 0) return R0_POLICY_ERROR;
            update_action(model, item->invariant_mask, &item->witness,
                          target, mask_feedback, 1);
            update_action(model, item->invariant_mask, &item->witness,
                          predicted, mask_feedback, -1);
            ++epoch_mistakes;
        }
        ++*epochs;
        *mistakes += epoch_mistakes;
        if (epoch_mistakes == 0) return R0_OK;
    }
    if (require_exact) {
        set_error(error, error_capacity,
                  "stage %u did not separate within %u epochs",
                  (unsigned)stage, (unsigned)epoch_limit);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

void r3_model_init(R3Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

static R0Status evaluate_corpus(const R3Model *model,
                                const R3Corpus *corpus,
                                uint8_t minimum_stage,
                                uint8_t maximum_stage, int mask_feedback,
                                R3EvaluationReport *report)
{
    uint16_t index;
    memset(report, 0, sizeof(*report));
    report->minimum_stage = minimum_stage;
    report->maximum_stage = maximum_stage;
    report->feedback_masked = (uint8_t)(mask_feedback != 0);
    for (index = 0; index < corpus->case_count; ++index) {
        const R3Case *item = &corpus->cases[index];
        const R3Program *program;
        R3Verification verification;
        uint8_t visited[1U << R3_ATOM_COUNT];
        uint16_t mask;
        uint32_t edits;
        int solved = 0;
        if (item->stage < minimum_stage || item->stage > maximum_stage)
            continue;
        ++report->cases;
        program = &corpus->programs[item->program_index];
        mask = item->invariant_mask;
        verification.accepted = 0;
        verification.witness = item->witness;
        memset(visited, 0, sizeof(visited));
        visited[mask] = 1;
        for (edits = 0; edits < R3_MAX_REPAIR_STEPS; ++edits) {
            int action = select_action(model, mask, &verification.witness,
                                       mask_feedback);
            mask ^= (uint16_t)(UINT16_C(1) << action);
            ++report->verifier_calls;
            if (visited[mask]) ++report->repeated_states;
            visited[mask] = 1;
            (void)verify_program(program, mask, &verification);
            if (verification.accepted) {
                solved = 1;
                ++edits;
                break;
            }
        }
        if (solved) {
            ++report->solved;
            if (edits == item->distance)
                ++report->optimal;
            else if (edits > item->distance)
                report->excess_edits += edits - item->distance;
        } else {
            ++report->failed;
        }
    }
    if (report->cases != 0) {
        report->success_milli = report->solved * 1000U / report->cases;
        report->optimal_milli = report->optimal * 1000U / report->cases;
    }
    report->exact = (uint8_t)(report->cases != 0 &&
                              report->optimal == report->cases &&
                              report->repeated_states == 0);
    return R0_OK;
}

static void causal_report(const R3Model *stage3_model,
                          const R3Corpus *training_corpus,
                          const R3Corpus *holdout_corpus,
                          R3TrainingReport *report)
{
    R3Model blind;
    R3EvaluationReport holdout;
    uint32_t blind_epochs = 0, blind_mistakes = 0;
    uint32_t action_counts[R3_ATOM_COUNT] = {0};
    uint32_t blind_correct = 0;
    uint16_t first, second;
    r3_model_init(&blind);
    (void)train_stage(&blind, training_corpus, 3, 1, 64, 0, &blind_epochs,
                      &blind_mistakes, NULL, 0);
    (void)evaluate_corpus(stage3_model, holdout_corpus, 4, 4, 0, &holdout);
    report->holdout_cases = holdout.cases;
    report->holdout_solved = holdout.solved;
    report->holdout_optimal = holdout.optimal;
    report->holdout_success_milli = holdout.success_milli;
    report->holdout_optimal_milli = holdout.optimal_milli;
    report->holdout_repeated_states = holdout.repeated_states;
    report->holdout_exact = holdout.exact;
    report->irrelevant_swap_exact = 1;
    report->permutation_exact = 1;
    report->interchange_exact = 1;
    for (first = 0; first < holdout_corpus->case_count; ++first) {
        const R3Case *item = &holdout_corpus->cases[first];
        int action, swapped_action, atom;
        R3Witness changed, swapped;
        if (item->stage != 4) continue;
        action = select_action(stage3_model, item->invariant_mask,
                               &item->witness, 0);
        changed = item->witness;
        changed.nonce ^= UINT16_C(0xa55a);
        if (select_action(stage3_model, item->invariant_mask, &changed, 0) !=
            action)
            report->irrelevant_swap_exact = 0;
        swapped = swap_witness(item->witness);
        swapped_action = select_action(stage3_model,
                                       swap_mask(item->invariant_mask),
                                       &swapped, 0);
        if (swapped_action != swap_atom(action))
            report->permutation_exact = 0;
        if (item->invariant_mask != 0) continue;
        ++report->ambiguity_cases;
        for (atom = 0; atom < R3_ATOM_COUNT; ++atom)
            if ((item->optimal_actions & (UINT16_C(1) << atom)) != 0)
                ++action_counts[atom];
        action = select_action(&blind, item->invariant_mask,
                               &item->witness, 1);
        if ((item->optimal_actions & (UINT16_C(1) << action)) != 0)
            ++blind_correct;
    }
    if (report->ambiguity_cases != 0) {
        uint32_t best = 0;
        int atom;
        for (atom = 0; atom < R3_ATOM_COUNT; ++atom)
            if (action_counts[atom] > best) best = action_counts[atom];
        report->blind_ceiling_milli =
            best * 1000U / report->ambiguity_cases;
        report->blind_holdout_action_milli =
            blind_correct * 1000U / report->ambiguity_cases;
    }
    for (first = 0; first < holdout_corpus->case_count; ++first) {
        const R3Case *left = &holdout_corpus->cases[first];
        if (left->stage != 4 || left->invariant_mask != 0) continue;
        for (second = first + 1; second < holdout_corpus->case_count;
             ++second) {
            const R3Case *right = &holdout_corpus->cases[second];
            int left_action, right_action;
            if (right->stage != 4 || right->invariant_mask != 0 ||
                (left->optimal_actions & right->optimal_actions) != 0)
                continue;
            ++report->interchange_pairs;
            left_action = select_action(stage3_model, 0, &left->witness, 0);
            right_action = select_action(stage3_model, 0, &right->witness, 0);
            if ((left->optimal_actions &
                 (UINT16_C(1) << left_action)) == 0 ||
                (right->optimal_actions &
                 (UINT16_C(1) << right_action)) == 0 ||
                left_action == right_action)
                report->interchange_exact = 0;
        }
    }
    if (report->interchange_pairs == 0) report->interchange_exact = 0;
    report->causal_gate_passed =
        (uint8_t)(report->holdout_exact &&
                  report->blind_ceiling_milli <= 500 &&
                  report->blind_holdout_action_milli <=
                      report->blind_ceiling_milli &&
                  report->interchange_exact &&
                  report->irrelevant_swap_exact &&
                  report->permutation_exact);
}

R0Status r3_train(R3Model *model, uint8_t maximum_stage,
                  R3TrainingReport *report, char *error,
                  size_t error_capacity)
{
    R3Corpus corpus;
    R3Corpus stage_corpus;
    R0Status status;
    uint8_t stage;
    uint32_t epochs = 0, mistakes = 0;
    if (model == NULL || report == NULL || maximum_stage < 1 ||
        maximum_stage > R3_MAX_STAGE)
        return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    r3_model_init(model);
    status = build_corpus(maximum_stage, &corpus, error, error_capacity);
    if (status != R0_OK) return status;
    report->programs = corpus.program_count;
    report->cases = corpus.case_count;
    report->positive_cases = corpus.positive_cases;
    report->negative_cases = corpus.negative_cases;
    report->implication_cases = corpus.implication_cases;
    for (stage = 1; stage <= maximum_stage; ++stage) {
        status = build_corpus(stage, &stage_corpus, error, error_capacity);
        if (status != R0_OK) return status;
        status = train_stage(model, &stage_corpus, stage, 0,
                             R3_MAX_STAGE_EPOCHS, 1, &epochs, &mistakes,
                             error, error_capacity);
        if (status != R0_OK) return status;
        ++report->curriculum_promotions;
        model->trained_stage = stage;
        if (stage == 3 && maximum_stage >= 4)
            causal_report(model, &stage_corpus, &corpus, report);
    }
    report->epochs = epochs;
    report->mistakes = mistakes;
    report->final_action_errors =
        action_errors(model, &corpus, maximum_stage, 0);
    report->trained_stage = maximum_stage;
    model->trained_epochs = epochs;
    model->training_mistakes = mistakes;
    if (report->final_action_errors != 0) {
        set_error(error, error_capacity,
                  "trained ICE policy retains %u action errors",
                  report->final_action_errors);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r3_evaluate(const R3Model *model, uint8_t minimum_stage,
                     uint8_t maximum_stage, int mask_feedback,
                     R3EvaluationReport *report, char *error,
                     size_t error_capacity)
{
    R3Corpus corpus;
    R0Status status;
    if (model == NULL || report == NULL || minimum_stage < 1 ||
        maximum_stage < minimum_stage || maximum_stage > R3_MAX_STAGE ||
        model->trained_stage < maximum_stage)
        return R0_INVALID_ARGUMENT;
    status = build_corpus(maximum_stage, &corpus, error, error_capacity);
    if (status != R0_OK) return status;
    return evaluate_corpus(model, &corpus, minimum_stage, maximum_stage,
                           mask_feedback, report);
}

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t feature_count;
    uint8_t trained_stage;
    uint8_t reserved[3];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
} R3ModelHeader;

R0Status r3_model_save(const R3Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const char magic[8] = {'R', '3', 'I', 'C', 'E', 'P', '1', '\0'};
    R3ModelHeader header;
    R3EvaluationReport evaluation;
    FILE *file;
    R0Status status;
    if (model == NULL || path == NULL || model->trained_stage < 1 ||
        model->trained_stage > R3_MAX_STAGE)
        return R0_INVALID_ARGUMENT;
    status = r3_evaluate(model, 1, model->trained_stage, 0, &evaluation,
                         error, error_capacity);
    if (status != R0_OK) return status;
    if (!evaluation.exact) {
        set_error(error, error_capacity,
                  "refusing to save a policy that is not exact");
        return R0_POLICY_ERROR;
    }
    memset(&header, 0, sizeof(header));
    memcpy(header.magic, magic, sizeof(magic));
    header.version = R3_MODEL_VERSION;
    header.feature_count = R3_FEATURE_COUNT;
    header.trained_stage = model->trained_stage;
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

R0Status r3_model_load(R3Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const char magic[8] = {'R', '3', 'I', 'C', 'E', 'P', '1', '\0'};
    R3ModelHeader header;
    R3EvaluationReport evaluation;
    FILE *file;
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
        header.version != R3_MODEL_VERSION ||
        header.feature_count != R3_FEATURE_COUNT ||
        header.trained_stage < 1 ||
        header.trained_stage > R3_MAX_STAGE ||
        fread(model->weights, sizeof(model->weights), 1, file) != 1 ||
        fgetc(file) != EOF) {
        (void)fclose(file);
        set_error(error, error_capacity, "invalid Reasoner-3 model %s", path);
        return R0_IO_ERROR;
    }
    if (fclose(file) != 0) return R0_IO_ERROR;
    model->trained_stage = header.trained_stage;
    model->trained_epochs = header.trained_epochs;
    model->training_mistakes = header.training_mistakes;
    status = r3_evaluate(model, 1, model->trained_stage, 0, &evaluation,
                         error, error_capacity);
    if (status != R0_OK || !evaluation.exact) {
        set_error(error, error_capacity,
                  "Reasoner-3 model fails exact replay");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r3_solve(const R3Model *model, uint16_t program_index,
                  R3Invariant *invariant, uint32_t *verifier_calls,
                  char *error, size_t error_capacity)
{
    R3Verification verification;
    uint16_t mask = 0;
    uint32_t calls = 0, step;
    if (model == NULL || invariant == NULL || !build_programs() ||
        program_index >= R3_PROGRAM_COUNT ||
        model->trained_stage < R3_PROGRAMS[program_index].stage)
        return R0_INVALID_ARGUMENT;
    (void)verify_program(&R3_PROGRAMS[program_index], mask, &verification);
    for (step = 0; step < R3_MAX_REPAIR_STEPS && !verification.accepted;
         ++step) {
        int action = select_action(model, mask, &verification.witness, 0);
        mask ^= (uint16_t)(UINT16_C(1) << action);
        ++calls;
        (void)verify_program(&R3_PROGRAMS[program_index], mask, &verification);
    }
    if (!verification.accepted) {
        set_error(error, error_capacity,
                  "policy did not synthesize an invariant in %u edits",
                  R3_MAX_REPAIR_STEPS);
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
    hash ^= UINT64_C(0x524541534f4e4552);
    return hash;
}

R0Status r3_answer_seal(uint16_t program_index,
                        const R3Invariant *invariant, R3AnswerIR *answer,
                        char *error, size_t error_capacity)
{
    R3Verification verification;
    R0Status status;
    if (invariant == NULL || answer == NULL) return R0_INVALID_ARGUMENT;
    status = r3_verify(program_index, invariant, &verification, error,
                       error_capacity);
    if (status != R0_OK) return status;
    if (!verification.accepted) {
        set_error(error, error_capacity,
                  "only a verifier-accepted invariant can be sealed");
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

R0Status r3_language_render(const R3AnswerIR *answer, char *output,
                            size_t output_capacity, char *error,
                            size_t error_capacity)
{
    R3Invariant invariant;
    R3Verification verification;
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
    if (r3_verify(answer->program_index, &invariant, &verification, error,
                  error_capacity) != R0_OK ||
        !verification.accepted) {
        set_error(error, error_capacity,
                  "sealed answer no longer passes its verifier");
        return R0_SEAL_ERROR;
    }
    if (!append_text(output, output_capacity, &length,
                     "The verified invariant is "))
        return R0_LIMIT_ERROR;
    for (atom = 0; atom < R3_ATOM_COUNT; ++atom) {
        const R3Atom *item;
        const char *variable;
        int sign;
        if ((answer->atom_mask & (UINT16_C(1) << atom)) == 0) continue;
        item = &R3_ATOMS[atom];
        variable = item->coefficients[0] != 0 ? "x" : "y";
        sign = item->coefficients[0] != 0 ? item->coefficients[0]
                                                : item->coefficients[1];
        if (!append_text(output, output_capacity, &length, "%s%s %s %d",
                         count == 0 ? "" : " and ", variable,
                         sign > 0 ? "<=" : ">=",
                         sign > 0 ? item->constant : -item->constant))
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
