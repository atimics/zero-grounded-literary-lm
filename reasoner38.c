#include "reasoner38.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define R38_FNV_OFFSET UINT64_C(1469598103934665603)
#define R38_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    int16_t error_code;
    int16_t values[R38_MAX_DIMENSIONS];
} R38RawCandidate;

typedef struct {
    uint8_t domain;
    uint8_t dimension;
    uint8_t candidate_count;
    int16_t current[R38_MAX_DIMENSIONS];
    int16_t goal[R38_MAX_DIMENSIONS];
    R38RawCandidate candidates[R38_MAX_CANDIDATES];
} R38Stage;

typedef struct {
    uint8_t stage_count;
    uint8_t mixed;
    int8_t translation;
    int8_t sign;
    R38Stage stages[R38_MAX_STAGES];
} R38Episode;

typedef struct {
    const R38Episode *episode;
    uint8_t stage;
    uint8_t queried;
} R38State;

typedef struct {
    R38Tool tool;
    uint8_t argument;
} R38Call;

typedef struct {
    R38Call items[R38_MAX_CALLS];
    uint8_t count;
} R38Calls;

typedef struct {
    int32_t weights[R38_FEATURE_COUNT];
} R38Model;

enum {
    R38_PREDICT_MODEL = 0,
    R38_PREDICT_ORACLE = 1,
    R38_PREDICT_DIMENSION_LOOKUP = 2
};

static const uint8_t mixed_orders[6][R38_DOMAIN_COUNT] = {
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

static uint8_t permuted_index(uint8_t index, uint8_t count,
                              uint8_t permutation)
{
    if ((permutation & 1u) == 0u)
        return (uint8_t)((index + permutation) % count);
    return (uint8_t)((count - 1u - index + permutation) % count);
}

static int8_t translation_for_variant(uint8_t variant)
{
    if (variant < 24)
        return (int8_t)((int)(variant % 17u) - 8);
    if (variant < 30)
        return (int8_t)(3 * ((int)(variant % 3u) - 1));
    return (int8_t)(2 * ((int)(variant % 5u) - 2));
}

static void make_stage(uint8_t domain, uint8_t dimension,
                       uint8_t stage_index, uint8_t variant,
                       uint8_t handle_permutation,
                       uint8_t coordinate_permutation,
                       int8_t translation, int8_t sign,
                       R38Stage *stage)
{
    int16_t current[R38_MAX_DIMENSIONS] = {0};
    int16_t goal[R38_MAX_DIMENSIONS] = {0};
    R38RawCandidate base[R38_MAX_CANDIDATES];
    uint32_t seed = mix32((uint32_t)domain * 2017u +
                          (uint32_t)dimension * 509u +
                          (uint32_t)stage_index * 131u +
                          (uint32_t)variant * 43u + 19u);
    uint8_t count = (uint8_t)(3u + seed % 3u);
    uint8_t best = (uint8_t)((seed >> 4) % count);
    uint8_t invalid = (uint8_t)((best + 1u) % count);
    uint8_t alternate = (uint8_t)((best + 2u) % count);
    uint8_t candidate, coordinate;
    memset(stage, 0, sizeof(*stage));
    memset(base, 0, sizeof(base));
    stage->domain = domain;
    stage->dimension = dimension;
    stage->candidate_count = count;
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        uint32_t local = mix32(seed + coordinate * 103u);
        int16_t direction = (int16_t)(((local >> 5) & 1u) ? -1 : 1);
        current[coordinate] = (int16_t)((int)(local % 7u) - 3);
        goal[coordinate] =
            (int16_t)(current[coordinate] +
                      direction * (int16_t)(1u + (local >> 9) % 3u));
    }
    for (candidate = 0; candidate < count; ++candidate) {
        uint8_t first = (uint8_t)((candidate + domain) % dimension);
        uint8_t second = (uint8_t)((first + 1u) % dimension);
        int16_t magnitude = (int16_t)(2u + candidate % 3u);
        for (coordinate = 0; coordinate < dimension; ++coordinate)
            base[candidate].values[coordinate] = goal[coordinate];
        base[candidate].values[first] =
            (int16_t)(base[candidate].values[first] + magnitude);
        if ((candidate + variant) % 2u == 0u)
            base[candidate].values[second] =
                (int16_t)(base[candidate].values[second] - 1);
    }
    for (coordinate = 0; coordinate < dimension; ++coordinate)
        base[best].values[coordinate] = goal[coordinate];
    base[invalid] = base[best];
    base[invalid].error_code = (int16_t)(1u + seed % 2u);
    if (domain == 2 && (variant + stage_index) % 2u == 0u) {
        for (coordinate = 0; coordinate < dimension; ++coordinate) {
            base[best].values[coordinate] = goal[coordinate];
            base[alternate].values[coordinate] = goal[coordinate];
        }
        base[best].values[0] = (int16_t)(goal[0] + 1);
        base[alternate].values[1] = (int16_t)(goal[1] - 1);
        base[alternate].error_code = 0;
    }
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        uint8_t field = permuted_index(
            coordinate, dimension, coordinate_permutation);
        stage->current[field] =
            (int16_t)(sign * current[coordinate] + translation);
        stage->goal[field] =
            (int16_t)(sign * goal[coordinate] + translation);
    }
    for (candidate = 0; candidate < count; ++candidate) {
        uint8_t handle = permuted_index(
            candidate, count, handle_permutation);
        stage->candidates[handle].error_code =
            base[candidate].error_code;
        for (coordinate = 0; coordinate < dimension; ++coordinate) {
            uint8_t field = permuted_index(
                coordinate, dimension, coordinate_permutation);
            stage->candidates[handle].values[field] =
                (int16_t)(sign * base[candidate].values[coordinate] +
                          translation);
        }
    }
}

