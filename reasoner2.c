#include "reasoner2.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R2_MAX_TYPES_PER_RANK 8
#define R2_MAX_CASES 512
#define R2_MAX_ACTIONS 225
#define R2_MAX_OPTIMAL_ACTIONS 64
#define R2_MAX_ACTIVE_FEATURES 256
#define R2_MODEL_VERSION 1U
#define CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

typedef enum {
    R2_EDIT_DELETE_NODE = 0,
    R2_EDIT_SET_BOND = 1
} R2EditKind;

typedef struct {
    uint8_t kind;
    uint8_t first;
    uint8_t second;
    uint8_t bond;
} R2Action;

typedef struct {
    uint8_t count;
    R0CartanMatrix items[R2_MAX_TYPES_PER_RANK];
} R2MatrixList;

typedef struct {
    R0CartanMatrix matrix;
    R0VerifierObservation observation;
    R2Action optimal[R2_MAX_OPTIMAL_ACTIONS];
    uint8_t optimal_count;
    uint8_t stage_rank;
    uint8_t distance;
    uint8_t weight;
    uint8_t affine;
} R2Case;

typedef struct {
    uint16_t count;
    R2Case cases[R2_MAX_CASES];
    uint32_t one_step_cases;
    uint32_t two_step_cases;
    uint32_t affine_cases;
} R2Corpus;

typedef struct {
    uint16_t count;
    uint16_t indices[R2_MAX_ACTIVE_FEATURES];
    int16_t values[R2_MAX_ACTIVE_FEATURES];
} R2FeatureVector;

static const int8_t R2_BONDS[6][2] = {
    {0, 0}, {-1, -1}, {-1, -2}, {-2, -1}, {-1, -3}, {-3, -1},
};

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static void matrix_diagonal(R0CartanMatrix *matrix, uint8_t rank)
{
    int node;
    memset(matrix, 0, sizeof(*matrix));
    matrix->rank = rank;
    for (node = 0; node < rank; ++node) CELL(matrix, node, node) = 2;
}

static void matrix_edge(R0CartanMatrix *matrix, int left, int right,
                        int8_t forward, int8_t backward)
{
    CELL(matrix, left, right) = forward;
    CELL(matrix, right, left) = backward;
}

static int matrix_equal(const R0CartanMatrix *left,
                        const R0CartanMatrix *right)
{
    int row, column;
    if (left->rank != right->rank) return 0;
    for (row = 0; row < left->rank; ++row)
        for (column = 0; column < left->rank; ++column)
            if (CELL(left, row, column) != CELL(right, row, column)) return 0;
    return 1;
}

static int action_equal(const R2Action *left, const R2Action *right)
{
    return left->kind == right->kind && left->first == right->first &&
           left->second == right->second && left->bond == right->bond;
}

static int accepted_add(R2MatrixList *list,
                        const R0CartanMatrix *matrix)
{
    int index;
    for (index = 0; index < list->count; ++index)
        if (matrix_equal(&list->items[index], matrix)) return 0;
    if (list->count >= R2_MAX_TYPES_PER_RANK) return -1;
    list->items[list->count++] = *matrix;
    return 1;
}

static void delete_node(const R0CartanMatrix *source, int removed,
                        R0CartanMatrix *result)
{
    int source_row, source_column, row = 0;
    matrix_diagonal(result, (uint8_t)(source->rank - 1));
    for (source_row = 0; source_row < source->rank; ++source_row) {
        int column = 0;
        if (source_row == removed) continue;
        for (source_column = 0; source_column < source->rank;
             ++source_column) {
            if (source_column == removed) continue;
            CELL(result, row, column++) =
                CELL(source, source_row, source_column);
        }
        ++row;
    }
}

static int generate_actions(const R0CartanMatrix *matrix,
                            R2Action actions[R2_MAX_ACTIONS])
{
    int count = 0, first, second, bond;
    if (matrix->rank > 1) {
        for (first = 0; first < matrix->rank; ++first) {
            actions[count].kind = R2_EDIT_DELETE_NODE;
            actions[count].first = (uint8_t)first;
            actions[count].second = 0;
            actions[count].bond = 0;
            ++count;
        }
    }
    for (first = 0; first < matrix->rank; ++first) {
        for (second = first + 1; second < matrix->rank; ++second) {
            for (bond = 0; bond < 6; ++bond) {
                actions[count].kind = R2_EDIT_SET_BOND;
                actions[count].first = (uint8_t)first;
                actions[count].second = (uint8_t)second;
                actions[count].bond = (uint8_t)bond;
                ++count;
            }
        }
    }
    return count;
}

static R0Status apply_action(const R0CartanMatrix *matrix,
                             const R2Action *action,
                             R0CartanMatrix *canonical, char *error,
                             size_t error_capacity)
{
    R0CartanMatrix edited;
    if (action->kind == R2_EDIT_DELETE_NODE) {
        if (matrix->rank <= 1 || action->first >= matrix->rank)
            return R0_INVALID_ARGUMENT;
        delete_node(matrix, action->first, &edited);
    } else if (action->kind == R2_EDIT_SET_BOND) {
        if (action->first >= matrix->rank || action->second >= matrix->rank ||
            action->first >= action->second || action->bond >= 6)
            return R0_INVALID_ARGUMENT;
        edited = *matrix;
        matrix_edge(&edited, action->first, action->second,
                    R2_BONDS[action->bond][0], R2_BONDS[action->bond][1]);
    } else {
        return R0_INVALID_ARGUMENT;
    }
    return r0_cartan_canonicalize(&edited, canonical, error, error_capacity);
}

