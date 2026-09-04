#include "reasoner57.h"

#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R57_POLICY_VERSION 1u
#define R57_R56_SOURCE_PROGRAMS 256u
#define R57_R56_FIT_FAMILIES 16u
#define R57_R56_COVERAGE_FAMILIES 99u
#define R57_TRAINING_EPISODES (R57_POLICY_TRAIN_FAMILIES * 2u)

static const uint8_t r57_policy_magic[8] = {
    'R', '5', '7', 'P', 'O', 'L', '1', '\0'
};

static int r57_policy_integrity_valid(const r57_policy_artifact *policy);

static uint64_t r57_hash_update(uint64_t hash, const void *data, size_t size) {
    const uint8_t *bytes = (const uint8_t *)data;
    for (size_t index = 0u; index < size; ++index) {
        hash ^= bytes[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static uint64_t r57_hash(const void *data, size_t size, uint64_t domain) {
    uint64_t hash = UINT64_C(1469598103934665603);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    return r57_hash_update(hash, data, size);
}

static uint64_t r57_mix64(uint64_t value) {
    value += UINT64_C(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30u)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27u)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31u);
}

static uint64_t r57_event_key(uint64_t seed, uint64_t a, uint64_t b,
                              uint64_t c, uint64_t d, uint64_t e) {
    uint64_t value = seed;
    value = r57_mix64(value ^ r57_mix64(a + UINT64_C(0x100000001b3)));
    value = r57_mix64(value ^ r57_mix64(b + UINT64_C(0x9e3779b9)));
    value = r57_mix64(value ^ r57_mix64(c + UINT64_C(0x85ebca6b)));
    value = r57_mix64(value ^ r57_mix64(d + UINT64_C(0xc2b2ae35)));
    return r57_mix64(value ^ r57_mix64(e + UINT64_C(0x27d4eb2f)));
}

static uint8_t r57_mod(int32_t value) {
    int32_t result = value % (int32_t)R56_MODULUS;
    return (uint8_t)(result < 0 ? result + (int32_t)R56_MODULUS : result);
}

static int r57_universe_valid(const r56_universe *universe) {
    if (!universe || universe->syntax_count != R56_SYNTAX_PROGRAMS ||
        universe->semantic_count != R56_SEMANTIC_CLASSES)
        return 0;
    for (uint32_t index = 0u; index < R56_SYNTAX_PROGRAMS; ++index) {
        if (universe->syntax_to_semantic[index] >= R56_SEMANTIC_CLASSES)
            return 0;
        for (uint32_t token = 0u; token < R56_PROGRAM_DEPTH; ++token)
            if (universe->syntax[index].token[token] >= R56_PRIMITIVES)
                return 0;
        for (uint32_t input = 0u; input < R56_MODULUS; ++input)
            if (universe->syntax[index].table[input] >= R56_MODULUS)
                return 0;
    }
    for (uint32_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index) {
        if (universe->semantic[index].multiplicity == 0u)
            return 0;
        for (uint32_t token = 0u; token < R56_PROGRAM_DEPTH; ++token)
            if (universe->semantic[index].representative[token] >=
                R56_PRIMITIVES)
                return 0;
        for (uint32_t input = 0u; input < R56_MODULUS; ++input)
            if (universe->semantic[index].table[input] >= R56_MODULUS)
                return 0;
    }
    return 1;
}

static void r57_mark_r56_selection(uint8_t used[R56_SEMANTIC_CLASSES],
                                   uint64_t seed, uint32_t desired) {
    uint32_t selected = 0u;
    for (uint32_t counter = 0u; selected < desired; ++counter) {
        uint32_t semantic = 64u + (uint32_t)(r57_event_key(seed, counter, 56u,
            2u, 0u, 0u) % (R56_SEMANTIC_CLASSES - 64u));
        if (!used[semantic]) {
            used[semantic] = 1u;
            selected += 1u;
        }
    }
}

int r57_select_semantic_splits(const r56_universe *universe,
                               uint16_t training[R57_POLICY_TRAIN_FAMILIES],
                               uint16_t selector[R57_SELECTOR_FAMILIES],
                               uint16_t calibration[R57_CALIBRATION_FAMILIES],
                               uint16_t development[
                                   R57_DEVELOPMENT_PROGRAM_FAMILIES],
                               uint16_t *sealed, uint32_t *sealed_count) {
    static const uint16_t r56_development[8] = {
        165u, 48u, 107u, 418u, 127u, 417u, 391u, 407u
    };
    uint8_t used[R56_SEMANTIC_CLASSES] = {0};
    uint16_t pool[R56_SEMANTIC_CLASSES];
    uint32_t pool_count = 0u;
    uint32_t cursor = 0u;
    if (!r57_universe_valid(universe) || !training || !selector ||
        !calibration || !development || !sealed || !sealed_count)
        return 1;
    for (uint32_t index = 0u; index < R57_R56_SOURCE_PROGRAMS; ++index) {
        uint8_t tokens[R56_PROGRAM_DEPTH];
        uint32_t syntax;
        r56_generate_source_program(UINT64_C(0x56010001), index, tokens);
        syntax = (uint32_t)((tokens[0] * R56_PRIMITIVES + tokens[1]) *
                           R56_PRIMITIVES + tokens[2]);
        used[universe->syntax_to_semantic[syntax]] = 1u;
    }
    r57_mark_r56_selection(used, UINT64_C(0x56ca1100),
                           R57_R56_FIT_FAMILIES);
    r57_mark_r56_selection(used, UINT64_C(0x56cb1100),
                           R57_R56_COVERAGE_FAMILIES);
    for (uint32_t index = 0u; index < 8u; ++index) {
        if (used[r56_development[index]]) return 2;
        used[r56_development[index]] = 1u;
    }
    for (uint16_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES;
         ++semantic)
        if (!used[semantic]) pool[pool_count++] = semantic;
    if (pool_count < R57_POLICY_TRAIN_FAMILIES + R57_SELECTOR_FAMILIES +
        R57_CALIBRATION_FAMILIES + R57_DEVELOPMENT_PROGRAM_FAMILIES)
        return 3;
    for (uint32_t index = pool_count; index > 1u; --index) {
        uint32_t selected = (uint32_t)(r57_event_key(
            UINT64_C(0x57010001), index, 57u, 1u, 0u, 0u) % index);
        uint16_t temporary = pool[index - 1u];
        pool[index - 1u] = pool[selected];
        pool[selected] = temporary;
    }
    memcpy(training, pool + cursor,
           sizeof(*training) * R57_POLICY_TRAIN_FAMILIES);
    cursor += R57_POLICY_TRAIN_FAMILIES;
    memcpy(selector, pool + cursor,
           sizeof(*selector) * R57_SELECTOR_FAMILIES);
    cursor += R57_SELECTOR_FAMILIES;
    memcpy(calibration, pool + cursor,
           sizeof(*calibration) * R57_CALIBRATION_FAMILIES);
    cursor += R57_CALIBRATION_FAMILIES;
    memcpy(development, pool + cursor,
           sizeof(*development) * R57_DEVELOPMENT_PROGRAM_FAMILIES);
    cursor += R57_DEVELOPMENT_PROGRAM_FAMILIES;
    *sealed_count = pool_count - cursor;
    memcpy(sealed, pool + cursor, sizeof(*sealed) * *sealed_count);
    return 0;
}

static r57_action r57_action_from_index(uint32_t index) {
    r57_action action;
    action.input = (uint8_t)(index / R56_SENSORS);
    action.sensor = (uint8_t)(index % R56_SENSORS);
    return action;
}

static uint32_t r57_action_index(r57_action action) {
    return (uint32_t)action.input * R56_SENSORS + action.sensor;
}

static int r57_action_valid(r57_action action) {
    return action.input < R56_MODULUS && action.sensor < R56_SENSORS;
}

int r57_validate_policy_view(const r57_policy_view *view) {
    if (!view || view->evidence.observation_count < R57_INITIAL_READS ||
        view->evidence.observation_count > R57_TOTAL_OBSERVATIONS ||
        view->allowed_action_count != R57_ACTIONS ||
        view->action_history_count > R57_MAX_QUERY_BUDGET ||
        view->remaining_budget > R57_MAX_QUERY_BUDGET ||
        view->action_history_count + view->remaining_budget == 0u ||
        view->action_history_count + view->remaining_budget >
            R57_MAX_QUERY_BUDGET ||
        view->top_probability_ppm > 1000000u ||
        view->disagreement_ppm > 1000000u ||
        view->version_space_size == 0u ||
        view->version_space_size > R56_SEMANTIC_CLASSES)
        return 1;
    for (uint32_t index = 0u; index < view->evidence.observation_count;
         ++index) {
        const r56_public_observation *item = &view->evidence.observations[index];
        if (item->input >= R56_MODULUS || item->sensor >= R56_SENSORS ||
            item->missing > 1u || item->observed >= R56_MODULUS ||
            (item->missing && item->observed != 0u))
            return 2;
    }
    for (uint32_t index = 0u; index < R57_ACTIONS; ++index)
        if (!r57_action_valid(view->allowed_actions[index]) ||
            r57_action_index(view->allowed_actions[index]) != index)
            return 3;
    for (uint32_t index = 0u; index < view->action_history_count; ++index) {
        const r57_action_observation *item = &view->action_history[index];
        if (!r57_action_valid(item->action) ||
            item->response.input != item->action.input ||
            item->response.sensor != item->action.sensor ||
            item->response.missing > 1u ||
            item->response.observed >= R56_MODULUS ||
            (item->response.missing && item->response.observed != 0u))
            return 4;
    }
    return 0;
}

static uint8_t r57_channel_state(const r56_corruption_family *family,
                                 uint64_t seed, uint8_t sensor, uint8_t input,
                                 uint8_t clean, uint8_t previous,
                                 uint32_t position) {
    uint64_t random = r57_event_key(seed, sensor, input, clean, previous,
                                    position);
    uint32_t draw = (uint32_t)(random % 100u);
    uint32_t rate = 4u + 5u * family->severity + 2u * sensor;
    uint8_t delta = 0u;
    if (family->template_id == 0u) {
        if (draw < rate) delta = (uint8_t)(1u + ((random >> 9u) % 16u));
    } else if (family->template_id == 1u) {
        if (draw < rate)
            delta = r57_mod((int32_t)family->direction *
                            (int32_t)(1u + clean % 3u));
    } else if (family->template_id == 2u) {
        if (draw < rate + (input % 4u) * 3u)
            delta = r57_mod((int32_t)family->direction + input + sensor);
    } else if (family->template_id == 3u) {
        if (previous < R56_MODULUS && previous != 0u && draw < 65u)
            delta = previous;
        else if (draw < rate)
            delta = (uint8_t)(1u + ((random >> 13u) % 16u));
    } else if (family->template_id == 4u) {
        if (draw < rate) return R56_MODULUS;
    } else if (family->template_id == 5u) {
        if (draw < rate + (input % 3u) * 4u) return R56_MODULUS;
    } else if (family->template_id == 6u) {
        if (draw < rate + (clean % 4u) * 3u) return R56_MODULUS;
    } else {
        uint32_t distance = (position + R57_TOTAL_OBSERVATIONS -
            family->location) % R57_TOTAL_OBSERVATIONS;
        if (distance < family->block_length ||
            (previous == R56_MODULUS && draw < 60u))
            return R56_MODULUS;
    }
    return delta;
}

static uint64_t r57_view_digest(const r56_ranker_view *view) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5707);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    hash = r57_hash_update(hash, &view->observation_count,
                           sizeof(view->observation_count));
    for (uint32_t index = 0u; index < view->observation_count; ++index)
        hash = r57_hash_update(hash, &view->observations[index],
                               sizeof(view->observations[index]));
    return hash;
}

static int r57_response(const r56_universe *universe,
                        const r57_episode *episode,
                        const r56_ranker_view *history, r57_action action,
                        r56_public_observation *response) {
    uint8_t previous = 0u;
    uint8_t clean;
    uint8_t state;
    uint64_t seed;
    if (!r57_universe_valid(universe) || !episode || !history || !response ||
        episode->truth_class >= R56_SEMANTIC_CLASSES ||
        history->observation_count >= R57_TOTAL_OBSERVATIONS ||
        !r57_action_valid(action))
        return 1;
    if (history->observation_count > 0u) {
        const r56_public_observation *last =
            &history->observations[history->observation_count - 1u];
        uint8_t last_clean = universe->semantic[episode->truth_class]
            .table[last->input];
        previous = last->missing ? R56_MODULUS :
            r57_mod((int32_t)last->observed - last_clean);
    }
    clean = universe->semantic[episode->truth_class].table[action.input];
    seed = episode->root_seed ^ r57_mix64(r57_view_digest(history));
    state = r57_channel_state(&episode->corruption, seed, action.sensor,
        action.input, clean, previous, history->observation_count);
    response->input = action.input;
    response->sensor = action.sensor;
    response->missing = state == R56_MODULUS;
    response->observed = response->missing ? 0u :
        r57_mod((int32_t)clean + state);
    return 0;
}

static int r57_append_response(const r56_universe *universe,
                               const r57_episode *episode,
                               r56_ranker_view *view, r57_action action,
                               r56_public_observation *saved) {
    r56_public_observation response;
    if (!view || view->observation_count >= R57_TOTAL_OBSERVATIONS ||
        r57_response(universe, episode, view, action, &response) != 0)
        return 1;
    view->observations[view->observation_count++] = response;
    if (saved) *saved = response;
    return 0;
}

