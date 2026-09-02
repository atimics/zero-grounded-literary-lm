#ifndef REASONER51_H
#define REASONER51_H

#include <stdint.h>

#define R51_LANES 3
#define R51_PRIMITIVES 8
#define R51_PROGRAM_LEN 3
#define R51_TARGETS 12
#define R51_TIE_ORDERS 2
#define R51_EPISODES (R51_TARGETS * R51_TIE_ORDERS)
#define R51_CANDIDATES (R51_PRIMITIVES * R51_PRIMITIVES * R51_PRIMITIVES)

typedef struct {
    uint32_t matrix[R51_LANES * R51_LANES];
    uint32_t bias[R51_LANES];
} r51_affine;

typedef struct {
    uint32_t position_count[R51_PROGRAM_LEN][6];
    uint32_t transition_count[6][6];
    uint64_t source_digest;
} r51_artifact;

typedef struct {
    uint32_t source_programs;
    uint32_t target_programs;
    uint32_t episodes;
    uint32_t candidate_programs_per_episode;
    uint32_t adapter_reconstruction_queries;
    uint32_t adapter_challenge_queries;
    uint32_t adapter_checks_passed;
    uint32_t full_expansions;
    uint32_t oracle_expansions;
    uint32_t target_only_expansions;
    uint32_t identity_adapter_expansions;
    uint32_t shuffled_adapter_expansions;
    uint32_t no_query_adapter_expansions;
    uint32_t token_id_lookup_expansions;
    uint32_t source_ablation_expansions;
    uint32_t full_exact_matches;
    uint32_t oracle_exact_matches;
    uint32_t individual_wins_vs_target_only;
    uint32_t unverified_top_candidates;
    uint32_t premature_commits;
    uint32_t full_max_expansions;
    uint32_t target_only_max_expansions;
    uint32_t adapter_verified;
    uint32_t artifact_frozen_before_target;
    uint32_t verifier_authoritative;
    uint32_t source_ablation_control_valid;
    uint32_t gate_pass;
    uint64_t artifact_digest;
    uint64_t result_digest;
} r51_result;

int r51_self_test(void);
int r51_execute(r51_result *result, r51_artifact *artifact);
int r51_write_result_json(const char *path, const r51_result *result);
int r51_write_artifact(const char *path, const r51_artifact *artifact);

#endif
