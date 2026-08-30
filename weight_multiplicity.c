#include "weight_multiplicity.h"

#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WM_CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

typedef struct {
    int sign;
    WMBigUInt magnitude;
} WMSignedBig;

typedef struct {
    uint8_t used;
    int32_t coefficient[WM_MAX_RANK];
    WMBigUInt value;
} WMMemoEntry;

typedef struct {
    WMMemoEntry *entry;
    size_t capacity;
    size_t count;
    uint8_t rank;
} WMMemo;

typedef struct {
    const WMOracle *oracle;
    const int32_t *highest_weight;
    WMMemo memo;
    WMQueryStats *stats;
    char *error;
    size_t error_capacity;
} WMRecurrence;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static int big_is_zero(const WMBigUInt *value)
{
    size_t index;
    for (index = 0; index < WM_BIG_LIMBS; ++index)
        if (value->limb[index] != 0) return 0;
    return 1;
}

static int big_compare(const WMBigUInt *left, const WMBigUInt *right)
{
    size_t index = WM_BIG_LIMBS;
    while (index-- > 0) {
        if (left->limb[index] < right->limb[index]) return -1;
        if (left->limb[index] > right->limb[index]) return 1;
    }
    return 0;
}

static int big_add(WMBigUInt *target, const WMBigUInt *source)
{
    uint64_t carry = 0;
    size_t index;
    for (index = 0; index < WM_BIG_LIMBS; ++index) {
        uint64_t sum = (uint64_t)target->limb[index] +
                       source->limb[index] + carry;
        target->limb[index] = (uint32_t)sum;
        carry = sum >> 32;
    }
    return carry == 0;
}

static void big_subtract(WMBigUInt *target, const WMBigUInt *source)
{
    uint64_t borrow = 0;
    size_t index;
    for (index = 0; index < WM_BIG_LIMBS; ++index) {
        uint64_t subtrahend = (uint64_t)source->limb[index] + borrow;
        uint64_t current = target->limb[index];
        target->limb[index] = (uint32_t)(current - subtrahend);
        borrow = current < subtrahend;
    }
}

static int big_multiply_u32(const WMBigUInt *source, uint32_t factor,
                            WMBigUInt *product)
{
    uint64_t carry = 0;
    size_t index;
    memset(product, 0, sizeof(*product));
    for (index = 0; index < WM_BIG_LIMBS; ++index) {
        uint64_t value = (uint64_t)source->limb[index] * factor + carry;
        product->limb[index] = (uint32_t)value;
        carry = value >> 32;
    }
    return carry == 0;
}

static uint32_t big_divide_u32(WMBigUInt *value, uint32_t divisor)
{
    uint64_t remainder = 0;
    size_t index = WM_BIG_LIMBS;
    while (index-- > 0) {
        uint64_t current = (remainder << 32) | value->limb[index];
        value->limb[index] = (uint32_t)(current / divisor);
        remainder = current % divisor;
    }
    return (uint32_t)remainder;
}

static int signed_add_scaled(WMSignedBig *target, const WMBigUInt *source,
                             int64_t scale)
{
    WMBigUInt scaled;
    uint64_t magnitude;
    int sign;
    int comparison;
    if (scale == 0 || big_is_zero(source)) return 1;
    sign = scale < 0 ? -1 : 1;
    magnitude = scale < 0 ? (uint64_t)(-(scale + 1)) + 1U : (uint64_t)scale;
    if (magnitude > UINT32_MAX ||
        !big_multiply_u32(source, (uint32_t)magnitude, &scaled))
        return 0;
    if (target->sign == 0) {
        target->sign = sign;
        target->magnitude = scaled;
        return 1;
    }
    if (target->sign == sign) return big_add(&target->magnitude, &scaled);
    comparison = big_compare(&target->magnitude, &scaled);
    if (comparison == 0) {
        memset(target, 0, sizeof(*target));
    } else if (comparison > 0) {
        big_subtract(&target->magnitude, &scaled);
    } else {
        WMBigUInt difference = scaled;
        big_subtract(&difference, &target->magnitude);
        target->magnitude = difference;
        target->sign = sign;
    }
    return 1;
}