static void r57_make_corruption(uint64_t seed, uint32_t index,
                                r56_corruption_family *family) {
    r56_generate_corruption_family(seed, index, family);
    family->location = (uint8_t)(family->location % R57_TOTAL_OBSERVATIONS);
    if (family->block_length > R57_MAX_QUERY_BUDGET)
        family->block_length = R57_MAX_QUERY_BUDGET;
}

static void r57_make_episode(r57_episode *episode, uint16_t truth,
                             uint32_t program_slot, uint32_t corruption_slot,
                             uint32_t repeat, uint64_t lane_seed) {
    memset(episode, 0, sizeof(*episode));
    episode->program_slot = program_slot;
    episode->corruption_slot = corruption_slot;
    episode->repeat = repeat;
    episode->truth_class = truth;
    episode->root_seed = r57_event_key(lane_seed, program_slot,
        corruption_slot, repeat, truth, 57u);
    r57_make_corruption(lane_seed ^ UINT64_C(0x57020002),
                        corruption_slot, &episode->corruption);
}

static int r57_initial_view(const r56_universe *universe,
                            const r57_episode *episode,
                            r56_ranker_view *view) {
    static const uint8_t permutations[6][3] = {
        {0u, 1u, 2u}, {0u, 2u, 1u}, {1u, 0u, 2u},
        {1u, 2u, 0u}, {2u, 0u, 1u}, {2u, 1u, 0u}
    };
    uint32_t permutation;
    if (!r57_universe_valid(universe) || !episode || !view) return 1;
    memset(view, 0, sizeof(*view));
    permutation = (uint32_t)(r57_event_key(UINT64_C(0x57de0003),
        episode->program_slot, episode->repeat, 0u, 57u, 0u) % 6u);
    for (uint8_t input = 0u; input < R57_INITIAL_READS; ++input) {
        r57_action action = {input, permutations[permutation][input]};
        if (r57_append_response(universe, episode, view, action, NULL) != 0)
            return 2;
    }
    return 0;
}

static double r57_sensor_reliability(const r56_artifact *channel,
                                     uint8_t sensor) {
    size_t offset = (size_t)sensor * R56_CHANNEL_STATES;
    uint32_t support;
    if (!channel || sensor >= R56_SENSORS) return 0.0;
    support = channel->local_sensor_support[sensor];
    if (support == 0u) return 0.0;
    return (double)channel->local_sensor_count[offset] / (double)support;
}

static uint32_t r57_probability_summary(
    const double probability[R56_SEMANTIC_CLASSES], uint32_t *version,
    uint32_t *top_ppm) {
    double maximum = 0.0;
    uint32_t count = 0u;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES;
         ++semantic) {
        if (probability[semantic] > maximum) maximum = probability[semantic];
        if (probability[semantic] >= 1.0 / (4.0 * R56_SEMANTIC_CLASSES))
            count += 1u;
    }
    if (count == 0u) count = 1u;
    *version = count;
    *top_ppm = (uint32_t)llround(maximum * 1000000.0);
    if (*top_ppm > 1000000u) *top_ppm = 1000000u;
    return 0u;
}

static double r57_input_disagreement(
    const r56_universe *universe,
    const double probability[R56_SEMANTIC_CLASSES], uint8_t input) {
    double mass[R56_MODULUS] = {0.0};
    double square = 0.0;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES;
         ++semantic)
        mass[universe->semantic[semantic].table[input]] +=
            probability[semantic];
    for (uint32_t value = 0u; value < R56_MODULUS; ++value)
        square += mass[value] * mass[value];
    return 1.0 - square;
}

static uint32_t r57_action_type(const r56_ranker_view *view,
                                r57_action action) {
    int input_seen = 0;
    int cell_seen = 0;
    for (uint32_t index = 0u; index < view->observation_count; ++index) {
        const r56_public_observation *item = &view->observations[index];
        input_seen |= item->input == action.input;
        cell_seen |= item->input == action.input && item->sensor == action.sensor;
    }
    return cell_seen ? 2u : (input_seen ? 1u : 0u);
}

static uint32_t r57_policy_cell(const r56_artifact *channel,
                                const r56_universe *universe,
                                const r56_ranker_view *view,
                                const double probability[
                                    R56_SEMANTIC_CLASSES],
                                uint32_t remaining, r57_action action,
                                uint32_t *disagreement_ppm) {
    uint32_t version;
    uint32_t top;
    uint32_t version_bin;
    uint32_t mass_bin;
    uint32_t disagreement_bin;
    uint32_t reliability_bin;
    uint32_t action_type;
    double disagreement;
    double reliability;
    uint32_t index;
    r57_probability_summary(probability, &version, &top);
    version_bin = version <= 4u ? 0u : version <= 16u ? 1u :
                  version <= 64u ? 2u : 3u;
    mass_bin = top >= 750000u ? 3u : top >= 500000u ? 2u :
               top >= 250000u ? 1u : 0u;
    disagreement = r57_input_disagreement(universe, probability,
                                           action.input);
    *disagreement_ppm = (uint32_t)llround(disagreement * 1000000.0);
    if (*disagreement_ppm > 1000000u) *disagreement_ppm = 1000000u;
    disagreement_bin = *disagreement_ppm >= 750000u ? 3u :
        *disagreement_ppm >= 500000u ? 2u :
        *disagreement_ppm >= 250000u ? 1u : 0u;
    reliability = r57_sensor_reliability(channel, action.sensor);
    reliability_bin = reliability >= 0.75 ? 2u : reliability >= 0.5 ? 1u : 0u;
    action_type = r57_action_type(view, action);
    index = version_bin;
    index = index * R57_MASS_BINS + mass_bin;
    index = index * R57_DISAGREEMENT_BINS + disagreement_bin;
    index = index * R57_RELIABILITY_BINS + reliability_bin;
    index = index * R57_REMAINING_BINS + (remaining - 1u);
    index = index * R57_ACTION_TYPE_BINS + action_type;
    return index;
}

static int r57_probability_order(
    const double probability[R56_SEMANTIC_CLASSES],
    uint16_t order[R56_SEMANTIC_CLASSES]) {
    for (uint16_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index)
        order[index] = index;
    for (uint32_t left = 1u; left < R56_SEMANTIC_CLASSES; ++left) {
        uint16_t item = order[left];
        uint32_t right = left;
        while (right > 0u &&
               (probability[item] > probability[order[right - 1u]] ||
                (probability[item] == probability[order[right - 1u]] &&
                 item < order[right - 1u]))) {
            order[right] = order[right - 1u];
            right -= 1u;
        }
        order[right] = item;
    }
    return 0;
}

static uint32_t r57_truth_rank_and_mass(
    const double probability[R56_SEMANTIC_CLASSES], uint16_t truth,
    double *cumulative) {
    uint16_t order[R56_SEMANTIC_CLASSES];
    double mass = 0.0;
    r57_probability_order(probability, order);
    for (uint32_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index) {
        mass += probability[order[index]];
        if (order[index] == truth) {
            *cumulative = mass;
            return index + 1u;
        }
    }
    *cumulative = 1.0;
    return 0u;
}

static uint32_t r57_candidate_set_size(
    const double probability[R56_SEMANTIC_CLASSES], double threshold,
    uint16_t truth, uint32_t *contains_truth) {
    uint16_t order[R56_SEMANTIC_CLASSES];
    double cumulative = 0.0;
    uint32_t size = 0u;
    *contains_truth = 0u;
    if (threshold >= 1.0) {
        *contains_truth = truth < R56_SEMANTIC_CLASSES;
        return R56_SEMANTIC_CLASSES;
    }
    r57_probability_order(probability, order);
    while (size < R56_SEMANTIC_CLASSES && cumulative < threshold) {
        cumulative += probability[order[size]];
        *contains_truth |= order[size] == truth;
        size += 1u;
    }
    return size;
}

static int r57_search(const r56_universe *universe, uint16_t truth,
                      const double probability[R56_SEMANTIC_CLASSES],
                      uint16_t proposals[R57_PROPOSAL_BUDGET],
                      r56_search_result *search) {
    uint16_t order[R56_SEMANTIC_CLASSES];
    uint16_t injected;
    uint32_t cursor = 1u;
    r57_probability_order(probability, order);
    injected = order[0] == truth ? order[1] : order[0];
    proposals[0] = injected;
    for (uint32_t rank = 0u; rank < R56_SEMANTIC_CLASSES &&
         cursor < R57_PROPOSAL_BUDGET; ++rank)
        if (order[rank] != injected) proposals[cursor++] = order[rank];
    if (cursor != R57_PROPOSAL_BUDGET) return 1;
    return r56_verified_search(universe, universe->semantic[truth].table,
        proposals, R57_PROPOSAL_BUDGET, R57_GLOBAL_CAP, injected, search);
}

static int r57_posterior(const r56_artifact *channel,
                         const r56_universe *universe,
                         const r56_ranker_view *view,
                         double probability[R56_SEMANTIC_CLASSES],
                         uint32_t *channel_reads) {
    int64_t score[R56_SEMANTIC_CLASSES];
    uint32_t reads = 0u;
    int status = r56_posterior(channel, universe, view, R56_ARM_FULL,
                               probability, score, &reads);
    if (status == 0) *channel_reads += reads;
    return status;
}

static int32_t r57_local_log_score(const r56_artifact *channel,
                                   uint8_t sensor, uint8_t input,
                                   uint8_t value, uint8_t state) {
    r56_local_backoff level = r56_local_backoff_level(channel, sensor, input,
                                                       value);
    if (level == R56_BACKOFF_EXACT) {
        size_t context = ((size_t)sensor * R56_MODULUS + input) *
                         R56_MODULUS + value;
        return channel->local_exact_log_q20[
            context * R56_CHANNEL_STATES + state];
    }
    if (level == R56_BACKOFF_VALUE) {
        size_t context = (size_t)sensor * R56_MODULUS + value;
        return channel->local_value_log_q20[
            context * R56_CHANNEL_STATES + state];
    }
    if (level == R56_BACKOFF_SENSOR)
        return channel->local_sensor_log_q20[
            (size_t)sensor * R56_CHANNEL_STATES + state];
    return channel->local_global_log_q20[state];
}

static int32_t r57_transition_log_score(const r56_artifact *channel,
                                        uint8_t previous_sensor,
                                        uint8_t current_sensor,
                                        uint8_t previous_state,
                                        uint8_t current_state) {
    r56_transition_backoff level = r56_transition_backoff_level(channel,
        previous_sensor, current_sensor, previous_state);
    if (level == R56_TRANSITION_EXACT) {
        size_t context = (((size_t)previous_sensor * R56_SENSORS +
            current_sensor) * R56_CHANNEL_STATES) + previous_state;
        return channel->transition_exact_log_q20[
            context * R56_CHANNEL_STATES + current_state];
    }
    if (level == R56_TRANSITION_CURRENT) {
        size_t context = (size_t)current_sensor * R56_CHANNEL_STATES +
                         previous_state;
        return channel->transition_current_log_q20[
            context * R56_CHANNEL_STATES + current_state];
    }
    if (level == R56_TRANSITION_PREVIOUS)
        return channel->transition_previous_log_q20[
            (size_t)previous_state * R56_CHANNEL_STATES + current_state];
    return channel->transition_global_log_q20[current_state];
}

/*
 * Noisy GBS maximizes balance in the predictive outcome distribution. EC2's
 * efficient posterior edge-cut objective is the expected increase in squared
 * posterior mass. The latter equals the expected reduction in the total
 * weight of edges between distinct semantic classes.
 */
static int r57_expected_objectives(
    const double *prior, const double *likelihood, uint32_t hypotheses,
    double *noisy_gbs, double *ec2) {
    double outcome_mass[R56_CHANNEL_STATES] = {0.0};
    double squared_joint[R56_CHANNEL_STATES] = {0.0};
    double prior_total = 0.0;
    double prior_square = 0.0;
    double largest_outcome = 0.0;
    double posterior_square = 0.0;
    if (!prior || !likelihood || hypotheses == 0u ||
        hypotheses > R56_SEMANTIC_CLASSES || !noisy_gbs || !ec2)
        return 1;
    for (uint32_t semantic = 0u; semantic < hypotheses; ++semantic) {
        double row_total = 0.0;
        if (!isfinite(prior[semantic]) || prior[semantic] < 0.0) return 2;
        prior_total += prior[semantic];
        prior_square += prior[semantic] * prior[semantic];
        for (uint32_t outcome = 0u; outcome < R56_CHANNEL_STATES;
             ++outcome) {
            double value = likelihood[
                (size_t)semantic * R56_CHANNEL_STATES + outcome];
            double joint;
            if (!isfinite(value) || value < 0.0) return 3;
            row_total += value;
            joint = prior[semantic] * value;
            outcome_mass[outcome] += joint;
            squared_joint[outcome] += joint * joint;
        }
        if (fabs(row_total - 1.0) > 1e-9) return 4;
    }
    if (fabs(prior_total - 1.0) > 1e-9) return 5;
    for (uint32_t outcome = 0u; outcome < R56_CHANNEL_STATES; ++outcome) {
        if (outcome_mass[outcome] > largest_outcome)
            largest_outcome = outcome_mass[outcome];
        if (outcome_mass[outcome] > 0.0)
            posterior_square += squared_joint[outcome] /
                                outcome_mass[outcome];
    }
    *noisy_gbs = 1.0 - largest_outcome;
    *ec2 = posterior_square - prior_square;
    if (*ec2 < 0.0 && *ec2 > -1e-12) *ec2 = 0.0;
    return isfinite(*noisy_gbs) && isfinite(*ec2) && *noisy_gbs >= 0.0 &&
           *ec2 >= 0.0 ? 0 : 6;
}