static void make_episode(const uint8_t *order, uint8_t order_count,
                         uint8_t dimension, uint8_t stage_count,
                         uint8_t variant, uint8_t handle_permutation,
                         uint8_t coordinate_permutation,
                         R38Episode *episode)
{
    uint8_t stage;
    memset(episode, 0, sizeof(*episode));
    episode->stage_count = stage_count;
    episode->mixed = (uint8_t)(order_count > 1);
    episode->translation = translation_for_variant(variant);
    episode->sign = (int8_t)((variant & 1u) == 0u ? 1 : -1);
    for (stage = 0; stage < stage_count; ++stage)
        make_stage(order[stage % order_count], dimension, stage, variant,
                   (uint8_t)(handle_permutation + stage),
                   (uint8_t)(coordinate_permutation + stage),
                   episode->translation, episode->sign,
                   &episode->stages[stage]);
}

static uint8_t terminal(const R38State *state)
{
    return (uint8_t)(state->stage >= state->episode->stage_count);
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

static uint8_t all_queried(const R38State *state)
{
    uint8_t count;
    uint8_t mask;
    if (terminal(state)) return 1;
    count = state->episode->stages[state->stage].candidate_count;
    mask = (uint8_t)((1u << count) - 1u);
    return (uint8_t)((state->queried & mask) == mask);
}

static void enumerate_calls(const R38State *state, R38Calls *calls)
{
    uint8_t candidate;
    calls->count = 0;
    if (terminal(state)) {
        calls->items[0].tool = R38_TOOL_COMMIT;
        calls->items[0].argument = 0;
        calls->count = 1;
        return;
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
            calls->items[calls->count].tool = R38_TOOL_QUERY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) != 0) {
            calls->items[calls->count].tool = R38_TOOL_APPLY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    calls->items[calls->count].tool = R38_TOOL_COMMIT;
    calls->items[calls->count].argument = 0;
    ++calls->count;
}

static uint32_t candidate_distance(const R38Stage *stage,
                                   uint8_t candidate)
{
    const R38RawCandidate *item = &stage->candidates[candidate];
    uint32_t distance = 0;
    uint8_t coordinate;
    if (item->error_code != 0) return UINT32_MAX;
    for (coordinate = 0; coordinate < stage->dimension; ++coordinate) {
        int32_t difference =
            (int32_t)item->values[coordinate] - stage->goal[coordinate];
        distance += (uint32_t)(difference * difference);
    }
    return distance;
}

static R38Call oracle_call(const R38State *state)
{
    R38Call call = {R38_TOOL_COMMIT, 0};
    const R38Stage *stage;
    uint32_t best_distance = UINT32_MAX;
    uint8_t candidate;
    if (terminal(state)) return call;
    stage = &state->episode->stages[state->stage];
    if (!all_queried(state)) {
        call.tool = R38_TOOL_QUERY;
        for (candidate = 0; candidate < stage->candidate_count;
             ++candidate) {
            if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
                call.argument = candidate;
                return call;
            }
        }
    }
    call.tool = R38_TOOL_APPLY;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        uint32_t distance = candidate_distance(stage, candidate);
        if (distance < best_distance) {
            best_distance = distance;
            call.argument = candidate;
        }
    }
    return call;
}