static int append_optimal(R2Action *actions, uint8_t *count,
                          const R2Action *action)
{
    int index;
    for (index = 0; index < *count; ++index)
        if (action_equal(&actions[index], action)) return 1;
    if (*count >= R2_MAX_OPTIMAL_ACTIONS) return 0;
    actions[(*count)++] = *action;
    return 1;
}

static R0Status one_step_actions(const R0CartanMatrix *matrix,
                                 R2Action *solutions, uint8_t *solution_count,
                                 char *error, size_t error_capacity)
{
    R2Action actions[R2_MAX_ACTIONS];
    int action_count = generate_actions(matrix, actions);
    int index;
    *solution_count = 0;
    for (index = 0; index < action_count; ++index) {
        R0CartanMatrix candidate;
        R0VerifierObservation observation;
        R0Status status = apply_action(matrix, &actions[index], &candidate,
                                       error, error_capacity);
        if (status != R0_OK) return status;
        if (matrix_equal(matrix, &candidate)) continue;
        status = r0_cartan_verify(&candidate, &observation, error,
                                  error_capacity);
        if (status != R0_OK) return status;
        if (observation.accepted &&
            !append_optimal(solutions, solution_count, &actions[index]))
            return R0_LIMIT_ERROR;
    }
    return R0_OK;
}

static int action_can_address_failure(const R2Action *action,
                                      const R0VerifierObservation *observation)
{
    if (observation->failure != R0_CARTAN_BAD_BOND_PRODUCT &&
        observation->failure != R0_CARTAN_ASYMMETRIC_ZERO &&
        observation->failure != R0_CARTAN_POSITIVE_OFF_DIAGONAL)
        return 1;
    if (action->kind == R2_EDIT_DELETE_NODE)
        return action->first == observation->row ||
               action->first == observation->column;
    return action->first == observation->row &&
           action->second == observation->column;
}

static R0Status two_step_actions(const R0CartanMatrix *matrix,
                                 const R0VerifierObservation *observation,
                                 R2Action *solutions, uint8_t *solution_count,
                                 char *error, size_t error_capacity)
{
    R2Action actions[R2_MAX_ACTIONS];
    int action_count = generate_actions(matrix, actions);
    int index;
    *solution_count = 0;
    for (index = 0; index < action_count; ++index) {
        R0CartanMatrix candidate;
        R0VerifierObservation candidate_observation;
        R2Action next[R2_MAX_OPTIMAL_ACTIONS];
        uint8_t next_count;
        R0Status status;
        if (!action_can_address_failure(&actions[index], observation)) continue;
        status = apply_action(matrix, &actions[index], &candidate, error,
                              error_capacity);
        if (status != R0_OK) return status;
        if (matrix_equal(matrix, &candidate)) continue;
        status = r0_cartan_verify(&candidate, &candidate_observation, error,
                                  error_capacity);
        if (status != R0_OK) return status;
        if (candidate_observation.accepted) continue;
        status = one_step_actions(&candidate, next, &next_count, error,
                                  error_capacity);
        if (status != R0_OK) return status;
        if (next_count > 0 &&
            !append_optimal(solutions, solution_count, &actions[index]))
            return R0_LIMIT_ERROR;
    }
    return R0_OK;
}

static int make_known_type(char family, uint8_t rank,
                           R0CartanMatrix *matrix)
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

static R0Status build_valid_types(uint8_t maximum_rank,
                                  R2MatrixList *ranks, char *error,
                                  size_t error_capacity)
{
    static const char families[] = {'A', 'B', 'C', 'D', 'E', 'F', 'G'};
    uint8_t rank;
    memset(ranks, 0,
           (R0_ENUMERATION_MAX_RANK + 1) * sizeof(*ranks));
    for (rank = 2; rank <= maximum_rank; ++rank) {
        size_t family;
        for (family = 0; family < sizeof(families); ++family) {
            R0CartanMatrix matrix, canonical;
            R0VerifierObservation observation;
            R0Status status;
            int added;
            if (!make_known_type(families[family], rank, &matrix)) continue;
            status = r0_cartan_canonicalize(&matrix, &canonical, error,
                                            error_capacity);
            if (status != R0_OK) return status;
            status = r0_cartan_verify(&canonical, &observation, error,
                                      error_capacity);
            if (status != R0_OK || !observation.accepted) {
                set_error(error, error_capacity,
                          "invalid repair seed at rank %u", (unsigned)rank);
                return R0_VERIFIER_ERROR;
            }
            added = accepted_add(&ranks[rank], &canonical);
            if (added < 0) return R0_LIMIT_ERROR;
        }
    }
    return R0_OK;
}

static R0Status corpus_add_case(R2Corpus *corpus,
                                const R0CartanMatrix *matrix,
                                uint8_t stage_rank, uint8_t expected_distance,
                                char *error, size_t error_capacity);

