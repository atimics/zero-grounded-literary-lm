#include "reasoner39.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define R39_FNV_OFFSET UINT64_C(1469598103934665603)
#define R39_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    int16_t error_code;
    int16_t values[R39_MAX_DIMENSIONS];
} R39RawCandidate;

typedef struct {
    uint8_t domain;
    uint8_t dimension;
    uint8_t candidate_count;
    int16_t current[R39_MAX_DIMENSIONS];
    int16_t goal[R39_MAX_DIMENSIONS];
    R39RawCandidate candidates[R39_MAX_CANDIDATES];
} R39Stage;

typedef struct {
    uint8_t stage_count;
    uint8_t mixed;
    int8_t translation;
    int8_t sign;
    R39Stage stages[R39_MAX_STAGES];
} R39Episode;

typedef struct {
    const R39Episode *episode;
    uint8_t stage;
    uint8_t queried;
} R39State;

typedef struct {
    R39Tool tool;
    uint8_t argument;
} R39Call;

typedef struct {
    R39Call items[R39_MAX_CALLS];
    uint8_t count;
} R39Calls;

typedef struct {
    int32_t weights[R39_FEATURE_COUNT];
} R39Model;

typedef struct {
    int32_t weights[R39_RAW_FEATURES];
    uint32_t epochs;
    uint32_t mistakes;
    uint32_t errors;
} R39Perceptron;

enum {
    R39_PREDICT_MODEL = 0,
    R39_PREDICT_ORACLE = 1
};

enum {
    R39_RAW_ERROR = 0,
    R39_RAW_CANDIDATE_SUM = 1,
    R39_RAW_CANDIDATE_SQUARE = 2,
    R39_RAW_GOAL_SUM = 3,
    R39_RAW_GOAL_SQUARE = 4,
    R39_RAW_CANDIDATE_GOAL = 5,
    R39_RAW_CURRENT_SUM = 6,
    R39_RAW_CURRENT_SQUARE = 7,
    R39_RAW_CURRENT_CANDIDATE = 8
};

static const uint8_t mixed_orders[6][R39_DOMAIN_COUNT] = {
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
    if (variant < 20)
        return (int8_t)((int)(variant % 13u) - 6);
    if (variant < 28)
        return (int8_t)(4 * ((int)((variant - 20u) % 3u) - 1));
    return (int8_t)(3 * ((int)((variant - 28u) % 5u) - 2));
}

static void make_stage(uint8_t domain, uint8_t dimension,
                       uint8_t stage_index, uint8_t variant,
                       uint8_t handle_permutation,
                       uint8_t coordinate_permutation,
                       int8_t translation, int8_t sign,
                       R39Stage *stage)
{
    int16_t current[R39_MAX_DIMENSIONS] = {0};
    int16_t goal[R39_MAX_DIMENSIONS] = {0};
    R39RawCandidate base[R39_MAX_CANDIDATES];
    uint32_t seed = mix32(UINT32_C(0x39e71a5d) +
                          (uint32_t)domain * 3253u +
                          (uint32_t)dimension * 811u +
                          (uint32_t)stage_index * 197u +
                          (uint32_t)variant * 61u);
    uint8_t count = (uint8_t)(3u + seed % 3u);
    uint8_t best = (uint8_t)((seed >> 5) % count);
    uint8_t invalid = (uint8_t)((best + 1u) % count);
    uint8_t alternate = (uint8_t)((best + 2u) % count);
    uint8_t candidate, coordinate;
    memset(stage, 0, sizeof(*stage));
    memset(base, 0, sizeof(base));
    stage->domain = domain;
    stage->dimension = dimension;
    stage->candidate_count = count;
    for (coordinate = 0; coordinate < dimension; ++coordinate) {
        uint32_t local = mix32(seed + (uint32_t)coordinate * 149u);
        int16_t direction = (int16_t)(((local >> 7) & 1u) ? -1 : 1);
        current[coordinate] = (int16_t)((int)(local % 9u) - 4);
        goal[coordinate] =
            (int16_t)(current[coordinate] +
                      direction * (int16_t)(1u + (local >> 11) % 4u));
    }
    for (candidate = 0; candidate < count; ++candidate) {
        uint8_t first = (uint8_t)((2u * candidate + domain +
                                   stage_index) % dimension);
        uint8_t second = (uint8_t)((first + 1u + domain) % dimension);
        int16_t magnitude = (int16_t)(2u + (candidate + variant) % 3u);
        for (coordinate = 0; coordinate < dimension; ++coordinate)
            base[candidate].values[coordinate] = goal[coordinate];
        base[candidate].values[first] =
            (int16_t)(base[candidate].values[first] + magnitude);
        if ((candidate + variant + domain) % 2u == 0u)
            base[candidate].values[second] =
                (int16_t)(base[candidate].values[second] - 1);
    }
    for (coordinate = 0; coordinate < dimension; ++coordinate)
        base[best].values[coordinate] = goal[coordinate];
    base[invalid] = base[best];
    base[invalid].error_code = (int16_t)(1u + seed % 2u);
    if (domain == 1 && (variant + stage_index) % 2u == 0u)
        base[best].values[0] = (int16_t)(goal[0] + 1);
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
        stage->candidates[handle].error_code = base[candidate].error_code;
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
                         R39Episode *episode)
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

static uint8_t terminal(const R39State *state)
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