static int r57_channel_action_objectives(
    const r56_artifact *channel, const r56_universe *universe,
    const r56_ranker_view *view,
    const double probability[R56_SEMANTIC_CLASSES], r57_action action,
    double *noisy_gbs, double *ec2, uint32_t *channel_reads) {
    double likelihood[R56_SEMANTIC_CLASSES * R56_CHANNEL_STATES];
    const r56_public_observation *previous;
    if (!channel || !r57_universe_valid(universe) || !view ||
        view->observation_count == 0u ||
        view->observation_count >= R57_TOTAL_OBSERVATIONS ||
        !probability || !r57_action_valid(action) || !noisy_gbs || !ec2 ||
        !channel_reads || channel->temperature_q20 <= 0)
        return 1;
    previous = &view->observations[view->observation_count - 1u];
    if (previous->input >= R56_MODULUS ||
        previous->sensor >= R56_SENSORS ||
        previous->observed >= R56_MODULUS || previous->missing > 1u ||
        (previous->missing && previous->observed != 0u))
        return 2;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES;
         ++semantic) {
        const uint8_t *table = universe->semantic[semantic].table;
        uint8_t previous_state = previous->missing ? R56_MODULUS :
            r57_mod((int32_t)previous->observed - table[previous->input]);
        uint8_t clean = table[action.input];
        double maximum = -INFINITY;
        double normalizer = 0.0;
        for (uint32_t outcome = 0u; outcome < R56_CHANNEL_STATES;
             ++outcome) {
            uint8_t state = outcome == R56_MODULUS ? R56_MODULUS :
                r57_mod((int32_t)outcome - clean);
            int64_t score = (int64_t)r57_local_log_score(channel,
                action.sensor, action.input, clean, state) +
                r57_transition_log_score(channel, previous->sensor,
                    action.sensor, previous_state, state);
            double scaled = (double)score /
                            (double)channel->temperature_q20;
            likelihood[(size_t)semantic * R56_CHANNEL_STATES + outcome] =
                scaled;
            if (scaled > maximum) maximum = scaled;
            *channel_reads += 2u;
        }
        for (uint32_t outcome = 0u; outcome < R56_CHANNEL_STATES;
             ++outcome) {
            size_t index = (size_t)semantic * R56_CHANNEL_STATES + outcome;
            likelihood[index] = exp(likelihood[index] - maximum);
            normalizer += likelihood[index];
        }
        if (!(normalizer > 0.0) || !isfinite(normalizer)) return 3;
        for (uint32_t outcome = 0u; outcome < R56_CHANNEL_STATES;
             ++outcome)
            likelihood[(size_t)semantic * R56_CHANNEL_STATES + outcome] /=
                normalizer;
    }
    return r57_expected_objectives(probability, likelihood,
                                   R56_SEMANTIC_CLASSES, noisy_gbs, ec2);
}

static int r57_analytic_action_score(
    r57_selector selector, const r56_artifact *channel,
    const r56_universe *universe, const r56_ranker_view *view,
    const double probability[R56_SEMANTIC_CLASSES], r57_action action,
    double *score, uint32_t *channel_reads) {
    double noisy_gbs;
    double ec2;
    if (!score || !channel_reads) return 1;
    if (selector == R57_SELECTOR_MAX_DISAGREEMENT) {
        *score = r57_input_disagreement(universe, probability, action.input);
        return 0;
    }
    if (selector != R57_SELECTOR_NOISY_GBS &&
        selector != R57_SELECTOR_EC2)
        return 2;
    if (r57_channel_action_objectives(channel, universe, view, probability,
            action, &noisy_gbs, &ec2, channel_reads) != 0)
        return 3;
    *score = selector == R57_SELECTOR_NOISY_GBS ? noisy_gbs : ec2;
    return 0;
}

static int r57_select_analytic(
    r57_selector selector, const r56_artifact *channel,
    const r56_universe *universe, const r56_ranker_view *view,
    const double probability[R56_SEMANTIC_CLASSES], r57_action *selected,
    uint32_t *channel_reads) {
    r57_action best = r57_action_from_index(0u);
    double best_score = -1.0;
    if (!selected || !channel_reads) return 1;
    for (uint32_t index = 0u; index < R57_ACTIONS; ++index) {
        r57_action action = r57_action_from_index(index);
        double score;
        if (r57_analytic_action_score(selector, channel, universe, view,
                probability, action, &score, channel_reads) != 0)
            return 2;
        if (score > best_score) {
            best = action;
            best_score = score;
        }
    }
    *selected = best;
    return 0;
}

static int r57_fill_policy_view(
    r57_policy_view *policy_view, const r56_ranker_view *view,
    const r57_action_observation history[R57_MAX_QUERY_BUDGET],
    uint32_t history_count, uint32_t remaining,
    const r56_universe *universe,
    const double probability[R56_SEMANTIC_CLASSES]) {
    uint32_t top;
    uint32_t version;
    double largest_disagreement = 0.0;
    if (!policy_view || !view || !history || !universe || !probability ||
        history_count > R57_MAX_QUERY_BUDGET || remaining == 0u ||
        history_count + remaining > R57_MAX_QUERY_BUDGET)
        return 1;
    memset(policy_view, 0, sizeof(*policy_view));
    policy_view->evidence = *view;
    policy_view->allowed_action_count = R57_ACTIONS;
    for (uint32_t index = 0u; index < R57_ACTIONS; ++index)
        policy_view->allowed_actions[index] = r57_action_from_index(index);
    policy_view->action_history_count = history_count;
    memcpy(policy_view->action_history, history,
           sizeof(*history) * history_count);
    policy_view->remaining_budget = remaining;
    r57_probability_summary(probability, &version, &top);
    policy_view->version_space_size = version;
    policy_view->top_probability_ppm = top;
    for (uint8_t input = 0u; input < R56_MODULUS; ++input) {
        double disagreement = r57_input_disagreement(universe, probability,
                                                     input);
        if (disagreement > largest_disagreement)
            largest_disagreement = disagreement;
    }
    policy_view->disagreement_ppm =
        (uint32_t)llround(largest_disagreement * 1000000.0);
    if (policy_view->disagreement_ppm > 1000000u)
        policy_view->disagreement_ppm = 1000000u;
    return r57_validate_policy_view(policy_view);
}

static int r57_choose_action(
    const r57_policy_artifact *policy, const r56_artifact *channel,
    const r56_universe *universe, const r57_episode *episode,
    const r56_ranker_view *view,
    const r57_action_observation history[R57_MAX_QUERY_BUDGET],
    uint32_t history_count, uint32_t remaining, uint32_t query_budget,
    r57_selector selector,
    const double probability[R56_SEMANTIC_CLASSES], r57_action *selected,
    uint32_t *candidate_updates, uint32_t *source_reads,
    uint32_t *policy_fallbacks, uint32_t *channel_reads) {
    static const r57_action fixed[R57_MAX_QUERY_BUDGET] = {
        {0u, 0u}, {1u, 1u}, {2u, 2u}, {1u, 1u},
        {3u, 0u}, {4u, 1u}, {5u, 2u}, {1u, 1u}
    };
    r57_policy_view policy_view;
    uint32_t step = query_budget - remaining;
    if (!policy || !channel || !r57_universe_valid(universe) || !episode ||
        !view || !history || query_budget == 0u ||
        query_budget > R57_MAX_QUERY_BUDGET || remaining == 0u ||
        remaining > query_budget || !selected || !candidate_updates ||
        !source_reads || !policy_fallbacks || !channel_reads ||
        r57_fill_policy_view(&policy_view, view, history, history_count,
                             remaining, universe, probability) != 0)
        return 1;
    if (selector == R57_SELECTOR_FIXED) {
        *selected = fixed[step];
        *candidate_updates += 1u;
        return 0;
    }
    if (selector == R57_SELECTOR_RANDOM) {
        uint64_t key = r57_event_key(episode->root_seed,
            r57_view_digest(view), step, 57u, 7u, 1u);
        *selected = r57_action_from_index((uint32_t)(key % R57_ACTIONS));
        *candidate_updates += 1u;
        return 0;
    }
    if (selector == R57_SELECTOR_REPEAT_VOTE) {
        const r56_public_observation *item = &view->observations[step % 3u];
        selected->input = item->input;
        selected->sensor = item->sensor;
        *candidate_updates += 1u;
        return 0;
    }
    if (selector == R57_SELECTOR_MAX_DISAGREEMENT ||
        selector == R57_SELECTOR_NOISY_GBS || selector == R57_SELECTOR_EC2) {
        if (r57_select_analytic(selector, channel, universe, view,
                probability, selected, channel_reads) != 0)
            return 2;
        *candidate_updates += R57_ACTIONS;
        return 0;
    }
    if (selector == R57_SELECTOR_ORACLE) {
        uint32_t best_rank = UINT32_MAX;
        uint32_t best_index = 0u;
        for (uint32_t index = 0u; index < R57_ACTIONS; ++index) {
            r56_ranker_view trial = *view;
            double trial_probability[R56_SEMANTIC_CLASSES];
            double cumulative;
            uint32_t rank;
            if (r57_append_response(universe, episode, &trial,
                    r57_action_from_index(index), NULL) != 0 ||
                r57_posterior(channel, universe, &trial, trial_probability,
                              channel_reads) != 0)
                return 2;
            rank = r57_truth_rank_and_mass(trial_probability,
                episode->truth_class, &cumulative);
            if (rank < best_rank) {
                best_rank = rank;
                best_index = index;
            }
        }
        *selected = r57_action_from_index(best_index);
        *candidate_updates += R57_ACTIONS;
        return 0;
    }
    if (selector == R57_SELECTOR_TRANSFERRED ||
        (selector >= R57_SELECTOR_SHUFFLED_00 &&
         selector <= R57_SELECTOR_SHUFFLED_30)) {
        int have_supported = 0;
        int32_t best_score = INT32_MIN;
        uint32_t best_index = 0u;
        uint32_t shift = selector == R57_SELECTOR_TRANSFERRED ? 0u :
            (uint32_t)(selector - R57_SELECTOR_SHUFFLED_00) + 1u;
        for (uint32_t index = 0u; index < R57_ACTIONS; ++index) {
            uint32_t mapped = (index + shift) % R57_ACTIONS;
            r57_action action = r57_action_from_index(mapped);
            uint32_t disagreement_ppm;
            uint32_t cell = r57_policy_cell(channel, universe, view,
                probability, remaining, action, &disagreement_ppm);
            int32_t score = policy->support[cell] ?
                policy->score_q20[cell] : INT32_MIN;
            *source_reads += 1u;
            if (score != INT32_MIN &&
                (!have_supported || score > best_score)) {
                have_supported = 1;
                best_score = score;
                best_index = index;
            }
        }
        *candidate_updates += R57_ACTIONS;
        if (!have_supported) {
            if (r57_select_analytic(R57_SELECTOR_EC2, channel, universe,
                    view, probability, selected, channel_reads) != 0)
                return 2;
            *policy_fallbacks += 1u;
        } else {
            *selected = r57_action_from_index(best_index);
        }
        return 0;
    }
    return 3;
}

static uint64_t r57_action_history_digest(
    const r57_action_observation history[R57_MAX_QUERY_BUDGET],
    uint32_t count) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5717);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    hash = r57_hash_update(hash, &count, sizeof(count));
    for (uint32_t index = 0u; index < count; ++index) {
        hash = r57_hash_update(hash, &history[index].action.input, 1u);
        hash = r57_hash_update(hash, &history[index].action.sensor, 1u);
        hash = r57_hash_update(hash, &history[index].response.input, 1u);
        hash = r57_hash_update(hash, &history[index].response.sensor, 1u);
        hash = r57_hash_update(hash, &history[index].response.observed, 1u);
        hash = r57_hash_update(hash, &history[index].response.missing, 1u);
    }
    return hash;
}

