#include "reasoner58.h"

#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uint32_t state[8];
    uint64_t bits;
    uint8_t block[64];
    size_t used;
} r58_sha256;

static uint32_t r58_rotr(uint32_t value, uint32_t count)
{
    return (value >> count) | (value << (32u - count));
}

static void r58_sha256_transform(r58_sha256 *sha, const uint8_t block[64])
{
    static const uint32_t constants[64] = {
        0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
        0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
        0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
        0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
        0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
        0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
        0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
        0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
        0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
        0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
        0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
        0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
        0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
        0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
        0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
        0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
    };
    uint32_t words[64];
    uint32_t a, b, c, d, e, f, g, h;
    size_t index;
    for (index = 0; index < 16; ++index) {
        size_t offset = index * 4;
        words[index] = ((uint32_t)block[offset] << 24) |
            ((uint32_t)block[offset + 1] << 16) |
            ((uint32_t)block[offset + 2] << 8) | block[offset + 3];
    }
    for (index = 16; index < 64; ++index) {
        uint32_t s0 = r58_rotr(words[index - 15], 7) ^
            r58_rotr(words[index - 15], 18) ^ (words[index - 15] >> 3);
        uint32_t s1 = r58_rotr(words[index - 2], 17) ^
            r58_rotr(words[index - 2], 19) ^ (words[index - 2] >> 10);
        words[index] = words[index - 16] + s0 + words[index - 7] + s1;
    }
    a = sha->state[0]; b = sha->state[1]; c = sha->state[2];
    d = sha->state[3]; e = sha->state[4]; f = sha->state[5];
    g = sha->state[6]; h = sha->state[7];
    for (index = 0; index < 64; ++index) {
        uint32_t s1 = r58_rotr(e, 6) ^ r58_rotr(e, 11) ^ r58_rotr(e, 25);
        uint32_t choose = (e & f) ^ ((~e) & g);
        uint32_t temp1 = h + s1 + choose + constants[index] + words[index];
        uint32_t s0 = r58_rotr(a, 2) ^ r58_rotr(a, 13) ^ r58_rotr(a, 22);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temp2 = s0 + majority;
        h = g; g = f; f = e; e = d + temp1;
        d = c; c = b; b = a; a = temp1 + temp2;
    }
    sha->state[0] += a; sha->state[1] += b; sha->state[2] += c;
    sha->state[3] += d; sha->state[4] += e; sha->state[5] += f;
    sha->state[6] += g; sha->state[7] += h;
}

static void r58_sha256_init(r58_sha256 *sha)
{
    static const uint32_t initial[8] = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
    };
    memcpy(sha->state, initial, sizeof(initial));
    sha->bits = 0;
    sha->used = 0;
}

static void r58_sha256_update(r58_sha256 *sha, const uint8_t *bytes,
                              size_t size)
{
    size_t offset = 0;
    sha->bits += (uint64_t)size * 8u;
    while (offset < size) {
        size_t available = 64 - sha->used;
        size_t take = size - offset < available ? size - offset : available;
        memcpy(sha->block + sha->used, bytes + offset, take);
        sha->used += take;
        offset += take;
        if (sha->used == 64) {
            r58_sha256_transform(sha, sha->block);
            sha->used = 0;
        }
    }
}

static void r58_sha256_final(r58_sha256 *sha, uint8_t digest[32])
{
    size_t index;
    sha->block[sha->used++] = 0x80u;
    if (sha->used > 56) {
        while (sha->used < 64) sha->block[sha->used++] = 0;
        r58_sha256_transform(sha, sha->block);
        sha->used = 0;
    }
    while (sha->used < 56) sha->block[sha->used++] = 0;
    for (index = 0; index < 8; ++index)
        sha->block[56 + index] = (uint8_t)(sha->bits >> (56 - 8 * index));
    r58_sha256_transform(sha, sha->block);
    for (index = 0; index < 8; ++index) {
        digest[index * 4] = (uint8_t)(sha->state[index] >> 24);
        digest[index * 4 + 1] = (uint8_t)(sha->state[index] >> 16);
        digest[index * 4 + 2] = (uint8_t)(sha->state[index] >> 8);
        digest[index * 4 + 3] = (uint8_t)sha->state[index];
    }
}

static void r58_digest(const uint8_t *bytes, size_t size, uint8_t digest[32])
{
    r58_sha256 sha;
    r58_sha256_init(&sha);
    r58_sha256_update(&sha, bytes, size);
    r58_sha256_final(&sha, digest);
}