static R0Status store_case(R2Corpus *corpus,
                           const R0CartanMatrix *canonical,
                           const R0VerifierObservation *observation,
                           uint8_t stage_rank, uint8_t distance,
                           const R2Action *optimal, uint8_t optimal_count,
                           char *error, size_t error_capacity)
{
    R2Case *item;
    int index;
    for (index = 0; index < corpus->count; ++index) {
        if (corpus->cases[index].stage_rank == stage_rank &&
            matrix_equal(&corpus->cases[index].matrix, canonical))
            return R0_OK;
    }
    if (corpus->count >= R2_MAX_CASES) return R0_LIMIT_ERROR;
    item = &corpus->cases[corpus->count++];
    memset(item, 0, sizeof(*item));
    item->matrix = *canonical;
    item->observation = *observation;
    item->stage_rank = stage_rank;
    item->distance = distance;
    item->affine = observation->failure == R0_CARTAN_AFFINE_BOUNDARY;
    item->weight = item->affine ? 8 : distance == 2 ? 4 : 1;
    item->optimal_count = optimal_count;
    memcpy(item->optimal, optimal, optimal_count * sizeof(*optimal));
    if (distance == 1) ++corpus->one_step_cases;
    else ++corpus->two_step_cases;
    if (item->affine) ++corpus->affine_cases;
    if (distance == 2) {
        R0CartanMatrix child;
        R0Status status = apply_action(canonical, &optimal[0], &child, error,
                                       error_capacity);
        if (status != R0_OK) return status;
        status = corpus_add_case(corpus, &child, stage_rank, 1, error,
                                 error_capacity);
        if (status != R0_OK) return status;
    }
    return R0_OK;
}

static R0Status corpus_add_case(R2Corpus *corpus,
                                const R0CartanMatrix *matrix,
                                uint8_t stage_rank, uint8_t expected_distance,
                                char *error, size_t error_capacity)
{
    R0CartanMatrix canonical;
    R0VerifierObservation observation;
    R2Action optimal[R2_MAX_OPTIMAL_ACTIONS];
    uint8_t optimal_count;
    R0Status status;
    int index;
    if (stage_rank < 2 || stage_rank > R0_ENUMERATION_MAX_RANK ||
        (expected_distance != 1 && expected_distance != 2))
        return R0_INVALID_ARGUMENT;
    status = r0_cartan_canonicalize(matrix, &canonical, error, error_capacity);
    if (status != R0_OK) return status;
    for (index = 0; index < corpus->count; ++index) {
        if (corpus->cases[index].stage_rank == stage_rank &&
            matrix_equal(&corpus->cases[index].matrix, &canonical))
            return R0_OK;
    }
    status = r0_cartan_verify(&canonical, &observation, error,
                              error_capacity);
    if (status != R0_OK) return status;
    if (observation.accepted) return R0_OK;
    status = one_step_actions(&canonical, optimal, &optimal_count, error,
                              error_capacity);
    if (status != R0_OK) return status;
    if (optimal_count > 0) {
        if (expected_distance == 2) return R0_OK;
        return store_case(corpus, &canonical, &observation, stage_rank, 1,
                          optimal, optimal_count, error, error_capacity);
    }
    if (expected_distance == 1) {
        set_error(error, error_capacity,
                  "generated rank %u case has no one-edit repair",
                  (unsigned)stage_rank);
        return R0_VERIFIER_ERROR;
    }
    status = two_step_actions(&canonical, &observation, optimal,
                              &optimal_count, error, error_capacity);
    if (status != R0_OK) return status;
    if (optimal_count == 0) {
        set_error(error, error_capacity,
                  "generated rank %u case has no two-edit repair",
                  (unsigned)stage_rank);
        return R0_VERIFIER_ERROR;
    }
    return store_case(corpus, &canonical, &observation, stage_rank, 2,
                      optimal, optimal_count, error, error_capacity);
}

static void affine_cycle(uint8_t rank, R0CartanMatrix *matrix)
{
    int node;
    matrix_diagonal(matrix, rank);
    for (node = 0; node < rank; ++node)
        matrix_edge(matrix, node, (node + 1) % rank, -1, -1);
}

static void extend_leaf(const R0CartanMatrix *base, int attachment, int bond,
                        R0CartanMatrix *candidate)
{
    int row, column;
    matrix_diagonal(candidate, (uint8_t)(base->rank + 1));
    for (row = 0; row < base->rank; ++row)
        for (column = 0; column < base->rank; ++column)
            CELL(candidate, row, column) = CELL(base, row, column);
    matrix_edge(candidate, attachment, base->rank,
                R2_BONDS[bond + 1][0], R2_BONDS[bond + 1][1]);
}

