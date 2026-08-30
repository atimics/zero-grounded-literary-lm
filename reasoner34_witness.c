#include "reasoner34_witness.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R34W_FNV_OFFSET UINT64_C(1469598103934665603)
#define R34W_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    uint8_t dimensions;
    uint16_t target;
    uint16_t mask;
    uint16_t optimal;
    R33Witness witness;
} R34WCase;

typedef struct {
    R34WCase *items;
    size_t count;
    size_t capacity;
} R34WCorpus;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
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

static int first_action(uint16_t actions)
{
    int action;
    for (action = 0; action < R33_MAX_ATOMS; ++action)
        if ((actions & (UINT16_C(1) << action)) != 0) return action;
    return -1;
}

static R0Status corpus_append(R34WCorpus *corpus, const R34WCase *item)
{
    if (corpus->count == corpus->capacity) {
        size_t capacity = corpus->capacity == 0 ? 4096 : corpus->capacity * 2;
        R34WCase *items;
        if (capacity > SIZE_MAX / sizeof(*items)) return R0_LIMIT_ERROR;
        items = realloc(corpus->items, capacity * sizeof(*items));
        if (items == NULL) return R0_LIMIT_ERROR;
        corpus->items = items;
        corpus->capacity = capacity;
    }
    corpus->items[corpus->count++] = *item;
    return R0_OK;
}

static R0Status build_corpus(uint8_t maximum_dimensions,
                             R34WCorpus *corpus)
{
    uint8_t dimensions;
    memset(corpus, 0, sizeof(*corpus));
    for (dimensions = 1; dimensions <= maximum_dimensions; ++dimensions) {
        uint32_t program;
        for (program = 0; program < r33_program_count(dimensions); ++program) {
            uint16_t target = r33_task_target(dimensions, program);
            uint16_t mask = 0;
            while (mask != target) {
                uint32_t state_index;
                for (state_index = 0;
                     state_index < r33_task_state_count(dimensions);
                     ++state_index) {
                    R34WCase item;
                    uint16_t legal;
                    R33State state =
                        r33_task_state(dimensions, state_index);
                    if (!r33_task_holds(dimensions, mask, &state) ||
                        r33_task_holds(dimensions, target, &state))
                        continue;
                    memset(&item, 0, sizeof(item));
                    item.dimensions = dimensions;
                    item.target = target;
                    item.mask = mask;
                    item.witness.kind = R31_WITNESS_NEGATIVE;
                    item.witness.source = state;
                    item.witness.target =
                        r33_task_nearest(dimensions, target, &state);
                    legal = r33_task_progress_actions(
                        dimensions, mask, &item.witness);
                    item.optimal = legal & (uint16_t)(target ^ mask);
                    if (item.optimal == 0) {
                        free(corpus->items);
                        memset(corpus, 0, sizeof(*corpus));
                        return R0_VERIFIER_ERROR;
                    }
                    {
                        R0Status status = corpus_append(corpus, &item);
                        if (status != R0_OK) {
                            free(corpus->items);
                            memset(corpus, 0, sizeof(*corpus));
                            return status;
                        }
                    }
                }
                {
                    int action = first_action((uint16_t)(target ^ mask));
                    if (action < 0) break;
                    mask |= (uint16_t)(UINT16_C(1) << action);
                }
            }
        }
    }
    return R0_OK;
}

static int64_t score(const R33Model *model,
                     const int16_t features[R33_FEATURE_COUNT])
{
    int64_t value = 0;
    int feature;
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        value += (int64_t)model->weights[feature] * features[feature];
    return value;
}

static int best_optimal(const R33Model *model, const R34WCase *item)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0;
         action < item->dimensions * R33_ATOMS_PER_DIMENSION; ++action) {
        int16_t features[R33_FEATURE_COUNT];
        int64_t action_score;
        if ((item->optimal & (UINT16_C(1) << action)) == 0) continue;
        r33_task_features(item->dimensions, item->mask, &item->witness,
                          action, R31_FEEDBACK_FULL, features);
        action_score = score(model, features);
        if (action_score > best_score ||
            (action_score == best_score && (best < 0 || action < best))) {
            best = action;
            best_score = action_score;
        }
    }
    return best;
}