static uint64_t r58_mix64(uint64_t value)
{
    value += UINT64_C(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

const char *r58_operation_name(uint8_t operation)
{
    static const char *names[R58_OPERATIONS] = {
        "translate-1", "translate-4", "scale-2", "scale-3",
        "negate", "square", "cube", "mixed-x2-x-1"
    };
    return operation < R58_OPERATIONS ? names[operation] : "invalid";
}

uint8_t r58_apply_operation(uint8_t operation, uint8_t value)
{
    uint32_t x = value % R58_MODULUS;
    switch (operation) {
    case R58_OP_TRANSLATE_1: return (uint8_t)((x + 1u) % R58_MODULUS);
    case R58_OP_TRANSLATE_4: return (uint8_t)((x + 4u) % R58_MODULUS);
    case R58_OP_SCALE_2: return (uint8_t)((2u * x) % R58_MODULUS);
    case R58_OP_SCALE_3: return (uint8_t)((3u * x) % R58_MODULUS);
    case R58_OP_NEGATE: return (uint8_t)((R58_MODULUS - x) % R58_MODULUS);
    case R58_OP_SQUARE: return (uint8_t)((x * x) % R58_MODULUS);
    case R58_OP_CUBE: return (uint8_t)((x * x * x) % R58_MODULUS);
    case R58_OP_MIXED: return (uint8_t)((x * x + x + 1u) % R58_MODULUS);
    default: return 0xffu;
    }
}

void r58_execute_program(const r58_program *program, r58_behavior *behavior)
{
    uint32_t input;
    for (input = 0; input < R58_MODULUS; ++input) {
        uint8_t value = (uint8_t)input;
        uint32_t step;
        for (step = 0; step < program->length; ++step)
            value = r58_apply_operation(program->operations[step], value);
        behavior->values[input] = value;
    }
}

static void r58_program_from_index(uint8_t length, uint32_t index,
                                   r58_program *program)
{
    uint32_t position;
    memset(program, 0, sizeof(*program));
    program->length = length;
    for (position = length; position > 0; --position) {
        program->operations[position - 1] = (uint8_t)(index % R58_OPERATIONS);
        index /= R58_OPERATIONS;
    }
}

int r58_enumerate_universe(r58_universe *universe)
{
    uint8_t length;
    uint32_t syntax_count = 0;
    memset(universe, 0, sizeof(*universe));
    for (length = 0; length <= R58_TARGET_MAX_DEPTH; ++length) {
        uint32_t count = 1;
        uint32_t index;
        uint32_t digit;
        for (digit = 0; digit < length; ++digit) count *= R58_OPERATIONS;
        for (index = 0; index < count; ++index) {
            r58_program program;
            r58_behavior behavior;
            uint32_t prior;
            r58_program_from_index(length, index, &program);
            r58_execute_program(&program, &behavior);
            syntax_count += 1;
            for (prior = 0; prior < universe->semantic_classes; ++prior)
                if (memcmp(universe->classes[prior].behavior.values,
                           behavior.values, R58_MODULUS) == 0)
                    break;
            if (prior == universe->semantic_classes) {
                if (prior >= R58_MAX_SEMANTIC_CLASSES) return -1;
                universe->classes[prior].canonical_program = program;
                universe->classes[prior].behavior = behavior;
                universe->classes_by_depth[length] += 1;
                universe->semantic_classes += 1;
            }
        }
    }
    universe->syntax_programs = syntax_count;
    universe->semantic_collisions = syntax_count - universe->semantic_classes;
    return syntax_count == R58_SYNTAX_PROGRAMS ? 0 : -1;
}

int r58_verify_exact(const r58_program *program, const r58_behavior *expected,
                     uint8_t *first_counterexample)
{
    r58_behavior actual;
    uint32_t input;
    r58_execute_program(program, &actual);
    for (input = 0; input < R58_MODULUS; ++input) {
        if (actual.values[input] != expected->values[input]) {
            if (first_counterexample) *first_counterexample = (uint8_t)input;
            return 0;
        }
    }
    if (first_counterexample) *first_counterexample = 0xffu;
    return 1;
}

static uint32_t r58_distinct_outputs(const r58_behavior *behavior)
{
    uint8_t seen[R58_MODULUS] = {0};
    uint32_t count = 0;
    uint32_t input;
    for (input = 0; input < R58_MODULUS; ++input) {
        uint8_t value = behavior->values[input];
        if (!seen[value]) {
            seen[value] = 1;
            count += 1;
        }
    }
    return count;
}

static uint32_t r58_fixed_points(const r58_behavior *behavior)
{
    uint32_t input;
    uint32_t count = 0;
    for (input = 0; input < R58_MODULUS; ++input)
        count += behavior->values[input] == input;
    return count;
}

static uint32_t r58_polynomial_degree(const r58_behavior *behavior)
{
    uint8_t differences[R58_MODULUS];
    uint32_t degree;
    uint32_t index;
    memcpy(differences, behavior->values, R58_MODULUS);
    for (degree = 0; degree < R58_MODULUS; ++degree) {
        uint8_t any = 0;
        for (index = 1; index < R58_MODULUS - degree; ++index)
            any |= differences[index] != differences[0];
        if (!any) return degree;
        for (index = 0; index + 1 < R58_MODULUS - degree; ++index)
            differences[index] = (uint8_t)((differences[index + 1] +
                R58_MODULUS - differences[index]) % R58_MODULUS);
    }
    return R58_MODULUS - 1;
}

static uint32_t r58_signature_bucket(const r58_behavior *behavior)
{
    uint32_t hash = 2166136261u;
    uint32_t index;
    for (index = 0; index < R58_MODULUS; ++index) {
        hash ^= behavior->values[index];
        hash *= 16777619u;
    }
    return hash & 31u;
}

static uint8_t r58_has_nonlinear_operation(const r58_program *program)
{
    uint32_t index;
    for (index = 0; index < program->length; ++index)
        if (program->operations[index] >= R58_OP_SQUARE) return 1;
    return 0;
}

static size_t r58_feature_indices(const r58_program *program,
                                  const r58_behavior *behavior,
                                  uint16_t output[7])
{
    uint32_t distinct = r58_distinct_outputs(behavior);
    uint32_t fixed = r58_fixed_points(behavior);
    uint32_t degree = r58_polynomial_degree(behavior);
    output[0] = (uint16_t)(distinct - 1u);
    output[1] = (uint16_t)(17u + fixed);
    output[2] = (uint16_t)(34u + (R58_MODULUS - distinct));
    output[3] = (uint16_t)(51u + degree);
    output[4] = (uint16_t)(68u + (distinct == R58_MODULUS));
    output[5] = (uint16_t)(70u + program->length);
    output[6] = (uint16_t)(74u + r58_signature_bucket(behavior));
    return 7;
}

static uint16_t r58_role_feature(const r58_program *program)
{
    return (uint16_t)(106u + (program->length == 0 ? 0u :
        program->operations[program->length - 1]));
}

static uint16_t r58_nonlinear_feature(const r58_program *program)
{
    return (uint16_t)(114u + r58_has_nonlinear_operation(program));
}

static uint8_t r58_is_prefix(const r58_program *prefix,
                             const r58_program *program)
{
    uint32_t index;
    if (prefix->length > program->length) return 0;
    for (index = 0; index < prefix->length; ++index)
        if (prefix->operations[index] != program->operations[index]) return 0;
    return 1;
}

static int64_t r58_ln_q20(uint32_t input)
{
    const int64_t one = INT64_C(1) << 30;
    const int64_t ln2_q30 = INT64_C(744261118);
    uint32_t exponent = 0;
    int64_t normalized;
    int64_t z;
    int64_t z2;
    int64_t term;
    int64_t series;
    uint32_t denominator;
    if (input == 0) return INT64_MIN / 4;
    while ((UINT32_C(1) << (exponent + 1u)) <= input && exponent < 30u)
        exponent += 1;
    normalized = ((int64_t)input << 30) >> exponent;
    z = ((normalized - one) << 30) / (normalized + one);
    z2 = (z * z) >> 30;
    term = z;
    series = term;
    for (denominator = 3; denominator <= 15; denominator += 2) {
        term = (term * z2) >> 30;
        series += term / (int64_t)denominator;
    }
    return ((2 * series + (int64_t)exponent * ln2_q30) + 512) >> 10;
}

static int32_t r58_log_odds(uint32_t positive, uint32_t negative,
                            uint32_t positive_total, uint32_t negative_total)
{
    int64_t value = r58_ln_q20(positive + 1u) +
        r58_ln_q20(negative_total + 2u) - r58_ln_q20(negative + 1u) -
        r58_ln_q20(positive_total + 2u);
    if (value > INT32_MAX) return INT32_MAX;
    if (value < INT32_MIN) return INT32_MIN;
    return (int32_t)value;
}

static void r58_add_label(r58_guide *guide, const r58_program *program,
                          const r58_behavior *behavior, uint8_t positive)
{
    uint16_t features[7];
    size_t count = r58_feature_indices(program, behavior, features);
    size_t index;
    uint16_t role = r58_role_feature(program);
    uint16_t nonlinear = r58_nonlinear_feature(program);
    if (positive) guide->positive_labels += 1;
    else guide->negative_labels += 1;
    for (index = 0; index < count; ++index) {
        if (positive) guide->feature_positive[features[index]] += 1;
        else guide->feature_negative[features[index]] += 1;
    }
    if (positive) {
        guide->feature_positive[role] += 1;
        guide->feature_positive[nonlinear] += 1;
    } else {
        guide->feature_negative[role] += 1;
        guide->feature_negative[nonlinear] += 1;
    }
    for (index = 0; index < program->length; ++index) {
        uint32_t previous = index == 0 ? R58_OPERATIONS :
            program->operations[index - 1];
        uint32_t transition = previous * R58_OPERATIONS +
            program->operations[index];
        uint32_t raw = (uint32_t)index * R58_OPERATIONS +
            program->operations[index];
        if (positive) {
            guide->transition_positive[transition] += 1;
            guide->raw_token_positive[raw] += 1;
        } else {
            guide->transition_negative[transition] += 1;
            guide->raw_token_negative[raw] += 1;
        }
    }
}

static void r58_finish_guide(r58_guide *guide)
{
    uint32_t index;
    for (index = 0; index < R58_FEATURE_CELLS; ++index)
        guide->feature_log_odds_q20[index] = r58_log_odds(
            guide->feature_positive[index], guide->feature_negative[index],
            guide->positive_labels, guide->negative_labels);
    for (index = 0; index < R58_TRANSITION_CELLS; ++index)
        guide->transition_log_odds_q20[index] = r58_log_odds(
            guide->transition_positive[index],
            guide->transition_negative[index], guide->positive_labels,
            guide->negative_labels);
    for (index = 0; index < R58_RAW_TOKEN_CELLS; ++index)
        guide->raw_token_log_odds_q20[index] = r58_log_odds(
            guide->raw_token_positive[index],
            guide->raw_token_negative[index], guide->positive_labels,
            guide->negative_labels);
}

static void r58_put_u16(uint8_t *bytes, size_t *offset, uint16_t value)
{
    bytes[(*offset)++] = (uint8_t)value;
    bytes[(*offset)++] = (uint8_t)(value >> 8);
}

static void r58_put_u32(uint8_t *bytes, size_t *offset, uint32_t value)
{
    bytes[(*offset)++] = (uint8_t)value;
    bytes[(*offset)++] = (uint8_t)(value >> 8);
    bytes[(*offset)++] = (uint8_t)(value >> 16);
    bytes[(*offset)++] = (uint8_t)(value >> 24);
}

static uint16_t r58_get_u16(const uint8_t *bytes, size_t *offset)
{
    uint16_t value = (uint16_t)bytes[*offset] |
        ((uint16_t)bytes[*offset + 1] << 8);
    *offset += 2;
    return value;
}

static uint32_t r58_get_u32(const uint8_t *bytes, size_t *offset)
{
    uint32_t value = (uint32_t)bytes[*offset] |
        ((uint32_t)bytes[*offset + 1] << 8) |
        ((uint32_t)bytes[*offset + 2] << 16) |
        ((uint32_t)bytes[*offset + 3] << 24);
    *offset += 4;
    return value;
}

static int r58_serialize_artifact(r58_artifact *artifact)
{
    static const uint8_t magic[8] = {'R','5','8','A','0','0','0','1'};
    size_t offset = 0;
    uint32_t index;
    memcpy(artifact->bytes + offset, magic, sizeof(magic));
    offset += sizeof(magic);
    r58_put_u16(artifact->bytes, &offset, 1);
    artifact->bytes[offset++] = R58_MODULUS;
    artifact->bytes[offset++] = R58_OPERATIONS;
    artifact->bytes[offset++] = R58_SOURCE_MAX_DEPTH;
    artifact->bytes[offset++] = R58_TARGET_MAX_DEPTH;
    r58_put_u16(artifact->bytes, &offset, R58_FEATURE_CELLS);
    r58_put_u16(artifact->bytes, &offset, R58_TRANSITION_CELLS);
    r58_put_u16(artifact->bytes, &offset, R58_RAW_TOKEN_CELLS);
    r58_put_u32(artifact->bytes, &offset,
                R58_SOURCE_TASKS_PER_GENERATOR * R58_GENERATORS);
    r58_put_u32(artifact->bytes, &offset, artifact->guide.positive_labels);
    r58_put_u32(artifact->bytes, &offset, artifact->guide.negative_labels);
    for (index = 0; index < R58_FEATURE_CELLS; ++index) {
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.feature_positive[index]);
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.feature_negative[index]);
        r58_put_u32(artifact->bytes, &offset,
                    (uint32_t)artifact->guide.feature_log_odds_q20[index]);
    }
    for (index = 0; index < R58_TRANSITION_CELLS; ++index) {
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.transition_positive[index]);
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.transition_negative[index]);
        r58_put_u32(artifact->bytes, &offset,
                    (uint32_t)artifact->guide.transition_log_odds_q20[index]);
    }
    for (index = 0; index < R58_RAW_TOKEN_CELLS; ++index) {
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.raw_token_positive[index]);
        r58_put_u32(artifact->bytes, &offset,
                    artifact->guide.raw_token_negative[index]);
        r58_put_u32(artifact->bytes, &offset,
                    (uint32_t)artifact->guide.raw_token_log_odds_q20[index]);
    }
    if (offset + 32 > R58_ARTIFACT_MAX_BYTES) return -1;
    r58_digest(artifact->bytes, offset, artifact->bytes + offset);
    offset += 32;
    artifact->size = offset;
    r58_digest(artifact->bytes, artifact->size, artifact->sha256);
    return 0;
}

