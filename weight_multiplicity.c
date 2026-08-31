#include "weight_multiplicity.h"

#include <limits.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

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
    size_t maximum_bytes;
    size_t allocated_bytes;
    size_t peak_allocated_bytes;
    int limit_reached;
} WMMemoryBudget;

typedef struct {
    WMMemoEntry *entry;
    size_t capacity;
    size_t count;
    size_t allocated_bytes;
    size_t peak_allocated_bytes;
    uint8_t rank;
    int limit_reached;
    WMMemoryBudget *budget;
} WMMemo;

typedef struct {
    int64_t scale;
    uint32_t dependency;
    uint32_t term_count_and_flags;
} WMDependencyEdge;

_Static_assert(sizeof(WMDependencyEdge) == 16,
               "prepared dependency edges must remain compact");

#define WM_EDGE_SCALE_UNSUPPORTED UINT32_C(0x80000000)
#define WM_EDGE_TERM_COUNT_MASK UINT32_C(0x7fffffff)
#define WM_EDGE_BLOCK_SHIFT 16U
#define WM_EDGE_BLOCK_SIZE (UINT32_C(1) << WM_EDGE_BLOCK_SHIFT)
#define WM_EDGE_BLOCK_MASK (WM_EDGE_BLOCK_SIZE - 1U)
#define WM_MAX_PREPARED_WORKERS 32U
#define WM_PREPARED_PARALLEL_EDGE_THRESHOLD 4096U

typedef struct {
    int32_t coefficient[WM_MAX_RANK];
    WMBigUInt value;
    uint64_t edge_offset;
    uint32_t edge_count;
    uint32_t level;
    uint32_t denominator;
    uint64_t recurrence_terms;
    uint8_t edges_ready;
    uint8_t value_ready;
} WMDependencyNode;

typedef struct {
    uint32_t generation;
    uint32_t entry_plus_one;
} WMDependencyScratchSlot;

typedef struct {
    int64_t scale;
    int32_t coefficient[WM_MAX_RANK];
    uint32_t term_count_and_flags;
} WMDependencyScratchEntry;

typedef struct {
    WMDependencyScratchEntry *entry;
    size_t capacity;
    size_t count;
    WMDependencyScratchSlot *slot;
    size_t slot_capacity;
    uint32_t generation;
} WMDependencyScratch;

typedef struct {
    WMDependencyNode *node;
    size_t node_capacity;
    size_t node_count;
    uint32_t *node_slot;
    size_t node_slot_capacity;
    WMDependencyEdge **edge_block;
    size_t edge_block_capacity;
    size_t edge_block_count;
    size_t edge_count;
    uint64_t *order;
    size_t order_capacity;
    size_t allocated_bytes;
    size_t peak_allocated_bytes;
    WMMemoryBudget *budget;
    uint8_t rank;
    uint8_t worker_count;
} WMDependencyGraph;

struct WMRepresentationSession {
    const WMOracle *oracle;
    int32_t highest_weight[WM_MAX_RANK];
    WMMemoryBudget budget;
    WMMemo memo;
    WMDependencyGraph graph;
};

