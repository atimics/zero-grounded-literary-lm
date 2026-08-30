#include "weight_multiplicity.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WM_CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

typedef struct {
    const char *name;
    uint16_t positive_roots;
} TypeExpectation;

static const TypeExpectation TYPE_EXPECTATIONS[] = {
    {"A1", 1},  {"A2", 3},  {"A3", 6},   {"A4", 10}, {"A5", 15},
    {"A6", 21}, {"A7", 28}, {"A8", 36},  {"B2", 4},  {"B3", 9},
    {"B4", 16}, {"B5", 25}, {"B6", 36},  {"B7", 49}, {"B8", 64},
    {"C3", 9},  {"C4", 16}, {"C5", 25},  {"C6", 36}, {"C7", 49},
    {"C8", 64}, {"D4", 12}, {"D5", 20},  {"D6", 30}, {"D7", 42},
    {"D8", 56}, {"G2", 6},  {"F4", 24},  {"E6", 36}, {"E7", 63},
    {"E8", 120}
};

static int parse_weight(const char *text, uint8_t rank,
                        int32_t weight[WM_MAX_RANK])
{
    uint8_t index;
    const char *cursor = text;
    memset(weight, 0, sizeof(int32_t) * WM_MAX_RANK);
    for (index = 0; index < rank; ++index) {
        char *end;
        long value;
        errno = 0;
        value = strtol(cursor, &end, 10);
        if (errno != 0 || end == cursor || value < INT32_MIN ||
            value > INT32_MAX)
            return 0;
        weight[index] = (int32_t)value;
        if (index + 1U == rank) {
            while (*end == ' ' || *end == '\t') ++end;
            if (*end != '\0') return 0;
        } else {
            while (*end == ' ' || *end == '\t') ++end;
            if (*end != ',') return 0;
            cursor = end + 1;
        }
    }
    return 1;
}

static void print_weight(const int32_t weight[WM_MAX_RANK], uint8_t rank)
{
    uint8_t index;
    putchar('[');
    for (index = 0; index < rank; ++index) {
        if (index > 0) putchar(',');
        printf("%d", weight[index]);
    }
    putchar(']');
}

static void simple_to_dynkin(const WMOracle *oracle,
                             const int16_t simple[WM_MAX_RANK], int factor,
                             int32_t dynkin[WM_MAX_RANK])
{
    uint8_t row, column;
    memset(dynkin, 0, sizeof(int32_t) * WM_MAX_RANK);
    for (row = 0; row < oracle->cartan.rank; ++row)
        for (column = 0; column < oracle->cartan.rank; ++column)
            dynkin[row] += factor * WM_CELL(&oracle->cartan, row, column) *
                           simple[column];
}

static int query_expected(const WMOracle *oracle,
                          const int32_t highest[WM_MAX_RANK],
                          const int32_t target[WM_MAX_RANK], uint32_t expected,
                          const char *context)
{
    WMBigUInt value;
    WMStatus status;
    char error[256] = {0};
    char decimal[WM_DECIMAL_CAPACITY];
    status = wm_weight_multiplicity(oracle, highest, target, &value, NULL,
                                    error, sizeof(error));
    if (status == WM_OK && wm_big_equal_u32(&value, expected)) return 1;
    if (status == WM_OK)
        (void)wm_big_to_decimal(&value, decimal, sizeof(decimal));
    else
        snprintf(decimal, sizeof(decimal), "%s", wm_status_name(status));
    if (error[0])
        fprintf(stderr, "self-test failed: %s expected %u, got %s (%s)\n",
                context, expected, decimal, error);
    else
        fprintf(stderr, "self-test failed: %s expected %u, got %s\n",
                context, expected, decimal);
    return 0;
}

static const int16_t *highest_root(const WMOracle *oracle)
{
    return oracle->positive_roots
        .coefficient[oracle->positive_roots.count - 1U];
}

static int test_a1(void)
{
    WMOracle oracle;
    int32_t highest[WM_MAX_RANK] = {4};
    int32_t target[WM_MAX_RANK] = {0};
    int value;
    char error[256] = {0};
    if (wm_oracle_init_type("A1", &oracle, error, sizeof(error)) != WM_OK) {
        fprintf(stderr, "self-test failed: A1 initialization: %s\n", error);
        return 0;
    }
    for (value = 4; value >= -4; value -= 2) {
        target[0] = value;
        if (!query_expected(&oracle, highest, target, 1, "A1 weight string"))
            return 0;
    }
    target[0] = 3;
    if (!query_expected(&oracle, highest, target, 0, "A1 lattice gap"))
        return 0;
    target[0] = -6;
    return query_expected(&oracle, highest, target, 0,
                          "A1 point below the lowest weight");
}

static int test_a2_fundamental(void)
{
    static const int32_t weights[][WM_MAX_RANK] = {
        {1, 0}, {-1, 1}, {0, -1}
    };
    WMOracle oracle;
    int32_t highest[WM_MAX_RANK] = {1, 0};
    int32_t target[WM_MAX_RANK] = {0};
    size_t index;
    char error[256] = {0};
    if (wm_oracle_init_type("A2", &oracle, error, sizeof(error)) != WM_OK) {
        fprintf(stderr, "self-test failed: A2 initialization: %s\n", error);
        return 0;
    }
    for (index = 0; index < sizeof(weights) / sizeof(weights[0]); ++index)
        if (!query_expected(&oracle, highest, weights[index], 1,
                            "A2 fundamental orbit"))
            return 0;
    return query_expected(&oracle, highest, target, 0,
                          "A2 fundamental zero-weight exclusion");
}

