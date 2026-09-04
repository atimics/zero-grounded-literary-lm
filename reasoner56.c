#include "reasoner56.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R56_ARTIFACT_VERSION 1u
#define R56_SOURCE_PROGRAM_COUNT 256u
#define R56_DEVELOPMENT_EPISODES 6u
#define R56_DEVELOPMENT_ARMS 5u
#define R56_DEVELOPMENT_OBSERVATIONS 18u
#define R56_PROPOSAL_BUDGET 24u
#define R56_GLOBAL_CAP R56_SEMANTIC_CLASSES

static const uint8_t r56_artifact_magic[8] = {
    'R', '5', '6', 'A', 'R', 'T', '1', 0
};

static const int32_t r56_temperature_q20[R56_TEMPERATURES] = {
    R56_Q20_ONE / 4, R56_Q20_ONE / 2, R56_Q20_ONE,
    R56_Q20_ONE * 2, R56_Q20_ONE * 4, R56_Q20_ONE * 8
};

static uint8_t r56_mod(int32_t value) {
    int32_t reduced = value % (int32_t)R56_MODULUS;
    if (reduced < 0) reduced += (int32_t)R56_MODULUS;
    return (uint8_t)reduced;
}

static uint8_t r56_apply_primitive(uint8_t token, uint8_t x) {
    if (token == 0u) return r56_mod((int32_t)x + 1);
    if (token == 1u) return r56_mod(2 * (int32_t)x);
    if (token == 2u) return r56_mod(-(int32_t)x);
    if (token == 3u) return r56_mod((int32_t)x * x);
    if (token == 4u) return r56_mod((int32_t)x * x * x);
    if (token == 5u) return r56_mod((int32_t)x + 5);
    if (token == 6u) return r56_mod((int32_t)x * x + x);
    return r56_mod((int32_t)x * x * x + 1);
}

static void r56_program_table(const uint8_t token[R56_PROGRAM_DEPTH],
                              uint8_t table[R56_MODULUS]) {
    uint8_t x;
    for (x = 0u; x < R56_MODULUS; ++x) {
        uint8_t value = x;
        uint32_t position;
        for (position = 0u; position < R56_PROGRAM_DEPTH; ++position)
            value = r56_apply_primitive(token[position], value);
        table[x] = value;
    }
}

