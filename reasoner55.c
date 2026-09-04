#include "reasoner55.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R55_SEEN_SLOTS 8192u
#define R55_SOURCE_ROOT UINT64_C(0x55a10ce5f0012026)
#ifndef R55_DEVELOPMENT_ROOT
#define R55_DEVELOPMENT_ROOT UINT64_C(0x55de7e10f0013162)
#endif
#ifndef R55_TIE_NAMESPACE
#define R55_TIE_NAMESPACE UINT64_C(0x726561736f6e3535)
#endif

typedef struct {
    uint32_t state[8];
    uint64_t bits;
    uint8_t block[64];
    size_t used;
} r55_sha256;

typedef struct {
    uint64_t state;
} r55_rng;

typedef struct {
    r55_affine primitive_by_role[R55_ROLES];
    uint8_t surface_to_role[R55_PRIMITIVES];
    uint8_t role_to_surface[R55_ROLES];
    uint32_t surface_id[R55_PRIMITIVES];
    uint8_t target_roles[R55_PROGRAM_LEN];
    uint8_t target_surface[R55_PROGRAM_LEN];
    r55_affine target;
    uint8_t example_input[R55_LANES];
    uint8_t example_output[R55_LANES];
    uint8_t generator_id;
    uint32_t ordinal;
    uint64_t family_seed;
} r55_family;

typedef struct {
    uint16_t syntax_index;
    uint8_t token[R55_PROGRAM_LEN];
    uint8_t role[R55_PROGRAM_LEN];
    r55_affine semantic;
    uint8_t evidence_loss;
    uint64_t prior;
    uint64_t tie;
} r55_candidate;

typedef struct {
    uint32_t primary_cost;
    uint32_t verifier_checks;
    uint32_t partial_expansions;
    uint32_t observation_queries;
    uint32_t first_counterexample;
    uint32_t source_artifact_reads;
    uint8_t exact;
    uint8_t certificate_valid;
    uint8_t fallback_started;
    uint8_t global_cap_hit;
    uint8_t invalid_first_rejected;
    uint8_t accepted_semantic[32];
    uint8_t proposal_order[32];
} r55_search_result;

typedef struct {
    uint32_t key[R55_SEEN_SLOTS];
    uint8_t used[R55_SEEN_SLOTS];
} r55_seen;

static uint32_t r55_rotr(uint32_t value, uint8_t bits)
{
    return (value >> bits) | (value << (32u - bits));
}

static void r55_sha256_transform(r55_sha256 *sha, const uint8_t block[64])
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
    uint8_t index;
    for (index = 0; index < 16u; ++index) {
        size_t offset = (size_t)index * 4u;
        words[index] = ((uint32_t)block[offset] << 24u) |
                       ((uint32_t)block[offset + 1u] << 16u) |
                       ((uint32_t)block[offset + 2u] << 8u) |
                       (uint32_t)block[offset + 3u];
    }
    for (index = 16u; index < 64u; ++index) {
        uint32_t s0 = r55_rotr(words[index - 15u], 7) ^
                      r55_rotr(words[index - 15u], 18) ^
                      (words[index - 15u] >> 3u);
        uint32_t s1 = r55_rotr(words[index - 2u], 17) ^
                      r55_rotr(words[index - 2u], 19) ^
                      (words[index - 2u] >> 10u);
        words[index] = words[index - 16u] + s0 + words[index - 7u] + s1;
    }
    a = sha->state[0]; b = sha->state[1]; c = sha->state[2];
    d = sha->state[3]; e = sha->state[4]; f = sha->state[5];
    g = sha->state[6]; h = sha->state[7];
    for (index = 0; index < 64u; ++index) {
        uint32_t upper = r55_rotr(e, 6) ^ r55_rotr(e, 11) ^ r55_rotr(e, 25);
        uint32_t choose = (e & f) ^ ((~e) & g);
        uint32_t first = h + upper + choose + constants[index] + words[index];
        uint32_t lower = r55_rotr(a, 2) ^ r55_rotr(a, 13) ^ r55_rotr(a, 22);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t second = lower + majority;
        h = g; g = f; f = e; e = d + first;
        d = c; c = b; b = a; a = first + second;
    }
    sha->state[0] += a; sha->state[1] += b;
    sha->state[2] += c; sha->state[3] += d;
    sha->state[4] += e; sha->state[5] += f;
    sha->state[6] += g; sha->state[7] += h;
}

static void r55_sha256_init(r55_sha256 *sha)
{
    static const uint32_t initial[8] = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
    };
    memset(sha, 0, sizeof(*sha));
    memcpy(sha->state, initial, sizeof(initial));
}

static void r55_sha256_update(r55_sha256 *sha, const void *data, size_t length)
{
    const uint8_t *bytes = data;
    size_t index;
    sha->bits += (uint64_t)length * 8u;
    for (index = 0; index < length; ++index) {
        sha->block[sha->used++] = bytes[index];
        if (sha->used == sizeof(sha->block)) {
            r55_sha256_transform(sha, sha->block);
            sha->used = 0;
        }
    }
}

static void r55_sha256_final(r55_sha256 *sha, uint8_t digest[32])
{
    uint8_t index;
    uint64_t bits = sha->bits;
    sha->block[sha->used++] = 0x80u;
    if (sha->used > 56u) {
        while (sha->used < 64u) sha->block[sha->used++] = 0;
        r55_sha256_transform(sha, sha->block);
        sha->used = 0;
    }
    while (sha->used < 56u) sha->block[sha->used++] = 0;
    for (index = 0; index < 8u; ++index)
        sha->block[56u + index] =
            (uint8_t)(bits >> (56u - (uint8_t)(index * 8u)));
    r55_sha256_transform(sha, sha->block);
    for (index = 0; index < 8u; ++index) {
        digest[index * 4u] = (uint8_t)(sha->state[index] >> 24u);
        digest[index * 4u + 1u] = (uint8_t)(sha->state[index] >> 16u);
        digest[index * 4u + 2u] = (uint8_t)(sha->state[index] >> 8u);
        digest[index * 4u + 3u] = (uint8_t)sha->state[index];
    }
}

static void r55_digest(const char *kind, const void *data, size_t length,
                       uint8_t digest[32])
{
    r55_sha256 sha;
    r55_sha256_init(&sha);
    r55_sha256_update(&sha, kind, strlen(kind));
    r55_sha256_update(&sha, "\0", 1u);
    r55_sha256_update(&sha, data, length);
    r55_sha256_final(&sha, digest);
}

static void r55_hex(const uint8_t digest[32], char output[65])
{
    static const char digits[] = "0123456789abcdef";
    uint32_t index;
    for (index = 0; index < 32u; ++index) {
        output[index * 2u] = digits[digest[index] >> 4u];
        output[index * 2u + 1u] = digits[digest[index] & 15u];
    }
    output[64] = '\0';
}

static uint64_t r55_mix64(uint64_t value)
{
    value += UINT64_C(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30u)) * UINT64_C(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27u)) * UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31u);
}

static void r55_rng_init(r55_rng *rng, uint64_t seed, uint64_t stream)
{
    rng->state = r55_mix64(seed ^ r55_mix64(stream));
}

static uint64_t r55_rng_next(r55_rng *rng)
{
    rng->state += UINT64_C(0x9e3779b97f4a7c15);
    return r55_mix64(rng->state);
}

static uint32_t r55_rng_index(r55_rng *rng, uint32_t bound)
{
    uint64_t threshold = (uint64_t)(0u - (uint64_t)bound) % bound;
    uint64_t value;
    do value = r55_rng_next(rng); while (value < threshold);
    return (uint32_t)(value % bound);
}

static uint8_t r55_mod(int32_t value)
{
    int32_t reduced = value % R55_MODULUS;
    if (reduced < 0) reduced += R55_MODULUS;
    return (uint8_t)reduced;
}

static r55_affine r55_identity(void)
{
    r55_affine result;
    uint32_t lane;
    memset(&result, 0, sizeof(result));
    for (lane = 0; lane < R55_LANES; ++lane)
        result.matrix[lane * R55_LANES + lane] = 1u;
    return result;
}

static r55_affine r55_compose(const r55_affine *after,
                              const r55_affine *before)
{
    r55_affine result;
    uint32_t row, column, inner;
    memset(&result, 0, sizeof(result));
    for (row = 0; row < R55_LANES; ++row) {
        for (column = 0; column < R55_LANES; ++column) {
            int32_t value = 0;
            for (inner = 0; inner < R55_LANES; ++inner)
                value += after->matrix[row * R55_LANES + inner] *
                         before->matrix[inner * R55_LANES + column];
            result.matrix[row * R55_LANES + column] = r55_mod(value);
        }
        {
            int32_t value = after->bias[row];
            for (inner = 0; inner < R55_LANES; ++inner)
                value += after->matrix[row * R55_LANES + inner] *
                         before->bias[inner];
            result.bias[row] = r55_mod(value);
        }
    }
    return result;
}

static void r55_apply(const r55_affine *map,
                      const uint8_t input[R55_LANES],
                      uint8_t output[R55_LANES])
{
    uint32_t row, column;
    for (row = 0; row < R55_LANES; ++row) {
        int32_t value = map->bias[row];
        for (column = 0; column < R55_LANES; ++column)
            value += map->matrix[row * R55_LANES + column] * input[column];
        output[row] = r55_mod(value);
    }
}

static int r55_affine_equal(const r55_affine *left,
                            const r55_affine *right)
{
    return memcmp(left, right, sizeof(*left)) == 0;
}