static int test_adjoint(const TypeExpectation *expectation,
                        uint32_t *case_count)
{
    WMOracle oracle;
    int32_t highest[WM_MAX_RANK] = {0};
    int32_t target[WM_MAX_RANK] = {0};
    int32_t doubled[WM_MAX_RANK] = {0};
    uint16_t root_index;
    int sign;
    char error[256] = {0};
    if (wm_oracle_init_type(expectation->name, &oracle, error,
                            sizeof(error)) != WM_OK) {
        fprintf(stderr, "self-test failed: %s initialization: %s\n",
                expectation->name, error);
        return 0;
    }
    if (oracle.positive_roots.count != expectation->positive_roots) {
        fprintf(stderr,
                "self-test failed: %s expected %u positive roots, got %u\n",
                expectation->name, expectation->positive_roots,
                oracle.positive_roots.count);
        return 0;
    }
    simple_to_dynkin(&oracle, highest_root(&oracle), 1, highest);
    memset(target, 0, sizeof(target));
    if (!query_expected(&oracle, highest, target, oracle.cartan.rank,
                        "adjoint zero weight"))
        return 0;
    ++*case_count;
    for (root_index = 0; root_index < oracle.positive_roots.count;
         ++root_index) {
        for (sign = -1; sign <= 1; sign += 2) {
            simple_to_dynkin(&oracle,
                             oracle.positive_roots.coefficient[root_index],
                             sign, target);
            simple_to_dynkin(&oracle,
                             oracle.positive_roots.coefficient[root_index],
                             2 * sign, doubled);
            if (!query_expected(&oracle, highest, target, 1,
                                "adjoint root") ||
                !query_expected(&oracle, highest, doubled, 0,
                                "adjoint doubled root"))
                return 0;
            *case_count += 2;
        }
    }
    return 1;
}

static int run_self_test(void)
{
    size_t index;
    uint32_t acr1_cases = 0;
    uint32_t positive_roots = 0;
    if (!test_a1() || !test_a2_fundamental()) return 1;
    for (index = 0; index < sizeof(TYPE_EXPECTATIONS) /
                              sizeof(TYPE_EXPECTATIONS[0]);
         ++index) {
        WMOracle oracle;
        char error[256] = {0};
        if (wm_oracle_init_type(TYPE_EXPECTATIONS[index].name, &oracle, error,
                                sizeof(error)) != WM_OK ||
            oracle.positive_roots.count !=
                TYPE_EXPECTATIONS[index].positive_roots) {
            fprintf(stderr, "self-test failed: root count for %s: %s\n",
                    TYPE_EXPECTATIONS[index].name, error);
            return 1;
        }
        positive_roots += oracle.positive_roots.count;
        if (index > 0 && !test_adjoint(&TYPE_EXPECTATIONS[index], &acr1_cases))
            return 1;
    }
    if (positive_roots != 931 || acr1_cases != 3750) {
        fprintf(stderr,
                "self-test failed: expected 931 positive roots and 3750 "
                "ACR-1 cases, got %u and %u\n",
                positive_roots, acr1_cases);
        return 1;
    }
    printf("{\"status\":\"pass\",\"types\":31,"
           "\"positive_roots\":931,\"acr1_cases\":3750}\n");
    return 0;
}

static int run_query(const char *type, const char *highest_text,
                     const char *target_text)
{
    WMOracle oracle;
    int32_t highest[WM_MAX_RANK] = {0};
    int32_t target[WM_MAX_RANK] = {0};
    WMBigUInt value;
    WMQueryStats stats;
    WMStatus status;
    char error[256] = {0};
    char decimal[WM_DECIMAL_CAPACITY];
    status = wm_oracle_init_type(type, &oracle, error, sizeof(error));
    if (status != WM_OK) {
        fprintf(stderr, "%s: %s\n", wm_status_name(status), error);
        return 2;
    }
    if (!parse_weight(highest_text, oracle.cartan.rank, highest) ||
        !parse_weight(target_text, oracle.cartan.rank, target)) {
        fprintf(stderr, "weights must contain exactly %u comma-separated integers\n",
                oracle.cartan.rank);
        return 2;
    }
    status = wm_weight_multiplicity(&oracle, highest, target, &value, &stats,
                                    error, sizeof(error));
    if (status != WM_OK ||
        wm_big_to_decimal(&value, decimal, sizeof(decimal)) != WM_OK) {
        fprintf(stderr, "%s: %s\n", wm_status_name(status), error);
        return 1;
    }
    printf("{\"schema_version\":1,\"type\":\"%s\",\"rank\":%u,"
           "\"highest_weight\":",
           type, oracle.cartan.rank);
    print_weight(highest, oracle.cartan.rank);
    fputs(",\"target_weight\":", stdout);
    print_weight(target, oracle.cartan.rank);
    printf(",\"multiplicity\":\"%s\",\"positive_roots\":%u,"
           "\"memo_entries\":%llu,\"recurrence_terms\":%llu,"
           "\"maximum_level\":%u}\n",
           decimal, oracle.positive_roots.count,
           (unsigned long long)stats.memo_entries,
           (unsigned long long)stats.recurrence_terms, stats.maximum_level);
    return 0;
}

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n  %s --self-test\n  %s query TYPE HIGHEST TARGET\n"
            "example:\n  %s query A2 1,1 0,0\n",
            program, program, program);
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return run_self_test();
    if (argc == 5 && strcmp(argv[1], "query") == 0)
        return run_query(argv[2], argv[3], argv[4]);
    usage(argv[0]);
    return 2;
}
