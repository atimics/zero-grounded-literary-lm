#ifndef REASONER33_H
#define REASONER33_H

#include "reasoner32.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R33_MAX_DIMENSIONS = 4,
    R33_DOMAIN_MIN = -2,
    R33_DOMAIN_MAX = 2,
    R33_ATOMS_PER_DIMENSION = 4,
    R33_MAX_ATOMS = 16,
    R33_FEATURE_COUNT = 16,
    R33_MAX_PROGRAMS = 4095,
    R33_MAX_STEPS = 8,
    R33_MAX_CASES = 100000,
    R33_MAX_EPOCHS = 256
};

typedef struct {
    int8_t values[R33_MAX_DIMENSIONS];
} R33State;

typedef struct {
    uint8_t kind;
    R33State source;
    R33State target;
} R33Witness;

typedef struct {
    uint8_t accepted;
    R33Witness witness;
} R33Verification;

typedef struct {
    int32_t weights[R33_FEATURE_COUNT];
    uint32_t epochs;
    uint32_t mistakes;
    uint8_t trained_dimensions;
} R33Model;

typedef struct {
    uint8_t dimensions;
    uint32_t programs;
    uint32_t solved;
    uint32_t minimal;
    uint32_t failed;
    uint32_t verifier_calls;
    uint32_t excess_edits;
    uint32_t permutation_cases;
    uint32_t permutation_exact;
    uint8_t exact;
} R33Evaluation;

typedef struct {
    uint32_t cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint32_t nonzero_weights;
    uint32_t active_weight_bytes;
    uint8_t maximum_training_dimensions;
} R33TrainingReport;

typedef struct {
    R33TrainingReport development_training;
    R33Evaluation development;
    R33TrainingReport final_training;
    R33Evaluation semantic;
    R33Evaluation hashed_control;
    R33Evaluation witness_masked;
    R33Evaluation tool_only;
    uint32_t equal_admissibility_pairs;
    uint32_t equal_admissibility_pairs_exact;
    uint32_t equal_admissibility_masked_both_correct;
    int32_t semantic_weights[R33_FEATURE_COUNT];
    uint32_t semantic_nonzero_weights;
    uint32_t semantic_active_weight_bytes;
    uint32_t hashed_control_weights;
    uint32_t hashed_control_active_weight_bytes;
    uint64_t result_digest;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
} R33ExperimentReport;

void r33_model_init(R33Model *model);
uint32_t r33_program_count(uint8_t dimensions);
R0Status r33_train(R33Model *model, uint8_t maximum_dimensions,
                   R33TrainingReport *report, char *error,
                   size_t error_capacity);
R0Status r33_evaluate(const R33Model *model, uint8_t dimensions,
                      uint8_t feedback_mode, R33Evaluation *report,
                      char *error, size_t error_capacity);
R0Status r33_check_hashed_3d(R33Evaluation *report, char *error,
                             size_t error_capacity);
R0Status r33_run_sealed(R33ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r33_write_result(const R33ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