static uint64_t r56_hash_update(uint64_t hash, const void *data, size_t size) {
    const uint8_t *bytes = (const uint8_t *)data;
    size_t index;
    for (index = 0u; index < size; ++index) {
        hash ^= bytes[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static uint64_t r56_hash(const void *data, size_t size, uint64_t domain) {
    return r56_hash_update(UINT64_C(1469598103934665603) ^ domain,
                           data, size);
}

static uint64_t r56_mix64(uint64_t value) {
    value += UINT64_C(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30u)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27u)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31u);
}

static uint64_t r56_event_key(uint64_t seed, uint64_t a, uint64_t b,
                              uint64_t c, uint64_t d, uint64_t e) {
    uint64_t value = seed;
    value = r56_mix64(value ^ r56_mix64(a + UINT64_C(0x100000001b3)));
    value = r56_mix64(value ^ r56_mix64(b + UINT64_C(0x9e3779b9)));
    value = r56_mix64(value ^ r56_mix64(c + UINT64_C(0x85ebca6b)));
    value = r56_mix64(value ^ r56_mix64(d + UINT64_C(0xc2b2ae35)));
    return r56_mix64(value ^ r56_mix64(e + UINT64_C(0x27d4eb2f)));
}

static size_t r56_local_exact_context(uint8_t sensor, uint8_t input,
                                      uint8_t value) {
    return ((size_t)sensor * R56_MODULUS + input) * R56_MODULUS + value;
}

static size_t r56_local_value_context(uint8_t sensor, uint8_t value) {
    return (size_t)sensor * R56_MODULUS + value;
}

static size_t r56_transition_exact_context(uint8_t previous_sensor,
                                           uint8_t current_sensor,
                                           uint8_t previous_state) {
    return (((size_t)previous_sensor * R56_SENSORS + current_sensor) *
            R56_CHANNEL_STATES) + previous_state;
}

static size_t r56_transition_current_context(uint8_t current_sensor,
                                             uint8_t previous_state) {
    return (size_t)current_sensor * R56_CHANNEL_STATES + previous_state;
}

int r56_build_universe(r56_universe *universe) {
    uint8_t a;
    uint8_t b;
    uint8_t c;
    if (!universe) return 1;
    memset(universe, 0, sizeof(*universe));
    for (a = 0u; a < R56_PRIMITIVES; ++a)
        for (b = 0u; b < R56_PRIMITIVES; ++b)
            for (c = 0u; c < R56_PRIMITIVES; ++c) {
                uint32_t syntax_index = universe->syntax_count++;
                r56_syntax_program *program = &universe->syntax[syntax_index];
                uint32_t semantic_index;
                program->token[0] = a;
                program->token[1] = b;
                program->token[2] = c;
                r56_program_table(program->token, program->table);
                for (semantic_index = 0u;
                     semantic_index < universe->semantic_count;
                     ++semantic_index)
                    if (memcmp(universe->semantic[semantic_index].table,
                               program->table, R56_MODULUS) == 0)
                        break;
                if (semantic_index == universe->semantic_count) {
                    r56_semantic_class *semantic;
                    if (semantic_index >= R56_SEMANTIC_CLASSES) return 2;
                    semantic = &universe->semantic[semantic_index];
                    memcpy(semantic->representative, program->token,
                           R56_PROGRAM_DEPTH);
                    memcpy(semantic->table, program->table, R56_MODULUS);
                    semantic->multiplicity = 0u;
                    universe->semantic_count += 1u;
                }
                universe->semantic[semantic_index].multiplicity += 1u;
                universe->syntax_to_semantic[syntax_index] =
                    (uint16_t)semantic_index;
            }
    if (universe->syntax_count != R56_SYNTAX_PROGRAMS ||
        universe->semantic_count != R56_SEMANTIC_CLASSES)
        return 3;
    return 0;
}

void r56_generate_source_program(uint64_t seed, uint32_t index,
                                 uint8_t token[R56_PROGRAM_DEPTH]) {
    uint32_t position;
    for (position = 0u; position < R56_PROGRAM_DEPTH; ++position) {
        uint64_t value = r56_event_key(seed, index, position, 56u, 0u, 0u);
        token[position] = (uint8_t)(value % R56_PRIMITIVES);
    }
}

void r56_generate_corruption_family(uint64_t seed, uint32_t index,
                                    r56_corruption_family *family) {
    uint64_t value;
    if (!family) return;
    value = r56_event_key(seed, index, 0u, 0u, 0u, 0u);
    family->template_id = (uint8_t)(index % 8u);
    family->severity = (uint8_t)(1u + (value % 4u));
    family->direction = (uint8_t)(1u + ((value >> 8u) % 16u));
    family->location = (uint8_t)((value >> 16u) % R56_MAX_OBSERVATIONS);
    family->block_length = (uint8_t)(1u + ((value >> 24u) % 6u));
}

static uint8_t r56_channel_state(const r56_corruption_family *family,
                                 uint64_t seed, uint8_t sensor,
                                 uint8_t input, uint8_t clean,
                                 uint8_t previous_state, uint32_t position) {
    uint64_t random = r56_event_key(seed, sensor, input, clean,
                                    previous_state, position);
    uint32_t draw = (uint32_t)(random % 100u);
    uint32_t rate = 4u + 5u * family->severity + 2u * sensor;
    uint8_t delta = 0u;
    switch (family->template_id) {
        case 0u:
            if (draw < rate)
                delta = (uint8_t)(1u + ((random >> 9u) % 16u));
            break;
        case 1u:
            if (draw < rate)
                delta = r56_mod((int32_t)family->direction *
                                (1 + (int32_t)(clean % 3u)));
            break;
        case 2u:
            if (draw < rate + (input % 4u) * 3u)
                delta = r56_mod((int32_t)family->direction + input + sensor);
            break;
        case 3u:
            if (previous_state < R56_MODULUS && previous_state != 0u &&
                draw < 65u)
                delta = previous_state;
            else if (draw < rate)
                delta = (uint8_t)(1u + ((random >> 13u) % 16u));
            break;
        case 4u:
            if (draw < rate) return R56_MODULUS;
            break;
        case 5u:
            if (draw < rate + (input % 3u) * 4u) return R56_MODULUS;
            break;
        case 6u:
            if (draw < rate + (clean % 4u) * 3u) return R56_MODULUS;
            break;
        default: {
            uint32_t distance = (position + R56_MAX_OBSERVATIONS -
                                 family->location) % R56_MAX_OBSERVATIONS;
            if (distance < family->block_length ||
                (previous_state == R56_MODULUS && draw < 60u))
                return R56_MODULUS;
            break;
        }
    }
    return delta;
}

int32_t r56_log_probability_q20(uint32_t count, uint32_t total,
                                uint32_t outcomes) {
    double probability;
    double scaled;
    if (outcomes == 0u || total > UINT32_MAX - outcomes) return INT32_MIN;
    probability = ((double)count + 1.0) /
                  ((double)total + (double)outcomes);
    scaled = log(probability) * (double)R56_Q20_ONE;
    if (scaled <= (double)INT32_MIN) return INT32_MIN;
    if (scaled >= (double)INT32_MAX) return INT32_MAX;
    return (int32_t)llround(scaled);
}

static void r56_finish_log_table(const uint32_t *count,
                                 const uint32_t *support,
                                 uint32_t contexts, int32_t *score) {
    uint32_t context;
    for (context = 0u; context < contexts; ++context) {
        uint32_t state;
        for (state = 0u; state < R56_CHANNEL_STATES; ++state) {
            size_t index = (size_t)context * R56_CHANNEL_STATES + state;
            score[index] = r56_log_probability_q20(count[index],
                                                    support[context],
                                                    R56_CHANNEL_STATES);
        }
    }
}

static void r56_finish_artifact_scores(r56_artifact *artifact) {
    uint32_t semantic;
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        artifact->class_log_q20[semantic] = r56_log_probability_q20(
            artifact->class_prior[semantic], artifact->source_programs,
            R56_SEMANTIC_CLASSES);
    r56_finish_log_table(artifact->local_exact_count,
                         artifact->local_exact_support,
                         R56_LOCAL_EXACT_CONTEXTS,
                         artifact->local_exact_log_q20);
    r56_finish_log_table(artifact->local_value_count,
                         artifact->local_value_support,
                         R56_LOCAL_VALUE_CONTEXTS,
                         artifact->local_value_log_q20);
    r56_finish_log_table(artifact->local_sensor_count,
                         artifact->local_sensor_support,
                         R56_LOCAL_SENSOR_CONTEXTS,
                         artifact->local_sensor_log_q20);
    r56_finish_log_table(artifact->local_global_count,
                         &artifact->local_global_support, 1u,
                         artifact->local_global_log_q20);
    r56_finish_log_table(artifact->initial_count, artifact->initial_support,
                         R56_SENSORS, artifact->initial_log_q20);
    r56_finish_log_table(artifact->transition_exact_count,
                         artifact->transition_exact_support,
                         R56_TRANSITION_EXACT_CONTEXTS,
                         artifact->transition_exact_log_q20);
    r56_finish_log_table(artifact->transition_current_count,
                         artifact->transition_current_support,
                         R56_TRANSITION_CURRENT_CONTEXTS,
                         artifact->transition_current_log_q20);
    r56_finish_log_table(artifact->transition_previous_count,
                         artifact->transition_previous_support,
                         R56_TRANSITION_PREVIOUS_CONTEXTS,
                         artifact->transition_previous_log_q20);
    r56_finish_log_table(artifact->transition_global_count,
                         &artifact->transition_global_support, 1u,
                         artifact->transition_global_log_q20);
}

static void r56_add_local(r56_artifact *artifact, uint8_t sensor,
                          uint8_t input, uint8_t clean, uint8_t state) {
    size_t exact = r56_local_exact_context(sensor, input, clean);
    size_t value = r56_local_value_context(sensor, clean);
    artifact->local_exact_support[exact] += 1u;
    artifact->local_exact_count[exact * R56_CHANNEL_STATES + state] += 1u;
    artifact->local_value_support[value] += 1u;
    artifact->local_value_count[value * R56_CHANNEL_STATES + state] += 1u;
    artifact->local_sensor_support[sensor] += 1u;
    artifact->local_sensor_count[(size_t)sensor * R56_CHANNEL_STATES + state]
        += 1u;
    artifact->local_global_support += 1u;
    artifact->local_global_count[state] += 1u;
}

static void r56_add_transition(r56_artifact *artifact,
                               uint8_t previous_sensor,
                               uint8_t current_sensor,
                               uint8_t previous_state,
                               uint8_t current_state) {
    size_t exact = r56_transition_exact_context(previous_sensor,
                                                current_sensor,
                                                previous_state);
    size_t current = r56_transition_current_context(current_sensor,
                                                    previous_state);
    artifact->transition_exact_support[exact] += 1u;
    artifact->transition_exact_count[exact * R56_CHANNEL_STATES +
                                     current_state] += 1u;
    artifact->transition_current_support[current] += 1u;
    artifact->transition_current_count[current * R56_CHANNEL_STATES +
                                       current_state] += 1u;
    artifact->transition_previous_support[previous_state] += 1u;
    artifact->transition_previous_count[(size_t)previous_state *
        R56_CHANNEL_STATES + current_state] += 1u;
    artifact->transition_global_support += 1u;
    artifact->transition_global_count[current_state] += 1u;
}

static int r56_refresh_artifact_digest(r56_artifact *artifact);

int r56_build_artifact(r56_artifact *artifact, const r56_universe *universe,
                       uint64_t source_seed, uint64_t corruption_seed) {
    uint32_t index;
    uint64_t program_digest = UINT64_C(1469598103934665603) ^ 5601u;
    uint64_t corruption_digest = UINT64_C(1469598103934665603) ^ 5602u;
    if (!artifact || !universe ||
        universe->semantic_count != R56_SEMANTIC_CLASSES)
        return 1;
    memset(artifact, 0, sizeof(*artifact));
    artifact->version = R56_ARTIFACT_VERSION;
    artifact->source_seed = source_seed;
    artifact->corruption_seed = corruption_seed;
    artifact->source_programs = R56_SOURCE_PROGRAM_COUNT;
    artifact->temperature_index = 2u;
    artifact->temperature_q20 = r56_temperature_q20[2];
    artifact->conformal_mass_q20 = (int32_t)llround(0.99 * R56_Q20_ONE);

    for (index = 0u; index < R56_SOURCE_PROGRAM_COUNT; ++index) {
        uint8_t token[R56_PROGRAM_DEPTH];
        uint8_t table[R56_MODULUS];
        uint8_t order[R56_MAX_OBSERVATIONS];
        r56_corruption_family family;
        uint8_t previous_state = 0u;
        uint8_t previous_sensor = 0u;
        uint32_t syntax_index;
        r56_generate_source_program(source_seed, index, token);
        syntax_index = ((uint32_t)token[0] * R56_PRIMITIVES + token[1]) *
                       R56_PRIMITIVES + token[2];
        artifact->class_prior[universe->syntax_to_semantic[syntax_index]] += 1u;
        r56_program_table(token, table);
        program_digest = r56_hash_update(program_digest, token, sizeof(token));
        program_digest = r56_hash_update(program_digest, table, sizeof(table));
        r56_generate_corruption_family(corruption_seed, index, &family);
        corruption_digest = r56_hash_update(corruption_digest, &family,
                                            sizeof(family));
        for (uint32_t cell = 0u; cell < R56_MAX_OBSERVATIONS; ++cell)
            order[cell] = (uint8_t)cell;
        for (uint32_t cell = R56_MAX_OBSERVATIONS - 1u; cell > 0u; --cell) {
            uint32_t selected = (uint32_t)(r56_event_key(source_seed, index,
                cell, 5607u, 0u, 0u) % (cell + 1u));
            uint8_t temporary = order[cell];
            order[cell] = order[selected];
            order[selected] = temporary;
        }
        for (uint32_t position = 0u; position < R56_MAX_OBSERVATIONS;
             ++position) {
            uint8_t cell = order[position];
            uint8_t sensor = (uint8_t)(cell / R56_MODULUS);
            uint8_t input = (uint8_t)(cell % R56_MODULUS);
            uint8_t clean = table[input];
            uint8_t state = r56_channel_state(&family, corruption_seed,
                sensor, input, clean, previous_state, position);
            r56_add_local(artifact, sensor, input, clean, state);
            if (position == 0u) {
                artifact->initial_support[sensor] += 1u;
                artifact->initial_count[(size_t)sensor *
                    R56_CHANNEL_STATES + state] += 1u;
            } else {
                r56_add_transition(artifact, previous_sensor, sensor,
                                   previous_state, state);
            }
            previous_sensor = sensor;
            previous_state = state;
            artifact->source_samples += 1u;
        }
    }

    for (uint8_t sensor = 0u; sensor < R56_SENSORS; ++sensor)
        for (uint8_t input = 0u; input < R56_MODULUS; ++input)
            for (uint8_t clean = 0u; clean < R56_MODULUS; ++clean)
                for (uint32_t repeat = 0u;
                     artifact->local_exact_support[
                         r56_local_exact_context(sensor, input, clean)] <
                         R56_SUPPORT_MIN; ++repeat) {
                    r56_corruption_family family;
                    uint32_t family_index = (((uint32_t)sensor * R56_MODULUS +
                        input) * R56_MODULUS + clean) * R56_SUPPORT_MIN + repeat;
                    uint8_t state;
                    r56_generate_corruption_family(corruption_seed,
                                                   family_index, &family);
                    state = r56_channel_state(&family, corruption_seed, sensor,
                                              input, clean, 0u, repeat);
                    r56_add_local(artifact, sensor, input, clean, state);
                    corruption_digest = r56_hash_update(corruption_digest,
                                                        &family,
                                                        sizeof(family));
                    artifact->source_samples += 1u;
                }

    for (uint8_t sensor = 0u; sensor < R56_SENSORS; ++sensor)
        for (uint32_t repeat = 0u;
             artifact->initial_support[sensor] < R56_SUPPORT_MIN; ++repeat) {
            r56_corruption_family family;
            uint8_t state;
            r56_generate_corruption_family(corruption_seed ^ UINT64_C(0x56aa),
                                           repeat + sensor * 1000u, &family);
            state = r56_channel_state(&family, corruption_seed, sensor,
                                      (uint8_t)(repeat % R56_MODULUS),
                                      (uint8_t)((repeat * 7u) % R56_MODULUS),
                                      0u, 0u);
            artifact->initial_support[sensor] += 1u;
            artifact->initial_count[(size_t)sensor * R56_CHANNEL_STATES + state]
                += 1u;
            artifact->source_samples += 1u;
        }

    for (uint8_t previous_sensor = 0u;
         previous_sensor < R56_SENSORS; ++previous_sensor)
        for (uint8_t current_sensor = 0u;
             current_sensor < R56_SENSORS; ++current_sensor)
            for (uint8_t previous_state = 0u;
                 previous_state < R56_CHANNEL_STATES; ++previous_state)
                for (uint32_t repeat = 0u;
                     artifact->transition_exact_support[
                         r56_transition_exact_context(previous_sensor,
                             current_sensor, previous_state)] <
                         R56_SUPPORT_MIN; ++repeat) {
                    r56_corruption_family family;
                    uint32_t family_index = ((((uint32_t)previous_sensor *
                        R56_SENSORS + current_sensor) * R56_CHANNEL_STATES +
                        previous_state) * R56_SUPPORT_MIN) + repeat;
                    uint8_t state;
                    r56_generate_corruption_family(
                        corruption_seed ^ UINT64_C(0x56bb), family_index,
                        &family);
                    state = r56_channel_state(&family, corruption_seed,
                        current_sensor, (uint8_t)(repeat % R56_MODULUS),
                        (uint8_t)((repeat * 5u) % R56_MODULUS),
                        previous_state, repeat + 1u);
                    r56_add_transition(artifact, previous_sensor,
                                       current_sensor, previous_state, state);
                    artifact->source_samples += 1u;
                }

    artifact->source_program_digest = program_digest;
    artifact->corruption_generator_digest = corruption_digest;
    r56_finish_artifact_scores(artifact);
    return r56_refresh_artifact_digest(artifact);
}

r56_local_backoff r56_local_backoff_level(const r56_artifact *artifact,
                                           uint8_t sensor, uint8_t input,
                                           uint8_t candidate_value) {
    size_t exact;
    size_t value;
    if (!artifact || sensor >= R56_SENSORS || input >= R56_MODULUS ||
        candidate_value >= R56_MODULUS)
        return R56_BACKOFF_GLOBAL;
    exact = r56_local_exact_context(sensor, input, candidate_value);
    value = r56_local_value_context(sensor, candidate_value);
    if (artifact->local_exact_support[exact] >= R56_SUPPORT_MIN)
        return R56_BACKOFF_EXACT;
    if (artifact->local_value_support[value] >= R56_SUPPORT_MIN)
        return R56_BACKOFF_VALUE;
    if (artifact->local_sensor_support[sensor] >= R56_SUPPORT_MIN)
        return R56_BACKOFF_SENSOR;
    return R56_BACKOFF_GLOBAL;
}

r56_transition_backoff r56_transition_backoff_level(
    const r56_artifact *artifact, uint8_t previous_sensor,
    uint8_t current_sensor, uint8_t previous_state) {
    size_t exact;
    size_t current;
    if (!artifact || previous_sensor >= R56_SENSORS ||
        current_sensor >= R56_SENSORS || previous_state >= R56_CHANNEL_STATES)
        return R56_TRANSITION_GLOBAL;
    exact = r56_transition_exact_context(previous_sensor, current_sensor,
                                         previous_state);
    current = r56_transition_current_context(current_sensor, previous_state);
    if (artifact->transition_exact_support[exact] >= R56_SUPPORT_MIN)
        return R56_TRANSITION_EXACT;
    if (artifact->transition_current_support[current] >= R56_SUPPORT_MIN)
        return R56_TRANSITION_CURRENT;
    if (artifact->transition_previous_support[previous_state] >= R56_SUPPORT_MIN)
        return R56_TRANSITION_PREVIOUS;
    return R56_TRANSITION_GLOBAL;
}

static int32_t r56_local_score(const r56_artifact *artifact, uint8_t sensor,
                               uint8_t input, uint8_t value, uint8_t state,
                               uint32_t *reads) {
    r56_local_backoff level = r56_local_backoff_level(artifact, sensor, input,
                                                      value);
    *reads += 1u;
    if (level == R56_BACKOFF_EXACT) {
        size_t context = r56_local_exact_context(sensor, input, value);
        return artifact->local_exact_log_q20[
            context * R56_CHANNEL_STATES + state];
    }
    if (level == R56_BACKOFF_VALUE) {
        size_t context = r56_local_value_context(sensor, value);
        return artifact->local_value_log_q20[
            context * R56_CHANNEL_STATES + state];
    }
    if (level == R56_BACKOFF_SENSOR)
        return artifact->local_sensor_log_q20[
            (size_t)sensor * R56_CHANNEL_STATES + state];
    return artifact->local_global_log_q20[state];
}

static int32_t r56_transition_score(const r56_artifact *artifact,
                                    uint8_t previous_sensor,
                                    uint8_t current_sensor,
                                    uint8_t previous_state,
                                    uint8_t current_state,
                                    uint32_t *reads) {
    r56_transition_backoff level = r56_transition_backoff_level(
        artifact, previous_sensor, current_sensor, previous_state);
    *reads += 1u;
    if (level == R56_TRANSITION_EXACT) {
        size_t context = r56_transition_exact_context(previous_sensor,
            current_sensor, previous_state);
        return artifact->transition_exact_log_q20[
            context * R56_CHANNEL_STATES + current_state];
    }
    if (level == R56_TRANSITION_CURRENT) {
        size_t context = r56_transition_current_context(current_sensor,
                                                        previous_state);
        return artifact->transition_current_log_q20[
            context * R56_CHANNEL_STATES + current_state];
    }
    if (level == R56_TRANSITION_PREVIOUS)
        return artifact->transition_previous_log_q20[
            (size_t)previous_state * R56_CHANNEL_STATES + current_state];
    return artifact->transition_global_log_q20[current_state];
}

static int r56_validate_view(const r56_ranker_view *view) {
    uint32_t index;
    if (!view || view->observation_count == 0u ||
        view->observation_count > R56_MAX_OBSERVATIONS)
        return 1;
    for (index = 0u; index < view->observation_count; ++index) {
        const r56_public_observation *observation = &view->observations[index];
        if (observation->input >= R56_MODULUS ||
            observation->sensor >= R56_SENSORS ||
            observation->observed >= R56_MODULUS ||
            observation->missing > 1u ||
            (observation->missing && observation->observed != 0u))
            return 2;
    }
    return 0;
}

static int r56_validate_observation_node(const r56_public_node *node) {
    uint32_t seen = 0u;
    uint32_t observed = 0u;
    uint32_t missing = 0u;
    uint32_t index;
    if (!node || !node->name || strcmp(node->name, "observation") != 0 ||
        node->type != R56_NODE_OBJECT || node->child_count != 4u ||
        !node->children)
        return 1;
    for (index = 0u; index < node->child_count; ++index) {
        const r56_public_node *leaf = &node->children[index];
        uint32_t bit;
        uint32_t limit;
        r56_public_node_type type;
        if (!leaf->name || leaf->child_count != 0u) return 2;
        if (strcmp(leaf->name, "input") == 0) {
            bit = 1u; limit = R56_MODULUS; type = R56_NODE_U8;
        } else if (strcmp(leaf->name, "sensor") == 0) {
            bit = 2u; limit = R56_SENSORS; type = R56_NODE_U8;
        } else if (strcmp(leaf->name, "observed") == 0) {
            bit = 4u; limit = R56_MODULUS; type = R56_NODE_U8;
        } else if (strcmp(leaf->name, "missing") == 0) {
            bit = 8u; limit = 2u; type = R56_NODE_BOOL;
        } else {
            return 3;
        }
        if ((seen & bit) != 0u || leaf->type != type || leaf->value >= limit)
            return 4;
        if (bit == 4u) observed = leaf->value;
        if (bit == 8u) missing = leaf->value;
        seen |= bit;
    }
    if (seen != 15u) return 5;
    return missing && observed != 0u ? 6 : 0;
}

int r56_validate_ranker_tree(const r56_public_node *root) {
    const r56_public_node *observations;
    uint32_t index;
    if (!root || !root->name || strcmp(root->name, "ranker_view") != 0 ||
        root->type != R56_NODE_OBJECT || root->child_count != 1u ||
        !root->children)
        return 1;
    observations = &root->children[0];
    if (!observations->name || strcmp(observations->name, "observations") != 0 ||
        observations->type != R56_NODE_ARRAY ||
        observations->child_count == 0u ||
        observations->child_count > R56_MAX_OBSERVATIONS ||
        !observations->children)
        return 2;
    for (index = 0u; index < observations->child_count; ++index)
        if (r56_validate_observation_node(&observations->children[index]) != 0)
            return 3;
    return 0;
}

static uint8_t r56_observation_state(const r56_public_observation *observation,
                                     uint8_t candidate_value) {
    if (observation->missing) return R56_MODULUS;
    return r56_mod((int32_t)observation->observed - candidate_value);
}

int r56_posterior(const r56_artifact *artifact, const r56_universe *universe,
                  const r56_ranker_view *view, r56_arm arm,
                  double probability[R56_SEMANTIC_CLASSES],
                  int64_t score_q20[R56_SEMANTIC_CLASSES],
                  uint32_t *source_artifact_reads) {
    uint32_t semantic;
    int64_t maximum = INT64_MIN;
    double normalizer = 0.0;
    uint32_t reads = 0u;
    int source_free = arm == R56_ARM_SOURCE_FREE ||
                      arm == R56_ARM_SOURCE_ABLATION ||
                      arm == R56_ARM_ONE_TRIM;
    if (!artifact || !universe || !probability || !score_q20 ||
        !source_artifact_reads || r56_validate_view(view) != 0 ||
        universe->semantic_count != R56_SEMANTIC_CLASSES ||
        artifact->version != R56_ARTIFACT_VERSION ||
        arm < R56_ARM_FULL || arm > R56_ARM_CHANNEL_ONLY)
        return 1;
    if (artifact->temperature_q20 <= 0) return 2;
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        const uint8_t *table = universe->semantic[semantic].table;
        int64_t score = 0;
        if (source_free) {
            uint32_t mismatch = 0u;
            for (uint32_t observation = 0u;
                 observation < view->observation_count; ++observation) {
                const r56_public_observation *item =
                    &view->observations[observation];
                if (!item->missing && table[item->input] != item->observed)
                    mismatch += 1u;
            }
            if (arm == R56_ARM_ONE_TRIM && mismatch > 0u) mismatch -= 1u;
            score = -(int64_t)mismatch * R56_Q20_ONE;
        } else {
            uint8_t previous_state = 0u;
            uint8_t previous_sensor = 0u;
            if (arm != R56_ARM_CHANNEL_ONLY) {
                score += artifact->class_log_q20[semantic];
                reads += 1u;
            }
            if (arm != R56_ARM_PROGRAM_PRIOR_ONLY) {
                for (uint32_t observation = 0u;
                     observation < view->observation_count; ++observation) {
                    const r56_public_observation *item =
                        &view->observations[observation];
                    uint8_t state = r56_observation_state(item,
                                                          table[item->input]);
                    score += r56_local_score(artifact, item->sensor,
                        item->input, table[item->input], state, &reads);
                    if (observation == 0u) {
                        score += artifact->initial_log_q20[
                            (size_t)item->sensor * R56_CHANNEL_STATES + state];
                        reads += 1u;
                    } else if (arm != R56_ARM_MARKOV_OFF) {
                        score += r56_transition_score(artifact,
                            previous_sensor, item->sensor, previous_state,
                            state, &reads);
                    }
                    previous_state = state;
                    previous_sensor = item->sensor;
                }
            }
        }
        score_q20[semantic] = source_free ? score :
            (score * R56_Q20_ONE) / artifact->temperature_q20;
        if (score_q20[semantic] > maximum) maximum = score_q20[semantic];
    }
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        double weight = exp((double)(score_q20[semantic] - maximum) /
                            (double)R56_Q20_ONE);
        probability[semantic] = weight;
        normalizer += weight;
    }
    if (!(normalizer > 0.0) || !isfinite(normalizer)) return 3;
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        probability[semantic] /= normalizer;
    *source_artifact_reads = source_free ? 0u : reads;
    return 0;
}