static uint8_t r55_role_of(const r55_affine *map)
{
    r55_affine identity = r55_identity();
    uint32_t row, column;
    uint32_t bias_support = 0;
    uint32_t diagonal_changes = 0;
    int diagonal = 1;
    int permutation = 1;
    int shear = 1;
    uint32_t off_diagonal_nonzero = 0;
    for (row = 0; row < R55_LANES; ++row)
        bias_support += map->bias[row] != 0u;
    if (memcmp(map->matrix, identity.matrix, sizeof(map->matrix)) == 0) {
        if (bias_support == 1u) return R55_ROLE_AXIS_TRANSLATION;
        if (bias_support > 1u) return R55_ROLE_DENSE_TRANSLATION;
        return UINT8_MAX;
    }
    if (bias_support > 0u) return R55_ROLE_AFFINE_MIX;
    for (row = 0; row < R55_LANES; ++row) {
        uint32_t row_nonzero = 0;
        uint32_t column_nonzero = 0;
        for (column = 0; column < R55_LANES; ++column) {
            uint8_t value = map->matrix[row * R55_LANES + column];
            uint8_t column_value =
                map->matrix[column * R55_LANES + row];
            if (row != column && value != 0u) {
                diagonal = 0;
                ++off_diagonal_nonzero;
            }
            row_nonzero += value != 0u;
            column_nonzero += column_value != 0u;
            if ((value != 0u && value != 1u) ||
                (column_value != 0u && column_value != 1u))
                permutation = 0;
            if (row == column && value != 1u) shear = 0;
        }
        diagonal_changes +=
            map->matrix[row * R55_LANES + row] != 1u;
        if (row_nonzero != 1u || column_nonzero != 1u) permutation = 0;
    }
    if (diagonal) {
        if (diagonal_changes == 1u) return R55_ROLE_AXIS_SCALE;
        return R55_ROLE_DENSE_SCALE;
    }
    if (permutation) return R55_ROLE_PERMUTATION;
    if (shear && off_diagonal_nonzero == 1u) return R55_ROLE_SHEAR;
    return R55_ROLE_LINEAR_MIX;
}

static r55_affine r55_axis_translation(r55_rng *rng)
{
    r55_affine map = r55_identity();
    map.bias[r55_rng_index(rng, R55_LANES)] =
        (uint8_t)(1u + r55_rng_index(rng, R55_MODULUS - 1u));
    return map;
}

static r55_affine r55_dense_translation(r55_rng *rng)
{
    r55_affine map = r55_identity();
    uint32_t lane;
    for (lane = 0; lane < R55_LANES; ++lane)
        map.bias[lane] = (uint8_t)(1u +
            r55_rng_index(rng, R55_MODULUS - 1u));
    return map;
}

static r55_affine r55_axis_scale(r55_rng *rng)
{
    r55_affine map = r55_identity();
    uint32_t lane = r55_rng_index(rng, R55_LANES);
    map.matrix[lane * R55_LANES + lane] =
        (uint8_t)(2u + r55_rng_index(rng, R55_MODULUS - 2u));
    return map;
}

static r55_affine r55_dense_scale(r55_rng *rng)
{
    r55_affine map = r55_identity();
    uint32_t lane;
    for (lane = 0; lane < R55_LANES; ++lane)
        map.matrix[lane * R55_LANES + lane] =
            (uint8_t)(2u + r55_rng_index(rng, R55_MODULUS - 2u));
    return map;
}

static r55_affine r55_permutation(r55_rng *rng)
{
    static const uint8_t permutations[5][R55_LANES] = {
        {0u, 2u, 1u}, {1u, 0u, 2u}, {1u, 2u, 0u},
        {2u, 0u, 1u}, {2u, 1u, 0u}
    };
    const uint8_t *permutation = permutations[r55_rng_index(rng, 5u)];
    r55_affine map;
    uint32_t row;
    memset(&map, 0, sizeof(map));
    for (row = 0; row < R55_LANES; ++row)
        map.matrix[row * R55_LANES + permutation[row]] = 1u;
    return map;
}

static r55_affine r55_shear(r55_rng *rng)
{
    r55_affine map = r55_identity();
    uint32_t row = r55_rng_index(rng, R55_LANES);
    uint32_t column = r55_rng_index(rng, R55_LANES - 1u);
    if (column >= row) ++column;
    map.matrix[row * R55_LANES + column] =
        (uint8_t)(1u + r55_rng_index(rng, R55_MODULUS - 1u));
    return map;
}

static r55_affine r55_linear_mix(r55_rng *rng)
{
    uint32_t attempt;
    for (attempt = 0; attempt < 64u; ++attempt) {
        r55_affine scale = r55_dense_scale(rng);
        r55_affine shear = r55_shear(rng);
        r55_affine permutation = r55_permutation(rng);
        r55_affine partial = r55_compose(&shear, &scale);
        r55_affine map = r55_compose(&permutation, &partial);
        if (r55_role_of(&map) == R55_ROLE_LINEAR_MIX) return map;
    }
    return r55_identity();
}

static r55_affine r55_make_role(uint8_t role, uint64_t seed)
{
    r55_rng rng;
    r55_affine map;
    r55_rng_init(&rng, seed, UINT64_C(0x7072696d69746976) + role);
    if (role == R55_ROLE_AXIS_TRANSLATION)
        map = r55_axis_translation(&rng);
    else if (role == R55_ROLE_DENSE_TRANSLATION)
        map = r55_dense_translation(&rng);
    else if (role == R55_ROLE_AXIS_SCALE)
        map = r55_axis_scale(&rng);
    else if (role == R55_ROLE_DENSE_SCALE)
        map = r55_dense_scale(&rng);
    else if (role == R55_ROLE_PERMUTATION)
        map = r55_permutation(&rng);
    else if (role == R55_ROLE_SHEAR)
        map = r55_shear(&rng);
    else if (role == R55_ROLE_LINEAR_MIX)
        map = r55_linear_mix(&rng);
    else {
        uint32_t lane;
        map = r55_linear_mix(&rng);
        for (lane = 0; lane < R55_LANES; ++lane)
            map.bias[lane] = (uint8_t)(1u +
                r55_rng_index(&rng, R55_MODULUS - 1u));
    }
    return map;
}

static void r55_syntax_first_roles(uint64_t seed,
                                   uint8_t roles[R55_PROGRAM_LEN])
{
    r55_rng rng;
    uint32_t position;
    r55_rng_init(&rng, seed, UINT64_C(0x73796e746178));
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        roles[position] = (uint8_t)r55_rng_index(&rng, R55_ROLES);
}

static void r55_skeleton_first_roles(uint64_t seed,
                                     uint8_t roles[R55_PROGRAM_LEN])
{
    static const uint8_t skeletons[8][R55_PROGRAM_LEN] = {
        {4u, 2u, 0u, 7u}, {6u, 3u, 1u, 7u},
        {4u, 5u, 1u, 7u}, {6u, 2u, 0u, 1u},
        {4u, 3u, 0u, 7u}, {6u, 5u, 1u, 7u},
        {4u, 2u, 1u, 7u}, {6u, 3u, 0u, 1u}
    };
    r55_rng rng;
    uint8_t binding[R55_ROLES];
    uint32_t index, role;
    r55_rng_init(&rng, seed, UINT64_C(0x736b656c65746f6e));
    index = r55_rng_index(&rng, 8u);
    for (role = 0; role < R55_ROLES; ++role) binding[role] = (uint8_t)role;
    for (role = R55_ROLES - 1u; role > 0u; --role) {
        uint32_t other = r55_rng_index(&rng, role + 1u);
        uint8_t temporary = binding[role];
        binding[role] = binding[other];
        binding[other] = temporary;
    }
    for (role = 0; role < R55_PROGRAM_LEN; ++role)
        roles[role] = binding[skeletons[index][role]];
}

static r55_affine r55_program_from_roles(const r55_family *family,
                                         const uint8_t roles[R55_PROGRAM_LEN])
{
    r55_affine result = r55_identity();
    uint32_t position;
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        result = r55_compose(&family->primitive_by_role[roles[position]],
                             &result);
    return result;
}

static void r55_program_tokens(uint16_t index,
                               uint8_t token[R55_PROGRAM_LEN])
{
    int position;
    for (position = R55_PROGRAM_LEN - 1; position >= 0; --position) {
        token[position] = (uint8_t)(index & 7u);
        index = (uint16_t)(index >> 3u);
    }
}

static r55_affine r55_program_from_surface(const r55_family *family,
                                           const uint8_t token[R55_PROGRAM_LEN])
{
    r55_affine result = r55_identity();
    uint32_t position;
    for (position = 0; position < R55_PROGRAM_LEN; ++position) {
        uint8_t role = family->surface_to_role[token[position]];
        result = r55_compose(&family->primitive_by_role[role], &result);
    }
    return result;
}

static void r55_public_program_apply(const r55_family *family,
                                     const uint8_t token[R55_PROGRAM_LEN],
                                     const uint8_t input[R55_LANES],
                                     uint8_t output[R55_LANES])
{
    uint8_t current[R55_LANES];
    uint8_t next[R55_LANES];
    uint32_t position;
    memcpy(current, input, sizeof(current));
    for (position = 0; position < R55_PROGRAM_LEN; ++position) {
        uint8_t role = family->surface_to_role[token[position]];
        r55_apply(&family->primitive_by_role[role], current, next);
        memcpy(current, next, sizeof(current));
    }
    memcpy(output, current, sizeof(current));
}

