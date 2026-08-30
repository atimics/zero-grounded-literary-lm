#ifndef REASONER31_H
#define REASONER31_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R31_DIMENSIONS = 3,
    R31_DOMAIN_MIN = -2,
    R31_DOMAIN_MAX = 2,
    R31_STATE_COUNT = 125,
    R31_ATOM_COUNT = 12,
    R31_HYPOTHESIS_COUNT = 4096,
    R31_MAX_PROGRAMS = 511,
    R31_MAX_CASES = 40000,
    R31_MAX_REPAIR_STEPS = 6,
    R31_FEATURE_COUNT = 131072,
    R31_MAX_STAGE_EPOCHS = 256,
    R31_TRAINING_STAGE = 4,
    R31_DEVELOPMENT_STAGE = 5,
    R31_TEST_STAGE = 6
};

typedef enum {
    R31_WITNESS_UNKNOWN = 0,
    R31_WITNESS_POSITIVE = 1,
    R31_WITNESS_NEGATIVE = 2,
    R31_WITNESS_IMPLICATION = 3,
    R31_WITNESS_VALID = 4
} R31WitnessKind;

typedef enum {
    R31_FEEDBACK_FULL = 0,
    R31_FEEDBACK_RANKER_MASKED = 1,
    R31_FEEDBACK_NONE = 2,
    R31_FEEDBACK_TOOL_ONLY = 3
} R31FeedbackMode;

typedef struct {
    int8_t values[R31_DIMENSIONS];
} R31State;

typedef struct {
    int8_t coefficients[R31_DIMENSIONS];
    int8_t constant;
} R31Atom;

typedef struct {
    uint8_t kind;
    R31State source;
    R31State target;
    uint16_t nonce;
} R31Witness;

typedef struct {
    uint8_t accepted;
    R31Witness witness;
} R31Verification;

typedef struct {
    uint16_t atom_mask;
} R31Invariant;

typedef struct {
    int32_t weights[R31_FEATURE_COUNT];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
    uint8_t trained_stage;
    uint8_t evaluated_stage;
    uint8_t sealed_test_passed;
} R31Model;

typedef struct {
    uint8_t stage;
    uint8_t feedback_mode;
    uint32_t cases;
    uint32_t solved;
    uint32_t optimal;
    uint32_t failed;
    uint32_t verifier_calls;
    uint32_t repeated_states;
    uint32_t unresolved_edits;
    uint32_t excess_edits;
    uint32_t decisions;
    uint32_t singleton_decisions;
    uint32_t multiple_decisions;
    uint32_t success_milli;
    uint32_t optimal_milli;
    uint8_t exact;
} R31EvaluationReport;

typedef struct {
    uint8_t stage;
    uint32_t cases;
    uint32_t seen_observations;
    uint32_t unseen_observations;
    uint32_t seen_optimal;
    uint32_t unseen_optimal;
    uint32_t equal_admissibility_pairs;
    uint32_t equal_admissibility_pairs_exact;
    uint32_t equal_admissibility_masked_both_correct;
    uint8_t irrelevant_swap_exact;
    uint8_t permutation_exact;
    R31EvaluationReport full;
    R31EvaluationReport ranker_masked;
    R31EvaluationReport no_feedback;
    R31EvaluationReport tool_only;
    uint8_t gate_passed;
} R31HoldoutReport;

typedef struct {
    uint32_t programs;
    uint32_t programs_by_stage[R31_TEST_STAGE + 1];
    uint32_t cases;
    uint32_t positive_cases;
    uint32_t negative_cases;
    uint32_t implication_cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_action_errors;
    uint8_t curriculum_promotions;
    uint8_t trained_stage;
    R31HoldoutReport development;
    R31HoldoutReport sealed_test;
    uint8_t experiment_passed;
} R31TrainingReport;

typedef struct {
    uint16_t program_index;
    uint16_t atom_mask;
    uint64_t checksum;
    uint8_t sealed;
} R31AnswerIR;

const R31Atom *r31_atoms(void);
const char *r31_witness_name(uint8_t kind);
const char *r31_feedback_name(uint8_t mode);
uint16_t r31_program_count(void);
uint16_t r31_program_count_at_stage(uint8_t stage);
uint8_t r31_program_stage(uint16_t program_index);
R0Status r31_verify(uint16_t program_index, const R31Invariant *invariant,
                    R31Verification *verification, char *error,
                    size_t error_capacity);

void r31_model_init(R31Model *model);
R0Status r31_train(R31Model *model, R31TrainingReport *report,
                   char *error, size_t error_capacity);
R0Status r31_evaluate(const R31Model *model, uint8_t stage,
                      uint8_t feedback_mode, R31EvaluationReport *report,
                      char *error, size_t error_capacity);
R0Status r31_model_save(const R31Model *model, const char *path,
                        char *error, size_t error_capacity);
R0Status r31_model_load(R31Model *model, const char *path,
                        char *error, size_t error_capacity);

R0Status r31_solve(const R31Model *model, uint16_t program_index,
                   R31Invariant *invariant, uint32_t *verifier_calls,
                   char *error, size_t error_capacity);
R0Status r31_answer_seal(uint16_t program_index,
                         const R31Invariant *invariant,
                         R31AnswerIR *answer, char *error,
                         size_t error_capacity);
R0Status r31_language_render(const R31AnswerIR *answer, char *output,
                             size_t output_capacity, char *error,
                             size_t error_capacity);

#endif
