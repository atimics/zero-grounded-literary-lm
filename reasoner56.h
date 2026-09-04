#ifndef REASONER56_H
#define REASONER56_H

#include <stddef.h>
#include <stdint.h>

#define R56_MODULUS 17u
#define R56_PRIMITIVES 8u
#define R56_PROGRAM_DEPTH 3u
#define R56_SYNTAX_PROGRAMS 512u
#define R56_SEMANTIC_CLASSES 427u
#define R56_SENSORS 3u
#define R56_CHANNEL_STATES 18u
#define R56_MAX_OBSERVATIONS 51u
#define R56_SUPPORT_MIN 32u
#define R56_TEMPERATURES 6u
#define R56_Q20_ONE INT32_C(1048576)
#define R56_CALIBRATION_FIT_FAMILIES 16u
#define R56_CALIBRATION_COVERAGE_FAMILIES 99u
#define R56_CALIBRATION_DRAWS 8u

#define R56_LOCAL_EXACT_CONTEXTS \
    (R56_SENSORS * R56_MODULUS * R56_MODULUS)
#define R56_LOCAL_VALUE_CONTEXTS (R56_SENSORS * R56_MODULUS)
#define R56_LOCAL_SENSOR_CONTEXTS R56_SENSORS
#define R56_TRANSITION_EXACT_CONTEXTS \
    (R56_SENSORS * R56_SENSORS * R56_CHANNEL_STATES)
#define R56_TRANSITION_CURRENT_CONTEXTS \
    (R56_SENSORS * R56_CHANNEL_STATES)
#define R56_TRANSITION_PREVIOUS_CONTEXTS R56_CHANNEL_STATES

typedef struct {
    uint8_t token[R56_PROGRAM_DEPTH];
    uint8_t table[R56_MODULUS];
} r56_syntax_program;

typedef struct {
    uint8_t representative[R56_PROGRAM_DEPTH];
    uint8_t table[R56_MODULUS];
    uint16_t multiplicity;
} r56_semantic_class;

typedef struct {
    r56_syntax_program syntax[R56_SYNTAX_PROGRAMS];
    r56_semantic_class semantic[R56_SEMANTIC_CLASSES];
    uint16_t syntax_to_semantic[R56_SYNTAX_PROGRAMS];
    uint32_t syntax_count;
    uint32_t semantic_count;
} r56_universe;

typedef struct {
    uint8_t template_id;
    uint8_t severity;
    uint8_t direction;
    uint8_t location;
    uint8_t block_length;
} r56_corruption_family;

typedef struct {
    uint8_t input;
    uint8_t sensor;
    uint8_t observed;
    uint8_t missing;
} r56_public_observation;

typedef struct {
    uint32_t observation_count;
    r56_public_observation observations[R56_MAX_OBSERVATIONS];
} r56_ranker_view;

typedef enum {
    R56_NODE_OBJECT = 1,
    R56_NODE_ARRAY = 2,
    R56_NODE_U8 = 3,
    R56_NODE_BOOL = 4
} r56_public_node_type;

typedef struct r56_public_node {
    const char *name;
    r56_public_node_type type;
    uint32_t child_count;
    const struct r56_public_node *children;
    uint32_t value;
} r56_public_node;

typedef enum {
    R56_BACKOFF_EXACT = 0,
    R56_BACKOFF_VALUE = 1,
    R56_BACKOFF_SENSOR = 2,
    R56_BACKOFF_GLOBAL = 3
} r56_local_backoff;

typedef enum {
    R56_TRANSITION_EXACT = 0,
    R56_TRANSITION_CURRENT = 1,
    R56_TRANSITION_PREVIOUS = 2,
    R56_TRANSITION_GLOBAL = 3
} r56_transition_backoff;

