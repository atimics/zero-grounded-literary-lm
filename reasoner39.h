#ifndef REASONER39_H
#define REASONER39_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R39_FEATURE_COUNT = 16,
    R39_PROTOCOL_FEATURES = 7,
    R39_RAW_FEATURES = 9,
    R39_POLICY_BYTES = R39_FEATURE_COUNT * (int)sizeof(int32_t),
    R39_DOMAIN_COUNT = 3,
    R39_MAX_DIMENSIONS = 12,
    R39_MAX_CANDIDATES = 5,
    R39_MAX_STAGES = 8,
    R39_MAX_CALLS = R39_MAX_CANDIDATES * 2 + 1,
    R39_SEARCH_LIMIT = 2,
    R39_PERCEPTRON_EPOCHS = 512
};

typedef enum {
    R39_TOOL_QUERY = 1,
    R39_TOOL_APPLY = 2,
    R39_TOOL_COMMIT = 3
} R39Tool;

typedef struct {
    uint32_t episodes;
    uint32_t mixed_episodes;
    uint32_t decisions;
    uint32_t exact_decisions;
    uint32_t margin_errors;
    uint32_t coordinate_permutations;
    uint32_t coordinate_permutations_exact;
    uint32_t translated_episodes;
    uint32_t sign_flipped_episodes;
    uint8_t exact;
    uint8_t strict_margin_exact;
} R39Evaluation;

typedef struct {
    uint32_t raw_candidates_examined;
    uint32_t raw_certified_candidates;
    uint32_t raw_minimum_solutions;
    uint32_t raw_description_length;
    uint32_t protocol_candidates_examined;
    uint32_t protocol_description_length;
    uint32_t training_episodes;
    uint32_t training_margin_errors;
    uint32_t perceptron_epochs;
    uint32_t perceptron_mistakes;
    uint32_t perceptron_training_errors;
    int32_t weights[R39_FEATURE_COUNT];
    int32_t perceptron_raw_weights[R39_RAW_FEATURES];
    R39Evaluation development;
    R39Evaluation sealed;
    uint8_t primitive_law_passed;
    uint8_t algebraic_certificate_passed;
    uint8_t minimum_description_passed;
    uint8_t semantic_oracle_passed;
    uint8_t zero_control_passed;
    uint8_t shuffled_raw_feedback_passed;
    uint8_t linear_only_control_passed;
    uint8_t perceptron_training_fit_passed;
    uint8_t perceptron_certificate_passed;
    uint32_t policy_bytes;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R39ExperimentReport;

R0Status r39_run_development(R39ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r39_run_sealed(R39ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r39_write_result(const R39ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