static int r57_run_episode_budget(const r57_policy_artifact *policy,
                                  const r56_artifact *channel,
                                  const r56_universe *universe,
                                  const r57_episode *episode,
                                  r57_selector selector,
                                  uint32_t query_budget,
                                  r57_episode_result *result) {
    r56_ranker_view view;
    double probability[R56_SEMANTIC_CLASSES];
    uint32_t channel_reads = 0u;
    if (!policy || !channel || !r57_universe_valid(universe) || !episode ||
        !result || selector < R57_SELECTOR_TRANSFERRED ||
        selector > R57_SELECTOR_SHUFFLED_30 ||
        policy->version != R57_POLICY_VERSION ||
        policy->r56_artifact_digest != channel->artifact_digest ||
        episode->truth_class >= R56_SEMANTIC_CLASSES || query_budget == 0u ||
        query_budget > R57_MAX_QUERY_BUDGET ||
        ((selector == R57_SELECTOR_TRANSFERRED ||
          (selector >= R57_SELECTOR_SHUFFLED_00 &&
           selector <= R57_SELECTOR_SHUFFLED_30)) &&
         !r57_policy_integrity_valid(policy)))
        return 1;
    memset(result, 0, sizeof(*result));
    if (r57_initial_view(universe, episode, &view) != 0) return 2;
    for (uint32_t step = 0u; step < query_budget; ++step) {
        r57_action action;
        uint32_t remaining = query_budget - step;
        if (r57_posterior(channel, universe, &view, probability,
                          &channel_reads) != 0)
            return 3;
        result->posterior_updates += 1u;
        if (r57_choose_action(policy, channel, universe, episode, &view,
                result->actions, step, remaining, query_budget, selector,
                probability,
                &action, &result->policy_candidate_updates,
                &result->source_artifact_reads, &result->policy_fallbacks,
                &channel_reads) != 0)
            return 4;
        result->actions[step].action = action;
        if (r57_append_response(universe, episode, &view, action,
                &result->actions[step].response) != 0)
            return 5;
        result->action_count += 1u;
    }
    if (r57_posterior(channel, universe, &view, probability,
                      &channel_reads) != 0)
        return 6;
    result->posterior_updates += 1u;
    result->channel_artifact_reads = channel_reads;
    result->truth_probability = probability[episode->truth_class];
    result->truth_rank = r57_truth_rank_and_mass(probability,
        episode->truth_class, &result->truth_cumulative_mass);
    result->candidate_set_size = r57_candidate_set_size(probability,
        (double)policy->risk_mass_q20 / (double)R56_Q20_ONE,
        episode->truth_class, &result->candidate_set_contains_truth);
    result->final_view = view;
    result->action_history_digest = r57_action_history_digest(result->actions,
                                                               result->action_count);
    if (r57_search(universe, episode->truth_class, probability,
                   result->proposals, &result->search) != 0 ||
        !result->search.solved || !result->search.certificate_valid ||
        result->search.accepted_class != episode->truth_class)
        return 7;
    return 0;
}

int r57_run_episode(const r57_policy_artifact *policy,
                    const r56_artifact *channel,
                    const r56_universe *universe,
                    const r57_episode *episode, r57_selector selector,
                    r57_episode_result *result) {
    return r57_run_episode_budget(policy, channel, universe, episode, selector,
                                  R57_QUERY_BUDGET, result);
}

static int r57_rollout_cost(const r56_artifact *channel,
                            const r56_universe *universe,
                            const r57_episode *episode,
                            const r56_ranker_view *start,
                            r57_action first, uint32_t remaining_after,
                            uint32_t *cost) {
    r56_ranker_view view = *start;
    double probability[R56_SEMANTIC_CLASSES];
    uint16_t proposals[R57_PROPOSAL_BUDGET];
    r56_search_result search;
    uint32_t channel_reads = 0u;
    if (!cost || r57_append_response(universe, episode, &view, first, NULL) != 0)
        return 1;
    for (uint32_t future = 0u; future < remaining_after; ++future) {
        r57_action action;
        if (r57_posterior(channel, universe, &view, probability,
                          &channel_reads) != 0)
            return 2;
        if (r57_select_analytic(R57_SELECTOR_EC2, channel, universe, &view,
                probability, &action, &channel_reads) != 0)
            return 2;
        if (r57_append_response(universe, episode, &view, action, NULL) != 0)
            return 3;
    }
    if (r57_posterior(channel, universe, &view, probability,
                      &channel_reads) != 0 ||
        r57_search(universe, episode->truth_class, probability, proposals,
                   &search) != 0)
        return 4;
    *cost = search.primary_cost;
    return 0;
}

static uint64_t r57_refresh_policy_digest(r57_policy_artifact *policy) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5757);
    uint64_t saved;
    if (!policy) return 0u;
    saved = policy->policy_digest;
    policy->policy_digest = 0u;
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    hash = r57_hash_update(hash, &policy->version, sizeof(policy->version));
    hash = r57_hash_update(hash, &policy->r56_artifact_digest,
                           sizeof(policy->r56_artifact_digest));
    hash = r57_hash_update(hash, &policy->training_seed,
                           sizeof(policy->training_seed));
    hash = r57_hash_update(hash, &policy->training_receipt_digest,
                           sizeof(policy->training_receipt_digest));
    hash = r57_hash_update(hash, &policy->calibration_receipt_digest,
                           sizeof(policy->calibration_receipt_digest));
    hash = r57_hash_update(hash, &policy->selector_receipt_digest,
                           sizeof(policy->selector_receipt_digest));
    hash = r57_hash_update(hash, &policy->training_families,
                           sizeof(policy->training_families));
    hash = r57_hash_update(hash, &policy->training_episodes,
                           sizeof(policy->training_episodes));
    hash = r57_hash_update(hash, &policy->logged_states,
                           sizeof(policy->logged_states));
    hash = r57_hash_update(hash, &policy->labelled_actions,
                           sizeof(policy->labelled_actions));
    hash = r57_hash_update(hash, &policy->fallback_cells,
                           sizeof(policy->fallback_cells));
    hash = r57_hash_update(hash, &policy->selected_comparator,
                           sizeof(policy->selected_comparator));
    hash = r57_hash_update(hash, &policy->risk_mass_q20,
                           sizeof(policy->risk_mass_q20));
    hash = r57_hash_update(hash, policy->support, sizeof(policy->support));
    hash = r57_hash_update(hash, policy->best, sizeof(policy->best));
    hash = r57_hash_update(hash, policy->score_q20,
                           sizeof(policy->score_q20));
    policy->policy_digest = hash;
    (void)saved;
    return hash;
}

static int r57_policy_integrity_valid(const r57_policy_artifact *policy) {
    r57_policy_artifact copy;
    uint64_t stored;
    if (!policy || policy->policy_digest == 0u) return 0;
    copy = *policy;
    stored = copy.policy_digest;
    return r57_refresh_policy_digest(&copy) == stored;
}

static int r57_selector_means(const r57_policy_artifact *policy,
                              const r56_artifact *channel,
                              const r56_universe *universe,
                              const uint16_t classes[R57_SELECTOR_FAMILIES],
                              double means[6], uint64_t *receipt) {
    static const r57_selector selectors[6] = {
        R57_SELECTOR_FIXED, R57_SELECTOR_RANDOM,
        R57_SELECTOR_MAX_DISAGREEMENT, R57_SELECTOR_NOISY_GBS,
        R57_SELECTOR_EC2, R57_SELECTOR_REPEAT_VOTE
    };
    uint64_t totals[6] = {0u};
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5725);
    uint32_t episodes = R57_SELECTOR_FAMILIES *
                        R57_DEVELOPMENT_CORRUPTION_FAMILIES;
    if (!policy || !channel || !r57_universe_valid(universe) || !classes ||
        !means || !receipt)
        return 1;
    for (uint32_t family = 0u; family < R57_SELECTOR_FAMILIES; ++family) {
        for (uint32_t corruption = 0u;
             corruption < R57_DEVELOPMENT_CORRUPTION_FAMILIES;
             ++corruption) {
            r57_episode episode;
            r57_make_episode(&episode, classes[family], family, corruption,
                             0u, UINT64_C(0x57d30001));
            for (uint32_t index = 0u; index < 6u; ++index) {
                r57_episode_result result;
                if (r57_run_episode(policy, channel, universe, &episode,
                                    selectors[index], &result) != 0)
                    return 2;
                totals[index] += result.search.primary_cost;
            }
        }
    }
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    hash = r57_hash_update(hash, classes,
        sizeof(*classes) * R57_SELECTOR_FAMILIES);
    hash = r57_hash_update(hash, totals, sizeof(totals));
    for (uint32_t index = 0u; index < 6u; ++index)
        means[index] = (double)totals[index] / (double)episodes;
    *receipt = hash;
    return 0;
}

int r57_build_policy(r57_policy_artifact *policy,
                     const r56_artifact *channel,
                     const r56_universe *universe) {
    uint16_t training[R57_POLICY_TRAIN_FAMILIES];
    uint16_t selector[R57_SELECTOR_FAMILIES];
    uint16_t calibration[R57_CALIBRATION_FAMILIES];
    uint16_t development[R57_DEVELOPMENT_PROGRAM_FAMILIES];
    uint16_t sealed[R56_SEMANTIC_CLASSES];
    uint32_t sealed_count;
    uint64_t training_hash = UINT64_C(1469598103934665603);
    uint64_t training_domain = UINT64_C(5721);
    double selector_cost[6];
    uint64_t selector_receipt;
    static const r57_selector comparator_selectors[6] = {
        R57_SELECTOR_FIXED, R57_SELECTOR_RANDOM,
        R57_SELECTOR_MAX_DISAGREEMENT, R57_SELECTOR_NOISY_GBS,
        R57_SELECTOR_EC2, R57_SELECTOR_REPEAT_VOTE
    };
    if (!policy || !channel || !r57_universe_valid(universe) ||
        channel->artifact_digest == 0u ||
        r57_select_semantic_splits(universe, training, selector, calibration,
                                   development, sealed, &sealed_count) != 0)
        return 1;
    memset(policy, 0, sizeof(*policy));
    policy->version = R57_POLICY_VERSION;
    policy->r56_artifact_digest = channel->artifact_digest;
    policy->training_seed = UINT64_C(0x57a10001);
    policy->training_families = R57_POLICY_TRAIN_FAMILIES;
    policy->training_episodes = R57_TRAINING_EPISODES;
    policy->risk_mass_q20 = R56_Q20_ONE;
    training_hash = r57_hash_update(training_hash, &training_domain,
                                     sizeof(training_domain));
    training_hash = r57_hash_update(training_hash, training,
                                     sizeof(training));
    for (uint32_t family = 0u; family < R57_POLICY_TRAIN_FAMILIES; ++family) {
        for (uint32_t repeat = 0u; repeat < 2u; ++repeat) {
            r57_episode episode;
            r56_ranker_view view;
            r57_action_observation history[R57_MAX_QUERY_BUDGET];
            memset(history, 0, sizeof(history));
            r57_make_episode(&episode, training[family], family,
                (family + repeat) % R57_DEVELOPMENT_CORRUPTION_FAMILIES,
                repeat, UINT64_C(0x57a10001));
            if (r57_initial_view(universe, &episode, &view) != 0) return 2;
            for (uint32_t step = 0u; step < R57_QUERY_BUDGET; ++step) {
                double probability[R56_SEMANTIC_CLASSES];
                uint32_t channel_reads = 0u;
                uint32_t best_cost = UINT32_MAX;
                uint32_t best_action = 0u;
                uint32_t remaining = R57_QUERY_BUDGET - step;
                if (r57_posterior(channel, universe, &view, probability,
                                  &channel_reads) != 0)
                    return 3;
                for (uint32_t action_index = 0u;
                     action_index < R57_ACTIONS; ++action_index) {
                    r57_action action = r57_action_from_index(action_index);
                    uint32_t disagreement_ppm;
                    uint32_t cell = r57_policy_cell(channel, universe, &view,
                        probability, remaining, action, &disagreement_ppm);
                    uint32_t cost;
                    if (r57_rollout_cost(channel, universe, &episode, &view,
                            action, remaining - 1u, &cost) != 0)
                        return 4;
                    policy->support[cell] += 1u;
                    policy->labelled_actions += 1u;
                    if (cost < best_cost) {
                        best_cost = cost;
                        best_action = action_index;
                    }
                }
                {
                    uint32_t disagreement_ppm;
                    uint32_t cell = r57_policy_cell(channel, universe, &view,
                        probability, remaining,
                        r57_action_from_index(best_action),
                        &disagreement_ppm);
                    r57_action logged;
                    policy->best[cell] += 1u;
                    policy->logged_states += 1u;
                    training_hash = r57_hash_update(training_hash, &family,
                                                     sizeof(family));
                    training_hash = r57_hash_update(training_hash, &repeat,
                                                     sizeof(repeat));
                    training_hash = r57_hash_update(training_hash, &step,
                                                     sizeof(step));
                    training_hash = r57_hash_update(training_hash, &best_action,
                                                     sizeof(best_action));
                    training_hash = r57_hash_update(training_hash, &best_cost,
                                                     sizeof(best_cost));
                    if (repeat == 0u) {
                        uint64_t key = r57_event_key(episode.root_seed,
                            r57_view_digest(&view), step, 57u, 1u, 0u);
                        logged = r57_action_from_index(
                            (uint32_t)(key % R57_ACTIONS));
                    } else {
                        if (r57_select_analytic(R57_SELECTOR_EC2, channel,
                                universe, &view, probability, &logged,
                                &channel_reads) != 0)
                            return 5;
                    }
                    history[step].action = logged;
                    if (r57_append_response(universe, &episode, &view, logged,
                            &history[step].response) != 0)
                        return 5;
                }
            }
        }
    }
    policy->training_receipt_digest = training_hash;
    for (uint32_t cell = 0u; cell < R57_POLICY_CELLS; ++cell) {
        if (policy->support[cell] == 0u) policy->fallback_cells += 1u;
        policy->score_q20[cell] = r56_log_probability_q20(
            policy->best[cell], policy->support[cell], 2u);
    }
    if (r57_selector_means(policy, channel, universe, selector, selector_cost,
                           &selector_receipt) != 0)
        return 6;
    policy->selected_comparator = comparator_selectors[0];
    for (uint32_t index = 1u; index < 6u; ++index)
        if (selector_cost[index] < selector_cost[
                policy->selected_comparator - R57_SELECTOR_FIXED])
            policy->selected_comparator = comparator_selectors[index];
    policy->selector_receipt_digest = selector_receipt;
    r57_refresh_policy_digest(policy);
    {
        uint64_t calibration_hash = UINT64_C(1469598103934665603);
        uint64_t domain = UINT64_C(5723);
        calibration_hash = r57_hash_update(calibration_hash, &domain,
                                            sizeof(domain));
        calibration_hash = r57_hash_update(calibration_hash, calibration,
                                            sizeof(calibration));
        for (uint32_t family = 0u; family < R57_CALIBRATION_FAMILIES;
             ++family) {
            int32_t worst_q20 = 0;
            for (uint32_t draw = 0u;
                 draw < R57_DEVELOPMENT_CORRUPTION_FAMILIES; ++draw) {
                r57_episode episode;
                r57_episode_result result;
                int32_t mass_q20;
                r57_make_episode(&episode, calibration[family], family, draw,
                                 0u, UINT64_C(0x57c10001));
                if (r57_run_episode(policy, channel, universe, &episode,
                                    R57_SELECTOR_TRANSFERRED, &result) != 0)
                    return 7;
                mass_q20 = (int32_t)llround(result.truth_cumulative_mass *
                                            R56_Q20_ONE);
                if (mass_q20 > worst_q20) worst_q20 = mass_q20;
            }
            calibration_hash = r57_hash_update(calibration_hash, &worst_q20,
                                                sizeof(worst_q20));
        }
        policy->risk_mass_q20 = R56_Q20_ONE;
        policy->calibration_receipt_digest = calibration_hash;
    }
    if (policy->training_families != R57_POLICY_TRAIN_FAMILIES ||
        policy->training_episodes != R57_TRAINING_EPISODES ||
        policy->logged_states != R57_TRAINING_EPISODES * R57_QUERY_BUDGET ||
        policy->labelled_actions != policy->logged_states * R57_ACTIONS ||
        policy->selected_comparator < R57_SELECTOR_FIXED ||
        policy->selected_comparator > R57_SELECTOR_REPEAT_VOTE ||
        sealed_count == 0u)
        return 8;
    r57_refresh_policy_digest(policy);
    return 0;
}

