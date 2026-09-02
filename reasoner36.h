#ifndef REASONER36_H
#define REASONER36_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R36_FEATURE_COUNT = 16,
    R36_POLICY_BYTES = R36_FEATURE_COUNT * (int)sizeof(int32_t),
    R36_DOMAIN_COUNT = 3,
    R36_MAX_CANDIDATES = 5,
    R36_MAX_STAGES = 7,
    R36_MAX_CALLS = R36_MAX_CANDIDATES * 2 + 1,
    R36_MAX_EPOCHS = 512
};

typedef enum {
    R36_TOOL_QUERY = 1,
    R36_TOOL_APPLY = 2,
    R36_TOOL_COMMIT = 3
} R36Tool;

typedef struct {
    uint8_t valid;
    int8_t progress;
    uint8_t remaining;
    uint8_t cost;
    uint8_t reversal;
} R36ToolReply;

typedef struct {
    R36Tool tool;
    uint8_t argument;
} R36Call;

typedef struct {
    int32_t weights[R36_FEATURE_COUNT];
} R36Model;

typedef struct {
    uint32_t episodes;
    uint32_t mixed_episodes;
    uint32_t decisions;
    uint32_t exact_decisions;
    uint32_t queries;
    uint32_t applies;
    uint32_t commits;
    uint32_t handle_permutations;
    uint32_t handle_permutations_exact;
    uint8_t exact;
} R36Evaluation;

typedef struct {
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t training_errors;
    int32_t weights[R36_FEATURE_COUNT];
    R36Evaluation development;
    R36Evaluation sealed;
    uint8_t routed_control_passed;
    uint8_t zero_control_passed;
    uint8_t shuffled_feedback_passed;
    uint32_t shared_policy_bytes;
    uint32_t routed_control_bytes;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R36ExperimentReport;

enum {
    R36_TRACE_TRAINING = 0,
    R36_TRACE_DEVELOPMENT = 1,
    R36_TRACE_SEALED = 2
};

typedef struct {
    uint32_t episode_id;
    uint8_t mixed_episode;
    uint8_t stage;
    uint8_t candidate_count;
    R36Call call;
    R36ToolReply reply;
    uint8_t complete;
} R36TraceEvent;

typedef struct {
    uint32_t episodes;
    uint32_t mixed_episodes;
    uint32_t events;
    uint8_t exact;
} R36TraceSummary;

typedef R0Status (*R36TraceVisitor)(const R36TraceEvent *event,
                                    void *context, char *error,
                                    size_t error_capacity);

R0Status r36_run_development(R36ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r36_run_sealed(R36ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r36_write_result(const R36ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);
R0Status r36_visit_traces(const int32_t weights[R36_FEATURE_COUNT],
                          uint8_t suite, R36TraceVisitor visitor,
                          void *context, R36TraceSummary *summary,
                          char *error, size_t error_capacity);

#endif