static int64_t determinant(int64_t matrix[WM_MAX_RANK][WM_MAX_RANK], int size,
                           int *exact)
{
    int64_t denominator = 1;
    int sign = 1;
    int pivot_index;
    *exact = 1;
    if (size == 0) return 1;
    for (pivot_index = 0; pivot_index < size - 1; ++pivot_index) {
        int pivot_row = pivot_index;
        int row, column;
        while (pivot_row < size && matrix[pivot_row][pivot_index] == 0)
            ++pivot_row;
        if (pivot_row == size) return 0;
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
                if (denominator != 1 && numerator % denominator != 0) {
                    *exact = 0;
                    return 0;
                }
                matrix[row][column] = numerator / denominator;
            }
            matrix[row][pivot_index] = 0;
        }
        denominator = matrix[pivot_index][pivot_index];
        if (denominator == 0) return 0;
    }
    return sign * matrix[size - 1][size - 1];
}

static int solve_simple_coefficients(const R0CartanMatrix *cartan,
                                     const int32_t delta[WM_MAX_RANK],
                                     int32_t coefficient[WM_MAX_RANK])
{
    int64_t base[WM_MAX_RANK][WM_MAX_RANK] = {{0}};
    int64_t work[WM_MAX_RANK][WM_MAX_RANK];
    int64_t base_determinant;
    int exact;
    int row, column, replaced;
    for (row = 0; row < cartan->rank; ++row)
        for (column = 0; column < cartan->rank; ++column)
            base[row][column] = WM_CELL(cartan, row, column);
    memcpy(work, base, sizeof(work));
    base_determinant = determinant(work, cartan->rank, &exact);
    if (!exact || base_determinant <= 0) return 0;
    for (replaced = 0; replaced < cartan->rank; ++replaced) {
        int64_t numerator;
        memcpy(work, base, sizeof(work));
        for (row = 0; row < cartan->rank; ++row)
            work[row][replaced] = delta[row];
        numerator = determinant(work, cartan->rank, &exact);
        if (!exact || numerator % base_determinant != 0 ||
            numerator / base_determinant < 0 ||
            numerator / base_determinant > INT32_MAX)
            return 0;
        coefficient[replaced] = (int32_t)(numerator / base_determinant);
    }
    return 1;
}

static int make_dominant(const R0CartanMatrix *cartan,
                         const int32_t input[WM_MAX_RANK],
                         int32_t output[WM_MAX_RANK])
{
    unsigned iteration;
    uint8_t index;
    memcpy(output, input, sizeof(int32_t) * WM_MAX_RANK);
    for (iteration = 0; iteration < 4096; ++iteration) {
        int reflection = -1;
        for (index = 0; index < cartan->rank; ++index) {
            if (output[index] < 0) {
                reflection = index;
                break;
            }
        }
        if (reflection < 0) return 1;
        {
            int64_t pairing = output[reflection];
            uint8_t row;
            for (row = 0; row < cartan->rank; ++row) {
                int64_t reflected =
                    (int64_t)output[row] -
                    pairing * WM_CELL(cartan, row, reflection);
                if (reflected < INT32_MIN || reflected > INT32_MAX) return 0;
                output[row] = (int32_t)reflected;
            }
        }
    }
    return 0;
}

static int root_equal(const int16_t left[WM_MAX_RANK],
                      const int16_t right[WM_MAX_RANK], uint8_t rank)
{
    uint8_t index;
    for (index = 0; index < rank; ++index)
        if (left[index] != right[index]) return 0;
    return 1;
}

static int add_root(int16_t roots[WM_MAX_ROOTS][WM_MAX_RANK], uint16_t *count,
                    const int16_t candidate[WM_MAX_RANK], uint8_t rank)
{
    uint16_t index;
    for (index = 0; index < *count; ++index)
        if (root_equal(roots[index], candidate, rank)) return 1;
    if (*count >= WM_MAX_ROOTS) return 0;
    memcpy(roots[*count], candidate, sizeof(roots[*count]));
    ++*count;
    return 1;
}

