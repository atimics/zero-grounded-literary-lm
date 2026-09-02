#ifndef REASONER42_H
#define REASONER42_H

#include "reasoner40.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R42_LIBRARY_SIZE = 3,
    R42_MAX_MACRO_CODE = 3,
    R42_MAX_BASE_CODE = 6,
    R42_MAX_TOKENS = 6,
    R42_MIN_DIMENSION = 4,
    R42_MAX_DIMENSION = 12,
    R42_QUERY_COUNT = 81,
    R42_MAX_PROGRAMS = 4096,
    R42_CURRICULUM_TARGETS = 9,
    R42_DEVELOPMENT_VARIANTS = 2,
    R42_SEALED_TARGETS = 17,
    R42_SEALED_VARIANTS = 2,
    R42_SEALED_MAXIMUM_QUERIES = 2
};

typedef enum {
    R42_CONTROL_MODEL = 0,
    R42_CONTROL_SEMANTIC_ORACLE = 1,
    R42_CONTROL_NO_LIBRARY = 2,
    R42_CONTROL_SHUFFLED_CURRICULUM = 3,
    R42_CONTROL_SINGLE_USE_LIBRARY = 4,
    R42_CONTROL_CURRICULUM_LOOKUP = 5,
    R42_CONTROL_NO_QUERY = 6
} R42Control;

typedef struct {
    uint32_t target_programs;
    uint32_t episodes;
    uint32_t demonstrations;
    uint32_t queries;
    uint32_t exact_queries;
    uint32_t identifications;
    uint32_t exact_identifications;
    uint32_t commits;
    uint32_t exact_commits;
    uint32_t premature_commits;
    uint32_t replay_checks;
    uint32_t exact_replays;
    uint32_t applications;
    uint32_t exact_applications;
    uint32_t reports;
    uint32_t exact_reports;
    uint32_t maximum_queries;
    uint8_t exact;
} R42Evaluation;

typedef struct {
    uint32_t frozen_base_programs;
    uint32_t curriculum_raw_programs;
    uint32_t curriculum_canonical_programs;
    uint32_t curriculum_solution_tokens;
    uint32_t learned_library_entries;
    uint32_t learned_library_definition_tokens;
    uint32_t learned_library_occurrences;
    uint32_t learned_library_mdl_gain;
    uint32_t development_raw_programs;
    uint32_t development_canonical_programs;
    uint32_t development_target_programs;
    uint32_t development_base_tokens;
    uint32_t development_library_tokens;
    uint32_t base_depth_four_raw_programs;
    uint32_t planned_sealed_raw_programs;
    uint32_t planned_sealed_base_raw_programs;
    uint32_t sealed_base_tokens;
    uint32_t sealed_library_tokens;
    uint8_t frozen_base_certificate_passed;
    uint8_t affine_certificate_passed;
    uint8_t library_discovery_certificate_passed;
    uint8_t library_freeze_certificate_passed;
    uint8_t compression_certificate_passed;
    uint8_t search_budget_certificate_passed;
    uint8_t semantic_oracle_control_passed;
    uint8_t no_library_control_passed;
    uint8_t shuffled_curriculum_control_passed;
    uint8_t single_use_library_control_passed;
    uint8_t curriculum_lookup_control_passed;
    uint8_t no_query_control_passed;
    uint8_t sealed_minimum_certificate_passed;
    R42Evaluation curriculum;
    R42Evaluation development;
    R42Evaluation sealed;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint8_t sealed_execution_locked;
    uint64_t library_digest;
    uint64_t result_digest;
} R42ExperimentReport;

R0Status r42_run_development(R42ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r42_run_sealed(R42ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r42_write_result(const R42ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
