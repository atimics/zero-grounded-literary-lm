#ifndef REASONER58_H
#define REASONER58_H

#include <stddef.h>
#include <stdint.h>

enum {
    R58_MODULUS = 17,
    R58_OPERATIONS = 8,
    R58_SOURCE_MAX_DEPTH = 2,
    R58_TARGET_MAX_DEPTH = 3,
    R58_SYNTAX_PROGRAMS = 585,
    R58_MAX_SEMANTIC_CLASSES = R58_SYNTAX_PROGRAMS,
    R58_FEATURE_CELLS = 116,
    R58_TRANSITION_CELLS = 72,
    R58_RAW_TOKEN_CELLS = 24,
    R58_SOURCE_TASKS_PER_GENERATOR = 32,
    R58_GENERATORS = 2,
    R58_ARTIFACT_MAX_BYTES = 4096
};

typedef enum {
    R58_OP_TRANSLATE_1 = 0,
    R58_OP_TRANSLATE_4 = 1,
    R58_OP_SCALE_2 = 2,
    R58_OP_SCALE_3 = 3,
    R58_OP_NEGATE = 4,
    R58_OP_SQUARE = 5,
    R58_OP_CUBE = 6,
    R58_OP_MIXED = 7
} r58_operation;

typedef struct {
    uint8_t length;
    uint8_t operations[R58_TARGET_MAX_DEPTH];
} r58_program;

typedef struct {
    uint8_t values[R58_MODULUS];
} r58_behavior;

typedef struct {
    r58_program canonical_program;
    r58_behavior behavior;
} r58_semantic_class;

typedef struct {
    uint32_t syntax_programs;
    uint32_t semantic_classes;
    uint32_t semantic_collisions;
    uint32_t classes_by_depth[R58_TARGET_MAX_DEPTH + 1];
    r58_semantic_class classes[R58_MAX_SEMANTIC_CLASSES];
} r58_universe;

typedef struct {
    uint32_t positive_labels;
    uint32_t negative_labels;
    uint32_t feature_positive[R58_FEATURE_CELLS];
    uint32_t feature_negative[R58_FEATURE_CELLS];
    int32_t feature_log_odds_q20[R58_FEATURE_CELLS];
    uint32_t transition_positive[R58_TRANSITION_CELLS];
    uint32_t transition_negative[R58_TRANSITION_CELLS];
    int32_t transition_log_odds_q20[R58_TRANSITION_CELLS];
    uint32_t raw_token_positive[R58_RAW_TOKEN_CELLS];
    uint32_t raw_token_negative[R58_RAW_TOKEN_CELLS];
    int32_t raw_token_log_odds_q20[R58_RAW_TOKEN_CELLS];
} r58_guide;

typedef struct {
    uint8_t bytes[R58_ARTIFACT_MAX_BYTES];
    size_t size;
    uint8_t sha256[32];
    r58_guide guide;
} r58_artifact;

typedef struct {
    uint32_t syntax_programs;
    uint32_t semantic_classes;
    uint32_t semantic_collisions;
    uint32_t nonlinear_classes;
    uint32_t source_tasks;
    uint32_t positive_labels;
    uint32_t negative_labels;
    uint32_t exact_verifier_checks;
    uint32_t artifact_bytes;
    uint8_t universe_sha256[32];
    uint8_t artifact_sha256[32];
} r58_development_summary;

const char *r58_operation_name(uint8_t operation);
uint8_t r58_apply_operation(uint8_t operation, uint8_t value);
void r58_execute_program(const r58_program *program, r58_behavior *behavior);
int r58_enumerate_universe(r58_universe *universe);
int r58_verify_exact(const r58_program *program, const r58_behavior *expected,
                     uint8_t *first_counterexample);
int r58_build_source_artifact(const r58_universe *universe,
                              r58_artifact *artifact);
int64_t r58_score_program(const r58_program *program,
                          const r58_behavior *behavior,
                          const r58_guide *guide, uint32_t mode,
                          uint32_t derangement);
int r58_parse_artifact(const uint8_t *bytes, size_t size,
                       r58_artifact *artifact);
int r58_write_artifact_hex(const char *path, const r58_artifact *artifact);
int r58_write_development_json(const char *path,
                               const r58_development_summary *summary);
int r58_run_development(r58_development_summary *summary,
                        r58_artifact *artifact);
int r58_self_test(void);

#endif
