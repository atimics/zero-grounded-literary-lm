#ifndef REASONER55_H
#define REASONER55_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

enum {
    R55_MODULUS = 5,
    R55_LANES = 3,
    R55_ROLES = 8,
    R55_PRIMITIVES = 8,
    R55_PROGRAM_LEN = 4,
    R55_CANDIDATES = 4096,
    R55_DOMAIN_POINTS = 125,
    R55_GENERATORS = 2,
    R55_SOURCE_FAMILIES = 64,
    R55_DEVELOPMENT_FAMILIES = 4,
    R55_TIE_REPEATS = 2,
    R55_DERANGEMENTS = 31,
    R55_BASE_ARMS = 9,
    R55_ARMS = R55_BASE_ARMS + R55_DERANGEMENTS,
    R55_PROPOSAL_BUDGET = 64,
    R55_GLOBAL_CAP = R55_CANDIDATES,
    R55_TOTAL_FAMILIES = R55_GENERATORS *
        (R55_SOURCE_FAMILIES + R55_DEVELOPMENT_FAMILIES),
    R55_GUIDE_POSITION_CELLS = R55_PROGRAM_LEN * R55_ROLES,
    R55_GUIDE_TRANSITION_CELLS =
        (R55_PROGRAM_LEN - 1) * R55_ROLES * R55_ROLES,
    R55_CANONICAL_GUIDE_BYTES =
        1 + 4 + 4 +
        4 * (R55_GUIDE_POSITION_CELLS + R55_GUIDE_TRANSITION_CELLS),
    R55_ARTIFACT_MAX_BYTES = 4096
};

typedef enum {
    R55_ROLE_AXIS_TRANSLATION = 0,
    R55_ROLE_DENSE_TRANSLATION = 1,
    R55_ROLE_AXIS_SCALE = 2,
    R55_ROLE_DENSE_SCALE = 3,
    R55_ROLE_PERMUTATION = 4,
    R55_ROLE_SHEAR = 5,
    R55_ROLE_LINEAR_MIX = 6,
    R55_ROLE_AFFINE_MIX = 7
} r55_role;

typedef enum {
    R55_GENERATOR_SYNTAX_FIRST = 0,
    R55_GENERATOR_SKELETON_FIRST = 1
} r55_generator;

typedef enum {
    R55_ARM_TARGET_ONLY = 0,
    R55_ARM_ADAPTER_ONLY = 1,
    R55_ARM_RAW_LEXICAL = 2,
    R55_ARM_FULL = 3,
    R55_ARM_ORACLE_ADAPTER = 4,
    R55_ARM_FREQUENCY_LEXICAL = 5,
    R55_ARM_SOURCE_FREE_JIT = 6,
    R55_ARM_SOURCE_ABLATION = 7,
    R55_ARM_SOURCE_ONLY = 8
} r55_base_arm;

typedef struct {
    uint8_t matrix[R55_LANES * R55_LANES];
    uint8_t bias[R55_LANES];
} r55_affine;

typedef struct {
    uint32_t position_count[R55_PROGRAM_LEN][R55_ROLES];
    uint32_t transition_count[R55_PROGRAM_LEN - 1][R55_ROLES][R55_ROLES];
    uint32_t source_families;
    uint32_t source_solutions;
    uint8_t generator_id;
} r55_guide;

typedef struct {
    r55_guide guides[R55_GENERATORS];
    uint8_t digest[32];
    size_t canonical_bytes;
} r55_artifact;

typedef struct {
    uint64_t primary_cost;
    uint64_t verifier_checks;
    uint64_t partial_expansions;
    uint64_t exact_answers;
    uint64_t fallback_episodes;
    uint64_t global_cap_hits;
    uint64_t invalid_first_rejected;
} r55_arm_summary;

typedef struct {
    uint8_t lane;
    uint8_t generator_id;
    uint32_t ordinal;
    uint8_t ast_sha256[32];
    uint8_t behavior_sha256[32];
} r55_family_receipt;

typedef struct {
    uint32_t source_families;
    uint32_t development_families;
    uint32_t generator_environments;
    uint32_t episodes;
    uint32_t trace_rows;
    uint32_t adapter_reconstructions;
    uint32_t adapter_exact;
    uint32_t adapter_domain_checks;
    uint32_t generator_sequence_differences;
    uint32_t semantic_collisions;
    uint32_t source_ablation_matches;
    uint32_t source_ablation_cases;
    uint32_t full_oracle_matches;
    uint32_t full_oracle_cases;
    uint32_t family_receipt_count;
    uint32_t target_only_median_cost;
    uint32_t target_only_minimum_cost;
    uint32_t target_only_maximum_cost;
    uint8_t artifact_sha256[32];
    uint8_t trace_sha256[32];
    r55_family_receipt family_receipts[R55_TOTAL_FAMILIES];
    r55_arm_summary arms[R55_ARMS];
} r55_development_result;

const char *r55_arm_name(uint32_t arm, char buffer[24]);
const char *r55_generator_name(uint32_t generator);
int r55_self_test(void);
int r55_run_development(r55_development_result *result,
                        r55_artifact *artifact, FILE *trace);
int r55_write_development_json(const char *path,
                               const r55_development_result *result);
int r55_write_artifact_hex(const char *path, const r55_artifact *artifact);

#endif