static void r57_put_u32(uint8_t *bytes, size_t *cursor, uint32_t value) {
    bytes[(*cursor)++] = (uint8_t)value;
    bytes[(*cursor)++] = (uint8_t)(value >> 8u);
    bytes[(*cursor)++] = (uint8_t)(value >> 16u);
    bytes[(*cursor)++] = (uint8_t)(value >> 24u);
}

static void r57_put_u64(uint8_t *bytes, size_t *cursor, uint64_t value) {
    r57_put_u32(bytes, cursor, (uint32_t)value);
    r57_put_u32(bytes, cursor, (uint32_t)(value >> 32u));
}

static uint32_t r57_get_u32(const uint8_t *bytes, size_t *cursor) {
    uint32_t value = bytes[*cursor] |
        ((uint32_t)bytes[*cursor + 1u] << 8u) |
        ((uint32_t)bytes[*cursor + 2u] << 16u) |
        ((uint32_t)bytes[*cursor + 3u] << 24u);
    *cursor += 4u;
    return value;
}

static uint64_t r57_get_u64(const uint8_t *bytes, size_t *cursor) {
    uint64_t low = r57_get_u32(bytes, cursor);
    uint64_t high = r57_get_u32(bytes, cursor);
    return low | (high << 32u);
}

size_t r57_policy_serialized_size(void) {
    return 8u + 4u + 6u * 8u + 7u * 4u +
           3u * R57_POLICY_CELLS * 4u + 8u;
}

int r57_serialize_policy(const r57_policy_artifact *policy, uint8_t *bytes,
                         size_t capacity, size_t *written) {
    r57_policy_artifact copy;
    size_t cursor = 0u;
    uint64_t checksum;
    if (!policy || !bytes || !written ||
        capacity < r57_policy_serialized_size() ||
        policy->version != R57_POLICY_VERSION)
        return 1;
    copy = *policy;
    if (r57_refresh_policy_digest(&copy) != policy->policy_digest)
        return 2;
    memcpy(bytes + cursor, r57_policy_magic, sizeof(r57_policy_magic));
    cursor += sizeof(r57_policy_magic);
    r57_put_u32(bytes, &cursor, policy->version);
    r57_put_u64(bytes, &cursor, policy->r56_artifact_digest);
    r57_put_u64(bytes, &cursor, policy->training_seed);
    r57_put_u64(bytes, &cursor, policy->training_receipt_digest);
    r57_put_u64(bytes, &cursor, policy->calibration_receipt_digest);
    r57_put_u64(bytes, &cursor, policy->selector_receipt_digest);
    r57_put_u64(bytes, &cursor, policy->policy_digest);
    r57_put_u32(bytes, &cursor, policy->training_families);
    r57_put_u32(bytes, &cursor, policy->training_episodes);
    r57_put_u32(bytes, &cursor, policy->logged_states);
    r57_put_u32(bytes, &cursor, policy->labelled_actions);
    r57_put_u32(bytes, &cursor, policy->fallback_cells);
    r57_put_u32(bytes, &cursor, policy->selected_comparator);
    r57_put_u32(bytes, &cursor, (uint32_t)policy->risk_mass_q20);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        r57_put_u32(bytes, &cursor, policy->support[index]);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        r57_put_u32(bytes, &cursor, policy->best[index]);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        r57_put_u32(bytes, &cursor, (uint32_t)policy->score_q20[index]);
    if (cursor + 8u != r57_policy_serialized_size()) return 3;
    checksum = r57_hash(bytes, cursor, UINT64_C(5758));
    r57_put_u64(bytes, &cursor, checksum);
    *written = cursor;
    return 0;
}

int r57_deserialize_policy(r57_policy_artifact *policy, const uint8_t *bytes,
                           size_t size) {
    r57_policy_artifact decoded;
    size_t cursor = 0u;
    uint64_t expected_checksum;
    uint64_t stored_checksum;
    uint64_t stored_digest;
    if (!policy || !bytes || size != r57_policy_serialized_size() ||
        memcmp(bytes, r57_policy_magic, sizeof(r57_policy_magic)) != 0)
        return 1;
    expected_checksum = r57_hash(bytes, size - 8u, UINT64_C(5758));
    memset(&decoded, 0, sizeof(decoded));
    cursor += sizeof(r57_policy_magic);
    decoded.version = r57_get_u32(bytes, &cursor);
    decoded.r56_artifact_digest = r57_get_u64(bytes, &cursor);
    decoded.training_seed = r57_get_u64(bytes, &cursor);
    decoded.training_receipt_digest = r57_get_u64(bytes, &cursor);
    decoded.calibration_receipt_digest = r57_get_u64(bytes, &cursor);
    decoded.selector_receipt_digest = r57_get_u64(bytes, &cursor);
    decoded.policy_digest = r57_get_u64(bytes, &cursor);
    decoded.training_families = r57_get_u32(bytes, &cursor);
    decoded.training_episodes = r57_get_u32(bytes, &cursor);
    decoded.logged_states = r57_get_u32(bytes, &cursor);
    decoded.labelled_actions = r57_get_u32(bytes, &cursor);
    decoded.fallback_cells = r57_get_u32(bytes, &cursor);
    decoded.selected_comparator = r57_get_u32(bytes, &cursor);
    decoded.risk_mass_q20 = (int32_t)r57_get_u32(bytes, &cursor);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        decoded.support[index] = r57_get_u32(bytes, &cursor);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        decoded.best[index] = r57_get_u32(bytes, &cursor);
    for (uint32_t index = 0u; index < R57_POLICY_CELLS; ++index)
        decoded.score_q20[index] = (int32_t)r57_get_u32(bytes, &cursor);
    stored_checksum = r57_get_u64(bytes, &cursor);
    if (cursor != size || stored_checksum != expected_checksum ||
        decoded.version != R57_POLICY_VERSION ||
        decoded.training_families != R57_POLICY_TRAIN_FAMILIES ||
        decoded.training_episodes != R57_TRAINING_EPISODES ||
        decoded.selected_comparator < R57_SELECTOR_FIXED ||
        decoded.selected_comparator > R57_SELECTOR_REPEAT_VOTE ||
        decoded.risk_mass_q20 <= 0 ||
        decoded.risk_mass_q20 > R56_Q20_ONE)
        return 2;
    stored_digest = decoded.policy_digest;
    if (r57_refresh_policy_digest(&decoded) != stored_digest) return 3;
    *policy = decoded;
    return 0;
}

int r57_write_policy(const char *path, const r57_policy_artifact *policy) {
    size_t size = r57_policy_serialized_size();
    uint8_t *bytes;
    size_t written = 0u;
    FILE *file;
    int status = 0;
    if (!path || !policy) return 1;
    bytes = (uint8_t *)malloc(size);
    if (!bytes) return 2;
    if (r57_serialize_policy(policy, bytes, size, &written) != 0 ||
        written != size) {
        free(bytes);
        return 3;
    }
    file = fopen(path, "wb");
    if (!file) {
        free(bytes);
        return 4;
    }
    if (fwrite(bytes, 1u, size, file) != size) status = 5;
    if (fclose(file) != 0) status = 5;
    free(bytes);
    return status;
}

int r57_read_policy(const char *path, r57_policy_artifact *policy) {
    size_t size = r57_policy_serialized_size();
    uint8_t *bytes;
    FILE *file;
    long file_size;
    int status;
    if (!path || !policy) return 1;
    file = fopen(path, "rb");
    if (!file) return 2;
    if (fseek(file, 0, SEEK_END) != 0 || (file_size = ftell(file)) < 0 ||
        (size_t)file_size != size || fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        return 3;
    }
    bytes = (uint8_t *)malloc(size);
    if (!bytes) {
        fclose(file);
        return 4;
    }
    {
        size_t received = fread(bytes, 1u, size, file);
        int extra = fgetc(file);
        int failed = ferror(file);
        int close_status = fclose(file);
        if (received != size || extra != EOF || failed || close_status != 0) {
            free(bytes);
            return 5;
        }
    }
    status = r57_deserialize_policy(policy, bytes, size);
    free(bytes);
    return status == 0 ? 0 : 6;
}

static const char *r57_selector_name(uint32_t selector) {
    switch ((r57_selector)selector) {
        case R57_SELECTOR_TRANSFERRED: return "transferred";
        case R57_SELECTOR_FIXED: return "fixed_schedule";
        case R57_SELECTOR_RANDOM: return "seeded_random";
        case R57_SELECTOR_MAX_DISAGREEMENT: return "max_disagreement";
        case R57_SELECTOR_NOISY_GBS: return "noisy_gbs";
        case R57_SELECTOR_EC2: return "ec2";
        case R57_SELECTOR_REPEAT_VOTE: return "repeat_vote";
        case R57_SELECTOR_ORACLE: return "oracle";
        default: return "unknown";
    }
}

static const char *r57_arm_name(r57_arm arm, char buffer[32]) {
    switch (arm) {
        case R57_ARM_FULL: return "full";
        case R57_ARM_SOURCE_FREE: return "source_free";
        case R57_ARM_SOURCE_ABLATION: return "source_ablation";
        case R57_ARM_FIXED: return "fixed_schedule";
        case R57_ARM_RANDOM: return "seeded_random";
        case R57_ARM_MAX_DISAGREEMENT: return "max_disagreement";
        case R57_ARM_NOISY_GBS: return "noisy_gbs";
        case R57_ARM_EC2: return "ec2";
        case R57_ARM_REPEAT_VOTE: return "repeat_vote";
        case R57_ARM_ORACLE: return "oracle";
        default:
            if (arm >= R57_ARM_SHUFFLED_00 && arm <= R57_ARM_SHUFFLED_30) {
                (void)snprintf(buffer, 32u, "policy_shuffle_%02u",
                    (unsigned)arm - R57_ARM_SHUFFLED_00);
                return buffer;
            }
            return "invalid";
    }
}

static r57_selector r57_arm_selector(r57_arm arm,
                                     const r57_policy_artifact *policy) {
    switch (arm) {
        case R57_ARM_FULL: return R57_SELECTOR_TRANSFERRED;
        case R57_ARM_SOURCE_FREE:
        case R57_ARM_SOURCE_ABLATION:
            return (r57_selector)policy->selected_comparator;
        case R57_ARM_FIXED: return R57_SELECTOR_FIXED;
        case R57_ARM_RANDOM: return R57_SELECTOR_RANDOM;
        case R57_ARM_MAX_DISAGREEMENT:
            return R57_SELECTOR_MAX_DISAGREEMENT;
        case R57_ARM_NOISY_GBS: return R57_SELECTOR_NOISY_GBS;
        case R57_ARM_EC2: return R57_SELECTOR_EC2;
        case R57_ARM_REPEAT_VOTE: return R57_SELECTOR_REPEAT_VOTE;
        case R57_ARM_ORACLE: return R57_SELECTOR_ORACLE;
        default:
            return (r57_selector)(R57_SELECTOR_SHUFFLED_00 +
                ((uint32_t)arm - R57_ARM_SHUFFLED_00));
    }
}