static void update(R33Model *model, const R34WCase *item, int action,
                   int direction)
{
    int16_t features[R33_FEATURE_COUNT];
    int feature;
    r33_task_features(item->dimensions, item->mask, &item->witness,
                      action, R31_FEEDBACK_FULL, features);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        model->weights[feature] += direction * features[feature];
}

R0Status r34w_train(R33Model *model, uint8_t maximum_dimensions,
                    R34WTrainingReport *report, char *error,
                    size_t error_capacity)
{
    uint8_t stage;
    uint32_t epochs = 0, mistakes = 0;
    R34WCorpus corpus;
    if (model == NULL || report == NULL || maximum_dimensions < 1 ||
        maximum_dimensions >= R33_MAX_DIMENSIONS)
        return R0_INVALID_ARGUMENT;
    r33_model_init(model);
    memset(report, 0, sizeof(*report));
    memset(&corpus, 0, sizeof(corpus));
    for (stage = 1; stage <= maximum_dimensions; ++stage) {
        uint32_t epoch;
        free(corpus.items);
        memset(&corpus, 0, sizeof(corpus));
        {
            R0Status status = build_corpus(stage, &corpus);
            if (status != R0_OK) return status;
        }
        for (epoch = 0; epoch < R33_MAX_EPOCHS; ++epoch) {
            size_t index;
            uint32_t epoch_mistakes = 0;
            for (index = 0; index < corpus.count; ++index) {
                R34WCase *item = &corpus.items[index];
                int predicted = r33_task_select(
                    model, item->dimensions, item->mask, &item->witness,
                    R31_FEEDBACK_FULL);
                if (predicted >= 0 &&
                    (item->optimal & (UINT16_C(1) << predicted)) != 0)
                    continue;
                {
                    int target = best_optimal(model, item);
                    if (target < 0 || predicted < 0) {
                        free(corpus.items);
                        return R0_POLICY_ERROR;
                    }
                    update(model, item, target, 1);
                    update(model, item, predicted, -1);
                    ++epoch_mistakes;
                }
            }
            ++epochs;
            mistakes += epoch_mistakes;
            if (epoch_mistakes == 0) break;
        }
        model->trained_dimensions = stage;
    }
    report->cases = (uint32_t)corpus.count;
    report->epochs = epochs;
    report->mistakes = mistakes;
    report->maximum_training_dimensions = maximum_dimensions;
    {
        size_t index;
        int feature;
        for (index = 0; index < corpus.count; ++index) {
            R34WCase *item = &corpus.items[index];
            int action = r33_task_select(
                model, item->dimensions, item->mask, &item->witness,
                R31_FEEDBACK_FULL);
            if (action < 0 ||
                (item->optimal & (UINT16_C(1) << action)) == 0)
                ++report->final_errors;
        }
        for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
            if (model->weights[feature] != 0) ++report->nonzero_weights;
    }
    report->active_weight_bytes = sizeof(model->weights);
    free(corpus.items);
    if (report->final_errors != 0) {
        set_error(error, error_capacity,
                  "witness policy has %u final training errors",
                  report->final_errors);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static void check_permutations(const R33Model *model, uint8_t dimensions,
                               uint16_t mask, uint16_t optimal,
                               const R33Witness *witness,
                               R34WEvaluation *report)
{
    uint8_t permutation[R33_MAX_DIMENSIONS];
    uint8_t dimension;
    for (dimension = 0; dimension < dimensions; ++dimension)
        permutation[dimension] = dimension;
    while (next_permutation(permutation, dimensions)) {
        uint16_t changed_mask = r33_task_transform_mask(
            dimensions, mask, permutation);
        uint16_t changed_optimal = r33_task_transform_mask(
            dimensions, optimal, permutation);
        R33Witness changed_witness = r33_task_transform_witness(
            dimensions, *witness, permutation);
        int action = r33_task_select(model, dimensions, changed_mask,
                                     &changed_witness,
                                     R31_FEEDBACK_FULL);
        ++report->permutation_cases;
        if (action >= 0 &&
            (changed_optimal & (UINT16_C(1) << action)) != 0)
            ++report->permutation_exact;
    }
}

R0Status r34w_evaluate(const R33Model *model, uint8_t dimensions,
                       uint8_t feedback_mode, uint8_t permutations,
                       R34WEvaluation *report, char *error,
                       size_t error_capacity)
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
        uint16_t target = r33_task_target(dimensions, program);
        uint16_t mask = 0;
        int robust = 1;
        while (mask != target) {
            uint32_t state_index;
            int checked_permutations = 0;
            for (state_index = 0;
                 state_index < r33_task_state_count(dimensions);
                 ++state_index) {
                R33State state = r33_task_state(dimensions, state_index);
                R33Witness witness;
                uint16_t legal, optimal;
                int action;
                if (!r33_task_holds(dimensions, mask, &state) ||
                    r33_task_holds(dimensions, target, &state))
                    continue;
                memset(&witness, 0, sizeof(witness));
                witness.kind = R31_WITNESS_NEGATIVE;
                witness.source = state;
                witness.target =
                    r33_task_nearest(dimensions, target, &state);
                legal = r33_task_progress_actions(dimensions, mask,
                                                  &witness);
                optimal = legal & (uint16_t)(target ^ mask);
                if (optimal == 0) return R0_VERIFIER_ERROR;
                action = r33_task_select(model, dimensions, mask, &witness,
                                         feedback_mode);
                ++report->decisions;
                if (action >= 0 &&
                    (optimal & (UINT16_C(1) << action)) != 0)
                    ++report->exact_decisions;
                else
                    robust = 0;
                if (permutations && !checked_permutations) {
                    check_permutations(model, dimensions, mask, optimal,
                                       &witness, report);
                    checked_permutations = 1;
                }
            }
            {
                int action = first_action((uint16_t)(target ^ mask));
                if (action < 0) break;
                mask |= (uint16_t)(UINT16_C(1) << action);
            }
        }
        if (robust) ++report->robust_programs;
    }
    report->exact = (uint8_t)(
        report->robust_programs == report->programs &&
        report->exact_decisions == report->decisions &&
        report->permutation_exact == report->permutation_cases);
    if (feedback_mode != R31_FEEDBACK_FULL || !permutations)
        report->exact = (uint8_t)(
            report->robust_programs == report->programs &&
            report->exact_decisions == report->decisions);
    if (!report->exact)
        set_error(error, error_capacity,
                  "%u of %u dimension-%u programs are witness robust",
                  report->robust_programs, report->programs, dimensions);
    return R0_OK;
}

