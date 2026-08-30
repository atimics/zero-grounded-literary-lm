#ifndef REASONER1_H
#define REASONER1_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R1_GRAPH_ROUNDS = 4,
    R1_BOND_ACTIONS = 5,
    R1_FEATURE_COUNT = 65536,
    R1_MAX_ACTIVE_FEATURES = 256,
    R1_MAX_STAGE_EPOCHS = 256
};

typedef struct {
    int32_t weights[R1_FEATURE_COUNT];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
    uint8_t trained_rank;
} R1Model;

typedef struct {
    uint32_t examples;
    uint32_t positives;
    uint32_t negatives;
    uint32_t affine_negatives;
    uint32_t weighted_examples;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
    uint8_t curriculum_promotions;
    uint8_t trained_rank;
    uint8_t rank8_holdout_found;
    uint8_t rank8_holdout_expected;
    uint8_t rank8_holdout_exact_precision_recall;
    uint32_t rank8_holdout_precision_milli;
    uint32_t rank8_holdout_recall_milli;
    uint32_t rank8_holdout_rejected;
    char rank8_holdout_types[64];
} R1TrainingReport;

typedef struct {
    uint8_t maximum_rank;
    uint32_t candidate_actions;
    uint32_t proposed;
    uint32_t skipped;
    uint32_t accepted;
    uint32_t rejected;
    uint32_t affine_rejections;
    uint32_t counterexample_weight;
    uint8_t count_by_rank[R0_ENUMERATION_MAX_RANK + 1];
    char types_by_rank[R0_ENUMERATION_MAX_RANK + 1][64];
    uint32_t precision_milli;
    uint32_t recall_milli;
    uint8_t exact_precision_recall;
} R1EvaluationReport;

void r1_model_init(R1Model *model);
R0Status r1_train(R1Model *model, uint8_t maximum_rank,
                  R1TrainingReport *report, char *error,
                  size_t error_capacity);
R0Status r1_evaluate(const R1Model *model, uint8_t maximum_rank,
                     R1EvaluationReport *report, char *error,
                     size_t error_capacity);
R0Status r1_model_save(const R1Model *model, const char *path,
                       char *error, size_t error_capacity);
R0Status r1_model_load(R1Model *model, const char *path,
                       char *error, size_t error_capacity);

#endif
