#include "reasoner0.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R0_IR_VERSION 1U
#define R0_POLICY_VERSION 1U
#define R0_MAX_TRAINING_EPOCHS 64U
#define R0_MAX_PROPOSALS_PER_RANK 512
#define R0_AFFINE_EXAMPLE_WEIGHT 8U
#define CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

typedef struct {
    uint32_t state[8];
    uint64_t bits;
    unsigned char block[64];
    size_t used;
} R0Sha256;

typedef struct {
    R0Phase phase;
    R0ActionClass target;
} R0TrainingExample;

typedef struct {
    uint8_t count;
    R0CartanMatrix items[R0_MAX_TYPES_PER_RANK];
} R0MatrixList;

typedef struct {
    uint16_t count;
    R0CartanMatrix items[R0_MAX_PROPOSALS_PER_RANK];
} R0ProposalSet;

typedef struct {
    const R0CartanMatrix *source;
    R0CartanMatrix *best;
    uint64_t keys[R0_MAX_RANK];
    uint64_t sorted_keys[R0_MAX_RANK];
    uint8_t permutation[R0_MAX_RANK];
    uint8_t used[R0_MAX_RANK];
    int has_best;
} R0CanonicalContext;

static const R0TrainingExample R0_TRAINING_EXAMPLES[] = {
    {R0_PHASE_PROPOSED, R0_ACTION_CALL_CARTAN_VERIFY},
    {R0_PHASE_VERIFIED, R0_ACTION_COMMIT},
    {R0_PHASE_COUNTEREXAMPLE, R0_ACTION_REJECT},
    {R0_PHASE_SEALED, R0_ACTION_RENDER},
};

static const int8_t R0_BONDS[5][2] = {
    {-1, -1}, {-1, -2}, {-2, -1}, {-1, -3}, {-3, -1},
};

static const uint8_t R0_EXPECTED_COUNTS[R0_ENUMERATION_MAX_RANK + 1] = {
    0, 1, 3, 3, 5, 4, 5, 5, 5,
};

static const char *const R0_EXPECTED_TYPES[R0_ENUMERATION_MAX_RANK + 1] = {
    "", "A1", "A2,B2/C2,G2", "A3,B3,C3",
    "A4,B4,C4,D4,F4", "A5,B5,C5,D5", "A6,B6,C6,D6,E6",
    "A7,B7,C7,D7,E7", "A8,B8,C8,D8,E8",
};

static const uint32_t R0_SHA256_K[64] = {
    UINT32_C(0x428a2f98), UINT32_C(0x71374491), UINT32_C(0xb5c0fbcf),
    UINT32_C(0xe9b5dba5), UINT32_C(0x3956c25b), UINT32_C(0x59f111f1),
    UINT32_C(0x923f82a4), UINT32_C(0xab1c5ed5), UINT32_C(0xd807aa98),
    UINT32_C(0x12835b01), UINT32_C(0x243185be), UINT32_C(0x550c7dc3),
    UINT32_C(0x72be5d74), UINT32_C(0x80deb1fe), UINT32_C(0x9bdc06a7),
    UINT32_C(0xc19bf174), UINT32_C(0xe49b69c1), UINT32_C(0xefbe4786),
    UINT32_C(0x0fc19dc6), UINT32_C(0x240ca1cc), UINT32_C(0x2de92c6f),
    UINT32_C(0x4a7484aa), UINT32_C(0x5cb0a9dc), UINT32_C(0x76f988da),
    UINT32_C(0x983e5152), UINT32_C(0xa831c66d), UINT32_C(0xb00327c8),
    UINT32_C(0xbf597fc7), UINT32_C(0xc6e00bf3), UINT32_C(0xd5a79147),
    UINT32_C(0x06ca6351), UINT32_C(0x14292967), UINT32_C(0x27b70a85),
    UINT32_C(0x2e1b2138), UINT32_C(0x4d2c6dfc), UINT32_C(0x53380d13),
    UINT32_C(0x650a7354), UINT32_C(0x766a0abb), UINT32_C(0x81c2c92e),
    UINT32_C(0x92722c85), UINT32_C(0xa2bfe8a1), UINT32_C(0xa81a664b),
    UINT32_C(0xc24b8b70), UINT32_C(0xc76c51a3), UINT32_C(0xd192e819),
    UINT32_C(0xd6990624), UINT32_C(0xf40e3585), UINT32_C(0x106aa070),
    UINT32_C(0x19a4c116), UINT32_C(0x1e376c08), UINT32_C(0x2748774c),
    UINT32_C(0x34b0bcb5), UINT32_C(0x391c0cb3), UINT32_C(0x4ed8aa4a),
    UINT32_C(0x5b9cca4f), UINT32_C(0x682e6ff3), UINT32_C(0x748f82ee),
    UINT32_C(0x78a5636f), UINT32_C(0x84c87814), UINT32_C(0x8cc70208),
    UINT32_C(0x90befffa), UINT32_C(0xa4506ceb), UINT32_C(0xbef9a3f7),
    UINT32_C(0xc67178f2),
};

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

const char *r0_failure_name(R0CartanFailure failure)
{
    switch (failure) {
    case R0_CARTAN_VALID: return "valid";
    case R0_CARTAN_BAD_RANK: return "bad_rank";
    case R0_CARTAN_BAD_DIAGONAL: return "bad_diagonal";
    case R0_CARTAN_POSITIVE_OFF_DIAGONAL: return "positive_off_diagonal";
    case R0_CARTAN_ASYMMETRIC_ZERO: return "asymmetric_zero";
    case R0_CARTAN_BAD_BOND_PRODUCT: return "bad_bond_product";
    case R0_CARTAN_DISCONNECTED: return "disconnected";
    case R0_CARTAN_NOT_SYMMETRIZABLE: return "not_symmetrizable";
    case R0_CARTAN_AFFINE_BOUNDARY: return "affine_determinant_zero";
    case R0_CARTAN_NOT_POSITIVE_DEFINITE: return "not_positive_definite";
    }
    return "unknown";
}

const char *r0_action_name(R0ActionClass action)
{
    switch (action) {
    case R0_ACTION_CALL_CARTAN_VERIFY: return "call_cartan_verify";
    case R0_ACTION_COMMIT: return "commit_answer";
    case R0_ACTION_REJECT: return "reject_candidate";
    case R0_ACTION_RENDER: return "call_language_render";
    }
    return "invalid";
}

const char *r0_tool_name(R0ToolKind tool)
{
    switch (tool) {
    case R0_TOOL_NONE: return "none";
    case R0_TOOL_CARTAN_VERIFY: return "cartan.verify";
    case R0_TOOL_LANGUAGE_RENDER: return "language.render";
    }
    return "invalid";
}

const char *r0_status_name(R0Status status)
{
    switch (status) {
    case R0_OK: return "ok";
    case R0_INVALID_ARGUMENT: return "invalid_argument";
    case R0_POLICY_ERROR: return "policy_error";
    case R0_VERIFIER_ERROR: return "verifier_error";
    case R0_SEAL_ERROR: return "seal_error";
    case R0_LIMIT_ERROR: return "limit_error";
    case R0_IO_ERROR: return "io_error";
    }
    return "unknown";
}