static int root_order(const int16_t left[WM_MAX_RANK],
                      const int16_t right[WM_MAX_RANK], uint8_t rank)
{
    int left_height = 0;
    int right_height = 0;
    uint8_t index;
    for (index = 0; index < rank; ++index) {
        left_height += left[index];
        right_height += right[index];
    }
    if (left_height != right_height) return left_height < right_height ? -1 : 1;
    for (index = 0; index < rank; ++index) {
        if (left[index] != right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
}

static int generate_positive_roots(const R0CartanMatrix *cartan,
                                   WMPositiveRoots *positive)
{
    int16_t roots[WM_MAX_ROOTS][WM_MAX_RANK] = {{0}};
    uint16_t root_count = 0;
    uint16_t cursor;
    uint8_t simple;
    memset(positive, 0, sizeof(*positive));
    positive->rank = cartan->rank;
    for (simple = 0; simple < cartan->rank; ++simple) {
        int16_t root[WM_MAX_RANK] = {0};
        root[simple] = 1;
        if (!add_root(roots, &root_count, root, cartan->rank)) return 0;
        root[simple] = -1;
        if (!add_root(roots, &root_count, root, cartan->rank)) return 0;
    }
    for (cursor = 0; cursor < root_count; ++cursor) {
        uint8_t reflection;
        for (reflection = 0; reflection < cartan->rank; ++reflection) {
            int16_t reflected[WM_MAX_RANK];
            int pairing = 0;
            uint8_t column;
            memcpy(reflected, roots[cursor], sizeof(reflected));
            for (column = 0; column < cartan->rank; ++column)
                pairing += WM_CELL(cartan, reflection, column) *
                           roots[cursor][column];
            reflected[reflection] = (int16_t)(reflected[reflection] - pairing);
            if (!add_root(roots, &root_count, reflected, cartan->rank)) return 0;
        }
    }
    for (cursor = 0; cursor < root_count; ++cursor) {
        int positive_root = 1;
        int nonzero = 0;
        uint8_t index;
        for (index = 0; index < cartan->rank; ++index) {
            if (roots[cursor][index] < 0) positive_root = 0;
            if (roots[cursor][index] != 0) nonzero = 1;
        }
        if (!positive_root || !nonzero) continue;
        if (positive->count >= WM_MAX_POSITIVE_ROOTS) return 0;
        memcpy(positive->coefficient[positive->count], roots[cursor],
               sizeof(positive->coefficient[positive->count]));
        ++positive->count;
    }
    for (cursor = 1; cursor < positive->count; ++cursor) {
        int16_t current[WM_MAX_RANK];
        uint16_t position = cursor;
        memcpy(current, positive->coefficient[cursor], sizeof(current));
        while (position > 0 &&
               root_order(current, positive->coefficient[position - 1],
                          cartan->rank) < 0) {
            memcpy(positive->coefficient[position],
                   positive->coefficient[position - 1],
                   sizeof(positive->coefficient[position]));
            --position;
        }
        memcpy(positive->coefficient[position], current, sizeof(current));
    }
    return positive->count * 2U == root_count;
}

static uint64_t memo_hash(const int32_t coefficient[WM_MAX_RANK], uint8_t rank)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    uint8_t index;
    for (index = 0; index < rank; ++index) {
        uint32_t value = (uint32_t)coefficient[index];
        unsigned byte;
        for (byte = 0; byte < 4; ++byte) {
            hash ^= (value >> (byte * 8U)) & 0xffU;
            hash *= UINT64_C(1099511628211);
        }
    }
    return hash;
}

static WMMemoEntry *memo_find(WMMemo *memo,
                              const int32_t coefficient[WM_MAX_RANK])
{
    size_t mask = memo->capacity - 1U;
    size_t slot = (size_t)memo_hash(coefficient, memo->rank) & mask;
    while (memo->entry[slot].used) {
        uint8_t index;
        int equal = 1;
        for (index = 0; index < memo->rank; ++index)
            if (memo->entry[slot].coefficient[index] != coefficient[index])
                equal = 0;
        if (equal) return &memo->entry[slot];
        slot = (slot + 1U) & mask;
    }
    return NULL;
}

static int memo_rehash(WMMemo *memo, size_t capacity)
{
    WMMemoEntry *old = memo->entry;
    size_t old_capacity = memo->capacity;
    size_t index;
    memo->entry = calloc(capacity, sizeof(*memo->entry));
    if (memo->entry == NULL) {
        memo->entry = old;
        return 0;
    }
    memo->capacity = capacity;
    memo->count = 0;
    for (index = 0; index < old_capacity; ++index) {
        size_t mask, slot;
        if (!old[index].used) continue;
        mask = memo->capacity - 1U;
        slot = (size_t)memo_hash(old[index].coefficient, memo->rank) & mask;
        while (memo->entry[slot].used) slot = (slot + 1U) & mask;
        memo->entry[slot] = old[index];
        ++memo->count;
    }
    free(old);
    return 1;
}

static int memo_insert(WMMemo *memo,
                       const int32_t coefficient[WM_MAX_RANK],
                       const WMBigUInt *value)
{
    size_t mask, slot;
    if ((memo->count + 1U) * 10U >= memo->capacity * 7U &&
        !memo_rehash(memo, memo->capacity * 2U))
        return 0;
    mask = memo->capacity - 1U;
    slot = (size_t)memo_hash(coefficient, memo->rank) & mask;
    while (memo->entry[slot].used) slot = (slot + 1U) & mask;
    memo->entry[slot].used = 1;
    memcpy(memo->entry[slot].coefficient, coefficient,
           sizeof(memo->entry[slot].coefficient));
    memo->entry[slot].value = *value;
    ++memo->count;
    return 1;
}

static uint32_t coefficient_level(const int32_t coefficient[WM_MAX_RANK],
                                  uint8_t rank)
{
    uint32_t level = 0;
    uint8_t index;
    for (index = 0; index < rank; ++index)
        level += (uint32_t)coefficient[index];
    return level;
}

static WMStatus multiplicity_for_coefficient(
    WMRecurrence *recurrence, const int32_t coefficient[WM_MAX_RANK],
    WMBigUInt *multiplicity)
{
    const WMOracle *oracle = recurrence->oracle;
    WMMemoEntry *cached;
    int all_zero = 1;
    int64_t target[WM_MAX_RANK] = {0};
    int64_t denominator = 0;
    WMSignedBig numerator = {0};
    uint8_t index;
    uint16_t root_index;
    for (index = 0; index < oracle->cartan.rank; ++index)
        if (coefficient[index] != 0) all_zero = 0;
    memset(multiplicity, 0, sizeof(*multiplicity));
    if (all_zero) {
        multiplicity->limb[0] = 1;
        return WM_OK;
    }
    cached = memo_find(&recurrence->memo, coefficient);
    if (cached != NULL) {
        *multiplicity = cached->value;
        return WM_OK;
    }
    if (recurrence->stats != NULL) {
        uint32_t level = coefficient_level(coefficient, oracle->cartan.rank);
        if (level > recurrence->stats->maximum_level)
            recurrence->stats->maximum_level = level;
    }
    for (index = 0; index < oracle->cartan.rank; ++index) {
        uint8_t simple;
        target[index] = recurrence->highest_weight[index];
        for (simple = 0; simple < oracle->cartan.rank; ++simple)
            target[index] -= (int64_t)WM_CELL(&oracle->cartan, index, simple) *
                             coefficient[simple];
    }
    for (index = 0; index < oracle->cartan.rank; ++index) {
        int64_t sum = recurrence->highest_weight[index] + target[index] + 2;
        denominator += (int64_t)coefficient[index] *
                       oracle->symmetrizer[index] * sum;
    }
    if (denominator <= 0) {
        if (!memo_insert(&recurrence->memo, coefficient, multiplicity)) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "weight multiplicity memo allocation failed");
            return WM_MEMORY_ERROR;
        }
        if (recurrence->stats != NULL)
            recurrence->stats->memo_entries = recurrence->memo.count;
        return WM_OK;
    }
    if (denominator > UINT32_MAX) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "Freudenthal denominator is outside the supported range");
        return WM_LIMIT_ERROR;
    }
    for (root_index = 0; root_index < oracle->positive_roots.count;
         ++root_index) {
        const int16_t *root = oracle->positive_roots.coefficient[root_index];
        int32_t raised[WM_MAX_RANK];
        uint32_t multiple = 0;
        memcpy(raised, coefficient, sizeof(raised));
        for (;;) {
            int valid = 1;
            int64_t inner = 0;
            WMBigUInt raised_multiplicity;
            WMStatus status;
            ++multiple;
            for (index = 0; index < oracle->cartan.rank; ++index) {
                raised[index] -= root[index];
                if (raised[index] < 0) valid = 0;
            }
            if (!valid) break;
            status = multiplicity_for_coefficient(recurrence, raised,
                                                  &raised_multiplicity);
            if (status != WM_OK) return status;
            if (big_is_zero(&raised_multiplicity)) continue;
            for (index = 0; index < oracle->cartan.rank; ++index) {
                int64_t raised_weight = target[index];
                uint8_t simple;
                for (simple = 0; simple < oracle->cartan.rank; ++simple)
                    raised_weight +=
                        (int64_t)multiple *
                        WM_CELL(&oracle->cartan, index, simple) * root[simple];
                inner += (int64_t)root[index] *
                         oracle->symmetrizer[index] * raised_weight;
            }
            if (recurrence->stats != NULL) ++recurrence->stats->recurrence_terms;
            if (inner > INT64_MAX / 2 || inner < INT64_MIN / 2 ||
                !signed_add_scaled(&numerator, &raised_multiplicity,
                                   2 * inner)) {
                set_error(recurrence->error, recurrence->error_capacity,
                          "Freudenthal numerator exceeds the exact integer capacity");
                return WM_LIMIT_ERROR;
            }
        }
    }
    if (numerator.sign < 0) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "Freudenthal numerator became negative");
        return WM_ARITHMETIC_ERROR;
    }
    if (numerator.sign > 0) {
        if (big_divide_u32(&numerator.magnitude, (uint32_t)denominator) != 0) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "Freudenthal division was not exact");
            return WM_ARITHMETIC_ERROR;
        }
        *multiplicity = numerator.magnitude;
    }
    if (!memo_insert(&recurrence->memo, coefficient, multiplicity)) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "weight multiplicity memo allocation failed");
        return WM_MEMORY_ERROR;
    }
    if (recurrence->stats != NULL)
        recurrence->stats->memo_entries = recurrence->memo.count;
    return WM_OK;
}