static int r55_generate_family(r55_family *family, uint64_t root,
                               uint8_t generator, uint32_t ordinal,
                               uint32_t nonce)
{
    uint64_t family_seed = r55_mix64(root ^ ((uint64_t)generator << 56u) ^
        ((uint64_t)ordinal << 16u) ^ nonce);
    r55_rng surface_rng;
    r55_rng input_rng;
    uint32_t role, slot;
    memset(family, 0, sizeof(*family));
    family->generator_id = generator;
    family->ordinal = ordinal;
    family->family_seed = family_seed;
    for (role = 0; role < R55_ROLES; ++role) {
        family->primitive_by_role[role] = r55_make_role((uint8_t)role,
            r55_mix64(family_seed ^ ((uint64_t)role << 40u)));
        if (r55_role_of(&family->primitive_by_role[role]) != role) return 1;
        family->surface_to_role[role] = (uint8_t)role;
    }
    r55_rng_init(&surface_rng, family_seed, UINT64_C(0x73757266616365));
    for (slot = R55_PRIMITIVES - 1u; slot > 0u; --slot) {
        uint32_t other = r55_rng_index(&surface_rng, slot + 1u);
        uint8_t temporary = family->surface_to_role[slot];
        family->surface_to_role[slot] = family->surface_to_role[other];
        family->surface_to_role[other] = temporary;
    }
    for (slot = 0; slot < R55_PRIMITIVES; ++slot) {
        uint32_t other;
        family->role_to_surface[family->surface_to_role[slot]] = (uint8_t)slot;
        do {
            family->surface_id[slot] = (uint32_t)r55_rng_next(&surface_rng);
            for (other = 0; other < slot; ++other)
                if (family->surface_id[slot] == family->surface_id[other])
                    break;
        } while (other < slot);
    }
    if (generator == R55_GENERATOR_SYNTAX_FIRST)
        r55_syntax_first_roles(r55_mix64(family_seed ^ UINT64_C(0x70726f6772616d)),
                               family->target_roles);
    else
        r55_skeleton_first_roles(
            r55_mix64(family_seed ^ UINT64_C(0x70726f6772616d)),
            family->target_roles);
    for (slot = 0; slot < R55_PROGRAM_LEN; ++slot)
        family->target_surface[slot] =
            family->role_to_surface[family->target_roles[slot]];
    family->target = r55_program_from_roles(family, family->target_roles);
    r55_rng_init(&input_rng, family_seed, UINT64_C(0x696e707574));
    for (slot = 0; slot < R55_LANES; ++slot)
        family->example_input[slot] =
            (uint8_t)r55_rng_index(&input_rng, R55_MODULUS);
    r55_apply(&family->target, family->example_input, family->example_output);
    return 0;
}

static uint32_t r55_semantic_key(const r55_affine *map)
{
    uint32_t result = 0;
    uint32_t power = 1;
    uint32_t index;
    for (index = 0; index < sizeof(map->matrix); ++index) {
        result += map->matrix[index] * power;
        power *= R55_MODULUS;
    }
    for (index = 0; index < sizeof(map->bias); ++index) {
        result += map->bias[index] * power;
        power *= R55_MODULUS;
    }
    return result;
}

static int r55_map_used(const r55_affine *used, uint32_t count,
                        const r55_affine *map)
{
    uint32_t index;
    for (index = 0; index < count; ++index)
        if (r55_affine_equal(&used[index], map)) return 1;
    return 0;
}

static uint32_t r55_ast_key(const uint8_t roles[R55_PROGRAM_LEN])
{
    uint32_t key = 0;
    uint32_t position;
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        key = key * R55_ROLES + roles[position];
    return key;
}

static int r55_ast_used(const uint32_t *used, uint32_t count, uint32_t key)
{
    uint32_t index;
    for (index = 0; index < count; ++index)
        if (used[index] == key) return 1;
    return 0;
}

static int r55_make_unique_family(r55_family *family, uint64_t root,
                                  uint8_t generator, uint32_t ordinal,
                                  r55_affine *used, uint32_t *used_count,
                                  uint32_t *used_ast,
                                  uint32_t *used_ast_count)
{
    uint32_t nonce;
    for (nonce = 0; nonce < 4096u; ++nonce) {
        if (r55_generate_family(family, root, generator, ordinal, nonce) != 0)
            continue;
        if (r55_map_used(used, *used_count, &family->target)) continue;
        if (r55_ast_used(used_ast, *used_ast_count,
                         r55_ast_key(family->target_roles))) continue;
        used[(*used_count)++] = family->target;
        used_ast[(*used_ast_count)++] = r55_ast_key(family->target_roles);
        return 0;
    }
    return 1;
}

static int r55_canonical_solution(const r55_family *family,
                                  uint8_t solution[R55_PROGRAM_LEN])
{
    uint16_t index;
    for (index = 0; index < R55_CANDIDATES; ++index) {
        uint8_t roles[R55_PROGRAM_LEN];
        r55_affine candidate;
        r55_program_tokens(index, roles);
        candidate = r55_program_from_roles(family, roles);
        if (r55_affine_equal(&candidate, &family->target)) {
            memcpy(solution, roles, R55_PROGRAM_LEN);
            return 0;
        }
    }
    return 1;
}

static int r55_record_family_receipt(r55_development_result *result,
                                     const r55_family *family, uint8_t lane)
{
    r55_family_receipt *receipt;
    if (result->family_receipt_count >= R55_TOTAL_FAMILIES) return 1;
    receipt = &result->family_receipts[result->family_receipt_count++];
    memset(receipt, 0, sizeof(*receipt));
    receipt->lane = lane;
    receipt->generator_id = family->generator_id;
    receipt->ordinal = family->ordinal;
    r55_digest("reasoner55-target-ast", family->target_roles,
               sizeof(family->target_roles), receipt->ast_sha256);
    r55_digest("reasoner55-affine", &family->target,
               sizeof(family->target), receipt->behavior_sha256);
    return 0;
}

static void r55_guide_add(r55_guide *guide,
                          const uint8_t roles[R55_PROGRAM_LEN])
{
    uint32_t position;
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        ++guide->position_count[position][roles[position]];
    for (position = 0; position + 1u < R55_PROGRAM_LEN; ++position)
        ++guide->transition_count[position][roles[position]][roles[position + 1u]];
    ++guide->source_solutions;
}

static int r55_build_source_artifact(r55_artifact *artifact,
                                     r55_affine *used,
                                     uint32_t *used_count,
                                     uint32_t *used_ast,
                                     uint32_t *used_ast_count,
                                     r55_development_result *result)
{
    uint32_t generator, ordinal;
    memset(artifact, 0, sizeof(*artifact));
    for (generator = 0; generator < R55_GENERATORS; ++generator) {
        r55_guide *guide = &artifact->guides[generator];
        guide->generator_id = (uint8_t)generator;
        for (ordinal = 0; ordinal < R55_SOURCE_FAMILIES; ++ordinal) {
            r55_family family;
            uint8_t solution[R55_PROGRAM_LEN];
            if (r55_make_unique_family(&family, R55_SOURCE_ROOT,
                    (uint8_t)generator, ordinal, used, used_count,
                    used_ast, used_ast_count) != 0)
                return 1;
            if (r55_canonical_solution(&family, solution) != 0) return 1;
            if (r55_record_family_receipt(result, &family, 0u) != 0) return 1;
            r55_guide_add(guide, solution);
            ++guide->source_families;
        }
    }
    return 0;
}

static size_t r55_put_u32(uint8_t *bytes, size_t offset, uint32_t value)
{
    bytes[offset++] = (uint8_t)value;
    bytes[offset++] = (uint8_t)(value >> 8u);
    bytes[offset++] = (uint8_t)(value >> 16u);
    bytes[offset++] = (uint8_t)(value >> 24u);
    return offset;
}

static size_t r55_put_u64(uint8_t *bytes, size_t offset, uint64_t value)
{
    uint32_t index;
    for (index = 0; index < 8u; ++index)
        bytes[offset++] = (uint8_t)(value >> (index * 8u));
    return offset;
}

static size_t r55_family_replay_bytes(const r55_family *family,
                                      uint32_t source_generator,
                                      uint32_t tie, uint32_t arm,
                                      uint64_t tie_salt,
                                      uint8_t bytes[256])
{
    static const uint8_t magic[8] = {'R','5','5','R','0','0','0','1'};
    size_t offset = 0;
    uint32_t role, slot;
    memcpy(bytes + offset, magic, sizeof(magic)); offset += sizeof(magic);
    for (role = 0; role < R55_ROLES; ++role) {
        memcpy(bytes + offset, family->primitive_by_role[role].matrix,
               sizeof(family->primitive_by_role[role].matrix));
        offset += sizeof(family->primitive_by_role[role].matrix);
        memcpy(bytes + offset, family->primitive_by_role[role].bias,
               sizeof(family->primitive_by_role[role].bias));
        offset += sizeof(family->primitive_by_role[role].bias);
    }
    memcpy(bytes + offset, family->surface_to_role,
           sizeof(family->surface_to_role));
    offset += sizeof(family->surface_to_role);
    for (slot = 0; slot < R55_PRIMITIVES; ++slot)
        offset = r55_put_u32(bytes, offset, family->surface_id[slot]);
    memcpy(bytes + offset, family->target_roles,
           sizeof(family->target_roles));
    offset += sizeof(family->target_roles);
    memcpy(bytes + offset, family->target.matrix,
           sizeof(family->target.matrix));
    offset += sizeof(family->target.matrix);
    memcpy(bytes + offset, family->target.bias,
           sizeof(family->target.bias));
    offset += sizeof(family->target.bias);
    memcpy(bytes + offset, family->example_input,
           sizeof(family->example_input));
    offset += sizeof(family->example_input);
    memcpy(bytes + offset, family->example_output,
           sizeof(family->example_output));
    offset += sizeof(family->example_output);
    bytes[offset++] = family->generator_id;
    offset = r55_put_u32(bytes, offset, family->ordinal);
    offset = r55_put_u64(bytes, offset, family->family_seed);
    offset = r55_put_u64(bytes, offset, tie_salt);
    bytes[offset++] = (uint8_t)source_generator;
    bytes[offset++] = (uint8_t)tie;
    bytes[offset++] = (uint8_t)arm;
    return offset;
}