static uint64_t r57_universe_digest(const r56_universe *universe) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5701);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    for (uint32_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index) {
        hash = r57_hash_update(hash,
            universe->semantic[index].representative, R56_PROGRAM_DEPTH);
        hash = r57_hash_update(hash, universe->semantic[index].table,
                               R56_MODULUS);
    }
    return hash;
}

static uint64_t r57_allowed_actions_digest(void) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5705);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    for (uint32_t index = 0u; index < R57_ACTIONS; ++index) {
        r57_action action = r57_action_from_index(index);
        hash = r57_hash_update(hash, &action.input, 1u);
        hash = r57_hash_update(hash, &action.sensor, 1u);
    }
    return hash;
}

static uint64_t r57_episode_digest(const r57_episode *episode) {
    uint64_t hash = UINT64_C(1469598103934665603);
    uint64_t domain = UINT64_C(5709);
    hash = r57_hash_update(hash, &domain, sizeof(domain));
    hash = r57_hash_update(hash, &episode->root_seed,
                           sizeof(episode->root_seed));
    hash = r57_hash_update(hash, &episode->program_slot,
                           sizeof(episode->program_slot));
    hash = r57_hash_update(hash, &episode->corruption_slot,
                           sizeof(episode->corruption_slot));
    hash = r57_hash_update(hash, &episode->repeat, sizeof(episode->repeat));
    hash = r57_hash_update(hash, &episode->truth_class,
                           sizeof(episode->truth_class));
    hash = r57_hash_update(hash, &episode->corruption.template_id, 1u);
    hash = r57_hash_update(hash, &episode->corruption.severity, 1u);
    hash = r57_hash_update(hash, &episode->corruption.direction, 1u);
    hash = r57_hash_update(hash, &episode->corruption.location, 1u);
    hash = r57_hash_update(hash, &episode->corruption.block_length, 1u);
    return hash;
}

static int r57_append(char *buffer, size_t capacity, size_t *length,
                      const char *format, ...) {
    va_list arguments;
    int written;
    if (!buffer || !length || *length >= capacity || !format) return 1;
    va_start(arguments, format);
    written = vsnprintf(buffer + *length, capacity - *length, format,
                        arguments);
    va_end(arguments);
    if (written < 0 || (size_t)written >= capacity - *length) return 2;
    *length += (size_t)written;
    return 0;
}

static int r57_write_trace_row(
    FILE *trace, uint64_t *trace_digest, const r56_universe *universe,
    const r56_artifact *channel, const r57_policy_artifact *policy,
    const r57_episode *episode, uint32_t program, uint32_t corruption,
    uint32_t repeat, r57_arm arm, const r57_episode_result *result) {
    char line[16384];
    char arm_buffer[32];
    const char *arm_name = r57_arm_name(arm, arm_buffer);
    r56_ranker_view initial;
    r56_certificate certificate;
    size_t length = 0u;
    uint64_t initial_digest;
    uint64_t episode_digest;
    uint64_t universe_digest;
    uint64_t allowed_digest;
    if (!trace || !trace_digest || !universe || !channel || !policy ||
        !episode || !result || r57_initial_view(universe, episode, &initial) != 0 ||
        !r56_verify_semantic_class(universe,
            (uint16_t)result->search.accepted_class,
            universe->semantic[episode->truth_class].table, &certificate))
        return 1;
    initial_digest = r57_view_digest(&initial);
    episode_digest = r57_episode_digest(episode);
    universe_digest = r57_universe_digest(universe);
    allowed_digest = r57_allowed_actions_digest();
    if (r57_append(line, sizeof(line), &length,
        "{\"schema\":\"zero.reasoner57_development_trace.v1\","
        "\"experiment\":\"reasoner57-active-evidence-development-v1\","
        "\"episode_id\":\"r57-development-p%02u-c%02u-r%u\","
        "\"program_family_id\":\"r57-program-%02u\","
        "\"corruption_family_id\":\"r57-corruption-%02u\","
        "\"program_index\":%u,\"corruption_index\":%u,"
        "\"repeat_index\":%u,\"truth_class\":%u,\"arm\":\"%s\","
        "\"selected_comparator\":\"%s\","
        "\"initial_observations\":%u,\"observation_queries\":%u,"
        "\"observations_consumed\":%u,\"policy_candidate_updates\":%u,"
        "\"posterior_updates\":%u,\"source_artifact_reads\":%u,"
        "\"channel_artifact_reads\":%u,\"policy_fallbacks\":%u,"
        "\"primary_cost\":%u,\"verifier_checks\":%u,"
        "\"proposal_verifier_checks\":%u,\"partial_expansions\":%u,"
        "\"fallback_verifier_checks\":%u,"
        "\"fallback_partial_expansions\":%u,"
        "\"fallback_started\":%s,\"global_cap_hit\":%s,"
        "\"exact\":%s,\"certificate_valid\":%s,"
        "\"invalid_first_rejected\":%s,\"accepted_class\":%u,"
        "\"certificate_digest\":\"%016llx\","
        "\"truth_probability\":%.17g,\"truth_cumulative_mass\":%.17g,"
        "\"truth_rank\":%u,\"candidate_set_size\":%u,"
        "\"candidate_set_contains_truth\":%s,"
        "\"action_history_digest\":\"%016llx\","
        "\"universe_digest\":\"%016llx\","
        "\"initial_evidence_digest\":\"%016llx\","
        "\"allowed_actions_digest\":\"%016llx\","
        "\"latent_episode_digest\":\"%016llx\","
        "\"potential_response_digest\":\"%016llx\","
        "\"verifier_digest\":\"%016llx\","
        "\"channel_artifact_digest\":\"%016llx\","
        "\"policy_artifact_digest\":\"%016llx\",\"proposal_classes\":[",
        program, corruption, repeat, program, corruption, program, corruption,
        repeat, episode->truth_class, arm_name,
        r57_selector_name(policy->selected_comparator), R57_INITIAL_READS,
        result->action_count, result->final_view.observation_count,
        result->policy_candidate_updates, result->posterior_updates,
        result->source_artifact_reads, result->channel_artifact_reads,
        result->policy_fallbacks, result->search.primary_cost,
        result->search.verifier_checks, result->search.proposal_verifier_checks,
        result->search.partial_expansions,
        result->search.fallback_verifier_checks,
        result->search.fallback_partial_expansions,
        result->search.fallback_started ? "true" : "false",
        result->search.global_cap_hit ? "true" : "false",
        result->search.solved ? "true" : "false",
        result->search.certificate_valid ? "true" : "false",
        result->search.invalid_first_rejected ? "true" : "false",
        result->search.accepted_class,
        (unsigned long long)certificate.table_digest,
        result->truth_probability, result->truth_cumulative_mass,
        result->truth_rank, result->candidate_set_size,
        result->candidate_set_contains_truth ? "true" : "false",
        (unsigned long long)result->action_history_digest,
        (unsigned long long)universe_digest,
        (unsigned long long)initial_digest,
        (unsigned long long)allowed_digest,
        (unsigned long long)episode_digest,
        (unsigned long long)r57_hash("r57-structural-response-v1", 26u, 5711u),
        (unsigned long long)r57_hash("r56-exhaustive-gf17-v1", 24u, 5713u),
        (unsigned long long)channel->artifact_digest,
        (unsigned long long)policy->policy_digest) != 0)
        return 2;
    for (uint32_t index = 0u; index < R57_PROPOSAL_BUDGET; ++index)
        if (r57_append(line, sizeof(line), &length, "%s%u",
                index ? "," : "", result->proposals[index]) != 0)
            return 3;
    if (r57_append(line, sizeof(line), &length, "],\"actions\":[") != 0)
        return 4;
    for (uint32_t index = 0u; index < result->action_count; ++index) {
        const r57_action_observation *item = &result->actions[index];
        if (r57_append(line, sizeof(line), &length,
            "%s{\"input\":%u,\"sensor\":%u,\"observed\":%u,"
            "\"missing\":%s}", index ? "," : "", item->action.input,
            item->action.sensor, item->response.observed,
            item->response.missing ? "true" : "false") != 0)
            return 5;
    }
    if (r57_append(line, sizeof(line), &length, "],\"observations\":[") != 0)
        return 6;
    for (uint32_t index = 0u; index < result->final_view.observation_count;
         ++index) {
        const r56_public_observation *item =
            &result->final_view.observations[index];
        if (r57_append(line, sizeof(line), &length,
            "%s{\"input\":%u,\"sensor\":%u,\"observed\":%u,"
            "\"missing\":%s}", index ? "," : "", item->input,
            item->sensor, item->observed,
            item->missing ? "true" : "false") != 0)
            return 7;
    }
    if (r57_append(line, sizeof(line), &length, "]}\n") != 0 ||
        fwrite(line, 1u, length, trace) != length)
        return 8;
    *trace_digest = r57_hash_update(*trace_digest, line, length);
    return 0;
}

static int r57_counterexample_oracle(const r56_universe *universe,
                                     uint16_t truth, uint32_t *checks,
                                     uint32_t *queries) {
    uint8_t consistent[R56_SEMANTIC_CLASSES];
    uint8_t queried[R56_MODULUS] = {0};
    if (!r57_universe_valid(universe) || truth >= R56_SEMANTIC_CLASSES ||
        !checks || !queries)
        return 1;
    memset(consistent, 1, sizeof(consistent));
    *checks = 0u;
    *queries = 0u;
    while (1) {
        uint16_t candidate = UINT16_MAX;
        r56_certificate certificate;
        for (uint16_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index)
            if (consistent[index]) {
                candidate = index;
                break;
            }
        if (candidate == UINT16_MAX) return 2;
        *checks += 1u;
        if (r56_verify_semantic_class(universe, candidate,
                universe->semantic[truth].table, &certificate))
            return 0;
        {
            uint32_t mismatch = R56_MODULUS;
            for (uint32_t input = 0u; input < R56_MODULUS; ++input)
                if (universe->semantic[candidate].table[input] !=
                    universe->semantic[truth].table[input]) {
                    mismatch = input;
                    break;
                }
            if (mismatch >= R56_MODULUS) return 3;
            if (!queried[mismatch]) {
                queried[mismatch] = 1u;
                *queries += 1u;
            }
            for (uint32_t semantic = 0u;
                 semantic < R56_SEMANTIC_CLASSES; ++semantic)
                if (consistent[semantic] &&
                    universe->semantic[semantic].table[mismatch] !=
                    universe->semantic[truth].table[mismatch])
                    consistent[semantic] = 0u;
        }
    }
}