typedef enum {
    R56_ARM_FULL = 0,
    R56_ARM_ROBUST_HAMMING = 1,
    R56_ARM_TARGET_ONLY = 2,
    R56_ARM_SOURCE_FREE = 3,
    R56_ARM_SOURCE_ABLATION = 4,
    R56_ARM_ONE_TRIM = 5,
    R56_ARM_MARKOV_OFF = 6,
    R56_ARM_SHUFFLED_SENSOR = 7,
    R56_ARM_VALUE_ONLY = 8,
    R56_ARM_MASK_ONLY = 9,
    R56_ARM_CHANNEL_ONLY = 10,
    R56_ARM_PROGRAM_PRIOR_ONLY = 11,
    R56_ARM_ORACLE_CHANNEL = 12,
    R56_ARM_CLEAN_ORACLE = 13,
    R56_ARM_DERANGEMENT_00 = 14,
    R56_ARM_DERANGEMENT_30 = 44
} r56_arm;

#define R56_DERANGEMENT_COUNT 31u

typedef struct {
    uint32_t version;
    uint64_t source_seed;
    uint64_t corruption_seed;
    uint64_t source_program_digest;
    uint64_t corruption_generator_digest;
    uint64_t calibration_fit_digest;
    uint64_t calibration_coverage_digest;
    uint64_t artifact_digest;
    uint32_t source_programs;
    uint32_t source_samples;
    uint32_t calibration_fit_episodes;
    uint32_t calibration_coverage_episodes;
    uint32_t temperature_index;
    int32_t temperature_q20;
    int32_t conformal_mass_q20;

    uint32_t class_prior[R56_SEMANTIC_CLASSES];
    int32_t class_log_q20[R56_SEMANTIC_CLASSES];

    uint32_t local_exact_support[R56_LOCAL_EXACT_CONTEXTS];
    uint32_t local_exact_count[R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES];
    int32_t local_exact_log_q20[R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t local_value_support[R56_LOCAL_VALUE_CONTEXTS];
    uint32_t local_value_count[R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES];
    int32_t local_value_log_q20[R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t local_sensor_support[R56_LOCAL_SENSOR_CONTEXTS];
    uint32_t local_sensor_count[R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES];
    int32_t local_sensor_log_q20[R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t local_global_support;
    uint32_t local_global_count[R56_CHANNEL_STATES];
    int32_t local_global_log_q20[R56_CHANNEL_STATES];

    uint32_t initial_support[R56_SENSORS];
    uint32_t initial_count[R56_SENSORS * R56_CHANNEL_STATES];
    int32_t initial_log_q20[R56_SENSORS * R56_CHANNEL_STATES];

    uint32_t transition_exact_support[R56_TRANSITION_EXACT_CONTEXTS];
    uint32_t transition_exact_count[
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES];
    int32_t transition_exact_log_q20[
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t transition_current_support[R56_TRANSITION_CURRENT_CONTEXTS];
    uint32_t transition_current_count[
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES];
    int32_t transition_current_log_q20[
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t transition_previous_support[R56_TRANSITION_PREVIOUS_CONTEXTS];
    uint32_t transition_previous_count[
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES];
    int32_t transition_previous_log_q20[
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES];
    uint32_t transition_global_support;
    uint32_t transition_global_count[R56_CHANNEL_STATES];
    int32_t transition_global_log_q20[R56_CHANNEL_STATES];
} r56_artifact;

typedef struct {
    uint32_t checked_points;
    uint16_t semantic_class;
    uint64_t table_digest;
    uint32_t valid;
} r56_certificate;

typedef struct {
    uint32_t solved;
    uint32_t accepted_class;
    uint32_t verifier_checks;
    uint32_t proposal_verifier_checks;
    uint32_t fallback_verifier_checks;
    uint32_t partial_expansions;
    uint32_t fallback_partial_expansions;
    uint32_t fallback_started;
    uint32_t global_cap_hit;
    uint32_t fallback_exhausted;
    uint32_t primary_cost;
    uint32_t invalid_first_rejected;
    uint32_t certificate_valid;
} r56_search_result;

typedef struct {
    uint32_t episodes;
    uint32_t trace_rows;
    uint32_t exact_rows;
    uint32_t normalized_rows;
    uint32_t source_ablation_matches;
    uint32_t fallback_rows;
    uint32_t invalid_first_rejections;
    uint32_t artifact_roundtrip_valid;
    uint32_t hidden_field_rejections;
    uint32_t temperature_index;
    int32_t temperature_q20;
    int32_t conformal_mass_q20;
    uint32_t calibration_fit_episodes;
    uint32_t calibration_coverage_episodes;
    uint32_t candidate_set_rows;
    uint32_t candidate_set_truth_covered;
    uint32_t candidate_set_total_size;
    uint32_t source_semantic_classes;
    uint32_t calibration_fit_families;
    uint32_t calibration_coverage_families;
    uint32_t development_program_families;
    uint32_t development_corruption_families;
    uint32_t nested_repeats;
    uint32_t split_rejections;
    uint32_t proxy_audit_passed;
    uint32_t taint_audit_passed;
    uint32_t target_only_min_cost;
    uint32_t target_only_max_cost;
    double target_only_median_cost;
    double full_mean_normalized_log_loss;
    double full_mean_brier;
    uint32_t development_class_count;
    uint16_t development_classes[16];
    uint32_t calibration_coverage_record_count;
    uint16_t calibration_coverage_classes[
        R56_CALIBRATION_COVERAGE_FAMILIES];
    uint32_t calibration_coverage_worst_mass_q20[
        R56_CALIBRATION_COVERAGE_FAMILIES];
    uint32_t calibration_coverage_family_covered[
        R56_CALIBRATION_COVERAGE_FAMILIES];
    uint64_t artifact_digest;
    uint64_t trace_digest;
    uint64_t calibration_fit_digest;
    uint64_t calibration_coverage_digest;
} r56_development_result;

int r56_build_universe(r56_universe *universe);
void r56_generate_source_program(uint64_t seed, uint32_t index,
                                 uint8_t token[R56_PROGRAM_DEPTH]);
void r56_generate_corruption_family(uint64_t seed, uint32_t index,
                                    r56_corruption_family *family);
int r56_build_artifact(r56_artifact *artifact, const r56_universe *universe,
                       uint64_t source_seed, uint64_t corruption_seed);
int32_t r56_log_probability_q20(uint32_t count, uint32_t total,
                                uint32_t outcomes);
r56_local_backoff r56_local_backoff_level(const r56_artifact *artifact,
                                           uint8_t sensor, uint8_t input,
                                           uint8_t candidate_value);
r56_transition_backoff r56_transition_backoff_level(
    const r56_artifact *artifact, uint8_t previous_sensor,
    uint8_t current_sensor, uint8_t previous_state);
int r56_validate_ranker_tree(const r56_public_node *root);
int r56_posterior(const r56_artifact *artifact, const r56_universe *universe,
                  const r56_ranker_view *view, r56_arm arm,
                  double probability[R56_SEMANTIC_CLASSES],
                  int64_t score_q20[R56_SEMANTIC_CLASSES],
                  uint32_t *source_artifact_reads);
int r56_calibrate(r56_artifact *artifact, const r56_universe *universe,
                  const r56_ranker_view *fit_views,
                  const uint16_t *fit_truth, uint32_t fit_family_count,
                  const r56_ranker_view *coverage_views,
                  const uint16_t *coverage_truth,
                  uint32_t coverage_family_count,
                  uint32_t draws_per_family);
uint32_t r56_candidate_set(const double probability[R56_SEMANTIC_CLASSES],
                           double cumulative_threshold,
                           uint8_t included[R56_SEMANTIC_CLASSES]);
int r56_verify_semantic_class(const r56_universe *universe,
                              uint16_t semantic_class,
                              const uint8_t target[R56_MODULUS],
                              r56_certificate *certificate);
int r56_verified_search(const r56_universe *universe,
                        const uint8_t target[R56_MODULUS],
                        const uint16_t *proposals, uint32_t proposal_count,
                        uint32_t global_cap, uint16_t injected_invalid,
                        r56_search_result *result);

size_t r56_artifact_serialized_size(void);
int r56_serialize_artifact(const r56_artifact *artifact, uint8_t *bytes,
                           size_t capacity, size_t *written);
int r56_deserialize_artifact(r56_artifact *artifact, const uint8_t *bytes,
                             size_t size);
int r56_write_artifact(const char *path, const r56_artifact *artifact);
int r56_read_artifact(const char *path, r56_artifact *artifact);

int r56_run_development(r56_development_result *result,
                        const char *trace_path, const char *artifact_path);
int r56_write_development_result(const char *path,
                                 const r56_development_result *result);
int r56_self_test(void);

#endif