int r58_build_source_artifact(const r58_universe *universe,
                              r58_artifact *artifact)
{
    uint32_t source_indices[R58_MAX_SEMANTIC_CLASSES];
    uint32_t source_count = 0;
    uint32_t class_index;
    uint32_t generator;
    memset(artifact, 0, sizeof(*artifact));
    for (class_index = 0; class_index < universe->semantic_classes;
         ++class_index)
        if (universe->classes[class_index].canonical_program.length ==
            R58_SOURCE_MAX_DEPTH)
            source_indices[source_count++] = class_index;
    if (source_count < R58_SOURCE_TASKS_PER_GENERATOR) return -1;
    for (generator = 0; generator < R58_GENERATORS; ++generator) {
        uint32_t task;
        for (task = 0; task < R58_SOURCE_TASKS_PER_GENERATOR; ++task) {
            uint64_t mixed = r58_mix64(UINT64_C(0x58a17e2026000000) ^
                ((uint64_t)generator << 40) ^ task);
            uint32_t selected = generator == 0 ?
                (uint32_t)(mixed % source_count) :
                (uint32_t)(((mixed >> 17) + task * 11u) % source_count);
            const r58_program *target = &universe->classes[
                source_indices[selected]].canonical_program;
            for (class_index = 0; class_index < universe->semantic_classes;
                 ++class_index) {
                const r58_semantic_class *candidate =
                    &universe->classes[class_index];
                if (candidate->canonical_program.length >
                    R58_SOURCE_MAX_DEPTH) continue;
                r58_add_label(&artifact->guide,
                    &candidate->canonical_program, &candidate->behavior,
                    r58_is_prefix(&candidate->canonical_program, target));
            }
        }
    }
    r58_finish_guide(&artifact->guide);
    return r58_serialize_artifact(artifact);
}