static size_t r55_artifact_bytes(const r55_artifact *artifact,
                                 uint8_t bytes[R55_ARTIFACT_MAX_BYTES])
{
    static const uint8_t magic[8] = {'R','5','5','A','0','0','0','1'};
    size_t offset = 0;
    uint32_t generator, position, role, next;
    memcpy(bytes + offset, magic, sizeof(magic)); offset += sizeof(magic);
    bytes[offset++] = R55_MODULUS;
    bytes[offset++] = R55_LANES;
    bytes[offset++] = R55_ROLES;
    bytes[offset++] = R55_PROGRAM_LEN;
    bytes[offset++] = R55_GENERATORS;
    for (generator = 0; generator < R55_GENERATORS; ++generator) {
        const r55_guide *guide = &artifact->guides[generator];
        bytes[offset++] = guide->generator_id;
        offset = r55_put_u32(bytes, offset, guide->source_families);
        offset = r55_put_u32(bytes, offset, guide->source_solutions);
        for (position = 0; position < R55_PROGRAM_LEN; ++position)
            for (role = 0; role < R55_ROLES; ++role)
                offset = r55_put_u32(bytes, offset,
                    guide->position_count[position][role]);
        for (position = 0; position + 1u < R55_PROGRAM_LEN; ++position)
            for (role = 0; role < R55_ROLES; ++role)
                for (next = 0; next < R55_ROLES; ++next)
                    offset = r55_put_u32(bytes, offset,
                        guide->transition_count[position][role][next]);
    }
    return offset;
}

static void r55_finish_artifact(r55_artifact *artifact)
{
    uint8_t bytes[R55_ARTIFACT_MAX_BYTES];
    r55_sha256 sha;
    artifact->canonical_bytes = r55_artifact_bytes(artifact, bytes);
    r55_sha256_init(&sha);
    r55_sha256_update(&sha, bytes, artifact->canonical_bytes);
    r55_sha256_final(&sha, artifact->digest);
}

static int r55_reconstruct_adapter(const r55_family *family,
                                   r55_affine recovered[R55_PRIMITIVES],
                                   uint8_t roles[R55_PRIMITIVES],
                                   uint32_t *domain_checks)
{
    uint32_t slot, column, row;
    for (slot = 0; slot < R55_PRIMITIVES; ++slot) {
        const r55_affine *runtime =
            &family->primitive_by_role[family->surface_to_role[slot]];
        uint8_t zero[R55_LANES] = {0u, 0u, 0u};
        uint8_t output[R55_LANES];
        memset(&recovered[slot], 0, sizeof(recovered[slot]));
        r55_apply(runtime, zero, recovered[slot].bias);
        for (column = 0; column < R55_LANES; ++column) {
            uint8_t basis[R55_LANES] = {0u, 0u, 0u};
            basis[column] = 1u;
            r55_apply(runtime, basis, output);
            for (row = 0; row < R55_LANES; ++row)
                recovered[slot].matrix[row * R55_LANES + column] =
                    r55_mod((int32_t)output[row] - recovered[slot].bias[row]);
        }
        if (!r55_affine_equal(runtime, &recovered[slot])) return 1;
        roles[slot] = r55_role_of(&recovered[slot]);
        if (roles[slot] != family->surface_to_role[slot]) return 1;
        for (uint8_t x0 = 0; x0 < R55_MODULUS; ++x0)
            for (uint8_t x1 = 0; x1 < R55_MODULUS; ++x1)
                for (uint8_t x2 = 0; x2 < R55_MODULUS; ++x2) {
                    uint8_t input[R55_LANES] = {x0, x1, x2};
                    uint8_t expected[R55_LANES], actual[R55_LANES];
                    r55_apply(runtime, input, expected);
                    r55_apply(&recovered[slot], input, actual);
                    ++*domain_checks;
                    if (memcmp(expected, actual, sizeof(actual)) != 0) return 1;
                }
    }
    return 0;
}

static uint64_t r55_guide_score(const r55_guide *guide,
                                const uint8_t roles[R55_PROGRAM_LEN],
                                int frequency_only)
{
    uint64_t score = 1u;
    uint32_t position;
    uint32_t scale = guide->source_solutions > 512u ?
        (guide->source_solutions + 511u) / 512u : 1u;
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        score *= 1u + guide->position_count[position][roles[position]] / scale;
    if (!frequency_only)
        for (position = 0; position + 1u < R55_PROGRAM_LEN; ++position)
            score *= 1u + guide->transition_count[position]
                [roles[position]][roles[position + 1u]] / scale;
    return score;
}

static void r55_fill_candidate(const r55_family *family,
                               const uint8_t mapped_role[R55_PRIMITIVES],
                               const r55_guide *guide, int frequency_only,
                               int ignore_evidence, uint64_t tie_salt,
                               uint16_t syntax_index,
                               r55_candidate *candidate)
{
    uint8_t observed[R55_LANES];
    uint32_t position;
    memset(candidate, 0, sizeof(*candidate));
    candidate->syntax_index = syntax_index;
    r55_program_tokens(syntax_index, candidate->token);
    for (position = 0; position < R55_PROGRAM_LEN; ++position)
        candidate->role[position] = mapped_role[candidate->token[position]];
    candidate->semantic = r55_program_from_surface(family, candidate->token);
    r55_public_program_apply(family, candidate->token,
        family->example_input, observed);
    candidate->evidence_loss = ignore_evidence ? 0u :
        (uint8_t)(memcmp(observed, family->example_output,
                         sizeof(observed)) != 0);
    candidate->prior = guide ?
        r55_guide_score(guide, candidate->role, frequency_only) : 0u;
    candidate->tie = r55_mix64(tie_salt ^
        ((uint64_t)syntax_index * UINT64_C(0x9e3779b97f4a7c15)));
}

static int r55_candidate_compare(const void *left_pointer,
                                 const void *right_pointer)
{
    const r55_candidate *left = left_pointer;
    const r55_candidate *right = right_pointer;
    if (left->evidence_loss != right->evidence_loss)
        return left->evidence_loss < right->evidence_loss ? -1 : 1;
    if (left->prior != right->prior)
        return left->prior > right->prior ? -1 : 1;
    if (left->tie != right->tie)
        return left->tie < right->tie ? -1 : 1;
    if (left->syntax_index != right->syntax_index)
        return left->syntax_index < right->syntax_index ? -1 : 1;
    return 0;
}

static int r55_build_jit_guide(const r55_family *family,
                               const uint8_t recovered_role[R55_PRIMITIVES],
                               r55_guide *guide)
{
    uint16_t index;
    memset(guide, 0, sizeof(*guide));
    guide->generator_id = UINT8_MAX;
    for (index = 0; index < R55_CANDIDATES; ++index) {
        uint8_t token[R55_PROGRAM_LEN];
        uint8_t roles[R55_PROGRAM_LEN];
        uint8_t observed[R55_LANES];
        uint32_t position;
        r55_program_tokens(index, token);
        r55_public_program_apply(family, token, family->example_input, observed);
        if (memcmp(observed, family->example_output, sizeof(observed)) != 0)
            continue;
        for (position = 0; position < R55_PROGRAM_LEN; ++position)
            roles[position] = recovered_role[token[position]];
        r55_guide_add(guide, roles);
    }
    return guide->source_solutions == 0u;
}

static int r55_seen_add(r55_seen *seen, uint32_t key)
{
    uint32_t slot = (key * UINT32_C(2654435761)) & (R55_SEEN_SLOTS - 1u);
    uint32_t probe;
    for (probe = 0; probe < R55_SEEN_SLOTS; ++probe) {
        uint32_t current = (slot + probe) & (R55_SEEN_SLOTS - 1u);
        if (!seen->used[current]) {
            seen->used[current] = 1u;
            seen->key[current] = key;
            return 1;
        }
        if (seen->key[current] == key) return 0;
    }
    return -1;
}

static int r55_exact_verify(const r55_affine *candidate,
                            const r55_affine *target,
                            uint32_t *first_counterexample)
{
    uint32_t ordinal = 0;
    int exact = 1;
    uint8_t x0, x1, x2;
    *first_counterexample = UINT32_MAX;
    for (x0 = 0; x0 < R55_MODULUS; ++x0)
        for (x1 = 0; x1 < R55_MODULUS; ++x1)
            for (x2 = 0; x2 < R55_MODULUS; ++x2, ++ordinal) {
                uint8_t input[R55_LANES] = {x0, x1, x2};
                uint8_t left[R55_LANES], right[R55_LANES];
                r55_apply(candidate, input, left);
                r55_apply(target, input, right);
                if (exact && memcmp(left, right, sizeof(left)) != 0) {
                    *first_counterexample = ordinal;
                    exact = 0;
                }
            }
    return exact;
}

