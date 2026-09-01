#include "reasoner37.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define R37_FNV_OFFSET UINT64_C(1469598103934665603)
#define R37_FNV_PRIME UINT64_C(1099511628211)

static const int32_t frozen_reasoner[R36_FEATURE_COUNT] = {
    0, 4, 0, -4, 0, 0, 0, 0, 3, -2, 0, -2, 0, 4, 4, 0};

static const char *lexicons[R37_LEXICON_COUNT][R37_LANGUAGE_CLASSES] = {
    {"inspect", "apply", "commit"},
    {"query", "execute", "finish"},
    {"probe", "use", "answer"},
    {"examine", "enact", "close"}};

typedef struct {
    R37LanguageModel *model;
    uint32_t mistakes;
} R37TrainingContext;

typedef struct {
    const R37LanguageModel *model;
    uint8_t first_lexicon;
    uint8_t lexicon_count;
    R37Evaluation *report;
} R37EvaluationContext;

typedef struct {
    uint64_t hash;
    uint32_t events;
} R37HashContext;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static void encode_event(const R36TraceEvent *event,
                         int16_t features[R37_LANGUAGE_FEATURES])
{
    memset(features, 0, sizeof(int16_t) * R37_LANGUAGE_FEATURES);
    features[0] = 1;
    features[1] = (int16_t)(event->call.tool == R36_TOOL_QUERY);
    features[2] = (int16_t)(event->call.tool == R36_TOOL_APPLY);
    features[3] = (int16_t)(event->call.tool == R36_TOOL_COMMIT);
    features[4] = event->reply.valid;
    features[5] = (int16_t)(event->reply.remaining == 0);
    features[6] = event->reply.reversal;
    features[7] = event->complete;
}

static int64_t language_score(const R37LanguageModel *model,
                              uint8_t language_class,
                              const int16_t features[R37_LANGUAGE_FEATURES])
{
    int64_t score = 0;
    uint8_t feature;
    for (feature = 0; feature < R37_LANGUAGE_FEATURES; ++feature)
        score += (int64_t)model->weights[language_class][feature] *
                 features[feature];
    return score;
}

static uint8_t predict_language(
    const R37LanguageModel *model,
    const int16_t features[R37_LANGUAGE_FEATURES])
{
    uint8_t language_class;
    uint8_t best = 0;
    int64_t best_score = INT64_MIN;
    for (language_class = 0; language_class < R37_LANGUAGE_CLASSES;
         ++language_class) {
        int64_t score = language_score(model, language_class, features);
        if (score > best_score) {
            best = language_class;
            best_score = score;
        }
    }
    return best;
}

static R0Status train_visitor(const R36TraceEvent *event, void *context,
                              char *error, size_t error_capacity)
{
    R37TrainingContext *training = context;
    int16_t features[R37_LANGUAGE_FEATURES];
    uint8_t target;
    uint8_t predicted;
    uint8_t feature;
    (void)error;
    (void)error_capacity;
    encode_event(event, features);
    target = (uint8_t)(event->call.tool - 1);
    predicted = predict_language(training->model, features);
    if (predicted == target) return R0_OK;
    ++training->mistakes;
    for (feature = 0; feature < R37_LANGUAGE_FEATURES; ++feature) {
        training->model->weights[target][feature] += features[feature];
        training->model->weights[predicted][feature] -= features[feature];
    }
    return R0_OK;
}

typedef struct {
    uint32_t errors;
    R37LanguageModel model;
} R37ErrorContext;

static R0Status count_error_visitor(const R36TraceEvent *event,
                                    void *context, char *error,
                                    size_t error_capacity)
{
    R37ErrorContext *errors = context;
    int16_t features[R37_LANGUAGE_FEATURES];
    (void)error;
    (void)error_capacity;
    encode_event(event, features);
    if (predict_language(&errors->model, features) !=
        (uint8_t)(event->call.tool - 1))
        ++errors->errors;
    return R0_OK;
}

static R0Status train_language(R37LanguageModel *model, uint32_t *epochs,
                               uint32_t *mistakes, uint32_t *errors,
                               char *error, size_t error_capacity)
{
    uint32_t epoch;
    memset(model, 0, sizeof(*model));
    *epochs = 0;
    *mistakes = 0;
    *errors = UINT32_MAX;
    for (epoch = 0; epoch < R37_MAX_EPOCHS; ++epoch) {
        R37TrainingContext training = {model, 0};
        R37ErrorContext error_context;
        R36TraceSummary summary;
        R0Status status = r36_visit_traces(
            frozen_reasoner, R36_TRACE_TRAINING, train_visitor, &training,
            &summary, error, error_capacity);
        if (status != R0_OK) return status;
        *mistakes += training.mistakes;
        ++*epochs;
        memset(&error_context, 0, sizeof(error_context));
        error_context.model = *model;
        status = r36_visit_traces(
            frozen_reasoner, R36_TRACE_TRAINING, count_error_visitor,
            &error_context, &summary, error, error_capacity);
        if (status != R0_OK) return status;
        *errors = error_context.errors;
        if (*errors == 0) return R0_OK;
    }
    set_error(error, error_capacity,
              "language readout did not converge");
    return R0_POLICY_ERROR;
}