static void digest_u32(uint64_t *digest, uint32_t value)
{
    unsigned byte;
    for (byte = 0; byte < 4; ++byte) {
        *digest ^= (uint8_t)(value >> (byte * 8U));
        *digest *= R34W_FNV_PRIME;
    }
}

R0Status r34w_run_sealed(R34WExperimentReport *report, char *error,
                         size_t error_capacity)
{
    R33Model development_model, final_model, canonical_model;
    R33TrainingReport canonical_training;
    uint64_t digest = R34W_FNV_OFFSET;
    R0Status status;
    int feature;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = r34w_train(&development_model, 2,
                        &report->development_training, error,
                        error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(&development_model, 3,
                               R31_FEEDBACK_FULL, 1,
                               &report->development, error,
                               error_capacity);
    if (status != R0_OK) return status;
    report->development_gate_passed = report->development.exact;
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "sealed witness test remains closed because 3D failed");
        return R0_POLICY_ERROR;
    }
    status = r34w_train(&final_model, 3, &report->final_training, error,
                        error_capacity);
    if (status == R0_OK)
        status = r33_train(&canonical_model, 3, &canonical_training,
                           error, error_capacity);
    if (status != R0_OK) return status;

    /* The sealed counterexample-order test is first opened below. */
    status = r34w_evaluate(&final_model, 4, R31_FEEDBACK_FULL, 1,
                           &report->semantic, error, error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(&canonical_model, 4,
                               R31_FEEDBACK_FULL, 0,
                               &report->canonical_witness_control,
                               error, error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(&final_model, 4,
                               R31_FEEDBACK_RANKER_MASKED, 0,
                               &report->witness_masked, error,
                               error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(&final_model, 4,
                               R31_FEEDBACK_TOOL_ONLY, 0,
                               &report->tool_only, error,
                               error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->semantic_weights, final_model.weights,
           sizeof(report->semantic_weights));
    report->sealed_gate_passed = (uint8_t)(
        report->semantic.exact &&
        !report->canonical_witness_control.exact &&
        !report->witness_masked.exact && !report->tool_only.exact &&
        report->final_training.active_weight_bytes <= 64);
    digest_u32(&digest, report->development.decisions);
    digest_u32(&digest, report->development.exact_decisions);
    digest_u32(&digest, report->semantic.decisions);
    digest_u32(&digest, report->semantic.exact_decisions);
    digest_u32(&digest, report->canonical_witness_control.exact_decisions);
    digest_u32(&digest, report->witness_masked.exact_decisions);
    digest_u32(&digest, report->tool_only.exact_decisions);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        digest_u32(&digest, (uint32_t)final_model.weights[feature]);
    report->result_digest = digest;
    return R0_OK;
}

R0Status r34w_write_result(const R34WExperimentReport *report,
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
            "  \"schema\": \"zero.reasoner34_witness_order.v1\",\n"
            "  \"version\": \"(3,3,4)\",\n"
            "  \"sealed_dimension\": 4,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"development_training\": {\"cases\": %u, \"epochs\": %u, \"mistakes\": %u, \"final_errors\": %u},\n"
            "  \"development\": {\"programs\": %u, \"robust_programs\": %u, \"decisions\": %u, \"exact_decisions\": %u, \"permutation_cases\": %u, \"permutation_exact\": %u},\n"
            "  \"final_training\": {\"cases\": %u, \"epochs\": %u, \"mistakes\": %u, \"final_errors\": %u, \"nonzero_weights\": %u, \"active_weight_bytes\": %u},\n"
            "  \"semantic\": {\"programs\": %u, \"robust_programs\": %u, \"decisions\": %u, \"exact_decisions\": %u, \"permutation_cases\": %u, \"permutation_exact\": %u},\n"
            "  \"canonical_witness_control\": {\"programs\": %u, \"robust_programs\": %u, \"decisions\": %u, \"exact_decisions\": %u},\n"
            "  \"witness_masked\": {\"programs\": %u, \"robust_programs\": %u, \"decisions\": %u, \"exact_decisions\": %u},\n"
            "  \"tool_only\": {\"programs\": %u, \"robust_programs\": %u, \"decisions\": %u, \"exact_decisions\": %u},\n"
            "  \"semantic_weights\": [",
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->development_training.cases,
            report->development_training.epochs,
            report->development_training.mistakes,
            report->development_training.final_errors,
            report->development.programs,
            report->development.robust_programs,
            report->development.decisions,
            report->development.exact_decisions,
            report->development.permutation_cases,
            report->development.permutation_exact,
            report->final_training.cases,
            report->final_training.epochs,
            report->final_training.mistakes,
            report->final_training.final_errors,
            report->final_training.nonzero_weights,
            report->final_training.active_weight_bytes,
            report->semantic.programs, report->semantic.robust_programs,
            report->semantic.decisions, report->semantic.exact_decisions,
            report->semantic.permutation_cases,
            report->semantic.permutation_exact,
            report->canonical_witness_control.programs,
            report->canonical_witness_control.robust_programs,
            report->canonical_witness_control.decisions,
            report->canonical_witness_control.exact_decisions,
            report->witness_masked.programs,
            report->witness_masked.robust_programs,
            report->witness_masked.decisions,
            report->witness_masked.exact_decisions,
            report->tool_only.programs, report->tool_only.robust_programs,
            report->tool_only.decisions,
            report->tool_only.exact_decisions);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        fprintf(file, "%s%d", feature == 0 ? "" : ",",
                report->semantic_weights[feature]);
    fprintf(file,
            "],\n  \"result_digest\": \"%016llx\"\n}\n",
            (unsigned long long)report->result_digest);
    if (ferror(file)) {
        fclose(file);
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