static uint32_t r58_derange_feature(uint32_t feature, uint32_t derangement)
{
    if (derangement == 0) return feature;
    if (feature < 17) return (feature + derangement) % 17;
    if (feature < 34) return 17 + (feature - 17 + derangement * 3u) % 17;
    if (feature < 51) return 34 + (feature - 34 + derangement * 5u) % 17;
    if (feature < 68) return 51 + (feature - 51 + derangement * 7u) % 17;
    if (feature < 70) return 68 + (feature - 68 + derangement) % 2;
    if (feature < 74) return 70 + (feature - 70 + derangement) % 4;
    if (feature < 106) return 74 + (feature - 74 + derangement * 9u) % 32;
    return feature;
}

int64_t r58_score_program(const r58_program *program,
                          const r58_behavior *behavior,
                          const r58_guide *guide, uint32_t mode,
                          uint32_t derangement)
{
    uint16_t features[7];
    size_t count = r58_feature_indices(program, behavior, features);
    size_t index;
    int64_t score = 0;
    if (mode == 0 || mode == 1 || mode == 4) {
        if (mode != 1) {
            for (index = 0; index < count; ++index) {
                uint32_t feature = features[index];
                if (mode == 4)
                    feature = r58_derange_feature(feature, derangement);
                score += guide->feature_log_odds_q20[feature];
            }
        }
        score += guide->feature_log_odds_q20[r58_role_feature(program)];
    }
    if (mode <= 2 || mode == 4) {
        for (index = 0; index < program->length; ++index) {
            uint32_t previous = index == 0 ? R58_OPERATIONS :
                program->operations[index - 1];
            score += guide->transition_log_odds_q20[
                previous * R58_OPERATIONS + program->operations[index]];
        }
    }
    if (mode == 3)
        for (index = 0; index < program->length; ++index)
            score += guide->raw_token_log_odds_q20[
                index * R58_OPERATIONS + program->operations[index]];
    return score;
}