WMStatus wm_oracle_init(const R0CartanMatrix *cartan, WMOracle *oracle,
                        char *error, size_t error_capacity)
{
    R0VerifierObservation observation;
    R0Status status;
    if (cartan == NULL || oracle == NULL) return WM_INVALID_ARGUMENT;
    if (cartan->rank == 0 || cartan->rank > WM_MAX_RANK) {
        set_error(error, error_capacity, "weight oracle supports ranks 1 through 8");
        return WM_INVALID_ARGUMENT;
    }
    status = r0_cartan_verify(cartan, &observation, error, error_capacity);
    if (status != R0_OK || !observation.accepted) {
        if (status == R0_OK)
            set_error(error, error_capacity, "Cartan verifier rejected the matrix: %s",
                      r0_failure_name(observation.failure));
        return WM_INVALID_CARTAN;
    }
    memset(oracle, 0, sizeof(*oracle));
    oracle->cartan = *cartan;
    memcpy(oracle->symmetrizer, observation.symmetrizer,
           sizeof(oracle->symmetrizer));
    if (!generate_positive_roots(cartan, &oracle->positive_roots)) {
        set_error(error, error_capacity, "positive-root closure exceeded its bound");
        return WM_LIMIT_ERROR;
    }
    return WM_OK;
}