static uint8_t all_queried(const R39State *state)
{
    uint8_t count, mask;
    if (terminal(state)) return 1;
    count = state->episode->stages[state->stage].candidate_count;
    mask = (uint8_t)((1u << count) - 1u);
    return (uint8_t)((state->queried & mask) == mask);
}

static void enumerate_calls(const R39State *state, R39Calls *calls)
{
    uint8_t candidate;
    calls->count = 0;
    if (terminal(state)) {
        calls->items[0].tool = R39_TOOL_COMMIT;
        calls->items[0].argument = 0;
        calls->count = 1;
        return;
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
            calls->items[calls->count].tool = R39_TOOL_QUERY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    for (candidate = 0;
         candidate < state->episode->stages[state->stage].candidate_count;
         ++candidate) {
        if ((state->queried & (uint8_t)(1u << candidate)) != 0) {
            calls->items[calls->count].tool = R39_TOOL_APPLY;
            calls->items[calls->count].argument = candidate;
            ++calls->count;
        }
    }
    calls->items[calls->count].tool = R39_TOOL_COMMIT;
    calls->items[calls->count].argument = 0;
    ++calls->count;
}

static uint32_t candidate_distance(const R39Stage *stage,
                                   uint8_t candidate)
{
    const R39RawCandidate *item = &stage->candidates[candidate];
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

static R39Call oracle_call(const R39State *state)
{
    R39Call call = {R39_TOOL_COMMIT, 0};
    const R39Stage *stage;
    uint32_t best_distance = UINT32_MAX;
    uint8_t candidate;
    if (terminal(state)) return call;
    stage = &state->episode->stages[state->stage];
    if (!all_queried(state)) {
        call.tool = R39_TOOL_QUERY;
        for (candidate = 0; candidate < stage->candidate_count;
             ++candidate) {
            if ((state->queried & (uint8_t)(1u << candidate)) == 0) {
                call.argument = candidate;
                return call;
            }
        }
    }
    call.tool = R39_TOOL_APPLY;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        uint32_t distance = candidate_distance(stage, candidate);
        if (distance < best_distance) {
            best_distance = distance;
            call.argument = candidate;
        }
    }
    return call;
}

static uint8_t acceptable_call(const R39State *state, R39Call call)
{
    R39Call oracle = oracle_call(state);
    if (call.tool != oracle.tool) return 0;
    if (call.tool == R39_TOOL_COMMIT) return 1;
    if (call.tool == R39_TOOL_QUERY)
        return (uint8_t)((state->queried &
                          (uint8_t)(1u << call.argument)) == 0);
    return (uint8_t)(candidate_distance(
                         &state->episode->stages[state->stage],
                         call.argument) ==
                     candidate_distance(
                         &state->episode->stages[state->stage],
                         oracle.argument));
}

static R39RawCandidate observed_candidate(const R39State *state,
                                          uint8_t argument,
                                          uint8_t feedback_shift)
{
    const R39Stage *stage = &state->episode->stages[state->stage];
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

static void raw_features(const R39Stage *stage,
                         const R39RawCandidate *candidate,
                         int16_t features[R39_RAW_FEATURES])
{
    int32_t candidate_sum = 0, candidate_square = 0;
    int32_t goal_sum = 0, goal_square = 0, candidate_goal = 0;
    int32_t current_sum = 0, current_square = 0, current_candidate = 0;
    uint8_t coordinate;
    for (coordinate = 0; coordinate < stage->dimension; ++coordinate) {
        int32_t value = candidate->values[coordinate];
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
    features[R39_RAW_ERROR] = candidate->error_code;
    features[R39_RAW_CANDIDATE_SUM] = checked_feature(candidate_sum);
    features[R39_RAW_CANDIDATE_SQUARE] =
        checked_feature(candidate_square);
    features[R39_RAW_GOAL_SUM] = checked_feature(goal_sum);
    features[R39_RAW_GOAL_SQUARE] = checked_feature(goal_square);
    features[R39_RAW_CANDIDATE_GOAL] = checked_feature(candidate_goal);
    features[R39_RAW_CURRENT_SUM] = checked_feature(current_sum);
    features[R39_RAW_CURRENT_SQUARE] = checked_feature(current_square);
    features[R39_RAW_CURRENT_CANDIDATE] =
        checked_feature(current_candidate);
}

static void encode_call(const R39State *state, R39Call call,
                        uint8_t feedback_shift,
                        int16_t features[R39_FEATURE_COUNT])
{
    uint8_t done = terminal(state);
    uint8_t ready = 1;
    uint8_t unqueried = 0;
    memset(features, 0, sizeof(int16_t) * R39_FEATURE_COUNT);
    if (!done) {
        const R39Stage *stage = &state->episode->stages[state->stage];
        unqueried = (uint8_t)(stage->candidate_count -
                              bit_count(state->queried));
        ready = all_queried(state);
        if (call.tool == R39_TOOL_APPLY && ready) {
            R39RawCandidate candidate = observed_candidate(
                state, call.argument, feedback_shift);
            raw_features(stage, &candidate,
                         &features[R39_PROTOCOL_FEATURES]);
        }
    }
    features[0] = 1;
    features[1] = (int16_t)(call.tool == R39_TOOL_QUERY && unqueried > 0);
    features[2] = (int16_t)(call.tool == R39_TOOL_APPLY && ready);
    features[3] = (int16_t)(call.tool == R39_TOOL_COMMIT && done);
    features[4] = (int16_t)(call.tool == R39_TOOL_QUERY);
    features[5] = (int16_t)(call.tool == R39_TOOL_APPLY);
    features[6] = (int16_t)(call.tool == R39_TOOL_COMMIT);
}

static int64_t score_features(const int32_t *weights,
                              const int16_t *features, uint8_t count)
{
    int64_t score = 0;
    uint8_t feature;
    for (feature = 0; feature < count; ++feature)
        score += (int64_t)weights[feature] * features[feature];
    return score;
}

static int64_t score_call(const R39Model *model,
                          const int16_t features[R39_FEATURE_COUNT])
{
    return score_features(model->weights, features, R39_FEATURE_COUNT);
}

static R39Call predict_call(const R39Model *model, const R39State *state,
                            uint8_t feedback_shift, uint8_t mode)
{
    R39Calls calls;
    R39Call best = {R39_TOOL_COMMIT, 0};
    int64_t best_score = INT64_MIN;
    uint8_t index;
    if (mode == R39_PREDICT_ORACLE) return oracle_call(state);
    enumerate_calls(state, &calls);
    for (index = 0; index < calls.count; ++index) {
        int16_t features[R39_FEATURE_COUNT];
        int64_t score;
        encode_call(state, calls.items[index], feedback_shift, features);
        score = score_call(model, features);
        if (score > best_score) {
            best = calls.items[index];
            best_score = score;
        }
    }
    return best;
}

static void execute_call(R39State *state, R39Call call)
{
    if (call.tool == R39_TOOL_QUERY) {
        state->queried |= (uint8_t)(1u << call.argument);
    } else if (call.tool == R39_TOOL_APPLY) {
        ++state->stage;
        state->queried = 0;
    }
}

typedef uint8_t (*R39EpisodeVisitor)(const R39Episode *episode,
                                     void *context);

static uint8_t visit_training_episodes(R39EpisodeVisitor visitor,
                                       void *context,
                                       uint32_t *episode_count)
{
    uint8_t domain, dimension, stages, variant, handle, coordinate, order;
    R39Episode episode;
    uint32_t count = 0;
    for (domain = 0; domain < R39_DOMAIN_COUNT; ++domain)
        for (dimension = 2; dimension <= 4; ++dimension)
            for (stages = 1; stages <= 4; ++stages)
                for (variant = 0; variant < 20; ++variant)
                    for (handle = 0; handle < 2; ++handle)
                        for (coordinate = 0; coordinate < 2;
                             ++coordinate) {
                            make_episode(&domain, 1, dimension, stages,
                                         variant, handle, coordinate,
                                         &episode);
                            ++count;
                            if (!visitor(&episode, context)) {
                                if (episode_count != NULL)
                                    *episode_count = count;
                                return 0;
                            }
                        }
    for (order = 0; order < 6; ++order)
        for (dimension = 2; dimension <= 4; ++dimension)
            for (variant = 0; variant < 20; ++variant)
                for (handle = 0; handle < 2; ++handle)
                    for (coordinate = 0; coordinate < 2; ++coordinate) {
                        make_episode(mixed_orders[order], R39_DOMAIN_COUNT,
                                     dimension, 4, variant, handle,
                                     coordinate, &episode);
                        ++count;
                        if (!visitor(&episode, context)) {
                            if (episode_count != NULL)
                                *episode_count = count;
                            return 0;
                        }
                    }
    if (episode_count != NULL) *episode_count = count;
    return 1;
}

static uint32_t absolute_value(int32_t value)
{
    return (uint32_t)(value < 0 ? -(int64_t)value : value);
}

static uint32_t gcd_u32(uint32_t left, uint32_t right)
{
    while (right != 0) {
        uint32_t remainder = left % right;
        left = right;
        right = remainder;
    }
    return left;
}

static uint32_t description_length(const int32_t *weights, uint8_t count)
{
    uint32_t length = 0;
    uint8_t index;
    for (index = 0; index < count; ++index)
        length += absolute_value(weights[index]);
    return length;
}

static uint8_t primitive_vector(const int32_t *weights, uint8_t count)
{
    uint32_t divisor = 0;
    uint8_t index;
    for (index = 0; index < count; ++index)
        divisor = gcd_u32(divisor, absolute_value(weights[index]));
    return (uint8_t)(divisor == 1);
}

static uint8_t lexicographically_less(const int32_t *left,
                                      const int32_t *right,
                                      uint8_t count)
{
    uint8_t index;
    for (index = 0; index < count; ++index) {
        if (left[index] < right[index]) return 1;
        if (left[index] > right[index]) return 0;
    }
    return 0;
}

static uint8_t algebraic_certificate(const int32_t raw[R39_RAW_FEATURES])
{
    int32_t candidate_square = raw[R39_RAW_CANDIDATE_SQUARE];
    int32_t goal_square = raw[R39_RAW_GOAL_SQUARE];
    int32_t candidate_goal = raw[R39_RAW_CANDIDATE_GOAL];
    /*
     * These are coefficient-cancellation identities obtained by expanding
     * the raw polynomial under sign reversal, translation, a changed current
     * vector, and a neutral appended coordinate. They do not supply a target
     * coefficient vector or an oracle distance to the search.
     */
    if (candidate_square == 0) return 0;
    if (raw[R39_RAW_CANDIDATE_SUM] != 0 ||
        raw[R39_RAW_GOAL_SUM] != 0 ||
        raw[R39_RAW_CURRENT_SUM] != 0)
        return 0;
    if (raw[R39_RAW_CURRENT_SQUARE] != 0 ||
        raw[R39_RAW_CURRENT_CANDIDATE] != 0)
        return 0;
    if (2 * candidate_square + candidate_goal != 0) return 0;
    if (2 * goal_square + candidate_goal != 0) return 0;
    if (candidate_square + goal_square + candidate_goal != 0) return 0;
    return 1;
}

static int64_t raw_candidate_score(const int32_t *raw,
                                   const R39Stage *stage,
                                   uint8_t candidate)
{
    int16_t features[R39_RAW_FEATURES];
    raw_features(stage, &stage->candidates[candidate], features);
    return score_features(raw, features, R39_RAW_FEATURES);
}

static uint8_t raw_stage_margin_exact(const int32_t *raw,
                                      const R39Stage *stage)
{
    uint32_t best_distance = UINT32_MAX;
    int64_t best_acceptable = INT64_MIN;
    uint8_t candidate;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        uint32_t distance = candidate_distance(stage, candidate);
        if (distance < best_distance) best_distance = distance;
    }
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        if (candidate_distance(stage, candidate) == best_distance) {
            int64_t score = raw_candidate_score(raw, stage, candidate);
            if (score > best_acceptable) best_acceptable = score;
        }
    }
    if (best_acceptable == INT64_MIN) return 0;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        if (candidate_distance(stage, candidate) != best_distance &&
            best_acceptable < raw_candidate_score(raw, stage, candidate) + 1)
            return 0;
    }
    return 1;
}

