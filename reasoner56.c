#include "reasoner56.h"

#include <errno.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R56_ARTIFACT_VERSION 1u
#define R56_SOURCE_PROGRAM_COUNT 256u
#define R56_DEVELOPMENT_PROGRAM_FAMILIES 8u
#define R56_DEVELOPMENT_CORRUPTION_FAMILIES 8u
#define R56_DEVELOPMENT_REPEATS 2u
#define R56_DEVELOPMENT_EPISODES \
    (R56_DEVELOPMENT_PROGRAM_FAMILIES * \
     R56_DEVELOPMENT_CORRUPTION_FAMILIES * R56_DEVELOPMENT_REPEATS)
#define R56_DEVELOPMENT_ARMS 45u
#define R56_DEVELOPMENT_OBSERVATIONS 18u
#define R56_PROPOSAL_BUDGET 24u
#define R56_GLOBAL_CAP R56_SEMANTIC_CLASSES

/* The shared harness orders complete candidate records by their canonical
 * SHA-256 keys. This frozen table is the matching order for the R5.6 GF(17)
 * records. It keeps native search and replay search on the same fallback. */
static const uint16_t r56_canonical_fallback_order[R56_SEMANTIC_CLASSES] = {
    200u, 372u, 103u, 311u, 125u, 41u, 340u, 239u, 250u, 165u, 177u, 123u,
    48u, 21u, 43u, 107u, 359u, 151u, 418u, 163u, 127u, 417u, 391u, 181u,
    400u, 4u, 389u, 405u, 407u, 28u, 386u, 323u, 153u, 215u, 272u, 8u,
    208u, 89u, 327u, 341u, 66u, 40u, 180u, 344u, 425u, 316u, 255u, 370u,
    54u, 317u, 258u, 231u, 411u, 105u, 199u, 150u, 149u, 294u, 325u, 271u,
    77u, 110u, 203u, 368u, 128u, 29u, 52u, 97u, 207u, 299u, 387u, 295u,
    182u, 5u, 31u, 135u, 56u, 270u, 175u, 351u, 410u, 355u, 282u, 303u,
    401u, 266u, 122u, 354u, 192u, 404u, 51u, 332u, 227u, 247u, 121u, 178u,
    7u, 281u, 211u, 397u, 292u, 406u, 196u, 190u, 45u, 378u, 244u, 223u,
    369u, 137u, 300u, 301u, 356u, 346u, 394u, 249u, 269u, 337u, 117u, 352u,
    277u, 9u, 276u, 349u, 229u, 367u, 191u, 114u, 366u, 167u, 267u, 78u,
    307u, 423u, 232u, 236u, 30u, 305u, 242u, 374u, 382u, 148u, 246u, 415u,
    371u, 424u, 87u, 238u, 15u, 234u, 342u, 24u, 100u, 293u, 183u, 14u,
    23u, 364u, 363u, 144u, 67u, 171u, 93u, 396u, 141u, 143u, 33u, 68u,
    259u, 257u, 81u, 69u, 251u, 314u, 383u, 329u, 324u, 218u, 62u, 201u,
    98u, 108u, 241u, 335u, 160u, 278u, 55u, 96u, 260u, 11u, 365u, 120u,
    262u, 83u, 0u, 194u, 283u, 170u, 64u, 256u, 147u, 174u, 166u, 353u,
    205u, 392u, 339u, 289u, 25u, 409u, 275u, 94u, 390u, 320u, 168u, 345u,
    413u, 152u, 375u, 164u, 297u, 302u, 399u, 162u, 214u, 173u, 12u, 22u,
    74u, 263u, 348u, 161u, 76u, 306u, 343u, 82u, 85u, 224u, 221u, 357u,
    19u, 254u, 334u, 38u, 291u, 225u, 126u, 104u, 309u, 412u, 426u, 261u,
    154u, 157u, 321u, 360u, 106u, 130u, 358u, 304u, 133u, 319u, 20u, 414u,
    6u, 63u, 322u, 145u, 285u, 35u, 71u, 115u, 240u, 220u, 59u, 50u,
    73u, 60u, 217u, 296u, 388u, 280u, 39u, 284u, 13u, 330u, 119u, 146u,
    408u, 253u, 46u, 350u, 16u, 380u, 313u, 381u, 230u, 92u, 49u, 222u,
    53u, 308u, 131u, 216u, 17u, 102u, 273u, 421u, 18u, 176u, 416u, 179u,
    398u, 134u, 136u, 37u, 376u, 210u, 99u, 86u, 286u, 26u, 129u, 206u,
    47u, 198u, 288u, 10u, 36u, 333u, 385u, 124u, 58u, 79u, 315u, 373u,
    32u, 212u, 109u, 140u, 403u, 186u, 42u, 252u, 312u, 118u, 91u, 185u,
    422u, 113u, 362u, 159u, 420u, 90u, 187u, 379u, 139u, 347u, 61u, 132u,
    95u, 243u, 228u, 326u, 290u, 237u, 116u, 75u, 331u, 70u, 235u, 298u,
    34u, 101u, 419u, 1u, 402u, 310u, 226u, 287u, 158u, 197u, 57u, 265u,
    233u, 328u, 72u, 193u, 188u, 138u, 155u, 195u, 84u, 204u, 274u, 172u,
    395u, 213u, 361u, 112u, 2u, 393u, 88u, 3u, 44u, 142u, 202u, 65u,
    80u, 318u, 377u, 189u, 268u, 338u, 248u, 279u, 336u, 156u, 184u, 27u,
    384u, 169u, 111u, 264u, 209u, 219u, 245u
};

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

static int r56_universe_shape_valid(const r56_universe *universe) {
    if (!universe || universe->syntax_count != R56_SYNTAX_PROGRAMS ||
        universe->semantic_count != R56_SEMANTIC_CLASSES)
        return 0;
    for (uint32_t index = 0u; index < R56_SYNTAX_PROGRAMS; ++index)
        if (universe->syntax_to_semantic[index] >= R56_SEMANTIC_CLASSES)
            return 0;
    return 1;
}