int r58_parse_artifact(const uint8_t *bytes, size_t size,
                       r58_artifact *artifact)
{
    static const uint8_t magic[8] = {'R','5','8','A','0','0','0','1'};
    size_t expected = 32u + 12u * (R58_FEATURE_CELLS +
        R58_TRANSITION_CELLS + R58_RAW_TOKEN_CELLS) + 32u;
    size_t offset = 0;
    uint8_t checksum[32];
    uint32_t index;
    if (!bytes || !artifact || size != expected || size > sizeof(artifact->bytes))
        return -1;
    if (memcmp(bytes, magic, sizeof(magic)) != 0) return -1;
    r58_digest(bytes, size - 32, checksum);
    if (memcmp(checksum, bytes + size - 32, 32) != 0) return -1;
    memset(artifact, 0, sizeof(*artifact));
    memcpy(artifact->bytes, bytes, size);
    artifact->size = size;
    r58_digest(bytes, size, artifact->sha256);
    offset = 8;
    if (r58_get_u16(bytes, &offset) != 1 ||
        bytes[offset++] != R58_MODULUS ||
        bytes[offset++] != R58_OPERATIONS ||
        bytes[offset++] != R58_SOURCE_MAX_DEPTH ||
        bytes[offset++] != R58_TARGET_MAX_DEPTH ||
        r58_get_u16(bytes, &offset) != R58_FEATURE_CELLS ||
        r58_get_u16(bytes, &offset) != R58_TRANSITION_CELLS ||
        r58_get_u16(bytes, &offset) != R58_RAW_TOKEN_CELLS ||
        r58_get_u32(bytes, &offset) !=
            R58_SOURCE_TASKS_PER_GENERATOR * R58_GENERATORS)
        return -1;
    artifact->guide.positive_labels = r58_get_u32(bytes, &offset);
    artifact->guide.negative_labels = r58_get_u32(bytes, &offset);
    for (index = 0; index < R58_FEATURE_CELLS; ++index) {
        artifact->guide.feature_positive[index] = r58_get_u32(bytes, &offset);
        artifact->guide.feature_negative[index] = r58_get_u32(bytes, &offset);
        artifact->guide.feature_log_odds_q20[index] =
            (int32_t)r58_get_u32(bytes, &offset);
    }
    for (index = 0; index < R58_TRANSITION_CELLS; ++index) {
        artifact->guide.transition_positive[index] = r58_get_u32(bytes, &offset);
        artifact->guide.transition_negative[index] = r58_get_u32(bytes, &offset);
        artifact->guide.transition_log_odds_q20[index] =
            (int32_t)r58_get_u32(bytes, &offset);
    }
    for (index = 0; index < R58_RAW_TOKEN_CELLS; ++index) {
        artifact->guide.raw_token_positive[index] = r58_get_u32(bytes, &offset);
        artifact->guide.raw_token_negative[index] = r58_get_u32(bytes, &offset);
        artifact->guide.raw_token_log_odds_q20[index] =
            (int32_t)r58_get_u32(bytes, &offset);
    }
    if (offset != size - 32) return -1;
    for (index = 0; index < R58_FEATURE_CELLS; ++index)
        if (artifact->guide.feature_log_odds_q20[index] != r58_log_odds(
            artifact->guide.feature_positive[index],
            artifact->guide.feature_negative[index],
            artifact->guide.positive_labels, artifact->guide.negative_labels))
            return -1;
    for (index = 0; index < R58_TRANSITION_CELLS; ++index)
        if (artifact->guide.transition_log_odds_q20[index] != r58_log_odds(
            artifact->guide.transition_positive[index],
            artifact->guide.transition_negative[index],
            artifact->guide.positive_labels, artifact->guide.negative_labels))
            return -1;
    for (index = 0; index < R58_RAW_TOKEN_CELLS; ++index)
        if (artifact->guide.raw_token_log_odds_q20[index] != r58_log_odds(
            artifact->guide.raw_token_positive[index],
            artifact->guide.raw_token_negative[index],
            artifact->guide.positive_labels, artifact->guide.negative_labels))
            return -1;
    return 0;
}

