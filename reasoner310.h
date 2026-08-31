#ifndef REASONER310_H
#define REASONER310_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R310_MAX_DIMENSIONS = 12,
    R310_VECTOR_COUNT = 32,
    R310_QUERY_COUNT =
        (R310_VECTOR_COUNT * (R310_VECTOR_COUNT - 1)) / 2,
    R310_ACTION_CANDIDATES = 4,
    R310_ACTION_CASES = 3,
    R310_INITIAL_DEMOS = 2,
    R310_MAX_POINT_PROGRAMS = 32,
    R310_MAX_FOLDS = 16,
    R310_MAX_PROGRAMS = 512,
    R310_MAX_POINT_CODE = 12,
    R310_MAX_REPORT_TEXT = 512
};

typedef enum {
    R310_TOOL_QUERY = 1,
    R310_TOOL_APPLY = 2,
    R310_TOOL_COMMIT = 3,
    R310_TOOL_REPORT = 4
} R310Tool;

typedef struct {
    uint32_t episodes;
    uint32_t target_programs;
    uint32_t demonstrations;
    uint32_t queries;
    uint32_t exact_queries;
    uint32_t identifications;
    uint32_t exact_identifications;
    uint32_t actions;
    uint32_t exact_actions;
    uint32_t commits;
    uint32_t exact_commits;
    uint32_t reports;
    uint32_t exact_reports;
    uint32_t premature_commits;
    uint32_t invariance_checks;
    uint32_t exact_invariance_checks;
    uint32_t maximum_queries;
    uint8_t exact;
} R310Evaluation;

typedef struct {
    uint32_t raw_point_programs;
    uint32_t canonical_point_programs;
    uint32_t raw_fold_programs;
    uint32_t canonical_fold_programs;
    uint32_t raw_aggregate_programs;
    uint32_t canonical_programs;
    uint32_t curriculum_programs;
    uint32_t open_programs;
    uint32_t sealed_programs;
    uint8_t canonicalization_passed;
    uint8_t unique_minimum_passed;
    uint8_t grammar_certificate_passed;
    uint8_t semantic_oracle_passed;
    uint8_t fixed_quadratic_control_passed;
    uint8_t curriculum_lookup_control_passed;
    uint8_t no_query_control_passed;
    uint8_t shuffled_feedback_control_passed;
    uint8_t coefficient_only_control_passed;
    R310Evaluation curriculum;
    R310Evaluation development;
    R310Evaluation sealed;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R310ExperimentReport;

R0Status r310_run_development(R310ExperimentReport *report, char *error,
                              size_t error_capacity);
R0Status r310_run_sealed(R310ExperimentReport *report, char *error,
                         size_t error_capacity);
R0Status r310_write_result(const R310ExperimentReport *report,
                           const char *path, char *error,
                           size_t error_capacity);

#endif