typedef struct {
    const WMOracle *oracle;
    const int32_t *highest_weight;
    WMMemo *memo;
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

static uint64_t wall_time_nanoseconds(void)
{
    struct timespec now;
    if (timespec_get(&now, TIME_UTC) != TIME_UTC) return 0;
    return (uint64_t)now.tv_sec * UINT64_C(1000000000) +
           (uint64_t)now.tv_nsec;
}

static uint8_t configured_prepared_worker_count(void)
{
    const char *configured = getenv("ZERO_WEIGHT_PREPARED_WORKERS");
    char *end = NULL;
    unsigned long value;
    if (configured == NULL || *configured == '\0') return 8U;
    value = strtoul(configured, &end, 10);
    if (end == configured || *end != '\0' || value < 1U ||
        value > WM_MAX_PREPARED_WORKERS)
        return 8U;
    return (uint8_t)value;
}

static void *budget_calloc(WMMemoryBudget *budget, size_t count, size_t size)
{
    size_t bytes;
    void *allocation;
    if (count != 0 && size > SIZE_MAX / count) {
        budget->limit_reached = 1;
        return NULL;
    }
    bytes = count * size;
    if (bytes > budget->maximum_bytes - budget->allocated_bytes) {
        budget->limit_reached = 1;
        return NULL;
    }
    allocation = calloc(count, size);
    if (allocation == NULL) return NULL;
    budget->allocated_bytes += bytes;
    if (budget->allocated_bytes > budget->peak_allocated_bytes)
        budget->peak_allocated_bytes = budget->allocated_bytes;
    return allocation;
}

static void budget_free(WMMemoryBudget *budget, void *allocation, size_t bytes)
{
    if (allocation == NULL) return;
    free(allocation);
    budget->allocated_bytes -= bytes;
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

static int big_multiply_u64(const WMBigUInt *source, uint64_t factor,
                            WMBigUInt *product)
{
    uint32_t low = (uint32_t)factor;
    uint32_t high = (uint32_t)(factor >> 32);
    uint64_t carry = 0;
    size_t index;
    if (!big_multiply_u32(source, low, product)) return 0;
    if (high == 0) return 1;
    for (index = 0; index < WM_BIG_LIMBS; ++index) {
        uint64_t value = (uint64_t)source->limb[index] * high + carry;
        if (index + 1U == WM_BIG_LIMBS) return value == 0;
        value += product->limb[index + 1U];
        product->limb[index + 1U] = (uint32_t)value;
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
    if (!big_multiply_u64(source, magnitude, &scaled))
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
        hash ^= (uint32_t)coefficient[index];
        hash *= UINT64_C(1099511628211);
        hash ^= hash >> 32;
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
    size_t old_bytes;
    size_t new_bytes;
    size_t index;
    old_bytes = old_capacity * sizeof(*memo->entry);
    if (capacity > SIZE_MAX / sizeof(*memo->entry)) {
        memo->limit_reached = 1;
        return 0;
    }
    new_bytes = capacity * sizeof(*memo->entry);
    memo->budget->limit_reached = 0;
    memo->entry = budget_calloc(memo->budget, capacity, sizeof(*memo->entry));
    if (memo->entry == NULL) {
        memo->entry = old;
        memo->limit_reached = memo->budget->limit_reached;
        return 0;
    }
    if (old_bytes + new_bytes > memo->peak_allocated_bytes)
        memo->peak_allocated_bytes = old_bytes + new_bytes;
    memo->allocated_bytes = old_bytes + new_bytes;
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
    budget_free(memo->budget, old, old_bytes);
    memo->allocated_bytes -= old_bytes;
    return 1;
}

static int memo_insert(WMMemo *memo,
                       const int32_t coefficient[WM_MAX_RANK],
                       const WMBigUInt *value)
{
    size_t mask, slot;
    if ((memo->count + 1U) * 10U >= memo->capacity * 7U) {
        if (memo->capacity > SIZE_MAX / 2U ||
            !memo_rehash(memo, memo->capacity * 2U))
            return 0;
    }
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

static void *graph_allocate(WMDependencyGraph *graph, size_t count,
                            size_t size)
{
    void *allocation = budget_calloc(graph->budget, count, size);
    size_t bytes;
    if (allocation == NULL) return NULL;
    bytes = count * size;
    graph->allocated_bytes += bytes;
    if (graph->allocated_bytes > graph->peak_allocated_bytes)
        graph->peak_allocated_bytes = graph->allocated_bytes;
    return allocation;
}

static void graph_release(WMDependencyGraph *graph, void *allocation,
                          size_t bytes)
{
    if (allocation == NULL) return;
    budget_free(graph->budget, allocation, bytes);
    graph->allocated_bytes -= bytes;
}

static void *graph_replace_array(WMDependencyGraph *graph, void *old,
                                 size_t old_count, size_t new_count,
                                 size_t size)
{
    void *replacement = graph_allocate(graph, new_count, size);
    if (replacement == NULL) return NULL;
    if (old != NULL) memcpy(replacement, old, old_count * size);
    graph_release(graph, old, old_count * size);
    return replacement;
}

static int graph_reserve_nodes(WMDependencyGraph *graph, size_t required)
{
    size_t capacity = graph->node_capacity == 0 ? 1024U
                                                : graph->node_capacity;
    WMDependencyNode *replacement;
    if (required <= graph->node_capacity) return 1;
    while (capacity < required) {
        if (capacity > SIZE_MAX / 2U) return 0;
        capacity *= 2U;
    }
    replacement = graph_replace_array(
        graph, graph->node, graph->node_capacity, capacity,
        sizeof(*graph->node));
    if (replacement == NULL) return 0;
    graph->node = replacement;
    graph->node_capacity = capacity;
    return 1;
}

static int graph_reserve_edges(WMDependencyGraph *graph, size_t required)
{
    size_t required_blocks;
    if (required > SIZE_MAX - (WM_EDGE_BLOCK_SIZE - 1U)) return 0;
    required_blocks =
        (required + WM_EDGE_BLOCK_SIZE - 1U) >> WM_EDGE_BLOCK_SHIFT;
    if (required_blocks > graph->edge_block_capacity) {
        size_t capacity = graph->edge_block_capacity == 0
                              ? 16U
                              : graph->edge_block_capacity;
        WMDependencyEdge **replacement;
        while (capacity < required_blocks) {
            if (capacity > SIZE_MAX / 2U) return 0;
            capacity *= 2U;
        }
        replacement = graph_replace_array(
            graph, graph->edge_block, graph->edge_block_capacity, capacity,
            sizeof(*graph->edge_block));
        if (replacement == NULL) return 0;
        graph->edge_block = replacement;
        graph->edge_block_capacity = capacity;
    }
    while (graph->edge_block_count < required_blocks) {
        WMDependencyEdge *block = graph_allocate(
            graph, WM_EDGE_BLOCK_SIZE, sizeof(*block));
        if (block == NULL) return 0;
        graph->edge_block[graph->edge_block_count++] = block;
    }
    return 1;
}

static WMDependencyEdge *graph_edge_at(WMDependencyGraph *graph,
                                       uint64_t index)
{
    return &graph->edge_block[index >> WM_EDGE_BLOCK_SHIFT]
                             [index & WM_EDGE_BLOCK_MASK];
}

static int graph_reserve_order(WMDependencyGraph *graph, size_t required)
{
    size_t capacity = graph->order_capacity == 0 ? 1024U
                                                 : graph->order_capacity;
    uint64_t *replacement;
    if (required <= graph->order_capacity) return 1;
    while (capacity < required) {
        if (capacity > SIZE_MAX / 2U) return 0;
        capacity *= 2U;
    }
    replacement = graph_replace_array(
        graph, graph->order, graph->order_capacity, capacity,
        sizeof(*graph->order));
    if (replacement == NULL) return 0;
    graph->order = replacement;
    graph->order_capacity = capacity;
    return 1;
}

static int graph_rehash_nodes(WMDependencyGraph *graph, size_t capacity)
{
    uint32_t *old = graph->node_slot;
    size_t old_capacity = graph->node_slot_capacity;
    uint32_t *replacement;
    size_t index;
    replacement = graph_allocate(graph, capacity, sizeof(*replacement));
    if (replacement == NULL) return 0;
    graph->node_slot = replacement;
    graph->node_slot_capacity = capacity;
    for (index = 0; index < graph->node_count; ++index) {
        size_t mask = capacity - 1U;
        size_t slot = (size_t)memo_hash(graph->node[index].coefficient,
                                        graph->rank) & mask;
        while (replacement[slot] != 0) slot = (slot + 1U) & mask;
        replacement[slot] = (uint32_t)index + 1U;
    }
    graph_release(graph, old, old_capacity * sizeof(*old));
    return 1;
}

static uint32_t graph_find_node(
    const WMDependencyGraph *graph,
    const int32_t coefficient[WM_MAX_RANK])
{
    size_t mask;
    size_t slot;
    if (graph->node_slot_capacity == 0) return UINT32_MAX;
    mask = graph->node_slot_capacity - 1U;
    slot = (size_t)memo_hash(coefficient, graph->rank) & mask;
    while (graph->node_slot[slot] != 0) {
        uint32_t index = graph->node_slot[slot] - 1U;
        if (memcmp(graph->node[index].coefficient, coefficient,
                   sizeof(int32_t) * graph->rank) == 0)
            return index;
        slot = (slot + 1U) & mask;
    }
    return UINT32_MAX;
}

static int graph_get_or_add_node(
    WMDependencyGraph *graph, WMMemo *memo,
    const int32_t coefficient[WM_MAX_RANK], uint32_t level,
    uint32_t *node_index, int *added, int *memo_hit)
{
    uint32_t found = graph_find_node(graph, coefficient);
    size_t mask;
    size_t slot;
    WMDependencyNode *node;
    WMMemoEntry *cached;
    uint8_t index;
    *added = 0;
    *memo_hit = 0;
    if (found != UINT32_MAX) {
        *node_index = found;
        *memo_hit = graph->node[found].level != 0;
        return 1;
    }
    if (graph->node_count >= UINT32_MAX) return 0;
    if (graph->node_slot_capacity == 0) {
        if (!graph_rehash_nodes(graph, 2048U)) return 0;
    } else if ((graph->node_count + 1U) * 10U >=
               graph->node_slot_capacity * 7U) {
        if (graph->node_slot_capacity > SIZE_MAX / 2U ||
            !graph_rehash_nodes(graph, graph->node_slot_capacity * 2U))
            return 0;
    }
    if (!graph_reserve_nodes(graph, graph->node_count + 1U)) return 0;
    *node_index = (uint32_t)graph->node_count++;
    node = &graph->node[*node_index];
    memset(node, 0, sizeof(*node));
    memcpy(node->coefficient, coefficient, sizeof(node->coefficient));
    node->level = level;
    cached = memo_find(memo, coefficient);
    if (cached != NULL) {
        node->value = cached->value;
        node->value_ready = 1;
        node->edges_ready = 1;
        *memo_hit = 1;
    } else {
        int all_zero = 1;
        for (index = 0; index < graph->rank; ++index)
            if (coefficient[index] != 0) all_zero = 0;
        if (all_zero) {
            node->value.limb[0] = 1;
            node->value_ready = 1;
            node->edges_ready = 1;
        }
    }
    mask = graph->node_slot_capacity - 1U;
    slot = (size_t)memo_hash(coefficient, graph->rank) & mask;
    while (graph->node_slot[slot] != 0) slot = (slot + 1U) & mask;
    graph->node_slot[slot] = *node_index + 1U;
    *added = 1;
    return 1;
}

static int graph_reserve_scratch_entries(WMDependencyGraph *graph,
                                         WMDependencyScratch *scratch,
                                         size_t required,
                                         pthread_mutex_t *allocation_mutex)
{
    size_t capacity = scratch->capacity == 0 ? 256U : scratch->capacity;
    WMDependencyScratchEntry *replacement;
    if (required <= scratch->capacity) return 1;
    while (capacity < required) {
        if (capacity > SIZE_MAX / 2U) return 0;
        capacity *= 2U;
    }
    if (allocation_mutex != NULL) (void)pthread_mutex_lock(allocation_mutex);
    replacement = graph_replace_array(graph, scratch->entry,
                                      scratch->capacity, capacity,
                                      sizeof(*scratch->entry));
    if (allocation_mutex != NULL) (void)pthread_mutex_unlock(allocation_mutex);
    if (replacement == NULL) return 0;
    scratch->entry = replacement;
    scratch->capacity = capacity;
    return 1;
}

static int graph_rehash_scratch(WMDependencyGraph *graph,
                                WMDependencyScratch *scratch,
                                size_t capacity,
                                pthread_mutex_t *allocation_mutex)
{
    WMDependencyScratchSlot *old = scratch->slot;
    size_t old_capacity = scratch->slot_capacity;
    WMDependencyScratchSlot *replacement;
    size_t index;
    if (allocation_mutex != NULL) (void)pthread_mutex_lock(allocation_mutex);
    replacement = graph_allocate(graph, capacity, sizeof(*replacement));
    if (allocation_mutex != NULL) (void)pthread_mutex_unlock(allocation_mutex);
    if (replacement == NULL) return 0;
    scratch->slot = replacement;
    scratch->slot_capacity = capacity;
    scratch->generation = 1;
    for (index = 0; index < scratch->count; ++index) {
        size_t mask = capacity - 1U;
        size_t slot =
            (size_t)memo_hash(scratch->entry[index].coefficient,
                              graph->rank) & mask;
        while (replacement[slot].generation == scratch->generation)
            slot = (slot + 1U) & mask;
        replacement[slot].generation = scratch->generation;
        replacement[slot].entry_plus_one = (uint32_t)index + 1U;
    }
    if (allocation_mutex != NULL) (void)pthread_mutex_lock(allocation_mutex);
    graph_release(graph, old, old_capacity * sizeof(*old));
    if (allocation_mutex != NULL) (void)pthread_mutex_unlock(allocation_mutex);
    return 1;
}

static void graph_reset_scratch(WMDependencyScratch *scratch)
{
    scratch->count = 0;
    ++scratch->generation;
    if (scratch->generation == 0) {
        memset(scratch->slot, 0,
               scratch->slot_capacity * sizeof(*scratch->slot));
        scratch->generation = 1;
    }
}

static int checked_add_i64(int64_t left, int64_t right, int64_t *sum)
{
    if ((right > 0 && left > INT64_MAX - right) ||
        (right < 0 && left < INT64_MIN - right))
        return 0;
    *sum = left + right;
    return 1;
}

static int graph_scratch_add(
    WMDependencyGraph *graph, WMDependencyScratch *scratch,
    const int32_t coefficient[WM_MAX_RANK], int64_t scale,
    int scale_supported, pthread_mutex_t *allocation_mutex)
{
    size_t mask;
    size_t slot;
    if (scratch->slot_capacity == 0) {
        if (!graph_rehash_scratch(graph, scratch, 512U,
                                  allocation_mutex))
            return 0;
    } else if ((scratch->count + 1U) * 10U >=
               scratch->slot_capacity * 7U) {
        if (scratch->slot_capacity > SIZE_MAX / 2U ||
            !graph_rehash_scratch(graph, scratch,
                                  scratch->slot_capacity * 2U,
                                  allocation_mutex))
            return 0;
    }
    mask = scratch->slot_capacity - 1U;
    slot = (size_t)memo_hash(coefficient, graph->rank) & mask;
    while (scratch->slot[slot].generation == scratch->generation) {
        WMDependencyScratchEntry *entry =
            &scratch->entry[scratch->slot[slot].entry_plus_one - 1U];
        if (memcmp(entry->coefficient, coefficient,
                   sizeof(int32_t) * graph->rank) == 0) {
            uint32_t term_count =
                entry->term_count_and_flags & WM_EDGE_TERM_COUNT_MASK;
            int entry_scale_supported =
                (entry->term_count_and_flags & WM_EDGE_SCALE_UNSUPPORTED) == 0;
            if (term_count == WM_EDGE_TERM_COUNT_MASK) return 0;
            entry->term_count_and_flags =
                (entry->term_count_and_flags & WM_EDGE_SCALE_UNSUPPORTED) |
                (term_count + 1U);
            if (!entry_scale_supported || !scale_supported ||
                !checked_add_i64(entry->scale, scale, &entry->scale))
                entry->term_count_and_flags |= WM_EDGE_SCALE_UNSUPPORTED;
            return 1;
        }
        slot = (slot + 1U) & mask;
    }
    if (!graph_reserve_scratch_entries(graph, scratch, scratch->count + 1U,
                                       allocation_mutex))
        return 0;
    scratch->entry[scratch->count].scale = scale;
    memcpy(scratch->entry[scratch->count].coefficient, coefficient,
           sizeof(scratch->entry[scratch->count].coefficient));
    scratch->entry[scratch->count].term_count_and_flags =
        1U | (scale_supported ? 0U : WM_EDGE_SCALE_UNSUPPORTED);
    scratch->slot[slot].generation = scratch->generation;
    scratch->slot[slot].entry_plus_one = (uint32_t)scratch->count + 1U;
    ++scratch->count;
    return 1;
}

static int order_compare(const void *left, const void *right)
{
    uint64_t left_value = *(const uint64_t *)left;
    uint64_t right_value = *(const uint64_t *)right;
    return left_value < right_value ? -1 : left_value > right_value;
}

typedef struct {
    WMRecurrence recurrence;
    WMDependencyGraph *graph;
    atomic_size_t *next;
    atomic_int *failed;
    size_t end;
    WMStatus status;
    char error[256];
} WMPreparedEvaluationWorker;

static WMStatus evaluate_prepared_node(WMRecurrence *recurrence,
                                       WMDependencyGraph *graph,
                                       uint32_t node_index)
{
    WMDependencyNode *node = &graph->node[node_index];
    WMSignedBig numerator = {0};
    uint32_t edge_index;
    node->recurrence_terms = 0;
    memset(&node->value, 0, sizeof(node->value));
    for (edge_index = 0; edge_index < node->edge_count; ++edge_index) {
        const WMDependencyEdge *edge =
            graph_edge_at(graph, node->edge_offset + edge_index);
        const WMDependencyNode *dependency = &graph->node[edge->dependency];
        uint32_t term_count;
        if (!dependency->value_ready || dependency->level >= node->level) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "prepared dependency order is invalid");
            return WM_ARITHMETIC_ERROR;
        }
        if (big_is_zero(&dependency->value)) continue;
        term_count = edge->term_count_and_flags & WM_EDGE_TERM_COUNT_MASK;
        if (UINT64_MAX - node->recurrence_terms < term_count) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "recurrence counter exceeded its exact range");
            return WM_LIMIT_ERROR;
        }
        node->recurrence_terms += term_count;
        if ((edge->term_count_and_flags & WM_EDGE_SCALE_UNSUPPORTED) != 0 ||
            !signed_add_scaled(&numerator, &dependency->value, edge->scale)) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "Freudenthal numerator exceeds the exact integer "
                      "capacity");
            return WM_LIMIT_ERROR;
        }
    }
    if (numerator.sign < 0) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "Freudenthal numerator became negative");
        return WM_ARITHMETIC_ERROR;
    }
    if (numerator.sign > 0) {
        if (node->denominator == 0 ||
            big_divide_u32(&numerator.magnitude, node->denominator) != 0) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "Freudenthal division was not exact");
            return WM_ARITHMETIC_ERROR;
        }
        node->value = numerator.magnitude;
    }
    return WM_OK;
}