static int r55_make_derangements(
    uint8_t output[R55_DERANGEMENTS][R55_ROLES])
{
    static const uint8_t frozen[R55_DERANGEMENTS][R55_ROLES] = {
        {6,3,5,0,2,7,4,1}, {2,7,4,5,0,6,3,1}, {2,6,1,5,3,7,0,4},
        {1,6,4,7,5,0,3,2}, {7,3,1,6,0,4,2,5}, {3,4,5,0,7,6,2,1},
        {2,0,5,4,3,6,7,1}, {1,0,4,7,3,2,5,6}, {5,0,6,4,1,7,2,3},
        {5,3,4,1,0,7,2,6}, {4,3,5,6,2,0,7,1}, {1,0,5,6,7,3,2,4},
        {4,3,5,7,0,6,1,2}, {5,3,6,7,2,0,4,1}, {3,5,4,6,7,0,1,2},
        {3,5,7,0,2,4,1,6}, {7,5,6,1,0,3,4,2}, {7,4,6,1,0,3,2,5},
        {7,2,0,6,5,1,3,4}, {3,2,1,6,7,0,5,4}, {5,3,1,4,2,0,7,6},
        {6,4,3,1,5,7,2,0}, {5,6,3,0,7,1,2,4}, {7,4,0,6,1,3,5,2},
        {1,3,6,7,5,2,0,4}, {2,6,4,0,5,1,7,3}, {2,4,3,5,6,7,0,1},
        {2,5,1,6,7,3,0,4}, {3,0,7,1,5,2,4,6}, {2,0,6,7,3,1,5,4},
        {4,6,7,0,2,1,5,3}
    };
    memcpy(output, frozen, sizeof(frozen));
    return 0;
}

static void r55_digest_map(const r55_affine *map, uint8_t digest[32])
{
    r55_digest("reasoner55-affine", map, sizeof(*map), digest);
}

static void r55_digest_family_parts(const r55_family *family,
                                    uint8_t ast[32], uint8_t behavior[32],
                                    uint8_t specification[32],
                                    uint8_t evidence[32],
                                    uint8_t potential[32])
{
    uint8_t buffer[256];
    size_t offset = 0;
    uint32_t slot;
    r55_digest("reasoner55-target-ast", family->target_roles,
               sizeof(family->target_roles), ast);
    r55_digest_map(&family->target, behavior);
    for (slot = 0; slot < R55_PRIMITIVES; ++slot) {
        memcpy(buffer + offset, &family->surface_id[slot],
               sizeof(family->surface_id[slot]));
        offset += sizeof(family->surface_id[slot]);
        buffer[offset++] = family->surface_to_role[slot];
    }
    memcpy(buffer + offset, family->target_roles,
           sizeof(family->target_roles)); offset += sizeof(family->target_roles);
    memcpy(buffer + offset, family->example_input,
           sizeof(family->example_input)); offset += sizeof(family->example_input);
    memcpy(buffer + offset, family->example_output,
           sizeof(family->example_output)); offset += sizeof(family->example_output);
    r55_digest("reasoner55-episode-spec", buffer, offset, specification);
    offset = 0;
    for (slot = 0; slot < R55_PRIMITIVES; ++slot) {
        const r55_affine *map =
            &family->primitive_by_role[family->surface_to_role[slot]];
        memcpy(buffer + offset, &family->surface_id[slot],
               sizeof(family->surface_id[slot]));
        offset += sizeof(family->surface_id[slot]);
        memcpy(buffer + offset, map, sizeof(*map)); offset += sizeof(*map);
    }
    memcpy(buffer + offset, family->example_input,
           sizeof(family->example_input)); offset += sizeof(family->example_input);
    memcpy(buffer + offset, family->example_output,
           sizeof(family->example_output)); offset += sizeof(family->example_output);
    r55_digest("reasoner55-initial-evidence", buffer, offset, evidence);
    r55_digest("reasoner55-potential-response", buffer,
               (size_t)R55_PRIMITIVES * (sizeof(uint32_t) + sizeof(r55_affine)),
               potential);
}

static int r55_key_compare(const void *left, const void *right)
{
    uint32_t a = *(const uint32_t *)left;
    uint32_t b = *(const uint32_t *)right;
    return a < b ? -1 : a > b;
}

static uint32_t r55_candidate_universe(const r55_family *family,
                                       uint8_t digest[32])
{
    uint32_t keys[R55_CANDIDATES];
    uint8_t canonical[R55_CANDIDATES * 4u];
    uint32_t index;
    uint32_t distinct = 0;
    for (index = 0; index < R55_CANDIDATES; ++index) {
        uint8_t token[R55_PROGRAM_LEN];
        r55_affine map;
        r55_program_tokens((uint16_t)index, token);
        map = r55_program_from_surface(family, token);
        keys[index] = r55_semantic_key(&map);
    }
    qsort(keys, R55_CANDIDATES, sizeof(keys[0]), r55_key_compare);
    for (index = 0; index < R55_CANDIDATES; ++index) {
        if (index == 0u || keys[index] != keys[index - 1u]) ++distinct;
        r55_put_u32(canonical, (size_t)index * 4u, keys[index]);
    }
    r55_digest("reasoner55-candidate-semantic-multiset", canonical,
               sizeof(canonical), digest);
    return distinct;
}

static int r55_search_candidate(r55_seen *seen, const r55_candidate *candidate,
                                const r55_affine *target,
                                r55_search_result *result,
                                uint32_t global_cap)
{
    uint32_t key = r55_semantic_key(&candidate->semantic);
    uint32_t counterexample;
    int fresh;
    ++result->partial_expansions;
    fresh = r55_seen_add(seen, key);
    if (fresh < 0) return -1;
    if (!fresh) return 0;
    if (result->verifier_checks >= global_cap) {
        result->global_cap_hit = 1u;
        return 1;
    }
    ++result->verifier_checks;
    if (r55_exact_verify(&candidate->semantic, target, &counterexample)) {
        result->exact = 1u;
        result->certificate_valid = 1u;
        r55_digest_map(&candidate->semantic, result->accepted_semantic);
        return 2;
    }
    if (result->verifier_checks == 1u)
        result->first_counterexample = counterexample;
    return 0;
}

static int r55_search(const r55_family *family,
                      const uint8_t recovered_role[R55_PRIMITIVES],
                      const r55_guide *source_guide,
                      const r55_guide *jit_guide,
                      uint32_t arm,
                      const uint8_t derangements[R55_DERANGEMENTS][R55_ROLES],
                      uint64_t tie_salt, uint32_t proposal_budget,
                      uint32_t global_cap, r55_search_result *result)
{
    r55_candidate ranked[R55_CANDIDATES];
    uint8_t mapped_role[R55_PRIMITIVES];
    const r55_guide *guide = NULL;
    int frequency_only = 0;
    int ignore_evidence = 0;
    uint32_t slot, index;
    r55_seen seen;
    r55_sha256 order_sha;
    r55_candidate injection;
    int state;
    memset(result, 0, sizeof(*result));
    memset(&seen, 0, sizeof(seen));
    result->first_counterexample = UINT32_MAX;
    result->partial_expansions = R55_CANDIDATES;
    for (slot = 0; slot < R55_PRIMITIVES; ++slot)
        mapped_role[slot] = recovered_role[slot];
    if (arm == R55_ARM_RAW_LEXICAL || arm == R55_ARM_FREQUENCY_LEXICAL ||
        arm == R55_ARM_SOURCE_ONLY)
        for (slot = 0; slot < R55_PRIMITIVES; ++slot)
            mapped_role[slot] = (uint8_t)(family->surface_id[slot] % R55_ROLES);
    if (arm == R55_ARM_ORACLE_ADAPTER)
        for (slot = 0; slot < R55_PRIMITIVES; ++slot)
            mapped_role[slot] = family->surface_to_role[slot];
    if (arm >= R55_BASE_ARMS) {
        uint32_t shuffle = arm - R55_BASE_ARMS;
        for (slot = 0; slot < R55_PRIMITIVES; ++slot)
            mapped_role[slot] = derangements[shuffle][recovered_role[slot]];
    }
    if (arm == R55_ARM_RAW_LEXICAL || arm == R55_ARM_FULL ||
        arm == R55_ARM_ORACLE_ADAPTER || arm == R55_ARM_FREQUENCY_LEXICAL ||
        arm == R55_ARM_SOURCE_ONLY || arm >= R55_BASE_ARMS) {
        guide = source_guide;
        result->source_artifact_reads = R55_CANONICAL_GUIDE_BYTES;
    } else if (arm == R55_ARM_SOURCE_FREE_JIT ||
               arm == R55_ARM_SOURCE_ABLATION) {
        guide = jit_guide;
        result->partial_expansions += R55_CANDIDATES;
    }
    if (arm == R55_ARM_ADAPTER_ONLY || arm == R55_ARM_FULL ||
        arm == R55_ARM_SOURCE_FREE_JIT || arm == R55_ARM_SOURCE_ABLATION ||
        arm >= R55_BASE_ARMS)
        result->observation_queries = R55_PRIMITIVES * (R55_LANES + 1u);
    frequency_only = arm == R55_ARM_FREQUENCY_LEXICAL;
    ignore_evidence = arm == R55_ARM_SOURCE_ONLY;
    for (index = 0; index < R55_CANDIDATES; ++index) {
        r55_fill_candidate(family, mapped_role, guide, frequency_only,
            ignore_evidence, tie_salt, (uint16_t)index, &ranked[index]);
    }
    qsort(ranked, R55_CANDIDATES, sizeof(ranked[0]), r55_candidate_compare);
    r55_sha256_init(&order_sha);
    for (index = 0; index < R55_CANDIDATES; ++index) {
        uint32_t key = r55_semantic_key(&ranked[index].semantic);
        uint8_t canonical[4];
        r55_put_u32(canonical, 0u, key);
        r55_sha256_update(&order_sha, canonical, sizeof(canonical));
    }
    r55_sha256_final(&order_sha, result->proposal_order);
    injection = ranked[0];
    for (index = 0; index < R55_CANDIDATES; ++index)
        if (!r55_affine_equal(&ranked[index].semantic, &family->target)) {
            injection = ranked[index];
            break;
        }
    state = r55_search_candidate(&seen, &injection, &family->target,
                                 result, global_cap);
    if (state != 0) return state < 0 ? 1 : 0;
    result->invalid_first_rejected = 1u;
    if (proposal_budget > R55_CANDIDATES) proposal_budget = R55_CANDIDATES;
    for (index = 0; index < proposal_budget; ++index) {
        state = r55_search_candidate(&seen, &ranked[index], &family->target,
                                     result, global_cap);
        if (state < 0) return 1;
        if (state == 1 || state == 2) break;
    }
    if (!result->exact && !result->global_cap_hit) {
        result->fallback_started = 1u;
        for (index = 0; index < R55_CANDIDATES; ++index) {
            r55_candidate candidate;
            r55_fill_candidate(family, mapped_role, guide, frequency_only,
                ignore_evidence, tie_salt, (uint16_t)index, &candidate);
            state = r55_search_candidate(&seen, &candidate, &family->target,
                                         result, global_cap);
            if (state < 0) return 1;
            if (state == 1 || state == 2) break;
        }
        if (!result->exact) result->global_cap_hit = 1u;
    }
    if (!result->exact && result->verifier_checks >= global_cap)
        result->global_cap_hit = 1u;
    result->primary_cost = result->global_cap_hit ?
        global_cap + 1u : result->verifier_checks;
    return 0;
}

