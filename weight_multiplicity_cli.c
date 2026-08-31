#include "weight_multiplicity.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

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
    WMBigUInt value, ray_value;
    WMQueryStats recursive_stats, ray_stats;
    WMStatus status;
    char error[256] = {0};
    char decimal[WM_DECIMAL_CAPACITY];
    status = wm_weight_multiplicity(oracle, highest, target, &value,
                                    &recursive_stats, error, sizeof(error));
    if (status == WM_OK)
        status = wm_weight_multiplicity_ray(
            oracle, highest, target, &ray_value, &ray_stats, error,
            sizeof(error));
    if (status == WM_OK && wm_big_equal_u32(&value, expected) &&
        memcmp(&value, &ray_value, sizeof(value)) == 0 &&
        recursive_stats.recurrence_terms == ray_stats.recurrence_terms)
        return 1;
    if (status == WM_OK)
        (void)wm_big_to_decimal(&value, decimal, sizeof(decimal));
    else
        snprintf(decimal, sizeof(decimal), "%s", wm_status_name(status));
    if (error[0])
        fprintf(stderr, "self-test failed: %s expected %u, got %s (%s; "
                        "root-ray differential failed)\n",
                context, expected, decimal, error);
    else
        fprintf(stderr, "self-test failed: %s expected %u, got %s "
                        "(root-ray differential failed)\n",
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

static int test_persistent_representation_memo(void)
{
    WMOracle oracle;
    WMRepresentationSession *session = NULL;
    int32_t highest[WM_MAX_RANK] = {1, 1};
    int32_t target[WM_MAX_RANK] = {0};
    WMBigUInt first, second, fresh;
    WMQueryStats first_stats, second_stats;
    char error[256] = {0};
    WMStatus status;
    status = wm_oracle_init_type("A2", &oracle, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_create_with_capacity(
            &oracle, highest, 1024U * 1024U, 2048U, &session, error,
            sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity(
            session, target, &first, &first_stats, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity(
            session, target, &second, &second_stats, error, sizeof(error));
    if (status == WM_OK)
        status = wm_weight_multiplicity(&oracle, highest, target, &fresh, NULL,
                                        error, sizeof(error));
    if (status != WM_OK || !wm_big_equal_u32(&first, 2) ||
        memcmp(&first, &second, sizeof(first)) != 0 ||
        memcmp(&first, &fresh, sizeof(first)) != 0 ||
        first_stats.memo_entries_added == 0 ||
        second_stats.memo_entries_before == 0 ||
        second_stats.memo_entries_added != 0 || second_stats.memo_hits == 0 ||
        first_stats.memo_capacity_bytes !=
            2048U * wm_representation_memo_entry_bytes()) {
        fprintf(stderr,
                "self-test failed: persistent representation memo: %s\n",
                error);
        wm_representation_session_destroy(session);
        return 0;
    }
    wm_representation_session_destroy(session);
    return 1;
}

static int test_prepared_dependency_graph(void)
{
    WMOracle oracle;
    WMRepresentationSession *session = NULL;
    int32_t highest[WM_MAX_RANK] = {2, 0, 2};
    int32_t target[WM_MAX_RANK] = {0};
    WMBigUInt recursive, first, second;
    WMQueryStats recursive_stats, first_stats, second_stats, limit_stats;
    char error[256] = {0};
    WMStatus status = wm_oracle_init_type("A3", &oracle, error,
                                         sizeof(error));
    if (status == WM_OK)
        status = wm_weight_multiplicity(&oracle, highest, target, &recursive,
                                        &recursive_stats, error,
                                        sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_create(
            &oracle, highest, 4U * 1024U * 1024U, &session, error,
            sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_prepared(
            session, target, &first, &first_stats, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_prepared(
            session, target, &second, &second_stats, error, sizeof(error));
    if (status != WM_OK || !wm_big_equal_u32(&first, 6) ||
        memcmp(&recursive, &first, sizeof(first)) != 0 ||
        memcmp(&first, &second, sizeof(first)) != 0 ||
        recursive_stats.recurrence_terms != first_stats.recurrence_terms ||
        recursive_stats.recursive_weyl_folds !=
            first_stats.recursive_weyl_folds ||
        recursive_stats.maximum_level != first_stats.maximum_level ||
        recursive_stats.memo_entries != first_stats.memo_entries ||
        first_stats.prepared_nodes == 0 ||
        first_stats.prepared_edges >= first_stats.prepared_raw_transitions ||
        second_stats.memo_entries_added != 0 ||
        second_stats.prepared_nodes_added != 0 ||
        second_stats.prepared_edges_added != 0 ||
        second_stats.recurrence_terms != 0) {
        fprintf(stderr,
                "self-test failed: prepared dependency graph exactness or "
                "session reuse: %s\n",
                error);
        wm_representation_session_destroy(session);
        return 0;
    }
    wm_representation_session_destroy(session);
    session = NULL;
    memset(error, 0, sizeof(error));
    status = wm_representation_session_create(
        &oracle, highest, 200000U, &session, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_prepared(
            session, target, &first, &limit_stats, error, sizeof(error));
    if (status != WM_LIMIT_ERROR ||
        limit_stats.working_set_peak_allocated_bytes > 200000U) {
        fprintf(stderr,
                "self-test failed: prepared graph did not honor the shared "
                "byte limit: %s\n",
                error);
        wm_representation_session_destroy(session);
        return 0;
    }
    wm_representation_session_destroy(session);
    return 1;
}

static int test_root_ray_factorization(void)
{
    WMOracle oracle;
    WMRepresentationSession *session = NULL;
    int32_t highest[WM_MAX_RANK] = {2, 0, 2};
    int32_t target[WM_MAX_RANK] = {0};
    int32_t shallow_target[WM_MAX_RANK] = {1, 0, 1};
    WMBigUInt recursive, shallow, first, second;
    WMQueryStats recursive_stats, shallow_stats, first_stats, second_stats,
        limit_stats;
    char error[256] = {0};
    WMStatus status = wm_oracle_init_type("A3", &oracle, error,
                                         sizeof(error));
    if (status == WM_OK)
        status = wm_weight_multiplicity(&oracle, highest, target, &recursive,
                                        &recursive_stats, error,
                                        sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_create(
            &oracle, highest, 4U * 1024U * 1024U, &session, error,
            sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_ray(
            session, shallow_target, &shallow, &shallow_stats, error,
            sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_ray(
            session, target, &first, &first_stats, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_ray(
            session, target, &second, &second_stats, error, sizeof(error));
    if (status != WM_OK || !wm_big_equal_u32(&shallow, 3) ||
        !wm_big_equal_u32(&first, 6) ||
        memcmp(&recursive, &first, sizeof(first)) != 0 ||
        memcmp(&first, &second, sizeof(first)) != 0 ||
        recursive_stats.recurrence_terms !=
            shallow_stats.recurrence_terms + first_stats.recurrence_terms ||
        shallow_stats.ray_states == 0 || shallow_stats.ray_transitions == 0 ||
        first_stats.ray_states <= shallow_stats.ray_states ||
        first_stats.ray_transitions == 0 ||
        second_stats.memo_entries_added != 0 ||
        second_stats.recurrence_terms != 0) {
        fprintf(stderr,
                "self-test failed: root-ray factorization exactness or "
                "session reuse: %s\n",
                error);
        wm_representation_session_destroy(session);
        return 0;
    }
    wm_representation_session_destroy(session);
    session = NULL;
    memset(error, 0, sizeof(error));
    status = wm_representation_session_create(
        &oracle, highest, 200000U, &session, error, sizeof(error));
    if (status == WM_OK)
        status = wm_representation_session_multiplicity_ray(
            session, target, &first, &limit_stats, error, sizeof(error));
    if (status != WM_LIMIT_ERROR ||
        limit_stats.working_set_peak_allocated_bytes > 200000U) {
        fprintf(stderr,
                "self-test failed: root-ray tables did not honor the shared "
                "byte limit: %s\n",
                error);
        wm_representation_session_destroy(session);
        return 0;
    }
    wm_representation_session_destroy(session);
    return 1;
}

static int test_recursive_weyl_folding(void)
{
    WMOracle oracle;
    WMBigUInt value;
    WMQueryStats stats;
    int32_t highest[WM_MAX_RANK] = {1, 1};
    int32_t target[WM_MAX_RANK] = {0};
    char error[256] = {0};
    WMStatus status = wm_oracle_init_type("A2", &oracle, error, sizeof(error));
    if (status == WM_OK)
        status = wm_weight_multiplicity(&oracle, highest, target, &value, &stats,
                                        error, sizeof(error));
    if (status == WM_OK && wm_big_equal_u32(&value, 2) &&
        stats.recursive_weyl_folds > 0 && stats.memo_entries == 1)
        return 1;
    fprintf(stderr,
            "self-test failed: recursive Weyl folding expected A2 multiplicity "
            "2, at least one fold, and one memo entry\n");
    return 0;
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
    if (!test_a1() || !test_a2_fundamental() ||
        !test_recursive_weyl_folding() ||
        !test_persistent_representation_memo() ||
        !test_prepared_dependency_graph() ||
        !test_root_ray_factorization())
        return 1;
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
           "\"positive_roots\":931,\"acr1_cases\":3750,"
           "\"persistent_representation_memo\":true,"
           "\"prepared_dependency_graph\":true,"
           "\"root_ray_factorization\":true,"
           "\"parallel_root_ray_dag\":true}\n");
    return 0;
}

static WMStatus evaluate_and_print(const char *type, const WMOracle *oracle,
                                   const int32_t highest[WM_MAX_RANK],
                                   const int32_t target[WM_MAX_RANK],
                                   int engine, char *error,
                                   size_t error_capacity)
{
    WMBigUInt value;
    WMQueryStats stats;
    WMStatus status;
    char decimal[WM_DECIMAL_CAPACITY];
    if (engine == 2)
        status = wm_weight_multiplicity_ray(
            oracle, highest, target, &value, &stats, error, error_capacity);
    else if (engine == 1)
        status = wm_weight_multiplicity_prepared(
            oracle, highest, target, &value, &stats, error, error_capacity);
    else
        status = wm_weight_multiplicity(oracle, highest, target, &value,
                                        &stats, error, error_capacity);
    if (status != WM_OK ||
        wm_big_to_decimal(&value, decimal, sizeof(decimal)) != WM_OK) {
        return status == WM_OK ? WM_LIMIT_ERROR : status;
    }
    printf("{\"schema_version\":1,\"type\":\"%s\",\"rank\":%u,"
           "\"highest_weight\":",
           type, oracle->cartan.rank);
    print_weight(highest, oracle->cartan.rank);
    fputs(",\"target_weight\":", stdout);
    print_weight(target, oracle->cartan.rank);
    printf(",\"multiplicity\":\"%s\",\"positive_roots\":%u,"
           "\"memo_entries\":%llu,\"recurrence_terms\":%llu,"
           "\"recursive_weyl_folds\":%llu,"
           "\"engine\":\"%s\","
           "\"prepared_nodes\":%llu,\"prepared_edges\":%llu,"
           "\"prepared_raw_transitions\":%llu,"
           "\"prepared_root_orbit_groups\":%llu,"
           "\"prepared_root_ray_updates\":%llu,"
           "\"prepared_root_ray_transitions_saved\":%llu,"
           "\"prepared_nontrivial_stabilizer_nodes\":%llu,"
           "\"prepared_discovery_nanoseconds\":%llu,"
           "\"prepared_evaluation_nanoseconds\":%llu,"
           "\"prepared_graph_capacity_bytes\":%llu,"
           "\"prepared_worker_count\":%u,"
           "\"prepared_parallel_groups\":%llu,"
           "\"prepared_parallel_nodes\":%llu,"
           "\"prepared_discovery_rounds\":%llu,"
           "\"prepared_discovery_nodes\":%llu,"
           "\"ray_states\":%llu,\"ray_state_hits\":%llu,"
           "\"ray_transitions\":%llu,"
           "\"ray_nodes\":%llu,"
           "\"ray_graph_capacity_bytes\":%llu,"
           "\"ray_capacity_bytes\":%llu,"
           "\"ray_peak_allocated_bytes\":%llu,"
           "\"ray_discovery_nanoseconds\":%llu,"
           "\"ray_evaluation_nanoseconds\":%llu,"
           "\"ray_worker_count\":%u,"
           "\"ray_parallel_groups\":%llu,"
           "\"ray_parallel_nodes\":%llu,"
           "\"working_set_peak_allocated_bytes\":%llu,"
           "\"maximum_level\":%u}\n",
           decimal, oracle->positive_roots.count,
           (unsigned long long)stats.memo_entries,
           (unsigned long long)stats.recurrence_terms,
           (unsigned long long)stats.recursive_weyl_folds,
           engine == 2 ? "root_ray"
                       : (engine == 1 ? "prepared_dag" : "recursive"),
           (unsigned long long)stats.prepared_nodes,
           (unsigned long long)stats.prepared_edges,
           (unsigned long long)stats.prepared_raw_transitions,
           (unsigned long long)stats.prepared_root_orbit_groups,
           (unsigned long long)stats.prepared_root_ray_updates,
           (unsigned long long)stats.prepared_root_ray_transitions_saved,
           (unsigned long long)stats.prepared_nontrivial_stabilizer_nodes,
           (unsigned long long)stats.prepared_discovery_nanoseconds,
           (unsigned long long)stats.prepared_evaluation_nanoseconds,
           (unsigned long long)stats.prepared_graph_capacity_bytes,
           stats.prepared_worker_count,
           (unsigned long long)stats.prepared_parallel_groups,
           (unsigned long long)stats.prepared_parallel_nodes,
           (unsigned long long)stats.prepared_discovery_rounds,
           (unsigned long long)stats.prepared_discovery_nodes,
           (unsigned long long)stats.ray_states,
           (unsigned long long)stats.ray_state_hits,
           (unsigned long long)stats.ray_transitions,
           (unsigned long long)stats.ray_nodes,
           (unsigned long long)stats.ray_graph_capacity_bytes,
           (unsigned long long)stats.ray_capacity_bytes,
           (unsigned long long)stats.ray_peak_allocated_bytes,
           (unsigned long long)stats.ray_discovery_nanoseconds,
           (unsigned long long)stats.ray_evaluation_nanoseconds,
           stats.ray_worker_count,
           (unsigned long long)stats.ray_parallel_groups,
           (unsigned long long)stats.ray_parallel_nodes,
           (unsigned long long)stats.working_set_peak_allocated_bytes,
           stats.maximum_level);
    return WM_OK;
}

static WMStatus evaluate_session_and_print(
    const char *type, const WMOracle *oracle,
    WMRepresentationSession *session,
    const int32_t highest[WM_MAX_RANK],
    const int32_t target[WM_MAX_RANK],
    uint64_t session_generation,
    int engine, char *error, size_t error_capacity)
{
    WMBigUInt value;
    WMQueryStats stats;
    WMStatus status;
    char decimal[WM_DECIMAL_CAPACITY];
    if (engine == 2)
        status = wm_representation_session_multiplicity_ray(
            session, target, &value, &stats, error, error_capacity);
    else if (engine == 1)
        status = wm_representation_session_multiplicity_prepared(
            session, target, &value, &stats, error, error_capacity);
    else
        status = wm_representation_session_multiplicity(
            session, target, &value, &stats, error, error_capacity);
    if (status != WM_OK ||
        wm_big_to_decimal(&value, decimal, sizeof(decimal)) != WM_OK) {
        return status == WM_OK ? WM_LIMIT_ERROR : status;
    }
    printf("{\"schema_version\":%u,\"type\":\"%s\",\"rank\":%u,"
           "\"highest_weight\":",
           engine == 2 ? 4U : (engine == 1 ? 3U : 2U), type,
           oracle->cartan.rank);
    print_weight(highest, oracle->cartan.rank);
    fputs(",\"target_weight\":", stdout);
    print_weight(target, oracle->cartan.rank);
    printf(",\"multiplicity\":\"%s\",\"positive_roots\":%u,"
           "\"cache_mode\":\"%s\",\"engine\":\"%s\","
           "\"session_generation\":%llu,"
           "\"memo_entries_before\":%llu,\"memo_entries\":%llu,"
           "\"memo_entries_added\":%llu,\"memo_hits\":%llu,"
           "\"memo_capacity_bytes\":%llu,"
           "\"memo_peak_allocated_bytes\":%llu,"
           "\"working_set_capacity_bytes\":%llu,"
           "\"working_set_peak_allocated_bytes\":%llu,"
           "\"recurrence_terms\":%llu,"
           "\"recursive_weyl_folds\":%llu,"
           "\"prepared_nodes_before\":%llu,"
           "\"prepared_nodes\":%llu,"
           "\"prepared_nodes_added\":%llu,"
           "\"prepared_edges_before\":%llu,"
           "\"prepared_edges\":%llu,"
           "\"prepared_edges_added\":%llu,"
           "\"prepared_raw_transitions\":%llu,"
           "\"prepared_root_orbit_groups\":%llu,"
           "\"prepared_root_ray_updates\":%llu,"
           "\"prepared_root_ray_transitions_saved\":%llu,"
           "\"prepared_nontrivial_stabilizer_nodes\":%llu,"
           "\"prepared_discovery_nanoseconds\":%llu,"
           "\"prepared_evaluation_nanoseconds\":%llu,"
           "\"prepared_graph_capacity_bytes\":%llu,"
           "\"prepared_worker_count\":%u,"
           "\"ray_states\":%llu,\"ray_state_hits\":%llu,"
           "\"ray_transitions\":%llu,"
           "\"ray_nodes_before\":%llu,"
           "\"ray_nodes\":%llu,"
           "\"ray_nodes_added\":%llu,"
           "\"ray_graph_capacity_bytes\":%llu,"
           "\"ray_capacity_bytes\":%llu,"
           "\"ray_peak_allocated_bytes\":%llu,"
           "\"ray_discovery_nanoseconds\":%llu,"
           "\"ray_evaluation_nanoseconds\":%llu,"
           "\"ray_worker_count\":%u,"
           "\"ray_parallel_groups\":%llu,"
           "\"ray_parallel_nodes\":%llu,"
           "\"maximum_level\":%u}\n",
           decimal, oracle->positive_roots.count,
           engine == 2
               ? "per_representation_root_ray"
               : (engine == 1 ? "per_representation_prepared_dag"
                              : "per_representation"),
           engine == 2 ? "root_ray"
                       : (engine == 1 ? "prepared_dag" : "recursive"),
           (unsigned long long)session_generation,
           (unsigned long long)stats.memo_entries_before,
           (unsigned long long)stats.memo_entries,
           (unsigned long long)stats.memo_entries_added,
           (unsigned long long)stats.memo_hits,
           (unsigned long long)stats.memo_capacity_bytes,
           (unsigned long long)stats.memo_peak_allocated_bytes,
           (unsigned long long)stats.working_set_capacity_bytes,
           (unsigned long long)stats.working_set_peak_allocated_bytes,
           (unsigned long long)stats.recurrence_terms,
           (unsigned long long)stats.recursive_weyl_folds,
           (unsigned long long)stats.prepared_nodes_before,
           (unsigned long long)stats.prepared_nodes,
           (unsigned long long)stats.prepared_nodes_added,
           (unsigned long long)stats.prepared_edges_before,
           (unsigned long long)stats.prepared_edges,
           (unsigned long long)stats.prepared_edges_added,
           (unsigned long long)stats.prepared_raw_transitions,
           (unsigned long long)stats.prepared_root_orbit_groups,
           (unsigned long long)stats.prepared_root_ray_updates,
           (unsigned long long)stats.prepared_root_ray_transitions_saved,
           (unsigned long long)stats.prepared_nontrivial_stabilizer_nodes,
           (unsigned long long)stats.prepared_discovery_nanoseconds,
           (unsigned long long)stats.prepared_evaluation_nanoseconds,
           (unsigned long long)stats.prepared_graph_capacity_bytes,
           stats.prepared_worker_count,
           (unsigned long long)stats.ray_states,
           (unsigned long long)stats.ray_state_hits,
           (unsigned long long)stats.ray_transitions,
           (unsigned long long)stats.ray_nodes_before,
           (unsigned long long)stats.ray_nodes,
           (unsigned long long)stats.ray_nodes_added,
           (unsigned long long)stats.ray_graph_capacity_bytes,
           (unsigned long long)stats.ray_capacity_bytes,
           (unsigned long long)stats.ray_peak_allocated_bytes,
           (unsigned long long)stats.ray_discovery_nanoseconds,
           (unsigned long long)stats.ray_evaluation_nanoseconds,
           stats.ray_worker_count,
           (unsigned long long)stats.ray_parallel_groups,
           (unsigned long long)stats.ray_parallel_nodes,
           stats.maximum_level);
    return WM_OK;
}

static int run_query(const char *type, const char *highest_text,
                     const char *target_text, int engine)
{
    WMOracle oracle;
    int32_t highest[WM_MAX_RANK] = {0};
    int32_t target[WM_MAX_RANK] = {0};
    WMStatus status;
    char error[256] = {0};
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
    status = evaluate_and_print(type, &oracle, highest, target, engine, error,
                                sizeof(error));
    if (status != WM_OK) {
        fprintf(stderr, "%s: %s\n", wm_status_name(status), error);
        return 1;
    }
    return 0;
}

static int run_describe(const char *type)
{
    WMOracle oracle;
    WMStatus status;
    char error[256] = {0};
    uint8_t row, column;
    uint16_t root;
    status = wm_oracle_init_type(type, &oracle, error, sizeof(error));
    if (status != WM_OK) {
        fprintf(stderr, "%s: %s\n", wm_status_name(status), error);
        return 2;
    }
    printf("{\"schema_version\":1,\"type\":\"%s\",\"rank\":%u,"
           "\"cartan\":[",
           type, oracle.cartan.rank);
    for (row = 0; row < oracle.cartan.rank; ++row) {
        if (row > 0) putchar(',');
        putchar('[');
        for (column = 0; column < oracle.cartan.rank; ++column) {
            if (column > 0) putchar(',');
            printf("%d", WM_CELL(&oracle.cartan, row, column));
        }
        putchar(']');
    }
    fputs("],\"symmetrizer\":[", stdout);
    for (row = 0; row < oracle.cartan.rank; ++row) {
        if (row > 0) putchar(',');
        printf("%u", oracle.symmetrizer[row]);
    }
    fputs("],\"positive_roots\":[", stdout);
    for (root = 0; root < oracle.positive_roots.count; ++root) {
        if (root > 0) putchar(',');
        putchar('[');
        for (column = 0; column < oracle.cartan.rank; ++column) {
            if (column > 0) putchar(',');
            printf("%d", oracle.positive_roots.coefficient[root][column]);
        }
        putchar(']');
    }
    fputs("]}\n", stdout);
    return 0;
}

static int same_weight(const int32_t left[WM_MAX_RANK],
                       const int32_t right[WM_MAX_RANK], uint8_t rank)
{
    uint8_t index;
    for (index = 0; index < rank; ++index)
        if (left[index] != right[index]) return 0;
    return 1;
}

static int configured_memo_limit(size_t *memo_limit)
{
    const char *text = getenv("ZERO_WEIGHT_MEMO_LIMIT_BYTES");
    unsigned long long value = UINT64_C(2147483648);
    if (text != NULL && *text != '\0') {
        char *end;
        errno = 0;
        value = strtoull(text, &end, 10);
        if (errno != 0 || end == text || *end != '\0' || value > SIZE_MAX)
            return 0;
    }
    *memo_limit = (size_t)value;
    return 1;
}

static int configured_memo_initial_capacity(size_t *initial_capacity)
{
    const char *text = getenv("ZERO_WEIGHT_MEMO_INITIAL_CAPACITY");
    unsigned long long value = 1024U;
    if (text != NULL && *text != '\0') {
        char *end;
        errno = 0;
        value = strtoull(text, &end, 10);
        if (errno != 0 || end == text || *end != '\0' || value > SIZE_MAX ||
            value < 2U || (value & (value - 1U)) != 0U)
            return 0;
    }
    *initial_capacity = (size_t)value;
    return 1;
}

static int run_server(int grouped, int engine)
{
    static struct CachedOracle {
        char type[4];
        WMOracle oracle;
    } cache[31];
    size_t cache_count = 0;
    size_t memo_limit = 0;
    size_t memo_initial_capacity = 1024U;
    WMRepresentationSession *active_session = NULL;
    int32_t active_highest[WM_MAX_RANK] = {0};
    char active_type[4] = {0};
    uint64_t session_generation = 0;
    char line[1024];
    if (grouped &&
        (!configured_memo_limit(&memo_limit) ||
         !configured_memo_initial_capacity(&memo_initial_capacity))) {
        fputs("invalid grouped memo configuration\n", stderr);
        return 2;
    }
    memset(cache, 0, sizeof(cache));
    if (grouped)
        printf("{\"status\":\"ready\",\"schema_version\":%u,"
               "\"cache_mode\":\"%s\","
               "\"memo_limit_bytes\":%llu,"
               "\"memo_initial_capacity\":%llu,"
               "\"memo_entry_bytes\":%llu,"
               "\"memo_allocation_policy\":\"%s\"}\n",
               engine == 2 ? 4U : (engine == 1 ? 3U : 2U),
               engine == 2
                   ? "per_representation_root_ray"
                   : (engine == 1 ? "per_representation_prepared_dag"
                                  : "per_representation"),
               (unsigned long long)memo_limit,
               (unsigned long long)memo_initial_capacity,
               (unsigned long long)wm_representation_memo_entry_bytes(),
               memo_initial_capacity == 1024U
                   ? "power_of_two_doubling"
                   : "power_of_two_presized_then_doubling");
    else
        fputs("{\"status\":\"ready\",\"schema_version\":1}\n", stdout);
    fflush(stdout);
    while (fgets(line, sizeof(line), stdin) != NULL) {
        char *highest_text;
        char *target_text;
        char *end;
        size_t index;
        WMOracle *oracle = NULL;
        int32_t highest[WM_MAX_RANK] = {0};
        int32_t target[WM_MAX_RANK] = {0};
        WMStatus status;
        char error[256] = {0};
        end = strpbrk(line, "\r\n");
        if (end != NULL) *end = '\0';
        if (strcmp(line, "@metrics") == 0) {
            struct rusage usage;
            if (getrusage(RUSAGE_SELF, &usage) != 0) {
                fputs("{\"status\":\"error\",\"code\":\"metrics_error\"}\n",
                      stdout);
            } else {
#if defined(__APPLE__)
                unsigned long long max_rss_bytes =
                    (unsigned long long)usage.ru_maxrss;
#else
                unsigned long long max_rss_bytes =
                    (unsigned long long)usage.ru_maxrss * 1024ULL;
#endif
                if (grouped)
                    printf("{\"status\":\"metrics\","
                           "\"max_rss_bytes\":%llu,"
                           "\"cache_mode\":\"%s\","
                           "\"session_generation\":%llu,"
                           "\"memo_entries\":%llu,"
                           "\"memo_capacity_bytes\":%llu,"
                           "\"memo_peak_allocated_bytes\":%llu,"
                           "\"working_set_capacity_bytes\":%llu,"
                           "\"working_set_peak_allocated_bytes\":%llu}\n",
                           max_rss_bytes,
                           engine == 2
                               ? "per_representation_root_ray"
                               : (engine == 1
                                      ? "per_representation_prepared_dag"
                                      : "per_representation"),
                           (unsigned long long)session_generation,
                           (unsigned long long)
                               wm_representation_session_memo_entries(
                                   active_session),
                           (unsigned long long)
                               wm_representation_session_memo_capacity_bytes(
                                   active_session),
                           (unsigned long long)
                               wm_representation_session_memo_peak_allocated_bytes(
                                   active_session),
                           (unsigned long long)
                               wm_representation_session_working_set_capacity_bytes(
                                   active_session),
                           (unsigned long long)
                               wm_representation_session_working_set_peak_allocated_bytes(
                                   active_session));
                else
                    printf("{\"status\":\"metrics\","
                           "\"max_rss_bytes\":%llu}\n",
                           max_rss_bytes);
            }
            fflush(stdout);
            continue;
        }
        if (grouped && strcmp(line, "@reset") == 0) {
            wm_representation_session_destroy(active_session);
            active_session = NULL;
            memset(active_highest, 0, sizeof(active_highest));
            memset(active_type, 0, sizeof(active_type));
            printf("{\"status\":\"reset\",\"cache_mode\":\"%s\"}\n",
                   engine == 2
                       ? "per_representation_root_ray"
                       : (engine == 1 ? "per_representation_prepared_dag"
                                      : "per_representation"));
            fflush(stdout);
            continue;
        }
        highest_text = strchr(line, '\t');
        if (highest_text == NULL) {
            fputs("{\"status\":\"error\",\"code\":\"invalid_request\"}\n",
                  stdout);
            fflush(stdout);
            continue;
        }
        *highest_text++ = '\0';
        target_text = strchr(highest_text, '\t');
        if (target_text == NULL || strlen(line) >= sizeof(cache[0].type)) {
            fputs("{\"status\":\"error\",\"code\":\"invalid_request\"}\n",
                  stdout);
            fflush(stdout);
            continue;
        }
        *target_text++ = '\0';
        for (index = 0; index < cache_count; ++index) {
            if (strcmp(cache[index].type, line) == 0) {
                oracle = &cache[index].oracle;
                break;
            }
        }
        if (oracle == NULL) {
            if (cache_count >= sizeof(cache) / sizeof(cache[0])) {
                fputs("{\"status\":\"error\",\"code\":\"type_cache_full\"}\n",
                      stdout);
                fflush(stdout);
                continue;
            }
            status = wm_oracle_init_type(line, &cache[cache_count].oracle,
                                         error, sizeof(error));
            if (status != WM_OK) {
                printf("{\"status\":\"error\",\"code\":\"%s\"}\n",
                       wm_status_name(status));
                fflush(stdout);
                continue;
            }
            memcpy(cache[cache_count].type, line, strlen(line) + 1U);
            oracle = &cache[cache_count].oracle;
            ++cache_count;
        }
        if (!parse_weight(highest_text, oracle->cartan.rank, highest) ||
            !parse_weight(target_text, oracle->cartan.rank, target)) {
            fputs("{\"status\":\"error\",\"code\":\"invalid_weight\"}\n",
                  stdout);
            fflush(stdout);
            continue;
        }
        if (grouped) {
            if (active_session == NULL || strcmp(active_type, line) != 0 ||
                !same_weight(active_highest, highest, oracle->cartan.rank)) {
                wm_representation_session_destroy(active_session);
                active_session = NULL;
                status = wm_representation_session_create_with_capacity(
                    oracle, highest, memo_limit, memo_initial_capacity,
                    &active_session, error, sizeof(error));
                if (status != WM_OK) {
                    printf("{\"status\":\"error\",\"code\":\"%s\"}\n",
                           wm_status_name(status));
                    fflush(stdout);
                    continue;
                }
                memcpy(active_type, line, strlen(line) + 1U);
                memcpy(active_highest, highest, sizeof(active_highest));
                ++session_generation;
            }
            status = evaluate_session_and_print(
                line, oracle, active_session, highest, target,
                session_generation, engine, error, sizeof(error));
        } else {
            status = evaluate_and_print(line, oracle, highest, target, 0,
                                        error, sizeof(error));
        }
        if (status != WM_OK)
            printf("{\"status\":\"error\",\"code\":\"%s\"}\n",
                   wm_status_name(status));
        fflush(stdout);
    }
    wm_representation_session_destroy(active_session);
    return ferror(stdin) ? 1 : 0;
}

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n  %s --self-test\n  %s --serve\n"
            "  %s --serve-grouped\n"
            "  %s --serve-prepared\n"
            "  %s --serve-ray\n"
            "  %s describe TYPE\n  %s query TYPE HIGHEST TARGET\n"
            "  %s query-prepared TYPE HIGHEST TARGET\n"
            "  %s query-ray TYPE HIGHEST TARGET\n"
            "example:\n  %s query A2 1,1 0,0\n",
            program, program, program, program, program, program, program,
            program, program, program);
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return run_self_test();
    if (argc == 2 && strcmp(argv[1], "--serve") == 0)
        return run_server(0, 0);
    if (argc == 2 && strcmp(argv[1], "--serve-grouped") == 0)
        return run_server(1, 0);
    if (argc == 2 && strcmp(argv[1], "--serve-prepared") == 0)
        return run_server(1, 1);
    if (argc == 2 && strcmp(argv[1], "--serve-ray") == 0)
        return run_server(1, 2);
    if (argc == 3 && strcmp(argv[1], "describe") == 0)
        return run_describe(argv[2]);
    if (argc == 5 && strcmp(argv[1], "query") == 0)
        return run_query(argv[2], argv[3], argv[4], 0);
    if (argc == 5 && strcmp(argv[1], "query-prepared") == 0)
        return run_query(argv[2], argv[3], argv[4], 1);
    if (argc == 5 && strcmp(argv[1], "query-ray") == 0)
        return run_query(argv[2], argv[3], argv[4], 2);
    usage(argv[0]);
    return 2;
}