typedef struct {
    const int32_t *raw;
    uint32_t errors;
    uint8_t stop_on_error;
} R39RawFitContext;

static uint8_t raw_fit_visitor(const R39Episode *episode, void *opaque)
{
    R39RawFitContext *context = (R39RawFitContext *)opaque;
    uint8_t stage;
    for (stage = 0; stage < episode->stage_count; ++stage) {
        if (!raw_stage_margin_exact(context->raw,
                                    &episode->stages[stage])) {
            ++context->errors;
            if (context->stop_on_error) return 0;
        }
    }
    return 1;
}

static uint32_t raw_training_errors(const int32_t *raw,
                                    uint8_t stop_on_error)
{
    R39RawFitContext context = {raw, 0, stop_on_error};
    (void)visit_training_episodes(raw_fit_visitor, &context, NULL);
    return context.errors;
}

static void decode_coefficients(uint32_t code, uint8_t count,
                                int32_t *weights)
{
    uint8_t index;
    for (index = 0; index < count; ++index) {
        weights[index] = (int32_t)(code % 5u) - R39_SEARCH_LIMIT;
        code /= 5u;
    }
}

static uint32_t search_space_size(uint8_t count)
{
    uint32_t size = 1;
    while (count-- > 0) size *= 5u;
    return size;
}