static void *evaluate_prepared_worker(void *argument)
{
    WMPreparedEvaluationWorker *worker = argument;
    while (atomic_load_explicit(worker->failed, memory_order_relaxed) == 0) {
        size_t position =
            atomic_fetch_add_explicit(worker->next, 1U, memory_order_relaxed);
        uint32_t node_index;
        if (position >= worker->end) break;
        node_index = (uint32_t)worker->graph->order[position];
        worker->status = evaluate_prepared_node(
            &worker->recurrence, worker->graph, node_index);
        if (worker->status != WM_OK) {
            atomic_store_explicit(worker->failed, 1, memory_order_relaxed);
            break;
        }
    }
    return NULL;
}

static WMStatus evaluate_prepared_group_parallel(
    WMRecurrence *recurrence, WMDependencyGraph *graph, size_t begin,
    size_t end, uint8_t worker_count)
{
    WMPreparedEvaluationWorker worker[WM_MAX_PREPARED_WORKERS];
    pthread_t thread[WM_MAX_PREPARED_WORKERS - 1U];
    atomic_size_t next;
    atomic_int failed;
    size_t created = 0;
    uint8_t index;
    atomic_init(&next, begin);
    atomic_init(&failed, 0);
    memset(worker, 0, sizeof(worker));
    for (index = 0; index < worker_count; ++index) {
        worker[index].recurrence = *recurrence;
        worker[index].recurrence.stats = NULL;
        worker[index].recurrence.error = worker[index].error;
        worker[index].recurrence.error_capacity = sizeof(worker[index].error);
        worker[index].graph = graph;
        worker[index].next = &next;
        worker[index].failed = &failed;
        worker[index].end = end;
        worker[index].status = WM_OK;
    }
    for (index = 1; index < worker_count; ++index) {
        if (pthread_create(&thread[created], NULL, evaluate_prepared_worker,
                           &worker[index]) != 0) {
            atomic_store_explicit(&failed, 1, memory_order_relaxed);
            while (created > 0) (void)pthread_join(thread[--created], NULL);
            set_error(recurrence->error, recurrence->error_capacity,
                      "prepared evaluation worker creation failed");
            return WM_MEMORY_ERROR;
        }
        ++created;
    }
    (void)evaluate_prepared_worker(&worker[0]);
    while (created > 0) (void)pthread_join(thread[--created], NULL);
    for (index = 0; index < worker_count; ++index) {
        if (worker[index].status != WM_OK) {
            set_error(recurrence->error, recurrence->error_capacity, "%s",
                      worker[index].error);
            return worker[index].status;
        }
    }
    return WM_OK;
}

