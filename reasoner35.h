#ifndef REASONER35_H
#define REASONER35_H

#include "reasoner34.h"
#include "reasoner333.h"
#include "reasoner34_witness.h"

enum {
    R35_TASK_PLANNING = 1,
    R35_TASK_COMPOSITION = 2,
    R35_TASK_WITNESS = 4,
    R35_TASK_COUNT = 3,
    R35_ARM_COUNT = 5,
    R35_MAX_EPOCHS = 512
};

typedef struct {
    uint8_t task_mask;
    uint8_t sequential;
    uint8_t converged;
    uint8_t development_passed;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t training_errors[R35_TASK_COUNT];
    int32_t weights[R34_FEATURE_COUNT];
    R34Evaluation planning;
    R333Evaluation composition;
    R34WEvaluation witness;
} R35ArmReport;

typedef struct {
    R35ArmReport arms[R35_ARM_COUNT];
    uint8_t independent_control_passed;
    uint8_t zero_control_passed_tasks;
    uint32_t shared_policy_bytes;
    uint32_t independent_control_bytes;
    uint8_t mechanics_passed;
    uint8_t joint_gate_passed;
    R34Evaluation sealed_planning;
    R333Evaluation sealed_composition;
    R34WEvaluation sealed_witness;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R35ExperimentReport;

R0Status r35_run_development(R35ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r35_run_sealed(R35ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r35_write_result(const R35ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