static uint64_t hash_byte(uint64_t hash, uint8_t value)
{
    hash ^= value;
    return hash * R37_FNV_PRIME;
}

static uint64_t hash_u32(uint64_t hash, uint32_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 4; ++byte)
        hash = hash_byte(hash, (uint8_t)(value >> (byte * 8)));
    return hash;
}

static uint64_t hash_event(uint64_t hash, const R36TraceEvent *event)
{
    hash = hash_u32(hash, event->episode_id);
    hash = hash_byte(hash, event->mixed_episode);
    hash = hash_byte(hash, event->stage);
    hash = hash_byte(hash, event->candidate_count);
    hash = hash_byte(hash, (uint8_t)event->call.tool);
    hash = hash_byte(hash, event->call.argument);
    hash = hash_byte(hash, event->reply.valid);
    hash = hash_byte(hash, (uint8_t)event->reply.progress);
    hash = hash_byte(hash, event->reply.remaining);
    hash = hash_byte(hash, event->reply.cost);
    hash = hash_byte(hash, event->reply.reversal);
    return hash_byte(hash, event->complete);
}

static R0Status hash_visitor(const R36TraceEvent *event, void *context,
                             char *error, size_t error_capacity)
{
    R37HashContext *hash = context;
    (void)error;
    (void)error_capacity;
    hash->hash = hash_event(hash->hash, event);
    ++hash->events;
    return R0_OK;
}

static int parse_language(const char *text, uint8_t lexicon,
                          uint8_t *language_class, unsigned *handle,
                          unsigned *valid, int *progress,
                          unsigned *remaining, unsigned *cost,
                          unsigned *reversal, unsigned *complete)
{
    char verb[16];
    uint8_t candidate;
    if (sscanf(text,
               "%15s handle=%u valid=%u progress=%d remaining=%u "
               "cost=%u reversal=%u complete=%u",
               verb, handle, valid, progress, remaining, cost, reversal,
               complete) != 8)
        return 0;
    for (candidate = 0; candidate < R37_LANGUAGE_CLASSES; ++candidate) {
        if (strcmp(verb, lexicons[lexicon][candidate]) == 0) {
            *language_class = candidate;
            return 1;
        }
    }
    return 0;
}

static uint8_t language_matches(const R36TraceEvent *event,
                                const R37LanguageModel *model,
                                uint8_t lexicon)
{
    int16_t features[R37_LANGUAGE_FEATURES];
    uint8_t predicted;
    uint8_t parsed_class = 0;
    unsigned handle = 0, valid = 0, remaining = 0, cost = 0;
    unsigned reversal = 0, complete = 0;
    int progress = 0;
    char text[160];
    int length;
    encode_event(event, features);
    predicted = predict_language(model, features);
    length = snprintf(
        text, sizeof(text),
        "%s handle=%u valid=%u progress=%d remaining=%u cost=%u "
        "reversal=%u complete=%u",
        lexicons[lexicon][predicted], event->call.argument,
        event->reply.valid, event->reply.progress,
        event->reply.remaining, event->reply.cost,
        event->reply.reversal, event->complete);
    if (length < 0 || (size_t)length >= sizeof(text)) return 0;
    if (!parse_language(text, lexicon, &parsed_class, &handle, &valid,
                        &progress, &remaining, &cost, &reversal,
                        &complete))
        return 0;
    return (uint8_t)(parsed_class == (uint8_t)(event->call.tool - 1) &&
                     handle == event->call.argument &&
                     valid == event->reply.valid &&
                     progress == event->reply.progress &&
                     remaining == event->reply.remaining &&
                     cost == event->reply.cost &&
                     reversal == event->reply.reversal &&
                     complete == event->complete);
}

static R0Status evaluation_visitor(const R36TraceEvent *event,
                                   void *context, char *error,
                                   size_t error_capacity)
{
    R37EvaluationContext *evaluation = context;
    uint8_t offset;
    (void)error;
    (void)error_capacity;
    evaluation->report->trace_hash =
        hash_event(evaluation->report->trace_hash, event);
    ++evaluation->report->trace_events;
    for (offset = 0; offset < evaluation->lexicon_count; ++offset) {
        uint8_t lexicon =
            (uint8_t)(evaluation->first_lexicon + offset);
        ++evaluation->report->utterances;
        if (language_matches(event, evaluation->model, lexicon))
            ++evaluation->report->exact_utterances;
    }
    return R0_OK;
}

