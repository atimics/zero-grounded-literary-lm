#ifndef R55FAST_SORT_H
#define R55FAST_SORT_H

/* Compare indexes, then apply the resulting permutation in cycles. The final
 * comparison key is unique in both search record types. */
#if R55FAST_SORT
#define R55FAST_DEFINE_SORT(name, type, compare) \
static void name(type *items, size_t count) \
{ \
    uint16_t first[R55_CANDIDATES], second[R55_CANDIDATES]; \
    uint16_t *order = first, *scratch = second; \
    if (count > R55_CANDIDATES) abort(); \
    for (size_t i = 0; i < count; ++i) order[i] = (uint16_t)i; \
    for (size_t start = 0; start < count; start += 16) { \
        size_t end = start + 16 < count ? start + 16 : count; \
        for (size_t i = start + 1; i < end; ++i) { \
            uint16_t value = order[i]; \
            size_t j = i; \
            while (j > start && compare(&items[value], &items[order[j - 1]]) < 0) { \
                order[j] = order[j - 1]; \
                --j; \
            } \
            order[j] = value; \
        } \
    } \
    for (size_t width = 16; width < count; width *= 2) { \
        for (size_t start = 0; start < count; start += 2 * width) { \
            size_t middle = start + width < count ? start + width : count; \
            size_t end = start + 2 * width < count ? start + 2 * width : count; \
            size_t left = start, right = middle, out = start; \
            while (left < middle && right < end) { \
                if (compare(&items[order[left]], &items[order[right]]) <= 0) \
                    scratch[out++] = order[left++]; \
                else scratch[out++] = order[right++]; \
            } \
            while (left < middle) scratch[out++] = order[left++]; \
            while (right < end) scratch[out++] = order[right++]; \
        } \
        uint16_t *temporary = order; order = scratch; scratch = temporary; \
    } \
    for (size_t start = 0; start < count; ++start) { \
        if (order[start] == UINT16_MAX) continue; \
        if (order[start] == start) { order[start] = UINT16_MAX; continue; } \
        type saved = items[start]; \
        size_t destination = start; \
        while (order[destination] != start) { \
            size_t source = order[destination]; \
            items[destination] = items[source]; \
            order[destination] = UINT16_MAX; \
            destination = source; \
        } \
        items[destination] = saved; \
        order[destination] = UINT16_MAX; \
    } \
}
#else
#define R55FAST_DEFINE_SORT(name, type, compare) \
static void name(type *items, size_t count) \
{ \
    qsort(items, count, sizeof(*items), compare); \
}
#endif
#endif
