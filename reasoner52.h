#ifndef REASONER52_H
#define REASONER52_H

#include <stdint.h>

#define R52_MODULUS 17u
#define R52_PRIMITIVES 8u
#define R52_SOURCE_PROGRAMS 16u
#define R52_TARGETS 12u
#define R52_TIE_ORDERS 2u
#define R52_EPISODES (R52_TARGETS * R52_TIE_ORDERS)
#define R52_CANDIDATES (R52_PRIMITIVES * R52_PRIMITIVES * R52_PRIMITIVES)

typedef struct {
    uint32_t class_count[6];
    uint32_t transition_count[6][6];
    uint64_t source_digest;
} r52_artifact;

typedef struct {
    uint32_t source_programs;
    uint32_t target_programs;
    uint32_t episodes;
    uint32_t candidates_per_episode;
    uint32_t exact_domain_points;
    uint32_t full_expansions;
    uint32_t oracle_expansions;
    uint32_t target_only_expansions;
    uint32_t affine_projection_expansions;
    uint32_t degree_blind_expansions;
    uint32_t shuffled_source_expansions;
    uint32_t source_only_expansions;
    uint32_t source_ablation_expansions;
    uint32_t full_exact_matches;
    uint32_t oracle_exact_matches;
    uint32_t full_truth_table_checks;
    uint32_t individual_wins_vs_target_only;
    uint32_t unverified_top_candidates;
    uint32_t nonlinear_target_episodes;
    uint32_t premature_commits;
    uint32_t artifact_frozen_before_target;
    uint32_t exact_truth_table_authoritative;
    uint32_t source_ablation_control_valid;
    uint32_t gate_pass;
    uint64_t artifact_digest;
    uint64_t result_digest;
} r52_result;

int r52_self_test(void);
int r52_execute(r52_result *result, r52_artifact *artifact);
int r52_write_result_json(const char *path, const r52_result *result);
int r52_write_artifact(const char *path, const r52_artifact *artifact);

#endif
