#include "reasoner36.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define R36_FNV_OFFSET UINT64_C(1469598103934665603)
#define R36_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    uint8_t domain;
    uint8_t candidate_count;
    R36ToolReply replies[R36_MAX_CANDIDATES];
} R36Stage;

typedef struct {
    uint8_t stage_count;
    uint8_t mixed;
    R36Stage stages[R36_MAX_STAGES];
} R36Episode;

typedef struct {
    const R36Episode *episode;
    uint8_t stage;
    uint8_t queried;
} R36State;

typedef struct {
    R36Call items[R36_MAX_CALLS];
    uint8_t count;
} R36Calls;

static const uint8_t mixed_orders[6][R36_DOMAIN_COUNT] = {
    {0, 1, 2}, {0, 2, 1}, {1, 0, 2},
    {1, 2, 0}, {2, 0, 1}, {2, 1, 0}};

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static int reply_value(const R36ToolReply *reply)
{
    if (!reply->valid) return INT_MIN / 2;
    return 10000 + 100 * reply->progress - 10 * reply->remaining -
           reply->cost - 20 * reply->reversal;
}

static void make_stage(uint8_t domain, uint8_t stage_index,
                       uint8_t stage_count, uint8_t variant,
                       uint8_t permutation, R36Stage *stage)
{
    R36ToolReply base[R36_MAX_CANDIDATES];
    uint32_t seed = mix32((uint32_t)domain * 1009u +
                          (uint32_t)stage_index * 313u +
                          (uint32_t)variant * 37u + 11u);
    uint8_t count = (uint8_t)(3u + seed % 3u);
    uint8_t best = (uint8_t)((seed >> 5) % count);
    uint8_t alternate = (uint8_t)((best + 2u) % count);
    uint8_t invalid = (uint8_t)((best + 1u) % count);
    uint8_t index;
    if (domain == 2 && alternate == invalid)
        invalid = (uint8_t)((invalid + 1u) % count);
    memset(stage, 0, sizeof(*stage));
    memset(base, 0, sizeof(base));
    stage->domain = domain;
    stage->candidate_count = count;
    for (index = 0; index < count; ++index) {
        uint32_t local = mix32(seed + index * 97u);
        base[index].valid = (uint8_t)(index != invalid);
        base[index].progress = (int8_t)((int)(local % 4u) - 1);
        base[index].remaining = (uint8_t)(stage_count - stage_index +
                                                  local % 3u);
        base[index].cost = (uint8_t)(1u + (local >> 4) % 4u);
        base[index].reversal = (uint8_t)(base[index].progress < 0);
    }
    base[best].valid = 1;
    base[best].progress = 3;
    base[best].remaining = (uint8_t)(stage_count - stage_index - 1u);
    base[best].cost = 1;
    base[best].reversal = 0;
    if (domain == 2 && (variant + stage_index) % 2u == 0u) {
        base[alternate] = base[best];
    }
    for (index = 0; index < count; ++index) {
        uint8_t handle;
        if ((permutation & 1u) == 0u)
            handle = (uint8_t)((index + permutation) % count);
        else
            handle = (uint8_t)((count - 1u - index + permutation) % count);
        stage->replies[handle] = base[index];
    }
}

static void make_episode(const uint8_t *order, uint8_t order_count,
                         uint8_t stage_count, uint8_t variant,
                         uint8_t permutation, R36Episode *episode)
{
    uint8_t stage;
    memset(episode, 0, sizeof(*episode));
    episode->stage_count = stage_count;
    episode->mixed = (uint8_t)(order_count > 1);
    for (stage = 0; stage < stage_count; ++stage)
        make_stage(order[stage % order_count], stage, stage_count,
                   variant, (uint8_t)(permutation + stage),
                   &episode->stages[stage]);
}

static uint8_t terminal(const R36State *state)
{
    return (uint8_t)(state->stage >= state->episode->stage_count);
}

static uint8_t all_queried(const R36State *state)
{
    uint8_t count;
    uint8_t mask;
    if (terminal(state)) return 1;
    count = state->episode->stages[state->stage].candidate_count;
    mask = (uint8_t)((1u << count) - 1u);
    return (uint8_t)((state->queried & mask) == mask);
}

static uint8_t bit_count(uint8_t value)
{
    uint8_t count = 0;
    while (value != 0) {
        count = (uint8_t)(count + (value & 1u));
        value >>= 1;
    }
    return count;
}

