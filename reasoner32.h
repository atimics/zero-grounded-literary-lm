#ifndef REASONER32_H
#define REASONER32_H

#include "reasoner31.h"

#include <stddef.h>
#include <stdint.h>

#define R32_REFERENCE_BEHAVIOR_DIGEST UINT64_C(10102303818332127890)
#define R32_REFERENCE_TRACE_DIGEST UINT64_C(15168629444267673465)

enum {
    R32_MAX_WEIGHTS = 256,
    R32_MAX_ARTIFACT_BYTES = 1024,
    R32_ARTIFACT_HEADER_BYTES = 36,
    R32_DENSE_ARTIFACT_BYTES =
        28 + R31_FEATURE_COUNT * (int)sizeof(int32_t)
};

typedef struct {
    uint32_t indices[R32_MAX_WEIGHTS];
    int8_t values[R32_MAX_WEIGHTS];
    uint16_t count;
    uint8_t trained_stage;
    uint8_t evaluated_stage;
    uint8_t sealed_test_passed;
    uint64_t behavior_digest;
    uint64_t trace_digest;
} R32Model;

typedef struct {
    uint32_t dense_artifact_bytes;
    uint32_t sparse_artifact_bytes;
    uint32_t runtime_weight_bytes;
    uint32_t dense_weight_count;
    uint32_t source_nonzero_weights;
    uint32_t retained_weights;
    uint32_t pruned_weights;
    uint32_t zero_weights;
    uint32_t distinct_nonzero_values;
    int8_t minimum_weight;
    int8_t maximum_weight;
    uint32_t compression_milli;
    uint32_t world_pairs;
    uint32_t accepted_pairs;
    uint32_t rejected_pairs;
    uint32_t actionable_pairs;
    uint32_t actionless_pairs;
    uint32_t canonical_contexts;
    uint32_t action_mismatches;
    uint32_t trace_programs;
    uint32_t trace_steps;
    uint32_t trace_mismatches;
    uint32_t seal_mismatches;
    uint64_t dense_behavior_digest;
    uint64_t sparse_behavior_digest;
    uint64_t dense_trace_digest;
    uint64_t sparse_trace_digest;
    uint8_t exact;
} R32CompressionReport;

void r32_model_init(R32Model *model);
R0Status r32_compress(const R31Model *dense, R32Model *sparse,
                      R32CompressionReport *report, char *error,
                      size_t error_capacity);
R0Status r32_verify_equivalence(const R31Model *dense,
                                const R32Model *sparse,
                                R32CompressionReport *report, char *error,
                                size_t error_capacity);
R0Status r32_select_action(const R32Model *model, uint16_t invariant_mask,
                           const R31Witness *witness, int *action);
R0Status r32_solve(const R32Model *model, uint16_t program_index,
                   R31Invariant *invariant, uint32_t *verifier_calls,
                   char *error, size_t error_capacity);

size_t r32_serialized_size(const R32Model *model);
R0Status r32_model_save(const R32Model *model, const char *path,
                        char *error, size_t error_capacity);
R0Status r32_model_load(R32Model *model, const char *path,
                        char *error, size_t error_capacity);

#endif