static int r56_universe_content_valid(const r56_universe *universe) {
    uint32_t multiplicity = 0u;
    if (!r56_universe_shape_valid(universe)) return 0;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        uint8_t rebuilt[R56_MODULUS];
        for (uint32_t position = 0u; position < R56_PROGRAM_DEPTH; ++position)
            if (universe->semantic[semantic].representative[position] >=
                R56_PRIMITIVES)
                return 0;
        r56_program_table(universe->semantic[semantic].representative, rebuilt);
        if (memcmp(rebuilt, universe->semantic[semantic].table,
                   R56_MODULUS) != 0)
            return 0;
        multiplicity += universe->semantic[semantic].multiplicity;
    }
    for (uint32_t syntax = 0u; syntax < R56_SYNTAX_PROGRAMS; ++syntax) {
        uint16_t semantic = universe->syntax_to_semantic[syntax];
        if (memcmp(universe->syntax[syntax].table,
                   universe->semantic[semantic].table, R56_MODULUS) != 0)
            return 0;
    }
    return multiplicity == R56_SYNTAX_PROGRAMS;
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
    if (!artifact || !r56_universe_content_valid(universe))
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

    {
        uint32_t missing_contexts = 0u;
        uint32_t sequence_index = 0u;
        for (uint32_t context = 0u;
             context < R56_TRANSITION_EXACT_CONTEXTS; ++context)
            missing_contexts +=
                artifact->transition_exact_support[context] < R56_SUPPORT_MIN;
        while (missing_contexts > 0u && sequence_index < 1000000u) {
            uint8_t token[R56_PROGRAM_DEPTH];
            uint8_t table[R56_MODULUS];
            uint8_t order[R56_MAX_OBSERVATIONS];
            r56_corruption_family family;
            uint8_t previous_state = 0u;
            uint8_t previous_sensor = 0u;
            r56_generate_source_program(source_seed ^ UINT64_C(0x56bb),
                                        sequence_index, token);
            r56_program_table(token, table);
            r56_generate_corruption_family(
                corruption_seed ^ UINT64_C(0x56bb), sequence_index, &family);
            for (uint32_t cell = 0u; cell < R56_MAX_OBSERVATIONS; ++cell)
                order[cell] = (uint8_t)cell;
            for (uint32_t cell = R56_MAX_OBSERVATIONS - 1u; cell > 0u;
                 --cell) {
                uint32_t selected = (uint32_t)(r56_event_key(
                    source_seed ^ UINT64_C(0x56bc), sequence_index, cell,
                    5608u, 0u, 0u) % (cell + 1u));
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
                uint8_t state = r56_channel_state(&family,
                    corruption_seed ^ r56_mix64(sequence_index), sensor,
                    input, clean, previous_state, position);
                r56_add_local(artifact, sensor, input, clean, state);
                if (position == 0u) {
                    artifact->initial_support[sensor] += 1u;
                    artifact->initial_count[(size_t)sensor *
                        R56_CHANNEL_STATES + state] += 1u;
                } else {
                    size_t context = r56_transition_exact_context(
                        previous_sensor, sensor, previous_state);
                    uint32_t before = artifact->transition_exact_support[context];
                    r56_add_transition(artifact, previous_sensor, sensor,
                                       previous_state, state);
                    if (before < R56_SUPPORT_MIN &&
                        artifact->transition_exact_support[context] ==
                            R56_SUPPORT_MIN)
                        missing_contexts -= 1u;
                }
                previous_sensor = sensor;
                previous_state = state;
                artifact->source_samples += 1u;
            }
            program_digest = r56_hash_update(program_digest, token,
                                             sizeof(token));
            corruption_digest = r56_hash_update(corruption_digest, &family,
                                                sizeof(family));
            sequence_index += 1u;
        }
        if (missing_contexts != 0u) return 2;
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

static uint8_t r56_deranged_state(uint32_t derangement, uint8_t state) {
    uint32_t a = 1u;
    uint32_t b;
    if (derangement < 17u) {
        b = derangement + 1u;
    } else if (derangement < 26u) {
        a = 5u;
        b = 1u + 2u * (derangement - 17u);
    } else {
        a = 7u;
        b = 1u + (derangement - 26u);
    }
    return (uint8_t)((a * state + b) % R56_CHANNEL_STATES);
}

static int32_t r56_mask_log_probability(uint32_t missing_count,
                                        uint32_t support, int missing) {
    uint32_t count = missing ? missing_count : support - missing_count;
    uint32_t outcomes = missing ? 1u : R56_MODULUS;
    double probability = ((double)count + (double)outcomes) /
                         ((double)support + (double)R56_CHANNEL_STATES);
    return (int32_t)llround(log(probability) * (double)R56_Q20_ONE);
}

static int32_t r56_local_mask_score(const r56_artifact *artifact,
                                    uint8_t sensor, uint8_t input,
                                    uint8_t value, int missing,
                                    uint32_t *reads) {
    r56_local_backoff level = r56_local_backoff_level(artifact, sensor, input,
                                                      value);
    const uint32_t *counts;
    uint32_t support;
    *reads += 1u;
    if (level == R56_BACKOFF_EXACT) {
        size_t context = r56_local_exact_context(sensor, input, value);
        counts = &artifact->local_exact_count[context * R56_CHANNEL_STATES];
        support = artifact->local_exact_support[context];
    } else if (level == R56_BACKOFF_VALUE) {
        size_t context = r56_local_value_context(sensor, value);
        counts = &artifact->local_value_count[context * R56_CHANNEL_STATES];
        support = artifact->local_value_support[context];
    } else if (level == R56_BACKOFF_SENSOR) {
        counts = &artifact->local_sensor_count[(size_t)sensor *
                                               R56_CHANNEL_STATES];
        support = artifact->local_sensor_support[sensor];
    } else {
        counts = artifact->local_global_count;
        support = artifact->local_global_support;
    }
    return r56_mask_log_probability(counts[R56_MODULUS], support, missing);
}

static int32_t r56_transition_mask_score(const r56_artifact *artifact,
                                         uint8_t previous_sensor,
                                         uint8_t current_sensor,
                                         int previous_missing,
                                         int current_missing,
                                         uint32_t *reads) {
    uint8_t previous_state = previous_missing ? R56_MODULUS : 0u;
    r56_transition_backoff level = r56_transition_backoff_level(
        artifact, previous_sensor, current_sensor, previous_state);
    const uint32_t *counts;
    uint32_t support;
    *reads += 1u;
    if (level == R56_TRANSITION_EXACT) {
        size_t context = r56_transition_exact_context(previous_sensor,
            current_sensor, previous_state);
        counts = &artifact->transition_exact_count[
            context * R56_CHANNEL_STATES];
        support = artifact->transition_exact_support[context];
    } else if (level == R56_TRANSITION_CURRENT) {
        size_t context = r56_transition_current_context(current_sensor,
                                                        previous_state);
        counts = &artifact->transition_current_count[
            context * R56_CHANNEL_STATES];
        support = artifact->transition_current_support[context];
    } else if (level == R56_TRANSITION_PREVIOUS) {
        counts = &artifact->transition_previous_count[
            (size_t)previous_state * R56_CHANNEL_STATES];
        support = artifact->transition_previous_support[previous_state];
    } else {
        counts = artifact->transition_global_count;
        support = artifact->transition_global_support;
    }
    return r56_mask_log_probability(counts[R56_MODULUS], support,
                                    current_missing);
}

static int32_t r56_initial_mask_score(const r56_artifact *artifact,
                                      uint8_t sensor, int missing,
                                      uint32_t *reads) {
    const uint32_t *counts = &artifact->initial_count[
        (size_t)sensor * R56_CHANNEL_STATES];
    *reads += 1u;
    return r56_mask_log_probability(counts[R56_MODULUS],
                                    artifact->initial_support[sensor],
                                    missing);
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
    int isolated = arm == R56_ARM_TARGET_ONLY ||
                   arm == R56_ARM_SOURCE_FREE ||
                   arm == R56_ARM_SOURCE_ABLATION;
    int derangement = arm >= R56_ARM_DERANGEMENT_00 &&
                      arm <= R56_ARM_DERANGEMENT_30;
    if (!r56_universe_shape_valid(universe) || !probability || !score_q20 ||
        !source_artifact_reads || r56_validate_view(view) != 0 ||
        arm < R56_ARM_FULL || arm > R56_ARM_DERANGEMENT_30 ||
        arm == R56_ARM_ORACLE_CHANNEL || arm == R56_ARM_CLEAN_ORACLE)
        return 1;
    if (!isolated && (!artifact || artifact->version != R56_ARTIFACT_VERSION ||
                      artifact->temperature_q20 <= 0))
        return 2;
    for (semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        const uint8_t *table = universe->semantic[semantic].table;
        int64_t score = 0;
        if (arm == R56_ARM_TARGET_ONLY) {
            score = 0;
        } else if (arm == R56_ARM_SOURCE_FREE ||
                   arm == R56_ARM_SOURCE_ABLATION) {
            uint32_t mismatch = 0u;
            for (uint32_t observation = 0u;
                 observation < view->observation_count; ++observation) {
                const r56_public_observation *item =
                    &view->observations[observation];
                if (!item->missing && table[item->input] != item->observed)
                    mismatch += 1u;
            }
            if (mismatch > 0u) mismatch -= 1u;
            score = -(int64_t)mismatch * R56_Q20_ONE;
        } else {
            uint8_t previous_state = 0u;
            uint8_t previous_sensor = 0u;
            int previous_missing = 0;
            if (arm != R56_ARM_CHANNEL_ONLY) {
                score += artifact->class_log_q20[semantic];
                reads += 1u;
            }
            if (arm == R56_ARM_ROBUST_HAMMING ||
                arm == R56_ARM_ONE_TRIM) {
                uint32_t mismatch = 0u;
                for (uint32_t observation = 0u;
                     observation < view->observation_count; ++observation) {
                    const r56_public_observation *item =
                        &view->observations[observation];
                    if (!item->missing && table[item->input] != item->observed)
                        mismatch += 1u;
                }
                if (arm == R56_ARM_ONE_TRIM && mismatch > 0u) mismatch -= 1u;
                score -= (int64_t)mismatch * R56_Q20_ONE;
            } else if (arm != R56_ARM_PROGRAM_PRIOR_ONLY) {
                for (uint32_t observation = 0u;
                     observation < view->observation_count; ++observation) {
                    const r56_public_observation *item =
                        &view->observations[observation];
                    uint8_t sensor = arm == R56_ARM_SHUFFLED_SENSOR ?
                        (uint8_t)((item->sensor + 1u) % R56_SENSORS) :
                        item->sensor;
                    uint8_t state = r56_observation_state(item,
                                                          table[item->input]);
                    uint8_t likelihood_state = derangement ?
                        r56_deranged_state(
                            (uint32_t)arm - R56_ARM_DERANGEMENT_00, state) :
                        state;
                    if (arm == R56_ARM_MASK_ONLY) {
                        score += r56_local_mask_score(artifact, sensor,
                            item->input, table[item->input], item->missing,
                            &reads);
                    } else if (arm != R56_ARM_VALUE_ONLY || !item->missing) {
                        score += r56_local_score(artifact, sensor,
                            item->input, table[item->input], likelihood_state,
                            &reads);
                    }
                    if (observation == 0u) {
                        if (arm != R56_ARM_VALUE_ONLY) {
                            if (arm == R56_ARM_MASK_ONLY)
                                score += r56_initial_mask_score(artifact,
                                    sensor, item->missing, &reads);
                            else {
                                score += artifact->initial_log_q20[
                                    (size_t)sensor * R56_CHANNEL_STATES +
                                    likelihood_state];
                                reads += 1u;
                            }
                        }
                    } else if (arm != R56_ARM_MARKOV_OFF) {
                        if (arm == R56_ARM_MASK_ONLY) {
                            score += r56_transition_mask_score(artifact,
                                previous_sensor, sensor, previous_missing,
                                item->missing, &reads);
                        } else if (arm != R56_ARM_VALUE_ONLY ||
                                   (!previous_missing && !item->missing)) {
                            score += r56_transition_score(artifact,
                                previous_sensor, sensor, previous_state,
                                likelihood_state, &reads);
                        }
                    }
                    previous_state = state;
                    previous_sensor = sensor;
                    previous_missing = item->missing;
                }
            }
        }
        score_q20[semantic] = isolated ? score :
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
    *source_artifact_reads = isolated ? 0u : reads;
    return 0;
}

static double r56_score_log_loss(
    const int64_t score_q20[R56_SEMANTIC_CLASSES], uint16_t truth) {
    int64_t maximum = INT64_MIN;
    uint32_t maximum_ties = 0u;
    double lower_tail = 0.0;
    if (!score_q20 || truth >= R56_SEMANTIC_CLASSES) return NAN;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        if (score_q20[semantic] > maximum) maximum = score_q20[semantic];
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        if (score_q20[semantic] == maximum) {
            maximum_ties += 1u;
        } else {
            lower_tail += exp(((double)score_q20[semantic] -
                               (double)maximum) /
                              (double)R56_Q20_ONE);
        }
    }
    if (maximum_ties == 0u || !isfinite(lower_tail)) return NAN;
    return ((double)maximum - (double)score_q20[truth]) /
               (double)R56_Q20_ONE +
           log((double)maximum_ties) +
           log1p(lower_tail / (double)maximum_ties);
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
    /* The registered finite-sample fallback is the complete universe.  A
     * floating-point posterior may round tiny positive masses to zero, so a
     * threshold of one must be handled as the exact full-set rule. */
    if (cumulative_threshold == 1.0) {
        memset(included, 1, R56_SEMANTIC_CLASSES);
        return R56_SEMANTIC_CLASSES;
    }
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
                  const uint16_t *fit_truth, uint32_t fit_family_count,
                  const r56_ranker_view *coverage_views,
                  const uint16_t *coverage_truth,
                  uint32_t coverage_family_count,
                  uint32_t draws_per_family) {
    uint32_t temperature;
    uint32_t best = 0u;
    double best_loss = HUGE_VAL;
    double *mass;
    if (!artifact || !universe || !fit_views || !fit_truth ||
        !coverage_views || !coverage_truth || fit_family_count == 0u ||
        coverage_family_count == 0u || draws_per_family == 0u ||
        !r56_universe_shape_valid(universe))
        return 1;
    for (temperature = 0u; temperature < R56_TEMPERATURES; ++temperature) {
        double loss = 0.0;
        artifact->temperature_q20 = r56_temperature_q20[temperature];
        for (uint32_t family = 0u; family < fit_family_count; ++family) {
            double family_loss = 0.0;
            for (uint32_t draw = 0u; draw < draws_per_family; ++draw) {
                uint32_t episode = family * draws_per_family + draw;
                double probability[R56_SEMANTIC_CLASSES];
                int64_t score[R56_SEMANTIC_CLASSES];
                uint32_t reads;
                if (fit_truth[episode] >= R56_SEMANTIC_CLASSES ||
                    r56_posterior(artifact, universe, &fit_views[episode],
                                  R56_ARM_FULL, probability, score,
                                  &reads) != 0)
                    return 2;
                {
                    double episode_loss = r56_score_log_loss(
                        score, fit_truth[episode]);
                    if (!isfinite(episode_loss) || episode_loss < 0.0)
                        return 2;
                    family_loss += episode_loss;
                }
            }
            loss += family_loss / (double)draws_per_family;
        }
        if (loss < best_loss) {
            best_loss = loss;
            best = temperature;
        }
    }
    artifact->temperature_index = best;
    artifact->temperature_q20 = r56_temperature_q20[best];
    mass = (double *)malloc((size_t)coverage_family_count * sizeof(*mass));
    if (!mass) return 3;
    for (uint32_t family = 0u; family < coverage_family_count; ++family) {
        double worst = 0.0;
        for (uint32_t draw = 0u; draw < draws_per_family; ++draw) {
            uint32_t episode = family * draws_per_family + draw;
            double probability[R56_SEMANTIC_CLASSES];
            int64_t score[R56_SEMANTIC_CLASSES];
            uint32_t reads;
            double score_value;
            if (coverage_truth[episode] >= R56_SEMANTIC_CLASSES ||
                r56_posterior(artifact, universe, &coverage_views[episode],
                              R56_ARM_FULL, probability, score, &reads) != 0) {
                free(mass);
                return 4;
            }
            score_value = r56_truth_cumulative(probability,
                                               coverage_truth[episode]);
            if (score_value > worst) worst = score_value;
        }
        mass[family] = worst;
    }
    for (uint32_t index = 1u; index < coverage_family_count; ++index) {
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
            0.99 * (double)(coverage_family_count + 1u));
        double selected;
        if (quantile == 0u) quantile = 1u;
        selected = quantile > coverage_family_count ? 1.0 :
            mass[quantile - 1u];
        artifact->conformal_mass_q20 = (int32_t)ceil(selected * R56_Q20_ONE);
        if (artifact->conformal_mass_q20 > R56_Q20_ONE)
            artifact->conformal_mass_q20 = R56_Q20_ONE;
        if (artifact->conformal_mass_q20 < 1)
            artifact->conformal_mass_q20 = 1;
    }
    artifact->calibration_fit_episodes = fit_family_count;
    artifact->calibration_coverage_episodes = coverage_family_count;
    artifact->calibration_fit_digest = r56_calibration_digest(
        fit_views, fit_truth, fit_family_count * draws_per_family, 5608u);
    artifact->calibration_coverage_digest = r56_calibration_digest(
        coverage_views, coverage_truth,
        coverage_family_count * draws_per_family, 5609u);
    free(mass);
    return r56_refresh_artifact_digest(artifact);
}

