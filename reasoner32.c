#include "reasoner32.h"

#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R32_ALL_ATOMS ((uint16_t)(R31_HYPOTHESIS_COUNT - 1U))
#define R32_ARTIFACT_VERSION 1U
#define R32_FNV_OFFSET UINT64_C(1469598103934665603)
#define R32_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    uint64_t behavior_digest;
    uint64_t trace_digest;
    uint32_t world_pairs;
    uint32_t accepted_pairs;
    uint32_t rejected_pairs;
    uint32_t trace_programs;
    uint32_t trace_steps;
    uint32_t invalid_actions;
    uint32_t invalid_traces;
} R32Audit;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static void digest_byte(uint64_t *digest, uint8_t value)
{
    *digest ^= value;
    *digest *= R32_FNV_PRIME;
}

static void digest_u16(uint64_t *digest, uint16_t value)
{
    digest_byte(digest, (uint8_t)(value & UINT16_C(0xff)));
    digest_byte(digest, (uint8_t)(value >> 8));
}

static void digest_u64(uint64_t *digest, uint64_t value)
{
    unsigned byte;
    for (byte = 0; byte < 8; ++byte)
        digest_byte(digest, (uint8_t)(value >> (byte * 8U)));
}

static void digest_witness(uint64_t *digest, const R31Witness *witness)
{
    int dimension;
    digest_byte(digest, witness->kind);
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        digest_byte(digest,
                    (uint8_t)(witness->source.values[dimension] -
                              R31_DOMAIN_MIN));
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        digest_byte(digest,
                    (uint8_t)(witness->target.values[dimension] -
                              R31_DOMAIN_MIN));
    digest_u16(digest, witness->nonce);
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

static int64_t sparse_score(const R32Model *model,
                            const R31ActionFeatures *features)
{
    int64_t score = 0;
    uint16_t cursor;
    for (cursor = 0; cursor < features->count; ++cursor)
        score += (int64_t)sparse_weight(model, features->indices[cursor]) *
                 features->values[cursor];
    return score;
}

void r32_model_init(R32Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

static int valid_sparse_shape(const R32Model *model)
{
    uint16_t weight;
    if (model == NULL || model->count == 0 ||
        model->count > R32_MAX_WEIGHTS)
        return 0;
    for (weight = 0; weight < model->count; ++weight)
        if (model->indices[weight] >= R31_FEATURE_COUNT ||
            model->values[weight] == 0 ||
            (weight > 0 &&
             model->indices[weight] <= model->indices[weight - 1]))
            return 0;
    return 1;
}

R0Status r32_select_action(const R32Model *model, uint16_t invariant_mask,
                           const R31Witness *witness, int *action)
{
    uint16_t admissible;
    int candidate, best = -1;
    int64_t best_score = INT64_MIN;
    if (model == NULL || witness == NULL || action == NULL ||
        (invariant_mask & ~R32_ALL_ATOMS) != 0 ||
        model->count == 0 || model->count > R32_MAX_WEIGHTS)
        return R0_INVALID_ARGUMENT;
    admissible = r31_progress_action_mask(invariant_mask, witness);
    for (candidate = 0; candidate < R31_ATOM_COUNT; ++candidate) {
        R31ActionFeatures features;
        int64_t score;
        if ((admissible & (UINT16_C(1) << candidate)) == 0) continue;
        if (r31_extract_action_features(invariant_mask, witness, candidate,
                                        R31_FEEDBACK_FULL,
                                        &features) != R0_OK)
            return R0_POLICY_ERROR;
        score = sparse_score(model, &features);
        if (score > best_score ||
            (score == best_score &&
             (best < 0 ||
              r31_canonical_action_index(invariant_mask, witness, candidate,
                                         R31_FEEDBACK_FULL) <
                  r31_canonical_action_index(invariant_mask, witness, best,
                                             R31_FEEDBACK_FULL)))) {
            best = candidate;
            best_score = score;
        }
    }
    *action = best;
    return R0_OK;
}

static void digest_world_item(uint64_t *digest, uint16_t program,
                              uint16_t mask,
                              const R31Verification *verification,
                              int action)
{
    digest_u16(digest, program);
    digest_u16(digest, mask);
    digest_byte(digest, verification->accepted);
    digest_witness(digest, &verification->witness);
    digest_byte(digest, (uint8_t)(action + 1));
}

static void digest_trace_item(uint64_t *digest, uint16_t program,
                              uint8_t step, uint16_t mask,
                              const R31Verification *verification,
                              int action)
{
    digest_u16(digest, program);
    digest_byte(digest, step);
    digest_u16(digest, mask);
    digest_byte(digest, verification->accepted);
    digest_witness(digest, &verification->witness);
    digest_byte(digest, (uint8_t)(action + 1));
}

static R0Status audit_sparse(const R32Model *model, R32Audit *audit,
                             char *error, size_t error_capacity)
{
    uint16_t program;
    memset(audit, 0, sizeof(*audit));
    if (!valid_sparse_shape(model)) return R0_INVALID_ARGUMENT;
    audit->behavior_digest = R32_FNV_OFFSET;
    audit->trace_digest = R32_FNV_OFFSET;
    if (r31_program_count() != R31_MAX_PROGRAMS) return R0_VERIFIER_ERROR;
    for (program = 0; program < r31_program_count(); ++program) {
        uint16_t mask;
        for (mask = 0; mask <= R32_ALL_ATOMS; ++mask) {
            R31Invariant invariant;
            R31Verification verification;
            int action = -1;
            invariant.atom_mask = mask;
            if (r31_verify(program, &invariant, &verification, error,
                           error_capacity) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (r32_select_action(model, mask, &verification.witness,
                                  &action) != R0_OK)
                return R0_POLICY_ERROR;
            ++audit->world_pairs;
            if (verification.accepted) {
                ++audit->accepted_pairs;
                if (action != -1) ++audit->invalid_actions;
            } else {
                uint16_t legal =
                    r31_progress_action_mask(mask, &verification.witness);
                ++audit->rejected_pairs;
                if ((legal == 0 && action != -1) ||
                    (legal != 0 &&
                     (action < 0 ||
                      (legal & (UINT16_C(1) << action)) == 0)))
                    ++audit->invalid_actions;
            }
            digest_world_item(&audit->behavior_digest, program, mask,
                              &verification, action);
        }
    }
    for (program = 0; program < r31_program_count(); ++program) {
        R31Invariant invariant;
        R31Verification verification;
        uint16_t mask = 0;
        uint8_t step;
        int accepted = 0;
        ++audit->trace_programs;
        for (step = 0; step <= R31_MAX_REPAIR_STEPS; ++step) {
            int action = -1;
            invariant.atom_mask = mask;
            if (r31_verify(program, &invariant, &verification, error,
                           error_capacity) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (!verification.accepted &&
                r32_select_action(model, mask, &verification.witness,
                                  &action) != R0_OK)
                return R0_POLICY_ERROR;
            digest_trace_item(&audit->trace_digest, program, step, mask,
                              &verification, action);
            if (verification.accepted) {
                R31AnswerIR answer;
                accepted = 1;
                if (r31_answer_seal(program, &invariant, &answer, error,
                                    error_capacity) != R0_OK) {
                    ++audit->invalid_traces;
                    break;
                }
                digest_u64(&audit->trace_digest, answer.checksum);
                break;
            }
            if (action < 0 || step == R31_MAX_REPAIR_STEPS) {
                ++audit->invalid_traces;
                break;
            }
            mask ^= (uint16_t)(UINT16_C(1) << action);
            ++audit->trace_steps;
        }
        if (!accepted) ++audit->invalid_traces;
    }
    return R0_OK;
}

R0Status r32_verify_equivalence(const R31Model *dense,
                                const R32Model *sparse,
                                R32CompressionReport *report, char *error,
                                size_t error_capacity)
{
    uint16_t program;
    if (dense == NULL || !valid_sparse_shape(sparse) || report == NULL ||
        !dense->sealed_test_passed ||
        dense->evaluated_stage != R31_TEST_STAGE)
        return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    report->dense_behavior_digest = R32_FNV_OFFSET;
    report->sparse_behavior_digest = R32_FNV_OFFSET;
    report->dense_trace_digest = R32_FNV_OFFSET;
    report->sparse_trace_digest = R32_FNV_OFFSET;
    for (program = 0; program < r31_program_count(); ++program) {
        uint16_t mask;
        for (mask = 0; mask <= R32_ALL_ATOMS; ++mask) {
            R31Invariant invariant;
            R31Verification verification;
            int dense_action = -1, sparse_action = -1;
            invariant.atom_mask = mask;
            if (r31_verify(program, &invariant, &verification, error,
                           error_capacity) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (r31_model_select_action(dense, mask, &verification.witness,
                                        R31_FEEDBACK_FULL,
                                        &dense_action) != R0_OK ||
                r32_select_action(sparse, mask, &verification.witness,
                                  &sparse_action) != R0_OK)
                return R0_POLICY_ERROR;
            ++report->world_pairs;
            if (verification.accepted)
                ++report->accepted_pairs;
            else {
                ++report->rejected_pairs;
                if (r31_progress_action_mask(mask,
                                             &verification.witness) != 0)
                    ++report->actionable_pairs;
                else
                    ++report->actionless_pairs;
            }
            if (dense_action != sparse_action)
                ++report->action_mismatches;
            digest_world_item(&report->dense_behavior_digest, program, mask,
                              &verification, dense_action);
            digest_world_item(&report->sparse_behavior_digest, program, mask,
                              &verification, sparse_action);
        }
    }
    for (program = 0; program < r31_program_count(); ++program) {
        uint16_t dense_mask = 0, sparse_mask = 0;
        uint8_t step;
        int dense_accepted = 0, sparse_accepted = 0;
        ++report->trace_programs;
        for (step = 0; step <= R31_MAX_REPAIR_STEPS; ++step) {
            R31Invariant dense_invariant, sparse_invariant;
            R31Verification dense_verification, sparse_verification;
            int dense_action = -1, sparse_action = -1;
            dense_invariant.atom_mask = dense_mask;
            sparse_invariant.atom_mask = sparse_mask;
            if (r31_verify(program, &dense_invariant, &dense_verification,
                           error, error_capacity) != R0_OK ||
                r31_verify(program, &sparse_invariant, &sparse_verification,
                           error, error_capacity) != R0_OK)
                return R0_VERIFIER_ERROR;
            if (!dense_verification.accepted &&
                r31_model_select_action(dense, dense_mask,
                                        &dense_verification.witness,
                                        R31_FEEDBACK_FULL,
                                        &dense_action) != R0_OK)
                return R0_POLICY_ERROR;
            if (!sparse_verification.accepted &&
                r32_select_action(sparse, sparse_mask,
                                  &sparse_verification.witness,
                                  &sparse_action) != R0_OK)
                return R0_POLICY_ERROR;
            digest_trace_item(&report->dense_trace_digest, program, step,
                              dense_mask, &dense_verification, dense_action);
            digest_trace_item(&report->sparse_trace_digest, program, step,
                              sparse_mask, &sparse_verification,
                              sparse_action);
            if (dense_mask != sparse_mask ||
                memcmp(&dense_verification, &sparse_verification,
                       sizeof(dense_verification)) != 0 ||
                dense_action != sparse_action)
                ++report->trace_mismatches;
            if (dense_verification.accepted ||
                sparse_verification.accepted) {
                R31AnswerIR dense_answer, sparse_answer;
                if (dense_verification.accepted) {
                    dense_accepted = 1;
                    if (r31_answer_seal(program, &dense_invariant,
                                        &dense_answer, error,
                                        error_capacity) != R0_OK)
                        return R0_SEAL_ERROR;
                    digest_u64(&report->dense_trace_digest,
                               dense_answer.checksum);
                }
                if (sparse_verification.accepted) {
                    sparse_accepted = 1;
                    if (r31_answer_seal(program, &sparse_invariant,
                                        &sparse_answer, error,
                                        error_capacity) != R0_OK)
                        return R0_SEAL_ERROR;
                    digest_u64(&report->sparse_trace_digest,
                               sparse_answer.checksum);
                }
                if (!dense_accepted || !sparse_accepted ||
                    memcmp(&dense_answer, &sparse_answer,
                           sizeof(dense_answer)) != 0)
                    ++report->seal_mismatches;
                break;
            }
            if (dense_action < 0 || sparse_action < 0 ||
                step == R31_MAX_REPAIR_STEPS) {
                ++report->trace_mismatches;
                break;
            }
            dense_mask ^= (uint16_t)(UINT16_C(1) << dense_action);
            sparse_mask ^= (uint16_t)(UINT16_C(1) << sparse_action);
            ++report->trace_steps;
        }
        if (!dense_accepted || !sparse_accepted)
            ++report->trace_mismatches;
    }
    report->exact =
        (uint8_t)(report->world_pairs ==
                      (uint32_t)R31_MAX_PROGRAMS * R31_HYPOTHESIS_COUNT &&
                  report->action_mismatches == 0 &&
                  report->trace_programs == R31_MAX_PROGRAMS &&
                  report->trace_mismatches == 0 &&
                  report->seal_mismatches == 0 &&
                  report->dense_behavior_digest ==
                      report->sparse_behavior_digest &&
                  report->dense_trace_digest == report->sparse_trace_digest);
    if (!report->exact)
        set_error(error, error_capacity,
                  "sparse policy does not exactly match dense policy");
    return R0_OK;
}

static size_t varint_size(uint32_t value)
{
    size_t size = 1;
    while (value >= UINT32_C(0x80)) {
        value >>= 7;
        ++size;
    }
    return size;
}

typedef struct {
    uint16_t mask;
    R31Witness witness;
} R32CanonicalContext;

typedef struct {
    int16_t scores[R31_ATOM_COUNT];
    uint16_t admissible;
    int8_t selected;
} R32PruneContext;

typedef struct {
    uint32_t context;
    uint8_t action;
    int16_t feature_value;
} R32Occurrence;

typedef struct {
    uint16_t position;
    uint8_t magnitude;
    uint32_t index;
} R32PruneOrder;

static int compare_canonical_context(const void *left_pointer,
                                     const void *right_pointer)
{
    const R32CanonicalContext *left = left_pointer;
    const R32CanonicalContext *right = right_pointer;
    int dimension;
    if (left->mask != right->mask)
        return left->mask < right->mask ? -1 : 1;
    if (left->witness.kind != right->witness.kind)
        return left->witness.kind < right->witness.kind ? -1 : 1;
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        if (left->witness.source.values[dimension] !=
            right->witness.source.values[dimension])
            return left->witness.source.values[dimension] <
                           right->witness.source.values[dimension]
                       ? -1
                       : 1;
    for (dimension = 0; dimension < R31_DIMENSIONS; ++dimension)
        if (left->witness.target.values[dimension] !=
            right->witness.target.values[dimension])
            return left->witness.target.values[dimension] <
                           right->witness.target.values[dimension]
                       ? -1
                       : 1;
    if (left->witness.nonce != right->witness.nonce)
        return left->witness.nonce < right->witness.nonce ? -1 : 1;
    return 0;
}

static int compare_prune_order(const void *left_pointer,
                               const void *right_pointer)
{
    const R32PruneOrder *left = left_pointer;
    const R32PruneOrder *right = right_pointer;
    if (left->magnitude != right->magnitude)
        return left->magnitude < right->magnitude ? -1 : 1;
    if (left->index != right->index)
        return left->index < right->index ? -1 : 1;
    return 0;
}

static int sparse_position(const R32Model *model, uint32_t index)
{
    unsigned low = 0, high = model->count;
    while (low < high) {
        unsigned middle = low + (high - low) / 2U;
        if (model->indices[middle] < index)
            low = middle + 1U;
        else
            high = middle;
    }
    return low < model->count && model->indices[low] == index
               ? (int)low
               : -1;
}

static int selected_from_scores(const R32PruneContext *context,
                                int removed_position,
                                int removed_weight,
                                const int16_t removed_values[R31_ATOM_COUNT])
{
    int action, selected = -1;
    int32_t best_score = INT32_MIN;
    for (action = 0; action < R31_ATOM_COUNT; ++action) {
        int32_t score;
        if ((context->admissible & (UINT16_C(1) << action)) == 0)
            continue;
        score = context->scores[action];
        if (removed_position >= 0)
            score -= removed_weight * removed_values[action];
        if (score > best_score ||
            (score == best_score && (selected < 0 || action < selected))) {
            best_score = score;
            selected = action;
        }
    }
    return selected;
}

static R0Status collect_canonical_contexts(
    R32CanonicalContext **output, uint32_t *output_count, char *error,
    size_t error_capacity)
{
    const size_t capacity =
        (size_t)R31_MAX_PROGRAMS * R31_HYPOTHESIS_COUNT;
    R32CanonicalContext *contexts = malloc(capacity * sizeof(*contexts));
    size_t count = 0, read_cursor, write_cursor;
    uint16_t program;
    if (contexts == NULL) {
        set_error(error, error_capacity,
                  "cannot allocate the exact compression census");
        return R0_LIMIT_ERROR;
    }
    for (program = 0; program < r31_program_count(); ++program) {
        uint16_t mask;
        for (mask = 0; mask < R31_HYPOTHESIS_COUNT; ++mask) {
            R31Invariant invariant;
            R31Verification verification;
            invariant.atom_mask = mask;
            if (r31_verify(program, &invariant, &verification, error,
                           error_capacity) != R0_OK) {
                free(contexts);
                return R0_VERIFIER_ERROR;
            }
            if (verification.accepted) continue;
            if (r31_canonicalize_context(
                    mask, &verification.witness, R31_FEEDBACK_FULL,
                    &contexts[count].mask,
                    &contexts[count].witness) != R0_OK) {
                free(contexts);
                return R0_POLICY_ERROR;
            }
            ++count;
        }
    }
    qsort(contexts, count, sizeof(*contexts), compare_canonical_context);
    write_cursor = 0;
    for (read_cursor = 0; read_cursor < count; ++read_cursor)
        if (read_cursor == 0 ||
            compare_canonical_context(&contexts[read_cursor - 1],
                                      &contexts[read_cursor]) != 0)
            contexts[write_cursor++] = contexts[read_cursor];
    *output = contexts;
    *output_count = (uint32_t)write_cursor;
    return R0_OK;
}

static R0Status prune_behaviorally(R32Model *model, uint32_t *pruned,
                                   uint32_t *canonical_context_count,
                                   char *error, size_t error_capacity)
{
    R32CanonicalContext *canonical = NULL;
    R32PruneContext *contexts = NULL;
    R32Occurrence *occurrences = NULL;
    R32PruneOrder order[R32_MAX_WEIGHTS];
    uint32_t counts[R32_MAX_WEIGHTS] = {0};
    uint32_t offsets[R32_MAX_WEIGHTS + 1] = {0};
    uint32_t cursors[R32_MAX_WEIGHTS] = {0};
    uint8_t keep[R32_MAX_WEIGHTS];
    uint32_t context_count = 0, context_index, occurrence_count = 0;
    uint16_t weight;
    R0Status status;
    if (!valid_sparse_shape(model) || pruned == NULL ||
        canonical_context_count == NULL)
        return R0_INVALID_ARGUMENT;
    status = collect_canonical_contexts(
        &canonical, &context_count, error, error_capacity);
    if (status != R0_OK) return status;
    if (context_count == 0) {
        free(canonical);
        set_error(error, error_capacity,
                  "the exact compression census is empty");
        return R0_VERIFIER_ERROR;
    }
    *canonical_context_count = context_count;
    contexts = calloc(context_count, sizeof(*contexts));
    if (contexts == NULL) {
        free(canonical);
        set_error(error, error_capacity,
                  "cannot allocate sparse pruning contexts");
        return R0_LIMIT_ERROR;
    }
    for (context_index = 0; context_index < context_count;
         ++context_index) {
        int action;
        contexts[context_index].admissible = r31_progress_action_mask(
            canonical[context_index].mask,
            &canonical[context_index].witness);
        for (action = 0; action < R31_ATOM_COUNT; ++action) {
            R31ActionFeatures features;
            uint16_t feature;
            if ((contexts[context_index].admissible &
                 (UINT16_C(1) << action)) == 0)
                continue;
            if (r31_extract_action_features(
                    canonical[context_index].mask,
                    &canonical[context_index].witness, action,
                    R31_FEEDBACK_FULL, &features) != R0_OK) {
                status = R0_POLICY_ERROR;
                goto cleanup;
            }
            contexts[context_index].scores[action] =
                (int16_t)sparse_score(model, &features);
            for (feature = 0; feature < features.count; ++feature) {
                int position = sparse_position(
                    model, features.indices[feature]);
                if (position >= 0) ++counts[position];
            }
        }
        contexts[context_index].selected = (int8_t)selected_from_scores(
            &contexts[context_index], -1, 0, NULL);
    }
    for (weight = 0; weight < model->count; ++weight) {
        offsets[weight] = occurrence_count;
        occurrence_count += counts[weight];
        cursors[weight] = offsets[weight];
    }
    offsets[model->count] = occurrence_count;
    occurrences = calloc((size_t)(occurrence_count == 0 ? 1
                                                         : occurrence_count),
                         sizeof(*occurrences));
    if (occurrences == NULL) {
        status = R0_LIMIT_ERROR;
        set_error(error, error_capacity,
                  "cannot allocate sparse feature occurrences");
        goto cleanup;
    }
    for (context_index = 0; context_index < context_count;
         ++context_index) {
        int action;
        for (action = 0; action < R31_ATOM_COUNT; ++action) {
            R31ActionFeatures features;
            uint16_t feature;
            if ((contexts[context_index].admissible &
                 (UINT16_C(1) << action)) == 0)
                continue;
            if (r31_extract_action_features(
                    canonical[context_index].mask,
                    &canonical[context_index].witness, action,
                    R31_FEEDBACK_FULL, &features) != R0_OK) {
                status = R0_POLICY_ERROR;
                goto cleanup;
            }
            for (feature = 0; feature < features.count; ++feature) {
                int position = sparse_position(
                    model, features.indices[feature]);
                R32Occurrence *occurrence;
                if (position < 0) continue;
                occurrence = &occurrences[cursors[position]++];
                occurrence->context = context_index;
                occurrence->action = (uint8_t)action;
                occurrence->feature_value = features.values[feature];
            }
        }
    }
    for (weight = 0; weight < model->count; ++weight)
        if (cursors[weight] != offsets[weight + 1]) {
            status = R0_POLICY_ERROR;
            set_error(error, error_capacity,
                      "sparse occurrence census changed during pruning");
            goto cleanup;
        }
    for (weight = 0; weight < model->count; ++weight) {
        int value = model->values[weight];
        order[weight].position = weight;
        order[weight].magnitude =
            (uint8_t)(value < 0 ? -value : value);
        order[weight].index = model->indices[weight];
        keep[weight] = 1;
    }
    qsort(order, model->count, sizeof(*order), compare_prune_order);
    *pruned = 0;
    for (weight = 0; weight < model->count; ++weight) {
        uint16_t position = order[weight].position;
        uint32_t occurrence = offsets[position];
        int removable = 1;
        while (occurrence < offsets[position + 1]) {
            int16_t removed_values[R31_ATOM_COUNT] = {0};
            uint32_t current_context =
                occurrences[occurrence].context;
            while (occurrence < offsets[position + 1] &&
                   occurrences[occurrence].context == current_context) {
                removed_values[occurrences[occurrence].action] +=
                    occurrences[occurrence].feature_value;
                ++occurrence;
            }
            if (selected_from_scores(
                    &contexts[current_context], position,
                    model->values[position], removed_values) !=
                contexts[current_context].selected) {
                removable = 0;
                break;
            }
        }
        if (removable) {
            for (occurrence = offsets[position];
                 occurrence < offsets[position + 1]; ++occurrence) {
                R32Occurrence *item = &occurrences[occurrence];
                contexts[item->context].scores[item->action] -=
                    model->values[position] * item->feature_value;
            }
            keep[position] = 0;
            ++*pruned;
        }
    }
    {
        uint16_t write_cursor = 0, original_count = model->count;
        for (weight = 0; weight < original_count; ++weight)
            if (keep[weight]) {
                model->indices[write_cursor] = model->indices[weight];
                model->values[write_cursor] = model->values[weight];
                ++write_cursor;
            }
        for (weight = write_cursor; weight < original_count; ++weight) {
            model->indices[weight] = 0;
            model->values[weight] = 0;
        }
        model->count = write_cursor;
    }
    status = R0_OK;
cleanup:
    free(occurrences);
    free(contexts);
    free(canonical);
    return status;
}

size_t r32_serialized_size(const R32Model *model)
{
    size_t size = R32_ARTIFACT_HEADER_BYTES;
    uint32_t previous = 0;
    uint16_t cursor;
    if (!valid_sparse_shape(model)) return 0;
    for (cursor = 0; cursor < model->count; ++cursor) {
        uint32_t delta = cursor == 0 ? model->indices[cursor]
                                     : model->indices[cursor] - previous;
        size += varint_size(delta) + 1U;
        previous = model->indices[cursor];
    }
    return size;
}

R0Status r32_compress(const R31Model *dense, R32Model *sparse,
                      R32CompressionReport *report, char *error,
                      size_t error_capacity)
{
    uint8_t seen_values[256] = {0};
    uint32_t source_nonzero, pruned = 0, canonical_contexts = 0;
    uint32_t index;
    R0Status status;
    if (dense == NULL || sparse == NULL || report == NULL ||
        !dense->sealed_test_passed ||
        dense->evaluated_stage != R31_TEST_STAGE)
        return R0_INVALID_ARGUMENT;
    r32_model_init(sparse);
    for (index = 0; index < R31_FEATURE_COUNT; ++index) {
        int32_t weight = dense->weights[index];
        if (weight == 0) continue;
        if (sparse->count >= R32_MAX_WEIGHTS || weight < INT8_MIN ||
            weight > INT8_MAX) {
            set_error(error, error_capacity,
                      "dense policy does not fit the sparse contract");
            return R0_LIMIT_ERROR;
        }
        sparse->indices[sparse->count] = index;
        sparse->values[sparse->count] = (int8_t)weight;
        ++sparse->count;
    }
    source_nonzero = sparse->count;
    if (source_nonzero == 0) {
        set_error(error, error_capacity,
                  "dense policy has no nonzero weights to compress");
        return R0_POLICY_ERROR;
    }
    sparse->trained_stage = dense->trained_stage;
    sparse->evaluated_stage = dense->evaluated_stage;
    sparse->sealed_test_passed = dense->sealed_test_passed;
    status = prune_behaviorally(sparse, &pruned,
                                &canonical_contexts, error,
                                error_capacity);
    if (status != R0_OK) return status;
    status = r32_verify_equivalence(dense, sparse, report, error,
                                    error_capacity);
    if (status != R0_OK || !report->exact) return status;
    if (report->sparse_behavior_digest !=
            R32_REFERENCE_BEHAVIOR_DIGEST ||
        report->sparse_trace_digest != R32_REFERENCE_TRACE_DIGEST) {
        report->exact = 0;
        set_error(error, error_capacity,
                  "Reasoner (3,1) changed from the frozen reference");
        return R0_POLICY_ERROR;
    }
    sparse->behavior_digest = report->sparse_behavior_digest;
    sparse->trace_digest = report->sparse_trace_digest;
    report->dense_artifact_bytes = R32_DENSE_ARTIFACT_BYTES;
    report->sparse_artifact_bytes =
        (uint32_t)r32_serialized_size(sparse);
    report->runtime_weight_bytes =
        sparse->count * ((uint32_t)sizeof(uint32_t) + sizeof(int8_t));
    report->dense_weight_count = R31_FEATURE_COUNT;
    report->source_nonzero_weights = source_nonzero;
    report->retained_weights = sparse->count;
    report->pruned_weights = pruned;
    report->zero_weights = R31_FEATURE_COUNT - source_nonzero;
    report->canonical_contexts = canonical_contexts;
    for (index = 0; index < sparse->count; ++index) {
        int value = sparse->values[index];
        uint8_t key = (uint8_t)(value - INT8_MIN);
        if (!seen_values[key]) {
            seen_values[key] = 1;
            ++report->distinct_nonzero_values;
        }
        if (index == 0 || value < report->minimum_weight)
            report->minimum_weight = (int8_t)value;
        if (index == 0 || value > report->maximum_weight)
            report->maximum_weight = (int8_t)value;
    }
    report->compression_milli =
        (report->dense_artifact_bytes - report->sparse_artifact_bytes) *
        1000U / report->dense_artifact_bytes;
    if (report->sparse_artifact_bytes > R32_MAX_ARTIFACT_BYTES) {
        report->exact = 0;
        set_error(error, error_capacity,
                  "sparse artifact is %u bytes, above the %u-byte gate",
                  report->sparse_artifact_bytes,
                  R32_MAX_ARTIFACT_BYTES);
        return R0_LIMIT_ERROR;
    }
    return R0_OK;
}

R0Status r32_solve(const R32Model *model, uint16_t program_index,
                   R31Invariant *invariant, uint32_t *verifier_calls,
                   char *error, size_t error_capacity)
{
    R31Verification verification;
    uint16_t mask = 0;
    uint32_t calls = 0, step;
    if (!valid_sparse_shape(model) || invariant == NULL ||
        program_index >= r31_program_count() ||
        !model->sealed_test_passed ||
        model->evaluated_stage != R31_TEST_STAGE ||
        model->behavior_digest != R32_REFERENCE_BEHAVIOR_DIGEST ||
        model->trace_digest != R32_REFERENCE_TRACE_DIGEST)
        return R0_INVALID_ARGUMENT;
    for (step = 0; step <= R31_MAX_REPAIR_STEPS; ++step) {
        int action;
        invariant->atom_mask = mask;
        if (r31_verify(program_index, invariant, &verification, error,
                       error_capacity) != R0_OK)
            return R0_VERIFIER_ERROR;
        if (verification.accepted) {
            if (verifier_calls != NULL) *verifier_calls = calls;
            return R0_OK;
        }
        if (step == R31_MAX_REPAIR_STEPS ||
            r32_select_action(model, mask, &verification.witness,
                              &action) != R0_OK ||
            action < 0)
            break;
        mask ^= (uint16_t)(UINT16_C(1) << action);
        ++calls;
    }
    set_error(error, error_capacity,
              "sparse policy did not synthesize an invariant");
    return R0_POLICY_ERROR;
}

static void write_u16(uint8_t *output, uint16_t value)
{
    output[0] = (uint8_t)value;
    output[1] = (uint8_t)(value >> 8);
}

static void write_u64(uint8_t *output, uint64_t value)
{
    unsigned byte;
    for (byte = 0; byte < 8; ++byte)
        output[byte] = (uint8_t)(value >> (byte * 8U));
}

static uint16_t read_u16(const uint8_t *input)
{
    return (uint16_t)(input[0] | ((uint16_t)input[1] << 8));
}

static uint64_t read_u64(const uint8_t *input)
{
    uint64_t value = 0;
    unsigned byte;
    for (byte = 0; byte < 8; ++byte)
        value |= (uint64_t)input[byte] << (byte * 8U);
    return value;
}

static size_t write_varint(uint8_t *output, uint32_t value)
{
    size_t size = 0;
    do {
        uint8_t byte = (uint8_t)(value & UINT32_C(0x7f));
        value >>= 7;
        if (value != 0) byte |= UINT8_C(0x80);
        output[size++] = byte;
    } while (value != 0);
    return size;
}

static int read_varint(const uint8_t *input, size_t capacity,
                       uint32_t *value, size_t *used)
{
    uint32_t result = 0;
    unsigned shift = 0;
    size_t cursor;
    for (cursor = 0; cursor < capacity && cursor < 5; ++cursor) {
        uint8_t byte = input[cursor];
        if (cursor == 4 && (byte & UINT8_C(0xf0)) != 0) return 0;
        result |= (uint32_t)(byte & UINT8_C(0x7f)) << shift;
        if ((byte & UINT8_C(0x80)) == 0) {
            *value = result;
            *used = cursor + 1U;
            return varint_size(result) == *used;
        }
        shift += 7;
    }
    return 0;
}

static uint64_t artifact_checksum(const uint8_t *bytes, size_t payload_size)
{
    uint64_t digest = R32_FNV_OFFSET;
    size_t index;
    for (index = 0; index < 28; ++index) digest_byte(&digest, bytes[index]);
    for (index = R32_ARTIFACT_HEADER_BYTES;
         index < R32_ARTIFACT_HEADER_BYTES + payload_size; ++index)
        digest_byte(&digest, bytes[index]);
    return digest;
}

R0Status r32_model_save(const R32Model *model, const char *path,
                        char *error, size_t error_capacity)
{
    uint8_t bytes[R32_MAX_ARTIFACT_BYTES];
    R32Audit audit;
    size_t size, cursor = R32_ARTIFACT_HEADER_BYTES;
    uint32_t previous = 0;
    uint16_t weight;
    FILE *file;
    R0Status status;
    if (path == NULL || !valid_sparse_shape(model) ||
        model->trained_stage != R31_DEVELOPMENT_STAGE ||
        model->evaluated_stage != R31_TEST_STAGE ||
        !model->sealed_test_passed ||
        model->behavior_digest != R32_REFERENCE_BEHAVIOR_DIGEST ||
        model->trace_digest != R32_REFERENCE_TRACE_DIGEST)
        return R0_INVALID_ARGUMENT;
    size = r32_serialized_size(model);
    if (size > sizeof(bytes)) return R0_LIMIT_ERROR;
    status = audit_sparse(model, &audit, error, error_capacity);
    if (status != R0_OK || audit.invalid_actions != 0 ||
        audit.invalid_traces != 0 ||
        audit.behavior_digest != model->behavior_digest ||
        audit.trace_digest != model->trace_digest) {
        set_error(error, error_capacity,
                  "refusing to save a sparse policy with a changed trace");
        return R0_POLICY_ERROR;
    }
    memset(bytes, 0, sizeof(bytes));
    memcpy(bytes, "R32V", 4);
    bytes[4] = R32_ARTIFACT_VERSION;
    bytes[5] = model->trained_stage;
    bytes[6] = model->evaluated_stage;
    bytes[7] = model->sealed_test_passed;
    write_u16(bytes + 8, model->count);
    write_u16(bytes + 10,
              (uint16_t)(size - R32_ARTIFACT_HEADER_BYTES));
    write_u64(bytes + 12, model->behavior_digest);
    write_u64(bytes + 20, model->trace_digest);
    for (weight = 0; weight < model->count; ++weight) {
        uint32_t delta = weight == 0 ? model->indices[weight]
                                     : model->indices[weight] - previous;
        cursor += write_varint(bytes + cursor, delta);
        bytes[cursor++] = (uint8_t)model->values[weight];
        previous = model->indices[weight];
    }
    if (cursor != size) return R0_POLICY_ERROR;
    write_u64(bytes + 28,
              artifact_checksum(bytes,
                                size - R32_ARTIFACT_HEADER_BYTES));
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fwrite(bytes, size, 1, file) != 1) {
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

R0Status r32_model_load(R32Model *model, const char *path,
                        char *error, size_t error_capacity)
{
    uint8_t bytes[R32_MAX_ARTIFACT_BYTES + 1];
    R32Audit audit;
    FILE *file;
    size_t size, payload_size, cursor;
    int read_failed, close_failed;
    uint32_t previous = 0;
    uint16_t weight;
    R0Status status;
    if (model == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    file = fopen(path, "rb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    size = fread(bytes, 1, sizeof(bytes), file);
    read_failed = ferror(file);
    close_failed = fclose(file) != 0;
    if (read_failed || close_failed || size < R32_ARTIFACT_HEADER_BYTES ||
        size > R32_MAX_ARTIFACT_BYTES || memcmp(bytes, "R32V", 4) != 0 ||
        bytes[4] != R32_ARTIFACT_VERSION) {
        set_error(error, error_capacity, "invalid Reasoner (3,2) artifact");
        return R0_IO_ERROR;
    }
    payload_size = read_u16(bytes + 10);
    if (size != R32_ARTIFACT_HEADER_BYTES + payload_size ||
        read_u64(bytes + 28) != artifact_checksum(bytes, payload_size)) {
        set_error(error, error_capacity,
                  "Reasoner (3,2) artifact checksum failed");
        return R0_IO_ERROR;
    }
    r32_model_init(model);
    model->trained_stage = bytes[5];
    model->evaluated_stage = bytes[6];
    model->sealed_test_passed = bytes[7];
    model->count = read_u16(bytes + 8);
    model->behavior_digest = read_u64(bytes + 12);
    model->trace_digest = read_u64(bytes + 20);
    if (model->trained_stage != R31_DEVELOPMENT_STAGE ||
        model->evaluated_stage != R31_TEST_STAGE ||
        model->sealed_test_passed != 1 || model->count == 0 ||
        model->count > R32_MAX_WEIGHTS ||
        model->behavior_digest != R32_REFERENCE_BEHAVIOR_DIGEST ||
        model->trace_digest != R32_REFERENCE_TRACE_DIGEST) {
        set_error(error, error_capacity,
                  "Reasoner (3,2) artifact metadata failed");
        return R0_IO_ERROR;
    }
    cursor = R32_ARTIFACT_HEADER_BYTES;
    for (weight = 0; weight < model->count; ++weight) {
        uint32_t delta, index;
        size_t used;
        if (!read_varint(bytes + cursor, size - cursor, &delta, &used))
            return R0_IO_ERROR;
        cursor += used;
        if (cursor >= size || (weight > 0 && delta == 0))
            return R0_IO_ERROR;
        index = weight == 0 ? delta : previous + delta;
        if (index >= R31_FEATURE_COUNT ||
            (weight > 0 && index <= previous) ||
            (int8_t)bytes[cursor] == 0) {
            set_error(error, error_capacity,
                      "Reasoner (3,2) sparse payload failed");
            return R0_IO_ERROR;
        }
        model->indices[weight] = index;
        model->values[weight] = (int8_t)bytes[cursor++];
        previous = index;
    }
    if (cursor != size) return R0_IO_ERROR;
    status = audit_sparse(model, &audit, error, error_capacity);
    if (status != R0_OK || audit.invalid_actions != 0 ||
        audit.invalid_traces != 0 ||
        audit.behavior_digest != model->behavior_digest ||
        audit.trace_digest != model->trace_digest) {
        set_error(error, error_capacity,
                  "Reasoner (3,2) exhaustive replay failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}