static void r58_hex(const uint8_t *bytes, size_t size, char *output)
{
    static const char alphabet[] = "0123456789abcdef";
    size_t index;
    for (index = 0; index < size; ++index) {
        output[index * 2] = alphabet[bytes[index] >> 4];
        output[index * 2 + 1] = alphabet[bytes[index] & 15u];
    }
    output[size * 2] = '\0';
}

int r58_write_artifact_hex(const char *path, const r58_artifact *artifact)
{
    FILE *file = fopen(path, "wb");
    size_t index;
    if (!file) return -1;
    for (index = 0; index < artifact->size; ++index)
        if (fprintf(file, "%02x", artifact->bytes[index]) < 0) {
            fclose(file);
            return -1;
        }
    if (fputc('\n', file) == EOF || fclose(file) != 0) return -1;
    return 0;
}

int r58_write_development_json(const char *path,
                               const r58_development_summary *summary)
{
    FILE *file = fopen(path, "wb");
    char universe_hex[65];
    char artifact_hex[65];
    int failed;
    if (!file) return -1;
    r58_hex(summary->universe_sha256, 32, universe_hex);
    r58_hex(summary->artifact_sha256, 32, artifact_hex);
    failed = fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner58_core_development.v1\",\n"
        "  \"status\": \"development-only\",\n"
        "  \"execution_authorized\": false,\n"
        "  \"field\": {\"modulus\": 17, \"domain_points\": 17},\n"
        "  \"program\": {\"operations\": 8, \"source_max_depth\": 2, \"target_max_depth\": 3},\n"
        "  \"syntax_programs\": %u,\n"
        "  \"semantic_classes\": %u,\n"
        "  \"semantic_collisions\": %u,\n"
        "  \"nonlinear_classes\": %u,\n"
        "  \"source_tasks\": %u,\n"
        "  \"positive_labels\": %u,\n"
        "  \"negative_labels\": %u,\n"
        "  \"exact_verifier_checks\": %u,\n"
        "  \"artifact_bytes\": %u,\n"
        "  \"universe_sha256\": \"%s\",\n"
        "  \"artifact_sha256\": \"%s\"\n"
        "}\n",
        summary->syntax_programs, summary->semantic_classes,
        summary->semantic_collisions, summary->nonlinear_classes,
        summary->source_tasks, summary->positive_labels,
        summary->negative_labels, summary->exact_verifier_checks,
        summary->artifact_bytes, universe_hex, artifact_hex) < 0;
    if (fclose(file) != 0) failed = 1;
    return failed ? -1 : 0;
}

