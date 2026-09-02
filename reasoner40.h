#ifndef REASONER40_H
#define REASONER40_H

#include "reasoner310.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R40_FIELD_MODULUS = 257,
    R40_ADAPTER_PRIMITIVES = 6,
    R40_MAX_ADAPTER_CODE = 3,
    R40_MAX_ADAPTER_PROGRAMS = 320,
    R40_ALIGN_DIMENSIONS = 9,
    R40_ALIGN_QUERY_COUNT = R40_ALIGN_DIMENSIONS * R310_VECTOR_COUNT,
    R40_INITIAL_ALIGN_DEMOS = 1,
    R40_MAX_ALIGN_QUERIES = 16
};

typedef enum {
    R40_CONTROL_MODEL = 0,
    R40_CONTROL_ORACLE_ADAPTER = 1,
    R40_CONTROL_IDENTITY_ADAPTER = 2,
    R40_CONTROL_CURRICULUM_LOOKUP = 3,
    R40_CONTROL_NO_ADAPTER_QUERY = 4,
    R40_CONTROL_SHUFFLED_ALIGNMENT = 5
} R40Control;

typedef struct {
    uint32_t episodes;
    uint32_t target_adapters;
    uint32_t target_laws;
    uint32_t alignment_demonstrations;
    uint32_t adapter_queries;
    uint32_t exact_adapter_queries;
    uint32_t adapter_identifications;
    uint32_t exact_adapter_identifications;
    uint32_t replay_checks;
    uint32_t exact_replays;
    uint32_t law_demonstrations;
    uint32_t law_queries;
    uint32_t exact_law_queries;
    uint32_t law_identifications;
    uint32_t exact_law_identifications;
    uint32_t actions;
    uint32_t exact_actions;
    uint32_t commits;
    uint32_t exact_commits;
    uint32_t reports;
    uint32_t exact_reports;
    uint32_t premature_commits;
    uint32_t maximum_adapter_queries;
    uint32_t maximum_law_queries;
    uint8_t exact;
} R40Evaluation;

typedef struct {
    uint32_t raw_adapter_programs;
    uint32_t canonical_adapter_programs;
    uint32_t identity_adapters;
    uint32_t curriculum_adapters;
    uint32_t development_adapters;
    uint32_t sealed_adapters;
    uint32_t frozen_core_programs;
    uint32_t familiar_laws;
    uint32_t planned_sealed_episodes;
    uint8_t adapter_canonicalization_passed;
    uint8_t adapter_unique_minimum_passed;
    uint8_t adapter_grammar_certificate_passed;
    uint8_t frozen_core_certificate_passed;
    uint8_t oracle_adapter_control_passed;
    uint8_t identity_adapter_control_passed;
    uint8_t curriculum_lookup_control_passed;
    uint8_t no_adapter_query_control_passed;
    uint8_t shuffled_alignment_control_passed;
    R40Evaluation curriculum;
    R40Evaluation development;
    R40Evaluation sealed;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint8_t sealed_execution_locked;
    uint64_t result_digest;
} R40ExperimentReport;

R0Status r40_run_development(R40ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r40_run_sealed(R40ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r40_write_result(const R40ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
