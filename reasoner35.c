#include "reasoner35.h"

#include <errno.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define R35_FNV_OFFSET UINT64_C(1469598103934665603)
#define R35_FNV_PRIME UINT64_C(1099511628211)

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static R0Status task_epoch(uint8_t task, int32_t weights[R34_FEATURE_COUNT],
                           uint32_t *mistakes, char *error,
                           size_t error_capacity)
{
    if (task == R35_TASK_PLANNING)
        return r34_joint_train_epoch(weights, mistakes, error,
                                     error_capacity);
    if (task == R35_TASK_COMPOSITION) {
        R333Status status = r333_joint_train_epoch(
            weights, mistakes, error, error_capacity);
        return status == R333_OK ? R0_OK : R0_POLICY_ERROR;
    }
    if (task == R35_TASK_WITNESS)
        return r34w_joint_train_epoch(weights, 2, mistakes, error,
                                      error_capacity);
    return R0_INVALID_ARGUMENT;
}

static R0Status task_errors(uint8_t task,
                            const int32_t weights[R34_FEATURE_COUNT],
                            uint32_t *errors, char *error,
                            size_t error_capacity)
{
    if (task == R35_TASK_PLANNING)
        return r34_joint_training_errors(weights, errors, error,
                                         error_capacity);
    if (task == R35_TASK_COMPOSITION) {
        R333Status status = r333_joint_training_errors(
            weights, errors, error, error_capacity);
        return status == R333_OK ? R0_OK : R0_POLICY_ERROR;
    }
    if (task == R35_TASK_WITNESS)
        return r34w_joint_training_errors(weights, 2, errors, error,
                                          error_capacity);
    return R0_INVALID_ARGUMENT;
}

static R0Status measure_errors(R35ArmReport *report, char *error,
                               size_t error_capacity)
{
    const uint8_t tasks[R35_TASK_COUNT] = {
        R35_TASK_PLANNING, R35_TASK_COMPOSITION, R35_TASK_WITNESS};
    uint8_t index;
    report->converged = 1;
    memset(report->training_errors, 0, sizeof(report->training_errors));
    for (index = 0; index < R35_TASK_COUNT; ++index) {
        R0Status status;
        if ((report->task_mask & tasks[index]) == 0) continue;
        status = task_errors(tasks[index], report->weights,
                             &report->training_errors[index], error,
                             error_capacity);
        if (status != R0_OK) return status;
        if (report->training_errors[index] != 0) report->converged = 0;
    }
    return R0_OK;
}

static R0Status train_cyclic(R35ArmReport *report, char *error,
                             size_t error_capacity)
{
    static const uint8_t orders[6][R35_TASK_COUNT] = {
        {1, 2, 4}, {1, 4, 2}, {2, 1, 4},
        {2, 4, 1}, {4, 1, 2}, {4, 2, 1}};
    uint32_t epoch;
    for (epoch = 0; epoch < R35_MAX_EPOCHS; ++epoch) {
        uint8_t cursor;
        for (cursor = 0; cursor < R35_TASK_COUNT; ++cursor) {
            uint8_t task = orders[epoch % 6][cursor];
            uint32_t mistakes = 0;
            R0Status status;
            if ((report->task_mask & task) == 0) continue;
            status = task_epoch(task, report->weights, &mistakes, error,
                                error_capacity);
            if (status != R0_OK) return status;
            report->mistakes += mistakes;
        }
        ++report->epochs;
        {
            R0Status status = measure_errors(report, error, error_capacity);
            if (status != R0_OK) return status;
        }
        if (report->converged) break;
    }
    return R0_OK;
}

static R0Status train_sequential(R35ArmReport *report, char *error,
                                 size_t error_capacity)
{
    const uint8_t tasks[R35_TASK_COUNT] = {
        R35_TASK_PLANNING, R35_TASK_COMPOSITION, R35_TASK_WITNESS};
    uint8_t index;
    for (index = 0; index < R35_TASK_COUNT; ++index) {
        uint32_t epoch;
        for (epoch = 0; epoch < R35_MAX_EPOCHS; ++epoch) {
            uint32_t mistakes = 0, errors = 0;
            R0Status status = task_epoch(tasks[index], report->weights,
                                         &mistakes, error, error_capacity);
            if (status != R0_OK) return status;
            report->mistakes += mistakes;
            ++report->epochs;
            status = task_errors(tasks[index], report->weights, &errors,
                                 error, error_capacity);
            if (status != R0_OK) return status;
            if (errors == 0) break;
        }
    }
    return measure_errors(report, error, error_capacity);
}