static void r58_universe_digest(const r58_universe *universe,
                                uint8_t digest[32])
{
    r58_sha256 sha;
    uint32_t index;
    r58_sha256_init(&sha);
    for (index = 0; index < universe->semantic_classes; ++index) {
        const r58_semantic_class *item = &universe->classes[index];
        r58_sha256_update(&sha, &item->canonical_program.length, 1);
        r58_sha256_update(&sha, item->canonical_program.operations,
                          R58_TARGET_MAX_DEPTH);
        r58_sha256_update(&sha, item->behavior.values, R58_MODULUS);
    }
    r58_sha256_final(&sha, digest);
}

int r58_run_development(r58_development_summary *summary,
                        r58_artifact *artifact)
{
    r58_universe universe;
    uint32_t index;
    uint32_t nonlinear = 0;
    uint32_t exact_checks = 0;
    memset(summary, 0, sizeof(*summary));
    if (r58_enumerate_universe(&universe) != 0 ||
        r58_build_source_artifact(&universe, artifact) != 0)
        return -1;
    for (index = 0; index < universe.semantic_classes; ++index) {
        uint8_t counterexample;
        nonlinear += r58_has_nonlinear_operation(
            &universe.classes[index].canonical_program);
        if (!r58_verify_exact(&universe.classes[index].canonical_program,
                              &universe.classes[index].behavior,
                              &counterexample) || counterexample != 0xffu)
            return -1;
        exact_checks += R58_MODULUS;
    }
    summary->syntax_programs = universe.syntax_programs;
    summary->semantic_classes = universe.semantic_classes;
    summary->semantic_collisions = universe.semantic_collisions;
    summary->nonlinear_classes = nonlinear;
    summary->source_tasks = R58_SOURCE_TASKS_PER_GENERATOR * R58_GENERATORS;
    summary->positive_labels = artifact->guide.positive_labels;
    summary->negative_labels = artifact->guide.negative_labels;
    summary->exact_verifier_checks = exact_checks;
    summary->artifact_bytes = (uint32_t)artifact->size;
    r58_universe_digest(&universe, summary->universe_sha256);
    memcpy(summary->artifact_sha256, artifact->sha256, 32);
    return 0;
}

