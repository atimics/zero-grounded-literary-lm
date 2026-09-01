#ifndef REASONER34_H
#define REASONER34_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R34_MAX_GATES = 8,
    R34_TRAINING_MAX_GATES = 3,
    R34_DEVELOPMENT_GATES = 4,
    R34_SEALED_MIN_GATES = 5,
    R34_SEALED_MAX_GATES = 7,
    R34_FEATURE_COUNT = 16,
    R34_HASH_BUCKETS = 16,
    R34_LOOKUP_ENTRIES = 8,
    R34_MAX_PLAN_STEPS = 40,
    R34_MAX_STATES = 8192,
    R34_MAX_TRAINING_CASES = 256,
    R34_MAX_EPOCHS = 256
};

typedef struct {
    int32_t weights[R34_FEATURE_COUNT];
} R34Model;

typedef struct {
    int32_t weights[R34_HASH_BUCKETS];
} R34HashModel;

typedef struct {
    uint32_t keys[R34_LOOKUP_ENTRIES];
    uint16_t actions[R34_LOOKUP_ENTRIES];
    uint8_t used[R34_LOOKUP_ENTRIES];
} R34LookupModel;

typedef struct {
    uint32_t cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint32_t hash_epochs;
    uint32_t hash_mistakes;
    uint32_t hash_final_errors;
    uint32_t semantic_nonzero_weights;
    uint32_t semantic_active_weight_bytes;
    uint32_t hash_active_weight_bytes;
    uint32_t lookup_active_bytes;
} R34TrainingReport;

typedef struct {
    uint8_t minimum_gates;
    uint8_t maximum_gates;
    uint32_t worlds;
    uint32_t solved;
    uint32_t optimal;
    uint32_t failed;
    uint32_t plan_steps;
    uint32_t oracle_steps;
    uint32_t nonmonotonic_worlds;
    uint32_t distance_increases;
    uint32_t opened_goal_correct_gates;
    uint32_t restored_gates;
    uint32_t relabel_steps;
    uint32_t relabel_exact;
    uint8_t exact;
} R34Evaluation;

typedef struct {
    R34TrainingReport training;
    R34Evaluation development_semantic;
    R34Evaluation development_greedy;
    R34Evaluation development_tool_only;
    R34Evaluation development_hash;
    R34Evaluation development_lookup;
    R34Evaluation sealed_semantic;
    R34Evaluation sealed_greedy;
    R34Evaluation sealed_tool_only;
    R34Evaluation sealed_hash;
    R34Evaluation sealed_lookup;
    int32_t semantic_weights[R34_FEATURE_COUNT];
    uint64_t result_digest;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
} R34ExperimentReport;

R0Status r34_run_development(R34ExperimentReport *report, char *error,
                              size_t error_capacity);
R0Status r34_run_sealed(R34ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r34_write_result(const R34ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);
uint16_t r34_oracle_initial_distance(uint8_t gates);
R0Status r34_joint_train_epoch(int32_t weights[R34_FEATURE_COUNT],
                               uint32_t *mistakes, char *error,
                               size_t error_capacity);
R0Status r34_joint_training_errors(
    const int32_t weights[R34_FEATURE_COUNT], uint32_t *errors,
    char *error, size_t error_capacity);
R0Status r34_joint_evaluate_development(
    const int32_t weights[R34_FEATURE_COUNT], R34Evaluation *report,
    char *error, size_t error_capacity);
R0Status r34_joint_evaluate_gates(
    const int32_t weights[R34_FEATURE_COUNT], uint8_t minimum_gates,
    uint8_t maximum_gates, R34Evaluation *report, char *error,
    size_t error_capacity);

#endif
