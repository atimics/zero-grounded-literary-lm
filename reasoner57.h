#ifndef REASONER57_H
#define REASONER57_H

#include "reasoner56.h"

#include <stddef.h>
#include <stdint.h>

#define R57_INITIAL_READS 3u
#define R57_QUERY_BUDGET 4u
#define R57_MAX_QUERY_BUDGET 8u
#define R57_TOTAL_OBSERVATIONS (R57_INITIAL_READS + R57_MAX_QUERY_BUDGET)
#define R57_ACTIONS (R56_MODULUS * R56_SENSORS)
#define R57_POLICY_TRAIN_FAMILIES 48u
#define R57_SELECTOR_FAMILIES 12u
#define R57_CALIBRATION_FAMILIES 16u
#define R57_DEVELOPMENT_PROGRAM_FAMILIES 8u
#define R57_DEVELOPMENT_CORRUPTION_FAMILIES 8u
#define R57_NESTED_REPEATS 2u
#define R57_DEVELOPMENT_EPISODES \
    (R57_DEVELOPMENT_PROGRAM_FAMILIES * \
     R57_DEVELOPMENT_CORRUPTION_FAMILIES * R57_NESTED_REPEATS)
#define R57_DERANGEMENTS 31u
#define R57_BASE_ARMS 10u
#define R57_DEVELOPMENT_ARMS (R57_BASE_ARMS + R57_DERANGEMENTS)
#define R57_PROPOSAL_BUDGET 24u
#define R57_GLOBAL_CAP R56_SEMANTIC_CLASSES

#define R57_VERSION_BINS 4u
#define R57_MASS_BINS 4u
#define R57_DISAGREEMENT_BINS 4u
#define R57_RELIABILITY_BINS 3u
#define R57_REMAINING_BINS R57_MAX_QUERY_BUDGET
#define R57_ACTION_TYPE_BINS 3u
#define R57_POLICY_CELLS \
    (R57_VERSION_BINS * R57_MASS_BINS * R57_DISAGREEMENT_BINS * \
     R57_RELIABILITY_BINS * R57_REMAINING_BINS * \
     R57_ACTION_TYPE_BINS)

typedef struct {
    uint8_t input;
    uint8_t sensor;
} r57_action;

typedef struct {
    r57_action action;
    r56_public_observation response;
} r57_action_observation;

typedef struct {
    r56_ranker_view evidence;
    uint32_t allowed_action_count;
    r57_action allowed_actions[R57_ACTIONS];
    uint32_t action_history_count;
    r57_action_observation action_history[R57_MAX_QUERY_BUDGET];
    uint32_t remaining_budget;
    uint32_t version_space_size;
    uint32_t top_probability_ppm;
    uint32_t disagreement_ppm;
} r57_policy_view;

typedef struct {
    uint32_t version;
    uint64_t r56_artifact_digest;
    uint64_t training_seed;
    uint64_t training_receipt_digest;
    uint64_t calibration_receipt_digest;
    uint64_t selector_receipt_digest;
    uint64_t policy_digest;
    uint32_t training_families;
    uint32_t training_episodes;
    uint32_t logged_states;
    uint32_t labelled_actions;
    uint32_t fallback_cells;
    uint32_t selected_comparator;
    int32_t risk_mass_q20;
    uint32_t support[R57_POLICY_CELLS];
    uint32_t best[R57_POLICY_CELLS];
    int32_t score_q20[R57_POLICY_CELLS];
} r57_policy_artifact;

typedef enum {
    R57_SELECTOR_TRANSFERRED = 0,
    R57_SELECTOR_FIXED = 1,
    R57_SELECTOR_RANDOM = 2,
    R57_SELECTOR_MAX_DISAGREEMENT = 3,
    R57_SELECTOR_NOISY_GBS = 4,
    R57_SELECTOR_EC2 = 5,
    R57_SELECTOR_REPEAT_VOTE = 6,
    R57_SELECTOR_ORACLE = 7,
    R57_SELECTOR_SHUFFLED_00 = 8,
    R57_SELECTOR_SHUFFLED_30 = 38
} r57_selector;