static R0Status baseline_hash(uint8_t suite, uint64_t *hash,
                              uint32_t *events, char *error,
                              size_t error_capacity)
{
    R37HashContext context = {R37_FNV_OFFSET, 0};
    R36TraceSummary summary;
    R0Status status = r36_visit_traces(
        frozen_reasoner, suite, hash_visitor, &context, &summary, error,
        error_capacity);
    if (status != R0_OK) return status;
    *hash = context.hash;
    *events = context.events;
    return R0_OK;
}

static R0Status evaluate_language(const R37LanguageModel *model,
                                  uint8_t suite, uint8_t first_lexicon,
                                  uint8_t lexicon_count,
                                  R37Evaluation *report, char *error,
                                  size_t error_capacity)
{
    R37EvaluationContext context;
    R36TraceSummary summary;
    R0Status status;
    memset(report, 0, sizeof(*report));
    report->trace_hash = R37_FNV_OFFSET;
    context.model = model;
    context.first_lexicon = first_lexicon;
    context.lexicon_count = lexicon_count;
    context.report = report;
    status = r36_visit_traces(
        frozen_reasoner, suite, evaluation_visitor, &context, &summary,
        error, error_capacity);
    if (status != R0_OK) return status;
    report->episodes = summary.episodes;
    report->mixed_episodes = summary.mixed_episodes;
    report->trace_exact = summary.exact;
    report->language_exact =
        (uint8_t)(report->utterances == report->exact_utterances);
    return R0_OK;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (byte * 8));
        hash *= R37_FNV_PRIME;
    }
    return hash;
}