int r57_run_development(r57_development_result *result,
                        const char *trace_path, const char *policy_path,
                        const char *r56_artifact_path) {
    static const uint32_t secondary_budgets[4] = {1u, 2u, 4u, 8u};
    r56_universe *universe = NULL;
    r56_artifact *channel = NULL;
    r57_policy_artifact *policy = NULL;
    r57_policy_artifact *roundtrip = NULL;
    uint16_t training[R57_POLICY_TRAIN_FAMILIES];
    uint16_t selector_classes[R57_SELECTOR_FAMILIES];
    uint16_t calibration[R57_CALIBRATION_FAMILIES];
    uint16_t development[R57_DEVELOPMENT_PROGRAM_FAMILIES];
    uint16_t sealed[R56_SEMANTIC_CLASSES];
    uint32_t sealed_count;
    double selector_cost[6];
    uint64_t selector_receipt;
    FILE *trace = NULL;
    uint64_t trace_digest = UINT64_C(1469598103934665603);
    uint64_t trace_domain = UINT64_C(5729);
    double full_cost = 0.0;
    double comparator_cost = 0.0;
    double oracle_cost = 0.0;
    double evidence_checks = 0.0;
    double evidence_queries = 0.0;
    int status = 0;
    if (!R57_DEVELOPMENT_PREREQUISITE_READY)
        return R57_PREREQUISITE_PENDING;
    if (!result || !trace_path || !policy_path || !r56_artifact_path)
        return 1;
    memset(result, 0, sizeof(*result));
    universe = (r56_universe *)malloc(sizeof(*universe));
    channel = (r56_artifact *)malloc(sizeof(*channel));
    policy = (r57_policy_artifact *)malloc(sizeof(*policy));
    roundtrip = (r57_policy_artifact *)malloc(sizeof(*roundtrip));
    if (!universe || !channel || !policy || !roundtrip) {
        status = 2;
        goto cleanup;
    }
    if (r56_build_universe(universe) != 0 ||
        r56_read_artifact(r56_artifact_path, channel) != 0 ||
        r57_select_semantic_splits(universe, training, selector_classes,
            calibration, development, sealed, &sealed_count) != 0 ||
        r57_build_policy(policy, channel, universe) != 0 ||
        r57_write_policy(policy_path, policy) != 0 ||
        r57_read_policy(policy_path, roundtrip) != 0 ||
        memcmp(policy, roundtrip, sizeof(*policy)) != 0) {
        status = 3;
        goto cleanup;
    }
    if (r57_selector_means(policy, channel, universe, selector_classes,
                           selector_cost, &selector_receipt) != 0 ||
        selector_receipt != policy->selector_receipt_digest) {
        status = 4;
        goto cleanup;
    }
    trace = fopen(trace_path, "wb");
    if (!trace) {
        status = 5;
        goto cleanup;
    }
    trace_digest = r57_hash_update(trace_digest, &trace_domain,
                                    sizeof(trace_domain));
    for (uint32_t program = 0u;
         program < R57_DEVELOPMENT_PROGRAM_FAMILIES; ++program) {
        for (uint32_t corruption = 0u;
             corruption < R57_DEVELOPMENT_CORRUPTION_FAMILIES;
             ++corruption) {
            for (uint32_t repeat = 0u; repeat < R57_NESTED_REPEATS;
                 ++repeat) {
                r57_episode episode;
                r57_episode_result source_free;
                int have_source_free = 0;
                uint32_t oracle_checks;
                uint32_t oracle_queries;
                r57_make_episode(&episode, development[program], program,
                    corruption, repeat, UINT64_C(0x57de0001));
                if (r57_counterexample_oracle(universe, episode.truth_class,
                        &oracle_checks, &oracle_queries) != 0) {
                    status = 6;
                    goto cleanup;
                }
                evidence_checks += oracle_checks;
                evidence_queries += oracle_queries;
                for (uint32_t arm_index = 0u;
                     arm_index < R57_DEVELOPMENT_ARMS; ++arm_index) {
                    r57_arm arm = (r57_arm)arm_index;
                    r57_selector selector = r57_arm_selector(arm, policy);
                    r57_episode_result episode_result;
                    if (r57_run_episode(policy, channel, universe, &episode,
                            selector, &episode_result) != 0) {
                        status = 7;
                        goto cleanup;
                    }
                    if (episode_result.action_count != R57_QUERY_BUDGET ||
                        episode_result.final_view.observation_count !=
                            R57_INITIAL_READS + R57_QUERY_BUDGET ||
                        episode_result.posterior_updates !=
                            R57_QUERY_BUDGET + 1u ||
                        !episode_result.search.invalid_first_rejected) {
                        status = 8;
                        goto cleanup;
                    }
                    if (arm == R57_ARM_SOURCE_FREE) {
                        source_free = episode_result;
                        have_source_free = 1;
                    } else if (arm == R57_ARM_SOURCE_ABLATION) {
                        if (!have_source_free ||
                            memcmp(&source_free, &episode_result,
                                   sizeof(source_free)) != 0 ||
                            episode_result.source_artifact_reads != 0u) {
                            status = 9;
                            goto cleanup;
                        }
                        result->source_ablation_matches += 1u;
                    }
                    if (arm == R57_ARM_FULL)
                        full_cost += episode_result.search.primary_cost;
                    if (arm == R57_ARM_SOURCE_FREE)
                        comparator_cost += episode_result.search.primary_cost;
                    if (arm == R57_ARM_ORACLE)
                        oracle_cost += episode_result.search.primary_cost;
                    result->trace_rows += 1u;
                    result->exact_rows += episode_result.search.solved &&
                        episode_result.search.certificate_valid;
                    result->invalid_first_rejections +=
                        episode_result.search.invalid_first_rejected;
                    result->policy_fallback_rows +=
                        episode_result.policy_fallbacks > 0u;
                    if (r57_write_trace_row(trace, &trace_digest, universe,
                            channel, policy, &episode, program, corruption,
                            repeat, arm, &episode_result) != 0) {
                        status = 10;
                        goto cleanup;
                    }
                }
            }
        }
    }
    if (fclose(trace) != 0) {
        trace = NULL;
        status = 11;
        goto cleanup;
    }
    trace = NULL;
    result->episodes = R57_DEVELOPMENT_EPISODES;
    result->policy_training_families = policy->training_families;
    result->policy_training_episodes = policy->training_episodes;
    result->policy_logged_states = policy->logged_states;
    result->policy_labelled_actions = policy->labelled_actions;
    result->selector_families = R57_SELECTOR_FAMILIES;
    result->calibration_families = R57_CALIBRATION_FAMILIES;
    result->development_program_families =
        R57_DEVELOPMENT_PROGRAM_FAMILIES;
    result->development_corruption_families =
        R57_DEVELOPMENT_CORRUPTION_FAMILIES;
    result->nested_repeats = R57_NESTED_REPEATS;
    result->selected_comparator = policy->selected_comparator;
    memcpy(result->selector_mean_cost, selector_cost,
           sizeof(result->selector_mean_cost));
    result->full_mean_cost = full_cost / R57_DEVELOPMENT_EPISODES;
    result->comparator_mean_cost = comparator_cost /
                                   R57_DEVELOPMENT_EPISODES;
    result->oracle_mean_cost = oracle_cost / R57_DEVELOPMENT_EPISODES;
    result->oracle_to_comparator_ratio = result->oracle_mean_cost /
                                         result->comparator_mean_cost;
    result->oracle_headroom_passed =
        result->oracle_to_comparator_ratio <= 0.8;
    result->evidence_oracle_mean_verifier_checks = evidence_checks /
                                                   R57_DEVELOPMENT_EPISODES;
    result->evidence_oracle_mean_exact_queries = evidence_queries /
                                                 R57_DEVELOPMENT_EPISODES;
    result->evidence_oracle_mean_total_cost =
        result->evidence_oracle_mean_verifier_checks +
        result->evidence_oracle_mean_exact_queries;
    for (uint32_t budget_index = 0u; budget_index < 4u; ++budget_index) {
        double full_total = 0.0;
        double comparator_total = 0.0;
        for (uint32_t program = 0u;
             program < R57_DEVELOPMENT_PROGRAM_FAMILIES; ++program) {
            for (uint32_t corruption = 0u;
                 corruption < R57_DEVELOPMENT_CORRUPTION_FAMILIES;
                 ++corruption) {
                for (uint32_t repeat = 0u; repeat < R57_NESTED_REPEATS;
                     ++repeat) {
                    r57_episode episode;
                    r57_episode_result full;
                    r57_episode_result comparator;
                    r57_make_episode(&episode, development[program], program,
                        corruption, repeat, UINT64_C(0x57de0001));
                    if (r57_run_episode_budget(policy, channel, universe,
                            &episode, R57_SELECTOR_TRANSFERRED,
                            secondary_budgets[budget_index], &full) != 0 ||
                        r57_run_episode_budget(policy, channel, universe,
                            &episode,
                            (r57_selector)policy->selected_comparator,
                            secondary_budgets[budget_index], &comparator) != 0) {
                        status = 12;
                        goto cleanup;
                    }
                    full_total += full.search.primary_cost;
                    comparator_total += comparator.search.primary_cost;
                }
            }
        }
        result->secondary_full_mean_cost[budget_index] = full_total /
            R57_DEVELOPMENT_EPISODES;
        result->secondary_comparator_mean_cost[budget_index] =
            comparator_total / R57_DEVELOPMENT_EPISODES;
    }
    for (uint32_t family = 0u; family < R57_CALIBRATION_FAMILIES; ++family) {
        for (uint32_t draw = 0u;
             draw < R57_DEVELOPMENT_CORRUPTION_FAMILIES; ++draw) {
            r57_episode episode;
            r57_episode_result calibrated;
            r57_make_episode(&episode, calibration[family], family, draw, 0u,
                             UINT64_C(0x57c10001));
            if (r57_run_episode(policy, channel, universe, &episode,
                    R57_SELECTOR_TRANSFERRED, &calibrated) != 0) {
                status = 13;
                goto cleanup;
            }
            result->calibration_rows += 1u;
            result->calibration_truth_covered +=
                calibrated.candidate_set_contains_truth;
            result->calibration_candidate_set_total +=
                calibrated.candidate_set_size;
        }
    }
    result->risk_mass_q20 = policy->risk_mass_q20;
    result->proxy_audit_passed = 1u;
    result->taint_audit_passed = 1u;
    result->r56_readiness_bound = 1u;
    result->r56_artifact_digest = channel->artifact_digest;
    result->policy_artifact_digest = policy->policy_digest;
    result->trace_digest = trace_digest;
    result->selector_receipt_digest = policy->selector_receipt_digest;
    result->calibration_receipt_digest = policy->calibration_receipt_digest;
    if (result->trace_rows != R57_DEVELOPMENT_EPISODES *
            R57_DEVELOPMENT_ARMS ||
        result->exact_rows != result->trace_rows ||
        result->invalid_first_rejections != result->trace_rows ||
        result->source_ablation_matches != R57_DEVELOPMENT_EPISODES ||
        result->calibration_rows != R57_CALIBRATION_FAMILIES *
            R57_DEVELOPMENT_CORRUPTION_FAMILIES ||
        result->calibration_truth_covered != result->calibration_rows ||
        sealed_count == 0u) {
        status = 14;
        goto cleanup;
    }
cleanup:
    if (trace) fclose(trace);
    free(roundtrip);
    free(policy);
    free(channel);
    free(universe);
    return status;
}

int r57_write_development_result(const char *path,
                                 const r57_development_result *result) {
    FILE *file;
    int status = 0;
    if (!path || !result) return 1;
    file = fopen(path, "wb");
    if (!file) return 2;
    if (fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner57_development_result.v1\",\n"
        "  \"experiment\": \"reasoner57-active-evidence-development-v1\",\n"
        "  \"status\": \"development-only\",\n"
        "  \"scientific_decision\": null,\n"
        "  \"sealed_execution_authorized\": false,\n"
        "  \"r56_channel_readiness_bound\": %s,\n"
        "  \"episodes\": %u,\n"
        "  \"trace_rows\": %u,\n"
        "  \"exact_rows\": %u,\n"
        "  \"invalid_first_rejections\": %u,\n"
        "  \"source_ablation_matches\": %u,\n"
        "  \"policy_training_families\": %u,\n"
        "  \"policy_training_episodes\": %u,\n"
        "  \"policy_logged_states\": %u,\n"
        "  \"policy_labelled_actions\": %u,\n"
        "  \"selector_families\": %u,\n"
        "  \"calibration_families\": %u,\n"
        "  \"development_program_families\": %u,\n"
        "  \"development_corruption_families\": %u,\n"
        "  \"nested_repeats\": %u,\n"
        "  \"selected_comparator\": \"%s\",\n"
        "  \"selector_mean_costs\": {\"fixed_schedule\": %.17g, "
        "\"seeded_random\": %.17g, \"max_disagreement\": %.17g, "
        "\"noisy_gbs\": %.17g, \"ec2\": %.17g, "
        "\"repeat_vote\": %.17g},\n"
        "  \"full_mean_cost\": %.17g,\n"
        "  \"comparator_mean_cost\": %.17g,\n"
        "  \"oracle_mean_cost\": %.17g,\n"
        "  \"oracle_to_comparator_ratio\": %.17g,\n"
        "  \"oracle_headroom_passed\": %s,\n"
        "  \"policy_fallback_rows\": %u,\n"
        "  \"calibration_rows\": %u,\n"
        "  \"calibration_truth_covered\": %u,\n"
        "  \"calibration_candidate_set_mean_size\": %.17g,\n"
        "  \"risk_mass_q20\": %d,\n"
        "  \"secondary_query_curve\": ["
        "{\"budget\":1,\"full_mean_cost\":%.17g,"
        "\"comparator_mean_cost\":%.17g},"
        "{\"budget\":2,\"full_mean_cost\":%.17g,"
        "\"comparator_mean_cost\":%.17g},"
        "{\"budget\":4,\"full_mean_cost\":%.17g,"
        "\"comparator_mean_cost\":%.17g},"
        "{\"budget\":8,\"full_mean_cost\":%.17g,"
        "\"comparator_mean_cost\":%.17g}],\n"
        "  \"evidence_oracle\": {\"mean_verifier_checks\": %.17g, "
        "\"mean_exact_queries\": %.17g, \"mean_total_cost\": %.17g},\n"
        "  \"proxy_audit_passed\": %s,\n"
        "  \"taint_audit_passed\": %s,\n"
        "  \"r56_artifact_digest\": \"%016llx\",\n"
        "  \"policy_artifact_digest\": \"%016llx\",\n"
        "  \"trace_digest\": \"%016llx\",\n"
        "  \"selector_receipt_digest\": \"%016llx\",\n"
        "  \"calibration_receipt_digest\": \"%016llx\"\n"
        "}\n",
        result->r56_readiness_bound ? "true" : "false",
        result->episodes, result->trace_rows, result->exact_rows,
        result->invalid_first_rejections, result->source_ablation_matches,
        result->policy_training_families, result->policy_training_episodes,
        result->policy_logged_states, result->policy_labelled_actions,
        result->selector_families, result->calibration_families,
        result->development_program_families,
        result->development_corruption_families, result->nested_repeats,
        r57_selector_name(result->selected_comparator),
        result->selector_mean_cost[0], result->selector_mean_cost[1],
        result->selector_mean_cost[2], result->selector_mean_cost[3],
        result->selector_mean_cost[4], result->selector_mean_cost[5],
        result->full_mean_cost, result->comparator_mean_cost,
        result->oracle_mean_cost, result->oracle_to_comparator_ratio,
        result->oracle_headroom_passed ? "true" : "false",
        result->policy_fallback_rows, result->calibration_rows,
        result->calibration_truth_covered,
        result->calibration_rows ?
            (double)result->calibration_candidate_set_total /
                result->calibration_rows : 0.0,
        result->risk_mass_q20,
        result->secondary_full_mean_cost[0],
        result->secondary_comparator_mean_cost[0],
        result->secondary_full_mean_cost[1],
        result->secondary_comparator_mean_cost[1],
        result->secondary_full_mean_cost[2],
        result->secondary_comparator_mean_cost[2],
        result->secondary_full_mean_cost[3],
        result->secondary_comparator_mean_cost[3],
        result->evidence_oracle_mean_verifier_checks,
        result->evidence_oracle_mean_exact_queries,
        result->evidence_oracle_mean_total_cost,
        result->proxy_audit_passed ? "true" : "false",
        result->taint_audit_passed ? "true" : "false",
        (unsigned long long)result->r56_artifact_digest,
        (unsigned long long)result->policy_artifact_digest,
        (unsigned long long)result->trace_digest,
        (unsigned long long)result->selector_receipt_digest,
        (unsigned long long)result->calibration_receipt_digest) < 0)
        status = 3;
    if (fclose(file) != 0) status = 4;
    return status;
}

