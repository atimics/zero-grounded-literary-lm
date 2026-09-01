#ifndef REASONER41_H
#define REASONER41_H

#include "reasoner40.h"

#include <stddef.h>
#include <stdint.h>

typedef enum {
    R41_CONTROL_MODEL = 0,
    R41_CONTROL_ORACLE_ADAPTER = 1,
    R41_CONTROL_ORACLE_LAW = 2,
    R41_CONTROL_IDENTITY_ADAPTER = 3,
    R41_CONTROL_CURRICULUM_PAIR = 4,
    R41_CONTROL_NO_ADAPTER_QUERY = 5,
    R41_CONTROL_NO_LAW_QUERY = 6,
    R41_CONTROL_SHUFFLED_ALIGNMENT = 7,
    R41_CONTROL_SHUFFLED_LAW_FEEDBACK = 8
} R41Control;

typedef struct {
    uint32_t episodes;
    uint32_t target_adapters;
    uint32_t target_laws;
    uint32_t target_pairs;
    uint32_t alignment_demonstrations;
    uint32_t adapter_queries;
    uint32_t exact_adapter_queries;
    uint32_t adapter_identifications;
    uint32_t exact_adapter_identifications;
    uint32_t adapter_commits;
    uint32_t exact_adapter_commits;
    uint32_t premature_adapter_commits;
    uint32_t replay_checks;
    uint32_t exact_replays;
    uint32_t law_demonstrations;
    uint32_t law_queries;
    uint32_t exact_law_queries;
    uint32_t law_identifications;
    uint32_t exact_law_identifications;
    uint32_t law_commits;
    uint32_t exact_law_commits;
    uint32_t premature_law_commits;
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
} R41Evaluation;

typedef struct {
    uint32_t canonical_adapter_programs;
    uint32_t canonical_law_programs;
    uint32_t curriculum_adapters;
    uint32_t development_adapters;
    uint32_t sealed_adapters;
    uint32_t curriculum_laws;
    uint32_t development_laws;
    uint32_t sealed_laws;
    uint32_t development_pairs;
    uint32_t planned_sealed_pairs;
    uint32_t planned_sealed_episodes;
    uint8_t frozen_representation_core_passed;
    uint8_t frozen_law_core_passed;
    uint8_t separate_commit_certificate_passed;
    uint8_t oracle_adapter_control_passed;
    uint8_t oracle_law_control_passed;
    uint8_t identity_adapter_control_passed;
    uint8_t curriculum_pair_control_passed;
    uint8_t no_adapter_query_control_passed;
    uint8_t no_law_query_control_passed;
    uint8_t shuffled_alignment_control_passed;
    uint8_t shuffled_law_feedback_control_passed;
    R41Evaluation curriculum;
    R41Evaluation development;
    R41Evaluation sealed;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint8_t sealed_execution_locked;
    uint64_t result_digest;
} R41ExperimentReport;

R0Status r41_run_development(R41ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r41_run_sealed(R41ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r41_write_result(const R41ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
