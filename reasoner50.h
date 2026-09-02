#ifndef REASONER50_H
#define REASONER50_H

#include "reasoner42.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R50_FEATURES = 92,
    R50_SOURCE_PROGRAMS = 7,
    R50_TARGET_PROGRAMS = 17,
    R50_CALIBRATION_PROGRAMS = 5,
    R50_HELD_OUT_PROGRAMS = 12,
    R50_EVIDENCE_ORDERS = 2,
    R50_HELD_OUT_EPISODES = 24,
    R50_MAX_EXPANSIONS = 128,
    R50_ARTIFACT_BYTES = R50_FEATURES * 4
};

typedef struct {
    uint32_t episodes;
    uint64_t expansions;
    uint32_t maximum_expansions;
    uint32_t over_budget;
} R50SearchMetrics;

typedef struct {
    uint32_t source_programs;
    uint32_t calibration_programs;
    uint32_t held_out_programs;
    uint32_t raw_candidate_programs;
    uint32_t canonical_candidate_programs;
    uint32_t feature_slots;
    uint32_t artifact_bytes;
    char source_artifact_sha256[65];
    uint64_t frozen_library_digest;
    R50SearchMetrics full;
    R50SearchMetrics target_only;
    R50SearchMetrics source_only;
    R50SearchMetrics source_ablation;
    R50SearchMetrics shuffled_source;
    R50SearchMetrics runtime_mismatch;
    R50SearchMetrics oracle;
    uint32_t exact_identifications;
    uint32_t affine_replay_checks;
    uint32_t exact_affine_replays;
    uint32_t applications;
    uint32_t exact_applications;
    uint32_t reports;
    uint32_t exact_reports;
    uint32_t premature_commits;
    uint32_t individual_wins_over_target_only;
    uint32_t invalid_unverified_top_candidates;
    uint8_t source_artifact_frozen;
    uint8_t deployment_exact_score_passed;
    uint8_t verifier_authority_passed;
    uint8_t source_ablation_control_passed;
    uint8_t gate_passed;
    uint64_t result_digest;
} R50ExperimentReport;

R0Status r50_run_preflight(char *error, size_t error_capacity);
R0Status r50_run_experiment(R50ExperimentReport *report,
                            int32_t source_artifact[R50_FEATURES],
                            char *error, size_t error_capacity);
R0Status r50_write_artifact(
    const int32_t source_artifact[R50_FEATURES], const char *path,
    char *error, size_t error_capacity);
R0Status r50_write_result(const R50ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