static void graph_destroy(WMDependencyGraph *graph)
{
    graph_release(graph, graph->node,
                  graph->node_capacity * sizeof(*graph->node));
    graph_release(graph, graph->node_slot,
                  graph->node_slot_capacity * sizeof(*graph->node_slot));
    {
        size_t index;
        for (index = 0; index < graph->edge_block_count; ++index)
            graph_release(graph, graph->edge_block[index],
                          WM_EDGE_BLOCK_SIZE *
                              sizeof(*graph->edge_block[index]));
    }
    graph_release(graph, graph->edge_block,
                  graph->edge_block_capacity * sizeof(*graph->edge_block));
    graph_release(graph, graph->order,
                  graph->order_capacity * sizeof(*graph->order));
    memset(graph, 0, sizeof(*graph));
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

static WMStatus canonicalize_recursive_coefficient_direct_from_weight(
    WMRecurrence *recurrence, const int32_t input[WM_MAX_RANK],
    const int32_t input_weight[WM_MAX_RANK],
    int32_t output[WM_MAX_RANK], int *inside_highest_weight_cone)
{
    const WMOracle *oracle = recurrence->oracle;
    int32_t weight[WM_MAX_RANK] = {0};
    unsigned iteration;
    uint8_t row;
    *inside_highest_weight_cone = 0;
    memcpy(output, input, sizeof(int32_t) * WM_MAX_RANK);
    memcpy(weight, input_weight, sizeof(weight));
    /*
     * The state coefficient c represents weight = highest - A*c.  If a
     * reflection at simple root i uses the negative Dynkin pairing p, then
     * the reflected weight is weight - p*A[:,i].  Its coefficient is
     * therefore c + p*e_i.  Carrying c through the reflection avoids solving
     * A*c = highest - dominant after every recursive memo lookup.
     */
    for (iteration = 0; iteration < 4096; ++iteration) {
        int reflection = -1;
        for (row = 0; row < oracle->cartan.rank; ++row) {
            if (weight[row] < 0) {
                reflection = row;
                break;
            }
        }
        if (reflection < 0) {
            for (row = 0; row < oracle->cartan.rank; ++row)
                if (output[row] < 0) return WM_OK;
            *inside_highest_weight_cone = 1;
            return WM_OK;
        }
        {
            int64_t pairing = weight[reflection];
            int64_t reflected_coefficient =
                (int64_t)output[reflection] + pairing;
            if (reflected_coefficient < INT32_MIN ||
                reflected_coefficient > INT32_MAX) {
                set_error(recurrence->error, recurrence->error_capacity,
                          "dominant recursive coefficient exceeds the exact "
                          "integer range");
                return WM_LIMIT_ERROR;
            }
            output[reflection] = (int32_t)reflected_coefficient;
            for (row = 0; row < oracle->cartan.rank; ++row) {
                int64_t reflected =
                    (int64_t)weight[row] -
                    pairing * WM_CELL(&oracle->cartan, row, reflection);
                if (reflected < INT32_MIN || reflected > INT32_MAX) {
                    set_error(
                        recurrence->error, recurrence->error_capacity,
                        "recursive Weyl reduction exceeded the exact integer "
                        "range");
                    return WM_LIMIT_ERROR;
                }
                weight[row] = (int32_t)reflected;
            }
        }
    }
    set_error(recurrence->error, recurrence->error_capacity,
              "recursive Weyl reduction exceeded the iteration limit");
    return WM_LIMIT_ERROR;
}

static WMStatus canonicalize_recursive_coefficient_direct(
    WMRecurrence *recurrence, const int32_t input[WM_MAX_RANK],
    int32_t output[WM_MAX_RANK], int *inside_highest_weight_cone)
{
    const WMOracle *oracle = recurrence->oracle;
    int32_t weight[WM_MAX_RANK] = {0};
    uint8_t row;
    for (row = 0; row < oracle->cartan.rank; ++row) {
        int64_t value = recurrence->highest_weight[row];
        uint8_t column;
        for (column = 0; column < oracle->cartan.rank; ++column)
            value -= (int64_t)WM_CELL(&oracle->cartan, row, column) *
                     input[column];
        if (value < INT32_MIN || value > INT32_MAX) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "recursive weight exceeds the exact integer range");
            return WM_LIMIT_ERROR;
        }
        weight[row] = (int32_t)value;
    }
    return canonicalize_recursive_coefficient_direct_from_weight(
        recurrence, input, weight, output, inside_highest_weight_cone);
}

#if defined(WM_CANONICALIZATION_CROSSCHECK)
static WMStatus canonicalize_recursive_coefficient_reference(
    WMRecurrence *recurrence, const int32_t input[WM_MAX_RANK],
    int32_t output[WM_MAX_RANK], int *inside_highest_weight_cone)
{
    const WMOracle *oracle = recurrence->oracle;
    int32_t weight[WM_MAX_RANK] = {0};
    int32_t dominant[WM_MAX_RANK] = {0};
    int32_t delta[WM_MAX_RANK] = {0};
    uint8_t row;
    *inside_highest_weight_cone = 0;
    for (row = 0; row < oracle->cartan.rank; ++row) {
        int64_t value = recurrence->highest_weight[row];
        uint8_t column;
        for (column = 0; column < oracle->cartan.rank; ++column)
            value -= (int64_t)WM_CELL(&oracle->cartan, row, column) *
                     input[column];
        if (value < INT32_MIN || value > INT32_MAX) return WM_LIMIT_ERROR;
        weight[row] = (int32_t)value;
    }
    if (!make_dominant(&oracle->cartan, weight, dominant))
        return WM_LIMIT_ERROR;
    for (row = 0; row < oracle->cartan.rank; ++row) {
        int64_t difference =
            (int64_t)recurrence->highest_weight[row] - dominant[row];
        if (difference < INT32_MIN || difference > INT32_MAX)
            return WM_LIMIT_ERROR;
        delta[row] = (int32_t)difference;
    }
    if (!solve_simple_coefficients(&oracle->cartan, delta, output))
        return WM_OK;
    *inside_highest_weight_cone = 1;
    return WM_OK;
}
#endif

static WMStatus canonicalize_recursive_coefficient(
    WMRecurrence *recurrence, const int32_t input[WM_MAX_RANK],
    int32_t output[WM_MAX_RANK], int *inside_highest_weight_cone)
{
    WMStatus status = canonicalize_recursive_coefficient_direct(
        recurrence, input, output, inside_highest_weight_cone);
#if defined(WM_CANONICALIZATION_CROSSCHECK)
    int32_t reference[WM_MAX_RANK] = {0};
    int reference_inside = 0;
    WMStatus reference_status = canonicalize_recursive_coefficient_reference(
        recurrence, input, reference, &reference_inside);
    if (status != reference_status ||
        *inside_highest_weight_cone != reference_inside ||
        (status == WM_OK && reference_inside &&
         memcmp(output, reference,
                sizeof(int32_t) * recurrence->oracle->cartan.rank) != 0)) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "direct recursive Weyl reduction disagreed with the exact "
                  "reference solver");
        return WM_ARITHMETIC_ERROR;
    }
#endif
    return status;
}

static WMStatus canonicalize_recursive_coefficient_from_weight(
    WMRecurrence *recurrence, const int32_t input[WM_MAX_RANK],
    const int32_t input_weight[WM_MAX_RANK],
    int32_t output[WM_MAX_RANK], int *inside_highest_weight_cone)
{
    WMStatus status = canonicalize_recursive_coefficient_direct_from_weight(
        recurrence, input, input_weight, output, inside_highest_weight_cone);
#if defined(WM_CANONICALIZATION_CROSSCHECK)
    int32_t reference[WM_MAX_RANK] = {0};
    int reference_inside = 0;
    WMStatus reference_status = canonicalize_recursive_coefficient_reference(
        recurrence, input, reference, &reference_inside);
    if (status != reference_status ||
        *inside_highest_weight_cone != reference_inside ||
        (status == WM_OK && reference_inside &&
         memcmp(output, reference,
                sizeof(int32_t) * recurrence->oracle->cartan.rank) != 0)) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "prepared recursive Weyl reduction disagreed with the "
                  "exact reference solver");
        return WM_ARITHMETIC_ERROR;
    }
#endif
    return status;
}

