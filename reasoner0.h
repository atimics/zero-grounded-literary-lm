#ifndef REASONER0_H
#define REASONER0_H

#include <stddef.h>
#include <stdint.h>

enum {
    R0_MAX_RANK = 9,
    R0_ENUMERATION_MAX_RANK = 8,
    R0_MATRIX_CAPACITY = R0_MAX_RANK * R0_MAX_RANK,
    R0_MAX_TRACE_EVENTS = 8,
    R0_SEAL_HEX_CAPACITY = 65,
    R0_LANGUAGE_CAPACITY = 160,
    R0_POLICY_FEATURES = 5,
    R0_POLICY_ACTIONS = 4,
    R0_MAX_TYPES_PER_RANK = 8
};

typedef enum {
    R0_OK = 0,
    R0_INVALID_ARGUMENT,
    R0_POLICY_ERROR,
    R0_VERIFIER_ERROR,
    R0_SEAL_ERROR,
    R0_LIMIT_ERROR,
    R0_IO_ERROR
} R0Status;

typedef enum {
    R0_PHASE_PROPOSED = 0,
    R0_PHASE_VERIFIED = 1,
    R0_PHASE_COUNTEREXAMPLE = 2,
    R0_PHASE_SEALED = 3,
    R0_PHASE_COMPLETE = 4
} R0Phase;

typedef enum {
    R0_ACTION_CALL_CARTAN_VERIFY = 0,
    R0_ACTION_COMMIT = 1,
    R0_ACTION_REJECT = 2,
    R0_ACTION_RENDER = 3
} R0ActionClass;

typedef enum {
    R0_TOOL_NONE = 0,
    R0_TOOL_CARTAN_VERIFY,
    R0_TOOL_LANGUAGE_RENDER
} R0ToolKind;

typedef enum {
    R0_CARTAN_VALID = 0,
    R0_CARTAN_BAD_RANK,
    R0_CARTAN_BAD_DIAGONAL,
    R0_CARTAN_POSITIVE_OFF_DIAGONAL,
    R0_CARTAN_ASYMMETRIC_ZERO,
    R0_CARTAN_BAD_BOND_PRODUCT,
    R0_CARTAN_DISCONNECTED,
    R0_CARTAN_NOT_SYMMETRIZABLE,
    R0_CARTAN_AFFINE_BOUNDARY,
    R0_CARTAN_NOT_POSITIVE_DEFINITE
} R0CartanFailure;

typedef enum {
    R0_EVENT_MODEL_ACTION = 0,
    R0_EVENT_TOOL_RESULT,
    R0_EVENT_ANSWER_SEALED,
    R0_EVENT_CANDIDATE_REJECTED
} R0EventKind;

typedef struct {
    uint8_t rank;
    int8_t entries[R0_MATRIX_CAPACITY];
} R0CartanMatrix;

typedef struct {
    uint8_t accepted;
    R0CartanFailure failure;
    uint8_t row;
    uint8_t column;
    uint16_t principal_mask;
    int64_t determinant;
    uint16_t checked_principal_minors;
    uint32_t symmetrizer[R0_MAX_RANK];
} R0VerifierObservation;

typedef struct {
    uint32_t version;
    R0CartanMatrix matrix;
    R0VerifierObservation certificate;
} R0AnswerIr;

typedef struct {
    R0AnswerIr answer;
    char seal[R0_SEAL_HEX_CAPACITY];
} R0SealedAnswer;

typedef struct {
    int32_t weights[R0_POLICY_ACTIONS][R0_POLICY_FEATURES];
    uint32_t trained_epochs;
    uint32_t training_mistakes;
} R0Policy;

typedef struct {
    uint32_t examples;
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t final_errors;
} R0TrainingReport;

typedef struct {
    R0EventKind kind;
    uint32_t cycle;
    R0Phase phase;
    R0ActionClass action;
    R0ToolKind tool;
    uint8_t accepted;
    R0CartanFailure failure;
    int64_t determinant;
    char seal[R0_SEAL_HEX_CAPACITY];
} R0TraceEvent;

typedef struct {
    R0TraceEvent events[R0_MAX_TRACE_EVENTS];
    size_t event_count;
    uint8_t accepted;
    R0VerifierObservation observation;
    R0SealedAnswer sealed_answer;
    char language[R0_LANGUAGE_CAPACITY];
} R0RunResult;

typedef struct {
    uint8_t maximum_rank;
    uint32_t proposed;
    uint32_t accepted;
    uint32_t rejected;
    uint32_t affine_negatives;
    uint32_t counterexample_weight;
    uint8_t count_by_rank[R0_ENUMERATION_MAX_RANK + 1];
    char types_by_rank[R0_ENUMERATION_MAX_RANK + 1][64];
    uint8_t exact_precision_recall;
} R0EnumerationReport;

void r0_policy_init(R0Policy *policy);
R0Status r0_policy_train(R0Policy *policy, R0TrainingReport *report);
R0Status r0_policy_save(const R0Policy *policy, const char *path,
                        char *error, size_t error_capacity);
R0Status r0_policy_load(R0Policy *policy, const char *path,
                        char *error, size_t error_capacity);
R0Status r0_cartan_verify(const R0CartanMatrix *matrix,
                          R0VerifierObservation *observation, char *error,
                          size_t error_capacity);
R0Status r0_cartan_canonicalize(const R0CartanMatrix *matrix,
                                R0CartanMatrix *canonical, char *error,
                                size_t error_capacity);
R0Status r0_run(const R0Policy *policy, const R0CartanMatrix *candidate,
                R0RunResult *result, char *error, size_t error_capacity);
R0Status r0_enumerate(const R0Policy *policy, uint8_t maximum_rank,
                      R0EnumerationReport *report, char *error,
                      size_t error_capacity);
R0Status r0_enumerate_dataset(const R0Policy *policy, uint8_t maximum_rank,
                              const char *path,
                              R0EnumerationReport *report, char *error,
                              size_t error_capacity);
R0Status r0_render_language(const R0SealedAnswer *sealed, char *output,
                            size_t output_capacity, char *error,
                            size_t error_capacity);
const char *r0_cartan_type(const R0CartanMatrix *matrix);
const char *r0_failure_name(R0CartanFailure failure);
const char *r0_action_name(R0ActionClass action);
const char *r0_tool_name(R0ToolKind tool);
const char *r0_status_name(R0Status status);

#endif