static R0Status evaluate_arm(R35ArmReport *report, char *error,
                             size_t error_capacity)
{
    R0Status status;
    report->development_passed = report->converged;
    if ((report->task_mask & R35_TASK_PLANNING) != 0) {
        status = r34_joint_evaluate_development(
            report->weights, &report->planning, error, error_capacity);
        if (status != R0_OK) return status;
        if (!report->planning.exact) report->development_passed = 0;
    }
    if ((report->task_mask & R35_TASK_COMPOSITION) != 0) {
        R333Status composition_status = r333_joint_evaluate_development(
            report->weights, &report->composition, error, error_capacity);
        if (composition_status != R333_OK) return R0_POLICY_ERROR;
        if (!report->composition.exact) report->development_passed = 0;
    }
    if ((report->task_mask & R35_TASK_WITNESS) != 0) {
        R33Model model;
        r33_model_init(&model);
        memcpy(model.weights, report->weights, sizeof(model.weights));
        model.trained_dimensions = 2;
        status = r34w_evaluate_repair_choices(
            &model, 3, 1, &report->witness, error, error_capacity);
        if (status != R0_OK) return status;
        if (!report->witness.exact) report->development_passed = 0;
    }
    return R0_OK;
}

static R0Status run_independent_control(uint8_t *passed, char *error,
                                        size_t error_capacity)
{
    R34ExperimentReport planning;
    R333ExperimentReport composition;
    R34WTrainingReport training;
    R34WEvaluation witness;
    R33Model witness_model;
    R0Status status = r34_run_development(&planning, error, error_capacity);
    R333Status composition_status;
    if (status != R0_OK) return status;
    composition_status = r333_run_development(&composition, error,
                                              error_capacity);
    if (composition_status != R333_OK) return R0_POLICY_ERROR;
    status = r34w_train(&witness_model, 2, &training, error,
                        error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate_repair_choices(
            &witness_model, 3, 1, &witness, error, error_capacity);
    if (status != R0_OK) return status;
    *passed = (uint8_t)(planning.development_gate_passed &&
                        composition.development_gate_passed &&
                        witness.exact);
    return R0_OK;
}

static R0Status run_zero_control(uint8_t *passed_tasks, char *error,
                                 size_t error_capacity)
{
    int32_t weights[R34_FEATURE_COUNT] = {0};
    R34Evaluation planning;
    R333Evaluation composition;
    R34WEvaluation witness;
    R33Model model;
    R0Status status = r34_joint_evaluate_development(
        weights, &planning, error, error_capacity);
    R333Status composition_status;
    if (status != R0_OK) return status;
    composition_status = r333_joint_evaluate_development(
        weights, &composition, error, error_capacity);
    if (composition_status != R333_OK) return R0_POLICY_ERROR;
    r33_model_init(&model);
    model.trained_dimensions = 2;
    status = r34w_evaluate_repair_choices(
        &model, 3, 1, &witness, error, error_capacity);
    if (status != R0_OK) return status;
    *passed_tasks = (uint8_t)(planning.exact + composition.exact +
                              witness.exact);
    return R0_OK;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (byte * 8));
        hash *= R35_FNV_PRIME;
    }
    return hash;
}