const char *r55_generator_name(uint32_t generator)
{
    return generator == R55_GENERATOR_SYNTAX_FIRST ?
        "syntax-first" : "skeleton-first";
}

const char *r55_arm_name(uint32_t arm, char buffer[24])
{
    static const char *base[R55_BASE_ARMS] = {
        "target_only", "adapter_only", "raw_lexical", "full",
        "oracle_adapter", "frequency_lexical", "source_free_jit",
        "source_ablation", "source_only"
    };
    if (arm < R55_BASE_ARMS) return base[arm];
    snprintf(buffer, 24u, "shuffled_%02u", arm - R55_BASE_ARMS);
    return buffer;
}

static int r55_same_search(const r55_search_result *left,
                           const r55_search_result *right)
{
    return left->primary_cost == right->primary_cost &&
        left->verifier_checks == right->verifier_checks &&
        left->partial_expansions == right->partial_expansions &&
        left->exact == right->exact &&
        left->certificate_valid == right->certificate_valid &&
        left->fallback_started == right->fallback_started &&
        left->global_cap_hit == right->global_cap_hit &&
        left->invalid_first_rejected == right->invalid_first_rejected &&
        memcmp(left->accepted_semantic, right->accepted_semantic, 32u) == 0 &&
        memcmp(left->proposal_order, right->proposal_order, 32u) == 0;
}

static int r55_emit_trace(FILE *trace, r55_sha256 *trace_sha,
                          const r55_family *family, uint32_t source_generator,
                          uint32_t tie, uint32_t arm,
                          uint64_t tie_salt,
                          const uint8_t source_artifact_sha256[32],
                          const r55_search_result *search,
                          const uint8_t candidate_digest[32],
                          const uint8_t ast[32], const uint8_t behavior[32],
                          const uint8_t specification[32],
                          const uint8_t evidence[32],
                          const uint8_t potential[32])
{
    static const char grammar[] = "gf5-v3-eight-affine-roles-length4";
    static const char actions[] = "rank-propose-verify-fallback";
    static const char verifier[] = "exhaustive-gf5-v3-125-vectors";
    static const char caps[] = "proposal64-global4096-cap-plus-one";
    uint8_t grammar_digest[32], actions_digest[32], verifier_digest[32];
    uint8_t caps_digest[32];
    char candidate_hex[65], ast_hex[65], behavior_hex[65], spec_hex[65];
    char evidence_hex[65], potential_hex[65], grammar_hex[65];
    char actions_hex[65], verifier_hex[65], caps_hex[65], accepted_hex[65];
    uint8_t replay_bytes[256], replay_sha256[32];
    char replay_hex[513], replay_sha256_hex[65], artifact_hex[65];
    char order_hex[65], arm_buffer[24], line[8192];
    const char *arm_name = r55_arm_name(arm, arm_buffer);
    const char *source_name = r55_generator_name(source_generator);
    const char *target_name = r55_generator_name(family->generator_id);
    const char *relation = source_generator == family->generator_id ?
        "same-generator" : "cross-generator";
    int length;
    size_t replay_length, replay_index;
    r55_digest("reasoner55-grammar", grammar, sizeof(grammar) - 1u,
               grammar_digest);
    r55_digest("reasoner55-actions", actions, sizeof(actions) - 1u,
               actions_digest);
    r55_digest("reasoner55-verifier", verifier, sizeof(verifier) - 1u,
               verifier_digest);
    r55_digest("reasoner55-caps", caps, sizeof(caps) - 1u, caps_digest);
    r55_hex(candidate_digest, candidate_hex); r55_hex(ast, ast_hex);
    r55_hex(behavior, behavior_hex); r55_hex(specification, spec_hex);
    r55_hex(evidence, evidence_hex); r55_hex(potential, potential_hex);
    r55_hex(grammar_digest, grammar_hex); r55_hex(actions_digest, actions_hex);
    r55_hex(verifier_digest, verifier_hex); r55_hex(caps_digest, caps_hex);
    r55_hex(search->accepted_semantic, accepted_hex);
    r55_hex(search->proposal_order, order_hex);
    replay_length = r55_family_replay_bytes(family, source_generator, tie,
                                            arm, tie_salt, replay_bytes);
    for (replay_index = 0; replay_index < replay_length; ++replay_index)
        snprintf(replay_hex + replay_index * 2u, 3u, "%02x",
                 replay_bytes[replay_index]);
    replay_hex[replay_length * 2u] = '\0';
    {
        r55_sha256 replay_sha;
        r55_sha256_init(&replay_sha);
        r55_sha256_update(&replay_sha, replay_bytes, replay_length);
        r55_sha256_final(&replay_sha, replay_sha256);
    }
    r55_hex(replay_sha256, replay_sha256_hex);
    r55_hex(source_artifact_sha256, artifact_hex);
    length = snprintf(line, sizeof(line),
        "{\"schema\":\"zero.reasoner55_trace_row.v1\","
        "\"experiment\":\"reasoner55-generated-primitive-transfer-v1\","
        "\"lane\":\"development\",\"source_generator_id\":\"%s\","
        "\"generator_id\":\"%s\","
        "\"family_id\":\"development-%s-%03u\","
        "\"cross_family_id\":null,"
        "\"episode_id\":\"%s-to-%s-%03u-tie-%u\","
        "\"nested_repeat_id\":\"tie-%u\","
        "\"shift_stratum\":\"generated-affine\","
        "\"generator_relation\":\"%s\","
        "\"arm\":\"%s\",\"exact\":%s,\"certificate_valid\":%s,"
        "\"premature_commit\":false,\"primary_cost\":%u,"
        "\"verifier_checks\":%u,\"partial_expansions\":%u,"
        "\"observation_queries\":%u,\"wall_ns\":null,\"peak_bytes\":null,"
        "\"verifier_domain_points\":125,"
        "\"fallback_started\":%s,\"fallback_work_counted\":true,"
        "\"global_cap_hit\":%s,\"injected_invalid\":true,"
        "\"injected_invalid_rejected\":%s,"
        "\"injected_counterexample_index\":%u,"
        "\"ast_sha256\":\"%s\",\"behavior_sha256\":\"%s\","
        "\"episode_spec_sha256\":\"%s\","
        "\"allowed_actions_digest\":\"%s\","
        "\"latent_episode_digest\":\"%s\","
        "\"potential_response_digest\":\"%s\","
        "\"candidate_universe_digest\":\"%s\","
        "\"initial_evidence_digest\":\"%s\","
        "\"grammar_digest\":\"%s\",\"verifier_digest\":\"%s\","
        "\"caps_digest\":\"%s\",\"source_artifact_reads\":%u,"
        "\"accepted_semantic_sha256\":\"%s\","
        "\"proposal_order_sha256\":\"%s\","
        "\"source_artifact_sha256\":\"%s\","
        "\"family_replay_sha256\":\"%s\","
        "\"family_replay_hex\":\"%s\"}\n",
        source_name, target_name, target_name, family->ordinal,
        source_name, target_name, family->ordinal, tie, tie, relation, arm_name,
        search->exact ? "true" : "false",
        search->certificate_valid ? "true" : "false",
        search->primary_cost, search->verifier_checks,
        search->partial_expansions, search->observation_queries,
        search->fallback_started ? "true" : "false",
        search->global_cap_hit ? "true" : "false",
        search->invalid_first_rejected ? "true" : "false",
        search->first_counterexample,
        ast_hex, behavior_hex, spec_hex, actions_hex, behavior_hex,
        potential_hex, candidate_hex, evidence_hex, grammar_hex,
        verifier_hex, caps_hex, search->source_artifact_reads,
        accepted_hex, order_hex, artifact_hex, replay_sha256_hex, replay_hex);
    if (length < 0 || (size_t)length >= sizeof(line)) return 1;
    if (fwrite(line, (size_t)length, 1u, trace) != 1u) return 1;
    r55_sha256_update(trace_sha, line, (size_t)length);
    return 0;
}