static uint8_t acceptable_call(const R38State *state, R38Call call)
{
    R38Call oracle = oracle_call(state);
    if (call.tool != oracle.tool) return 0;
    if (call.tool == R38_TOOL_COMMIT) return 1;
    if (call.tool == R38_TOOL_QUERY)
        return (uint8_t)((state->queried &
                          (uint8_t)(1u << call.argument)) == 0);
    return (uint8_t)(candidate_distance(
                         &state->episode->stages[state->stage],
                         call.argument) ==
                     candidate_distance(
                         &state->episode->stages[state->stage],
                         oracle.argument));
}

static R38RawCandidate observed_candidate(const R38State *state,
                                          uint8_t argument,
                                          uint8_t feedback_shift)
{
    const R38Stage *stage = &state->episode->stages[state->stage];
    uint8_t index = argument;
    if (feedback_shift != 0)
        index = (uint8_t)((argument + feedback_shift) %
                          stage->candidate_count);
    return stage->candidates[index];
}

static int16_t checked_feature(int32_t value)
{
    if (value < INT16_MIN) return INT16_MIN;
    if (value > INT16_MAX) return INT16_MAX;
    return (int16_t)value;
}

static void encode_call(const R38State *state, R38Call call,
                        uint8_t feedback_shift, uint8_t quadratic,
                        int16_t features[R38_FEATURE_COUNT])
{
    uint8_t done = terminal(state);
    uint8_t ready = 1;
    uint8_t unqueried = 0;
    int32_t candidate_sum = 0, candidate_square = 0;
    int32_t goal_sum = 0, goal_square = 0, candidate_goal = 0;
    int32_t current_sum = 0, current_square = 0, current_candidate = 0;
    int16_t error_code = 0;
    memset(features, 0, sizeof(int16_t) * R38_FEATURE_COUNT);
    if (!done) {
        const R38Stage *stage = &state->episode->stages[state->stage];
        uint8_t coordinate;
        unqueried = (uint8_t)(stage->candidate_count -
                              bit_count(state->queried));
        ready = all_queried(state);
        if (call.tool == R38_TOOL_APPLY && ready) {
            R38RawCandidate candidate = observed_candidate(
                state, call.argument, feedback_shift);
            error_code = candidate.error_code;
            for (coordinate = 0; coordinate < stage->dimension;
                 ++coordinate) {
                int32_t value = candidate.values[coordinate];
                int32_t goal = stage->goal[coordinate];
                int32_t current = stage->current[coordinate];
                candidate_sum += value;
                candidate_square += value * value;
                goal_sum += goal;
                goal_square += goal * goal;
                candidate_goal += value * goal;
                current_sum += current;
                current_square += current * current;
                current_candidate += current * value;
            }
        }
    }
    features[0] = 1;
    features[1] = (int16_t)(call.tool == R38_TOOL_QUERY && unqueried > 0);
    features[2] = (int16_t)(call.tool == R38_TOOL_APPLY && ready);
    features[3] = (int16_t)(call.tool == R38_TOOL_COMMIT && done);
    features[4] = (int16_t)(call.tool == R38_TOOL_QUERY);
    features[5] = (int16_t)(call.tool == R38_TOOL_APPLY);
    features[6] = (int16_t)(call.tool == R38_TOOL_COMMIT);
    features[7] = error_code;
    features[8] = checked_feature(candidate_sum);
    features[9] = quadratic ? checked_feature(candidate_square) : 0;
    features[10] = checked_feature(goal_sum);
    features[11] = quadratic ? checked_feature(goal_square) : 0;
    features[12] = quadratic ? checked_feature(candidate_goal) : 0;
    features[13] = checked_feature(current_sum);
    features[14] = quadratic ? checked_feature(current_square) : 0;
    features[15] = quadratic ? checked_feature(current_candidate) : 0;
}

static int64_t score_call(const R38Model *model,
                          const int16_t features[R38_FEATURE_COUNT])
{
    int64_t score = 0;
    uint8_t feature;
    for (feature = 0; feature < R38_FEATURE_COUNT; ++feature)
        score += (int64_t)model->weights[feature] * features[feature];
    return score;
}