WMStatus wm_oracle_init_type(const char *type, WMOracle *oracle, char *error,
                             size_t error_capacity)
{
    R0CartanMatrix cartan;
    R0Status status =
        r0_cartan_make_type(type, &cartan, error, error_capacity);
    if (status != R0_OK) return WM_INVALID_ARGUMENT;
    return wm_oracle_init(&cartan, oracle, error, error_capacity);
}

WMStatus wm_weight_multiplicity(const WMOracle *oracle,
                                const int32_t highest_weight[WM_MAX_RANK],
                                const int32_t target_weight[WM_MAX_RANK],
                                WMBigUInt *multiplicity, WMQueryStats *stats,
                                char *error, size_t error_capacity)
{
    int32_t delta[WM_MAX_RANK] = {0};
    int32_t coefficient[WM_MAX_RANK] = {0};
    int32_t dominant_target[WM_MAX_RANK] = {0};
    WMRecurrence recurrence;
    WMStatus status;
    uint8_t index;
    if (oracle == NULL || highest_weight == NULL || target_weight == NULL ||
        multiplicity == NULL)
        return WM_INVALID_ARGUMENT;
    for (index = 0; index < oracle->cartan.rank; ++index) {
        if (highest_weight[index] < 0) {
            set_error(error, error_capacity,
                      "highest weight must have non-negative Dynkin labels");
            return WM_NOT_DOMINANT;
        }
    }
    memset(multiplicity, 0, sizeof(*multiplicity));
    if (stats != NULL) memset(stats, 0, sizeof(*stats));
    if (!make_dominant(&oracle->cartan, target_weight, dominant_target)) {
        set_error(error, error_capacity,
                  "target Weyl reduction exceeded the exact integer range");
        return WM_LIMIT_ERROR;
    }
    for (index = 0; index < oracle->cartan.rank; ++index)
        delta[index] = highest_weight[index] - dominant_target[index];
    if (!solve_simple_coefficients(&oracle->cartan, delta, coefficient))
        return WM_OK;
    memset(&recurrence, 0, sizeof(recurrence));
    recurrence.oracle = oracle;
    recurrence.highest_weight = highest_weight;
    recurrence.stats = stats;
    recurrence.error = error;
    recurrence.error_capacity = error_capacity;
    recurrence.memo.rank = oracle->cartan.rank;
    recurrence.memo.capacity = 1024;
    recurrence.memo.entry =
        calloc(recurrence.memo.capacity, sizeof(*recurrence.memo.entry));
    if (recurrence.memo.entry == NULL) return WM_MEMORY_ERROR;
    status = multiplicity_for_coefficient(&recurrence, coefficient,
                                          multiplicity);
    free(recurrence.memo.entry);
    return status;
}