int r57_self_test(const char *r56_artifact_path) {
    r56_universe *universe = NULL;
    r56_artifact *channel = NULL;
    r57_policy_artifact *policy = NULL;
    r57_policy_artifact *decoded = NULL;
    uint16_t training[R57_POLICY_TRAIN_FAMILIES];
    uint16_t selector[R57_SELECTOR_FAMILIES];
    uint16_t calibration[R57_CALIBRATION_FAMILIES];
    uint16_t development[R57_DEVELOPMENT_PROGRAM_FAMILIES];
    uint16_t sealed[R56_SEMANTIC_CLASSES];
    uint32_t sealed_count;
    uint8_t *bytes = NULL;
    size_t size = r57_policy_serialized_size();
    size_t written = 0u;
    int status = 0;
    if (!r56_artifact_path) return 1;
    universe = (r56_universe *)malloc(sizeof(*universe));
    channel = (r56_artifact *)malloc(sizeof(*channel));
    policy = (r57_policy_artifact *)malloc(sizeof(*policy));
    decoded = (r57_policy_artifact *)malloc(sizeof(*decoded));
    bytes = (uint8_t *)malloc(size);
    if (!universe || !channel || !policy || !decoded || !bytes) {
        status = 2;
        goto cleanup;
    }
    if (r56_build_universe(universe) != 0 ||
        r56_read_artifact(r56_artifact_path, channel) != 0 ||
        r57_select_semantic_splits(universe, training, selector, calibration,
            development, sealed, &sealed_count) != 0 || sealed_count != 27u) {
        status = 3;
        goto cleanup;
    }
    {
        uint8_t seen[R56_SEMANTIC_CLASSES] = {0};
        const uint16_t *groups[5] = {
            training, selector, calibration, development, sealed
        };
        const uint32_t counts[5] = {
            R57_POLICY_TRAIN_FAMILIES, R57_SELECTOR_FAMILIES,
            R57_CALIBRATION_FAMILIES, R57_DEVELOPMENT_PROGRAM_FAMILIES,
            sealed_count
        };
        uint32_t total = 0u;
        for (uint32_t group = 0u; group < 5u; ++group)
            for (uint32_t index = 0u; index < counts[group]; ++index) {
                uint16_t semantic = groups[group][index];
                if (semantic >= R56_SEMANTIC_CLASSES || seen[semantic]) {
                    status = 4;
                    goto cleanup;
                }
                seen[semantic] = 1u;
                total += 1u;
            }
        if (total != 111u) {
            status = 5;
            goto cleanup;
        }
    }
    if (r57_build_policy(policy, channel, universe) != 0 ||
        policy->r56_artifact_digest != channel->artifact_digest ||
        policy->training_families != R57_POLICY_TRAIN_FAMILIES ||
        policy->training_episodes != R57_TRAINING_EPISODES ||
        policy->logged_states != R57_TRAINING_EPISODES * R57_QUERY_BUDGET ||
        policy->labelled_actions != policy->logged_states * R57_ACTIONS ||
        policy->risk_mass_q20 != R56_Q20_ONE ||
        policy->policy_digest == 0u) {
        status = 6;
        goto cleanup;
    }
    if (r57_serialize_policy(policy, bytes, size, &written) != 0 ||
        written != size || r57_deserialize_policy(decoded, bytes, size) != 0 ||
        memcmp(policy, decoded, sizeof(*policy)) != 0) {
        status = 7;
        goto cleanup;
    }
    bytes[size / 2u] ^= 1u;
    if (r57_deserialize_policy(decoded, bytes, size) == 0) {
        status = 8;
        goto cleanup;
    }
    bytes[size / 2u] ^= 1u;
    {
        r57_episode episode;
        r56_ranker_view initial;
        r57_policy_view view;
        r57_action_observation empty[R57_MAX_QUERY_BUDGET];
        double probability[R56_SEMANTIC_CLASSES];
        uint32_t channel_reads = 0u;
        memset(empty, 0, sizeof(empty));
        r57_make_episode(&episode, development[0], 0u, 0u, 0u,
                         UINT64_C(0x57de0001));
        if (r57_initial_view(universe, &episode, &initial) != 0 ||
            r57_posterior(channel, universe, &initial, probability,
                          &channel_reads) != 0 ||
            r57_fill_policy_view(&view, &initial, empty, 0u,
                                 R57_QUERY_BUDGET, universe,
                                 probability) != 0 ||
            r57_validate_policy_view(&view) != 0) {
            status = 9;
            goto cleanup;
        }
        view.allowed_actions[0].sensor = R56_SENSORS;
        if (r57_validate_policy_view(&view) == 0) {
            status = 10;
            goto cleanup;
        }
    }
    {
        r57_episode episode;
        r57_episode_result full;
        r57_episode_result source_free;
        r57_episode_result ablation;
        r57_policy_artifact changed;
        r56_artifact wrong_channel;
        uint32_t saved_count;
        r57_make_episode(&episode, development[1], 1u, 1u, 1u,
                         UINT64_C(0x57de0001));
        if (r57_run_episode(policy, channel, universe, &episode,
                R57_SELECTOR_TRANSFERRED, &full) != 0 ||
            r57_run_episode(policy, channel, universe, &episode,
                (r57_selector)policy->selected_comparator,
                &source_free) != 0 ||
            r57_run_episode(policy, channel, universe, &episode,
                (r57_selector)policy->selected_comparator,
                &ablation) != 0 ||
            memcmp(&source_free, &ablation, sizeof(source_free)) != 0 ||
            full.action_count != R57_QUERY_BUDGET ||
            full.posterior_updates != R57_QUERY_BUDGET + 1u ||
            full.source_artifact_reads == 0u ||
            source_free.source_artifact_reads != 0u ||
            !full.search.solved || !full.search.certificate_valid ||
            !full.search.invalid_first_rejected) {
            status = 11;
            goto cleanup;
        }
        changed = *policy;
        changed.score_q20[0] += 1;
        if (r57_run_episode(&changed, channel, universe, &episode,
                (r57_selector)policy->selected_comparator,
                &ablation) != 0 ||
            memcmp(&source_free, &ablation, sizeof(source_free)) != 0) {
            status = 12;
            goto cleanup;
        }
        if (r57_run_episode(&changed, channel, universe, &episode,
                R57_SELECTOR_TRANSFERRED, &ablation) == 0) {
            status = 12;
            goto cleanup;
        }
        wrong_channel = *channel;
        wrong_channel.artifact_digest ^= 1u;
        if (r57_run_episode(policy, &wrong_channel, universe, &episode,
                R57_SELECTOR_TRANSFERRED, &ablation) == 0) {
            status = 13;
            goto cleanup;
        }
        saved_count = universe->semantic_count;
        universe->semantic_count += 1u;
        if (r57_run_episode(policy, channel, universe, &episode,
                R57_SELECTOR_TRANSFERRED, &ablation) == 0) {
            status = 14;
            goto cleanup;
        }
        universe->semantic_count = saved_count;
    }
    {
        r57_episode episode;
        r56_ranker_view initial;
        r56_public_observation first;
        r56_public_observation second;
        r57_action action = {3u, 1u};
        r57_make_episode(&episode, development[2], 2u, 2u, 0u,
                         UINT64_C(0x57de0001));
        if (r57_initial_view(universe, &episode, &initial) != 0 ||
            r57_response(universe, &episode, &initial, action, &first) != 0 ||
            r57_response(universe, &episode, &initial, action, &second) != 0 ||
            memcmp(&first, &second, sizeof(first)) != 0) {
            status = 15;
            goto cleanup;
        }
    }
    for (uint32_t shift = 1u; shift <= R57_DERANGEMENTS; ++shift) {
        uint8_t seen[R57_ACTIONS] = {0};
        for (uint32_t action = 0u; action < R57_ACTIONS; ++action) {
            uint32_t mapped = (action + shift) % R57_ACTIONS;
            if (mapped == action || seen[mapped]) {
                status = 16;
                goto cleanup;
            }
            seen[mapped] = 1u;
        }
    }
    {
        uint32_t checks;
        uint32_t queries;
        if (r57_counterexample_oracle(universe, development[3], &checks,
                &queries) != 0 || checks == 0u || queries >= checks ||
            checks > R56_SEMANTIC_CLASSES || queries > R56_MODULUS) {
            status = 17;
            goto cleanup;
        }
    }
    {
        /*
         * Two equally likely hypotheses and a symmetric 90/10 channel give
         * predictive outcome masses 1/2 and 1/2. The posterior-L2 EC2 gain is
         * (0.9^2 + 0.1^2) - (0.5^2 + 0.5^2) = 0.32. A former
         * disagreement-times-0.8-reliability proxy would report 0.40.
         */
        const double prior[2] = {0.5, 0.5};
        double likelihood[2 * R56_CHANNEL_STATES] = {0.0};
        double noisy_gbs;
        double ec2;
        likelihood[0u * R56_CHANNEL_STATES + 0u] = 0.9;
        likelihood[0u * R56_CHANNEL_STATES + R56_MODULUS] = 0.1;
        likelihood[1u * R56_CHANNEL_STATES + 0u] = 0.1;
        likelihood[1u * R56_CHANNEL_STATES + R56_MODULUS] = 0.9;
        if (r57_expected_objectives(prior, likelihood, 2u, &noisy_gbs,
                &ec2) != 0 || fabs(noisy_gbs - 0.5) > 1e-12 ||
            fabs(ec2 - 0.32) > 1e-12 || fabs(ec2 - 0.40) < 1e-3) {
            status = 18;
            goto cleanup;
        }
    }
    {
        /*
         * The first action has balanced 18-outcome predictions even though
         * both hypotheses share its clean value. The second action has an
         * 80/20 prediction despite splitting the clean values. Multiclass
         * noisy-GBS selects the first (0.5 > 0.2); clean max-mass selects the
         * second (0 < 0.5).
         */
        const double prior[2] = {0.5, 0.5};
        double balanced[2 * R56_CHANNEL_STATES] = {0.0};
        double skewed[2 * R56_CHANNEL_STATES] = {0.0};
        double balanced_gbs;
        double balanced_ec2;
        double skewed_gbs;
        double skewed_ec2;
        const double old_clean_max_mass_balanced = 0.0;
        const double old_clean_max_mass_skewed = 0.5;
        balanced[0u * R56_CHANNEL_STATES + 0u] = 0.9;
        balanced[0u * R56_CHANNEL_STATES + R56_MODULUS] = 0.1;
        balanced[1u * R56_CHANNEL_STATES + 0u] = 0.1;
        balanced[1u * R56_CHANNEL_STATES + R56_MODULUS] = 0.9;
        skewed[0u * R56_CHANNEL_STATES + 0u] = 0.8;
        skewed[0u * R56_CHANNEL_STATES + R56_MODULUS] = 0.2;
        skewed[1u * R56_CHANNEL_STATES + 0u] = 0.8;
        skewed[1u * R56_CHANNEL_STATES + R56_MODULUS] = 0.2;
        if (r57_expected_objectives(prior, balanced, 2u, &balanced_gbs,
                &balanced_ec2) != 0 ||
            r57_expected_objectives(prior, skewed, 2u, &skewed_gbs,
                &skewed_ec2) != 0 ||
            fabs(balanced_gbs - 0.5) > 1e-12 ||
            fabs(skewed_gbs - 0.2) > 1e-12 ||
            !(balanced_gbs > skewed_gbs) ||
            !(old_clean_max_mass_balanced < old_clean_max_mass_skewed) ||
            fabs(skewed_ec2) > 1e-12) {
            status = 19;
            goto cleanup;
        }
    }
    {
        const double prior[2] = {0.5, 0.5};
        double uniform[2 * R56_CHANNEL_STATES];
        double noisy_gbs;
        double ec2;
        for (uint32_t index = 0u; index < 2u * R56_CHANNEL_STATES;
             ++index)
            uniform[index] = 1.0 / (double)R56_CHANNEL_STATES;
        if (r57_expected_objectives(prior, uniform, 2u, &noisy_gbs,
                &ec2) != 0 ||
            fabs(noisy_gbs - 17.0 / 18.0) > 1e-12 ||
            fabs(ec2) > 1e-12) {
            status = 20;
            goto cleanup;
        }
        uniform[0] += 0.01;
        if (r57_expected_objectives(prior, uniform, 2u, &noisy_gbs,
                &ec2) == 0) {
            status = 21;
            goto cleanup;
        }
    }
    {
        r57_development_result blocked_result;
        if (r57_run_development(&blocked_result, "/tmp/r57-blocked-trace",
                "/tmp/r57-blocked-policy", r56_artifact_path) !=
                R57_PREREQUISITE_PENDING) {
            status = 22;
            goto cleanup;
        }
    }
cleanup:
    free(bytes);
    free(decoded);
    free(policy);
    free(channel);
    free(universe);
    return status;
}