static R0Status learn_raw_law(int32_t selected[R39_RAW_FEATURES],
                              uint32_t *examined,
                              uint32_t *certified,
                              uint32_t *minimum_solutions,
                              uint32_t *selected_length,
                              char *error, size_t error_capacity)
{
    int32_t candidate[R39_RAW_FEATURES];
    uint32_t code, space = search_space_size(R39_RAW_FEATURES);
    uint32_t best_length = UINT32_MAX;
    uint8_t found = 0;
    *examined = 0;
    *certified = 0;
    *minimum_solutions = 0;
    for (code = 0; code < space; ++code) {
        uint32_t length;
        decode_coefficients(code, R39_RAW_FEATURES, candidate);
        ++*examined;
        if (!primitive_vector(candidate, R39_RAW_FEATURES)) continue;
        if (!algebraic_certificate(candidate)) continue;
        ++*certified;
        length = description_length(candidate, R39_RAW_FEATURES);
        if (length > best_length) continue;
        if (raw_training_errors(candidate, 1) != 0) continue;
        if (!found || length < best_length) {
            memcpy(selected, candidate, sizeof(candidate));
            best_length = length;
            *minimum_solutions = 1;
            found = 1;
        } else if (length == best_length) {
            ++*minimum_solutions;
            if (lexicographically_less(candidate, selected,
                                       R39_RAW_FEATURES))
                memcpy(selected, candidate, sizeof(candidate));
        }
    }
    if (!found) {
        set_error(error, error_capacity,
                  "exact integer raw-law search found no solution");
        return R0_POLICY_ERROR;
    }
    *selected_length = best_length;
    return R0_OK;
}

static uint8_t state_margin_exact(const R39Model *model,
                                  const R39State *state,
                                  uint8_t feedback_shift)
{
    R39Calls calls;
    int64_t best_acceptable = INT64_MIN;
    int64_t scores[R39_MAX_CALLS];
    uint8_t index;
    enumerate_calls(state, &calls);
    for (index = 0; index < calls.count; ++index) {
        int16_t features[R39_FEATURE_COUNT];
        encode_call(state, calls.items[index], feedback_shift, features);
        scores[index] = score_call(model, features);
        if (acceptable_call(state, calls.items[index]) &&
            scores[index] > best_acceptable)
            best_acceptable = scores[index];
    }
    if (best_acceptable == INT64_MIN) return 0;
    for (index = 0; index < calls.count; ++index) {
        if (!acceptable_call(state, calls.items[index]) &&
            best_acceptable < scores[index] + 1)
            return 0;
    }
    return 1;
}

