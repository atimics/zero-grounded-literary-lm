#ifndef REASONER37_H
#define REASONER37_H

#include "reasoner36.h"

#include <stddef.h>
#include <stdint.h>

enum {
    R37_LANGUAGE_CLASSES = 3,
    R37_LANGUAGE_FEATURES = 8,
    R37_LANGUAGE_BYTES = R37_LANGUAGE_CLASSES * R37_LANGUAGE_FEATURES *
                         (int)sizeof(int32_t),
    R37_LEXICON_COUNT = 4,
    R37_MAX_EPOCHS = 64
};

typedef struct {
    int32_t weights[R37_LANGUAGE_CLASSES][R37_LANGUAGE_FEATURES];
} R37LanguageModel;

typedef struct {
    uint32_t episodes;
    uint32_t mixed_episodes;
    uint32_t trace_events;
    uint32_t utterances;
    uint32_t exact_utterances;
    uint64_t trace_hash;
    uint8_t trace_exact;
    uint8_t language_exact;
} R37Evaluation;

typedef struct {
    uint32_t language_epochs;
    uint32_t language_mistakes;
    uint32_t language_training_errors;
    uint32_t frozen_reasoner_bytes;
    uint32_t language_readout_bytes;
    int32_t frozen_reasoner_weights[R36_FEATURE_COUNT];
    int32_t language_weights[R37_LANGUAGE_CLASSES]
                            [R37_LANGUAGE_FEATURES];
    R37Evaluation development;
    R37Evaluation sealed;
    uint8_t frozen_reasoner_matched;
    uint8_t reasoning_isolated;
    uint8_t adversarial_language_failed;
    uint8_t development_gate_passed;
    uint8_t sealed_gate_passed;
    uint64_t result_digest;
} R37ExperimentReport;

R0Status r37_run_development(R37ExperimentReport *report, char *error,
                             size_t error_capacity);
R0Status r37_run_sealed(R37ExperimentReport *report, char *error,
                        size_t error_capacity);
R0Status r37_write_result(const R37ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity);

#endif