static R0Status build_corpus(uint8_t maximum_rank, R2Corpus *corpus,
                             char *error, size_t error_capacity)
{
    R2MatrixList ranks[R0_ENUMERATION_MAX_RANK + 1];
    uint8_t rank;
    R0Status status;
    if (corpus == NULL || maximum_rank < 2 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    memset(corpus, 0, sizeof(*corpus));
    status = build_valid_types(maximum_rank, ranks, error, error_capacity);
    if (status != R0_OK) return status;
    for (rank = 2; rank <= maximum_rank; ++rank) {
        int type_index;
        for (type_index = 0; type_index < ranks[rank].count; ++type_index) {
            const R0CartanMatrix *valid = &ranks[rank].items[type_index];
            int first, second;
            int edge_first[2] = {-1, -1};
            int edge_second[2] = {-1, -1};
            int edge_count = 0;
            for (first = 0; first < valid->rank; ++first) {
                for (second = first + 1; second < valid->rank; ++second) {
                    R0CartanMatrix corrupted;
                    if (CELL(valid, first, second) == 0) continue;
                    if (edge_count == 0) {
                        edge_first[0] = first;
                        edge_first[1] = second;
                    } else if (edge_count == 1) {
                        edge_second[0] = first;
                        edge_second[1] = second;
                    }
                    ++edge_count;
                    corrupted = *valid;
                    matrix_edge(&corrupted, first, second, -1, -5);
                    status = corpus_add_case(corpus, &corrupted, rank, 1,
                                             error, error_capacity);
                    if (status != R0_OK) return status;
                    corrupted = *valid;
                    matrix_edge(&corrupted, first, second, 0, 0);
                    status = corpus_add_case(corpus, &corrupted, rank, 1,
                                             error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
            if (edge_count >= 2) {
                R0CartanMatrix corrupted = *valid;
                matrix_edge(&corrupted, edge_first[0], edge_first[1], -1, -5);
                matrix_edge(&corrupted, edge_second[0], edge_second[1],
                            -1, -5);
                status = corpus_add_case(corpus, &corrupted, rank, 2, error,
                                         error_capacity);
                if (status != R0_OK) return status;
            }
            for (first = 0; first < valid->rank; ++first) {
                int bond;
                for (bond = 0; bond < 5; ++bond) {
                    R0CartanMatrix candidate;
                    R0VerifierObservation observation;
                    extend_leaf(valid, first, bond, &candidate);
                    status = r0_cartan_verify(&candidate, &observation, error,
                                              error_capacity);
                    if (status != R0_OK) return status;
                    if (observation.failure != R0_CARTAN_AFFINE_BOUNDARY)
                        continue;
                    status = corpus_add_case(corpus, &candidate, rank, 1,
                                             error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
        }
        if (rank >= 3) {
            R0CartanMatrix cycle;
            affine_cycle(rank, &cycle);
            status = corpus_add_case(corpus, &cycle, rank, 1, error,
                                     error_capacity);
            if (status != R0_OK) return status;
        }
    }
    {
        R0CartanMatrix affine_a1;
        matrix_diagonal(&affine_a1, 2);
        matrix_edge(&affine_a1, 0, 1, -2, -2);
        status = corpus_add_case(corpus, &affine_a1, 2, 1, error,
                                 error_capacity);
        if (status != R0_OK) return status;
    }
    return R0_OK;
}

static uint64_t hash_mix(uint64_t hash, uint64_t value)
{
    int byte;
    for (byte = 0; byte < 8; ++byte) {
        hash ^= (unsigned char)(value >> (byte * 8));
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static uint64_t token_hash(uint64_t tag, uint64_t a, uint64_t b, uint64_t c)
{
    uint64_t hash = UINT64_C(1469598103934665603);
    hash = hash_mix(hash, tag);
    hash = hash_mix(hash, a);
    hash = hash_mix(hash, b);
    return hash_mix(hash, c);
}

static int compare_u64(const void *left, const void *right)
{
    uint64_t a = *(const uint64_t *)left;
    uint64_t b = *(const uint64_t *)right;
    return a < b ? -1 : a > b;
}

static void feature_add_index(R2FeatureVector *features, uint16_t index,
                              int value)
{
    int position;
    for (position = 0; position < features->count; ++position) {
        if (features->indices[position] == index) {
            features->values[position] =
                (int16_t)(features->values[position] + value);
            return;
        }
    }
    if (features->count >= R2_MAX_ACTIVE_FEATURES) return;
    features->indices[features->count] = index;
    features->values[features->count] = (int16_t)value;
    ++features->count;
}

static void feature_add(R2FeatureVector *features, uint64_t hash, int value)
{
    uint16_t index =
        (uint16_t)(1U + hash % (uint64_t)(R2_FEATURE_COUNT - 1));
    feature_add_index(features, index, value);
}

static uint64_t initial_node_color(const R0CartanMatrix *matrix, int node)
{
    uint64_t incident[R0_MAX_RANK];
    uint64_t color = token_hash(10, 0, 0, 0);
    int count = 0, other;
    for (other = 0; other < matrix->rank; ++other) {
        int left, right, product;
        if (other == node || CELL(matrix, node, other) == 0) continue;
        left = -CELL(matrix, node, other);
        right = -CELL(matrix, other, node);
        product = left * right;
        incident[count++] =
            product >= 0 && product <= 4
                ? (uint64_t)(left * 8 + right)
                : UINT64_C(63);
    }
    qsort(incident, count, sizeof(incident[0]), compare_u64);
    color = hash_mix(color, (uint64_t)count);
    for (other = 0; other < count; ++other)
        color = hash_mix(color, incident[other]);
    return color;
}

static void graph_features(const R0CartanMatrix *matrix,
                           const R2Action *action, uint64_t graph_tag,
                           R2FeatureVector *features)
{
    uint64_t colors[R0_MAX_RANK], next[R0_MAX_RANK];
    int node, round;
    for (node = 0; node < matrix->rank; ++node)
        colors[node] = initial_node_color(matrix, node);
    for (round = 0; round < R2_GRAPH_ROUNDS; ++round) {
        uint64_t sorted[R0_MAX_RANK];
        for (node = 0; node < matrix->rank; ++node) sorted[node] = colors[node];
        qsort(sorted, matrix->rank, sizeof(sorted[0]), compare_u64);
        for (node = 0; node < matrix->rank; ++node)
            feature_add(features,
                        token_hash(graph_tag + 20U, (uint64_t)round,
                                   sorted[node], 0),
                        1);
        if (action != NULL) {
            feature_add(features,
                        token_hash(graph_tag + 21U, (uint64_t)round,
                                   colors[action->first], action->kind),
                        1);
            if (action->kind == R2_EDIT_SET_BOND)
                feature_add(features,
                            token_hash(graph_tag + 22U, (uint64_t)round,
                                       colors[action->second], action->bond),
                            1);
        }
        for (node = 0; node < matrix->rank; ++node) {
            uint64_t neighbors[R0_MAX_RANK];
            int count = 0, other;
            for (other = 0; other < matrix->rank; ++other) {
                int left, right, product;
                uint64_t edge_color;
                if (other == node || CELL(matrix, node, other) == 0) continue;
                left = -CELL(matrix, node, other);
                right = -CELL(matrix, other, node);
                product = left * right;
                edge_color = product >= 0 && product <= 4
                                 ? (uint64_t)(left * 8 + right)
                                 : UINT64_C(63);
                neighbors[count++] = token_hash(30, colors[other], edge_color,
                                                 0);
            }
            qsort(neighbors, count, sizeof(neighbors[0]), compare_u64);
            next[node] = token_hash(31, (uint64_t)round, colors[node], count);
            for (other = 0; other < count; ++other)
                next[node] = hash_mix(next[node], neighbors[other]);
        }
        for (node = 0; node < matrix->rank; ++node) colors[node] = next[node];
    }
}

static int component_labels(const R0CartanMatrix *matrix,
                            uint8_t labels[R0_MAX_RANK])
{
    uint8_t queue[R0_MAX_RANK];
    int components = 0, node;
    memset(labels, UINT8_MAX, R0_MAX_RANK);
    for (node = 0; node < matrix->rank; ++node) {
        int head = 0, tail = 0;
        if (labels[node] != UINT8_MAX) continue;
        labels[node] = (uint8_t)components;
        queue[tail++] = (uint8_t)node;
        while (head < tail) {
            int current = queue[head++], other;
            for (other = 0; other < matrix->rank; ++other) {
                if (CELL(matrix, current, other) == 0 ||
                    labels[other] != UINT8_MAX)
                    continue;
                labels[other] = (uint8_t)components;
                queue[tail++] = (uint8_t)other;
            }
        }
        ++components;
    }
    return components;
}

static void encode_features(const R0CartanMatrix *matrix,
                            const R0VerifierObservation *observation,
                            const R2Action *action,
                            const R0CartanMatrix *candidate,
                            int mask_feedback, R2FeatureVector *features)
{
    R0VerifierObservation masked;
    const R0VerifierObservation *feedback = observation;
    uint8_t labels[R0_MAX_RANK];
    int components;
    int determinant_sign;
    memset(features, 0, sizeof(*features));
    feature_add_index(features, 0, 1);
    if (mask_feedback) {
        memset(&masked, 0, sizeof(masked));
        masked.failure = R0_CARTAN_VALID;
        masked.row = UINT8_MAX;
        masked.column = UINT8_MAX;
        masked.determinant = 1;
        feedback = &masked;
    }
    determinant_sign = feedback->determinant < 0
                           ? -1
                           : feedback->determinant > 0 ? 1 : 0;
    feature_add(features,
                token_hash(50, action->kind, action->bond, 0), 1);
    feature_add(features,
                token_hash(51, feedback->failure, action->kind,
                           action->bond),
                1);
    feature_add(features, token_hash(52, 0, 0, 0), matrix->rank);
    feature_add(features,
                token_hash(53, (uint64_t)(determinant_sign + 1),
                           feedback->failure, 0),
                1);
    feature_add(features,
                token_hash(54,
                           action->first == feedback->row ||
                               action->first == feedback->column,
                           action->kind, feedback->failure),
                1);
    if (action->kind == R2_EDIT_SET_BOND) {
        int exact_pair = action->first == feedback->row &&
                         action->second == feedback->column;
        int both_in_mask =
            (feedback->principal_mask & (UINT16_C(1) << action->first)) != 0 &&
            (feedback->principal_mask & (UINT16_C(1) << action->second)) != 0;
        feature_add(features,
                    token_hash(55, exact_pair, both_in_mask, action->bond), 1);
    } else {
        int in_mask =
            (feedback->principal_mask & (UINT16_C(1) << action->first)) != 0;
        feature_add(features,
                    token_hash(56, in_mask, feedback->failure, 0), 1);
    }
    components = component_labels(matrix, labels);
    feature_add(features, token_hash(57, action->kind, 0, 0), components);
    if (action->kind == R2_EDIT_SET_BOND)
        feature_add(features,
                    token_hash(58,
                               labels[action->first] != labels[action->second],
                               action->bond, components),
                    1);
    graph_features(matrix, action, 100, features);
    graph_features(candidate, NULL, 200, features);
}

static int64_t model_score(const R2Model *model,
                           const R2FeatureVector *features)
{
    int64_t score = 0;
    int index;
    for (index = 0; index < features->count; ++index)
        score += (int64_t)model->weights[features->indices[index]] *
                 features->values[index];
    return score;
}

static int action_is_optimal(const R2Case *item, const R2Action *action)
{
    int index;
    for (index = 0; index < item->optimal_count; ++index)
        if (action_equal(&item->optimal[index], action)) return 1;
    return 0;
}

static R0Status select_action(const R2Model *model,
                              const R0CartanMatrix *matrix,
                              const R0VerifierObservation *observation,
                              int mask_feedback, R2Action *selected,
                              R2FeatureVector *selected_features,
                              char *error, size_t error_capacity)
{
    R2Action actions[R2_MAX_ACTIONS];
    int action_count = generate_actions(matrix, actions);
    int64_t best_score = INT64_MIN;
    int index, found = 0;
    for (index = 0; index < action_count; ++index) {
        R0CartanMatrix candidate;
        R2FeatureVector features;
        int64_t score;
        R0Status status = apply_action(matrix, &actions[index], &candidate,
                                       error, error_capacity);
        if (status != R0_OK) return status;
        if (matrix_equal(matrix, &candidate)) continue;
        encode_features(matrix, observation, &actions[index], &candidate,
                        mask_feedback, &features);
        score = model_score(model, &features);
        if (!found || score > best_score) {
            best_score = score;
            *selected = actions[index];
            if (selected_features != NULL) *selected_features = features;
            found = 1;
        }
    }
    return found ? R0_OK : R0_LIMIT_ERROR;
}

static R0Status best_optimal_action(const R2Model *model, const R2Case *item,
                                    R2Action *selected,
                                    R2FeatureVector *selected_features,
                                    char *error, size_t error_capacity)
{
    int64_t best_score = INT64_MIN;
    int index;
    for (index = 0; index < item->optimal_count; ++index) {
        R0CartanMatrix candidate;
        R2FeatureVector features;
        int64_t score;
        R0Status status = apply_action(&item->matrix, &item->optimal[index],
                                       &candidate, error, error_capacity);
        if (status != R0_OK) return status;
        encode_features(&item->matrix, &item->observation,
                        &item->optimal[index], &candidate, 0, &features);
        score = model_score(model, &features);
        if (index == 0 || score > best_score) {
            best_score = score;
            *selected = item->optimal[index];
            *selected_features = features;
        }
    }
    return R0_OK;
}

static R0Status train_pass(R2Model *model, const R2Corpus *corpus,
                           uint8_t stage, uint32_t *updates, char *error,
                           size_t error_capacity)
{
    int index;
    *updates = 0;
    for (index = 0; index < corpus->count; ++index) {
        const R2Case *item = &corpus->cases[index];
        R2Action predicted, correct;
        R2FeatureVector predicted_features, correct_features;
        R0Status status;
        int feature;
        if (item->stage_rank > stage) continue;
        status = select_action(model, &item->matrix, &item->observation, 0,
                               &predicted, &predicted_features, error,
                               error_capacity);
        if (status != R0_OK) return status;
        if (action_is_optimal(item, &predicted)) continue;
        status = best_optimal_action(model, item, &correct, &correct_features,
                                     error, error_capacity);
        if (status != R0_OK) return status;
        for (feature = 0; feature < correct_features.count; ++feature)
            model->weights[correct_features.indices[feature]] +=
                item->weight * correct_features.values[feature];
        for (feature = 0; feature < predicted_features.count; ++feature)
            model->weights[predicted_features.indices[feature]] -=
                item->weight * predicted_features.values[feature];
        ++*updates;
    }
    return R0_OK;
}

static R0Status action_errors(const R2Model *model, const R2Corpus *corpus,
                              uint8_t stage, uint32_t *errors, char *error,
                              size_t error_capacity)
{
    int index;
    *errors = 0;
    for (index = 0; index < corpus->count; ++index) {
        const R2Case *item = &corpus->cases[index];
        R2Action predicted;
        R0Status status;
        if (item->stage_rank > stage) continue;
        status = select_action(model, &item->matrix, &item->observation, 0,
                               &predicted, NULL, error, error_capacity);
        if (status != R0_OK) return status;
        if (!action_is_optimal(item, &predicted)) ++*errors;
    }
    return R0_OK;
}

static R0Status evaluate_corpus(const R2Model *model, const R2Corpus *corpus,
                                uint8_t minimum_rank, uint8_t maximum_rank,
                                int mask_feedback, R2EvaluationReport *report,
                                char *error, size_t error_capacity)
{
    int index;
    memset(report, 0, sizeof(*report));
    report->minimum_rank = minimum_rank;
    report->maximum_rank = maximum_rank;
    report->feedback_masked = (uint8_t)mask_feedback;
    for (index = 0; index < corpus->count; ++index) {
        const R2Case *item = &corpus->cases[index];
        R0CartanMatrix current, visited[R2_MAX_REPAIR_STEPS + 1];
        R0VerifierObservation observation;
        int step, solved = 0;
        if (item->stage_rank < minimum_rank ||
            item->stage_rank > maximum_rank)
            continue;
        ++report->cases;
        current = item->matrix;
        observation = item->observation;
        visited[0] = current;
        for (step = 0; step < R2_MAX_REPAIR_STEPS; ++step) {
            R2Action action;
            R0CartanMatrix candidate;
            R0VerifierObservation next_observation;
            R0Status status = select_action(
                model, &current, &observation, mask_feedback, &action, NULL,
                error, error_capacity);
            int prior;
            if (status != R0_OK) return status;
            status = apply_action(&current, &action, &candidate, error,
                                  error_capacity);
            if (status != R0_OK) return status;
            for (prior = 0; prior <= step; ++prior) {
                if (matrix_equal(&visited[prior], &candidate)) {
                    ++report->repeated_states;
                    break;
                }
            }
            visited[step + 1] = candidate;
            ++report->verifier_calls;
            status = r0_cartan_verify(&candidate, &next_observation, error,
                                      error_capacity);
            if (status != R0_OK) return status;
            if (next_observation.accepted) {
                int edits = step + 1;
                ++report->solved;
                if (edits == item->distance) ++report->optimal;
                else if (edits > item->distance)
                    report->excess_edits += edits - item->distance;
                solved = 1;
                break;
            }
            current = candidate;
            observation = next_observation;
        }
        if (!solved) ++report->failed;
    }
    if (report->cases > 0) {
        report->success_milli =
            (uint32_t)(((uint64_t)report->solved * 1000U) / report->cases);
        report->optimal_milli =
            (uint32_t)(((uint64_t)report->optimal * 1000U) / report->cases);
    }
    report->exact =
        (uint8_t)(report->cases > 0 && report->solved == report->cases &&
                  report->optimal == report->cases &&
                  report->repeated_states == 0);
    return R0_OK;
}

void r2_model_init(R2Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

R0Status r2_evaluate(const R2Model *model, uint8_t minimum_rank,
                     uint8_t maximum_rank, int mask_feedback,
                     R2EvaluationReport *report, char *error,
                     size_t error_capacity)
{
    R2Corpus corpus;
    R0Status status;
    if (model == NULL || report == NULL || minimum_rank < 2 ||
        maximum_rank < minimum_rank ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    if (model->trained_rank < maximum_rank) {
        set_error(error, error_capacity,
                  "model is trained only through rank %u",
                  (unsigned)model->trained_rank);
        return R0_POLICY_ERROR;
    }
    status = build_corpus(maximum_rank, &corpus, error, error_capacity);
    if (status != R0_OK) return status;
    return evaluate_corpus(model, &corpus, minimum_rank, maximum_rank,
                           mask_feedback, report, error, error_capacity);
}

R0Status r2_train(R2Model *model, uint8_t maximum_rank,
                  R2TrainingReport *report, char *error,
                  size_t error_capacity)
{
    R2Corpus corpus;
    uint8_t stage;
    R0Status status;
    if (model == NULL || report == NULL || maximum_rank < 2 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    r2_model_init(model);
    memset(report, 0, sizeof(*report));
    status = build_corpus(maximum_rank, &corpus, error, error_capacity);
    if (status != R0_OK) return status;
    report->cases = corpus.count;
    report->one_step_cases = corpus.one_step_cases;
    report->two_step_cases = corpus.two_step_cases;
    report->affine_cases = corpus.affine_cases;
    for (stage = 2; stage <= maximum_rank; ++stage) {
        uint32_t epoch, errors = UINT32_MAX;
        for (epoch = 0; epoch < R2_MAX_STAGE_EPOCHS; ++epoch) {
            uint32_t updates;
            status = train_pass(model, &corpus, stage, &updates, error,
                                error_capacity);
            if (status != R0_OK) return status;
            ++model->trained_epochs;
            model->training_mistakes += updates;
            status = action_errors(model, &corpus, stage, &errors, error,
                                   error_capacity);
            if (status != R0_OK) return status;
            if (errors == 0) break;
        }
        model->trained_rank = stage;
        if (errors != 0) {
            set_error(error, error_capacity,
                      "rank %u repair actions retain %u errors",
                      (unsigned)stage, errors);
            report->final_action_errors = errors;
            return R0_POLICY_ERROR;
        }
        if (stage == 7 && maximum_rank >= 8) {
            R2EvaluationReport holdout, ablation;
            status = evaluate_corpus(model, &corpus, 8, 8, 0, &holdout,
                                     error, error_capacity);
            if (status != R0_OK) return status;
            status = evaluate_corpus(model, &corpus, 8, 8, 1, &ablation,
                                     error, error_capacity);
            if (status != R0_OK) return status;
            report->rank8_holdout_cases = holdout.cases;
            report->rank8_holdout_solved = holdout.solved;
            report->rank8_holdout_optimal = holdout.optimal;
            report->rank8_holdout_success_milli = holdout.success_milli;
            report->rank8_holdout_optimal_milli = holdout.optimal_milli;
            report->rank8_holdout_repeated_states = holdout.repeated_states;
            report->rank8_ablation_solved = ablation.solved;
            report->rank8_ablation_optimal = ablation.optimal;
            report->rank8_ablation_success_milli = ablation.success_milli;
            report->rank8_ablation_optimal_milli = ablation.optimal_milli;
            report->rank8_holdout_exact = holdout.exact;
            report->feedback_ablation_collapsed =
                (uint8_t)(ablation.optimal_milli + 100U <=
                          holdout.optimal_milli);
        }
        {
            R2EvaluationReport gate;
            status = evaluate_corpus(model, &corpus, 2, stage, 0, &gate,
                                     error, error_capacity);
            if (status != R0_OK) return status;
            if (!gate.exact) {
                set_error(error, error_capacity,
                          "rank %u repair rollout gate failed",
                          (unsigned)stage);
                return R0_POLICY_ERROR;
            }
        }
        ++report->curriculum_promotions;
    }
    report->epochs = model->trained_epochs;
    report->mistakes = model->training_mistakes;
    report->trained_rank = model->trained_rank;
    status = action_errors(model, &corpus, maximum_rank,
                           &report->final_action_errors, error,
                           error_capacity);
    if (status != R0_OK) return status;
    return report->final_action_errors == 0 ? R0_OK : R0_POLICY_ERROR;
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

R0Status r2_model_save(const R2Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '2', 'R', 'P', 'A', 'I', 'R', '\0'};
    R2EvaluationReport evaluation;
    char *temporary;
    size_t path_length;
    FILE *file;
    int index;
    R0Status status;
    if (model == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    status = r2_evaluate(model, 2, model->trained_rank, 0, &evaluation, error,
                         error_capacity);
    if (status != R0_OK || !evaluation.exact) {
        set_error(error, error_capacity,
                  "only an exact Reasoner-2 model can be saved");
        return R0_POLICY_ERROR;
    }
    path_length = strlen(path);
    temporary = malloc(path_length + 5U);
    if (temporary == NULL) return R0_IO_ERROR;
    (void)snprintf(temporary, path_length + 5U, "%s.tmp", path);
    file = fopen(temporary, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "could not create %s: %s",
                  temporary, strerror(errno));
        free(temporary);
        return R0_IO_ERROR;
    }
    if (fwrite(magic, 1, sizeof(magic), file) != sizeof(magic) ||
        !write_u32(file, R2_MODEL_VERSION) ||
        !write_u32(file, R2_FEATURE_COUNT) ||
        !write_u32(file, model->trained_epochs) ||
        !write_u32(file, model->training_mistakes) ||
        !write_u32(file, model->trained_rank)) {
        (void)fclose(file);
        (void)remove(temporary);
        free(temporary);
        return R0_IO_ERROR;
    }
    for (index = 0; index < R2_FEATURE_COUNT; ++index) {
        if (!write_u32(file, (uint32_t)model->weights[index])) {
            (void)fclose(file);
            (void)remove(temporary);
            free(temporary);
            return R0_IO_ERROR;
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

R0Status r2_model_load(R2Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '2', 'R', 'P', 'A', 'I', 'R', '\0'};
    unsigned char read_magic[8];
    uint32_t version, feature_count, trained_rank;
    R2EvaluationReport evaluation;
    FILE *file;
    int index;
    if (model == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "rb");
    if (file == NULL) {
        set_error(error, error_capacity, "could not open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    r2_model_init(model);
    if (fread(read_magic, 1, sizeof(read_magic), file) != sizeof(read_magic) ||
        memcmp(read_magic, magic, sizeof(magic)) != 0 ||
        !read_u32(file, &version) || !read_u32(file, &feature_count) ||
        !read_u32(file, &model->trained_epochs) ||
        !read_u32(file, &model->training_mistakes) ||
        !read_u32(file, &trained_rank) || version != R2_MODEL_VERSION ||
        feature_count != R2_FEATURE_COUNT || trained_rank < 2 ||
        trained_rank > R0_ENUMERATION_MAX_RANK) {
        (void)fclose(file);
        set_error(error, error_capacity, "%s is not a Reasoner-2 model", path);
        return R0_POLICY_ERROR;
    }
    model->trained_rank = (uint8_t)trained_rank;
    for (index = 0; index < R2_FEATURE_COUNT; ++index) {
        uint32_t value;
        if (!read_u32(file, &value)) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
        model->weights[index] = signed_from_u32(value);
    }
    if (fgetc(file) != EOF || fclose(file) != 0) return R0_IO_ERROR;
    if (r2_evaluate(model, 2, model->trained_rank, 0, &evaluation, error,
                    error_capacity) != R0_OK ||
        !evaluation.exact) {
        set_error(error, error_capacity,
                  "%s does not pass its repair curriculum", path);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}