static uint32_t episode_margin_errors(const R39Model *model,
                                      const R39Episode *episode,
                                      uint8_t feedback_shift)
{
    R39State state = {episode, 0, 0};
    uint32_t errors = 0;
    while (1) {
        R39Call target = oracle_call(&state);
        if (!state_margin_exact(model, &state, feedback_shift)) ++errors;
        if (target.tool == R39_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    return errors;
}

typedef struct {
    const R39Model *model;
    uint32_t errors;
    uint8_t stop_on_error;
} R39ModelFitContext;

static uint8_t model_fit_visitor(const R39Episode *episode, void *opaque)
{
    R39ModelFitContext *context = (R39ModelFitContext *)opaque;
    uint32_t errors = episode_margin_errors(context->model, episode, 0);
    context->errors += errors;
    return (uint8_t)(!context->stop_on_error || errors == 0);
}

static uint32_t model_training_errors(const R39Model *model,
                                      uint8_t stop_on_error)
{
    R39ModelFitContext context = {model, 0, stop_on_error};
    (void)visit_training_episodes(model_fit_visitor, &context, NULL);
    return context.errors;
}

static R0Status learn_protocol(R39Model *model, uint32_t *examined,
                               uint32_t *selected_length,
                               char *error, size_t error_capacity)
{
    int32_t selected[R39_PROTOCOL_FEATURES] = {0};
    int32_t candidate[R39_PROTOCOL_FEATURES];
    uint32_t code, space = search_space_size(R39_PROTOCOL_FEATURES);
    uint32_t best_length = UINT32_MAX;
    uint8_t found = 0;
    *examined = 0;
    for (code = 0; code < space; ++code) {
        uint32_t length;
        decode_coefficients(code, R39_PROTOCOL_FEATURES, candidate);
        ++*examined;
        length = description_length(candidate, R39_PROTOCOL_FEATURES);
        if (length > best_length) continue;
        memcpy(model->weights, candidate, sizeof(candidate));
        if (model_training_errors(model, 1) != 0) continue;
        if (!found || length < best_length ||
            (length == best_length &&
             lexicographically_less(candidate, selected,
                                    R39_PROTOCOL_FEATURES))) {
            memcpy(selected, candidate, sizeof(selected));
            best_length = length;
            found = 1;
        }
    }
    if (!found) {
        set_error(error, error_capacity,
                  "exact integer protocol search found no solution");
        return R0_POLICY_ERROR;
    }
    memcpy(model->weights, selected, sizeof(selected));
    *selected_length = best_length;
    return R0_OK;
}

static uint8_t perceptron_stage_update(R39Perceptron *perceptron,
                                       const R39Stage *stage,
                                       uint8_t update)
{
    uint32_t best_distance = UINT32_MAX;
    int64_t best_acceptable = INT64_MIN;
    int64_t worst_other = INT64_MIN;
    uint8_t target = 0, predicted = 0, candidate;
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        uint32_t distance = candidate_distance(stage, candidate);
        if (distance < best_distance) best_distance = distance;
    }
    for (candidate = 0; candidate < stage->candidate_count; ++candidate) {
        int64_t score = raw_candidate_score(perceptron->weights,
                                            stage, candidate);
        if (candidate_distance(stage, candidate) == best_distance) {
            if (score > best_acceptable) {
                best_acceptable = score;
                target = candidate;
            }
        } else if (score > worst_other) {
            worst_other = score;
            predicted = candidate;
        }
    }
    if (worst_other == INT64_MIN || best_acceptable >= worst_other + 1)
        return 0;
    if (update) {
        int16_t target_features[R39_RAW_FEATURES];
        int16_t predicted_features[R39_RAW_FEATURES];
        uint8_t feature;
        raw_features(stage, &stage->candidates[target], target_features);
        raw_features(stage, &stage->candidates[predicted],
                     predicted_features);
        for (feature = 0; feature < R39_RAW_FEATURES; ++feature) {
            int64_t changed = (int64_t)perceptron->weights[feature] +
                target_features[feature] - predicted_features[feature];
            if (changed < INT32_MIN) changed = INT32_MIN;
            if (changed > INT32_MAX) changed = INT32_MAX;
            perceptron->weights[feature] = (int32_t)changed;
        }
        ++perceptron->mistakes;
    }
    return 1;
}

typedef struct {
    R39Perceptron *perceptron;
    uint32_t errors;
    uint8_t update;
} R39PerceptronContext;

static uint8_t perceptron_visitor(const R39Episode *episode, void *opaque)
{
    R39PerceptronContext *context = (R39PerceptronContext *)opaque;
    uint8_t stage;
    for (stage = 0; stage < episode->stage_count; ++stage)
        context->errors += perceptron_stage_update(
            context->perceptron, &episode->stages[stage], context->update);
    return 1;
}

static void train_perceptron(R39Perceptron *perceptron)
{
    uint32_t epoch;
    memset(perceptron, 0, sizeof(*perceptron));
    for (epoch = 0; epoch < R39_PERCEPTRON_EPOCHS; ++epoch) {
        R39PerceptronContext training = {perceptron, 0, 1};
        R39PerceptronContext checking = {perceptron, 0, 0};
        (void)visit_training_episodes(perceptron_visitor, &training, NULL);
        ++perceptron->epochs;
        (void)visit_training_episodes(perceptron_visitor, &checking, NULL);
        perceptron->errors = checking.errors;
        if (perceptron->errors == 0) break;
    }
}

static uint8_t linear_only_law_exists(void)
{
    int32_t candidate[R39_RAW_FEATURES] = {0};
    int32_t error_weight;
    for (error_weight = -R39_SEARCH_LIMIT;
         error_weight <= R39_SEARCH_LIMIT; ++error_weight) {
        candidate[R39_RAW_ERROR] = error_weight;
        if (primitive_vector(candidate, R39_RAW_FEATURES) &&
            algebraic_certificate(candidate) &&
            raw_training_errors(candidate, 1) == 0)
            return 1;
    }
    return 0;
}

static void evaluate_episode(const R39Model *model,
                             const R39Episode *episode,
                             uint8_t feedback_shift, uint8_t mode,
                             R39Evaluation *report)
{
    R39State state = {episode, 0, 0};
    uint8_t episode_exact = 1;
    uint8_t episode_margin_exact = 1;
    ++report->episodes;
    report->mixed_episodes += episode->mixed;
    report->translated_episodes += (uint8_t)(episode->translation != 0);
    report->sign_flipped_episodes += (uint8_t)(episode->sign < 0);
    while (1) {
        R39Call target = oracle_call(&state);
        R39Call predicted = predict_call(model, &state, feedback_shift,
                                         mode);
        ++report->decisions;
        if (acceptable_call(&state, predicted)) {
            ++report->exact_decisions;
        } else {
            episode_exact = 0;
        }
        if (!state_margin_exact(model, &state, feedback_shift)) {
            ++report->margin_errors;
            episode_margin_exact = 0;
        }
        if (target.tool == R39_TOOL_COMMIT) break;
        execute_call(&state, target);
    }
    report->coordinate_permutations += episode->stage_count;
    if (episode_exact && episode_margin_exact)
        report->coordinate_permutations_exact += episode->stage_count;
}

static void evaluate_open(const R39Model *model, uint8_t feedback_shift,
                          uint8_t mode, R39Evaluation *report)
{
    uint8_t domain, dimension, variant, handle, coordinate, order;
    R39Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R39_DOMAIN_COUNT; ++domain)
        for (dimension = 5; dimension <= 8; ++dimension)
            for (variant = 20; variant < 28; ++variant)
                for (handle = 0; handle < 4; ++handle)
                    for (coordinate = 0; coordinate < 4; ++coordinate) {
                        make_episode(&domain, 1, dimension, 5, variant,
                                     handle, coordinate, &episode);
                        evaluate_episode(model, &episode, feedback_shift,
                                         mode, report);
                    }
    for (order = 0; order < 6; ++order)
        for (dimension = 5; dimension <= 8; ++dimension)
            for (variant = 20; variant < 28; ++variant)
                for (handle = 0; handle < 4; ++handle)
                    for (coordinate = 0; coordinate < 4; ++coordinate) {
                        make_episode(mixed_orders[order], R39_DOMAIN_COUNT,
                                     dimension, 5, variant, handle,
                                     coordinate, &episode);
                        evaluate_episode(model, &episode, feedback_shift,
                                         mode, report);
                    }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
    report->strict_margin_exact = (uint8_t)(report->margin_errors == 0);
}

