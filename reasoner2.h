#ifndef REASONER2_H
#define REASONER2_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R2_GRAPH_ROUNDS = 4,
    R2_FEATURE_COUNT = 65536,
    R2_MAX_STAGE_EPOCHS = 256,
    R2_MAX_REPAIR_STEPS = 2
};

typedef struct {
    int32_t weights[R2_FEATURE_COUNT];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
    uint8_t trained_rank;
} R2Model;

typedef struct {
    uint32_t cases;
    uint32_t one_step_cases;
    uint32_t two_step_cases;
    uint32_t affine_cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_action_errors;
    uint8_t curriculum_promotions;
    uint8_t trained_rank;
    uint32_t rank8_holdout_cases;
    uint32_t rank8_holdout_solved;
    uint32_t rank8_holdout_optimal;
    uint32_t rank8_holdout_success_milli;
    uint32_t rank8_holdout_optimal_milli;
    uint32_t rank8_holdout_repeated_states;
    uint32_t rank8_ablation_solved;
    uint32_t rank8_ablation_optimal;
    uint32_t rank8_ablation_success_milli;
    uint32_t rank8_ablation_optimal_milli;
    uint8_t rank8_holdout_exact;
    uint8_t feedback_ablation_collapsed;
} R2TrainingReport;

typedef struct {
    uint8_t minimum_rank;
    uint8_t maximum_rank;
    uint8_t feedback_masked;
    uint32_t cases;
    uint32_t solved;
    uint32_t optimal;
    uint32_t failed;
    uint32_t verifier_calls;
    uint32_t repeated_states;
    uint32_t excess_edits;
    uint32_t success_milli;
    uint32_t optimal_milli;
    uint8_t exact;
} R2EvaluationReport;

void r2_model_init(R2Model *model);
R0Status r2_train(R2Model *model, uint8_t maximum_rank,
                  R2TrainingReport *report, char *error,
                  size_t error_capacity);
R0Status r2_evaluate(const R2Model *model, uint8_t minimum_rank,
                     uint8_t maximum_rank, int mask_feedback,
                     R2EvaluationReport *report, char *error,
                     size_t error_capacity);
R0Status r2_model_save(const R2Model *model, const char *path,
                       char *error, size_t error_capacity);
R0Status r2_model_load(R2Model *model, const char *path,
                       char *error, size_t error_capacity);

#endif