static void r56_probability_order(
    const double probability[R56_SEMANTIC_CLASSES],
    uint16_t order[R56_SEMANTIC_CLASSES]) {
    uint32_t index;
    for (index = 0u; index < R56_SEMANTIC_CLASSES; ++index) {
        uint32_t position = index;
        order[index] = (uint16_t)index;
        while (position > 0u) {
            uint16_t left = order[position - 1u];
            uint16_t right = order[position];
            if (probability[left] > probability[right] ||
                (probability[left] == probability[right] && left < right))
                break;
            order[position - 1u] = right;
            order[position] = left;
            position -= 1u;
        }
    }
}

uint32_t r56_candidate_set(const double probability[R56_SEMANTIC_CLASSES],
                           double cumulative_threshold,
                           uint8_t included[R56_SEMANTIC_CLASSES]) {
    uint16_t order[R56_SEMANTIC_CLASSES];
    uint32_t count = 0u;
    double cumulative = 0.0;
    double boundary = -1.0;
    if (!probability || !included || cumulative_threshold <= 0.0 ||
        cumulative_threshold > 1.0)
        return 0u;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES;
         ++semantic) {
        if (!isfinite(probability[semantic]) || probability[semantic] < 0.0)
            return 0u;
        cumulative += probability[semantic];
    }
    if (fabs(cumulative - 1.0) > 1e-9) return 0u;
    cumulative = 0.0;
    memset(included, 0, R56_SEMANTIC_CLASSES);
    r56_probability_order(probability, order);
    for (uint32_t rank = 0u; rank < R56_SEMANTIC_CLASSES; ++rank) {
        uint16_t semantic = order[rank];
        if (boundary >= 0.0 && probability[semantic] < boundary) break;
        included[semantic] = 1u;
        count += 1u;
        cumulative += probability[semantic];
        if (boundary < 0.0 && cumulative >= cumulative_threshold)
            boundary = probability[semantic];
    }
    return count;
}

static double r56_truth_cumulative(
    const double probability[R56_SEMANTIC_CLASSES], uint16_t truth) {
    double total = 0.0;
    double threshold = probability[truth];
    uint32_t semantic;
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        if (probability[semantic] + 1e-18 >= threshold)
            total += probability[semantic];
    return total > 1.0 ? 1.0 : total;
}

static uint64_t r56_calibration_digest(const r56_ranker_view *views,
                                       const uint16_t *truth,
                                       uint32_t count, uint64_t domain) {
    uint64_t digest = UINT64_C(1469598103934665603) ^ domain;
    for (uint32_t episode = 0u; episode < count; ++episode) {
        uint8_t count_bytes[4] = {
            (uint8_t)views[episode].observation_count,
            (uint8_t)(views[episode].observation_count >> 8u),
            (uint8_t)(views[episode].observation_count >> 16u),
            (uint8_t)(views[episode].observation_count >> 24u)
        };
        uint8_t truth_bytes[2] = {
            (uint8_t)truth[episode], (uint8_t)(truth[episode] >> 8u)
        };
        digest = r56_hash_update(digest, count_bytes, sizeof(count_bytes));
        digest = r56_hash_update(digest, views[episode].observations,
            (size_t)views[episode].observation_count *
            sizeof(views[episode].observations[0]));
        digest = r56_hash_update(digest, truth_bytes, sizeof(truth_bytes));
    }
    return digest;
}