int r55_run_development(r55_development_result *result,
                        r55_artifact *artifact, FILE *trace)
{
    r55_affine used[R55_GENERATORS *
        (R55_SOURCE_FAMILIES + R55_DEVELOPMENT_FAMILIES)];
    r55_family development[R55_GENERATORS][R55_DEVELOPMENT_FAMILIES];
    uint32_t used_count = 0;
    uint32_t used_ast[R55_GENERATORS *
        (R55_SOURCE_FAMILIES + R55_DEVELOPMENT_FAMILIES)];
    uint32_t used_ast_count = 0;
    uint8_t derangements[R55_DERANGEMENTS][R55_ROLES];
    uint32_t target_costs[R55_GENERATORS * R55_GENERATORS *
        R55_DEVELOPMENT_FAMILIES * R55_TIE_REPEATS];
    uint32_t target_cost_count = 0;
    r55_sha256 trace_sha;
    uint32_t target_generator, ordinal, source_generator, tie, arm;
    memset(result, 0, sizeof(*result));
    if (!trace) return 1;
    if (r55_make_derangements(derangements) != 0) return 1;
    if (r55_build_source_artifact(artifact, used, &used_count,
                                  used_ast, &used_ast_count, result) != 0)
        return 1;
    r55_finish_artifact(artifact);
    memcpy(result->artifact_sha256, artifact->digest, 32u);
    result->source_families = R55_GENERATORS * R55_SOURCE_FAMILIES;
    result->development_families =
        R55_GENERATORS * R55_DEVELOPMENT_FAMILIES;
    result->generator_environments = R55_GENERATORS * R55_GENERATORS;
    for (target_generator = 0; target_generator < R55_GENERATORS;
         ++target_generator)
        for (ordinal = 0; ordinal < R55_DEVELOPMENT_FAMILIES; ++ordinal)
            if (r55_make_unique_family(
                    &development[target_generator][ordinal],
                    R55_DEVELOPMENT_ROOT, (uint8_t)target_generator, ordinal,
                    used, &used_count, used_ast, &used_ast_count) != 0)
                return 1;
            else if (r55_record_family_receipt(
                    result, &development[target_generator][ordinal], 1u) != 0)
                return 1;
    for (ordinal = 0; ordinal < R55_DEVELOPMENT_FAMILIES; ++ordinal)
        result->generator_sequence_differences += memcmp(
            development[0][ordinal].target_roles,
            development[1][ordinal].target_roles, R55_PROGRAM_LEN) != 0;
    r55_sha256_init(&trace_sha);
    for (target_generator = 0; target_generator < R55_GENERATORS;
         ++target_generator) {
        for (ordinal = 0; ordinal < R55_DEVELOPMENT_FAMILIES; ++ordinal) {
            r55_family *family = &development[target_generator][ordinal];
            r55_affine recovered[R55_PRIMITIVES];
            uint8_t recovered_role[R55_PRIMITIVES];
            r55_guide jit_guide;
            uint8_t candidate_digest[32], ast[32], behavior[32];
            uint8_t specification[32], evidence[32], potential[32];
            uint32_t distinct = r55_candidate_universe(family,
                                                       candidate_digest);
            uint32_t domain_checks = 0;
            result->semantic_collisions += R55_CANDIDATES - distinct;
            ++result->adapter_reconstructions;
            if (r55_reconstruct_adapter(family, recovered, recovered_role,
                                        &domain_checks) == 0)
                ++result->adapter_exact;
            else
                return 1;
            result->adapter_domain_checks += domain_checks;
            if (r55_build_jit_guide(family, recovered_role, &jit_guide) != 0)
                return 1;
            r55_digest_family_parts(family, ast, behavior, specification,
                                    evidence, potential);
            for (source_generator = 0; source_generator < R55_GENERATORS;
                 ++source_generator) {
                for (tie = 0; tie < R55_TIE_REPEATS; ++tie) {
                    r55_search_result episode[R55_ARMS];
                    uint64_t tie_salt = r55_mix64(family->family_seed ^
                        ((uint64_t)source_generator << 48u) ^ tie ^
                        R55_TIE_NAMESPACE);
                    ++result->episodes;
                    for (arm = 0; arm < R55_ARMS; ++arm) {
                        if (r55_search(family, recovered_role,
                                &artifact->guides[source_generator],
                                &jit_guide, arm, derangements, tie_salt,
                                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP,
                                &episode[arm]) != 0)
                            return 1;
                        result->arms[arm].primary_cost +=
                            episode[arm].primary_cost;
                        result->arms[arm].verifier_checks +=
                            episode[arm].verifier_checks;
                        result->arms[arm].partial_expansions +=
                            episode[arm].partial_expansions;
                        result->arms[arm].exact_answers += episode[arm].exact;
                        result->arms[arm].fallback_episodes +=
                            episode[arm].fallback_started;
                        result->arms[arm].global_cap_hits +=
                            episode[arm].global_cap_hit;
                        result->arms[arm].invalid_first_rejected +=
                            episode[arm].invalid_first_rejected;
                        if (r55_emit_trace(trace, &trace_sha, family,
                                source_generator, tie, arm, tie_salt,
                                artifact->digest, &episode[arm],
                                candidate_digest, ast, behavior,
                                specification, evidence, potential) != 0)
                            return 1;
                        ++result->trace_rows;
                    }
                    ++result->source_ablation_cases;
                    result->source_ablation_matches += r55_same_search(
                        &episode[R55_ARM_SOURCE_FREE_JIT],
                        &episode[R55_ARM_SOURCE_ABLATION]);
                    ++result->full_oracle_cases;
                    result->full_oracle_matches += r55_same_search(
                        &episode[R55_ARM_FULL],
                        &episode[R55_ARM_ORACLE_ADAPTER]);
                    target_costs[target_cost_count++] =
                        episode[R55_ARM_TARGET_ONLY].primary_cost;
                }
            }
        }
    }
    r55_sha256_final(&trace_sha, result->trace_sha256);
    qsort(target_costs, target_cost_count, sizeof(target_costs[0]),
          r55_key_compare);
    result->target_only_minimum_cost = target_costs[0];
    result->target_only_maximum_cost = target_costs[target_cost_count - 1u];
    result->target_only_median_cost = target_cost_count % 2u ?
        target_costs[target_cost_count / 2u] :
        (target_costs[target_cost_count / 2u - 1u] +
         target_costs[target_cost_count / 2u]) / 2u;
    return 0;
}

static int r55_sha_self_test(void)
{
    static const uint8_t expected[32] = {
        0xe3u, 0xb0u, 0xc4u, 0x42u, 0x98u, 0xfcu, 0x1cu, 0x14u,
        0x9au, 0xfbu, 0xf4u, 0xc8u, 0x99u, 0x6fu, 0xb9u, 0x24u,
        0x27u, 0xaeu, 0x41u, 0xe4u, 0x64u, 0x9bu, 0x93u, 0x4cu,
        0xa4u, 0x95u, 0x99u, 0x1bu, 0x78u, 0x52u, 0xb8u, 0x55u
    };
    r55_sha256 sha;
    uint8_t actual[32];
    r55_sha256_init(&sha);
    r55_sha256_final(&sha, actual);
    return memcmp(actual, expected, sizeof(actual)) != 0;
}

