#ifndef REASONER34_WITNESS_H
#define REASONER34_WITNESS_H

#include "reasoner33.h"

typedef struct {
    uint32_t cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint32_t nonzero_weights;
    uint32_t active_weight_bytes;
    uint8_t maximum_training_dimensions;
} R34WTrainingReport;

typedef struct {
    uint8_t dimensions;
    uint32_t programs;
    uint32_t robust_programs;
    uint32_t decisions;
    uint32_t exact_decisions;
    uint32_t permutation_cases;
    uint32_t permutation_exact;
    uint8_t exact;
} R34WEvaluation;

typedef struct {
    R34WTrainingReport development_training;
    R34WEvaluation development;
    R34WTrainingReport final_training;
    R34WEvaluation semantic;
    R34WEvaluation canonical_witness_control;
    R34WEvaluation witness_masked;
    R34WEvaluation tool_only;
    int32_t semantic_weights[R33_FEATURE_COUNT];
    uint64_t result_digest;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
} R34WExperimentReport;

R0Status r34w_train(R33Model *model, uint8_t maximum_dimensions,
                    R34WTrainingReport *report, char *error,
                    size_t error_capacity);
R0Status r34w_evaluate(const R33Model *model, uint8_t dimensions,
                       uint8_t feedback_mode, uint8_t permutations,
                       R34WEvaluation *report, char *error,
                       size_t error_capacity);
R0Status r34w_run_sealed(R34WExperimentReport *report, char *error,
                         size_t error_capacity);
R0Status r34w_write_result(const R34WExperimentReport *report,
                           const char *path, char *error,
                           size_t error_capacity);
R0Status r34w_joint_train_epoch(
    int32_t weights[R33_FEATURE_COUNT], uint8_t maximum_dimensions,
    uint32_t *mistakes, char *error, size_t error_capacity);
R0Status r34w_joint_training_errors(
    const int32_t weights[R33_FEATURE_COUNT], uint8_t maximum_dimensions,
    uint32_t *errors, char *error, size_t error_capacity);
R0Status r34w_evaluate_repair_choices(
    const R33Model *model, uint8_t dimensions, uint8_t permutations,
    R34WEvaluation *report, char *error, size_t error_capacity);

#endif