static void evaluate_sealed(const R39Model *model,
                            R39Evaluation *report)
{
    uint8_t domain, dimension, stages, variant, handle, coordinate, order;
    R39Episode episode;
    memset(report, 0, sizeof(*report));
    for (domain = 0; domain < R39_DOMAIN_COUNT; ++domain)
        for (dimension = 9; dimension <= 12; ++dimension)
            for (stages = 6; stages <= 8; ++stages)
                for (variant = 28; variant < 40; ++variant)
                    for (handle = 0; handle < 4; ++handle)
                        for (coordinate = 0; coordinate < 4;
                             ++coordinate) {
                            make_episode(&domain, 1, dimension, stages,
                                         variant, handle, coordinate,
                                         &episode);
                            evaluate_episode(model, &episode, 0,
                                             R39_PREDICT_MODEL, report);
                        }
    for (order = 0; order < 6; ++order)
        for (dimension = 9; dimension <= 12; ++dimension)
            for (stages = 6; stages <= 8; ++stages)
                for (variant = 28; variant < 40; ++variant)
                    for (handle = 0; handle < 4; ++handle)
                        for (coordinate = 0; coordinate < 4;
                             ++coordinate) {
                            make_episode(mixed_orders[order],
                                         R39_DOMAIN_COUNT, dimension,
                                         stages, variant, handle,
                                         coordinate, &episode);
                            evaluate_episode(model, &episode, 0,
                                             R39_PREDICT_MODEL, report);
                        }
    report->exact = (uint8_t)(report->decisions == report->exact_decisions);
    report->strict_margin_exact = (uint8_t)(report->margin_errors == 0);
}

static uint8_t count_visitor(const R39Episode *episode, void *context)
{
    (void)episode;
    (void)context;
    return 1;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (uint8_t)(value >> (byte * 8));
        hash *= R39_FNV_PRIME;
    }
    return hash;
}