static WMStatus multiplicity_for_coefficient(
    WMRecurrence *recurrence, const int32_t coefficient[WM_MAX_RANK],
    WMBigUInt *multiplicity)
{
    const WMOracle *oracle = recurrence->oracle;
    WMMemoEntry *cached;
    int32_t canonical[WM_MAX_RANK] = {0};
    const int32_t *state = coefficient;
    int inside_highest_weight_cone;
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
    if (recurrence->stats != NULL) {
        uint32_t level = coefficient_level(coefficient, oracle->cartan.rank);
        if (level > recurrence->stats->maximum_level)
            recurrence->stats->maximum_level = level;
    }
    {
        WMStatus status = canonicalize_recursive_coefficient(
            recurrence, coefficient, canonical, &inside_highest_weight_cone);
        if (status != WM_OK) return status;
    }
    if (!inside_highest_weight_cone) return WM_OK;
    if (memcmp(coefficient, canonical,
               sizeof(int32_t) * oracle->cartan.rank) != 0) {
        state = canonical;
        if (recurrence->stats != NULL)
            ++recurrence->stats->recursive_weyl_folds;
    }
    all_zero = 1;
    for (index = 0; index < oracle->cartan.rank; ++index)
        if (state[index] != 0) all_zero = 0;
    if (all_zero) {
        multiplicity->limb[0] = 1;
        return WM_OK;
    }
    cached = memo_find(recurrence->memo, state);
    if (cached != NULL) {
        if (recurrence->stats != NULL) ++recurrence->stats->memo_hits;
        *multiplicity = cached->value;
        return WM_OK;
    }
    for (index = 0; index < oracle->cartan.rank; ++index) {
        uint8_t simple;
        target[index] = recurrence->highest_weight[index];
        for (simple = 0; simple < oracle->cartan.rank; ++simple)
            target[index] -= (int64_t)WM_CELL(&oracle->cartan, index, simple) *
                             state[simple];
    }
    for (index = 0; index < oracle->cartan.rank; ++index) {
        int64_t sum = recurrence->highest_weight[index] + target[index] + 2;
        denominator += (int64_t)state[index] *
                       oracle->symmetrizer[index] * sum;
    }
    if (denominator <= 0) {
        if (!memo_insert(recurrence->memo, state, multiplicity)) {
            set_error(recurrence->error, recurrence->error_capacity,
                      recurrence->memo->limit_reached
                          ? "weight multiplicity memo byte limit reached"
                          : "weight multiplicity memo allocation failed");
            return recurrence->memo->limit_reached ? WM_LIMIT_ERROR
                                                   : WM_MEMORY_ERROR;
        }
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
        memcpy(raised, state, sizeof(raised));
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
    if (!memo_insert(recurrence->memo, state, multiplicity)) {
        set_error(recurrence->error, recurrence->error_capacity,
                  recurrence->memo->limit_reached
                      ? "weight multiplicity memo byte limit reached"
                      : "weight multiplicity memo allocation failed");
        return recurrence->memo->limit_reached ? WM_LIMIT_ERROR
                                               : WM_MEMORY_ERROR;
    }
    return WM_OK;
}

static WMStatus graph_allocation_error(WMRecurrence *recurrence)
{
    set_error(recurrence->error, recurrence->error_capacity,
              recurrence->memo->budget->limit_reached
                  ? "weight multiplicity working-set byte limit reached"
                  : "weight multiplicity dependency graph allocation failed");
    return recurrence->memo->budget->limit_reached ? WM_LIMIT_ERROR
                                                   : WM_MEMORY_ERROR;
}

static WMStatus enumerate_dependency_node(
    WMRecurrence *recurrence, WMDependencyGraph *graph,
    const int32_t state[WM_MAX_RANK], WMDependencyScratch *scratch,
    pthread_mutex_t *allocation_mutex, uint32_t *denominator_out)
{
    const WMOracle *oracle = recurrence->oracle;
    int32_t target[WM_MAX_RANK] = {0};
    int64_t denominator = 0;
    uint8_t index;
    uint16_t root_index;
    graph_reset_scratch(scratch);
    *denominator_out = 0;
    for (index = 0; index < oracle->cartan.rank; ++index) {
        uint8_t simple;
        int64_t target_value = recurrence->highest_weight[index];
        for (simple = 0; simple < oracle->cartan.rank; ++simple)
            target_value -=
                (int64_t)WM_CELL(&oracle->cartan, index, simple) *
                state[simple];
        if (target_value < INT32_MIN || target_value > INT32_MAX) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "prepared weight exceeds the exact integer range");
            return WM_LIMIT_ERROR;
        }
        target[index] = (int32_t)target_value;
    }
    for (index = 0; index < oracle->cartan.rank; ++index) {
        int64_t sum = recurrence->highest_weight[index] + target[index] + 2;
        denominator += (int64_t)state[index] * oracle->symmetrizer[index] *
                       sum;
    }
    if (denominator <= 0) return WM_OK;
    if (denominator > UINT32_MAX) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "Freudenthal denominator is outside the supported range");
        return WM_LIMIT_ERROR;
    }
    *denominator_out = (uint32_t)denominator;
    for (root_index = 0; root_index < oracle->positive_roots.count;
         ++root_index) {
        const int16_t *root = oracle->positive_roots.coefficient[root_index];
        int32_t raised[WM_MAX_RANK];
        int32_t raised_weight[WM_MAX_RANK];
        int64_t base_inner = 0;
        int64_t root_norm = oracle->positive_root_norm[root_index];
        uint32_t multiple = 0;
        memcpy(raised, state, sizeof(raised));
        memcpy(raised_weight, target, sizeof(raised_weight));
        for (index = 0; index < oracle->cartan.rank; ++index)
            base_inner += (int64_t)root[index] *
                          oracle->symmetrizer[index] * target[index];
        for (;;) {
            int32_t canonical[WM_MAX_RANK] = {0};
            int inside_highest_weight_cone;
#if !defined(WM_CANONICALIZATION_CROSSCHECK)
            int already_dominant = 1;
#endif
            int valid = 1;
            int64_t inner = 0;
            int64_t scale = 0;
            int scale_supported = 1;
            WMStatus status;
            ++multiple;
            for (index = 0; index < oracle->cartan.rank; ++index) {
                int64_t next_weight =
                    (int64_t)raised_weight[index] +
                    oracle->positive_root_dynkin[root_index][index];
                raised[index] -= root[index];
                if (raised[index] < 0) valid = 0;
                if (next_weight < INT32_MIN || next_weight > INT32_MAX) {
                    set_error(recurrence->error, recurrence->error_capacity,
                              "raised prepared weight exceeds the exact "
                              "integer range");
                    return WM_LIMIT_ERROR;
                }
                raised_weight[index] = (int32_t)next_weight;
#if !defined(WM_CANONICALIZATION_CROSSCHECK)
                if (raised_weight[index] < 0) already_dominant = 0;
#endif
            }
            if (!valid) break;
            if (recurrence->stats != NULL) {
                uint32_t level =
                    coefficient_level(raised, oracle->cartan.rank);
                ++recurrence->stats->prepared_raw_transitions;
                if (level > recurrence->stats->maximum_level)
                    recurrence->stats->maximum_level = level;
            }
#if defined(WM_CANONICALIZATION_CROSSCHECK)
            status = canonicalize_recursive_coefficient_from_weight(
                recurrence, raised, raised_weight, canonical,
                &inside_highest_weight_cone);
#else
            if (already_dominant) {
                memcpy(canonical, raised, sizeof(canonical));
                inside_highest_weight_cone = 1;
                status = WM_OK;
            } else {
                status = canonicalize_recursive_coefficient_from_weight(
                    recurrence, raised, raised_weight, canonical,
                    &inside_highest_weight_cone);
            }
#endif
            if (status != WM_OK) return status;
            if (!inside_highest_weight_cone) continue;
            if (memcmp(raised, canonical,
                       sizeof(int32_t) * oracle->cartan.rank) != 0 &&
                recurrence->stats != NULL)
                ++recurrence->stats->recursive_weyl_folds;
            if ((root_norm > 0 &&
                 multiple > (uint64_t)(INT64_MAX - base_inner) /
                                (uint64_t)root_norm) ||
                (root_norm < 0 &&
                 multiple > (uint64_t)(base_inner - INT64_MIN) /
                                (uint64_t)(-root_norm))) {
                scale_supported = 0;
            } else {
                inner = base_inner + (int64_t)multiple * root_norm;
            }
            if (inner > INT64_MAX / 2 || inner < INT64_MIN / 2) {
                scale_supported = 0;
            } else {
                scale = 2 * inner;
            }
            if (!graph_scratch_add(graph, scratch, canonical, scale,
                                   scale_supported, allocation_mutex))
                return graph_allocation_error(recurrence);
        }
    }
    return WM_OK;
}