static int r58_sha_self_test(void)
{
    static const uint8_t expected[32] = {
        0xe3,0xb0,0xc4,0x42,0x98,0xfc,0x1c,0x14,
        0x9a,0xfb,0xf4,0xc8,0x99,0x6f,0xb9,0x24,
        0x27,0xae,0x41,0xe4,0x64,0x9b,0x93,0x4c,
        0xa4,0x95,0x99,0x1b,0x78,0x52,0xb8,0x55
    };
    uint8_t digest[32];
    r58_digest(NULL, 0, digest);
    return memcmp(digest, expected, 32) == 0;
}

int r58_self_test(void)
{
    r58_universe first;
    r58_universe second;
    r58_artifact artifact;
    r58_artifact parsed;
    r58_program nonlinear = {1, {R58_OP_SQUARE, 0, 0}};
    r58_behavior behavior;
    uint8_t corrupted[R58_ARTIFACT_MAX_BYTES];
    uint8_t counterexample;
    int64_t score;
    if (!r58_sha_self_test()) return -1;
    if (r58_apply_operation(R58_OP_TRANSLATE_1, 16) != 0 ||
        r58_apply_operation(R58_OP_SCALE_3, 6) != 1 ||
        r58_apply_operation(R58_OP_SQUARE, 5) != 8 ||
        r58_apply_operation(R58_OP_CUBE, 3) != 10 ||
        r58_apply_operation(R58_OP_MIXED, 4) != 4)
        return -1;
    if (r58_enumerate_universe(&first) != 0 ||
        r58_enumerate_universe(&second) != 0 ||
        first.syntax_programs != 585 || first.semantic_classes != 428 ||
        first.semantic_collisions != 157 ||
        first.classes_by_depth[0] != 1 || first.classes_by_depth[1] != 8 ||
        first.classes_by_depth[2] != 56 || first.classes_by_depth[3] != 363 ||
        memcmp(&first, &second, sizeof(first)) != 0)
        return -1;
    r58_execute_program(&nonlinear, &behavior);
    if (!r58_verify_exact(&nonlinear, &behavior, &counterexample) ||
        counterexample != 0xffu)
        return -1;
    behavior.values[3] = (uint8_t)((behavior.values[3] + 1) % R58_MODULUS);
    if (r58_verify_exact(&nonlinear, &behavior, &counterexample) ||
        counterexample != 3)
        return -1;
    if (r58_build_source_artifact(&first, &artifact) != 0 ||
        artifact.size != 2608 ||
        r58_parse_artifact(artifact.bytes, artifact.size, &parsed) != 0 ||
        memcmp(artifact.bytes, parsed.bytes, artifact.size) != 0)
        return -1;
    memcpy(corrupted, artifact.bytes, artifact.size);
    corrupted[100] ^= 1u;
    if (r58_parse_artifact(corrupted, artifact.size, &parsed) == 0)
        return -1;
    score = r58_score_program(&first.classes[first.semantic_classes - 1]
        .canonical_program, &first.classes[first.semantic_classes - 1].behavior,
        &artifact.guide, 0, 0);
    if (score == INT64_MIN || artifact.guide.positive_labels == 0 ||
        artifact.guide.negative_labels == 0)
        return -1;
    return 0;
}