WMStatus wm_big_to_decimal(const WMBigUInt *value, char *output,
                           size_t output_capacity)
{
    WMBigUInt remaining;
    uint32_t chunk[40];
    size_t count = 0;
    size_t written;
    if (value == NULL || output == NULL || output_capacity == 0)
        return WM_INVALID_ARGUMENT;
    remaining = *value;
    if (big_is_zero(&remaining)) {
        if (output_capacity < 2) return WM_LIMIT_ERROR;
        memcpy(output, "0", 2);
        return WM_OK;
    }
    while (!big_is_zero(&remaining)) {
        if (count >= sizeof(chunk) / sizeof(chunk[0])) return WM_LIMIT_ERROR;
        chunk[count++] = big_divide_u32(&remaining, UINT32_C(1000000000));
    }
    written = (size_t)snprintf(output, output_capacity, "%u", chunk[count - 1]);
    if (written >= output_capacity) return WM_LIMIT_ERROR;
    while (count-- > 1) {
        int result = snprintf(output + written, output_capacity - written,
                              "%09u", chunk[count - 1]);
        if (result < 0 || (size_t)result >= output_capacity - written)
            return WM_LIMIT_ERROR;
        written += (size_t)result;
    }
    return WM_OK;
}

int wm_big_equal_u32(const WMBigUInt *value, uint32_t expected)
{
    size_t index;
    if (value == NULL || value->limb[0] != expected) return 0;
    for (index = 1; index < WM_BIG_LIMBS; ++index)
        if (value->limb[index] != 0) return 0;
    return 1;
}

const char *wm_status_name(WMStatus status)
{
    switch (status) {
    case WM_OK: return "ok";
    case WM_INVALID_ARGUMENT: return "invalid_argument";
    case WM_INVALID_CARTAN: return "invalid_cartan";
    case WM_NOT_DOMINANT: return "highest_weight_not_dominant";
    case WM_LIMIT_ERROR: return "limit_error";
    case WM_ARITHMETIC_ERROR: return "arithmetic_error";
    case WM_MEMORY_ERROR: return "memory_error";
    }
    return "unknown";
}