static WMStatus merge_dependency_node(WMRecurrence *recurrence,
                                      WMDependencyGraph *graph,
                                      uint32_t node_index,
                                      WMDependencyScratch *scratch,
                                      uint32_t denominator)
{
    const WMOracle *oracle = recurrence->oracle;
    uint32_t parent_level = graph->node[node_index].level;
    if (scratch->count > UINT32_MAX ||
        graph->edge_count > UINT64_MAX - scratch->count ||
        !graph_reserve_edges(graph,
                             graph->edge_count + scratch->count))
        return graph_allocation_error(recurrence);
    graph->node[node_index].denominator = denominator;
    graph->node[node_index].edge_offset = graph->edge_count;
    graph->node[node_index].edge_count = (uint32_t)scratch->count;
    {
        size_t scratch_index;
        for (scratch_index = 0; scratch_index < scratch->count;
             ++scratch_index) {
            const WMDependencyScratchEntry *scratch_entry =
                &scratch->entry[scratch_index];
            WMDependencyEdge *edge =
                graph_edge_at(graph, graph->edge_count++);
            uint32_t dependency_level = coefficient_level(
                scratch_entry->coefficient, oracle->cartan.rank);
            uint32_t term_count =
                scratch_entry->term_count_and_flags & WM_EDGE_TERM_COUNT_MASK;
            int added;
            int memo_hit;
            if (dependency_level >= parent_level) {
                set_error(recurrence->error, recurrence->error_capacity,
                          "prepared dependency is not above its parent weight");
                return WM_ARITHMETIC_ERROR;
            }
            if (!graph_get_or_add_node(
                    graph, recurrence->memo, scratch_entry->coefficient,
                    dependency_level, &edge->dependency, &added, &memo_hit))
                return graph_allocation_error(recurrence);
            edge->scale = scratch_entry->scale;
            edge->term_count_and_flags =
                scratch_entry->term_count_and_flags;
            if (recurrence->stats != NULL && dependency_level != 0) {
                uint64_t hits = memo_hit ? term_count : term_count - 1U;
                if (UINT64_MAX - recurrence->stats->memo_hits < hits) {
                    set_error(recurrence->error, recurrence->error_capacity,
                              "memo hit counter exceeded its exact range");
                    return WM_LIMIT_ERROR;
                }
                recurrence->stats->memo_hits += hits;
            }
        }
    }
    graph->node[node_index].edges_ready = 1;
    return WM_OK;
}

typedef struct {
    WMRecurrence recurrence;
    WMQueryStats stats;
    WMDependencyScratch scratch;
    WMDependencyGraph *graph;
    pthread_mutex_t *graph_mutex;
    atomic_size_t *next;
    atomic_int *failed;
    size_t end;
    WMStatus status;
    char error[256];
} WMPreparedDiscoveryWorker;

static void *discover_prepared_worker(void *argument)
{
    WMPreparedDiscoveryWorker *worker = argument;
    while (atomic_load_explicit(worker->failed, memory_order_relaxed) == 0) {
        int32_t state[WM_MAX_RANK];
        size_t position =
            atomic_fetch_add_explicit(worker->next, 1U, memory_order_relaxed);
        uint32_t denominator;
        uint32_t node_index;
        if (position >= worker->end) break;
        node_index = (uint32_t)position;
        (void)pthread_mutex_lock(worker->graph_mutex);
        if (worker->graph->node[node_index].edges_ready) {
            (void)pthread_mutex_unlock(worker->graph_mutex);
            continue;
        }
        memcpy(state, worker->graph->node[node_index].coefficient,
               sizeof(state));
        (void)pthread_mutex_unlock(worker->graph_mutex);
        worker->status = enumerate_dependency_node(
            &worker->recurrence, worker->graph, state, &worker->scratch,
            worker->graph_mutex, &denominator);
        if (worker->status != WM_OK) {
            atomic_store_explicit(worker->failed, 1, memory_order_relaxed);
            break;
        }
        (void)pthread_mutex_lock(worker->graph_mutex);
        worker->status = merge_dependency_node(
            &worker->recurrence, worker->graph, node_index,
            &worker->scratch, denominator);
        (void)pthread_mutex_unlock(worker->graph_mutex);
        if (worker->status != WM_OK) {
            atomic_store_explicit(worker->failed, 1, memory_order_relaxed);
            break;
        }
    }
    return NULL;
}

static int add_u64_counter(uint64_t *total, uint64_t value)
{
    if (UINT64_MAX - *total < value) return 0;
    *total += value;
    return 1;
}

static WMStatus merge_discovery_stats(WMRecurrence *recurrence,
                                      const WMQueryStats *source)
{
    WMQueryStats *target = recurrence->stats;
    if (target == NULL) return WM_OK;
    if (!add_u64_counter(&target->memo_hits, source->memo_hits) ||
        !add_u64_counter(&target->recursive_weyl_folds,
                         source->recursive_weyl_folds) ||
        !add_u64_counter(&target->prepared_raw_transitions,
                         source->prepared_raw_transitions)) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "prepared discovery counter exceeded its exact range");
        return WM_LIMIT_ERROR;
    }
    if (source->maximum_level > target->maximum_level)
        target->maximum_level = source->maximum_level;
    return WM_OK;
}

static void release_discovery_scratch(WMDependencyGraph *graph,
                                      WMDependencyScratch *scratch)
{
    graph_release(graph, scratch->entry,
                  scratch->capacity * sizeof(*scratch->entry));
    graph_release(graph, scratch->slot,
                  scratch->slot_capacity * sizeof(*scratch->slot));
    memset(scratch, 0, sizeof(*scratch));
}

static WMStatus discover_prepared_nodes(WMRecurrence *recurrence,
                                        WMDependencyGraph *graph)
{
    WMPreparedDiscoveryWorker worker[WM_MAX_PREPARED_WORKERS];
    pthread_t thread[WM_MAX_PREPARED_WORKERS - 1U];
    pthread_mutex_t graph_mutex;
    size_t begin = 0;
    WMStatus result = WM_OK;
    uint8_t configured_workers = graph->worker_count;
    uint8_t index;
    memset(worker, 0, sizeof(worker));
    if (pthread_mutex_init(&graph_mutex, NULL) != 0) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "prepared discovery lock creation failed");
        return WM_MEMORY_ERROR;
    }
    while (begin < graph->node_count) {
        atomic_size_t next;
        atomic_int failed;
        size_t end;
        size_t created = 0;
        uint8_t workers = configured_workers;
        while (begin < graph->node_count && graph->node[begin].edges_ready)
            ++begin;
        if (begin == graph->node_count) break;
        end = graph->node_count;
        if ((size_t)workers > end - begin) workers = (uint8_t)(end - begin);
        atomic_init(&next, begin);
        atomic_init(&failed, 0);
        for (index = 0; index < workers; ++index) {
            memset(&worker[index].stats, 0, sizeof(worker[index].stats));
            memset(worker[index].error, 0, sizeof(worker[index].error));
            worker[index].recurrence = *recurrence;
            worker[index].recurrence.stats = &worker[index].stats;
            worker[index].recurrence.error = worker[index].error;
            worker[index].recurrence.error_capacity =
                sizeof(worker[index].error);
            worker[index].graph = graph;
            worker[index].graph_mutex = &graph_mutex;
            worker[index].next = &next;
            worker[index].failed = &failed;
            worker[index].end = end;
            worker[index].status = WM_OK;
        }
        for (index = 1; index < workers; ++index) {
            if (pthread_create(&thread[created], NULL,
                               discover_prepared_worker,
                               &worker[index]) != 0) {
                atomic_store_explicit(&failed, 1, memory_order_relaxed);
                while (created > 0)
                    (void)pthread_join(thread[--created], NULL);
                set_error(recurrence->error, recurrence->error_capacity,
                          "prepared discovery worker creation failed");
                result = WM_MEMORY_ERROR;
                goto finished;
            }
            ++created;
        }
        (void)discover_prepared_worker(&worker[0]);
        while (created > 0) (void)pthread_join(thread[--created], NULL);
        for (index = 0; index < workers; ++index) {
            WMStatus stats_status =
                merge_discovery_stats(recurrence, &worker[index].stats);
            if (result == WM_OK && stats_status != WM_OK)
                result = stats_status;
            if (result == WM_OK && worker[index].status != WM_OK) {
                set_error(recurrence->error, recurrence->error_capacity,
                          "%s", worker[index].error);
                result = worker[index].status;
            }
        }
        if (result != WM_OK) goto finished;
        if (recurrence->stats != NULL) {
            ++recurrence->stats->prepared_discovery_rounds;
            recurrence->stats->prepared_discovery_nodes += end - begin;
        }
        begin = end;
    }