static uint64_t experiment_digest(const R39ExperimentReport *report)
{
    uint64_t hash = R39_FNV_OFFSET;
    uint8_t feature;
    hash = digest_u64(hash, report->raw_candidates_examined);
    hash = digest_u64(hash, report->raw_certified_candidates);
    hash = digest_u64(hash, report->raw_minimum_solutions);
    hash = digest_u64(hash, report->raw_description_length);
    hash = digest_u64(hash, report->protocol_candidates_examined);
    hash = digest_u64(hash, report->protocol_description_length);
    for (feature = 0; feature < R39_FEATURE_COUNT; ++feature)
        hash = digest_u64(hash,
                          (uint64_t)(uint32_t)report->weights[feature]);
    hash = digest_u64(hash, report->development.episodes);
    hash = digest_u64(hash, report->development.decisions);
    hash = digest_u64(hash, report->development.exact_decisions);
    hash = digest_u64(hash, report->development.margin_errors);
    hash = digest_u64(hash, report->perceptron_epochs);
    hash = digest_u64(hash, report->perceptron_mistakes);
    hash = digest_u64(hash, report->perceptron_training_errors);
    for (feature = 0; feature < R39_RAW_FEATURES; ++feature)
        hash = digest_u64(
            hash, (uint64_t)(uint32_t)report->perceptron_raw_weights[feature]);
    hash = digest_u64(hash, report->sealed.episodes);
    hash = digest_u64(hash, report->sealed.decisions);
    hash = digest_u64(hash, report->sealed.exact_decisions);
    hash = digest_u64(hash, report->sealed.margin_errors);
    hash = digest_u64(hash, report->algebraic_certificate_passed);
    hash = digest_u64(hash, report->semantic_oracle_passed);
    hash = digest_u64(hash, report->zero_control_passed);
    hash = digest_u64(hash, report->shuffled_raw_feedback_passed);
    hash = digest_u64(hash, report->linear_only_control_passed);
    hash = digest_u64(hash, report->perceptron_training_fit_passed);
    hash = digest_u64(hash, report->perceptron_certificate_passed);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R0Status r39_run_development(R39ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R39Model model, zero;
    R39Perceptron perceptron;
    R39Evaluation oracle_evaluation, zero_evaluation;
    R39Evaluation shuffled_evaluation;
    int32_t raw[R39_RAW_FEATURES];
    R0Status status;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    memset(&model, 0, sizeof(model));
    status = learn_raw_law(raw, &report->raw_candidates_examined,
                           &report->raw_certified_candidates,
                           &report->raw_minimum_solutions,
                           &report->raw_description_length,
                           error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(&model.weights[R39_PROTOCOL_FEATURES], raw, sizeof(raw));
    status = learn_protocol(&model, &report->protocol_candidates_examined,
                            &report->protocol_description_length,
                            error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(report->weights, model.weights, sizeof(report->weights));
    (void)visit_training_episodes(count_visitor, NULL,
                                  &report->training_episodes);
    report->training_margin_errors = model_training_errors(&model, 0);
    report->primitive_law_passed =
        primitive_vector(raw, R39_RAW_FEATURES);
    report->algebraic_certificate_passed = algebraic_certificate(raw);
    report->minimum_description_passed =
        (uint8_t)(report->raw_candidates_examined ==
                      search_space_size(R39_RAW_FEATURES) &&
                  report->raw_minimum_solutions == 1 &&
                  report->protocol_candidates_examined ==
                      search_space_size(R39_PROTOCOL_FEATURES));
    evaluate_open(&model, 0, R39_PREDICT_MODEL, &report->development);
    evaluate_open(&model, 0, R39_PREDICT_ORACLE, &oracle_evaluation);
    report->semantic_oracle_passed = oracle_evaluation.exact;
    memset(&zero, 0, sizeof(zero));
    evaluate_open(&zero, 0, R39_PREDICT_MODEL, &zero_evaluation);
    report->zero_control_passed = zero_evaluation.exact;
    evaluate_open(&model, 1, R39_PREDICT_MODEL, &shuffled_evaluation);
    report->shuffled_raw_feedback_passed = shuffled_evaluation.exact;
    report->linear_only_control_passed = linear_only_law_exists();
    train_perceptron(&perceptron);
    report->perceptron_epochs = perceptron.epochs;
    report->perceptron_mistakes = perceptron.mistakes;
    report->perceptron_training_errors = perceptron.errors;
    memcpy(report->perceptron_raw_weights, perceptron.weights,
           sizeof(report->perceptron_raw_weights));
    report->perceptron_training_fit_passed =
        (uint8_t)(perceptron.errors == 0);
    report->perceptron_certificate_passed =
        algebraic_certificate(perceptron.weights);
    report->policy_bytes = R39_POLICY_BYTES;
    report->development_gate_passed =
        (uint8_t)(report->training_margin_errors == 0 &&
                  report->primitive_law_passed &&
                  report->algebraic_certificate_passed &&
                  report->minimum_description_passed &&
                  report->development.exact &&
                  report->development.strict_margin_exact &&
                  report->semantic_oracle_passed &&
                  !report->zero_control_passed &&
                  !report->shuffled_raw_feedback_passed &&
                  !report->linear_only_control_passed &&
                  report->perceptron_training_fit_passed &&
                  !report->perceptron_certificate_passed);
    report->result_digest = experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "Reasoner (3,8) development gate failed: "
                  "training=%u primitive=%u certificate=%u minimum=%u "
                  "policy=%u margin=%u oracle=%u zero=%u shuffled=%u "
                  "linear=%u perceptron_fit=%u perceptron_cert=%u "
                  "exact=%u/%u",
                  report->training_margin_errors,
                  report->primitive_law_passed,
                  report->algebraic_certificate_passed,
                  report->minimum_description_passed,
                  report->development.exact,
                  report->development.strict_margin_exact,
                  report->semantic_oracle_passed,
                  report->zero_control_passed,
                  report->shuffled_raw_feedback_passed,
                  report->linear_only_control_passed,
                  report->perceptron_training_fit_passed,
                  report->perceptron_certificate_passed,
                  report->development.exact_decisions,
                  report->development.decisions);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r39_run_sealed(R39ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R39Model model;
    R0Status status = r39_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    memcpy(model.weights, report->weights, sizeof(model.weights));
    evaluate_sealed(&model, &report->sealed);
    report->sealed_gate_passed =
        (uint8_t)(report->sealed.exact &&
                  report->sealed.strict_margin_exact);
    report->result_digest = experiment_digest(report);
    return R0_OK;
}

R0Status r39_write_result(const R39ExperimentReport *report,
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
            "{\n  \"schema\": \"zero.reasoner39_exact_law.v1\",\n"
            "  \"version\": \"(3,8)\",\n"
            "  \"policy_bytes\": %u,\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"law_search\": {\"raw_candidates_examined\": %u, "
            "\"raw_certified_candidates\": %u, "
            "\"raw_minimum_solutions\": %u, "
            "\"raw_description_length\": %u, "
            "\"protocol_candidates_examined\": %u, "
            "\"protocol_description_length\": %u},\n"
            "  \"training\": {\"episodes\": %u, "
            "\"margin_errors\": %u},\n"
            "  \"development\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"decisions\": %u, "
            "\"exact_decisions\": %u, \"margin_errors\": %u, "
            "\"coordinate_permutations\": %u, "
            "\"coordinate_permutations_exact\": %u, "
            "\"translated_episodes\": %u, "
            "\"sign_flipped_episodes\": %u, \"exact\": %s, "
            "\"strict_margin_exact\": %s},\n"
            "  \"sealed\": {\"episodes\": %u, "
            "\"mixed_episodes\": %u, \"decisions\": %u, "
            "\"exact_decisions\": %u, \"margin_errors\": %u, "
            "\"coordinate_permutations\": %u, "
            "\"coordinate_permutations_exact\": %u, "
            "\"translated_episodes\": %u, "
            "\"sign_flipped_episodes\": %u, \"exact\": %s, "
            "\"strict_margin_exact\": %s},\n"
            "  \"primitive_law_passed\": %s,\n"
            "  \"algebraic_certificate_passed\": %s,\n"
            "  \"minimum_description_passed\": %s,\n"
            "  \"semantic_oracle_passed\": %s,\n"
            "  \"zero_control_passed\": %s,\n"
            "  \"shuffled_raw_feedback_passed\": %s,\n"
            "  \"linear_only_control_passed\": %s,\n"
            "  \"perceptron\": {\"epochs\": %u, "
            "\"mistakes\": %u, \"training_errors\": %u, "
            "\"training_fit_passed\": %s, "
            "\"certificate_passed\": %s, \"raw_weights\": [",
            report->policy_bytes,
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->raw_candidates_examined,
            report->raw_certified_candidates,
            report->raw_minimum_solutions,
            report->raw_description_length,
            report->protocol_candidates_examined,
            report->protocol_description_length,
            report->training_episodes, report->training_margin_errors,
            report->development.episodes,
            report->development.mixed_episodes,
            report->development.decisions,
            report->development.exact_decisions,
            report->development.margin_errors,
            report->development.coordinate_permutations,
            report->development.coordinate_permutations_exact,
            report->development.translated_episodes,
            report->development.sign_flipped_episodes,
            report->development.exact ? "true" : "false",
            report->development.strict_margin_exact ? "true" : "false",
            report->sealed.episodes, report->sealed.mixed_episodes,
            report->sealed.decisions, report->sealed.exact_decisions,
            report->sealed.margin_errors,
            report->sealed.coordinate_permutations,
            report->sealed.coordinate_permutations_exact,
            report->sealed.translated_episodes,
            report->sealed.sign_flipped_episodes,
            report->sealed.exact ? "true" : "false",
            report->sealed.strict_margin_exact ? "true" : "false",
            report->primitive_law_passed ? "true" : "false",
            report->algebraic_certificate_passed ? "true" : "false",
            report->minimum_description_passed ? "true" : "false",
            report->semantic_oracle_passed ? "true" : "false",
            report->zero_control_passed ? "true" : "false",
            report->shuffled_raw_feedback_passed ? "true" : "false",
            report->linear_only_control_passed ? "true" : "false",
            report->perceptron_epochs, report->perceptron_mistakes,
            report->perceptron_training_errors,
            report->perceptron_training_fit_passed ? "true" : "false",
            report->perceptron_certificate_passed ? "true" : "false") < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (feature = 0; feature < R39_RAW_FEATURES; ++feature)
        if (fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                    report->perceptron_raw_weights[feature]) < 0) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
    if (fprintf(file, "]},\n  \"weights\": [") < 0) {
        (void)fclose(file);
        return R0_IO_ERROR;
    }
    for (feature = 0; feature < R39_FEATURE_COUNT; ++feature)
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