typedef enum {
    R57_ARM_FULL = 0,
    R57_ARM_SOURCE_FREE = 1,
    R57_ARM_SOURCE_ABLATION = 2,
    R57_ARM_FIXED = 3,
    R57_ARM_RANDOM = 4,
    R57_ARM_MAX_DISAGREEMENT = 5,
    R57_ARM_NOISY_GBS = 6,
    R57_ARM_EC2 = 7,
    R57_ARM_REPEAT_VOTE = 8,
    R57_ARM_ORACLE = 9,
    R57_ARM_SHUFFLED_00 = 10,
    R57_ARM_SHUFFLED_30 = 40
} r57_arm;

typedef struct {
    uint64_t root_seed;
    uint32_t program_slot;
    uint32_t corruption_slot;
    uint32_t repeat;
    uint16_t truth_class;
    r56_corruption_family corruption;
} r57_episode;

typedef struct {
    r56_ranker_view final_view;
    r57_action_observation actions[R57_MAX_QUERY_BUDGET];
    uint32_t action_count;
    uint32_t policy_candidate_updates;
    uint32_t posterior_updates;
    uint32_t source_artifact_reads;
    uint32_t channel_artifact_reads;
    uint32_t policy_fallbacks;
    uint64_t action_history_digest;
    double truth_probability;
    double truth_cumulative_mass;
    uint32_t truth_rank;
    uint32_t candidate_set_size;
    uint32_t candidate_set_contains_truth;
    uint16_t proposals[R57_PROPOSAL_BUDGET];
    r56_search_result search;
} r57_episode_result;

typedef struct {
    uint32_t episodes;
    uint32_t trace_rows;
    uint32_t exact_rows;
    uint32_t invalid_first_rejections;
    uint32_t source_ablation_matches;
    uint32_t policy_training_families;
    uint32_t policy_training_episodes;
    uint32_t policy_logged_states;
    uint32_t policy_labelled_actions;
    uint32_t selector_families;
    uint32_t calibration_families;
    uint32_t development_program_families;
    uint32_t development_corruption_families;
    uint32_t nested_repeats;
    uint32_t selected_comparator;
    double selector_mean_cost[6];
    double full_mean_cost;
    double comparator_mean_cost;
    double oracle_mean_cost;
    double oracle_to_comparator_ratio;
    uint32_t oracle_headroom_passed;
    double secondary_full_mean_cost[4];
    double secondary_comparator_mean_cost[4];
    double evidence_oracle_mean_verifier_checks;
    double evidence_oracle_mean_exact_queries;
    double evidence_oracle_mean_total_cost;
    uint32_t policy_fallback_rows;
    uint32_t calibration_rows;
    uint32_t calibration_truth_covered;
    uint32_t calibration_candidate_set_total;
    int32_t risk_mass_q20;
    uint32_t proxy_audit_passed;
    uint32_t taint_audit_passed;
    uint32_t r56_readiness_bound;
    uint64_t r56_artifact_digest;
    uint64_t policy_artifact_digest;
    uint64_t trace_digest;
    uint64_t selector_receipt_digest;
    uint64_t calibration_receipt_digest;
} r57_development_result;

int r57_select_semantic_splits(const r56_universe *universe,
                               uint16_t training[R57_POLICY_TRAIN_FAMILIES],
                               uint16_t selector[R57_SELECTOR_FAMILIES],
                               uint16_t calibration[R57_CALIBRATION_FAMILIES],
                               uint16_t development[
                                   R57_DEVELOPMENT_PROGRAM_FAMILIES],
                               uint16_t *sealed, uint32_t *sealed_count);
int r57_validate_policy_view(const r57_policy_view *view);
int r57_build_policy(r57_policy_artifact *policy,
                     const r56_artifact *channel,
                     const r56_universe *universe);
int r57_run_episode(const r57_policy_artifact *policy,
                    const r56_artifact *channel,
                    const r56_universe *universe,
                    const r57_episode *episode, r57_selector selector,
                    r57_episode_result *result);

size_t r57_policy_serialized_size(void);
int r57_serialize_policy(const r57_policy_artifact *policy, uint8_t *bytes,
                         size_t capacity, size_t *written);
int r57_deserialize_policy(r57_policy_artifact *policy, const uint8_t *bytes,
                           size_t size);
int r57_write_policy(const char *path, const r57_policy_artifact *policy);
int r57_read_policy(const char *path, r57_policy_artifact *policy);

int r57_run_development(r57_development_result *result,
                        const char *trace_path, const char *policy_path,
                        const char *r56_artifact_path);
int r57_write_development_result(const char *path,
                                 const r57_development_result *result);
int r57_self_test(const char *r56_artifact_path);

#endif