finished:
    for (index = 0; index < configured_workers; ++index)
        release_discovery_scratch(graph, &worker[index].scratch);
    (void)pthread_mutex_destroy(&graph_mutex);
    return result;
}

static WMStatus evaluate_prepared_nodes(WMRecurrence *recurrence,
                                        WMDependencyGraph *graph)
{
    size_t order_count = 0;
    size_t index;
    if (!graph_reserve_order(graph, graph->node_count))
        return graph_allocation_error(recurrence);
    for (index = 0; index < graph->node_count; ++index) {
        if (graph->node[index].value_ready) continue;
        if (!graph->node[index].edges_ready) {
            set_error(recurrence->error, recurrence->error_capacity,
                      "prepared dependency graph contains an unfinished node");
            return WM_ARITHMETIC_ERROR;
        }
        graph->order[order_count++] =
            ((uint64_t)graph->node[index].level << 32) | (uint32_t)index;
    }
    qsort(graph->order, order_count, sizeof(*graph->order), order_compare);
    index = 0;
    while (index < order_count) {
        size_t end = index + 1U;
        uint32_t level = (uint32_t)(graph->order[index] >> 32);
        uint64_t group_edges = graph->node[(uint32_t)graph->order[index]].edge_count;
        WMStatus status;
        uint8_t workers;
        while (end < order_count &&
               (uint32_t)(graph->order[end] >> 32) == level) {
            group_edges += graph->node[(uint32_t)graph->order[end]].edge_count;
            ++end;
        }
        workers = graph->worker_count;
        if ((size_t)workers > end - index) workers = (uint8_t)(end - index);
        if (workers > 1U &&
            group_edges >= WM_PREPARED_PARALLEL_EDGE_THRESHOLD) {
            status = evaluate_prepared_group_parallel(
                recurrence, graph, index, end, workers);
            if (status != WM_OK) return status;
            if (recurrence->stats != NULL) {
                ++recurrence->stats->prepared_parallel_groups;
                recurrence->stats->prepared_parallel_nodes += end - index;
                if (recurrence->stats->prepared_worker_count < workers)
                    recurrence->stats->prepared_worker_count = workers;
            }
        } else {
            size_t position;
            for (position = index; position < end; ++position) {
                status = evaluate_prepared_node(
                    recurrence, graph, (uint32_t)graph->order[position]);
                if (status != WM_OK) return status;
            }
        }
        while (index < end) {
            WMDependencyNode *node =
                &graph->node[(uint32_t)graph->order[index++]];
            if (recurrence->stats != NULL) {
                if (UINT64_MAX - recurrence->stats->recurrence_terms <
                    node->recurrence_terms) {
                    set_error(recurrence->error, recurrence->error_capacity,
                              "recurrence counter exceeded its exact range");
                    return WM_LIMIT_ERROR;
                }
                recurrence->stats->recurrence_terms += node->recurrence_terms;
            }
            if (!memo_insert(recurrence->memo, node->coefficient,
                             &node->value)) {
                set_error(
                    recurrence->error, recurrence->error_capacity,
                    recurrence->memo->limit_reached
                        ? "weight multiplicity working-set byte limit reached"
                        : "weight multiplicity memo allocation failed");
                return recurrence->memo->limit_reached ? WM_LIMIT_ERROR
                                                       : WM_MEMORY_ERROR;
            }
            node->value_ready = 1;
        }
    }
    return WM_OK;
}

