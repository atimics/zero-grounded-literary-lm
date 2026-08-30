#ifndef REASONER34_H
#define REASONER34_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R34_MAX_VARIABLES = 5,
    R34_MAX_EDGES = 4,
    R34_RELATIONS_PER_EDGE = 6,
    R34_MAX_ACTIONS = 24,
    R34_DOMAIN_MIN = -2,
    R34_DOMAIN_MAX = 2,
    R34_FEATURE_COUNT = 16,
    R34_MAX_CASES = 2048,
    R34_MAX_EPOCHS = 32,
    R34_MAX_STEPS = 8
};

enum {
    R34_WITNESS_VALID = 0,
    R34_WITNESS_POSITIVE = 1,
    R34_WITNESS_NEGATIVE = 2
};

enum {
    R34_FEEDBACK_FULL = 0,
    R34_FEEDBACK_WITNESS_MASKED = 1,
    R34_FEEDBACK_TOOL_ONLY = 2,
    R34_FEEDBACK_HASH = 3
};

enum {
    R34_GRAPH_PATH2 = 0,
    R34_GRAPH_PATH3 = 1,
    R34_GRAPH_PATH4 = 2,
    R34_GRAPH_STAR4 = 3,
    R34_GRAPH_PATH5 = 4,
    R34_GRAPH_STAR5 = 5,
    R34_GRAPH_FORK5 = 6
};

typedef struct {
    uint8_t variables;
    uint8_t edges;
    uint8_t u[R34_MAX_EDGES];
    uint8_t v[R34_MAX_EDGES];
} R34Graph;

typedef struct {
    int8_t values[R34_MAX_VARIABLES];
} R34State;

typedef struct {
    uint8_t kind;
    R34State source;
    R34State target;
} R34Witness;

typedef struct {
    uint8_t accepted;
    R34Witness witness;
} R34Verification;

typedef struct {
    int32_t weights[R34_FEATURE_COUNT];
} R34Model;

typedef struct {
    uint32_t cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint32_t nonzero_weights;
    uint32_t active_weight_bytes;
    uint32_t hash_mistakes;
    uint32_t hash_final_errors;
} R34TrainingReport;

typedef struct {
    uint32_t graphs;
    uint32_t programs;
    uint32_t solved;
    uint32_t minimal;
    uint32_t failed;
    uint32_t verifier_calls;
    uint32_t excess_edits;
    uint64_t relabeling_cases;
    uint64_t relabeling_exact;
    uint8_t exact;
} R34Evaluation;

typedef struct {
    R34TrainingReport training;
    R34Evaluation development_semantic;
    R34Evaluation development_hash;
    R34Evaluation semantic;
    R34Evaluation hash_control;
    R34Evaluation witness_masked;
    R34Evaluation tool_only;
    int32_t semantic_weights[R34_FEATURE_COUNT];
    int32_t hash_weights[R34_FEATURE_COUNT];
    uint32_t semantic_active_weight_bytes;
    uint32_t hash_active_weight_bytes;
    uint64_t result_digest;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
} R34ExperimentReport;

R0Status r34_graph(uint8_t graph_id, R34Graph *graph);
uint32_t r34_program_count(const R34Graph *graph);
R0Status r34_train(R34Model *semantic, R34Model *hash,
                   R34TrainingReport *report, char *error,
                   size_t error_capacity);
R0Status r34_verify_exact(const R34Graph *graph, uint32_t target,
                          uint32_t candidate,
                          R34Verification *verification);
R0Status r34_evaluate_development(const R34Model *semantic,
                                  const R34Model *hash,
                                  R34Evaluation *semantic_report,
                                  R34Evaluation *hash_report,
                                  char *error, size_t error_capacity);
R0Status r34_run_sealed(R34ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r34_write_result(const R34ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);
int r34_self_test(char *error, size_t error_capacity);

#endif