int r56_calibrate(r56_artifact *artifact, const r56_universe *universe,
                  const r56_ranker_view *fit_views,
                  const uint16_t *fit_truth, uint32_t fit_count,
                  const r56_ranker_view *coverage_views,
                  const uint16_t *coverage_truth, uint32_t coverage_count) {
    uint32_t temperature;
    uint32_t best = 0u;
    double best_loss = HUGE_VAL;
    double *mass;
    if (!artifact || !universe || !fit_views || !fit_truth ||
        !coverage_views || !coverage_truth || fit_count == 0u ||
        coverage_count == 0u)
        return 1;
    for (temperature = 0u; temperature < R56_TEMPERATURES; ++temperature) {
        double loss = 0.0;
        artifact->temperature_q20 = r56_temperature_q20[temperature];
        for (uint32_t episode = 0u; episode < fit_count; ++episode) {
            double probability[R56_SEMANTIC_CLASSES];
            int64_t score[R56_SEMANTIC_CLASSES];
            uint32_t reads;
            if (fit_truth[episode] >= R56_SEMANTIC_CLASSES ||
                r56_posterior(artifact, universe, &fit_views[episode],
                              R56_ARM_FULL, probability, score, &reads) != 0)
                return 2;
            loss -= log(probability[fit_truth[episode]] > 1e-300 ?
                        probability[fit_truth[episode]] : 1e-300);
        }
        if (loss < best_loss) {
            best_loss = loss;
            best = temperature;
        }
    }
    artifact->temperature_index = best;
    artifact->temperature_q20 = r56_temperature_q20[best];
    mass = (double *)malloc((size_t)coverage_count * sizeof(*mass));
    if (!mass) return 3;
    for (uint32_t episode = 0u; episode < coverage_count; ++episode) {
        double probability[R56_SEMANTIC_CLASSES];
        int64_t score[R56_SEMANTIC_CLASSES];
        uint32_t reads;
        if (coverage_truth[episode] >= R56_SEMANTIC_CLASSES ||
            r56_posterior(artifact, universe, &coverage_views[episode],
                          R56_ARM_FULL,
                          probability, score, &reads) != 0) {
            free(mass);
            return 4;
        }
        mass[episode] = r56_truth_cumulative(probability,
                                             coverage_truth[episode]);
    }
    for (uint32_t index = 1u; index < coverage_count; ++index) {
        double value = mass[index];
        uint32_t position = index;
        while (position > 0u && mass[position - 1u] > value) {
            mass[position] = mass[position - 1u];
            position -= 1u;
        }
        mass[position] = value;
    }
    {
        uint32_t quantile = (uint32_t)ceil(
            0.99 * (double)(coverage_count + 1u));
        double selected;
        if (quantile == 0u) quantile = 1u;
        if (quantile > coverage_count) quantile = coverage_count;
        selected = mass[quantile - 1u];
        artifact->conformal_mass_q20 = (int32_t)ceil(selected * R56_Q20_ONE);
        if (artifact->conformal_mass_q20 > R56_Q20_ONE)
            artifact->conformal_mass_q20 = R56_Q20_ONE;
        if (artifact->conformal_mass_q20 < 1)
            artifact->conformal_mass_q20 = 1;
    }
    artifact->calibration_fit_episodes = fit_count;
    artifact->calibration_coverage_episodes = coverage_count;
    artifact->calibration_fit_digest = r56_calibration_digest(
        fit_views, fit_truth, fit_count, 5608u);
    artifact->calibration_coverage_digest = r56_calibration_digest(
        coverage_views, coverage_truth, coverage_count, 5609u);
    free(mass);
    return r56_refresh_artifact_digest(artifact);
}

int r56_verify_semantic_class(const r56_universe *universe,
                              uint16_t semantic_class,
                              const uint8_t target[R56_MODULUS],
                              r56_certificate *certificate) {
    uint8_t rebuilt[R56_MODULUS];
    int accepted;
    if (!universe || !target || !certificate ||
        semantic_class >= universe->semantic_count)
        return 0;
    memset(certificate, 0, sizeof(*certificate));
    r56_program_table(universe->semantic[semantic_class].representative,
                      rebuilt);
    certificate->checked_points = R56_MODULUS;
    certificate->semantic_class = semantic_class;
    certificate->table_digest = r56_hash(rebuilt, sizeof(rebuilt), 5603u);
    certificate->valid = memcmp(rebuilt,
        universe->semantic[semantic_class].table, R56_MODULUS) == 0;
    accepted = certificate->valid &&
        memcmp(rebuilt, target, R56_MODULUS) == 0;
    return accepted;
}

int r56_verified_search(const r56_universe *universe,
                        const uint8_t target[R56_MODULUS],
                        const uint16_t *proposals, uint32_t proposal_count,
                        uint32_t global_cap, uint16_t injected_invalid,
                        r56_search_result *result) {
    uint8_t seen[R56_SEMANTIC_CLASSES];
    if (!universe || !target || !proposals || proposal_count == 0u ||
        !result || global_cap == 0u || global_cap == UINT32_MAX ||
        injected_invalid >= universe->semantic_count ||
        proposals[0] != injected_invalid)
        return 1;
    memset(result, 0, sizeof(*result));
    memset(seen, 0, sizeof(seen));
    result->accepted_class = UINT32_MAX;
    for (uint32_t phase = 0u; phase < 2u && !result->solved; ++phase) {
        uint32_t count = phase == 0u ? proposal_count : universe->semantic_count;
        if (phase == 1u) result->fallback_started = 1u;
        for (uint32_t index = 0u; index < count; ++index) {
            uint16_t semantic = phase == 0u ? proposals[index] : (uint16_t)index;
            r56_certificate certificate;
            int accepted;
            if (semantic >= universe->semantic_count) return 2;
            result->partial_expansions += 1u;
            if (phase == 1u) result->fallback_partial_expansions += 1u;
            if (seen[semantic]) continue;
            if (result->verifier_checks >= global_cap) {
                result->global_cap_hit = 1u;
                break;
            }
            seen[semantic] = 1u;
            accepted = r56_verify_semantic_class(universe, semantic, target,
                                                 &certificate);
            result->verifier_checks += 1u;
            if (phase == 0u) result->proposal_verifier_checks += 1u;
            else result->fallback_verifier_checks += 1u;
            if (result->verifier_checks == 1u)
                result->invalid_first_rejected = !accepted;
            if (accepted && certificate.valid) {
                result->solved = 1u;
                result->accepted_class = semantic;
                result->certificate_valid = 1u;
                break;
            }
        }
        if (result->global_cap_hit) break;
    }
    if (!result->solved && result->verifier_checks >= global_cap)
        result->global_cap_hit = 1u;
    result->primary_cost = result->global_cap_hit ? global_cap + 1u :
                           result->verifier_checks;
    return 0;
}

static size_t r56_serialized_words(void) {
    size_t words = 9u + 7u;
    words += R56_SEMANTIC_CLASSES * 2u;
    words += R56_LOCAL_EXACT_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += R56_LOCAL_VALUE_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += R56_LOCAL_SENSOR_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += 1u + 2u * R56_CHANNEL_STATES;
    words += R56_SENSORS * (1u + 2u * R56_CHANNEL_STATES);
    words += R56_TRANSITION_EXACT_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += R56_TRANSITION_CURRENT_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += R56_TRANSITION_PREVIOUS_CONTEXTS *
             (1u + 2u * R56_CHANNEL_STATES);
    words += 1u + 2u * R56_CHANNEL_STATES;
    return words;
}

size_t r56_artifact_serialized_size(void) {
    return sizeof(r56_artifact_magic) + 6u * sizeof(uint64_t) +
           r56_serialized_words() * sizeof(uint32_t) + sizeof(uint64_t);
}

static void r56_put_u32(uint8_t *bytes, size_t *cursor, uint32_t value) {
    bytes[(*cursor)++] = (uint8_t)value;
    bytes[(*cursor)++] = (uint8_t)(value >> 8u);
    bytes[(*cursor)++] = (uint8_t)(value >> 16u);
    bytes[(*cursor)++] = (uint8_t)(value >> 24u);
}

static void r56_put_u64(uint8_t *bytes, size_t *cursor, uint64_t value) {
    uint32_t index;
    for (index = 0u; index < 8u; ++index)
        bytes[(*cursor)++] = (uint8_t)(value >> (8u * index));
}

static uint32_t r56_get_u32(const uint8_t *bytes, size_t *cursor) {
    uint32_t value = (uint32_t)bytes[*cursor] |
        ((uint32_t)bytes[*cursor + 1u] << 8u) |
        ((uint32_t)bytes[*cursor + 2u] << 16u) |
        ((uint32_t)bytes[*cursor + 3u] << 24u);
    *cursor += 4u;
    return value;
}

static uint64_t r56_get_u64(const uint8_t *bytes, size_t *cursor) {
    uint64_t value = 0u;
    uint32_t index;
    for (index = 0u; index < 8u; ++index)
        value |= (uint64_t)bytes[(*cursor)++] << (8u * index);
    return value;
}

#define R56_WRITE_U32_ARRAY(field, count) do { \
    size_t r56_i_; \
    for (r56_i_ = 0u; r56_i_ < (count); ++r56_i_) \
        r56_put_u32(bytes, &cursor, artifact->field[r56_i_]); \
} while (0)

#define R56_WRITE_I32_ARRAY(field, count) do { \
    size_t r56_i_; \
    for (r56_i_ = 0u; r56_i_ < (count); ++r56_i_) \
        r56_put_u32(bytes, &cursor, (uint32_t)artifact->field[r56_i_]); \
} while (0)