static WMStatus multiplicity_for_coefficient_prepared(
    WMRecurrence *recurrence, WMDependencyGraph *graph,
    const int32_t coefficient[WM_MAX_RANK], WMBigUInt *multiplicity)
{
    int32_t canonical[WM_MAX_RANK] = {0};
    const int32_t *state = coefficient;
    int inside_highest_weight_cone;
    uint32_t target_node;
    uint32_t target_level;
    uint64_t started;
    int added;
    int memo_hit;
    uint8_t index;
    WMStatus status;
    memset(multiplicity, 0, sizeof(*multiplicity));
    target_level = coefficient_level(coefficient, graph->rank);
    if (recurrence->stats != NULL &&
        target_level > recurrence->stats->maximum_level)
        recurrence->stats->maximum_level = target_level;
    status = canonicalize_recursive_coefficient(
        recurrence, coefficient, canonical, &inside_highest_weight_cone);
    if (status != WM_OK) return status;
    if (!inside_highest_weight_cone) return WM_OK;
    if (memcmp(coefficient, canonical, sizeof(int32_t) * graph->rank) != 0) {
        state = canonical;
        target_level = coefficient_level(canonical, graph->rank);
        if (recurrence->stats != NULL)
            ++recurrence->stats->recursive_weyl_folds;
    }
    for (index = 0; index < graph->rank; ++index) {
        if (state[index] != 0) break;
    }
    if (index == graph->rank) {
        multiplicity->limb[0] = 1;
        return WM_OK;
    }
    if (!graph_get_or_add_node(graph, recurrence->memo, state, target_level,
                               &target_node, &added, &memo_hit))
        return graph_allocation_error(recurrence);
    if (memo_hit && recurrence->stats != NULL)
        ++recurrence->stats->memo_hits;
    if (graph->node[target_node].value_ready) {
        *multiplicity = graph->node[target_node].value;
        return WM_OK;
    }
    started = wall_time_nanoseconds();
    status = discover_prepared_nodes(recurrence, graph);
    if (status != WM_OK) return status;
    if (recurrence->stats != NULL && started != 0)
        recurrence->stats->prepared_discovery_nanoseconds +=
            wall_time_nanoseconds() - started;
    started = wall_time_nanoseconds();
    status = evaluate_prepared_nodes(recurrence, graph);
    if (status != WM_OK) return status;
    if (recurrence->stats != NULL && started != 0)
        recurrence->stats->prepared_evaluation_nanoseconds +=
            wall_time_nanoseconds() - started;
    if (!graph->node[target_node].value_ready) {
        set_error(recurrence->error, recurrence->error_capacity,
                  "prepared target was not evaluated");
        return WM_ARITHMETIC_ERROR;
    }
    *multiplicity = graph->node[target_node].value;
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
    {
        uint16_t root;
        for (root = 0; root < oracle->positive_roots.count; ++root) {
            uint8_t row;
            int64_t norm = 0;
            for (row = 0; row < cartan->rank; ++row) {
                uint8_t column;
                int64_t dynkin = 0;
                for (column = 0; column < cartan->rank; ++column)
                    dynkin +=
                        (int64_t)WM_CELL(cartan, row, column) *
                        oracle->positive_roots.coefficient[root][column];
                if (dynkin < INT32_MIN || dynkin > INT32_MAX) {
                    set_error(error, error_capacity,
                              "positive-root Dynkin coordinate exceeded the "
                              "exact integer range");
                    return WM_LIMIT_ERROR;
                }
                oracle->positive_root_dynkin[root][row] = (int32_t)dynkin;
                norm +=
                    (int64_t)oracle->positive_roots.coefficient[root][row] *
                    oracle->symmetrizer[row] * dynkin;
            }
            oracle->positive_root_norm[root] = norm;
        }
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

WMStatus wm_representation_session_create(
    const WMOracle *oracle,
    const int32_t highest_weight[WM_MAX_RANK],
    size_t maximum_memo_bytes,
    WMRepresentationSession **session,
    char *error,
    size_t error_capacity)
{
    return wm_representation_session_create_with_capacity(
        oracle, highest_weight, maximum_memo_bytes, 1024U, session, error,
        error_capacity);
}

WMStatus wm_representation_session_create_with_capacity(
    const WMOracle *oracle,
    const int32_t highest_weight[WM_MAX_RANK],
    size_t maximum_memo_bytes,
    size_t initial_memo_capacity,
    WMRepresentationSession **session,
    char *error,
    size_t error_capacity)
{
    WMRepresentationSession *created;
    size_t maximum_bytes;
    uint8_t index;
    if (oracle == NULL || highest_weight == NULL || session == NULL)
        return WM_INVALID_ARGUMENT;
    *session = NULL;
    for (index = 0; index < oracle->cartan.rank; ++index) {
        if (highest_weight[index] < 0) {
            set_error(error, error_capacity,
                      "highest weight must have non-negative Dynkin labels");
            return WM_NOT_DOMINANT;
        }
    }
    maximum_bytes = maximum_memo_bytes == 0 ? SIZE_MAX : maximum_memo_bytes;
    if (initial_memo_capacity < 2U ||
        (initial_memo_capacity & (initial_memo_capacity - 1U)) != 0U) {
        set_error(error, error_capacity,
                  "representation memo initial capacity must be a power of two");
        return WM_INVALID_ARGUMENT;
    }
    if (maximum_bytes / sizeof(WMMemoEntry) < initial_memo_capacity) {
        set_error(error, error_capacity,
                  "representation memo byte limit is below initial capacity");
        return WM_LIMIT_ERROR;
    }
    created = calloc(1, sizeof(*created));
    if (created == NULL) return WM_MEMORY_ERROR;
    created->budget.maximum_bytes = maximum_bytes;
    created->memo.budget = &created->budget;
    created->memo.entry = budget_calloc(
        &created->budget, initial_memo_capacity, sizeof(*created->memo.entry));
    if (created->memo.entry == NULL) {
        int limit_reached = created->budget.limit_reached;
        free(created);
        return limit_reached ? WM_LIMIT_ERROR : WM_MEMORY_ERROR;
    }
    created->oracle = oracle;
    memcpy(created->highest_weight, highest_weight,
           sizeof(created->highest_weight));
    created->memo.capacity = initial_memo_capacity;
    created->memo.allocated_bytes =
        initial_memo_capacity * sizeof(*created->memo.entry);
    created->memo.peak_allocated_bytes =
        initial_memo_capacity * sizeof(*created->memo.entry);
    created->memo.rank = oracle->cartan.rank;
    created->graph.budget = &created->budget;
    created->graph.rank = oracle->cartan.rank;
    created->graph.worker_count = configured_prepared_worker_count();
    *session = created;
    return WM_OK;
}

uint64_t wm_representation_memo_entry_bytes(void)
{
    return (uint64_t)sizeof(WMMemoEntry);
}

static WMStatus wm_representation_session_multiplicity_engine(
    WMRepresentationSession *session,
    const int32_t target_weight[WM_MAX_RANK],
    WMBigUInt *multiplicity,
    WMQueryStats *stats,
    char *error,
    size_t error_capacity,
    int prepared)
{
    int32_t delta[WM_MAX_RANK] = {0};
    int32_t coefficient[WM_MAX_RANK] = {0};
    int32_t dominant_target[WM_MAX_RANK] = {0};
    WMRecurrence recurrence;
    WMStatus status = WM_OK;
    size_t entries_before;
    size_t graph_nodes_before;
    size_t graph_edges_before;
    uint8_t index;
    if (session == NULL || target_weight == NULL || multiplicity == NULL)
        return WM_INVALID_ARGUMENT;
    entries_before = session->memo.count;
    graph_nodes_before = session->graph.node_count;
    graph_edges_before = session->graph.edge_count;
    memset(multiplicity, 0, sizeof(*multiplicity));
    if (stats != NULL) memset(stats, 0, sizeof(*stats));
    session->memo.limit_reached = 0;
    session->budget.limit_reached = 0;
    if (!make_dominant(&session->oracle->cartan, target_weight,
                       dominant_target)) {
        set_error(error, error_capacity,
                  "target Weyl reduction exceeded the exact integer range");
        status = WM_LIMIT_ERROR;
        goto finished;
    }
    for (index = 0; index < session->oracle->cartan.rank; ++index)
        delta[index] = session->highest_weight[index] - dominant_target[index];
    if (!solve_simple_coefficients(&session->oracle->cartan, delta,
                                   coefficient))
        goto finished;
    memset(&recurrence, 0, sizeof(recurrence));
    recurrence.oracle = session->oracle;
    recurrence.highest_weight = session->highest_weight;
    recurrence.memo = &session->memo;
    recurrence.stats = stats;
    recurrence.error = error;
    recurrence.error_capacity = error_capacity;
    status = prepared
                 ? multiplicity_for_coefficient_prepared(
                       &recurrence, &session->graph, coefficient, multiplicity)
                 : multiplicity_for_coefficient(&recurrence, coefficient,
                                                multiplicity);
finished:
    if (stats != NULL) {
        stats->memo_entries_before = entries_before;
        stats->memo_entries = session->memo.count;
        stats->memo_entries_added = session->memo.count - entries_before;
        stats->memo_capacity_bytes =
            (uint64_t)session->memo.capacity * sizeof(*session->memo.entry);
        stats->memo_peak_allocated_bytes =
            (uint64_t)session->memo.peak_allocated_bytes;
        stats->working_set_capacity_bytes =
            (uint64_t)session->budget.allocated_bytes;
        stats->working_set_peak_allocated_bytes =
            (uint64_t)session->budget.peak_allocated_bytes;
        stats->prepared_nodes_before = graph_nodes_before;
        stats->prepared_nodes = session->graph.node_count;
        stats->prepared_nodes_added =
            session->graph.node_count - graph_nodes_before;
        stats->prepared_edges_before = graph_edges_before;
        stats->prepared_edges = session->graph.edge_count;
        stats->prepared_edges_added =
            session->graph.edge_count - graph_edges_before;
        stats->prepared_graph_capacity_bytes =
            (uint64_t)session->graph.allocated_bytes;
        stats->prepared_graph_peak_allocated_bytes =
            (uint64_t)session->graph.peak_allocated_bytes;
        if (prepared)
            stats->prepared_worker_count = session->graph.worker_count;
    }
    return status;
}

WMStatus wm_representation_session_multiplicity(
    WMRepresentationSession *session,
    const int32_t target_weight[WM_MAX_RANK],
    WMBigUInt *multiplicity,
    WMQueryStats *stats,
    char *error,
    size_t error_capacity)
{
    return wm_representation_session_multiplicity_engine(
        session, target_weight, multiplicity, stats, error, error_capacity, 0);
}

WMStatus wm_representation_session_multiplicity_prepared(
    WMRepresentationSession *session,
    const int32_t target_weight[WM_MAX_RANK],
    WMBigUInt *multiplicity,
    WMQueryStats *stats,
    char *error,
    size_t error_capacity)
{
    return wm_representation_session_multiplicity_engine(
        session, target_weight, multiplicity, stats, error, error_capacity, 1);
}

uint64_t wm_representation_session_memo_entries(
    const WMRepresentationSession *session)
{
    return session == NULL ? 0 : (uint64_t)session->memo.count;
}

uint64_t wm_representation_session_memo_capacity_bytes(
    const WMRepresentationSession *session)
{
    return session == NULL
               ? 0
               : (uint64_t)session->memo.capacity *
                     sizeof(*session->memo.entry);
}

uint64_t wm_representation_session_memo_peak_allocated_bytes(
    const WMRepresentationSession *session)
{
    return session == NULL ? 0
                           : (uint64_t)session->memo.peak_allocated_bytes;
}

uint64_t wm_representation_session_working_set_capacity_bytes(
    const WMRepresentationSession *session)
{
    return session == NULL ? 0
                           : (uint64_t)session->budget.allocated_bytes;
}

uint64_t wm_representation_session_working_set_peak_allocated_bytes(
    const WMRepresentationSession *session)
{
    return session == NULL ? 0
                           : (uint64_t)session->budget.peak_allocated_bytes;
}

void wm_representation_session_destroy(WMRepresentationSession *session)
{
    if (session == NULL) return;
    graph_destroy(&session->graph);
    budget_free(&session->budget, session->memo.entry,
                session->memo.capacity * sizeof(*session->memo.entry));
    free(session);
}

WMStatus wm_weight_multiplicity(const WMOracle *oracle,
                                const int32_t highest_weight[WM_MAX_RANK],
                                const int32_t target_weight[WM_MAX_RANK],
                                WMBigUInt *multiplicity, WMQueryStats *stats,
                                char *error, size_t error_capacity)
{
    WMRepresentationSession *session = NULL;
    WMStatus status = wm_representation_session_create(
        oracle, highest_weight, 0, &session, error, error_capacity);
    if (status != WM_OK) return status;
    status = wm_representation_session_multiplicity(
        session, target_weight, multiplicity, stats, error, error_capacity);
    wm_representation_session_destroy(session);
    return status;
}

WMStatus wm_weight_multiplicity_prepared(
    const WMOracle *oracle,
    const int32_t highest_weight[WM_MAX_RANK],
    const int32_t target_weight[WM_MAX_RANK],
    WMBigUInt *multiplicity,
    WMQueryStats *stats,
    char *error,
    size_t error_capacity)
{
    WMRepresentationSession *session = NULL;
    WMStatus status = wm_representation_session_create(
        oracle, highest_weight, 0, &session, error, error_capacity);
    if (status != WM_OK) return status;
    status = wm_representation_session_multiplicity_prepared(
        session, target_weight, multiplicity, stats, error, error_capacity);
    wm_representation_session_destroy(session);
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
