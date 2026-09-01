#ifndef REASONER3_H
#define REASONER3_H

#include "reasoner0.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R3_DIMENSIONS = 2,
    R3_DOMAIN_MIN = -2,
    R3_DOMAIN_MAX = 2,
    R3_STATE_COUNT = 25,
    R3_ATOM_COUNT = 12,
    R3_MAX_PROGRAMS = 192,
    R3_MAX_CASES = 12000,
    R3_MAX_REPAIR_STEPS = 4,
    R3_FEATURE_COUNT = 65536,
    R3_MAX_STAGE_EPOCHS = 256,
    R3_MAX_STAGE = 4
};

typedef enum {
    R3_WITNESS_UNKNOWN = 0,
    R3_WITNESS_POSITIVE = 1,
    R3_WITNESS_NEGATIVE = 2,
    R3_WITNESS_IMPLICATION = 3,
    R3_WITNESS_VALID = 4
} R3WitnessKind;

typedef struct {
    int8_t values[R3_DIMENSIONS];
} R3State;

typedef struct {
    int8_t coefficients[R3_DIMENSIONS];
    int8_t constant;
} R3Atom;

typedef struct {
    uint8_t kind;
    R3State source;
    R3State target;
    uint16_t nonce;
} R3Witness;

typedef struct {
    uint8_t accepted;
    R3Witness witness;
} R3Verification;

typedef struct {
    uint16_t atom_mask;
} R3Invariant;

typedef struct {
    int32_t weights[R3_FEATURE_COUNT];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
    uint8_t trained_stage;
} R3Model;

typedef struct {
    uint32_t programs;
    uint32_t cases;
    uint32_t positive_cases;
    uint32_t negative_cases;
    uint32_t implication_cases;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_action_errors;
    uint8_t curriculum_promotions;
    uint8_t trained_stage;
    uint32_t holdout_cases;
    uint32_t holdout_solved;
    uint32_t holdout_optimal;
    uint32_t holdout_success_milli;
    uint32_t holdout_optimal_milli;
    uint32_t holdout_repeated_states;
    uint32_t ambiguity_cases;
    uint32_t blind_ceiling_milli;
    uint32_t blind_holdout_action_milli;
    uint32_t interchange_pairs;
    uint8_t interchange_exact;
    uint8_t irrelevant_swap_exact;
    uint8_t permutation_exact;
    uint8_t holdout_exact;
    uint8_t causal_gate_passed;
} R3TrainingReport;

typedef struct {
    uint8_t minimum_stage;
    uint8_t maximum_stage;
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
} R3EvaluationReport;

typedef struct {
    uint16_t program_index;
    uint16_t atom_mask;
    uint64_t checksum;
    uint8_t sealed;
} R3AnswerIR;

const R3Atom *r3_atoms(void);
const char *r3_witness_name(uint8_t kind);
uint16_t r3_program_count(void);
uint8_t r3_program_stage(uint16_t program_index);
R0Status r3_verify(uint16_t program_index, const R3Invariant *invariant,
                   R3Verification *verification, char *error,
                   size_t error_capacity);

void r3_model_init(R3Model *model);
R0Status r3_train(R3Model *model, uint8_t maximum_stage,
                  R3TrainingReport *report, char *error,
                  size_t error_capacity);
R0Status r3_evaluate(const R3Model *model, uint8_t minimum_stage,
                     uint8_t maximum_stage, int mask_feedback,
                     R3EvaluationReport *report, char *error,
                     size_t error_capacity);
R0Status r3_model_save(const R3Model *model, const char *path,
                       char *error, size_t error_capacity);
R0Status r3_model_load(R3Model *model, const char *path,
                       char *error, size_t error_capacity);

R0Status r3_solve(const R3Model *model, uint16_t program_index,
                  R3Invariant *invariant, uint32_t *verifier_calls,
                  char *error, size_t error_capacity);
R0Status r3_answer_seal(uint16_t program_index,
                        const R3Invariant *invariant, R3AnswerIR *answer,
                        char *error, size_t error_capacity);
R0Status r3_language_render(const R3AnswerIR *answer, char *output,
                            size_t output_capacity, char *error,
                            size_t error_capacity);

#endif