static void enumerate_calls(const R36State *state, R36Calls *calls)
{
    uint8_t candidate;
    calls->count = 0;
    if (terminal(state)) {
        calls->items[0].tool = R36_TOOL_COMMIT;
        calls->items[0].argument = 0;
        calls->count = 1;
        return;
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
            calls->items[calls->count].tool = R36_TOOL_QUERY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) != 0 &&
            state->episode->stages[state->stage].replies[candidate].valid) {
            calls->items[calls->count].tool = R36_TOOL_APPLY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    calls->items[calls->count].tool = R36_TOOL_COMMIT;
    calls->items[calls->count].argument = 0;
    ++calls->count;
}

static R36Call oracle_call(const R36State *state)
{
    R36Call call = {R36_TOOL_COMMIT, 0};
    const R36Stage *stage;
    uint8_t candidate;
    int best_value = INT_MIN;
    if (terminal(state)) return call;
    stage = &state->episode->stages[state->stage];
    if (!all_queried(state)) {
        call.tool = R36_TOOL_QUERY;
        for (candidate = 0; candidate < stage->candidate_count;
             ++candidate) {
            if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
                call.argument = candidate;
                return call;
            }
        }
    }
    call.tool = R36_TOOL_APPLY;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        int value = reply_value(&stage->replies[candidate]);
        if (value > best_value) {
            best_value = value;
            call.argument = candidate;
        }
    }
    return call;
}

static uint8_t acceptable_call(const R36State *state, R36Call call)
{
    R36Call oracle = oracle_call(state);
    if (call.tool != oracle.tool) return 0;
    if (call.tool == R36_TOOL_COMMIT) return 1;
    if (call.tool == R36_TOOL_QUERY)
        return (uint8_t)((state->queried &
                          (uint8_t)(1u << call.argument)) == 0);
    return (uint8_t)(reply_value(
                         &state->episode->stages[state->stage]
                              .replies[call.argument]) ==
                     reply_value(&state->episode->stages[state->stage]
                                      .replies[oracle.argument]));
}

static R36ToolReply observed_reply(const R36State *state, uint8_t argument,
                                   uint8_t feedback_shift)
{
    const R36Stage *stage = &state->episode->stages[state->stage];
    uint8_t index = argument;
    if (feedback_shift != 0)
        index = (uint8_t)((argument + feedback_shift) %
                          stage->candidate_count);
    return stage->replies[index];
}

static void encode_call(const R36State *state, R36Call call,
                        uint8_t feedback_shift,
                        int16_t features[R36_FEATURE_COUNT])
{
    uint8_t done = terminal(state);
    uint8_t unqueried = 0;
    uint8_t ready = 1;
    R36ToolReply reply = {0, 0, 0, 0, 0};
    memset(features, 0, sizeof(int16_t) * R36_FEATURE_COUNT);
    if (!done) {
        uint8_t count = state->episode->stages[state->stage].candidate_count;
        unqueried = (uint8_t)(count - bit_count(state->queried));
        ready = all_queried(state);
        if (call.tool == R36_TOOL_APPLY)
            reply = observed_reply(state, call.argument, feedback_shift);
    }
    features[0] = 1;
    features[1] = (int16_t)(call.tool == R36_TOOL_QUERY);
    features[2] = (int16_t)(call.tool == R36_TOOL_APPLY);
    features[3] = (int16_t)(call.tool == R36_TOOL_COMMIT);
    features[4] = unqueried;
    features[5] = ready;
    features[6] = done;
    features[7] = reply.valid;
    features[8] = reply.progress;
    features[9] = reply.remaining;
    features[10] = (int16_t)(call.tool == R36_TOOL_APPLY &&
                             reply.remaining == 0);
    features[11] = reply.cost;
    features[12] = reply.reversal;
    features[13] = (int16_t)(call.tool == R36_TOOL_QUERY && unqueried > 0);
    features[14] = (int16_t)(call.tool == R36_TOOL_APPLY && ready);
    features[15] = (int16_t)(call.tool == R36_TOOL_COMMIT && done);
}

static int64_t call_score(const R36Model *model,
                          const int16_t features[R36_FEATURE_COUNT])
{
    int64_t score = 0;
    uint8_t feature;
    for (feature = 0; feature < R36_FEATURE_COUNT; ++feature)
        score += (int64_t)model->weights[feature] * features[feature];
    return score;
}

static R36Call predict_call(const R36Model *model, const R36State *state,
                            uint8_t feedback_shift)
{
    R36Calls calls;
    R36Call best = {R36_TOOL_COMMIT, 0};
    int64_t best_score = INT64_MIN;
    uint8_t index;
    enumerate_calls(state, &calls);
    for (index = 0; index < calls.count; ++index) {
        int16_t features[R36_FEATURE_COUNT];
        int64_t score;
        encode_call(state, calls.items[index], feedback_shift, features);
        score = call_score(model, features);
        if (score > best_score) {
            best = calls.items[index];
            best_score = score;
        }
    }
    return best;
}

