#ifndef REASONER333_H
#define REASONER333_H

#include <stddef.h>
#include <stdint.h>

enum {
    R333_MAX_VARIABLES = 9,
    R333_MAX_EDGES = 8,
    R333_ACTIONS_PER_EDGE = 6,
    R333_MAX_ACTIONS = 48,
    R333_FEATURE_COUNT = 16,
    R333_LOOKUP_SLOTS = 12,
    R333_MAX_STEPS = 32,
    R333_RELABELINGS = 4
};

typedef enum {
    R333_OK = 0,
    R333_INVALID_ARGUMENT,
    R333_LIMIT_ERROR,
    R333_VERIFIER_ERROR,
    R333_POLICY_ERROR,
    R333_IO_ERROR
} R333Status;

typedef enum {
    R333_FULL_FEEDBACK = 0,
    R333_BRIDGE_MASKED = 1,
    R333_MODULE_ONLY = 2,
    R333_TOOL_ONLY = 3
} R333FeedbackMode;

typedef struct {
    int32_t weights[R333_FEATURE_COUNT];
} R333Model;

typedef struct {
    uint32_t keys[R333_LOOKUP_SLOTS];
    uint8_t actions[R333_LOOKUP_SLOTS];
    uint32_t count;
} R333Lookup;

typedef struct {
    uint32_t cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint32_t nonzero_weights;
    uint32_t semantic_bytes;
    uint32_t lookup_cases;
    uint32_t lookup_errors;
    uint32_t lookup_bytes;
} R333TrainingReport;

typedef struct {
    uint32_t programs;
    uint32_t solved;
    uint32_t minimal;
    uint32_t failed;
    uint32_t excess_edits;
    uint32_t verifier_calls;
    uint32_t relabel_cases;
    uint32_t relabel_exact;
    uint8_t exact;
} R333Evaluation;

typedef struct {
    R333TrainingReport training;
    R333Evaluation development;
    R333Evaluation development_lookup;
    R333Evaluation development_bridge_masked;
    R333Evaluation development_module_only;
    R333Evaluation development_tool_only;
    R333Evaluation semantic;
    R333Evaluation lookup;
    R333Evaluation bridge_masked;
    R333Evaluation module_only;
    R333Evaluation tool_only;
    int32_t semantic_weights[R333_FEATURE_COUNT];
    uint32_t semantic_bytes;
    uint32_t lookup_bytes;
    uint64_t result_digest;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
} R333ExperimentReport;

const char *r333_status_name(R333Status status);
uint32_t r333_training_program_count(void);
uint32_t r333_development_program_count(void);
uint32_t r333_sealed_program_count(void);
R333Status r333_run_development(R333ExperimentReport *report, char *error,
                                size_t error_capacity);
R333Status r333_run_sealed(R333ExperimentReport *report, char *error,
                           size_t error_capacity);
R333Status r333_write_result(const R333ExperimentReport *report,
                             const char *path, char *error,
                             size_t error_capacity);
R333Status r333_joint_train_epoch(
    int32_t weights[R333_FEATURE_COUNT], uint32_t *mistakes,
    char *error, size_t error_capacity);
R333Status r333_joint_training_errors(
    const int32_t weights[R333_FEATURE_COUNT], uint32_t *errors,
    char *error, size_t error_capacity);
R333Status r333_joint_evaluate_development(
    const int32_t weights[R333_FEATURE_COUNT], R333Evaluation *report,
    char *error, size_t error_capacity);
R333Status r333_joint_evaluate_extended(
    const int32_t weights[R333_FEATURE_COUNT], R333Evaluation *report,
    char *error, size_t error_capacity);

#endif