int r56_serialize_artifact(const r56_artifact *artifact, uint8_t *bytes,
                           size_t capacity, size_t *written) {
    size_t cursor = 0u;
    uint64_t digest;
    size_t required = r56_artifact_serialized_size();
    if (!artifact || !bytes || !written || capacity < required ||
        artifact->version != R56_ARTIFACT_VERSION)
        return 1;
    memcpy(bytes, r56_artifact_magic, sizeof(r56_artifact_magic));
    cursor += sizeof(r56_artifact_magic);
    r56_put_u32(bytes, &cursor, artifact->version);
    r56_put_u32(bytes, &cursor, R56_MODULUS);
    r56_put_u32(bytes, &cursor, R56_PRIMITIVES);
    r56_put_u32(bytes, &cursor, R56_PROGRAM_DEPTH);
    r56_put_u32(bytes, &cursor, R56_SYNTAX_PROGRAMS);
    r56_put_u32(bytes, &cursor, R56_SEMANTIC_CLASSES);
    r56_put_u32(bytes, &cursor, R56_SENSORS);
    r56_put_u32(bytes, &cursor, R56_CHANNEL_STATES);
    r56_put_u32(bytes, &cursor, R56_SUPPORT_MIN);
    r56_put_u64(bytes, &cursor, artifact->source_seed);
    r56_put_u64(bytes, &cursor, artifact->corruption_seed);
    r56_put_u64(bytes, &cursor, artifact->source_program_digest);
    r56_put_u64(bytes, &cursor, artifact->corruption_generator_digest);
    r56_put_u64(bytes, &cursor, artifact->calibration_fit_digest);
    r56_put_u64(bytes, &cursor, artifact->calibration_coverage_digest);
    r56_put_u32(bytes, &cursor, artifact->source_programs);
    r56_put_u32(bytes, &cursor, artifact->source_samples);
    r56_put_u32(bytes, &cursor, artifact->calibration_fit_episodes);
    r56_put_u32(bytes, &cursor, artifact->calibration_coverage_episodes);
    r56_put_u32(bytes, &cursor, artifact->temperature_index);
    r56_put_u32(bytes, &cursor, (uint32_t)artifact->temperature_q20);
    r56_put_u32(bytes, &cursor, (uint32_t)artifact->conformal_mass_q20);
    R56_WRITE_U32_ARRAY(class_prior, R56_SEMANTIC_CLASSES);
    R56_WRITE_I32_ARRAY(class_log_q20, R56_SEMANTIC_CLASSES);
    R56_WRITE_U32_ARRAY(local_exact_support, R56_LOCAL_EXACT_CONTEXTS);
    R56_WRITE_U32_ARRAY(local_exact_count,
        R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(local_exact_log_q20,
        R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(local_value_support, R56_LOCAL_VALUE_CONTEXTS);
    R56_WRITE_U32_ARRAY(local_value_count,
        R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(local_value_log_q20,
        R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(local_sensor_support, R56_LOCAL_SENSOR_CONTEXTS);
    R56_WRITE_U32_ARRAY(local_sensor_count,
        R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(local_sensor_log_q20,
        R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES);
    r56_put_u32(bytes, &cursor, artifact->local_global_support);
    R56_WRITE_U32_ARRAY(local_global_count, R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(local_global_log_q20, R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(initial_support, R56_SENSORS);
    R56_WRITE_U32_ARRAY(initial_count, R56_SENSORS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(initial_log_q20, R56_SENSORS * R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(transition_exact_support,
                        R56_TRANSITION_EXACT_CONTEXTS);
    R56_WRITE_U32_ARRAY(transition_exact_count,
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(transition_exact_log_q20,
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(transition_current_support,
                        R56_TRANSITION_CURRENT_CONTEXTS);
    R56_WRITE_U32_ARRAY(transition_current_count,
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(transition_current_log_q20,
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_U32_ARRAY(transition_previous_support,
                        R56_TRANSITION_PREVIOUS_CONTEXTS);
    R56_WRITE_U32_ARRAY(transition_previous_count,
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(transition_previous_log_q20,
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES);
    r56_put_u32(bytes, &cursor, artifact->transition_global_support);
    R56_WRITE_U32_ARRAY(transition_global_count, R56_CHANNEL_STATES);
    R56_WRITE_I32_ARRAY(transition_global_log_q20, R56_CHANNEL_STATES);
    if (cursor + sizeof(uint64_t) != required) return 2;
    digest = r56_hash(bytes, cursor, 5604u);
    if (artifact->artifact_digest != 0u &&
        artifact->artifact_digest != digest)
        return 3;
    r56_put_u64(bytes, &cursor, digest);
    *written = cursor;
    return 0;
}

#define R56_READ_U32_ARRAY(field, count) do { \
    size_t r56_i_; \
    for (r56_i_ = 0u; r56_i_ < (count); ++r56_i_) \
        artifact->field[r56_i_] = r56_get_u32(bytes, &cursor); \
} while (0)

#define R56_READ_I32_ARRAY(field, count) do { \
    size_t r56_i_; \
    for (r56_i_ = 0u; r56_i_ < (count); ++r56_i_) { \
        uint32_t r56_bits_ = r56_get_u32(bytes, &cursor); \
        memcpy(&artifact->field[r56_i_], &r56_bits_, sizeof(r56_bits_)); \
    } \
} while (0)

int r56_deserialize_artifact(r56_artifact *artifact, const uint8_t *bytes,
                             size_t size) {
    size_t cursor = 0u;
    uint64_t expected;
    uint64_t actual;
    uint32_t constants[8];
    if (!artifact || !bytes || size != r56_artifact_serialized_size() ||
        memcmp(bytes, r56_artifact_magic, sizeof(r56_artifact_magic)) != 0)
        return 1;
    expected = r56_hash(bytes, size - sizeof(uint64_t), 5604u);
    cursor = size - sizeof(uint64_t);
    actual = r56_get_u64(bytes, &cursor);
    if (actual != expected) return 2;
    memset(artifact, 0, sizeof(*artifact));
    cursor = sizeof(r56_artifact_magic);
    artifact->version = r56_get_u32(bytes, &cursor);
    for (uint32_t index = 0u; index < 8u; ++index)
        constants[index] = r56_get_u32(bytes, &cursor);
    if (artifact->version != R56_ARTIFACT_VERSION ||
        constants[0] != R56_MODULUS || constants[1] != R56_PRIMITIVES ||
        constants[2] != R56_PROGRAM_DEPTH ||
        constants[3] != R56_SYNTAX_PROGRAMS ||
        constants[4] != R56_SEMANTIC_CLASSES ||
        constants[5] != R56_SENSORS ||
        constants[6] != R56_CHANNEL_STATES ||
        constants[7] != R56_SUPPORT_MIN)
        return 3;
    artifact->source_seed = r56_get_u64(bytes, &cursor);
    artifact->corruption_seed = r56_get_u64(bytes, &cursor);
    artifact->source_program_digest = r56_get_u64(bytes, &cursor);
    artifact->corruption_generator_digest = r56_get_u64(bytes, &cursor);
    artifact->calibration_fit_digest = r56_get_u64(bytes, &cursor);
    artifact->calibration_coverage_digest = r56_get_u64(bytes, &cursor);
    artifact->source_programs = r56_get_u32(bytes, &cursor);
    artifact->source_samples = r56_get_u32(bytes, &cursor);
    artifact->calibration_fit_episodes = r56_get_u32(bytes, &cursor);
    artifact->calibration_coverage_episodes = r56_get_u32(bytes, &cursor);
    artifact->temperature_index = r56_get_u32(bytes, &cursor);
    {
        uint32_t bits = r56_get_u32(bytes, &cursor);
        memcpy(&artifact->temperature_q20, &bits, sizeof(bits));
        bits = r56_get_u32(bytes, &cursor);
        memcpy(&artifact->conformal_mass_q20, &bits, sizeof(bits));
    }
    R56_READ_U32_ARRAY(class_prior, R56_SEMANTIC_CLASSES);
    R56_READ_I32_ARRAY(class_log_q20, R56_SEMANTIC_CLASSES);
    R56_READ_U32_ARRAY(local_exact_support, R56_LOCAL_EXACT_CONTEXTS);
    R56_READ_U32_ARRAY(local_exact_count,
        R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(local_exact_log_q20,
        R56_LOCAL_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(local_value_support, R56_LOCAL_VALUE_CONTEXTS);
    R56_READ_U32_ARRAY(local_value_count,
        R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(local_value_log_q20,
        R56_LOCAL_VALUE_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(local_sensor_support, R56_LOCAL_SENSOR_CONTEXTS);
    R56_READ_U32_ARRAY(local_sensor_count,
        R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(local_sensor_log_q20,
        R56_LOCAL_SENSOR_CONTEXTS * R56_CHANNEL_STATES);
    artifact->local_global_support = r56_get_u32(bytes, &cursor);
    R56_READ_U32_ARRAY(local_global_count, R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(local_global_log_q20, R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(initial_support, R56_SENSORS);
    R56_READ_U32_ARRAY(initial_count, R56_SENSORS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(initial_log_q20, R56_SENSORS * R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(transition_exact_support,
                       R56_TRANSITION_EXACT_CONTEXTS);
    R56_READ_U32_ARRAY(transition_exact_count,
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(transition_exact_log_q20,
        R56_TRANSITION_EXACT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(transition_current_support,
                       R56_TRANSITION_CURRENT_CONTEXTS);
    R56_READ_U32_ARRAY(transition_current_count,
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(transition_current_log_q20,
        R56_TRANSITION_CURRENT_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_U32_ARRAY(transition_previous_support,
                       R56_TRANSITION_PREVIOUS_CONTEXTS);
    R56_READ_U32_ARRAY(transition_previous_count,
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(transition_previous_log_q20,
        R56_TRANSITION_PREVIOUS_CONTEXTS * R56_CHANNEL_STATES);
    artifact->transition_global_support = r56_get_u32(bytes, &cursor);
    R56_READ_U32_ARRAY(transition_global_count, R56_CHANNEL_STATES);
    R56_READ_I32_ARRAY(transition_global_log_q20, R56_CHANNEL_STATES);
    if (cursor != size - sizeof(uint64_t) || artifact->temperature_q20 <= 0 ||
        artifact->temperature_index >= R56_TEMPERATURES ||
        !((artifact->calibration_fit_episodes == 0u &&
           artifact->calibration_coverage_episodes == 0u &&
           artifact->calibration_fit_digest == 0u &&
           artifact->calibration_coverage_digest == 0u) ||
          (artifact->calibration_fit_episodes > 0u &&
           artifact->calibration_coverage_episodes > 0u &&
           artifact->calibration_fit_digest != 0u &&
           artifact->calibration_coverage_digest != 0u)) ||
        artifact->conformal_mass_q20 <= 0 ||
        artifact->conformal_mass_q20 > R56_Q20_ONE)
        return 4;
    artifact->artifact_digest = actual;
    return 0;
}

static int r56_refresh_artifact_digest(r56_artifact *artifact) {
    size_t size = r56_artifact_serialized_size();
    size_t written = 0u;
    size_t cursor;
    uint8_t *bytes = (uint8_t *)malloc(size);
    if (!bytes) return 1;
    artifact->artifact_digest = 0u;
    if (r56_serialize_artifact(artifact, bytes, size, &written) != 0 ||
        written != size) {
        free(bytes);
        return 2;
    }
    cursor = size - sizeof(uint64_t);
    artifact->artifact_digest = r56_get_u64(bytes, &cursor);
    free(bytes);
    return 0;
}

int r56_write_artifact(const char *path, const r56_artifact *artifact) {
    size_t size;
    size_t written = 0u;
    uint8_t *bytes;
    FILE *file;
    int ok;
    if (!path || !artifact) return 1;
    size = r56_artifact_serialized_size();
    bytes = (uint8_t *)malloc(size);
    if (!bytes) return 2;
    if (r56_serialize_artifact(artifact, bytes, size, &written) != 0) {
        free(bytes);
        return 3;
    }
    file = fopen(path, "wb");
    if (!file) {
        free(bytes);
        return 4;
    }
    ok = fwrite(bytes, 1u, written, file) == written;
    if (fclose(file) != 0) ok = 0;
    free(bytes);
    return ok ? 0 : 5;
}

int r56_read_artifact(const char *path, r56_artifact *artifact) {
    size_t size;
    uint8_t *bytes;
    FILE *file;
    int status;
    if (!path || !artifact) return 1;
    size = r56_artifact_serialized_size();
    bytes = (uint8_t *)malloc(size);
    if (!bytes) return 2;
    file = fopen(path, "rb");
    if (!file) {
        free(bytes);
        return 3;
    }
    if (fread(bytes, 1u, size, file) != size || fgetc(file) != EOF) {
        fclose(file);
        free(bytes);
        return 4;
    }
    if (fclose(file) != 0) {
        free(bytes);
        return 5;
    }
    status = r56_deserialize_artifact(artifact, bytes, size);
    free(bytes);
    return status == 0 ? 0 : 6;
}

static void r56_generate_view(uint64_t target_seed,
                              uint64_t corruption_seed,
                              uint64_t order_seed, uint32_t episode_index,
                              uint32_t program_family,
                              uint32_t corruption_index,
                              const r56_universe *universe,
                              r56_ranker_view *view, uint16_t *truth) {
    uint8_t order[R56_MAX_OBSERVATIONS];
    r56_corruption_family family;
    uint8_t previous_state = 0u;
    uint64_t target_key = r56_event_key(target_seed, program_family,
                                        56u, 1u, 0u, 0u);
    *truth = (uint16_t)(target_key % R56_SEMANTIC_CLASSES);
    r56_generate_corruption_family(corruption_seed, corruption_index,
                                   &family);
    for (uint32_t index = 0u; index < R56_MAX_OBSERVATIONS; ++index)
        order[index] = (uint8_t)index;
    for (uint32_t index = R56_MAX_OBSERVATIONS - 1u; index > 0u; --index) {
        uint32_t selected = (uint32_t)(r56_event_key(order_seed,
            episode_index, index, 2u, 0u, 0u) % (index + 1u));
        uint8_t temporary = order[index];
        order[index] = order[selected];
        order[selected] = temporary;
    }
    memset(view, 0, sizeof(*view));
    view->observation_count = R56_DEVELOPMENT_OBSERVATIONS;
    for (uint32_t position = 0u;
         position < view->observation_count; ++position) {
        uint8_t cell = order[position];
        uint8_t sensor = (uint8_t)(cell / R56_MODULUS);
        uint8_t input = (uint8_t)(cell % R56_MODULUS);
        uint8_t clean = universe->semantic[*truth].table[input];
        uint8_t state = r56_channel_state(&family,
            corruption_seed ^ r56_mix64(episode_index), sensor, input, clean,
            previous_state, position);
        r56_public_observation *observation = &view->observations[position];
        observation->input = input;
        observation->sensor = sensor;
        observation->missing = state == R56_MODULUS;
        observation->observed = observation->missing ? 0u :
            r56_mod((int32_t)clean + state);
        previous_state = state;
    }
}

static double r56_probability_sum(const double *probability) {
    double total = 0.0;
    for (uint32_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index)
        total += probability[index];
    return total;
}

static uint64_t r56_universe_digest(const r56_universe *universe) {
    uint64_t digest = UINT64_C(1469598103934665603) ^ 5605u;
    for (uint32_t index = 0u; index < universe->semantic_count; ++index) {
        digest = r56_hash_update(digest, universe->semantic[index].table,
                                 R56_MODULUS);
        uint8_t multiplicity[2] = {
            (uint8_t)universe->semantic[index].multiplicity,
            (uint8_t)(universe->semantic[index].multiplicity >> 8u)
        };
        digest = r56_hash_update(digest, multiplicity, sizeof(multiplicity));
    }
    return digest;
}

static uint64_t r56_public_view_digest(const r56_ranker_view *view) {
    uint64_t digest = UINT64_C(1469598103934665603) ^ 5610u;
    uint8_t count[4] = {
        (uint8_t)view->observation_count,
        (uint8_t)(view->observation_count >> 8u),
        (uint8_t)(view->observation_count >> 16u),
        (uint8_t)(view->observation_count >> 24u)
    };
    digest = r56_hash_update(digest, count, sizeof(count));
    for (uint32_t index = 0u; index < view->observation_count; ++index) {
        uint8_t leaves[4] = {
            view->observations[index].input,
            view->observations[index].sensor,
            view->observations[index].observed,
            view->observations[index].missing
        };
        digest = r56_hash_update(digest, leaves, sizeof(leaves));
    }
    return digest;
}

static uint64_t r56_verifier_digest(const r56_universe *universe) {
    static const char algorithm[] =
        "r56-exhaustive-representative-evaluation-gf17-v1";
    uint64_t digest = r56_hash(algorithm, sizeof(algorithm) - 1u, 5611u);
    for (uint32_t index = 0u; index < universe->semantic_count; ++index) {
        digest = r56_hash_update(digest,
            universe->semantic[index].representative, R56_PROGRAM_DEPTH);
        digest = r56_hash_update(digest, universe->semantic[index].table,
                                 R56_MODULUS);
    }
    return digest;
}

static const char *r56_arm_name(r56_arm arm) {
    switch (arm) {
        case R56_ARM_FULL: return "full";
        case R56_ARM_SOURCE_FREE: return "source_free";
        case R56_ARM_SOURCE_ABLATION: return "source_ablation";
        case R56_ARM_ONE_TRIM: return "one_trim";
        case R56_ARM_MARKOV_OFF: return "markov_off";
        case R56_ARM_PROGRAM_PRIOR_ONLY: return "program_prior_only";
        default: return "channel_only";
    }
}

static int r56_make_public_tree(const r56_ranker_view *view,
                                r56_public_node *root,
                                r56_public_node *array,
                                r56_public_node *observations,
                                r56_public_node *leaves) {
    if (!view || !root || !array || !observations || !leaves ||
        view->observation_count > R56_MAX_OBSERVATIONS)
        return 1;
    for (uint32_t index = 0u; index < view->observation_count; ++index) {
        r56_public_node *node = &observations[index];
        r56_public_node *child = &leaves[index * 4u];
        child[0] = (r56_public_node){"input", R56_NODE_U8, 0u, NULL,
                                    view->observations[index].input};
        child[1] = (r56_public_node){"sensor", R56_NODE_U8, 0u, NULL,
                                    view->observations[index].sensor};
        child[2] = (r56_public_node){"observed", R56_NODE_U8, 0u, NULL,
                                    view->observations[index].observed};
        child[3] = (r56_public_node){"missing", R56_NODE_BOOL, 0u, NULL,
                                    view->observations[index].missing};
        *node = (r56_public_node){"observation", R56_NODE_OBJECT, 4u,
                                  child, 0u};
    }
    *array = (r56_public_node){"observations", R56_NODE_ARRAY,
        view->observation_count, observations, 0u};
    *root = (r56_public_node){"ranker_view", R56_NODE_OBJECT, 1u,
                              array, 0u};
    return 0;
}

int r56_run_development(r56_development_result *result,
                        const char *trace_path, const char *artifact_path) {
    static const r56_arm arms[R56_DEVELOPMENT_ARMS] = {
        R56_ARM_FULL, R56_ARM_SOURCE_FREE, R56_ARM_SOURCE_ABLATION,
        R56_ARM_ONE_TRIM, R56_ARM_MARKOV_OFF
    };
    r56_universe *universe;
    r56_artifact *artifact;
    r56_artifact *roundtrip;
    r56_ranker_view calibration_fit[8];
    r56_ranker_view calibration_coverage[8];
    uint16_t calibration_fit_truth[8];
    uint16_t calibration_coverage_truth[8];
    FILE *trace;
    uint64_t trace_digest = UINT64_C(1469598103934665603) ^ 5606u;
    if (!result || !trace_path || !artifact_path) return 1;
    memset(result, 0, sizeof(*result));
    universe = (r56_universe *)malloc(sizeof(*universe));
    artifact = (r56_artifact *)malloc(sizeof(*artifact));
    roundtrip = (r56_artifact *)malloc(sizeof(*roundtrip));
    if (!universe || !artifact || !roundtrip) {
        free(universe); free(artifact); free(roundtrip);
        return 2;
    }
    if (r56_build_universe(universe) != 0 ||
        r56_build_artifact(artifact, universe, UINT64_C(0x56010001),
                           UINT64_C(0x56020002)) != 0) {
        free(universe); free(artifact); free(roundtrip);
        return 3;
    }
    for (uint32_t index = 0u; index < 8u; ++index) {
        r56_generate_view(UINT64_C(0x56ca1100), UINT64_C(0x56ca1200),
                          UINT64_C(0x56ca1300), index, index, index,
                          universe, &calibration_fit[index],
                          &calibration_fit_truth[index]);
        r56_generate_view(UINT64_C(0x56cb1100), UINT64_C(0x56cb1200),
                          UINT64_C(0x56cb1300), index, index + 8u,
                          index + 8u, universe, &calibration_coverage[index],
                          &calibration_coverage_truth[index]);
    }
    if (r56_calibrate(artifact, universe,
                      calibration_fit, calibration_fit_truth, 8u,
                      calibration_coverage, calibration_coverage_truth,
                      8u) != 0 ||
        r56_write_artifact(artifact_path, artifact) != 0 ||
        r56_read_artifact(artifact_path, roundtrip) != 0) {
        free(universe); free(artifact); free(roundtrip);
        return 4;
    }
    result->artifact_roundtrip_valid =
        roundtrip->artifact_digest == artifact->artifact_digest;
    trace = fopen(trace_path, "wb");
    if (!trace) {
        free(universe); free(artifact); free(roundtrip);
        return 5;
    }
    for (uint32_t episode = 0u; episode < R56_DEVELOPMENT_EPISODES; ++episode) {
        r56_ranker_view view;
        uint16_t truth;
        double source_free_probability[R56_SEMANTIC_CLASSES];
        int64_t source_free_score[R56_SEMANTIC_CLASSES];
        r56_search_result source_free_search;
        uint32_t source_free_reads = 1u;
        r56_generate_view(UINT64_C(0x56de0001), UINT64_C(0x56de0002),
                          UINT64_C(0x56de0003), episode, episode / 2u,
                          episode % 2u, universe, &view, &truth);
        {
            r56_public_node root;
            r56_public_node array;
            r56_public_node observations[R56_MAX_OBSERVATIONS];
            r56_public_node leaves[R56_MAX_OBSERVATIONS * 4u];
            if (r56_make_public_tree(&view, &root, &array, observations,
                                     leaves) != 0 ||
                r56_validate_ranker_tree(&root) != 0) {
                fclose(trace); free(universe); free(artifact); free(roundtrip);
                return 6;
            }
        }
        for (uint32_t arm_index = 0u; arm_index < R56_DEVELOPMENT_ARMS;
             ++arm_index) {
            r56_arm arm = arms[arm_index];
            double probability[R56_SEMANTIC_CLASSES];
            int64_t score[R56_SEMANTIC_CLASSES];
            uint16_t order[R56_SEMANTIC_CLASSES];
            uint16_t proposals[R56_PROPOSAL_BUDGET];
            uint16_t injected;
            r56_search_result search;
            uint32_t reads;
            double sum;
            uint8_t candidate_set[R56_SEMANTIC_CLASSES];
            char line[2048];
            int length;
            if (r56_posterior(artifact, universe, &view, arm, probability,
                              score, &reads) != 0) {
                fclose(trace); free(universe); free(artifact); free(roundtrip);
                return 6;
            }
            sum = r56_probability_sum(probability);
            if (fabs(sum - 1.0) <= 1e-12) result->normalized_rows += 1u;
            if (arm == R56_ARM_FULL) {
                double threshold = (double)artifact->conformal_mass_q20 /
                                   (double)R56_Q20_ONE;
                if (r56_candidate_set(probability, threshold,
                                      candidate_set) == 0u) {
                    fclose(trace); free(universe); free(artifact);
                    free(roundtrip); return 7;
                }
                result->candidate_set_rows += 1u;
                result->candidate_set_truth_covered += candidate_set[truth] != 0u;
            }
            r56_probability_order(probability, order);
            injected = order[0] == truth ? order[1] : order[0];
            proposals[0] = injected;
            {
                uint32_t cursor = 1u;
                for (uint32_t rank = 0u; rank < R56_SEMANTIC_CLASSES &&
                     cursor < R56_PROPOSAL_BUDGET; ++rank)
                    if (order[rank] != injected)
                        proposals[cursor++] = order[rank];
            }
            if (r56_verified_search(universe, universe->semantic[truth].table,
                proposals, episode == 0u ? 1u : R56_PROPOSAL_BUDGET,
                R56_GLOBAL_CAP, injected,
                &search) != 0) {
                fclose(trace); free(universe); free(artifact); free(roundtrip);
                return 7;
            }
            result->trace_rows += 1u;
            result->exact_rows += search.solved && search.certificate_valid;
            result->fallback_rows += search.fallback_started;
            result->invalid_first_rejections += search.invalid_first_rejected;
            if (arm == R56_ARM_SOURCE_FREE) {
                memcpy(source_free_probability, probability,
                       sizeof(source_free_probability));
                memcpy(source_free_score, score, sizeof(source_free_score));
                source_free_search = search;
                source_free_reads = reads;
            } else if (arm == R56_ARM_SOURCE_ABLATION &&
                source_free_reads == 0u && reads == 0u &&
                memcmp(source_free_probability, probability,
                       sizeof(source_free_probability)) == 0 &&
                memcmp(source_free_score, score, sizeof(source_free_score)) == 0 &&
                memcmp(&source_free_search, &search, sizeof(search)) == 0) {
                result->source_ablation_matches += 1u;
            }
            length = snprintf(line, sizeof(line),
                "{\"schema\":\"zero.reasoner56_development_trace.v1\","
                "\"experiment\":\"reasoner56-passive-noise-development-v1\","
                "\"lane\":\"development\",\"generator_id\":\"r56-gf17-v1\","
                "\"family_id\":\"program-%u\","
                "\"cross_family_id\":\"corruption-%u\","
                "\"program_family_id\":\"program-%u\","
                "\"corruption_family_id\":\"corruption-%u\","
                "\"nested_repeat_id\":\"repeat-0\",\"episode_id\":\"dev-%u\","
                "\"shift_stratum\":\"primary-id-development\",\"arm\":\"%s\","
                "\"exact\":%s,\"certificate_valid\":%s,"
                "\"premature_commit\":false,\"primary_cost\":%u,"
                "\"verifier_checks\":%u,"
                "\"proposal_verifier_checks\":%u,"
                "\"partial_expansions\":%u,"
                "\"fallback_verifier_checks\":%u,"
                "\"fallback_partial_expansions\":%u,"
                "\"observation_queries\":%u,\"fallback_started\":%s,"
                "\"global_cap_hit\":%s,\"injected_invalid_rejected\":%s,"
                "\"source_artifact_reads\":%u,"
                "\"probability_sum\":%.17g,"
                "\"candidate_universe_count\":%u,"
                "\"candidate_universe_digest\":\"%016llx\","
                "\"initial_evidence_digest\":\"%016llx\","
                "\"verifier_digest\":\"%016llx\","
                "\"artifact_digest\":\"%016llx\"}\n",
                episode / 2u, episode % 2u,
                episode / 2u, episode % 2u, episode, r56_arm_name(arm),
                search.solved ? "true" : "false",
                search.certificate_valid ? "true" : "false",
                search.primary_cost, search.verifier_checks,
                search.proposal_verifier_checks, search.partial_expansions,
                search.fallback_verifier_checks,
                search.fallback_partial_expansions, view.observation_count,
                search.fallback_started ? "true" : "false",
                search.global_cap_hit ? "true" : "false",
                search.invalid_first_rejected ? "true" : "false", reads,
                sum, R56_SEMANTIC_CLASSES,
                (unsigned long long)r56_universe_digest(universe),
                (unsigned long long)r56_public_view_digest(&view),
                (unsigned long long)r56_verifier_digest(universe),
                (unsigned long long)artifact->artifact_digest);
            if (length <= 0 || (size_t)length >= sizeof(line) ||
                fwrite(line, 1u, (size_t)length, trace) != (size_t)length) {
                fclose(trace); free(universe); free(artifact); free(roundtrip);
                return 8;
            }
            trace_digest = r56_hash_update(trace_digest, line, (size_t)length);
        }
    }
    if (fclose(trace) != 0) {
        free(universe); free(artifact); free(roundtrip);
        return 9;
    }
    result->episodes = R56_DEVELOPMENT_EPISODES;
    result->temperature_index = artifact->temperature_index;
    result->temperature_q20 = artifact->temperature_q20;
    result->conformal_mass_q20 = artifact->conformal_mass_q20;
    result->calibration_fit_episodes = artifact->calibration_fit_episodes;
    result->calibration_coverage_episodes =
        artifact->calibration_coverage_episodes;
    result->artifact_digest = artifact->artifact_digest;
    result->trace_digest = trace_digest;
    result->calibration_fit_digest = artifact->calibration_fit_digest;
    result->calibration_coverage_digest =
        artifact->calibration_coverage_digest;
    {
        r56_ranker_view view;
        uint16_t truth;
        r56_public_node root;
        r56_public_node array;
        r56_public_node observations[R56_MAX_OBSERVATIONS];
        r56_public_node leaves[R56_MAX_OBSERVATIONS * 4u];
        r56_public_node hidden;
        r56_generate_view(UINT64_C(0x56de0001), UINT64_C(0x56de0002),
                          UINT64_C(0x56de0003), 0u, 0u, 0u, universe,
                          &view, &truth);
        if (r56_make_public_tree(&view, &root, &array, observations, leaves) != 0 ||
            r56_validate_ranker_tree(&root) != 0) {
            free(universe); free(artifact); free(roundtrip);
            return 10;
        }
        hidden = (r56_public_node){"hidden_target", R56_NODE_U8, 0u, NULL,
                                   truth};
        observations[0].children = &hidden;
        observations[0].child_count = 1u;
        if (r56_validate_ranker_tree(&root) != 0)
            result->hidden_field_rejections += 1u;
        if (r56_make_public_tree(&view, &root, &array, observations, leaves) != 0) {
            free(universe); free(artifact); free(roundtrip);
            return 10;
        }
        leaves[2].value = 1u;
        leaves[3].value = 1u;
        if (r56_validate_ranker_tree(&root) != 0)
            result->hidden_field_rejections += 1u;
    }
    free(universe);
    free(artifact);
    free(roundtrip);
    if (result->trace_rows != R56_DEVELOPMENT_EPISODES *
                              R56_DEVELOPMENT_ARMS ||
        result->exact_rows != result->trace_rows ||
        result->normalized_rows != result->trace_rows ||
        result->source_ablation_matches != R56_DEVELOPMENT_EPISODES ||
        result->candidate_set_rows != R56_DEVELOPMENT_EPISODES ||
        result->calibration_fit_episodes != 8u ||
        result->calibration_coverage_episodes != 8u ||
        result->calibration_fit_digest == 0u ||
        result->calibration_coverage_digest == 0u ||
        result->calibration_fit_digest == result->calibration_coverage_digest ||
        result->invalid_first_rejections != result->trace_rows ||
        result->artifact_roundtrip_valid != 1u ||
        result->hidden_field_rejections != 2u)
        return 10;
    return 0;
}

int r56_write_development_result(const char *path,
                                 const r56_development_result *result) {
    FILE *file;
    int ok;
    if (!path || !result) return 1;
    file = fopen(path, "wb");
    if (!file) return 2;
    ok = fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner56_development_result.v1\",\n"
        "  \"experiment\": \"reasoner56-passive-noise-development-v1\",\n"
        "  \"status\": \"development-only\",\n"
        "  \"scientific_decision\": null,\n"
        "  \"sealed_execution_authorized\": false,\n"
        "  \"syntax_programs\": %u,\n"
        "  \"semantic_classes\": %u,\n"
        "  \"sensors\": %u,\n"
        "  \"support_minimum\": %u,\n"
        "  \"episodes\": %u,\n"
        "  \"trace_rows\": %u,\n"
        "  \"exact_rows\": %u,\n"
        "  \"normalized_rows\": %u,\n"
        "  \"source_ablation_matches\": %u,\n"
        "  \"fallback_rows\": %u,\n"
        "  \"invalid_first_rejections\": %u,\n"
        "  \"artifact_roundtrip_valid\": %s,\n"
        "  \"hidden_field_rejections\": %u,\n"
        "  \"temperature_index\": %u,\n"
        "  \"temperature_q20\": %d,\n"
        "  \"conformal_mass_q20\": %d,\n"
        "  \"calibration_fit_episodes\": %u,\n"
        "  \"calibration_coverage_episodes\": %u,\n"
        "  \"candidate_set_rows\": %u,\n"
        "  \"candidate_set_truth_covered\": %u,\n"
        "  \"artifact_digest\": \"%016llx\",\n"
        "  \"trace_digest\": \"%016llx\",\n"
        "  \"calibration_fit_digest\": \"%016llx\",\n"
        "  \"calibration_coverage_digest\": \"%016llx\"\n"
        "}\n",
        R56_SYNTAX_PROGRAMS, R56_SEMANTIC_CLASSES, R56_SENSORS,
        R56_SUPPORT_MIN, result->episodes, result->trace_rows,
        result->exact_rows, result->normalized_rows,
        result->source_ablation_matches, result->fallback_rows,
        result->invalid_first_rejections,
        result->artifact_roundtrip_valid ? "true" : "false",
        result->hidden_field_rejections,
        result->temperature_index, result->temperature_q20,
        result->conformal_mass_q20, result->calibration_fit_episodes,
        result->calibration_coverage_episodes, result->candidate_set_rows,
        result->candidate_set_truth_covered,
        (unsigned long long)result->artifact_digest,
        (unsigned long long)result->trace_digest,
        (unsigned long long)result->calibration_fit_digest,
        (unsigned long long)result->calibration_coverage_digest) > 0;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 3;
}

static int r56_self_test_schema(void) {
    r56_public_node leaves[4] = {
        {"input", R56_NODE_U8, 0u, NULL, 0u},
        {"sensor", R56_NODE_U8, 0u, NULL, 1u},
        {"observed", R56_NODE_U8, 0u, NULL, 2u},
        {"missing", R56_NODE_BOOL, 0u, NULL, 0u}
    };
    r56_public_node observation = {
        "observation", R56_NODE_OBJECT, 4u, leaves, 0u
    };
    r56_public_node array = {
        "observations", R56_NODE_ARRAY, 1u, &observation, 0u
    };
    r56_public_node root = {
        "ranker_view", R56_NODE_OBJECT, 1u, &array, 0u
    };
    if (r56_validate_ranker_tree(&root) != 0) return 1;
    leaves[3].name = "hidden_target";
    if (r56_validate_ranker_tree(&root) == 0) return 2;
    leaves[3].name = "missing";
    leaves[3].value = 2u;
    if (r56_validate_ranker_tree(&root) == 0) return 3;
    leaves[3].value = 1u;
    leaves[2].value = 1u;
    return r56_validate_ranker_tree(&root) == 0 ? 4 : 0;
}

int r56_self_test(void) {
    r56_universe *universe = (r56_universe *)malloc(sizeof(*universe));
    r56_artifact *first = (r56_artifact *)malloc(sizeof(*first));
    r56_artifact *second = (r56_artifact *)malloc(sizeof(*second));
    r56_artifact *decoded = (r56_artifact *)malloc(sizeof(*decoded));
    uint8_t *bytes;
    uint8_t *other_bytes;
    size_t size = r56_artifact_serialized_size();
    size_t written = 0u;
    size_t other_written = 0u;
    int status = 0;
    if (!universe || !first || !second || !decoded) {
        status = 1; goto done;
    }
    if (r56_build_universe(universe) != 0) { status = 2; goto done; }
    {
        uint32_t multiplicity = 0u;
        for (uint32_t semantic = 0u; semantic < universe->semantic_count;
             ++semantic)
            multiplicity += universe->semantic[semantic].multiplicity;
        if (multiplicity != R56_SYNTAX_PROGRAMS) { status = 3; goto done; }
    }
    if (r56_build_artifact(first, universe, UINT64_C(0x56010001),
                           UINT64_C(0x56020002)) != 0 ||
        r56_build_artifact(second, universe, UINT64_C(0x56010001),
                           UINT64_C(0x56020002)) != 0) {
        status = 4; goto done;
    }
    bytes = (uint8_t *)malloc(size);
    other_bytes = (uint8_t *)malloc(size);
    if (!bytes || !other_bytes) {
        free(bytes); free(other_bytes); status = 5; goto done;
    }
    if (r56_serialize_artifact(first, bytes, size, &written) != 0 ||
        r56_serialize_artifact(second, other_bytes, size, &other_written) != 0 ||
        written != size || other_written != size ||
        memcmp(bytes, other_bytes, size) != 0) {
        status = 6; goto bytes_done;
    }
    if (r56_deserialize_artifact(decoded, bytes, size) != 0 ||
        decoded->artifact_digest != first->artifact_digest) {
        status = 7; goto bytes_done;
    }
    bytes[size / 2u] ^= 1u;
    if (r56_deserialize_artifact(decoded, bytes, size) == 0) {
        status = 8; goto bytes_done;
    }
    bytes[size / 2u] ^= 1u;
    if (r56_log_probability_q20(0u, 0u, R56_CHANNEL_STATES) >= 0 ||
        r56_log_probability_q20(10u, 10u, R56_CHANNEL_STATES) >= 0) {
        status = 9; goto bytes_done;
    }
    {
        size_t exact = r56_local_exact_context(0u, 0u, 0u);
        size_t value = r56_local_value_context(0u, 0u);
        size_t transition = r56_transition_exact_context(0u, 0u, 0u);
        size_t current = r56_transition_current_context(0u, 0u);
        if (r56_local_backoff_level(first, 0u, 0u, 0u) != R56_BACKOFF_EXACT ||
            r56_transition_backoff_level(first, 0u, 0u, 0u) !=
                R56_TRANSITION_EXACT) {
            status = 10; goto bytes_done;
        }
        second->local_exact_support[exact] = R56_SUPPORT_MIN - 1u;
        if (r56_local_backoff_level(second, 0u, 0u, 0u) != R56_BACKOFF_VALUE) {
            status = 11; goto bytes_done;
        }
        second->local_value_support[value] = R56_SUPPORT_MIN - 1u;
        if (r56_local_backoff_level(second, 0u, 0u, 0u) != R56_BACKOFF_SENSOR) {
            status = 12; goto bytes_done;
        }
        second->local_sensor_support[0] = R56_SUPPORT_MIN - 1u;
        if (r56_local_backoff_level(second, 0u, 0u, 0u) != R56_BACKOFF_GLOBAL) {
            status = 13; goto bytes_done;
        }
        second->transition_exact_support[transition] = R56_SUPPORT_MIN - 1u;
        if (r56_transition_backoff_level(second, 0u, 0u, 0u) !=
            R56_TRANSITION_CURRENT) { status = 14; goto bytes_done; }
        second->transition_current_support[current] = R56_SUPPORT_MIN - 1u;
        if (r56_transition_backoff_level(second, 0u, 0u, 0u) !=
            R56_TRANSITION_PREVIOUS) { status = 15; goto bytes_done; }
        second->transition_previous_support[0] = R56_SUPPORT_MIN - 1u;
        if (r56_transition_backoff_level(second, 0u, 0u, 0u) !=
            R56_TRANSITION_GLOBAL) { status = 16; goto bytes_done; }
    }
    {
        r56_ranker_view fit_views[8];
        r56_ranker_view coverage_views[8];
        uint16_t fit_truth[8];
        uint16_t coverage_truth[8];
        if (r56_build_artifact(second, universe, UINT64_C(0x56010001),
                               UINT64_C(0x56020002)) != 0) {
            status = 17; goto bytes_done;
        }
        for (uint32_t index = 0u; index < 8u; ++index) {
            r56_generate_view(UINT64_C(0x56ca1100),
                              UINT64_C(0x56ca1200),
                              UINT64_C(0x56ca1300), index, index, index,
                              universe, &fit_views[index], &fit_truth[index]);
            r56_generate_view(UINT64_C(0x56cb1100),
                              UINT64_C(0x56cb1200),
                              UINT64_C(0x56cb1300), index, index + 8u,
                              index + 8u, universe, &coverage_views[index],
                              &coverage_truth[index]);
        }
        if (r56_calibrate(second, universe,
                          fit_views, fit_truth, 8u,
                          coverage_views, coverage_truth, 8u) != 0 ||
            second->temperature_index >= R56_TEMPERATURES ||
            second->temperature_q20 !=
                r56_temperature_q20[second->temperature_index] ||
            second->calibration_fit_episodes != 8u ||
            second->calibration_coverage_episodes != 8u ||
            second->calibration_fit_digest == 0u ||
            second->calibration_coverage_digest == 0u ||
            second->calibration_fit_digest ==
                second->calibration_coverage_digest ||
            second->conformal_mass_q20 <= 0 ||
            second->conformal_mass_q20 > R56_Q20_ONE) {
            status = 18; goto bytes_done;
        }
        for (uint32_t index = 0u; index < 8u; ++index) {
            double probability[R56_SEMANTIC_CLASSES];
            int64_t score[R56_SEMANTIC_CLASSES];
            uint8_t included[R56_SEMANTIC_CLASSES];
            uint32_t reads;
            double threshold = (double)second->conformal_mass_q20 /
                               (double)R56_Q20_ONE;
            if (r56_posterior(second, universe, &coverage_views[index],
                              R56_ARM_FULL,
                              probability, score, &reads) != 0 ||
                r56_candidate_set(probability, threshold, included) == 0u ||
                included[coverage_truth[index]] == 0u) {
                status = 19; goto bytes_done;
            }
        }
    }
    {
        r56_ranker_view view;
        r56_ranker_view same_order;
        r56_ranker_view different_order;
        uint16_t truth;
        uint16_t other_truth;
        double full[R56_SEMANTIC_CLASSES];
        double source_free[R56_SEMANTIC_CLASSES];
        double ablation[R56_SEMANTIC_CLASSES];
        int64_t full_score[R56_SEMANTIC_CLASSES];
        int64_t source_free_score[R56_SEMANTIC_CLASSES];
        int64_t ablation_score[R56_SEMANTIC_CLASSES];
        uint32_t full_reads;
        uint32_t source_reads;
        uint32_t ablation_reads;
        uint8_t included[R56_SEMANTIC_CLASSES];
        r56_generate_view(UINT64_C(0x56de0001), UINT64_C(0x56de0002),
                          UINT64_C(0x56de0003), 0u, 0u, 0u, universe,
                          &view, &truth);
        r56_generate_view(UINT64_C(0x77de0001), UINT64_C(0x77de0002),
                          UINT64_C(0x56de0003), 0u, 9u, 7u, universe,
                          &same_order, &other_truth);
        r56_generate_view(UINT64_C(0x56de0001), UINT64_C(0x56de0002),
                          UINT64_C(0x66de0003), 0u, 0u, 0u, universe,
                          &different_order, &other_truth);
        {
            uint32_t changed = 0u;
            for (uint32_t index = 0u; index < view.observation_count;
                 ++index) {
                if (view.observations[index].input !=
                        same_order.observations[index].input ||
                    view.observations[index].sensor !=
                        same_order.observations[index].sensor) {
                    status = 20; goto bytes_done;
                }
                changed += view.observations[index].input !=
                               different_order.observations[index].input ||
                           view.observations[index].sensor !=
                               different_order.observations[index].sensor;
            }
            if (changed == 0u) { status = 20; goto bytes_done; }
        }
        if (r56_posterior(first, universe, &view, R56_ARM_FULL, full,
                          full_score, &full_reads) != 0 ||
            fabs(r56_probability_sum(full) - 1.0) > 1e-12 ||
            full_reads == 0u) { status = 20; goto bytes_done; }
        {
            r56_ranker_view invalid_view = view;
            invalid_view.observations[0].missing = 1u;
            invalid_view.observations[0].observed = 1u;
            if (r56_posterior(first, universe, &invalid_view,
                              R56_ARM_FULL, full, full_score,
                              &full_reads) == 0) {
                status = 20; goto bytes_done;
            }
        }
        if (r56_posterior(first, universe, &view, R56_ARM_SOURCE_FREE,
                          source_free, source_free_score, &source_reads) != 0 ||
            r56_posterior(first, universe, &view, R56_ARM_SOURCE_ABLATION,
                          ablation, ablation_score, &ablation_reads) != 0 ||
            source_reads != 0u || ablation_reads != 0u ||
            memcmp(source_free, ablation, sizeof(source_free)) != 0 ||
            memcmp(source_free_score, ablation_score,
                   sizeof(source_free_score)) != 0) {
            status = 21; goto bytes_done;
        }
        if (r56_candidate_set(full, 0.99, included) == 0u) {
            status = 22; goto bytes_done;
        }
        {
            r56_certificate certificate;
            uint16_t invalid = truth == 0u ? 1u : 0u;
            uint16_t proposal[1] = {invalid};
            r56_search_result capped;
            r56_search_result complete;
            if (!r56_verify_semantic_class(universe, truth,
                    universe->semantic[truth].table, &certificate) ||
                !certificate.valid || certificate.checked_points != R56_MODULUS ||
                r56_verify_semantic_class(universe, invalid,
                    universe->semantic[truth].table, &certificate)) {
                status = 23; goto bytes_done;
            }
            if (r56_verified_search(universe,
                    universe->semantic[truth].table, proposal, 1u, 1u,
                    invalid, &capped) != 0 || capped.solved ||
                !capped.global_cap_hit || capped.primary_cost != 2u ||
                !capped.invalid_first_rejected) {
                status = 24; goto bytes_done;
            }
            if (r56_verified_search(universe,
                    universe->semantic[truth].table, proposal, 1u,
                    R56_SEMANTIC_CLASSES, invalid, &complete) != 0 ||
                !complete.solved || !complete.certificate_valid ||
                !complete.fallback_started ||
                !complete.invalid_first_rejected) {
                status = 25; goto bytes_done;
            }
        }
    }
    if (r56_self_test_schema() != 0) status = 26;

bytes_done:
    free(bytes);
    free(other_bytes);
done:
    free(universe);
    free(first);
    free(second);
    free(decoded);
    return status;
}