static uint64_t experiment_digest(const R35ExperimentReport *report)
{
    uint64_t hash = R35_FNV_OFFSET;
    uint8_t arm, feature, task;
    for (arm = 0; arm < R35_ARM_COUNT; ++arm) {
        const R35ArmReport *item = &report->arms[arm];
        hash = digest_u64(hash, item->task_mask);
        hash = digest_u64(hash, item->sequential);
        hash = digest_u64(hash, item->epochs);
        hash = digest_u64(hash, item->mistakes);
        hash = digest_u64(hash, item->development_passed);
        for (task = 0; task < R35_TASK_COUNT; ++task)
            hash = digest_u64(hash, item->training_errors[task]);
        for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
            hash = digest_u64(
                hash, (uint64_t)(uint32_t)item->weights[feature]);
    }
    hash = digest_u64(hash, report->independent_control_passed);
    hash = digest_u64(hash, report->zero_control_passed_tasks);
    hash = digest_u64(hash, report->joint_gate_passed);
    hash = digest_u64(hash, report->sealed_planning.worlds);
    hash = digest_u64(hash, report->sealed_planning.optimal);
    hash = digest_u64(hash, report->sealed_composition.programs);
    hash = digest_u64(hash, report->sealed_composition.minimal);
    hash = digest_u64(hash, report->sealed_witness.programs);
    hash = digest_u64(hash, report->sealed_witness.robust_programs);
    hash = digest_u64(hash, report->sealed_witness.decisions);
    hash = digest_u64(hash, report->sealed_witness.exact_decisions);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R0Status r35_run_development(R35ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    const uint8_t masks[R35_ARM_COUNT] = {3, 5, 6, 7, 7};
    uint8_t arm;
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    for (arm = 0; arm < R35_ARM_COUNT; ++arm) {
        R35ArmReport *item = &report->arms[arm];
        item->task_mask = masks[arm];
        item->sequential = (uint8_t)(arm == R35_ARM_COUNT - 1);
        status = item->sequential
                     ? train_sequential(item, error, error_capacity)
                     : train_cyclic(item, error, error_capacity);
        if (status != R0_OK) return status;
        status = evaluate_arm(item, error, error_capacity);
        if (status != R0_OK) return status;
    }
    status = run_independent_control(&report->independent_control_passed,
                                     error, error_capacity);
    if (status == R0_OK)
        status = run_zero_control(&report->zero_control_passed_tasks,
                                  error, error_capacity);
    if (status != R0_OK) return status;
    report->shared_policy_bytes =
        R34_FEATURE_COUNT * (uint32_t)sizeof(int32_t);
    report->independent_control_bytes =
        R35_TASK_COUNT * report->shared_policy_bytes;
    report->mechanics_passed =
        (uint8_t)(report->independent_control_passed &&
                  report->zero_control_passed_tasks == 0);
    report->joint_gate_passed = report->arms[3].development_passed;
    report->result_digest = experiment_digest(report);
    if (!report->mechanics_passed) {
        set_error(error, error_capacity,
                  "Reasoner (3,4) controls did not behave as frozen");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r35_run_sealed(R35ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    const int32_t *weights;
    R33Model witness_model;
    R0Status status = r35_run_development(report, error, error_capacity);
    R333Status composition_status;
    if (status != R0_OK) return status;
    if (!report->joint_gate_passed) {
        set_error(error, error_capacity,
                  "joint development gate did not pass; seal stays closed");
        return R0_POLICY_ERROR;
    }
    weights = report->arms[3].weights;
    status = r34_joint_evaluate_gates(
        weights, 8, 8, &report->sealed_planning, error, error_capacity);
    if (status != R0_OK) return status;
    composition_status = r333_joint_evaluate_extended(
        weights, &report->sealed_composition, error, error_capacity);
    if (composition_status != R333_OK) return R0_POLICY_ERROR;
    r33_model_init(&witness_model);
    memcpy(witness_model.weights, weights, sizeof(witness_model.weights));
    witness_model.trained_dimensions = 2;
    status = r34w_evaluate_repair_choices(
        &witness_model, 4, 1, &report->sealed_witness, error,
        error_capacity);
    if (status != R0_OK) return status;
    report->sealed_gate_passed =
        (uint8_t)(report->sealed_planning.exact &&
                  report->sealed_composition.exact &&
                  report->sealed_witness.exact);
    report->result_digest = experiment_digest(report);
    return R0_OK;
}

R0Status r35_write_result(const R35ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    uint8_t feature;
    if (report == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fprintf(
            file,
            "{\n  \"schema\": \"zero.reasoner35_joint_substrate.v1\",\n"
            "  \"version\": \"(3,4)\",\n"
            "  \"shared_policy_bytes\": %u,\n"
            "  \"independent_control_bytes\": %u,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"joint_training\": {\"epochs\": %u, "
            "\"mistakes\": %u, \"errors\": [%u, %u, %u]},\n"
            "  \"sealed_planning\": {\"gates\": 8, "
            "\"worlds\": %u, \"optimal\": %u, "
            "\"plan_steps\": %u, \"oracle_steps\": %u, "
            "\"relabel_steps\": %u, \"relabel_exact\": %u, "
            "\"exact\": %s},\n"
            "  \"sealed_composition\": {\"modules\": 4, "
            "\"width\": 2, \"programs\": %u, \"minimal\": %u, "
            "\"relabel_cases\": %u, \"relabel_exact\": %u, "
            "\"exact\": %s},\n"
            "  \"sealed_witness\": {\"dimensions\": 4, "
            "\"programs\": %u, \"robust_programs\": %u, "
            "\"repair_choice_decisions\": %u, "
            "\"exact_decisions\": %u, \"permutation_cases\": %u, "
            "\"permutation_exact\": %u, \"exact\": %s},\n"
            "  \"sequential_control_passed\": %s,\n"
            "  \"independent_control_passed\": %s,\n"
            "  \"zero_control_passed_tasks\": %u,\n"
            "  \"weights\": [",
            report->shared_policy_bytes,
            report->independent_control_bytes,
            report->joint_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->arms[3].epochs, report->arms[3].mistakes,
            report->arms[3].training_errors[0],
            report->arms[3].training_errors[1],
            report->arms[3].training_errors[2],
            report->sealed_planning.worlds,
            report->sealed_planning.optimal,
            report->sealed_planning.plan_steps,
            report->sealed_planning.oracle_steps,
            report->sealed_planning.relabel_steps,
            report->sealed_planning.relabel_exact,
            report->sealed_planning.exact ? "true" : "false",
            report->sealed_composition.programs,
            report->sealed_composition.minimal,
            report->sealed_composition.relabel_cases,
            report->sealed_composition.relabel_exact,
            report->sealed_composition.exact ? "true" : "false",
            report->sealed_witness.programs,
            report->sealed_witness.robust_programs,
            report->sealed_witness.decisions,
            report->sealed_witness.exact_decisions,
            report->sealed_witness.permutation_cases,
            report->sealed_witness.permutation_exact,
            report->sealed_witness.exact ? "true" : "false",
            report->arms[4].development_passed ? "true" : "false",
            report->independent_control_passed ? "true" : "false",
            report->zero_control_passed_tasks) < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        if (fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                    report->arms[3].weights[feature]) < 0) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
    if (fprintf(file,
                "],\n  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
                report->result_digest) < 0 || fclose(file) != 0) {
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