int r55_self_test(void)
{
    r55_family a, replay, b;
    r55_affine recovered[R55_PRIMITIVES];
    uint8_t recovered_role[R55_PRIMITIVES];
    uint32_t checks = 0;
    uint8_t derangements[R55_DERANGEMENTS][R55_ROLES];
    uint32_t shuffle, role;
    uint8_t candidate_digest[32];
    uint32_t distinct;
    r55_guide jit;
    r55_search_result capped, exhausted, jit_result, ablated_result;
    r55_search_result full_exact, full_poisoned;
    r55_search_result oracle_exact, oracle_poisoned;
    r55_search_result source_exact, source_poisoned;
    r55_affine impossible;
    uint8_t input[R55_LANES] = {2u, 3u, 4u};
    uint8_t sequential[R55_LANES], composed[R55_LANES], middle[R55_LANES];
    r55_affine first, second, combined;
    uint64_t tie_salt = UINT64_C(0x55abcdef01234567);
#define R55_TEST(condition, name) do { \
    if (!(condition)) { \
        fprintf(stderr, "Reasoner 5.5 self-test failed: %s\n", name); \
        return 1; \
    } \
} while (0)
    R55_TEST(r55_sha_self_test() == 0, "sha256");
    R55_TEST(r55_generate_family(
        &a, R55_DEVELOPMENT_ROOT, 0u, 0u, 0u) == 0,
        "syntax-first generator");
    R55_TEST(r55_generate_family(
        &replay, R55_DEVELOPMENT_ROOT, 0u, 0u, 0u) == 0,
        "syntax-first replay");
    R55_TEST(r55_generate_family(
        &b, R55_DEVELOPMENT_ROOT, 1u, 0u, 0u) == 0,
        "skeleton-first generator");
    R55_TEST(memcmp(&a, &replay, sizeof(a)) == 0,
             "generator determinism");
    R55_TEST(memcmp(a.target_roles, b.target_roles,
                    R55_PROGRAM_LEN) != 0,
             "generator diversity");
    for (role = 0; role < R55_ROLES; ++role)
        R55_TEST(r55_role_of(&a.primitive_by_role[role]) == role,
                 "primitive role classification");
    R55_TEST(r55_reconstruct_adapter(
        &a, recovered, recovered_role, &checks) == 0,
        "zero-plus-basis reconstruction");
    R55_TEST(checks == R55_PRIMITIVES * R55_DOMAIN_POINTS,
             "adapter exhaustive domain count");
    first = a.primitive_by_role[R55_ROLE_SHEAR];
    second = a.primitive_by_role[R55_ROLE_AFFINE_MIX];
    combined = r55_compose(&second, &first);
    r55_apply(&first, input, middle);
    r55_apply(&second, middle, sequential);
    r55_apply(&combined, input, composed);
    R55_TEST(memcmp(sequential, composed, sizeof(composed)) == 0,
             "affine composition");
    distinct = r55_candidate_universe(&a, candidate_digest);
    R55_TEST(distinct > 0u && distinct < R55_CANDIDATES,
             "semantic collisions");
    R55_TEST(r55_make_derangements(derangements) == 0,
             "derangement construction");
    for (shuffle = 0; shuffle < R55_DERANGEMENTS; ++shuffle)
        for (role = 0; role < R55_ROLES; ++role)
            R55_TEST(derangements[shuffle][role] != role,
                     "derangement fixed point");
    R55_TEST(r55_build_jit_guide(&a, recovered_role, &jit) == 0,
             "source-free guide");
    R55_TEST(r55_search(&a, recovered_role, &jit, &jit,
            R55_ARM_SOURCE_FREE_JIT, derangements, tie_salt,
            R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &jit_result) == 0,
            "source-free search");
    R55_TEST(r55_search(&a, recovered_role, &jit, &jit,
            R55_ARM_SOURCE_ABLATION, derangements, tie_salt,
            R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &ablated_result) == 0,
            "source-ablation search");
    R55_TEST(r55_same_search(&jit_result, &ablated_result),
             "source-ablation equality");
    {
        uint8_t poisoned_role[R55_PRIMITIVES];
        for (role = 0; role < R55_PRIMITIVES; ++role)
            poisoned_role[role] = (uint8_t)((recovered_role[role] + 1u) %
                                             R55_ROLES);
        R55_TEST(r55_search(&a, recovered_role, &jit, &jit,
                R55_ARM_FULL, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &full_exact) == 0 &&
            r55_search(&a, poisoned_role, &jit, &jit,
                R55_ARM_FULL, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &full_poisoned) == 0,
            "full adapter sensitivity setup");
        R55_TEST(!r55_same_search(&full_exact, &full_poisoned),
            "full arm uses reconstructed adapter");
        R55_TEST(r55_search(&a, recovered_role, &jit, &jit,
                R55_ARM_ORACLE_ADAPTER, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &oracle_exact) == 0 &&
            r55_search(&a, poisoned_role, &jit, &jit,
                R55_ARM_ORACLE_ADAPTER, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &oracle_poisoned) == 0 &&
            r55_same_search(&oracle_exact, &oracle_poisoned),
            "oracle bypasses reconstructed adapter");
        R55_TEST(r55_search(&a, recovered_role, &jit, &jit,
                R55_ARM_SOURCE_ONLY, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &source_exact) == 0 &&
            r55_search(&a, poisoned_role, &jit, &jit,
                R55_ARM_SOURCE_ONLY, derangements, tie_salt,
                R55_PROPOSAL_BUDGET, R55_GLOBAL_CAP, &source_poisoned) == 0 &&
            r55_same_search(&source_exact, &source_poisoned),
            "source-only arm has no adapter access");
    }
    impossible = a.target;
    memset(impossible.matrix, 0, sizeof(impossible.matrix));
    memset(impossible.bias, 0, sizeof(impossible.bias));
    {
        r55_family impossible_family = a;
        impossible_family.target = impossible;
        R55_TEST(r55_search(&impossible_family, recovered_role, &jit, &jit,
                R55_ARM_TARGET_ONLY, derangements, tie_salt, 0u, 2u,
                &capped) == 0,
                "capped search");
    }
    R55_TEST(!capped.exact && capped.fallback_started &&
             capped.global_cap_hit && capped.primary_cost == 3u &&
             capped.invalid_first_rejected,
             "cap-plus-one and fallback accounting");
    {
        r55_family impossible_family = a;
        impossible_family.target = impossible;
        R55_TEST(r55_search(&impossible_family, recovered_role, &jit, &jit,
                R55_ARM_TARGET_ONLY, derangements, tie_salt, 0u,
                R55_GLOBAL_CAP, &exhausted) == 0,
                "exhausted fallback search");
    }
    R55_TEST(!exhausted.exact && exhausted.fallback_started &&
             exhausted.global_cap_hit &&
             exhausted.primary_cost == R55_GLOBAL_CAP + 1u &&
             exhausted.verifier_checks < R55_GLOBAL_CAP,
             "exhausted semantic universe is upper-censored");
    {
        uint32_t counterexample;
        r55_affine changed = a.target;
        changed.bias[0] = r55_mod(changed.bias[0] + 1);
        R55_TEST(r55_exact_verify(
            &a.target, &a.target, &counterexample),
            "exact verifier acceptance");
        R55_TEST(!r55_exact_verify(
            &changed, &a.target, &counterexample),
            "exact verifier rejection");
        R55_TEST(counterexample != UINT32_MAX,
                 "exact verifier counterexample");
    }
#undef R55_TEST
    return 0;
}

int r55_write_artifact_hex(const char *path, const r55_artifact *artifact)
{
    uint8_t bytes[R55_ARTIFACT_MAX_BYTES];
    size_t length = r55_artifact_bytes(artifact, bytes);
    size_t index;
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    for (index = 0; index < length; ++index)
        if (fprintf(file, "%02x", bytes[index]) < 0) {
            fclose(file);
            return 1;
        }
    if (fputc('\n', file) == EOF || fclose(file) != 0) return 1;
    return 0;
}

int r55_write_development_json(const char *path,
                               const r55_development_result *result)
{
    FILE *file = fopen(path, "wb");
    uint32_t arm, family_index;
    char artifact[65], trace[65];
    if (!file) return 1;
    r55_hex(result->artifact_sha256, artifact);
    r55_hex(result->trace_sha256, trace);
    if (fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner55_development.v1\",\n"
        "  \"experiment\": \"reasoner55-generated-primitive-transfer-v1\",\n"
        "  \"status\": \"development-only\",\n"
        "  \"execution_authorized\": false,\n"
        "  \"field\": {\"modulus\": 5, \"lanes\": 3, \"points\": 125},\n"
        "  \"program\": {\"primitives\": 8, \"length\": 4, \"syntax_candidates\": 4096},\n"
        "  \"source_families\": %u,\n"
        "  \"development_families\": %u,\n"
        "  \"generator_environments\": %u,\n"
        "  \"episodes\": %u,\n"
        "  \"trace_rows\": %u,\n"
        "  \"adapter\": {\"reconstructions\": %u, \"exact\": %u, \"domain_checks\": %u},\n"
        "  \"generator_sequence_differences\": %u,\n"
        "  \"semantic_collisions\": %u,\n"
        "  \"source_ablation\": {\"matches\": %u, \"cases\": %u},\n"
        "  \"full_oracle\": {\"matches\": %u, \"cases\": %u},\n"
        "  \"target_only_headroom\": {\"minimum\": %u, \"median\": %u, \"maximum\": %u},\n"
        "  \"development_selection\": {\"strongest_source_free_arm\": \"%s\", \"target_only_primary_cost\": %" PRIu64 ", \"source_free_jit_primary_cost\": %" PRIu64 "},\n"
        "  \"proposal_budget\": 64,\n"
        "  \"global_cap\": 4096,\n"
        "  \"derangements\": 31,\n"
        "  \"artifact_sha256\": \"%s\",\n"
        "  \"raw_trace_sha256\": \"%s\",\n"
        "  \"split_families\": [\n",
        result->source_families, result->development_families,
        result->generator_environments, result->episodes, result->trace_rows,
        result->adapter_reconstructions, result->adapter_exact,
        result->adapter_domain_checks, result->generator_sequence_differences,
        result->semantic_collisions, result->source_ablation_matches,
        result->source_ablation_cases, result->full_oracle_matches,
        result->full_oracle_cases, result->target_only_minimum_cost,
        result->target_only_median_cost, result->target_only_maximum_cost,
        result->arms[R55_ARM_TARGET_ONLY].primary_cost <=
            result->arms[R55_ARM_SOURCE_FREE_JIT].primary_cost ?
            "target_only" : "source_free_jit",
        result->arms[R55_ARM_TARGET_ONLY].primary_cost,
        result->arms[R55_ARM_SOURCE_FREE_JIT].primary_cost,
        artifact, trace) < 0) {
        fclose(file);
        return 1;
    }
    for (family_index = 0; family_index < result->family_receipt_count;
         ++family_index) {
        const r55_family_receipt *receipt =
            &result->family_receipts[family_index];
        char ast[65], behavior[65];
        const char *lane = receipt->lane == 0u ? "source-training" :
            "development";
        r55_hex(receipt->ast_sha256, ast);
        r55_hex(receipt->behavior_sha256, behavior);
        if (fprintf(file,
            "    {\"lane\": \"%s\", \"generator_id\": \"%s\", "
            "\"ordinal\": %u, \"ast_sha256\": \"%s\", "
            "\"behavior_sha256\": \"%s\"}%s\n",
            lane, r55_generator_name(receipt->generator_id),
            receipt->ordinal, ast, behavior,
            family_index + 1u == result->family_receipt_count ? "" : ",") < 0) {
            fclose(file);
            return 1;
        }
    }
    if (fprintf(file, "  ],\n  \"arms\": [\n") < 0) {
        fclose(file);
        return 1;
    }
    for (arm = 0; arm < R55_ARMS; ++arm) {
        char arm_buffer[24];
        const r55_arm_summary *summary = &result->arms[arm];
        if (fprintf(file,
            "    {\"arm\": \"%s\", \"primary_cost\": %" PRIu64
            ", \"verifier_checks\": %" PRIu64
            ", \"partial_expansions\": %" PRIu64
            ", \"exact_answers\": %" PRIu64
            ", \"fallback_episodes\": %" PRIu64
            ", \"global_cap_hits\": %" PRIu64
            ", \"invalid_first_rejected\": %" PRIu64 "}%s\n",
            r55_arm_name(arm, arm_buffer), summary->primary_cost,
            summary->verifier_checks, summary->partial_expansions,
            summary->exact_answers, summary->fallback_episodes,
            summary->global_cap_hits, summary->invalid_first_rejected,
            arm + 1u == R55_ARMS ? "" : ",") < 0) {
            fclose(file);
            return 1;
        }
    }
    if (fprintf(file, "  ]\n}\n") < 0 || fclose(file) != 0) return 1;
    return 0;
}