static R38Call predict_call(const R38Model *model, const R38State *state,
                            uint8_t feedback_shift, uint8_t quadratic,
                            uint8_t mode)
{
    R38Calls calls;
    R38Call best = {R38_TOOL_COMMIT, 0};
    int64_t best_score = INT64_MIN;
    uint8_t index;
    if (mode == R38_PREDICT_ORACLE) return oracle_call(state);
    enumerate_calls(state, &calls);
    if (mode == R38_PREDICT_DIMENSION_LOOKUP && !terminal(state) &&
        state->episode->stages[state->stage].dimension > 3)
        return calls.items[0];
    for (index = 0; index < calls.count; ++index) {
        int16_t features[R38_FEATURE_COUNT];
        int64_t score;
        encode_call(state, calls.items[index], feedback_shift, quadratic,
                    features);
        score = score_call(model, features);
        if (score > best_score) {
            best = calls.items[index];
            best_score = score;
        }
    }
    return best;
}

static void execute_call(R38State *state, R38Call call)
{
    if (call.tool == R38_TOOL_QUERY) {
        state->queried |= (uint8_t)(1u << call.argument);
    } else if (call.tool == R38_TOOL_APPLY) {
        ++state->stage;
        state->queried = 0;
    }
}

static void update_model(R38Model *model, const R38State *state,
                         R38Call target, R38Call predicted,
                         uint8_t quadratic)
{
    int16_t target_features[R38_FEATURE_COUNT];
    int16_t predicted_features[R38_FEATURE_COUNT];
    uint8_t feature;
    encode_call(state, target, 0, quadratic, target_features);
    encode_call(state, predicted, 0, quadratic, predicted_features);
    for (feature = 0; feature < R38_FEATURE_COUNT; ++feature)
        model->weights[feature] +=
            target_features[feature] - predicted_features[feature];
}