static int encode_features(R0Phase phase,
                           int32_t features[R0_POLICY_FEATURES])
{
    if (phase < R0_PHASE_PROPOSED || phase > R0_PHASE_SEALED) return 0;
    memset(features, 0, R0_POLICY_FEATURES * sizeof(*features));
    features[0] = 1;
    features[1 + (int)phase] = 1;
    return 1;
}

static R0ActionClass policy_predict(const R0Policy *policy, R0Phase phase)
{
    int32_t features[R0_POLICY_FEATURES];
    int64_t best_score = INT64_MIN;
    R0ActionClass best = R0_ACTION_CALL_CARTAN_VERIFY;
    int action;
    if (!encode_features(phase, features)) return R0_POLICY_ACTIONS;
    for (action = 0; action < R0_POLICY_ACTIONS; ++action) {
        int64_t score = 0;
        int feature;
        for (feature = 0; feature < R0_POLICY_FEATURES; ++feature)
            score += (int64_t)policy->weights[action][feature] *
                     features[feature];
        if (score > best_score) {
            best_score = score;
            best = (R0ActionClass)action;
        }
    }
    return best;
}

static uint32_t policy_error_count(const R0Policy *policy)
{
    uint32_t errors = 0;
    size_t index;
    for (index = 0;
         index < sizeof(R0_TRAINING_EXAMPLES) /
                     sizeof(R0_TRAINING_EXAMPLES[0]);
         ++index) {
        if (policy_predict(policy, R0_TRAINING_EXAMPLES[index].phase) !=
            R0_TRAINING_EXAMPLES[index].target)
            ++errors;
    }
    return errors;
}

void r0_policy_init(R0Policy *policy)
{
    if (policy != NULL) memset(policy, 0, sizeof(*policy));
}

R0Status r0_policy_train(R0Policy *policy, R0TrainingReport *report)
{
    uint32_t epoch;
    uint32_t completed_epochs = 0;
    uint32_t mistakes = 0;
    if (policy == NULL || report == NULL) return R0_INVALID_ARGUMENT;
    r0_policy_init(policy);
    memset(report, 0, sizeof(*report));
    report->examples = (uint32_t)(sizeof(R0_TRAINING_EXAMPLES) /
                                  sizeof(R0_TRAINING_EXAMPLES[0]));
    for (epoch = 1; epoch <= R0_MAX_TRAINING_EPOCHS; ++epoch) {
        uint32_t errors = 0;
        size_t index;
        for (index = 0; index < report->examples; ++index) {
            const R0TrainingExample *example = &R0_TRAINING_EXAMPLES[index];
            R0ActionClass predicted = policy_predict(policy, example->phase);
            int32_t features[R0_POLICY_FEATURES];
            int feature;
            if (predicted == example->target) continue;
            ++errors;
            ++mistakes;
            (void)encode_features(example->phase, features);
            for (feature = 0; feature < R0_POLICY_FEATURES; ++feature) {
                policy->weights[example->target][feature] += features[feature];
                policy->weights[predicted][feature] -= features[feature];
            }
        }
        completed_epochs = epoch;
        if (errors == 0) break;
    }
    policy->trained_epochs = completed_epochs;
    policy->training_mistakes = mistakes;
    report->epochs = completed_epochs;
    report->mistakes = mistakes;
    report->final_errors = policy_error_count(policy);
    return report->final_errors == 0 ? R0_OK : R0_POLICY_ERROR;
}

static int write_u32(FILE *file, uint32_t value)
{
    unsigned char bytes[4];
    bytes[0] = (unsigned char)value;
    bytes[1] = (unsigned char)(value >> 8);
    bytes[2] = (unsigned char)(value >> 16);
    bytes[3] = (unsigned char)(value >> 24);
    return fwrite(bytes, 1, sizeof(bytes), file) == sizeof(bytes);
}

static int read_u32(FILE *file, uint32_t *value)
{
    unsigned char bytes[4];
    if (fread(bytes, 1, sizeof(bytes), file) != sizeof(bytes)) return 0;
    *value = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
             ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
    return 1;
}

static int32_t signed_from_u32(uint32_t value)
{
    if (value <= INT32_MAX) return (int32_t)value;
    return -INT32_C(1) - (int32_t)(UINT32_MAX - value);
}

R0Status r0_policy_save(const R0Policy *policy, const char *path,
                        char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '0', 'C', 'A', 'R', 'V', '1', '\0'};
    char *temporary;
    size_t path_length;
    FILE *file;
    int action;
    if (policy == NULL || path == NULL || path[0] == '\0') {
        set_error(error, error_capacity, "policy path is required");
        return R0_INVALID_ARGUMENT;
    }
    if (policy->trained_epochs == 0 || policy_error_count(policy) != 0) {
        set_error(error, error_capacity,
                  "only a trained, verified policy can be saved");
        return R0_POLICY_ERROR;
    }
    path_length = strlen(path);
    temporary = malloc(path_length + 5U);
    if (temporary == NULL) return R0_IO_ERROR;
    (void)snprintf(temporary, path_length + 5U, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "could not create %s: %s", temporary,
                  strerror(errno));
        free(temporary);
        return R0_IO_ERROR;
    }
    if (fwrite(magic, 1, sizeof(magic), file) != sizeof(magic) ||
        !write_u32(file, R0_POLICY_VERSION) ||
        !write_u32(file, R0_POLICY_FEATURES) ||
        !write_u32(file, R0_POLICY_ACTIONS) ||
        !write_u32(file, policy->trained_epochs) ||
        !write_u32(file, policy->training_mistakes)) {
        (void)fclose(file);
        (void)remove(temporary);
        free(temporary);
        return R0_IO_ERROR;
    }
    for (action = 0; action < R0_POLICY_ACTIONS; ++action) {
        int feature;
        for (feature = 0; feature < R0_POLICY_FEATURES; ++feature) {
            if (!write_u32(file, (uint32_t)policy->weights[action][feature])) {
                (void)fclose(file);
                (void)remove(temporary);
                free(temporary);
                return R0_IO_ERROR;
            }
        }
    }
    if (fclose(file) != 0 || rename(temporary, path) != 0) {
        set_error(error, error_capacity, "could not install %s: %s", path,
                  strerror(errno));
        (void)remove(temporary);
        free(temporary);
        return R0_IO_ERROR;
    }
    free(temporary);
    return R0_OK;
}

