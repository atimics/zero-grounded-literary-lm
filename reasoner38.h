#ifndef REASONER38_H
#define REASONER38_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R38_FEATURE_COUNT = 16,
    R38_POLICY_BYTES = R38_FEATURE_COUNT * (int)sizeof(int32_t),
    R38_DOMAIN_COUNT = 3,
    R38_MAX_DIMENSIONS = 8,
    R38_MAX_CANDIDATES = 5,
    R38_MAX_STAGES = 7,
    R38_MAX_CALLS = R38_MAX_CANDIDATES * 2 + 1,
    R38_MAX_EPOCHS = 512
};

typedef enum {
    R38_TOOL_QUERY = 1,
    R38_TOOL_APPLY = 2,
    R38_TOOL_COMMIT = 3
} R38Tool;

typedef struct {
    uint32_t episodes;
    uint32_t mixed_episodes;
    uint32_t decisions;
    uint32_t exact_decisions;
    uint32_t queries;
    uint32_t applies;
    uint32_t commits;
    uint32_t coordinate_permutations;
    uint32_t coordinate_permutations_exact;
    uint32_t translated_episodes;
    uint32_t sign_flipped_episodes;
    uint8_t exact;
} R38Evaluation;

typedef struct {
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t training_errors;
    int32_t weights[R38_FEATURE_COUNT];
    R38Evaluation development;
    R38Evaluation sealed;
    uint8_t semantic_oracle_passed;
    uint8_t zero_control_passed;
    uint8_t shuffled_raw_feedback_passed;
    uint8_t linear_ablation_passed;
    uint8_t dimension_lookup_passed;
    uint32_t policy_bytes;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R38ExperimentReport;

R0Status r38_run_development(R38ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r38_run_sealed(R38ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r38_write_result(const R38ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