static uint32_t train_episode(R38Model *model,
                              const R38Episode *episode,
                              uint8_t quadratic)
{
    R38State state = {episode, 0, 0};
    uint32_t mistakes = 0;
    while (1) {
        R38Call target = oracle_call(&state);
        R38Call predicted = predict_call(
            model, &state, 0, quadratic, R38_PREDICT_MODEL);
        if (!acceptable_call(&state, predicted)) {
            update_model(model, &state, target, predicted, quadratic);
            ++mistakes;
        }
        if (target.tool == R38_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    return mistakes;
}

static uint32_t training_epoch(R38Model *model, uint8_t quadratic)
{
    uint32_t mistakes = 0;
    uint8_t domain, dimension, stages, variant, handle, coordinate, order;
    R38Episode episode;
    for (domain = 0; domain < R38_DOMAIN_COUNT; ++domain)
        for (dimension = 2; dimension <= 3; ++dimension)
            for (stages = 1; stages <= 3; ++stages)
                for (variant = 0; variant < 24; ++variant)
                    for (handle = 0; handle < 2; ++handle)
                        for (coordinate = 0; coordinate < 2;
                             ++coordinate) {
                            make_episode(&domain, 1, dimension, stages,
                                         variant, handle, coordinate,
                                         &episode);
                            mistakes += train_episode(
                                model, &episode, quadratic);
                        }
    for (order = 0; order < 6; ++order)
        for (dimension = 2; dimension <= 3; ++dimension)
            for (variant = 0; variant < 24; ++variant)
                for (handle = 0; handle < 2; ++handle)
                    for (coordinate = 0; coordinate < 2; ++coordinate) {
                        make_episode(mixed_orders[order], R38_DOMAIN_COUNT,
                                     dimension, 3, variant, handle,
                                     coordinate, &episode);
                        mistakes += train_episode(model, &episode,
                                                  quadratic);
                    }
    return mistakes;
}

static uint32_t episode_errors(const R38Model *model,
                               const R38Episode *episode,
                               uint8_t quadratic)
{
    R38State state = {episode, 0, 0};
    uint32_t errors = 0;
    while (1) {
        R38Call target = oracle_call(&state);
        R38Call predicted = predict_call(
            model, &state, 0, quadratic, R38_PREDICT_MODEL);
        if (!acceptable_call(&state, predicted)) ++errors;
        if (target.tool == R38_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    return errors;
}

static uint32_t training_errors(const R38Model *model,
                                uint8_t quadratic)
{
    uint32_t errors = 0;
    uint8_t domain, dimension, stages, variant, handle, coordinate, order;
    R38Episode episode;
    for (domain = 0; domain < R38_DOMAIN_COUNT; ++domain)
        for (dimension = 2; dimension <= 3; ++dimension)
            for (stages = 1; stages <= 3; ++stages)
                for (variant = 0; variant < 24; ++variant)
                    for (handle = 0; handle < 2; ++handle)
                        for (coordinate = 0; coordinate < 2;
                             ++coordinate) {
                            make_episode(&domain, 1, dimension, stages,
                                         variant, handle, coordinate,
                                         &episode);
                            errors += episode_errors(
                                model, &episode, quadratic);
                        }
    for (order = 0; order < 6; ++order)
        for (dimension = 2; dimension <= 3; ++dimension)
            for (variant = 0; variant < 24; ++variant)
                for (handle = 0; handle < 2; ++handle)
                    for (coordinate = 0; coordinate < 2; ++coordinate) {
                        make_episode(mixed_orders[order], R38_DOMAIN_COUNT,
                                     dimension, 3, variant, handle,
                                     coordinate, &episode);
                        errors += episode_errors(model, &episode,
                                                 quadratic);
                    }
    return errors;
}

static R0Status train_model(R38Model *model, uint8_t quadratic,
                            uint8_t require_convergence,
                            uint32_t maximum_epochs, uint32_t *epochs,
                            uint32_t *mistakes, uint32_t *errors,
                            char *error, size_t error_capacity)
{
    uint32_t epoch;
    memset(model, 0, sizeof(*model));
    *epochs = 0;
    *mistakes = 0;
    *errors = UINT32_MAX;
    for (epoch = 0; epoch < maximum_epochs; ++epoch) {
        *mistakes += training_epoch(model, quadratic);
        ++*epochs;
        *errors = training_errors(model, quadratic);
        if (*errors == 0) return R0_OK;
    }
    if (!require_convergence) return R0_OK;
    set_error(error, error_capacity,
              "raw-observation policy did not converge");
    return R0_POLICY_ERROR;
}

static void evaluate_episode(const R38Model *model,
                             const R38Episode *episode,
                             uint8_t feedback_shift, uint8_t quadratic,
                             uint8_t mode, R38Evaluation *report)
{
    R38State state = {episode, 0, 0};
    uint8_t episode_exact = 1;
    ++report->episodes;
    report->mixed_episodes += episode->mixed;
    report->translated_episodes += (uint8_t)(episode->translation != 0);
    report->sign_flipped_episodes += (uint8_t)(episode->sign < 0);
    while (1) {
        R38Call target = oracle_call(&state);
        R38Call predicted = predict_call(
            model, &state, feedback_shift, quadratic, mode);
        ++report->decisions;
        if (acceptable_call(&state, predicted)) {
            ++report->exact_decisions;
        } else {
            episode_exact = 0;
        }
        if (target.tool == R38_TOOL_QUERY)
            ++report->queries;
        else if (target.tool == R38_TOOL_APPLY)
            ++report->applies;
        else
            ++report->commits;
        if (target.tool == R38_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    report->coordinate_permutations += episode->stage_count;
    if (episode_exact)
        report->coordinate_permutations_exact += episode->stage_count;
}

static void evaluate_open(const R38Model *model, uint8_t feedback_shift,
                          uint8_t quadratic, uint8_t mode,
                          R38Evaluation *report)
{
    uint8_t domain, dimension, variant, handle, coordinate, order;
    R38Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R38_DOMAIN_COUNT; ++domain)
        for (dimension = 4; dimension <= 5; ++dimension)
            for (variant = 24; variant < 30; ++variant)
                for (handle = 0; handle < 4; ++handle)
                    for (coordinate = 0; coordinate < 4; ++coordinate) {
                        make_episode(&domain, 1, dimension, 4, variant,
                                     handle, coordinate, &episode);
                        evaluate_episode(model, &episode, feedback_shift,
                                         quadratic, mode, report);
                    }
    for (order = 0; order < 6; ++order)
        for (dimension = 4; dimension <= 5; ++dimension)
            for (variant = 24; variant < 30; ++variant)
                for (handle = 0; handle < 4; ++handle)
                    for (coordinate = 0; coordinate < 4; ++coordinate) {
                        make_episode(mixed_orders[order], R38_DOMAIN_COUNT,
                                     dimension, 4, variant, handle,
                                     coordinate, &episode);
                        evaluate_episode(model, &episode, feedback_shift,
                                         quadratic, mode, report);
                    }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
}

static void evaluate_sealed(const R38Model *model,
                            R38Evaluation *report)
{
    uint8_t domain, dimension, stages, variant, handle, coordinate, order;
    R38Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R38_DOMAIN_COUNT; ++domain)
        for (dimension = 6; dimension <= 8; ++dimension)
            for (stages = 5; stages <= 7; ++stages)
                for (variant = 30; variant < 42; ++variant)
                    for (handle = 0; handle < 4; ++handle)
                        for (coordinate = 0; coordinate < 4;
                             ++coordinate) {
                            make_episode(&domain, 1, dimension, stages,
                                         variant, handle, coordinate,
                                         &episode);
                            evaluate_episode(
                                model, &episode, 0, 1,
                                R38_PREDICT_MODEL, report);
                        }
    for (order = 0; order < 6; ++order)
        for (dimension = 6; dimension <= 8; ++dimension)
            for (stages = 5; stages <= 7; ++stages)
                for (variant = 30; variant < 42; ++variant)
                    for (handle = 0; handle < 4; ++handle)
                        for (coordinate = 0; coordinate < 4;
                             ++coordinate) {
                            make_episode(mixed_orders[order],
                                         R38_DOMAIN_COUNT, dimension,
                                         stages, variant, handle,
                                         coordinate, &episode);
                            evaluate_episode(
                                model, &episode, 0, 1,
                                R38_PREDICT_MODEL, report);
                        }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (byte * 8));
        hash *= R38_FNV_PRIME;
    }
    return hash;
}

static uint64_t experiment_digest(const R38ExperimentReport *report)
{
    uint64_t hash = R38_FNV_OFFSET;
    uint8_t feature;
    hash = digest_u64(hash, report->epochs);
    hash = digest_u64(hash, report->mistakes);
    hash = digest_u64(hash, report->training_errors);
    for (feature = 0; feature < R38_FEATURE_COUNT; ++feature)
        hash = digest_u64(hash,
                          (uint64_t)(uint32_t)report->weights[feature]);
    hash = digest_u64(hash, report->development.episodes);
    hash = digest_u64(hash, report->development.decisions);
    hash = digest_u64(hash, report->development.exact_decisions);
    hash = digest_u64(hash, report->sealed.episodes);
    hash = digest_u64(hash, report->sealed.decisions);
    hash = digest_u64(hash, report->sealed.exact_decisions);
    hash = digest_u64(hash, report->semantic_oracle_passed);
    hash = digest_u64(hash, report->zero_control_passed);
    hash = digest_u64(hash, report->shuffled_raw_feedback_passed);
    hash = digest_u64(hash, report->linear_ablation_passed);
    hash = digest_u64(hash, report->dimension_lookup_passed);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R0Status r38_run_development(R38ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R38Model model, zero, linear;
    R38Evaluation oracle_evaluation, zero_evaluation;
    R38Evaluation shuffled_evaluation, linear_evaluation;
    R38Evaluation lookup_evaluation;
    uint32_t ignored_epochs, ignored_mistakes, ignored_errors;
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = train_model(&model, 1, 1, R38_MAX_EPOCHS,
                         &report->epochs, &report->mistakes,
                         &report->training_errors, error,
                         error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->weights, model.weights, sizeof(report->weights));
    evaluate_open(&model, 0, 1, R38_PREDICT_MODEL,
                  &report->development);
    evaluate_open(&model, 0, 1, R38_PREDICT_ORACLE,
                  &oracle_evaluation);
    report->semantic_oracle_passed = oracle_evaluation.exact;
    memset(&zero, 0, sizeof(zero));
    evaluate_open(&zero, 0, 1, R38_PREDICT_MODEL,
                  &zero_evaluation);
    report->zero_control_passed = zero_evaluation.exact;
    evaluate_open(&model, 1, 1, R38_PREDICT_MODEL,
                  &shuffled_evaluation);
    report->shuffled_raw_feedback_passed = shuffled_evaluation.exact;
    status = train_model(&linear, 0, 0, 32, &ignored_epochs,
                         &ignored_mistakes, &ignored_errors, error,
                         error_capacity);
    if (status != R0_OK) return status;
    evaluate_open(&linear, 0, 0, R38_PREDICT_MODEL,
                  &linear_evaluation);
    report->linear_ablation_passed = linear_evaluation.exact;
    evaluate_open(&model, 0, 1, R38_PREDICT_DIMENSION_LOOKUP,
                  &lookup_evaluation);
    report->dimension_lookup_passed = lookup_evaluation.exact;
    report->policy_bytes = R38_POLICY_BYTES;
    report->development_gate_passed =
        (uint8_t)(report->development.exact &&
                  report->semantic_oracle_passed &&
                  !report->zero_control_passed &&
                  !report->shuffled_raw_feedback_passed &&
                  !report->linear_ablation_passed &&
                  !report->dimension_lookup_passed);
    report->result_digest = experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "Reasoner (3,7) development gate failed: "
                  "policy=%u oracle=%u zero=%u shuffled=%u linear=%u "
                  "lookup=%u exact=%u/%u epochs=%u errors=%u "
                  "w=[%d,%d,%d,%d,%d,%d,%d,%d]",
                  report->development.exact,
                  report->semantic_oracle_passed,
                  report->zero_control_passed,
                  report->shuffled_raw_feedback_passed,
                  report->linear_ablation_passed,
                  report->dimension_lookup_passed,
                  report->development.exact_decisions,
                  report->development.decisions,
                  report->epochs, report->training_errors,
                  report->weights[2], report->weights[4],
                  report->weights[5], report->weights[6],
                  report->weights[7], report->weights[9],
                  report->weights[11], report->weights[12]);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r38_run_sealed(R38ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R38Model model;
    R0Status status = r38_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(model.weights, report->weights, sizeof(model.weights));
    evaluate_sealed(&model, &report->sealed);
    report->sealed_gate_passed = report->sealed.exact;
    report->result_digest = experiment_digest(report);
    return R0_OK;
}

R0Status r38_write_result(const R38ExperimentReport *report,
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
    if (fprintf(
            file,
            "{\n  \"schema\": \"zero.reasoner38_raw_observation.v1\",\n"
            "  \"version\": \"(3,7)\",\n"
            "  \"policy_bytes\": %u,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"training\": {\"epochs\": %u, \"mistakes\": %u, "
            "\"errors\": %u},\n"
            "  \"development\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"decisions\": %u, "
            "\"exact_decisions\": %u, \"coordinate_permutations\": %u, "
            "\"coordinate_permutations_exact\": %u, "
            "\"translated_episodes\": %u, "
            "\"sign_flipped_episodes\": %u, \"exact\": %s},\n"
            "  \"sealed\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"decisions\": %u, "
            "\"exact_decisions\": %u, \"coordinate_permutations\": %u, "
            "\"coordinate_permutations_exact\": %u, "
            "\"translated_episodes\": %u, "
            "\"sign_flipped_episodes\": %u, \"exact\": %s},\n"
            "  \"semantic_oracle_passed\": %s,\n"
            "  \"zero_control_passed\": %s,\n"
            "  \"shuffled_raw_feedback_passed\": %s,\n"
            "  \"linear_ablation_passed\": %s,\n"
            "  \"dimension_lookup_passed\": %s,\n"
            "  \"weights\": [",
            report->policy_bytes,
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->epochs, report->mistakes, report->training_errors,
            report->development.episodes,
            report->development.mixed_episodes,
            report->development.decisions,
            report->development.exact_decisions,
            report->development.coordinate_permutations,
            report->development.coordinate_permutations_exact,
            report->development.translated_episodes,
            report->development.sign_flipped_episodes,
            report->development.exact ? "true" : "false",
            report->sealed.episodes, report->sealed.mixed_episodes,
            report->sealed.decisions, report->sealed.exact_decisions,
            report->sealed.coordinate_permutations,
            report->sealed.coordinate_permutations_exact,
            report->sealed.translated_episodes,
            report->sealed.sign_flipped_episodes,
            report->sealed.exact ? "true" : "false",
            report->semantic_oracle_passed ? "true" : "false",
            report->zero_control_passed ? "true" : "false",
            report->shuffled_raw_feedback_passed ? "true" : "false",
            report->linear_ablation_passed ? "true" : "false",
            report->dimension_lookup_passed ? "true" : "false") < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (feature = 0; feature < R38_FEATURE_COUNT; ++feature)
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