R0Status r0_policy_load(R0Policy *policy, const char *path,
                        char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '0', 'C', 'A', 'R', 'V', '1', '\0'};
    unsigned char actual_magic[8];
    uint32_t version, features, actions;
    FILE *file;
    int action;
    if (policy == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "rb");
    if (file == NULL) {
        set_error(error, error_capacity, "could not open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    r0_policy_init(policy);
    if (fread(actual_magic, 1, sizeof(actual_magic), file) !=
            sizeof(actual_magic) ||
        memcmp(actual_magic, magic, sizeof(magic)) != 0 ||
        !read_u32(file, &version) || !read_u32(file, &features) ||
        !read_u32(file, &actions) || version != R0_POLICY_VERSION ||
        features != R0_POLICY_FEATURES || actions != R0_POLICY_ACTIONS ||
        !read_u32(file, &policy->trained_epochs) ||
        !read_u32(file, &policy->training_mistakes)) {
        (void)fclose(file);
        set_error(error, error_capacity, "%s is not a Reasoner-0 policy",
                  path);
        return R0_POLICY_ERROR;
    }
    for (action = 0; action < R0_POLICY_ACTIONS; ++action) {
        int feature;
        for (feature = 0; feature < R0_POLICY_FEATURES; ++feature) {
            uint32_t value;
            if (!read_u32(file, &value)) {
                (void)fclose(file);
                return R0_POLICY_ERROR;
            }
            policy->weights[action][feature] = signed_from_u32(value);
        }
    }
    if (fgetc(file) != EOF || fclose(file) != 0 ||
        policy->trained_epochs == 0 ||
        policy->trained_epochs > R0_MAX_TRAINING_EPOCHS ||
        policy_error_count(policy) != 0) {
        set_error(error, error_capacity, "%s contains an invalid policy",
                  path);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static uint64_t gcd_u64(uint64_t left, uint64_t right)
{
    while (right != 0) {
        uint64_t remainder = left % right;
        left = right;
        right = remainder;
    }
    return left == 0 ? 1 : left;
}

static uint64_t lcm_u64(uint64_t left, uint64_t right)
{
    return left / gcd_u64(left, right) * right;
}

static int bareiss_determinant(const int64_t source[R0_MAX_RANK][R0_MAX_RANK],
                               int size, int64_t *determinant)
{
    int64_t matrix[R0_MAX_RANK][R0_MAX_RANK];
    int64_t denominator = 1;
    int sign = 1;
    int pivot_index;
    memcpy(matrix, source, sizeof(matrix));
    if (size == 0) {
        *determinant = 1;
        return 1;
    }
    if (size == 1) {
        *determinant = matrix[0][0];
        return 1;
    }
    for (pivot_index = 0; pivot_index < size - 1; ++pivot_index) {
        int pivot_row = pivot_index;
        int row, column;
        while (pivot_row < size && matrix[pivot_row][pivot_index] == 0)
            ++pivot_row;
        if (pivot_row == size) {
            *determinant = 0;
            return 1;
        }
        if (pivot_row != pivot_index) {
            for (column = 0; column < size; ++column) {
                int64_t temporary = matrix[pivot_index][column];
                matrix[pivot_index][column] = matrix[pivot_row][column];
                matrix[pivot_row][column] = temporary;
            }
            sign = -sign;
        }
        for (row = pivot_index + 1; row < size; ++row) {
            for (column = pivot_index + 1; column < size; ++column) {
                int64_t numerator =
                    matrix[row][column] * matrix[pivot_index][pivot_index] -
                    matrix[row][pivot_index] * matrix[pivot_index][column];
                if (denominator != 1 && numerator % denominator != 0)
                    return 0;
                matrix[row][column] = numerator / denominator;
            }
            matrix[row][pivot_index] = 0;
        }
        denominator = matrix[pivot_index][pivot_index];
        if (denominator == 0) {
            *determinant = 0;
            return 1;
        }
    }
    *determinant = sign * matrix[size - 1][size - 1];
    return 1;
}

static int principal_determinant(const R0CartanMatrix *matrix, uint16_t mask,
                                 int64_t *determinant)
{
    int64_t selected[R0_MAX_RANK][R0_MAX_RANK] = {{0}};
    int rows[R0_MAX_RANK];
    int count = 0;
    int row, column;
    for (row = 0; row < matrix->rank; ++row)
        if ((mask & (UINT16_C(1) << row)) != 0) rows[count++] = row;
    for (row = 0; row < count; ++row)
        for (column = 0; column < count; ++column)
            selected[row][column] = CELL(matrix, rows[row], rows[column]);
    return bareiss_determinant(selected, count, determinant);
}

static int cartan_connected(const R0CartanMatrix *matrix)
{
    uint8_t seen[R0_MAX_RANK] = {0};
    uint8_t queue[R0_MAX_RANK];
    int head = 0, tail = 0, count = 0;
    seen[0] = 1;
    queue[tail++] = 0;
    while (head < tail) {
        int node = queue[head++];
        int other;
        ++count;
        for (other = 0; other < matrix->rank; ++other) {
            if (!seen[other] && CELL(matrix, node, other) != 0) {
                seen[other] = 1;
                queue[tail++] = (uint8_t)other;
            }
        }
    }
    return count == matrix->rank;
}

static int cartan_symmetrizer(const R0CartanMatrix *matrix,
                              uint32_t output[R0_MAX_RANK])
{
    uint64_t numerator[R0_MAX_RANK] = {0};
    uint64_t denominator[R0_MAX_RANK] = {0};
    uint8_t queue[R0_MAX_RANK];
    int head = 0, tail = 0;
    uint64_t common_denominator = 1;
    uint64_t common_divisor = 0;
    int node;
    numerator[0] = denominator[0] = 1;
    queue[tail++] = 0;
    while (head < tail) {
        int current = queue[head++];
        int other;
        for (other = 0; other < matrix->rank; ++other) {
            uint64_t next_numerator, next_denominator, divisor;
            int left = CELL(matrix, current, other);
            int right = CELL(matrix, other, current);
            if (other == current || left == 0) continue;
            next_numerator = numerator[current] * (uint64_t)(-left);
            next_denominator = denominator[current] * (uint64_t)(-right);
            divisor = gcd_u64(next_numerator, next_denominator);
            next_numerator /= divisor;
            next_denominator /= divisor;
            if (numerator[other] == 0) {
                numerator[other] = next_numerator;
                denominator[other] = next_denominator;
                queue[tail++] = (uint8_t)other;
            } else if (numerator[other] * next_denominator !=
                       next_numerator * denominator[other]) {
                return 0;
            }
        }
    }
    for (node = 0; node < matrix->rank; ++node) {
        if (numerator[node] == 0) return 0;
        common_denominator = lcm_u64(common_denominator, denominator[node]);
    }
    for (node = 0; node < matrix->rank; ++node) {
        uint64_t value =
            numerator[node] * (common_denominator / denominator[node]);
        common_divisor = node == 0 ? value : gcd_u64(common_divisor, value);
        if (value > UINT32_MAX) return 0;
        output[node] = (uint32_t)value;
    }
    for (node = 0; node < matrix->rank; ++node)
        output[node] = (uint32_t)(output[node] / common_divisor);
    return 1;
}

R0Status r0_cartan_verify(const R0CartanMatrix *matrix,
                          R0VerifierObservation *observation, char *error,
                          size_t error_capacity)
{
    uint16_t full_mask;
    uint16_t mask;
    int row, column;
    if (matrix == NULL || observation == NULL) return R0_INVALID_ARGUMENT;
    memset(observation, 0, sizeof(*observation));
    if (matrix->rank == 0 || matrix->rank > R0_MAX_RANK) {
        observation->failure = R0_CARTAN_BAD_RANK;
        return R0_OK;
    }
    for (row = 0; row < matrix->rank; ++row) {
        if (CELL(matrix, row, row) != 2) {
            observation->failure = R0_CARTAN_BAD_DIAGONAL;
            observation->row = (uint8_t)row;
            observation->column = (uint8_t)row;
            return R0_OK;
        }
        for (column = row + 1; column < matrix->rank; ++column) {
            int left = CELL(matrix, row, column);
            int right = CELL(matrix, column, row);
            int product;
            if (left > 0 || right > 0) {
                observation->failure = R0_CARTAN_POSITIVE_OFF_DIAGONAL;
                observation->row = (uint8_t)row;
                observation->column = (uint8_t)column;
                return R0_OK;
            }
            if ((left == 0) != (right == 0)) {
                observation->failure = R0_CARTAN_ASYMMETRIC_ZERO;
                observation->row = (uint8_t)row;
                observation->column = (uint8_t)column;
                return R0_OK;
            }
            product = left * right;
            /* Product four is the rank-two affine boundary.  Let exact
               principal minors classify it; larger products fail locally. */
            if (product < 0 || product > 4) {
                observation->failure = R0_CARTAN_BAD_BOND_PRODUCT;
                observation->row = (uint8_t)row;
                observation->column = (uint8_t)column;
                return R0_OK;
            }
        }
    }
    if (!cartan_connected(matrix)) {
        observation->failure = R0_CARTAN_DISCONNECTED;
        return R0_OK;
    }
    if (!cartan_symmetrizer(matrix, observation->symmetrizer)) {
        observation->failure = R0_CARTAN_NOT_SYMMETRIZABLE;
        return R0_OK;
    }
    full_mask = (uint16_t)((UINT16_C(1) << matrix->rank) - 1U);
    for (mask = 1; mask < full_mask; ++mask) {
        int64_t determinant;
        if (!principal_determinant(matrix, mask, &determinant)) {
            set_error(error, error_capacity,
                      "Bareiss division was not exact for principal mask %u",
                      (unsigned)mask);
            return R0_VERIFIER_ERROR;
        }
        ++observation->checked_principal_minors;
        if (determinant <= 0) {
            observation->failure = R0_CARTAN_NOT_POSITIVE_DEFINITE;
            observation->principal_mask = mask;
            observation->determinant = determinant;
            return R0_OK;
        }
    }
    if (!principal_determinant(matrix, full_mask,
                               &observation->determinant)) {
        set_error(error, error_capacity,
                  "Bareiss division was not exact for the full determinant");
        return R0_VERIFIER_ERROR;
    }
    ++observation->checked_principal_minors;
    observation->principal_mask = full_mask;
    if (observation->determinant == 0) {
        observation->failure = R0_CARTAN_AFFINE_BOUNDARY;
        return R0_OK;
    }
    if (observation->determinant < 0) {
        observation->failure = R0_CARTAN_NOT_POSITIVE_DEFINITE;
        return R0_OK;
    }
    observation->accepted = 1;
    observation->failure = R0_CARTAN_VALID;
    return R0_OK;
}

static uint64_t node_key(const R0CartanMatrix *matrix, int node)
{
    uint64_t counts[5] = {0};
    uint64_t degree = 0;
    int other;
    for (other = 0; other < matrix->rank; ++other) {
        int outgoing, incoming;
        int kind = -1;
        if (other == node || CELL(matrix, node, other) == 0) continue;
        ++degree;
        outgoing = -CELL(matrix, node, other);
        incoming = -CELL(matrix, other, node);
        if (outgoing == 1 && incoming == 1) kind = 0;
        else if (outgoing == 1 && incoming == 2) kind = 1;
        else if (outgoing == 2 && incoming == 1) kind = 2;
        else if (outgoing == 1 && incoming == 3) kind = 3;
        else if (outgoing == 3 && incoming == 1) kind = 4;
        if (kind >= 0) ++counts[kind];
    }
    return degree | (counts[0] << 4) | (counts[1] << 10) |
           (counts[2] << 16) | (counts[3] << 22) | (counts[4] << 28);
}

static int matrix_lexicographic_compare(const R0CartanMatrix *left,
                                        const R0CartanMatrix *right)
{
    int row, column;
    for (row = 0; row < left->rank; ++row) {
        for (column = 0; column < left->rank; ++column) {
            int difference = CELL(left, row, column) -
                             CELL(right, row, column);
            if (difference != 0) return difference;
        }
    }
    return 0;
}

static void canonical_leaf(R0CanonicalContext *context)
{
    R0CartanMatrix candidate;
    int row, column;
    memset(&candidate, 0, sizeof(candidate));
    candidate.rank = context->source->rank;
    for (row = 0; row < candidate.rank; ++row)
        for (column = 0; column < candidate.rank; ++column)
            CELL(&candidate, row, column) =
                CELL(context->source, context->permutation[row],
                     context->permutation[column]);
    if (!context->has_best ||
        matrix_lexicographic_compare(&candidate, context->best) < 0) {
        *context->best = candidate;
        context->has_best = 1;
    }
}

static void canonical_search(R0CanonicalContext *context, int position)
{
    int node;
    if (position == context->source->rank) {
        canonical_leaf(context);
        return;
    }
    for (node = 0; node < context->source->rank; ++node) {
        if (context->used[node] ||
            context->keys[node] != context->sorted_keys[position])
            continue;
        context->used[node] = 1;
        context->permutation[position] = (uint8_t)node;
        canonical_search(context, position + 1);
        context->used[node] = 0;
    }
}

R0Status r0_cartan_canonicalize(const R0CartanMatrix *matrix,
                                R0CartanMatrix *canonical, char *error,
                                size_t error_capacity)
{
    R0CanonicalContext context;
    int node;
    if (matrix == NULL || canonical == NULL || matrix->rank == 0 ||
        matrix->rank > R0_MAX_RANK) {
        set_error(error, error_capacity, "cannot canonicalize invalid rank");
        return R0_INVALID_ARGUMENT;
    }
    memset(&context, 0, sizeof(context));
    context.source = matrix;
    context.best = canonical;
    memset(canonical, 0, sizeof(*canonical));
    for (node = 0; node < matrix->rank; ++node) {
        context.keys[node] = node_key(matrix, node);
        context.sorted_keys[node] = context.keys[node];
    }
    for (node = 1; node < matrix->rank; ++node) {
        uint64_t value = context.sorted_keys[node];
        int position = node;
        while (position > 0 && context.sorted_keys[position - 1] > value) {
            context.sorted_keys[position] = context.sorted_keys[position - 1];
            --position;
        }
        context.sorted_keys[position] = value;
    }
    canonical_search(&context, 0);
    if (!context.has_best) return R0_VERIFIER_ERROR;
    return R0_OK;
}

static int matrix_equal(const R0CartanMatrix *left,
                        const R0CartanMatrix *right)
{
    return left->rank == right->rank &&
           matrix_lexicographic_compare(left, right) == 0;
}

static void matrix_diagonal(R0CartanMatrix *matrix, uint8_t rank)
{
    int index;
    memset(matrix, 0, sizeof(*matrix));
    matrix->rank = rank;
    for (index = 0; index < rank; ++index) CELL(matrix, index, index) = 2;
}

static void matrix_edge(R0CartanMatrix *matrix, int left, int right,
                        int8_t forward, int8_t backward)
{
    CELL(matrix, left, right) = forward;
    CELL(matrix, right, left) = backward;
}

static int make_known_type(char family, uint8_t rank, R0CartanMatrix *matrix)
{
    int index;
    matrix_diagonal(matrix, rank);
    if (family == 'A' && rank >= 1) {
        for (index = 0; index + 1 < rank; ++index)
            matrix_edge(matrix, index, index + 1, -1, -1);
        return 1;
    }
    if ((family == 'B' || family == 'C') && rank >= 2) {
        for (index = 0; index + 1 < rank - 1; ++index)
            matrix_edge(matrix, index, index + 1, -1, -1);
        matrix_edge(matrix, rank - 2, rank - 1,
                    family == 'B' ? -2 : -1,
                    family == 'B' ? -1 : -2);
        return 1;
    }
    if (family == 'D' && rank >= 4) {
        for (index = 0; index + 1 <= rank - 3; ++index)
            matrix_edge(matrix, index, index + 1, -1, -1);
        matrix_edge(matrix, rank - 3, rank - 2, -1, -1);
        matrix_edge(matrix, rank - 3, rank - 1, -1, -1);
        return 1;
    }
    if (family == 'E' && rank >= 6 && rank <= 8) {
        for (index = 0; index + 1 < rank - 1; ++index)
            matrix_edge(matrix, index, index + 1, -1, -1);
        matrix_edge(matrix, 2, rank - 1, -1, -1);
        return 1;
    }
    if (family == 'F' && rank == 4) {
        matrix_edge(matrix, 0, 1, -1, -1);
        matrix_edge(matrix, 1, 2, -2, -1);
        matrix_edge(matrix, 2, 3, -1, -1);
        return 1;
    }
    if (family == 'G' && rank == 2) {
        matrix_edge(matrix, 0, 1, -3, -1);
        return 1;
    }
    return 0;
}

R0Status r0_cartan_make_type(const char *type, R0CartanMatrix *matrix,
                             char *error, size_t error_capacity)
{
    char *end = NULL;
    long rank;
    char family;
    if (type == NULL || matrix == NULL || type[0] == '\0')
        return R0_INVALID_ARGUMENT;
    family = type[0];
    if (family < 'A' || family > 'G') {
        set_error(error, error_capacity, "unknown Cartan family in %s", type);
        return R0_INVALID_ARGUMENT;
    }
    errno = 0;
    rank = strtol(type + 1, &end, 10);
    if (errno != 0 || end == type + 1 || *end != '\0' || rank < 1 ||
        rank > R0_MAX_RANK ||
        !make_known_type(family, (uint8_t)rank, matrix)) {
        set_error(error, error_capacity, "unsupported finite Cartan type %s",
                  type);
        return R0_INVALID_ARGUMENT;
    }
    return R0_OK;
}

const char *r0_cartan_type(const R0CartanMatrix *matrix)
{
    static const char *const a_names[] = {
        "", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"};
    static const char *const b_names[] = {
        "", "", "B2/C2", "B3", "B4", "B5", "B6", "B7", "B8", "B9"};
    static const char *const c_names[] = {
        "", "", "", "C3", "C4", "C5", "C6", "C7", "C8", "C9"};
    static const char *const d_names[] = {
        "", "", "", "", "D4", "D5", "D6", "D7", "D8", "D9"};
    R0CartanMatrix canonical, known, known_canonical;
    char error[64];
    char families[] = {'A', 'B', 'C', 'D', 'E', 'F', 'G'};
    size_t family_index;
    if (matrix == NULL || matrix->rank == 0 || matrix->rank > R0_MAX_RANK ||
        r0_cartan_canonicalize(matrix, &canonical, error, sizeof(error)) !=
            R0_OK)
        return "unknown";
    for (family_index = 0; family_index < sizeof(families); ++family_index) {
        char family = families[family_index];
        if (!make_known_type(family, matrix->rank, &known)) continue;
        if (r0_cartan_canonicalize(&known, &known_canonical, error,
                                   sizeof(error)) != R0_OK)
            continue;
        if (!matrix_equal(&canonical, &known_canonical)) continue;
        if (family == 'A') return a_names[matrix->rank];
        if (family == 'B') return b_names[matrix->rank];
        if (family == 'C') return c_names[matrix->rank];
        if (family == 'D') return d_names[matrix->rank];
        if (family == 'E') {
            if (matrix->rank == 6) return "E6";
            if (matrix->rank == 7) return "E7";
            return "E8";
        }
        if (family == 'F') return "F4";
        if (family == 'G') return "G2";
    }
    return "unknown";
}

static uint32_t rotate_right(uint32_t value, unsigned amount)
{
    return (value >> amount) | (value << (32U - amount));
}

static void sha256_transform(R0Sha256 *sha, const unsigned char block[64])
{
    uint32_t words[64];
    uint32_t a, b, c, d, e, f, g, h;
    int index;
    for (index = 0; index < 16; ++index)
        words[index] = ((uint32_t)block[index * 4] << 24) |
                       ((uint32_t)block[index * 4 + 1] << 16) |
                       ((uint32_t)block[index * 4 + 2] << 8) |
                       (uint32_t)block[index * 4 + 3];
    for (index = 16; index < 64; ++index) {
        uint32_t x = words[index - 15], y = words[index - 2];
        words[index] = words[index - 16] +
            (rotate_right(x, 7) ^ rotate_right(x, 18) ^ (x >> 3)) +
            words[index - 7] +
            (rotate_right(y, 17) ^ rotate_right(y, 19) ^ (y >> 10));
    }
    a = sha->state[0]; b = sha->state[1]; c = sha->state[2];
    d = sha->state[3]; e = sha->state[4]; f = sha->state[5];
    g = sha->state[6]; h = sha->state[7];
    for (index = 0; index < 64; ++index) {
        uint32_t s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^
                      rotate_right(e, 25);
        uint32_t choice = (e & f) ^ ((~e) & g);
        uint32_t first = h + s1 + choice + R0_SHA256_K[index] + words[index];
        uint32_t s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^
                      rotate_right(a, 22);
        uint32_t second = s0 + ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = d + first;
        d = c; c = b; b = a; a = first + second;
    }
    sha->state[0] += a; sha->state[1] += b;
    sha->state[2] += c; sha->state[3] += d;
    sha->state[4] += e; sha->state[5] += f;
    sha->state[6] += g; sha->state[7] += h;
}

static void sha256_init(R0Sha256 *sha)
{
    static const uint32_t initial[8] = {
        UINT32_C(0x6a09e667), UINT32_C(0xbb67ae85),
        UINT32_C(0x3c6ef372), UINT32_C(0xa54ff53a),
        UINT32_C(0x510e527f), UINT32_C(0x9b05688c),
        UINT32_C(0x1f83d9ab), UINT32_C(0x5be0cd19)};
    memset(sha, 0, sizeof(*sha));
    memcpy(sha->state, initial, sizeof(initial));
}

static void sha256_update(R0Sha256 *sha, const unsigned char *data,
                          size_t length)
{
    size_t index = 0;
    sha->bits += (uint64_t)length * 8U;
    while (index < length) {
        size_t available = sizeof(sha->block) - sha->used;
        size_t amount = length - index < available ? length - index : available;
        memcpy(sha->block + sha->used, data + index, amount);
        sha->used += amount;
        index += amount;
        if (sha->used == sizeof(sha->block)) {
            sha256_transform(sha, sha->block);
            sha->used = 0;
        }
    }
}

static void sha256_final(R0Sha256 *sha, unsigned char digest[32])
{
    uint64_t bits = sha->bits;
    int index;
    sha->block[sha->used++] = 0x80U;
    if (sha->used > 56U) {
        memset(sha->block + sha->used, 0, 64U - sha->used);
        sha256_transform(sha, sha->block);
        sha->used = 0;
    }
    memset(sha->block + sha->used, 0, 56U - sha->used);
    for (index = 0; index < 8; ++index)
        sha->block[63 - index] = (unsigned char)(bits >> (index * 8));
    sha256_transform(sha, sha->block);
    for (index = 0; index < 8; ++index) {
        digest[index * 4] = (unsigned char)(sha->state[index] >> 24);
        digest[index * 4 + 1] = (unsigned char)(sha->state[index] >> 16);
        digest[index * 4 + 2] = (unsigned char)(sha->state[index] >> 8);
        digest[index * 4 + 3] = (unsigned char)sha->state[index];
    }
}

static void sha256_hex(const unsigned char *data, size_t length, char hex[65])
{
    static const char digits[] = "0123456789abcdef";
    unsigned char digest[32];
    R0Sha256 sha;
    int index;
    sha256_init(&sha);
    sha256_update(&sha, data, length);
    sha256_final(&sha, digest);
    for (index = 0; index < 32; ++index) {
        hex[index * 2] = digits[digest[index] >> 4];
        hex[index * 2 + 1] = digits[digest[index] & 15U];
    }
    hex[64] = '\0';
}

static R0Status canonical_answer(const R0AnswerIr *answer, char *output,
                                 size_t capacity)
{
    size_t used = 0;
    int row, column, written;
    written = snprintf(output, capacity,
                       "reasoner0.cartan.v1|rank=%u|entries=",
                       (unsigned)answer->matrix.rank);
    if (written < 0 || (size_t)written >= capacity) return R0_LIMIT_ERROR;
    used = (size_t)written;
    for (row = 0; row < answer->matrix.rank; ++row) {
        for (column = 0; column < answer->matrix.rank; ++column) {
            written = snprintf(output + used, capacity - used, "%s%d",
                               row == 0 && column == 0 ? "" : ",",
                               CELL(&answer->matrix, row, column));
            if (written < 0 || (size_t)written >= capacity - used)
                return R0_LIMIT_ERROR;
            used += (size_t)written;
        }
    }
    written = snprintf(output + used, capacity - used,
                       "|det=%lld|minors=%u|symmetrizer=",
                       (long long)answer->certificate.determinant,
                       (unsigned)answer->certificate.checked_principal_minors);
    if (written < 0 || (size_t)written >= capacity - used)
        return R0_LIMIT_ERROR;
    used += (size_t)written;
    for (row = 0; row < answer->matrix.rank; ++row) {
        written = snprintf(output + used, capacity - used, "%s%u",
                           row == 0 ? "" : ",",
                           answer->certificate.symmetrizer[row]);
        if (written < 0 || (size_t)written >= capacity - used)
            return R0_LIMIT_ERROR;
        used += (size_t)written;
    }
    return R0_OK;
}

static R0Status seal_answer(R0SealedAnswer *sealed, char *error,
                            size_t error_capacity)
{
    char canonical[1024];
    R0VerifierObservation verified;
    R0CartanMatrix canonical_matrix;
    R0Status status;
    status = r0_cartan_canonicalize(&sealed->answer.matrix, &canonical_matrix,
                                    error, error_capacity);
    if (status != R0_OK ||
        !matrix_equal(&sealed->answer.matrix, &canonical_matrix)) {
        set_error(error, error_capacity, "Answer IR matrix is not canonical");
        return R0_VERIFIER_ERROR;
    }
    status = r0_cartan_verify(&sealed->answer.matrix, &verified, error,
                              error_capacity);
    if (status != R0_OK) return status;
    if (!verified.accepted || sealed->answer.version != R0_IR_VERSION ||
        sealed->answer.certificate.determinant != verified.determinant ||
        sealed->answer.certificate.checked_principal_minors !=
            verified.checked_principal_minors ||
        memcmp(sealed->answer.certificate.symmetrizer, verified.symmetrizer,
               sizeof(verified.symmetrizer)) != 0) {
        set_error(error, error_capacity,
                  "Answer IR does not match exact Cartan verification");
        return R0_VERIFIER_ERROR;
    }
    status = canonical_answer(&sealed->answer, canonical, sizeof(canonical));
    if (status != R0_OK) return status;
    sha256_hex((const unsigned char *)canonical, strlen(canonical),
               sealed->seal);
    return R0_OK;
}

static int same_seal(const char left[65], const char right[65])
{
    unsigned difference = 0;
    size_t index;
    for (index = 0; index < 65; ++index)
        difference |= (unsigned char)left[index] ^ (unsigned char)right[index];
    return difference == 0;
}

R0Status r0_render_language(const R0SealedAnswer *sealed, char *output,
                            size_t output_capacity, char *error,
                            size_t error_capacity)
{
    R0SealedAnswer expected;
    const char *type;
    int written;
    R0Status status;
    if (sealed == NULL || output == NULL || output_capacity == 0)
        return R0_INVALID_ARGUMENT;
    expected = *sealed;
    status = seal_answer(&expected, error, error_capacity);
    if (status != R0_OK) return status;
    if (!same_seal(sealed->seal, expected.seal)) {
        set_error(error, error_capacity,
                  "language.render rejected an invalid answer seal");
        return R0_SEAL_ERROR;
    }
    type = r0_cartan_type(&sealed->answer.matrix);
    written = snprintf(output, output_capacity,
                       "accepted connected finite Cartan matrix %s (rank %u)",
                       type, (unsigned)sealed->answer.matrix.rank);
    if (written < 0 || (size_t)written >= output_capacity)
        return R0_LIMIT_ERROR;
    return R0_OK;
}

static R0Status append_event(R0RunResult *result, R0EventKind kind,
                             uint32_t cycle, R0Phase phase,
                             R0ActionClass action, R0ToolKind tool,
                             const R0VerifierObservation *observation,
                             const char *seal, char *error,
                             size_t error_capacity)
{
    R0TraceEvent *event;
    if (result->event_count >= R0_MAX_TRACE_EVENTS) {
        set_error(error, error_capacity, "reasoning trace limit reached");
        return R0_LIMIT_ERROR;
    }
    event = &result->events[result->event_count++];
    memset(event, 0, sizeof(*event));
    event->kind = kind;
    event->cycle = cycle;
    event->phase = phase;
    event->action = action;
    event->tool = tool;
    if (observation != NULL) {
        event->accepted = observation->accepted;
        event->failure = observation->failure;
        event->determinant = observation->determinant;
    }
    if (seal != NULL)
        (void)snprintf(event->seal, sizeof(event->seal), "%s", seal);
    return R0_OK;
}

R0Status r0_run(const R0Policy *policy, const R0CartanMatrix *candidate,
                R0RunResult *result, char *error, size_t error_capacity)
{
    R0CartanMatrix canonical;
    R0Phase phase = R0_PHASE_PROPOSED;
    R0Status status;
    uint32_t cycle;
    if (policy == NULL || candidate == NULL || result == NULL)
        return R0_INVALID_ARGUMENT;
    if (policy->trained_epochs == 0 || policy_error_count(policy) != 0) {
        set_error(error, error_capacity, "Reasoner-0 policy is invalid");
        return R0_POLICY_ERROR;
    }
    status = r0_cartan_canonicalize(candidate, &canonical, error,
                                    error_capacity);
    if (status != R0_OK) return status;
    memset(result, 0, sizeof(*result));
    for (cycle = 0; cycle < 3; ++cycle) {
        R0ActionClass action = policy_predict(policy, phase);
        R0ToolKind tool = action == R0_ACTION_CALL_CARTAN_VERIFY
                              ? R0_TOOL_CARTAN_VERIFY
                              : action == R0_ACTION_RENDER
                                    ? R0_TOOL_LANGUAGE_RENDER
                                    : R0_TOOL_NONE;
        status = append_event(result, R0_EVENT_MODEL_ACTION, cycle, phase,
                              action, tool, NULL, NULL, error,
                              error_capacity);
        if (status != R0_OK) return status;
        if (phase == R0_PHASE_PROPOSED) {
            if (action != R0_ACTION_CALL_CARTAN_VERIFY)
                return R0_POLICY_ERROR;
            status = r0_cartan_verify(&canonical, &result->observation, error,
                                      error_capacity);
            if (status != R0_OK) return status;
            status = append_event(result, R0_EVENT_TOOL_RESULT, cycle,
                                  result->observation.accepted
                                      ? R0_PHASE_VERIFIED
                                      : R0_PHASE_COUNTEREXAMPLE,
                                  action, tool, &result->observation, NULL,
                                  error, error_capacity);
            if (status != R0_OK) return status;
            phase = result->observation.accepted ? R0_PHASE_VERIFIED
                                                 : R0_PHASE_COUNTEREXAMPLE;
        } else if (phase == R0_PHASE_COUNTEREXAMPLE) {
            if (action != R0_ACTION_REJECT) return R0_POLICY_ERROR;
            status = append_event(result, R0_EVENT_CANDIDATE_REJECTED, cycle,
                                  R0_PHASE_COMPLETE, action, R0_TOOL_NONE,
                                  &result->observation, NULL, error,
                                  error_capacity);
            return status;
        } else if (phase == R0_PHASE_VERIFIED) {
            if (action != R0_ACTION_COMMIT) return R0_POLICY_ERROR;
            result->accepted = 1;
            result->sealed_answer.answer.version = R0_IR_VERSION;
            result->sealed_answer.answer.matrix = canonical;
            result->sealed_answer.answer.certificate = result->observation;
            status = seal_answer(&result->sealed_answer, error,
                                 error_capacity);
            if (status != R0_OK) return status;
            status = append_event(result, R0_EVENT_ANSWER_SEALED, cycle,
                                  R0_PHASE_SEALED, action, R0_TOOL_NONE,
                                  &result->observation,
                                  result->sealed_answer.seal, error,
                                  error_capacity);
            if (status != R0_OK) return status;
            phase = R0_PHASE_SEALED;
        } else if (phase == R0_PHASE_SEALED) {
            if (action != R0_ACTION_RENDER) return R0_POLICY_ERROR;
            status = r0_render_language(&result->sealed_answer,
                                        result->language,
                                        sizeof(result->language), error,
                                        error_capacity);
            if (status != R0_OK) return status;
            return append_event(result, R0_EVENT_TOOL_RESULT, cycle,
                                R0_PHASE_COMPLETE, action,
                                R0_TOOL_LANGUAGE_RENDER,
                                &result->observation,
                                result->sealed_answer.seal, error,
                                error_capacity);
        }
    }
    return R0_LIMIT_ERROR;
}

static int proposal_seen(R0ProposalSet *set, const R0CartanMatrix *matrix)
{
    int index;
    for (index = 0; index < set->count; ++index)
        if (matrix_equal(&set->items[index], matrix)) return 1;
    if (set->count >= R0_MAX_PROPOSALS_PER_RANK) return -1;
    set->items[set->count++] = *matrix;
    return 0;
}

static int accepted_add(R0MatrixList *list, const R0CartanMatrix *matrix)
{
    int index;
    for (index = 0; index < list->count; ++index)
        if (matrix_equal(&list->items[index], matrix)) return 0;
    if (list->count >= R0_MAX_TYPES_PER_RANK) return -1;
    list->items[list->count++] = *matrix;
    return 1;
}

static void extend_leaf(const R0CartanMatrix *base, int attachment,
                        int bond, R0CartanMatrix *candidate)
{
    int row, column;
    matrix_diagonal(candidate, (uint8_t)(base->rank + 1));
    for (row = 0; row < base->rank; ++row)
        for (column = 0; column < base->rank; ++column)
            CELL(candidate, row, column) = CELL(base, row, column);
    matrix_edge(candidate, attachment, base->rank, R0_BONDS[bond][0],
                R0_BONDS[bond][1]);
}

static int compare_type_names(const void *left, const void *right)
{
    const char *const *a = left;
    const char *const *b = right;
    return strcmp(*a, *b);
}

static int finish_rank_report(const R0MatrixList *list, uint8_t rank,
                              R0EnumerationReport *report)
{
    const char *names[R0_MAX_TYPES_PER_RANK];
    size_t used = 0;
    int index;
    if (list->count != R0_EXPECTED_COUNTS[rank]) return 0;
    for (index = 0; index < list->count; ++index) {
        names[index] = r0_cartan_type(&list->items[index]);
        if (strcmp(names[index], "unknown") == 0) return 0;
    }
    qsort(names, list->count, sizeof(names[0]), compare_type_names);
    for (index = 0; index < list->count; ++index) {
        int written = snprintf(report->types_by_rank[rank] + used,
                               sizeof(report->types_by_rank[rank]) - used,
                               "%s%s", index == 0 ? "" : ",", names[index]);
        if (written < 0 ||
            (size_t)written >= sizeof(report->types_by_rank[rank]) - used)
            return 0;
        used += (size_t)written;
    }
    report->count_by_rank[rank] = list->count;
    return strcmp(report->types_by_rank[rank], R0_EXPECTED_TYPES[rank]) == 0;
}

static R0Status write_dataset_record(FILE *dataset,
                                     const R0CartanMatrix *matrix,
                                     const R0RunResult *result,
                                     unsigned weight, int boundary_scan,
                                     char *error, size_t error_capacity)
{
    int row, column;
    if (dataset == NULL) return R0_OK;
    (void)fprintf(dataset,
                  "{\"schema\":\"zero.reasoner0_cartan_example.v1\","
                  "\"rank\":%u,\"matrix\":[",
                  (unsigned)matrix->rank);
    for (row = 0; row < matrix->rank; ++row) {
        if (row != 0) (void)fputc(',', dataset);
        (void)fputc('[', dataset);
        for (column = 0; column < matrix->rank; ++column) {
            if (column != 0) (void)fputc(',', dataset);
            (void)fprintf(dataset, "%d", CELL(matrix, row, column));
        }
        (void)fputc(']', dataset);
    }
    (void)fprintf(dataset,
                  "],\"boundary_scan\":%s,\"accepted\":%s,"
                  "\"failure\":\"%s\",\"verifier\":{"
                  "\"row\":%u,\"column\":%u,\"principal_mask\":%u,"
                  "\"determinant\":%lld,"
                  "\"checked_principal_minors\":%u},\"symmetrizer\":[",
                  boundary_scan ? "true" : "false",
                  result->accepted ? "true" : "false",
                  r0_failure_name(result->observation.failure),
                  (unsigned)result->observation.row,
                  (unsigned)result->observation.column,
                  (unsigned)result->observation.principal_mask,
                  (long long)result->observation.determinant,
                  (unsigned)result->observation.checked_principal_minors);
    for (row = 0; row < matrix->rank; ++row) {
        if (row != 0) (void)fputc(',', dataset);
        (void)fprintf(dataset, "%u", result->observation.symmetrizer[row]);
    }
    (void)fprintf(dataset,
                  "],\"weight\":%u,\"target_actions\":["
                  "\"call_cartan_verify\",\"%s\"%s]}\n",
                  weight, result->accepted ? "commit_answer" :
                                             "reject_candidate",
                  result->accepted ? ",\"call_language_render\"" : "");
    if (ferror(dataset)) {
        set_error(error, error_capacity,
                  "could not write Reasoner-0 dataset: %s", strerror(errno));
        return R0_IO_ERROR;
    }
    return R0_OK;
}

static R0Status score_proposal(const R0Policy *policy,
                               const R0CartanMatrix *candidate,
                               R0ProposalSet *seen, R0MatrixList *accepted,
                               R0EnumerationReport *report, int keep_positive,
                               int boundary_scan, FILE *dataset,
                               char *error, size_t error_capacity)
{
    R0CartanMatrix canonical;
    R0RunResult result;
    R0Status status = r0_cartan_canonicalize(candidate, &canonical, error,
                                             error_capacity);
    int seen_status;
    if (status != R0_OK) return status;
    seen_status = proposal_seen(seen, &canonical);
    if (seen_status < 0) return R0_LIMIT_ERROR;
    if (seen_status > 0) return R0_OK;
    ++report->proposed;
    status = r0_run(policy, &canonical, &result, error, error_capacity);
    if (status != R0_OK) return status;
    if (result.accepted) {
        if (keep_positive) {
            int added = accepted_add(accepted, &canonical);
            if (added < 0) return R0_LIMIT_ERROR;
            if (added > 0) ++report->accepted;
        }
    } else {
        ++report->rejected;
        if (result.observation.failure == R0_CARTAN_AFFINE_BOUNDARY) {
            ++report->affine_negatives;
            report->counterexample_weight += R0_AFFINE_EXAMPLE_WEIGHT;
        } else {
            ++report->counterexample_weight;
        }
    }
    if (!result.accepted || keep_positive) {
        unsigned weight = result.observation.failure ==
                                  R0_CARTAN_AFFINE_BOUNDARY
                              ? R0_AFFINE_EXAMPLE_WEIGHT
                              : 1U;
        return write_dataset_record(dataset, &canonical, &result, weight,
                                    boundary_scan, error, error_capacity);
    }
    return R0_OK;
}

static R0Status enumerate_internal(const R0Policy *policy,
                                   uint8_t maximum_rank,
                                   R0EnumerationReport *report,
                                   FILE *dataset, char *error,
                                   size_t error_capacity)
{
    R0MatrixList ranks[R0_ENUMERATION_MAX_RANK + 1];
    R0RunResult seed_result;
    uint8_t rank;
    int exact = 1;
    if (policy == NULL || report == NULL || maximum_rank == 0 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    memset(ranks, 0, sizeof(ranks));
    memset(report, 0, sizeof(*report));
    report->maximum_rank = maximum_rank;
    matrix_diagonal(&ranks[1].items[0], 1);
    ranks[1].count = 1;
    report->accepted = 1;
    exact &= finish_rank_report(&ranks[1], 1, report);
    if (dataset != NULL) {
        R0Status status = r0_run(policy, &ranks[1].items[0], &seed_result,
                                 error, error_capacity);
        if (status != R0_OK) return status;
        status = write_dataset_record(dataset, &ranks[1].items[0],
                                      &seed_result, 1U, 0, error,
                                      error_capacity);
        if (status != R0_OK) return status;
    }
    for (rank = 2; rank <= maximum_rank; ++rank) {
        R0ProposalSet seen;
        int base_index;
        memset(&seen, 0, sizeof(seen));
        for (base_index = 0; base_index < ranks[rank - 1].count;
             ++base_index) {
            const R0CartanMatrix *base = &ranks[rank - 1].items[base_index];
            int attachment, bond;
            for (attachment = 0; attachment < base->rank; ++attachment) {
                for (bond = 0; bond < 5; ++bond) {
                    R0CartanMatrix candidate;
                    R0Status status;
                    extend_leaf(base, attachment, bond, &candidate);
                    status = score_proposal(policy, &candidate, &seen,
                                            &ranks[rank], report, 1, 0,
                                            dataset, error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
        }
        exact &= finish_rank_report(&ranks[rank], rank, report);
    }
    if (maximum_rank == R0_ENUMERATION_MAX_RANK) {
        R0ProposalSet boundary_seen;
        int base_index;
        memset(&boundary_seen, 0, sizeof(boundary_seen));
        for (base_index = 0; base_index < ranks[maximum_rank].count;
             ++base_index) {
            const R0CartanMatrix *base = &ranks[maximum_rank].items[base_index];
            int attachment, bond;
            for (attachment = 0; attachment < base->rank; ++attachment) {
                for (bond = 0; bond < 5; ++bond) {
                    R0CartanMatrix candidate;
                    R0Status status;
                    extend_leaf(base, attachment, bond, &candidate);
                    status = score_proposal(policy, &candidate, &boundary_seen,
                                            NULL, report, 0, 1, dataset,
                                            error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
        }
    }
    report->exact_precision_recall = (uint8_t)exact;
    return exact ? R0_OK : R0_VERIFIER_ERROR;
}

R0Status r0_enumerate(const R0Policy *policy, uint8_t maximum_rank,
                      R0EnumerationReport *report, char *error,
                      size_t error_capacity)
{
    return enumerate_internal(policy, maximum_rank, report, NULL, error,
                              error_capacity);
}

R0Status r0_enumerate_dataset(const R0Policy *policy, uint8_t maximum_rank,
                              const char *path,
                              R0EnumerationReport *report, char *error,
                              size_t error_capacity)
{
    char *temporary;
    size_t path_length;
    FILE *dataset;
    R0Status status;
    if (path == NULL || path[0] == '\0') {
        set_error(error, error_capacity, "dataset path is required");
        return R0_INVALID_ARGUMENT;
    }
    path_length = strlen(path);
    temporary = malloc(path_length + 5U);
    if (temporary == NULL) return R0_IO_ERROR;
    (void)snprintf(temporary, path_length + 5U, "%s.tmp", path);
    dataset = fopen(temporary, "wb");
    if (dataset == NULL) {
        set_error(error, error_capacity, "could not create %s: %s",
                  temporary, strerror(errno));
        free(temporary);
        return R0_IO_ERROR;
    }
    status = enumerate_internal(policy, maximum_rank, report, dataset, error,
                                error_capacity);
    if (status != R0_OK) {
        (void)fclose(dataset);
        (void)remove(temporary);
        free(temporary);
        return status;
    }
    if (fclose(dataset) != 0 || rename(temporary, path) != 0) {
        set_error(error, error_capacity, "could not install %s: %s", path,
                  strerror(errno));
        (void)remove(temporary);
        free(temporary);
        return R0_IO_ERROR;
    }
    free(temporary);
    return R0_OK;
}