int r56_verify_semantic_class(const r56_universe *universe,
                              uint16_t semantic_class,
                              const uint8_t target[R56_MODULUS],
                              r56_certificate *certificate) {
    uint8_t rebuilt[R56_MODULUS];
    int accepted;
    if (!r56_universe_shape_valid(universe) || !target || !certificate ||
        semantic_class >= R56_SEMANTIC_CLASSES)
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
    if (!r56_universe_shape_valid(universe) || !target || !proposals ||
        proposal_count == 0u ||
        !result || global_cap == 0u || global_cap == UINT32_MAX ||
        global_cap > R56_SEMANTIC_CLASSES ||
        injected_invalid >= R56_SEMANTIC_CLASSES ||
        proposals[0] != injected_invalid)
        return 1;
    memset(result, 0, sizeof(*result));
    memset(seen, 0, sizeof(seen));
    result->accepted_class = UINT32_MAX;
    for (uint32_t phase = 0u; phase < 2u && !result->solved; ++phase) {
        uint32_t count = phase == 0u ? proposal_count : R56_SEMANTIC_CLASSES;
        for (uint32_t index = 0u; index < count; ++index) {
            uint16_t semantic = phase == 0u ? proposals[index] :
                r56_canonical_fallback_order[index];
            r56_certificate certificate;
            int accepted;
            if (semantic >= R56_SEMANTIC_CLASSES) return 2;
            if (result->verifier_checks >= global_cap) {
                result->global_cap_hit = 1u;
                break;
            }
            if (phase == 1u) result->fallback_started = 1u;
            result->partial_expansions += 1u;
            if (phase == 1u) result->fallback_partial_expansions += 1u;
            if (seen[semantic]) continue;
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
    result->fallback_exhausted = !result->solved && !result->global_cap_hit;
    result->primary_cost = result->solved ? result->verifier_checks :
                           global_cap + 1u;
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

static void r56_generate_view(uint64_t corruption_seed,
                              uint64_t order_seed, uint32_t episode_nonce,
                              uint32_t order_slot, uint16_t truth,
                              uint32_t corruption_index,
                              const r56_universe *universe,
                              r56_ranker_view *view) {
    uint8_t order[R56_MAX_OBSERVATIONS];
    r56_corruption_family family;
    uint8_t previous_state = 0u;
    r56_generate_corruption_family(corruption_seed, corruption_index,
                                   &family);
    for (uint32_t index = 0u; index < R56_MAX_OBSERVATIONS; ++index)
        order[index] = (uint8_t)index;
    for (uint32_t index = R56_MAX_OBSERVATIONS - 1u; index > 0u; --index) {
        uint32_t selected = (uint32_t)(r56_event_key(order_seed,
            order_slot, index, 2u, 0u, 0u) % (index + 1u));
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
        uint8_t clean = universe->semantic[truth].table[input];
        uint8_t state = r56_channel_state(&family,
            corruption_seed ^ r56_mix64(episode_nonce), sensor, input, clean,
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

static uint32_t r56_mark_source_classes(const r56_universe *universe,
                                        uint64_t source_seed,
                                        uint8_t used[R56_SEMANTIC_CLASSES]) {
    uint32_t count = 0u;
    memset(used, 0, R56_SEMANTIC_CLASSES);
    for (uint32_t index = 0u; index < R56_SOURCE_PROGRAM_COUNT; ++index) {
        uint8_t token[R56_PROGRAM_DEPTH];
        uint32_t syntax;
        uint16_t semantic;
        r56_generate_source_program(source_seed, index, token);
        syntax = ((uint32_t)token[0] * R56_PRIMITIVES + token[1]) *
                 R56_PRIMITIVES + token[2];
        semantic = universe->syntax_to_semantic[syntax];
        if (!used[semantic]) {
            used[semantic] = 1u;
            count += 1u;
        }
    }
    return count;
}

static int r56_select_classes(uint64_t seed, uint32_t desired,
                              uint16_t lower, uint16_t upper,
                              uint8_t used[R56_SEMANTIC_CLASSES],
                              uint16_t *selected, uint32_t *rejections) {
    uint32_t accepted = 0u;
    uint32_t counter = 0u;
    uint32_t width;
    if (!selected || !rejections || lower > upper ||
        upper >= R56_SEMANTIC_CLASSES)
        return 1;
    width = (uint32_t)upper - lower + 1u;
    while (accepted < desired && counter < 1000000u) {
        uint16_t semantic = (uint16_t)(lower +
            r56_event_key(seed, counter, 56u, 2u, 0u, 0u) % width);
        counter += 1u;
        if (used[semantic]) {
            *rejections += 1u;
            continue;
        }
        used[semantic] = 1u;
        selected[accepted++] = semantic;
    }
    return accepted == desired ? 0 : 2;
}

static int r56_select_development_classes(
    uint8_t used[R56_SEMANTIC_CLASSES],
    uint16_t selected[R56_DEVELOPMENT_PROGRAM_FAMILIES],
    uint32_t *rejections) {
    static const uint16_t anchors[R56_DEVELOPMENT_PROGRAM_FAMILIES] = {
        165u, 48u, 107u, 418u, 127u, 417u, 391u, 407u
    };
    if (!used || !selected || !rejections) return 1;
    for (uint32_t index = 0u; index < R56_DEVELOPMENT_PROGRAM_FAMILIES;
         ++index) {
        uint16_t candidate = anchors[index];
        if (used[candidate]) {
            *rejections += 1u;
            return 1;
        }
        used[candidate] = 1u;
        selected[index] = candidate;
    }
    return 0;
}

static double r56_probability_sum(const double *probability) {
    double total = 0.0;
    for (uint32_t index = 0u; index < R56_SEMANTIC_CLASSES; ++index)
        total += probability[index];
    return total;
}

static int r56_normalize_scores(
    const int64_t score_q20[R56_SEMANTIC_CLASSES],
    double probability[R56_SEMANTIC_CLASSES]) {
    int64_t maximum = INT64_MIN;
    double normalizer = 0.0;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        if (score_q20[semantic] > maximum) maximum = score_q20[semantic];
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        double weight = exp((double)(score_q20[semantic] - maximum) /
                            (double)R56_Q20_ONE);
        probability[semantic] = weight;
        normalizer += weight;
    }
    if (!(normalizer > 0.0) || !isfinite(normalizer)) return 1;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic)
        probability[semantic] /= normalizer;
    return 0;
}

static int r56_oracle_posterior(
    const r56_artifact *artifact, const r56_universe *universe,
    const r56_ranker_view *view, const r56_corruption_family *family,
    uint64_t corruption_seed, uint32_t episode_nonce, uint16_t truth,
    int clean_oracle, double probability[R56_SEMANTIC_CLASSES],
    int64_t score_q20[R56_SEMANTIC_CLASSES], uint32_t *reads) {
    if (!artifact || !r56_universe_shape_valid(universe) || !view || !family ||
        truth >= R56_SEMANTIC_CLASSES || !probability || !score_q20 || !reads)
        return 1;
    *reads = 0u;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        int64_t score = artifact->class_log_q20[semantic];
        uint32_t mismatch = 0u;
        uint8_t previous_state = 0u;
        *reads += 1u;
        if (clean_oracle) {
            mismatch = semantic == truth ? 0u : R56_MODULUS;
        } else {
            for (uint32_t position = 0u; position < view->observation_count;
                 ++position) {
                const r56_public_observation *item = &view->observations[position];
                uint8_t clean = universe->semantic[semantic].table[item->input];
                uint8_t state = r56_channel_state(family,
                    corruption_seed ^ r56_mix64(episode_nonce), item->sensor,
                    item->input, clean, previous_state, position);
                int missing = state == R56_MODULUS;
                uint8_t observed = missing ? 0u :
                    r56_mod((int32_t)clean + state);
                mismatch += missing != item->missing ||
                            observed != item->observed;
                previous_state = state;
            }
        }
        score -= (int64_t)mismatch * 8 * R56_Q20_ONE;
        score_q20[semantic] = (score * R56_Q20_ONE) /
                              artifact->temperature_q20;
    }
    return r56_normalize_scores(score_q20, probability);
}

static uint32_t r56_truth_rank(
    const double probability[R56_SEMANTIC_CLASSES], uint16_t truth) {
    uint16_t order[R56_SEMANTIC_CLASSES];
    r56_probability_order(probability, order);
    for (uint32_t rank = 0u; rank < R56_SEMANTIC_CLASSES; ++rank)
        if (order[rank] == truth) return rank + 1u;
    return 0u;
}

static double r56_brier_score(
    const double probability[R56_SEMANTIC_CLASSES], uint16_t truth) {
    double score = 0.0;
    for (uint32_t semantic = 0u; semantic < R56_SEMANTIC_CLASSES; ++semantic) {
        double expected = semantic == truth ? 1.0 : 0.0;
        double difference = probability[semantic] - expected;
        score += difference * difference;
    }
    return score;
}

static void r56_backoff_counts(const r56_artifact *artifact,
                               const r56_universe *universe,
                               const r56_ranker_view *view, uint16_t truth,
                               uint32_t local[4], uint32_t transition[4]) {
    uint8_t previous_sensor = 0u;
    uint8_t previous_state = 0u;
    memset(local, 0, 4u * sizeof(local[0]));
    memset(transition, 0, 4u * sizeof(transition[0]));
    for (uint32_t position = 0u; position < view->observation_count; ++position) {
        const r56_public_observation *item = &view->observations[position];
        uint8_t clean = universe->semantic[truth].table[item->input];
        uint8_t state = r56_observation_state(item, clean);
        local[r56_local_backoff_level(artifact, item->sensor, item->input,
                                      clean)] += 1u;
        if (position > 0u)
            transition[r56_transition_backoff_level(artifact, previous_sensor,
                item->sensor, previous_state)] += 1u;
        previous_sensor = item->sensor;
        previous_state = state;
    }
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

static const char *r56_arm_name(r56_arm arm, char buffer[32]) {
    switch (arm) {
        case R56_ARM_FULL: return "full";
        case R56_ARM_ROBUST_HAMMING: return "robust_hamming";
        case R56_ARM_TARGET_ONLY: return "target_only";
        case R56_ARM_SOURCE_FREE: return "source_free";
        case R56_ARM_SOURCE_ABLATION: return "source_ablation";
        case R56_ARM_ONE_TRIM: return "one_trim";
        case R56_ARM_MARKOV_OFF: return "markov_off";
        case R56_ARM_SHUFFLED_SENSOR: return "shuffled_sensor";
        case R56_ARM_VALUE_ONLY: return "value_only";
        case R56_ARM_MASK_ONLY: return "mask_only";
        case R56_ARM_PROGRAM_PRIOR_ONLY: return "program_prior_only";
        case R56_ARM_CHANNEL_ONLY: return "channel_only";
        case R56_ARM_ORACLE_CHANNEL: return "oracle_channel";
        case R56_ARM_CLEAN_ORACLE: return "clean_oracle";
        default:
            if (arm >= R56_ARM_DERANGEMENT_00 &&
                arm <= R56_ARM_DERANGEMENT_30) {
                snprintf(buffer, 32u, "derangement_%02u",
                    (unsigned)arm - R56_ARM_DERANGEMENT_00);
                return buffer;
            }
            return "invalid";
    }
}

static void r56_fill_development_arms(r56_arm arms[R56_DEVELOPMENT_ARMS]) {
    static const r56_arm fixed[] = {
        R56_ARM_FULL, R56_ARM_ROBUST_HAMMING, R56_ARM_TARGET_ONLY,
        R56_ARM_SOURCE_FREE, R56_ARM_SOURCE_ABLATION, R56_ARM_ONE_TRIM,
        R56_ARM_MARKOV_OFF, R56_ARM_SHUFFLED_SENSOR, R56_ARM_VALUE_ONLY,
        R56_ARM_MASK_ONLY, R56_ARM_CHANNEL_ONLY, R56_ARM_PROGRAM_PRIOR_ONLY,
        R56_ARM_ORACLE_CHANNEL, R56_ARM_CLEAN_ORACLE
    };
    uint32_t cursor = 0u;
    for (uint32_t index = 0u; index < sizeof(fixed) / sizeof(fixed[0]); ++index)
        arms[cursor++] = fixed[index];
    for (uint32_t index = 0u; index < R56_DERANGEMENT_COUNT; ++index)
        arms[cursor++] = (r56_arm)(R56_ARM_DERANGEMENT_00 + index);
}

static int r56_append(char *buffer, size_t capacity, size_t *length,
                      const char *format, ...) {
    int added;
    va_list arguments;
    if (*length >= capacity) return 1;
    va_start(arguments, format);
    added = vsnprintf(buffer + *length, capacity - *length, format, arguments);
    va_end(arguments);
    if (added < 0 || (size_t)added >= capacity - *length) return 1;
    *length += (size_t)added;
    return 0;
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

#if 0
static int r56_run_development_legacy(r56_development_result *result,
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

#endif

static int r56_compare_u32(const void *left, const void *right) {
    uint32_t a = *(const uint32_t *)left;
    uint32_t b = *(const uint32_t *)right;
    return a < b ? -1 : a > b;
}

static int r56_self_test_schema(void);

int r56_run_development(r56_development_result *result,
                        const char *trace_path, const char *artifact_path) {
    r56_arm arms[R56_DEVELOPMENT_ARMS];
    r56_universe *universe = NULL;
    r56_artifact *artifact = NULL;
    r56_artifact *roundtrip = NULL;
    r56_ranker_view *fit_views = NULL;
    r56_ranker_view *coverage_views = NULL;
    uint16_t *fit_truth = NULL;
    uint16_t *coverage_truth = NULL;
    uint16_t fit_classes[R56_CALIBRATION_FIT_FAMILIES];
    uint16_t coverage_classes[R56_CALIBRATION_COVERAGE_FAMILIES];
    uint16_t development_classes[R56_DEVELOPMENT_PROGRAM_FAMILIES];
    uint8_t used[R56_SEMANTIC_CLASSES];
    uint32_t target_costs[R56_DEVELOPMENT_EPISODES];
    uint32_t source_class_count;
    uint32_t split_rejections = 0u;
    uint32_t order_template_count[8][8];
    uint64_t trace_digest = UINT64_C(1469598103934665603) ^ 5606u;
    FILE *trace = NULL;
    int status = 1;
    size_t fit_episode_count = (size_t)R56_CALIBRATION_FIT_FAMILIES *
                               R56_CALIBRATION_DRAWS;
    size_t coverage_episode_count =
        (size_t)R56_CALIBRATION_COVERAGE_FAMILIES * R56_CALIBRATION_DRAWS;

    if (!result || !trace_path || !artifact_path) return 1;
    memset(result, 0, sizeof(*result));
    memset(order_template_count, 0, sizeof(order_template_count));
    r56_fill_development_arms(arms);
    universe = (r56_universe *)malloc(sizeof(*universe));
    artifact = (r56_artifact *)malloc(sizeof(*artifact));
    roundtrip = (r56_artifact *)malloc(sizeof(*roundtrip));
    fit_views = (r56_ranker_view *)calloc(fit_episode_count,
                                         sizeof(*fit_views));
    coverage_views = (r56_ranker_view *)calloc(coverage_episode_count,
                                              sizeof(*coverage_views));
    fit_truth = (uint16_t *)calloc(fit_episode_count, sizeof(*fit_truth));
    coverage_truth = (uint16_t *)calloc(coverage_episode_count,
                                       sizeof(*coverage_truth));
    if (!universe || !artifact || !roundtrip || !fit_views ||
        !coverage_views || !fit_truth || !coverage_truth) {
        status = 2;
        goto cleanup;
    }
    if (r56_build_universe(universe) != 0 ||
        r56_build_artifact(artifact, universe, UINT64_C(0x56010001),
                           UINT64_C(0x56020002)) != 0) {
        status = 3;
        goto cleanup;
    }
    source_class_count = r56_mark_source_classes(
        universe, UINT64_C(0x56010001), used);
    if (r56_select_classes(UINT64_C(0x56ca1100),
            R56_CALIBRATION_FIT_FAMILIES, 64u,
            R56_SEMANTIC_CLASSES - 1u, used, fit_classes,
            &split_rejections) != 0 ||
        r56_select_classes(UINT64_C(0x56cb1100),
            R56_CALIBRATION_COVERAGE_FAMILIES, 64u,
            R56_SEMANTIC_CLASSES - 1u, used, coverage_classes,
            &split_rejections) != 0 ||
        r56_select_development_classes(used, development_classes,
                                       &split_rejections) != 0) {
        status = 4;
        goto cleanup;
    }
    for (uint32_t family = 0u;
         family < R56_CALIBRATION_FIT_FAMILIES; ++family) {
        for (uint32_t draw = 0u; draw < R56_CALIBRATION_DRAWS; ++draw) {
            uint32_t episode = family * R56_CALIBRATION_DRAWS + draw;
            fit_truth[episode] = fit_classes[family];
            r56_generate_view(UINT64_C(0x56ca1200),
                UINT64_C(0x56ca1300), episode, (family + draw) % 8u,
                fit_classes[family], draw + 8u * family, universe,
                &fit_views[episode]);
        }
    }
    for (uint32_t family = 0u;
         family < R56_CALIBRATION_COVERAGE_FAMILIES; ++family) {
        for (uint32_t draw = 0u; draw < R56_CALIBRATION_DRAWS; ++draw) {
            uint32_t episode = family * R56_CALIBRATION_DRAWS + draw;
            coverage_truth[episode] = coverage_classes[family];
            r56_generate_view(UINT64_C(0x56cb1200),
                UINT64_C(0x56cb1300), episode, (family + draw) % 8u,
                coverage_classes[family], draw + 8u * (family + 1000u),
                universe, &coverage_views[episode]);
        }
    }
    if (r56_calibrate(artifact, universe, fit_views, fit_truth,
            R56_CALIBRATION_FIT_FAMILIES, coverage_views, coverage_truth,
            R56_CALIBRATION_COVERAGE_FAMILIES,
            R56_CALIBRATION_DRAWS) != 0 ||
        r56_write_artifact(artifact_path, artifact) != 0 ||
        r56_read_artifact(artifact_path, roundtrip) != 0) {
        status = 5;
        goto cleanup;
    }
    result->calibration_coverage_record_count =
        R56_CALIBRATION_COVERAGE_FAMILIES;
    for (uint32_t family = 0u;
         family < R56_CALIBRATION_COVERAGE_FAMILIES; ++family) {
        double worst_mass = 0.0;
        uint32_t all_draws_covered = 1u;
        for (uint32_t draw = 0u; draw < R56_CALIBRATION_DRAWS; ++draw) {
            uint32_t episode = family * R56_CALIBRATION_DRAWS + draw;
            double probability[R56_SEMANTIC_CLASSES];
            int64_t score[R56_SEMANTIC_CLASSES];
            uint8_t included[R56_SEMANTIC_CLASSES];
            uint32_t reads;
            double mass;
            if (r56_posterior(artifact, universe, &coverage_views[episode],
                    R56_ARM_FULL, probability, score, &reads) != 0 ||
                r56_candidate_set(probability,
                    (double)artifact->conformal_mass_q20 /
                        (double)R56_Q20_ONE, included) == 0u) {
                status = 5;
                goto cleanup;
            }
            mass = r56_truth_cumulative(probability,
                                        coverage_truth[episode]);
            if (mass > worst_mass) worst_mass = mass;
            if (!included[coverage_truth[episode]])
                all_draws_covered = 0u;
        }
        result->calibration_coverage_classes[family] =
            coverage_classes[family];
        result->calibration_coverage_worst_mass_q20[family] =
            (uint32_t)ceil(worst_mass * (double)R56_Q20_ONE);
        if (result->calibration_coverage_worst_mass_q20[family] >
            R56_Q20_ONE)
            result->calibration_coverage_worst_mass_q20[family] =
                R56_Q20_ONE;
        result->calibration_coverage_family_covered[family] =
            all_draws_covered;
    }
    result->artifact_roundtrip_valid =
        roundtrip->artifact_digest == artifact->artifact_digest;
    trace = fopen(trace_path, "wb");
    if (!trace) {
        status = 6;
        goto cleanup;
    }

    for (uint32_t program = 0u;
         program < R56_DEVELOPMENT_PROGRAM_FAMILIES; ++program) {
        for (uint32_t mechanism = 0u;
             mechanism < R56_DEVELOPMENT_CORRUPTION_FAMILIES; ++mechanism) {
            for (uint32_t repeat = 0u; repeat < R56_DEVELOPMENT_REPEATS;
                 ++repeat) {
                uint32_t episode = ((program *
                    R56_DEVELOPMENT_CORRUPTION_FAMILIES) + mechanism) *
                    R56_DEVELOPMENT_REPEATS + repeat;
                uint32_t corruption_index = mechanism + 8u *
                    (repeat + R56_DEVELOPMENT_REPEATS * program + 2000u);
                uint32_t order_slot = (program + mechanism + repeat) % 8u;
                uint16_t truth = development_classes[program];
                r56_ranker_view view;
                r56_corruption_family family;
                double source_free_probability[R56_SEMANTIC_CLASSES];
                int64_t source_free_score[R56_SEMANTIC_CLASSES];
                r56_search_result source_free_search;
                uint32_t source_free_reads = 1u;
                uint32_t local_backoff[4];
                uint32_t transition_backoff[4];
                r56_generate_corruption_family(UINT64_C(0x56de0002),
                                               corruption_index, &family);
                r56_generate_view(UINT64_C(0x56de0002),
                    UINT64_C(0x56de0003), episode, order_slot, truth,
                    corruption_index, universe, &view);
                order_template_count[order_slot][mechanism] += 1u;
                r56_backoff_counts(artifact, universe, &view, truth,
                                   local_backoff, transition_backoff);
                {
                    r56_public_node root;
                    r56_public_node array;
                    r56_public_node observations[R56_MAX_OBSERVATIONS];
                    r56_public_node leaves[R56_MAX_OBSERVATIONS * 4u];
                    if (r56_make_public_tree(&view, &root, &array,
                            observations, leaves) != 0 ||
                        r56_validate_ranker_tree(&root) != 0) {
                        status = 7;
                        goto cleanup;
                    }
                }
                for (uint32_t arm_index = 0u;
                     arm_index < R56_DEVELOPMENT_ARMS; ++arm_index) {
                    r56_arm arm = arms[arm_index];
                    double probability[R56_SEMANTIC_CLASSES];
                    int64_t score[R56_SEMANTIC_CLASSES];
                    uint16_t order[R56_SEMANTIC_CLASSES];
                    uint16_t proposals[R56_PROPOSAL_BUDGET];
                    uint16_t injected;
                    r56_search_result search;
                    r56_certificate certificate;
                    uint32_t reads = 0u;
                    uint32_t truth_rank;
                    uint32_t candidate_set_size;
                    uint8_t candidate_set[R56_SEMANTIC_CLASSES];
                    double sum;
                    double truth_probability;
                    double normalized_log_loss;
                    double brier;
                    char arm_buffer[32];
                    const char *arm_name = r56_arm_name(arm, arm_buffer);
                    char line[8192];
                    size_t length = 0u;
                    int posterior_status;
                    if (arm == R56_ARM_ORACLE_CHANNEL ||
                        arm == R56_ARM_CLEAN_ORACLE) {
                        posterior_status = r56_oracle_posterior(artifact,
                            universe, &view, &family,
                            UINT64_C(0x56de0002), episode, truth,
                            arm == R56_ARM_CLEAN_ORACLE, probability, score,
                            &reads);
                    } else {
                        const r56_artifact *ranker_artifact =
                            (arm == R56_ARM_TARGET_ONLY ||
                             arm == R56_ARM_SOURCE_FREE ||
                             arm == R56_ARM_SOURCE_ABLATION) ? NULL : artifact;
                        posterior_status = r56_posterior(ranker_artifact,
                            universe, &view, arm, probability, score, &reads);
                    }
                    if (posterior_status != 0) {
                        status = 8;
                        goto cleanup;
                    }
                    sum = r56_probability_sum(probability);
                    if (fabs(sum - 1.0) <= 1e-12)
                        result->normalized_rows += 1u;
                    truth_rank = r56_truth_rank(probability, truth);
                    truth_probability = probability[truth];
                    normalized_log_loss = r56_score_log_loss(score, truth) /
                        log((double)R56_SEMANTIC_CLASSES);
                    if (!isfinite(normalized_log_loss) ||
                        normalized_log_loss < 0.0) {
                        status = 9;
                        goto cleanup;
                    }
                    brier = r56_brier_score(probability, truth);
                    candidate_set_size = r56_candidate_set(probability,
                        (double)artifact->conformal_mass_q20 /
                        (double)R56_Q20_ONE, candidate_set);
                    if (candidate_set_size == 0u) {
                        status = 9;
                        goto cleanup;
                    }
                    if (arm == R56_ARM_FULL) {
                        result->candidate_set_rows += 1u;
                        result->candidate_set_truth_covered +=
                            candidate_set[truth] != 0u;
                        result->candidate_set_total_size += candidate_set_size;
                        result->full_mean_normalized_log_loss +=
                            normalized_log_loss;
                        result->full_mean_brier += brier;
                    }
                    r56_probability_order(probability, order);
                    injected = order[0] == truth ? order[1] : order[0];
                    proposals[0] = injected;
                    {
                        uint32_t cursor = 1u;
                        for (uint32_t rank = 0u;
                             rank < R56_SEMANTIC_CLASSES &&
                             cursor < R56_PROPOSAL_BUDGET; ++rank)
                            if (order[rank] != injected)
                                proposals[cursor++] = order[rank];
                        if (cursor != R56_PROPOSAL_BUDGET) {
                            status = 10;
                            goto cleanup;
                        }
                    }
                    if (r56_verified_search(universe,
                            universe->semantic[truth].table, proposals,
                            R56_PROPOSAL_BUDGET, R56_GLOBAL_CAP, injected,
                            &search) != 0 || !search.solved ||
                        !r56_verify_semantic_class(universe,
                            (uint16_t)search.accepted_class,
                            universe->semantic[truth].table, &certificate)) {
                        status = 11;
                        goto cleanup;
                    }
                    result->trace_rows += 1u;
                    result->exact_rows += search.certificate_valid;
                    result->fallback_rows += search.fallback_started;
                    result->invalid_first_rejections +=
                        search.invalid_first_rejected;
                    if (arm == R56_ARM_TARGET_ONLY)
                        target_costs[episode] = search.primary_cost;
                    if (arm == R56_ARM_SOURCE_FREE) {
                        memcpy(source_free_probability, probability,
                               sizeof(source_free_probability));
                        memcpy(source_free_score, score,
                               sizeof(source_free_score));
                        source_free_search = search;
                        source_free_reads = reads;
                    } else if (arm == R56_ARM_SOURCE_ABLATION &&
                        source_free_reads == 0u && reads == 0u &&
                        memcmp(source_free_probability, probability,
                               sizeof(source_free_probability)) == 0 &&
                        memcmp(source_free_score, score,
                               sizeof(source_free_score)) == 0 &&
                        memcmp(&source_free_search, &search,
                               sizeof(search)) == 0) {
                        result->source_ablation_matches += 1u;
                    }
                    if (r56_append(line, sizeof(line), &length,
                        "{\"schema\":\"zero.reasoner56_native_trace.v3\","
                        "\"experiment\":\"reasoner56-passive-noise-development-v1\","
                        "\"lane\":\"development\",\"generator_id\":\"r56-gf17-v2\","
                        "\"family_id\":\"program-%u\","
                        "\"cross_family_id\":\"mechanism-%u\","
                        "\"program_family_id\":\"program-%u\","
                        "\"corruption_family_id\":\"mechanism-%u\","
                        "\"nested_repeat_id\":\"draw-%u\","
                        "\"episode_id\":\"dev-p%u-m%u-r%u\","
                        "\"shift_stratum\":\"primary-id-development\","
                        "\"mechanism_id\":%u,\"parameter_draw\":%u,"
                        "\"order_slot\":%u,\"corruption_index\":%u,"
                        "\"truth_class\":%u,\"arm\":\"%s\","
                        "\"exact\":true,\"certificate_valid\":true,"
                        "\"premature_commit\":false,\"primary_cost\":%u,"
                        "\"verifier_checks\":%u,"
                        "\"proposal_verifier_checks\":%u,"
                        "\"partial_expansions\":%u,"
                        "\"fallback_verifier_checks\":%u,"
                        "\"fallback_partial_expansions\":%u,"
                        "\"observation_queries\":%u,"
                        "\"observations_consumed\":%u,"
                        "\"fallback_started\":%s,\"global_cap_hit\":false,"
                        "\"injected_invalid_rejected\":true,"
                        "\"source_artifact_reads\":%u,"
                        "\"accepted_class\":%u,"
                        "\"certificate_table_digest\":\"%016llx\","
                        "\"probability_sum\":%.17g,\"truth_rank\":%u,"
                        "\"top_one_truth\":%s,\"truth_probability\":%.17g,"
                        "\"normalized_log_loss\":%.17g,\"brier\":%.17g,"
                        "\"candidate_set_size\":%u,"
                        "\"candidate_set_contains_truth\":%s,"
                        "\"candidate_universe_count\":%u,"
                        "\"candidate_universe_digest\":\"%016llx\","
                        "\"initial_evidence_digest\":\"%016llx\","
                        "\"verifier_digest\":\"%016llx\","
                        "\"artifact_digest\":\"%016llx\","
                        "\"local_backoff_counts\":[%u,%u,%u,%u],"
                        "\"transition_backoff_counts\":[%u,%u,%u,%u],"
                        "\"proposal_classes\":[",
                        program, mechanism, program, mechanism, repeat,
                        program, mechanism, repeat, mechanism, repeat,
                        order_slot, corruption_index, truth, arm_name,
                        search.primary_cost, search.verifier_checks,
                        search.proposal_verifier_checks,
                        search.partial_expansions,
                        search.fallback_verifier_checks,
                        search.fallback_partial_expansions,
                        view.observation_count,
                        view.observation_count,
                        search.fallback_started ? "true" : "false", reads,
                        search.accepted_class,
                        (unsigned long long)certificate.table_digest, sum,
                        truth_rank, truth_rank == 1u ? "true" : "false",
                        truth_probability, normalized_log_loss, brier,
                        candidate_set_size,
                        candidate_set[truth] ? "true" : "false",
                        R56_SEMANTIC_CLASSES,
                        (unsigned long long)r56_universe_digest(universe),
                        (unsigned long long)r56_public_view_digest(&view),
                        (unsigned long long)r56_verifier_digest(universe),
                        (unsigned long long)artifact->artifact_digest,
                        local_backoff[0], local_backoff[1], local_backoff[2],
                        local_backoff[3], transition_backoff[0],
                        transition_backoff[1], transition_backoff[2],
                        transition_backoff[3]) != 0) {
                        status = 12;
                        goto cleanup;
                    }
                    for (uint32_t index = 0u; index < R56_PROPOSAL_BUDGET;
                         ++index)
                        if (r56_append(line, sizeof(line), &length,
                                "%s%u", index ? "," : "", proposals[index]) != 0) {
                            status = 12;
                            goto cleanup;
                        }
                    if (r56_append(line, sizeof(line), &length,
                                   "],\"observations\":[") != 0) {
                        status = 12;
                        goto cleanup;
                    }
                    for (uint32_t index = 0u;
                         index < view.observation_count; ++index) {
                        const r56_public_observation *item =
                            &view.observations[index];
                        if (r56_append(line, sizeof(line), &length,
                            "%s{\"input\":%u,\"sensor\":%u,"
                            "\"observed\":%u,\"missing\":%s}",
                            index ? "," : "", item->input, item->sensor,
                            item->observed,
                            item->missing ? "true" : "false") != 0) {
                            status = 12;
                            goto cleanup;
                        }
                    }
                    if (r56_append(line, sizeof(line), &length, "]}\n") != 0 ||
                        fwrite(line, 1u, length, trace) != length) {
                        status = 12;
                        goto cleanup;
                    }
                    trace_digest = r56_hash_update(trace_digest, line, length);
                }
            }
        }
    }
    if (fclose(trace) != 0) {
        trace = NULL;
        status = 13;
        goto cleanup;
    }
    trace = NULL;
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
    result->source_semantic_classes = source_class_count;
    result->calibration_fit_families = R56_CALIBRATION_FIT_FAMILIES;
    result->calibration_coverage_families =
        R56_CALIBRATION_COVERAGE_FAMILIES;
    result->development_program_families =
        R56_DEVELOPMENT_PROGRAM_FAMILIES;
    result->development_corruption_families =
        R56_DEVELOPMENT_CORRUPTION_FAMILIES;
    result->nested_repeats = R56_DEVELOPMENT_REPEATS;
    result->split_rejections = split_rejections;
    result->development_class_count = R56_DEVELOPMENT_PROGRAM_FAMILIES;
    memcpy(result->development_classes, development_classes,
           sizeof(development_classes));
    result->full_mean_normalized_log_loss /= R56_DEVELOPMENT_EPISODES;
    result->full_mean_brier /= R56_DEVELOPMENT_EPISODES;
    qsort(target_costs, R56_DEVELOPMENT_EPISODES,
          sizeof(target_costs[0]), r56_compare_u32);
    result->target_only_min_cost = target_costs[0];
    result->target_only_max_cost =
        target_costs[R56_DEVELOPMENT_EPISODES - 1u];
    result->target_only_median_cost =
        ((double)target_costs[R56_DEVELOPMENT_EPISODES / 2u - 1u] +
         (double)target_costs[R56_DEVELOPMENT_EPISODES / 2u]) / 2.0;
    result->hidden_field_rejections = r56_self_test_schema() == 0 ? 2u : 0u;
    {
        uint32_t expected = R56_DEVELOPMENT_PROGRAM_FAMILIES *
                            R56_DEVELOPMENT_REPEATS / 8u;
        result->proxy_audit_passed = 1u;
        for (uint32_t order_slot = 0u; order_slot < 8u; ++order_slot)
            for (uint32_t mechanism = 0u; mechanism < 8u; ++mechanism)
                if (order_template_count[order_slot][mechanism] != expected)
                    result->proxy_audit_passed = 0u;
    }
    {
        r56_ranker_view view;
        r56_artifact changed = *artifact;
        double first_probability[R56_SEMANTIC_CLASSES];
        double second_probability[R56_SEMANTIC_CLASSES];
        int64_t first_score[R56_SEMANTIC_CLASSES];
        int64_t second_score[R56_SEMANTIC_CLASSES];
        uint32_t first_reads = 1u;
        uint32_t second_reads = 1u;
        changed.version = 0u;
        changed.temperature_q20 = 0;
        r56_generate_view(UINT64_C(0x56de0002), UINT64_C(0x56de0003),
            0u, 0u, development_classes[0], 16000u, universe, &view);
        result->taint_audit_passed =
            r56_posterior(NULL, universe, &view, R56_ARM_SOURCE_FREE,
                first_probability, first_score, &first_reads) == 0 &&
            r56_posterior(&changed, universe, &view, R56_ARM_SOURCE_FREE,
                second_probability, second_score, &second_reads) == 0 &&
            first_reads == 0u && second_reads == 0u &&
            memcmp(first_probability, second_probability,
                   sizeof(first_probability)) == 0 &&
            memcmp(first_score, second_score, sizeof(first_score)) == 0;
    }
    if (result->trace_rows != R56_DEVELOPMENT_EPISODES *
                              R56_DEVELOPMENT_ARMS ||
        result->exact_rows != result->trace_rows ||
        result->normalized_rows != result->trace_rows ||
        result->source_ablation_matches != R56_DEVELOPMENT_EPISODES ||
        result->invalid_first_rejections != result->trace_rows ||
        result->artifact_roundtrip_valid != 1u ||
        result->calibration_fit_episodes != R56_CALIBRATION_FIT_FAMILIES ||
        result->calibration_coverage_episodes !=
            R56_CALIBRATION_COVERAGE_FAMILIES ||
        result->calibration_coverage_record_count !=
            R56_CALIBRATION_COVERAGE_FAMILIES ||
        result->target_only_median_cost < 16.0 ||
        !result->proxy_audit_passed || !result->taint_audit_passed) {
        status = 14;
        goto cleanup;
    }
    for (uint32_t family = 0u;
         family < R56_CALIBRATION_COVERAGE_FAMILIES; ++family) {
        if (!result->calibration_coverage_family_covered[family] ||
            result->calibration_coverage_classes[family] !=
                coverage_classes[family] ||
            result->calibration_coverage_worst_mass_q20[family] == 0u ||
            result->calibration_coverage_worst_mass_q20[family] >
                R56_Q20_ONE) {
            status = 14;
            goto cleanup;
        }
    }
    status = 0;

cleanup:
    if (trace) fclose(trace);
    free(universe);
    free(artifact);
    free(roundtrip);
    free(fit_views);
    free(coverage_views);
    free(fit_truth);
    free(coverage_truth);
    return status;
}

int r56_write_development_result(const char *path,
                                 const r56_development_result *result) {
    FILE *file;
    int ok = 1;
    if (!path || !result) return 1;
    file = fopen(path, "wb");
    if (!file) return 2;
    if (fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner56_development_result.v4\",\n"
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
        "  \"candidate_set_total_size\": %u,\n"
        "  \"source_semantic_classes\": %u,\n"
        "  \"calibration_fit_families\": %u,\n"
        "  \"calibration_coverage_families\": %u,\n"
        "  \"development_program_families\": %u,\n"
        "  \"development_corruption_families\": %u,\n"
        "  \"nested_repeats\": %u,\n"
        "  \"split_rejections\": %u,\n"
        "  \"proxy_audit_passed\": %s,\n"
        "  \"taint_audit_passed\": %s,\n"
        "  \"target_only_min_cost\": %u,\n"
        "  \"target_only_max_cost\": %u,\n"
        "  \"target_only_median_cost\": %.17g,\n"
        "  \"full_mean_normalized_log_loss\": %.17g,\n"
        "  \"full_mean_brier\": %.17g,\n"
        "  \"development_classes\": [",
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
        result->candidate_set_total_size,
        result->source_semantic_classes,
        result->calibration_fit_families,
        result->calibration_coverage_families,
        result->development_program_families,
        result->development_corruption_families,
        result->nested_repeats, result->split_rejections,
        result->proxy_audit_passed ? "true" : "false",
        result->taint_audit_passed ? "true" : "false",
        result->target_only_min_cost, result->target_only_max_cost,
        result->target_only_median_cost,
        result->full_mean_normalized_log_loss,
        result->full_mean_brier) < 0)
        ok = 0;
    for (uint32_t index = 0u;
         ok && index < result->development_class_count; ++index)
        if (fprintf(file, "%s%u", index ? ", " : "",
                    result->development_classes[index]) < 0)
            ok = 0;
    if (ok && fprintf(file, "],\n  \"calibration_coverage_records\": [\n") < 0)
        ok = 0;
    for (uint32_t index = 0u;
         ok && index < result->calibration_coverage_record_count; ++index) {
        if (fprintf(file,
            "    %s{\"family_index\": %u, \"semantic_class\": %u, "
            "\"draws\": %u, \"worst_truth_cumulative_mass_q20\": %u, "
            "\"all_draws_covered\": %s}\n",
            index ? "," : "", index,
            result->calibration_coverage_classes[index],
            R56_CALIBRATION_DRAWS,
            result->calibration_coverage_worst_mass_q20[index],
            result->calibration_coverage_family_covered[index] ?
                "true" : "false") < 0)
            ok = 0;
    }
    if (ok && fprintf(file,
        "  ],\n"
        "  \"artifact_digest\": \"%016llx\",\n"
        "  \"trace_digest\": \"%016llx\",\n"
        "  \"calibration_fit_digest\": \"%016llx\",\n"
        "  \"calibration_coverage_digest\": \"%016llx\"\n"
        "}\n",
        (unsigned long long)result->artifact_digest,
        (unsigned long long)result->trace_digest,
        (unsigned long long)result->calibration_fit_digest,
        (unsigned long long)result->calibration_coverage_digest) < 0)
        ok = 0;
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
            fit_truth[index] = (uint16_t)index;
            coverage_truth[index] = (uint16_t)(index + 8u);
            r56_generate_view(UINT64_C(0x56ca1100),
                              UINT64_C(0x56ca1200), index, index,
                              fit_truth[index], index, universe,
                              &fit_views[index]);
            r56_generate_view(UINT64_C(0x56cb1100),
                              UINT64_C(0x56cb1200), index, index,
                              coverage_truth[index], index + 8u, universe,
                              &coverage_views[index]);
        }
        if (r56_calibrate(second, universe,
                          fit_views, fit_truth, 8u,
                          coverage_views, coverage_truth, 8u, 1u) != 0 ||
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
        uint16_t truth = 16u;
        uint16_t other_truth = 17u;
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
                          0u, 0u, truth, 0u, universe, &view);
        r56_generate_view(UINT64_C(0x77de0001), UINT64_C(0x56de0002),
                          0u, 0u, other_truth, 7u, universe, &same_order);
        r56_generate_view(UINT64_C(0x56de0001), UINT64_C(0x66de0003),
                          0u, 0u, other_truth, 0u, universe,
                          &different_order);
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
        if (r56_posterior(NULL, universe, &view, R56_ARM_SOURCE_FREE,
                          source_free, source_free_score, &source_reads) != 0 ||
            r56_posterior(NULL, universe, &view, R56_ARM_SOURCE_ABLATION,
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
            double rounded[R56_SEMANTIC_CLASSES] = {0.0};
            rounded[0] = 1.0;
            if (r56_candidate_set(rounded, 1.0, included) !=
                    R56_SEMANTIC_CLASSES) {
                status = 22; goto bytes_done;
            }
            for (uint32_t semantic = 0u;
                 semantic < R56_SEMANTIC_CLASSES; ++semantic) {
                if (!included[semantic]) { status = 22; goto bytes_done; }
            }
        }
        {
            int64_t dominant_score[R56_SEMANTIC_CLASSES];
            double rounded_probability[R56_SEMANTIC_CLASSES];
            double stable_loss;
            double expected_loss = log1p(exp(-72.0));
            dominant_score[0] = 0;
            dominant_score[1] = -72 * (int64_t)R56_Q20_ONE;
            for (uint32_t semantic = 2u;
                 semantic < R56_SEMANTIC_CLASSES; ++semantic)
                dominant_score[semantic] = -1000 * (int64_t)R56_Q20_ONE;
            stable_loss = r56_score_log_loss(dominant_score, 0u);
            if (r56_normalize_scores(dominant_score,
                    rounded_probability) != 0 ||
                rounded_probability[0] != 1.0 || !(stable_loss > 0.0) ||
                fabs(stable_loss - expected_loss) > expected_loss * 1e-12) {
                status = 22; goto bytes_done;
            }
        }
        {
            r56_certificate certificate;
            uint16_t invalid = truth == 0u ? 1u : 0u;
            uint16_t proposal[1] = {invalid};
            r56_search_result capped;
            r56_search_result complete;
            r56_search_result exhausted;
            uint8_t impossible_target[R56_MODULUS];
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
                !capped.invalid_first_rejected ||
                capped.partial_expansions != 1u ||
                capped.fallback_partial_expansions != 0u ||
                capped.fallback_started) {
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
            memset(impossible_target, 255, sizeof(impossible_target));
            if (r56_verified_search(universe, impossible_target, proposal, 1u,
                    R56_SEMANTIC_CLASSES, invalid, &exhausted) != 0 ||
                exhausted.solved || exhausted.global_cap_hit ||
                !exhausted.fallback_exhausted ||
                exhausted.primary_cost != R56_SEMANTIC_CLASSES + 1u ||
                exhausted.verifier_checks != R56_SEMANTIC_CLASSES ||
                exhausted.partial_expansions != R56_SEMANTIC_CLASSES + 1u ||
                !exhausted.fallback_started ||
                !exhausted.invalid_first_rejected) {
                status = 25; goto bytes_done;
            }
        }
        {
            uint32_t saved_semantic_count = universe->semantic_count;
            r56_certificate certificate;
            uint16_t proposal[1] = {0u};
            r56_search_result search;
            universe->semantic_count = R56_SEMANTIC_CLASSES + 1u;
            if (r56_verify_semantic_class(universe, 0u,
                    universe->semantic[truth].table, &certificate) != 0 ||
                r56_verified_search(universe,
                    universe->semantic[truth].table, proposal, 1u, 1u,
                    0u, &search) == 0) {
                status = 27; goto bytes_done;
            }
            universe->semantic_count = saved_semantic_count;
        }
        for (uint32_t permutation = 0u;
             permutation < R56_DERANGEMENT_COUNT; ++permutation) {
            uint8_t seen[R56_CHANNEL_STATES] = {0};
            for (uint8_t state = 0u; state < R56_CHANNEL_STATES; ++state) {
                uint8_t mapped = r56_deranged_state(permutation, state);
                if (mapped >= R56_CHANNEL_STATES || mapped == state ||
                    seen[mapped]) {
                    status = 28; goto bytes_done;
                }
                seen[mapped] = 1u;
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