static void execute_call(R36State *state, R36Call call)
{
    if (call.tool == R36_TOOL_QUERY) {
        state->queried |= (uint8_t)(1u << call.argument);
    } else if (call.tool == R36_TOOL_APPLY) {
        ++state->stage;
        state->queried = 0;
    }
}

static void update_model(R36Model *model, const R36State *state,
                         R36Call target, R36Call predicted)
{
    int16_t target_features[R36_FEATURE_COUNT];
    int16_t predicted_features[R36_FEATURE_COUNT];
    uint8_t feature;
    encode_call(state, target, 0, target_features);
    encode_call(state, predicted, 0, predicted_features);
    for (feature = 0; feature < R36_FEATURE_COUNT; ++feature)
        model->weights[feature] +=
            target_features[feature] - predicted_features[feature];
}

static uint32_t train_episode(R36Model *model, const R36Episode *episode)
{
    R36State state = {episode, 0, 0};
    uint32_t mistakes = 0;
    while (1) {
        R36Call target = oracle_call(&state);
        R36Call predicted = predict_call(model, &state, 0);
        if (!acceptable_call(&state, predicted)) {
            update_model(model, &state, target, predicted);
            ++mistakes;
        }
        if (target.tool == R36_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    return mistakes;
}

static uint32_t training_epoch(R36Model *model, int domain_filter)
{
    uint32_t mistakes = 0;
    uint8_t domain, stages, variant, permutation, order;
    R36Episode episode;
    for (domain = 0; domain < R36_DOMAIN_COUNT; ++domain) {
        if (domain_filter >= 0 && domain != (uint8_t)domain_filter)
            continue;
        for (stages = 1; stages <= 3; ++stages)
            for (variant = 0; variant < 6; ++variant)
                for (permutation = 0; permutation < 2; ++permutation) {
                    make_episode(&domain, 1, stages, variant, permutation,
                                 &episode);
                    mistakes += train_episode(model, &episode);
                }
    }
    if (domain_filter < 0) {
        for (order = 0; order < 6; ++order)
            for (variant = 0; variant < 6; ++variant)
                for (permutation = 0; permutation < 2; ++permutation) {
                    make_episode(mixed_orders[order], R36_DOMAIN_COUNT, 3,
                                 variant, permutation, &episode);
                    mistakes += train_episode(model, &episode);
                }
    }
    return mistakes;
}

static uint32_t episode_errors(const R36Model *model,
                               const R36Episode *episode,
                               uint8_t feedback_shift)
{
    R36State state = {episode, 0, 0};
    uint32_t errors = 0;
    while (1) {
        R36Call target = oracle_call(&state);
        R36Call predicted = predict_call(model, &state, feedback_shift);
        if (!acceptable_call(&state, predicted)) ++errors;
        if (target.tool == R36_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    return errors;
}

static uint32_t training_errors(const R36Model *model, int domain_filter)
{
    uint32_t errors = 0;
    uint8_t domain, stages, variant, permutation, order;
    R36Episode episode;
    for (domain = 0; domain < R36_DOMAIN_COUNT; ++domain) {
        if (domain_filter >= 0 && domain != (uint8_t)domain_filter)
            continue;
        for (stages = 1; stages <= 3; ++stages)
            for (variant = 0; variant < 6; ++variant)
                for (permutation = 0; permutation < 2; ++permutation) {
                    make_episode(&domain, 1, stages, variant, permutation,
                                 &episode);
                    errors += episode_errors(model, &episode, 0);
                }
    }
    if (domain_filter < 0) {
        for (order = 0; order < 6; ++order)
            for (variant = 0; variant < 6; ++variant)
                for (permutation = 0; permutation < 2; ++permutation) {
                    make_episode(mixed_orders[order], R36_DOMAIN_COUNT, 3,
                                 variant, permutation, &episode);
                    errors += episode_errors(model, &episode, 0);
                }
    }
    return errors;
}

static R0Status train_model(R36Model *model, int domain_filter,
                            uint32_t *epochs, uint32_t *mistakes,
                            uint32_t *errors, char *error,
                            size_t error_capacity)
{
    uint32_t epoch;
    memset(model, 0, sizeof(*model));
    *epochs = 0;
    *mistakes = 0;
    *errors = UINT32_MAX;
    for (epoch = 0; epoch < R36_MAX_EPOCHS; ++epoch) {
        *mistakes += training_epoch(model, domain_filter);
        ++*epochs;
        *errors = training_errors(model, domain_filter);
        if (*errors == 0) return R0_OK;
    }
    set_error(error, error_capacity,
              "task-blind tool policy did not converge");
    return R0_POLICY_ERROR;
}

static void evaluate_episode(const R36Model *model,
                             const R36Episode *episode,
                             uint8_t feedback_shift,
                             R36Evaluation *report)
{
    R36State state = {episode, 0, 0};
    uint8_t episode_exact = 1;
    ++report->episodes;
    report->mixed_episodes += episode->mixed;
    while (1) {
        R36Call target = oracle_call(&state);
        R36Call predicted = predict_call(model, &state, feedback_shift);
        ++report->decisions;
        if (acceptable_call(&state, predicted)) {
            ++report->exact_decisions;
        } else {
            episode_exact = 0;
        }
        if (target.tool == R36_TOOL_QUERY)
            ++report->queries;
        else if (target.tool == R36_TOOL_APPLY)
            ++report->applies;
        else
            ++report->commits;
        if (target.tool == R36_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    report->handle_permutations += episode->stage_count;
    if (episode_exact)
        report->handle_permutations_exact += episode->stage_count;
}

static void evaluate_open(const R36Model *model, int domain_filter,
                          uint8_t feedback_shift, R36Evaluation *report)
{
    uint8_t domain, variant, permutation, order;
    R36Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R36_DOMAIN_COUNT; ++domain) {
        if (domain_filter >= 0 && domain != (uint8_t)domain_filter)
            continue;
        for (variant = 6; variant < 12; ++variant)
            for (permutation = 0; permutation < 4; ++permutation) {
                make_episode(&domain, 1, 4, variant, permutation,
                             &episode);
                evaluate_episode(model, &episode, feedback_shift, report);
            }
    }
    if (domain_filter < 0) {
        for (order = 0; order < 6; ++order)
            for (variant = 6; variant < 12; ++variant)
                for (permutation = 0; permutation < 4; ++permutation) {
                    make_episode(mixed_orders[order], R36_DOMAIN_COUNT, 4,
                                 variant, permutation, &episode);
                    evaluate_episode(model, &episode, feedback_shift,
                                     report);
                }
    }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
}

static void evaluate_sealed(const R36Model *model, R36Evaluation *report)
{
    uint8_t domain, stages, variant, permutation, order;
    R36Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R36_DOMAIN_COUNT; ++domain)
        for (stages = 5; stages <= 7; ++stages)
            for (variant = 12; variant < 24; ++variant)
                for (permutation = 0; permutation < 8; ++permutation) {
                    make_episode(&domain, 1, stages, variant, permutation,
                                 &episode);
                    evaluate_episode(model, &episode, 0, report);
                }
    for (order = 0; order < 6; ++order)
        for (stages = 5; stages <= 7; ++stages)
            for (variant = 12; variant < 24; ++variant)
                for (permutation = 0; permutation < 8; ++permutation) {
                    make_episode(mixed_orders[order], R36_DOMAIN_COUNT,
                                 stages, variant, permutation, &episode);
                    evaluate_episode(model, &episode, 0, report);
                }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
}

static uint8_t run_routed_control(char *error, size_t error_capacity)
{
    uint8_t domain;
    for (domain = 0; domain < R36_DOMAIN_COUNT; ++domain) {
        R36Model model;
        R36Evaluation evaluation;
        uint32_t epochs, mistakes, errors;
        if (train_model(&model, domain, &epochs, &mistakes, &errors,
                        error, error_capacity) != R0_OK)
            return 0;
        evaluate_open(&model, domain, 0, &evaluation);
        if (!evaluation.exact) return 0;
    }
    return 1;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (byte * 8));
        hash *= R36_FNV_PRIME;
    }
    return hash;
}

static uint64_t experiment_digest(const R36ExperimentReport *report)
{
    uint64_t hash = R36_FNV_OFFSET;
    uint8_t feature;
    hash = digest_u64(hash, report->epochs);
    hash = digest_u64(hash, report->mistakes);
    hash = digest_u64(hash, report->training_errors);
    for (feature = 0; feature < R36_FEATURE_COUNT; ++feature)
        hash = digest_u64(hash,
                          (uint64_t)(uint32_t)report->weights[feature]);
    hash = digest_u64(hash, report->development.episodes);
    hash = digest_u64(hash, report->development.decisions);
    hash = digest_u64(hash, report->development.exact_decisions);
    hash = digest_u64(hash, report->sealed.episodes);
    hash = digest_u64(hash, report->sealed.decisions);
    hash = digest_u64(hash, report->sealed.exact_decisions);
    hash = digest_u64(hash, report->routed_control_passed);
    hash = digest_u64(hash, report->zero_control_passed);
    hash = digest_u64(hash, report->shuffled_feedback_passed);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R0Status r36_run_development(R36ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R36Model model;
    R36Model zero;
    R36Evaluation zero_evaluation;
    R36Evaluation shuffled_evaluation;
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = train_model(&model, -1, &report->epochs, &report->mistakes,
                         &report->training_errors, error,
                         error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->weights, model.weights, sizeof(report->weights));
    evaluate_open(&model, -1, 0, &report->development);
    report->routed_control_passed =
        run_routed_control(error, error_capacity);
    memset(&zero, 0, sizeof(zero));
    evaluate_open(&zero, -1, 0, &zero_evaluation);
    report->zero_control_passed = zero_evaluation.exact;
    evaluate_open(&model, -1, 1, &shuffled_evaluation);
    report->shuffled_feedback_passed = shuffled_evaluation.exact;
    report->shared_policy_bytes = R36_POLICY_BYTES;
    report->routed_control_bytes = R36_DOMAIN_COUNT * R36_POLICY_BYTES;
    report->development_gate_passed =
        (uint8_t)(report->development.exact &&
                  report->routed_control_passed &&
                  !report->zero_control_passed &&
                  !report->shuffled_feedback_passed);
    report->result_digest = experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "Reasoner (3,5) development gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r36_run_sealed(R36ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R36Model model;
    R0Status status = r36_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(model.weights, report->weights, sizeof(model.weights));
    evaluate_sealed(&model, &report->sealed);
    report->sealed_gate_passed = report->sealed.exact;
    report->result_digest = experiment_digest(report);
    return R0_OK;
}

R0Status r36_write_result(const R36ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    uint8_t feature;
    if (report == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    if (fprintf(file,
                "{\n  \"schema\": \"zero.reasoner36_task_blind_tools.v1\",\n"
                "  \"version\": \"(3,5)\",\n"
                "  \"shared_policy_bytes\": %u,\n"
                "  \"routed_control_bytes\": %u,\n"
                "  \"development_gate_passed\": %s,\n"
                "  \"sealed_gate_passed\": %s,\n"
                "  \"training\": {\"epochs\": %u, \"mistakes\": %u, "
                "\"errors\": %u},\n"
                "  \"development\": {\"episodes\": %u, "
                "\"mixed_episodes\": %u, \"decisions\": %u, "
                "\"exact_decisions\": %u, \"queries\": %u, "
                "\"applies\": %u, \"commits\": %u, \"exact\": %s},\n"
                "  \"sealed\": {\"episodes\": %u, "
                "\"mixed_episodes\": %u, \"decisions\": %u, "
                "\"exact_decisions\": %u, "
                "\"handle_permutations\": %u, "
                "\"handle_permutations_exact\": %u, "
                "\"exact\": %s},\n"
                "  \"routed_control_passed\": %s,\n"
                "  \"zero_control_passed\": %s,\n"
                "  \"shuffled_feedback_passed\": %s,\n"
                "  \"weights\": [",
                report->shared_policy_bytes, report->routed_control_bytes,
                report->development_gate_passed ? "true" : "false",
                report->sealed_gate_passed ? "true" : "false",
                report->epochs, report->mistakes,
                report->training_errors, report->development.episodes,
                report->development.mixed_episodes,
                report->development.decisions,
                report->development.exact_decisions,
                report->development.queries, report->development.applies,
                report->development.commits,
                report->development.exact ? "true" : "false",
                report->sealed.episodes, report->sealed.mixed_episodes,
                report->sealed.decisions, report->sealed.exact_decisions,
                report->sealed.handle_permutations,
                report->sealed.handle_permutations_exact,
                report->sealed.exact ? "true" : "false",
                report->routed_control_passed ? "true" : "false",
                report->zero_control_passed ? "true" : "false",
                report->shuffled_feedback_passed ? "true" : "false") < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (feature = 0; feature < R36_FEATURE_COUNT; ++feature)
        if (fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                    report->weights[feature]) < 0) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
    if (fprintf(file,
                "],\n  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
                report->result_digest) < 0 || fclose(file) != 0) {
        set_error(error, error_capacity, "cannot write %s", path);
        return R0_IO_ERROR;
    }
    return R0_OK;
}