static uint64_t experiment_digest(const R37ExperimentReport *report)
{
    uint64_t hash = R37_FNV_OFFSET;
    uint8_t language_class, feature;
    hash = digest_u64(hash, report->language_epochs);
    hash = digest_u64(hash, report->language_mistakes);
    hash = digest_u64(hash, report->language_training_errors);
    for (language_class = 0; language_class < R37_LANGUAGE_CLASSES;
         ++language_class)
        for (feature = 0; feature < R37_LANGUAGE_FEATURES; ++feature)
            hash = digest_u64(
                hash,
                (uint64_t)(uint32_t)
                    report->language_weights[language_class][feature]);
    hash = digest_u64(hash, report->development.trace_hash);
    hash = digest_u64(hash, report->development.exact_utterances);
    hash = digest_u64(hash, report->sealed.trace_hash);
    hash = digest_u64(hash, report->sealed.exact_utterances);
    hash = digest_u64(hash, report->frozen_reasoner_matched);
    hash = digest_u64(hash, report->reasoning_isolated);
    hash = digest_u64(hash, report->adversarial_language_failed);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R0Status r37_run_development(R37ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R36ExperimentReport reasoner_report;
    R37LanguageModel model;
    R37LanguageModel adversarial;
    R37Evaluation adversarial_evaluation;
    uint64_t baseline;
    uint32_t baseline_events;
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = r36_run_development(&reasoner_report, error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->frozen_reasoner_weights, frozen_reasoner,
           sizeof(frozen_reasoner));
    report->frozen_reasoner_matched =
        (uint8_t)(reasoner_report.development_gate_passed &&
                  memcmp(reasoner_report.weights, frozen_reasoner,
                         sizeof(frozen_reasoner)) == 0);
    status = train_language(&model, &report->language_epochs,
                            &report->language_mistakes,
                            &report->language_training_errors, error,
                            error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->language_weights, model.weights,
           sizeof(report->language_weights));
    status = baseline_hash(R36_TRACE_DEVELOPMENT, &baseline,
                           &baseline_events, error, error_capacity);
    if (status == R0_OK)
        status = evaluate_language(
            &model, R36_TRACE_DEVELOPMENT, 0, 2,
            &report->development, error, error_capacity);
    memset(&adversarial, 0, sizeof(adversarial));
    if (status == R0_OK)
        status = evaluate_language(
            &adversarial, R36_TRACE_DEVELOPMENT, 0, 1,
            &adversarial_evaluation, error, error_capacity);
    if (status != R0_OK) return status;
    report->reasoning_isolated =
        (uint8_t)(baseline == report->development.trace_hash &&
                  baseline == adversarial_evaluation.trace_hash &&
                  baseline_events == report->development.trace_events &&
                  baseline_events == adversarial_evaluation.trace_events);
    report->adversarial_language_failed =
        (uint8_t)!adversarial_evaluation.language_exact;
    report->frozen_reasoner_bytes = R36_POLICY_BYTES;
    report->language_readout_bytes = R37_LANGUAGE_BYTES;
    report->development_gate_passed =
        (uint8_t)(report->frozen_reasoner_matched &&
                  report->development.trace_exact &&
                  report->development.language_exact &&
                  report->reasoning_isolated &&
                  report->adversarial_language_failed);
    report->result_digest = experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "Reasoner (3,6) development gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r37_run_sealed(R37ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R37LanguageModel model;
    R37LanguageModel adversarial;
    R37Evaluation adversarial_evaluation;
    uint64_t baseline;
    uint32_t baseline_events;
    R0Status status = r37_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(model.weights, report->language_weights, sizeof(model.weights));
    status = baseline_hash(R36_TRACE_SEALED, &baseline, &baseline_events,
                           error, error_capacity);
    if (status == R0_OK)
        status = evaluate_language(&model, R36_TRACE_SEALED, 2, 2,
                                   &report->sealed, error,
                                   error_capacity);
    memset(&adversarial, 0, sizeof(adversarial));
    if (status == R0_OK)
        status = evaluate_language(
            &adversarial, R36_TRACE_SEALED, 2, 1,
            &adversarial_evaluation, error, error_capacity);
    if (status != R0_OK) return status;
    report->reasoning_isolated =
        (uint8_t)(report->reasoning_isolated &&
                  baseline == report->sealed.trace_hash &&
                  baseline == adversarial_evaluation.trace_hash &&
                  baseline_events == report->sealed.trace_events &&
                  baseline_events == adversarial_evaluation.trace_events);
    report->adversarial_language_failed =
        (uint8_t)(report->adversarial_language_failed &&
                  !adversarial_evaluation.language_exact);
    report->sealed_gate_passed =
        (uint8_t)(report->development_gate_passed &&
                  report->sealed.trace_exact &&
                  report->sealed.language_exact &&
                  report->reasoning_isolated &&
                  report->adversarial_language_failed);
    report->result_digest = experiment_digest(report);
    return R0_OK;
}

R0Status r37_write_result(const R37ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    uint8_t language_class, feature;
    if (report == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fprintf(
            file,
            "{\n  \"schema\": \"zero.reasoner37_language_readout.v1\",\n"
            "  \"version\": \"(3,6)\",\n"
            "  \"frozen_reasoner_bytes\": %u,\n"
            "  \"language_readout_bytes\": %u,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"language_training\": {\"epochs\": %u, "
            "\"mistakes\": %u, \"errors\": %u},\n"
            "  \"development\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"trace_events\": %u, "
            "\"utterances\": %u, \"exact_utterances\": %u, "
            "\"trace_hash\": \"%016" PRIx64 "\", "
            "\"trace_exact\": %s, \"language_exact\": %s},\n"
            "  \"sealed\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"trace_events\": %u, "
            "\"utterances\": %u, \"exact_utterances\": %u, "
            "\"trace_hash\": \"%016" PRIx64 "\", "
            "\"trace_exact\": %s, \"language_exact\": %s},\n"
            "  \"frozen_reasoner_matched\": %s,\n"
            "  \"reasoning_isolated\": %s,\n"
            "  \"adversarial_language_failed\": %s,\n"
            "  \"language_weights\": [",
            report->frozen_reasoner_bytes,
            report->language_readout_bytes,
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->language_epochs, report->language_mistakes,
            report->language_training_errors,
            report->development.episodes,
            report->development.mixed_episodes,
            report->development.trace_events,
            report->development.utterances,
            report->development.exact_utterances,
            report->development.trace_hash,
            report->development.trace_exact ? "true" : "false",
            report->development.language_exact ? "true" : "false",
            report->sealed.episodes, report->sealed.mixed_episodes,
            report->sealed.trace_events, report->sealed.utterances,
            report->sealed.exact_utterances, report->sealed.trace_hash,
            report->sealed.trace_exact ? "true" : "false",
            report->sealed.language_exact ? "true" : "false",
            report->frozen_reasoner_matched ? "true" : "false",
            report->reasoning_isolated ? "true" : "false",
            report->adversarial_language_failed ? "true" : "false") < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (language_class = 0; language_class < R37_LANGUAGE_CLASSES;
         ++language_class) {
        if (fprintf(file, "%s[", language_class == 0 ? "" : ", ") < 0) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
        for (feature = 0; feature < R37_LANGUAGE_FEATURES; ++feature)
            if (fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                        report->language_weights[language_class][feature]) <
                0) {
                (void)fclose(file);
                return R0_IO_ERROR;
            }
        if (fprintf(file, "]") < 0) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
    }
    if (fprintf(file,
                "],\n  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
                report->result_digest) < 0 || fclose(file) != 0) {
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
