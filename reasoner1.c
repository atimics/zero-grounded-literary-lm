#include "reasoner1.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R1_MAX_TYPES_PER_RANK 8
#define R1_MAX_PROPOSALS_PER_RANK 512
#define R1_MAX_EXAMPLES 768
#define R1_AFFINE_WEIGHT 8
#define R1_POSITIVE_WEIGHT 4
#define R1_MODEL_VERSION 1U
#define CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

typedef struct {
    uint8_t count;
    R0CartanMatrix items[R1_MAX_TYPES_PER_RANK];
} R1MatrixList;

typedef struct {
    uint16_t count;
    R0CartanMatrix items[R1_MAX_PROPOSALS_PER_RANK];
} R1ProposalSet;

typedef struct {
    R0CartanMatrix base;
    R0CartanMatrix candidate;
    R0VerifierObservation observation;
    uint8_t attachment;
    uint8_t bond;
    uint8_t stage_rank;
    uint8_t accepted;
    uint8_t weight;
} R1Example;

typedef struct {
    uint16_t count;
    R1Example examples[R1_MAX_EXAMPLES];
    uint32_t positives;
    uint32_t negatives;
    uint32_t affine_negatives;
    uint32_t weighted_examples;
} R1Corpus;

typedef struct {
    uint16_t count;
    uint16_t indices[R1_MAX_ACTIVE_FEATURES];
    int16_t values[R1_MAX_ACTIVE_FEATURES];
} R1FeatureVector;

static const int8_t R1_BONDS[R1_BOND_ACTIONS][2] = {
    {-1, -1}, {-1, -2}, {-2, -1}, {-1, -3}, {-3, -1},
};

static const uint8_t R1_EXPECTED_COUNTS[R0_ENUMERATION_MAX_RANK + 1] = {
    0, 1, 3, 3, 5, 4, 5, 5, 5,
};

static const char *const R1_EXPECTED_TYPES[R0_ENUMERATION_MAX_RANK + 1] = {
    "", "A1", "A2,B2/C2,G2", "A3,B3,C3",
    "A4,B4,C4,D4,F4", "A5,B5,C5,D5", "A6,B6,C6,D6,E6",
    "A7,B7,C7,D7,E7", "A8,B8,C8,D8,E8",
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

static int proposal_add(R1ProposalSet *set,
                        const R0CartanMatrix *matrix)
{
    int index;
    for (index = 0; index < set->count; ++index)
        if (matrix_equal(&set->items[index], matrix)) return 0;
    if (set->count >= R1_MAX_PROPOSALS_PER_RANK) return -1;
    set->items[set->count++] = *matrix;
    return 1;
}

static int accepted_add(R1MatrixList *list,
                        const R0CartanMatrix *matrix)
{
    int index;
    for (index = 0; index < list->count; ++index)
        if (matrix_equal(&list->items[index], matrix)) return 0;
    if (list->count >= R1_MAX_TYPES_PER_RANK) return -1;
    list->items[list->count++] = *matrix;
    return 1;
}

static void extend_leaf(const R0CartanMatrix *base, int attachment, int bond,
                        R0CartanMatrix *candidate)
{
    int row, column;
    matrix_diagonal(candidate, (uint8_t)(base->rank + 1));
    for (row = 0; row < base->rank; ++row)
        for (column = 0; column < base->rank; ++column)
            CELL(candidate, row, column) = CELL(base, row, column);
    matrix_edge(candidate, attachment, base->rank, R1_BONDS[bond][0],
                R1_BONDS[bond][1]);
}

static R0Status corpus_add(R1Corpus *corpus, const R0CartanMatrix *base,
                           const R0CartanMatrix *candidate,
                           const R0VerifierObservation *observation,
                           uint8_t attachment, uint8_t bond,
                           uint8_t stage_rank)
{
    R1Example *example;
    if (corpus->count >= R1_MAX_EXAMPLES) return R0_LIMIT_ERROR;
    example = &corpus->examples[corpus->count++];
    memset(example, 0, sizeof(*example));
    example->base = *base;
    example->candidate = *candidate;
    example->observation = *observation;
    example->attachment = attachment;
    example->bond = bond;
    example->stage_rank = stage_rank;
    example->accepted = observation->accepted;
    example->weight = observation->accepted
                          ? R1_POSITIVE_WEIGHT
                          : observation->failure == R0_CARTAN_AFFINE_BOUNDARY
                                ? R1_AFFINE_WEIGHT
                                : 1;
    corpus->weighted_examples += example->weight;
    if (example->accepted) ++corpus->positives;
    else {
        ++corpus->negatives;
        if (observation->failure == R0_CARTAN_AFFINE_BOUNDARY)
            ++corpus->affine_negatives;
    }
    return R0_OK;
}

static R0Status collect_candidate(R1Corpus *corpus,
                                  const R0CartanMatrix *base,
                                  uint8_t attachment, uint8_t bond,
                                  uint8_t stage_rank, int keep_positive,
                                  R1ProposalSet *seen,
                                  R1MatrixList *accepted, char *error,
                                  size_t error_capacity)
{
    R0CartanMatrix candidate, canonical;
    R0VerifierObservation observation;
    R0Status status;
    int added;
    extend_leaf(base, attachment, bond, &candidate);
    status = r0_cartan_canonicalize(&candidate, &canonical, error,
                                    error_capacity);
    if (status != R0_OK) return status;
    added = proposal_add(seen, &canonical);
    if (added < 0) return R0_LIMIT_ERROR;
    if (added == 0) return R0_OK;
    status = r0_cartan_verify(&canonical, &observation, error,
                              error_capacity);
    if (status != R0_OK) return status;
    if (observation.accepted && keep_positive) {
        added = accepted_add(accepted, &canonical);
        if (added < 0) return R0_LIMIT_ERROR;
    }
    if (!observation.accepted || keep_positive)
        return corpus_add(corpus, base, &canonical, &observation, attachment,
                          bond, stage_rank);
    return R0_OK;
}

static R0Status build_corpus(uint8_t maximum_rank, R1Corpus *corpus,
                             char *error, size_t error_capacity)
{
    R1MatrixList ranks[R0_ENUMERATION_MAX_RANK + 1];
    uint8_t rank;
    if (corpus == NULL || maximum_rank < 2 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    memset(corpus, 0, sizeof(*corpus));
    memset(ranks, 0, sizeof(ranks));
    matrix_diagonal(&ranks[1].items[0], 1);
    ranks[1].count = 1;
    for (rank = 2; rank <= maximum_rank; ++rank) {
        R1ProposalSet seen;
        int base_index;
        memset(&seen, 0, sizeof(seen));
        for (base_index = 0; base_index < ranks[rank - 1].count;
             ++base_index) {
            const R0CartanMatrix *base = &ranks[rank - 1].items[base_index];
            int attachment, bond;
            for (attachment = 0; attachment < base->rank; ++attachment) {
                for (bond = 0; bond < R1_BOND_ACTIONS; ++bond) {
                    R0Status status = collect_candidate(
                        corpus, base, (uint8_t)attachment, (uint8_t)bond,
                        rank, 1, &seen, &ranks[rank], error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
        }
        if (ranks[rank].count != R1_EXPECTED_COUNTS[rank]) {
            set_error(error, error_capacity,
                      "oracle census failed at rank %u", (unsigned)rank);
            return R0_VERIFIER_ERROR;
        }
    }
    if (maximum_rank == R0_ENUMERATION_MAX_RANK) {
        R1ProposalSet seen;
        int base_index;
        memset(&seen, 0, sizeof(seen));
        for (base_index = 0; base_index < ranks[maximum_rank].count;
             ++base_index) {
            const R0CartanMatrix *base = &ranks[maximum_rank].items[base_index];
            int attachment, bond;
            for (attachment = 0; attachment < base->rank; ++attachment) {
                for (bond = 0; bond < R1_BOND_ACTIONS; ++bond) {
                    R0Status status = collect_candidate(
                        corpus, base, (uint8_t)attachment, (uint8_t)bond,
                        maximum_rank, 0, &seen, NULL, error, error_capacity);
                    if (status != R0_OK) return status;
                }
            }
        }
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

static void feature_add_index(R1FeatureVector *features, uint16_t index,
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
    if (features->count >= R1_MAX_ACTIVE_FEATURES) return;
    features->indices[features->count] = index;
    features->values[features->count] = (int16_t)value;
    ++features->count;
}

static void feature_add(R1FeatureVector *features, uint64_t hash, int value)
{
    uint16_t index =
        (uint16_t)(1U + hash % (uint64_t)(R1_FEATURE_COUNT - 1));
    feature_add_index(features, index, value);
}

static int compare_u64(const void *left, const void *right)
{
    uint64_t a = *(const uint64_t *)left;
    uint64_t b = *(const uint64_t *)right;
    return a < b ? -1 : a > b;
}

static uint64_t initial_node_color(const R0CartanMatrix *matrix, int node)
{
    uint64_t incident[R0_MAX_RANK];
    uint64_t color = token_hash(10, 0, 0, 0);
    int count = 0, other;
    for (other = 0; other < matrix->rank; ++other) {
        int outgoing, incoming;
        if (other == node || CELL(matrix, node, other) == 0) continue;
        outgoing = -CELL(matrix, node, other);
        incoming = -CELL(matrix, other, node);
        incident[count++] = (uint64_t)(outgoing * 8 + incoming);
    }
    qsort(incident, count, sizeof(incident[0]), compare_u64);
    color = hash_mix(color, (uint64_t)count);
    for (other = 0; other < count; ++other)
        color = hash_mix(color, incident[other]);
    return color;
}

static void graph_features(const R0CartanMatrix *matrix, int selected,
                           uint8_t bond, uint64_t graph_tag,
                           R1FeatureVector *features)
{
    uint64_t colors[R0_MAX_RANK], next[R0_MAX_RANK];
    int node, round;
    for (node = 0; node < matrix->rank; ++node)
        colors[node] = initial_node_color(matrix, node);
    for (round = 0; round < R1_GRAPH_ROUNDS; ++round) {
        uint64_t sorted[R0_MAX_RANK];
        for (node = 0; node < matrix->rank; ++node) sorted[node] = colors[node];
        qsort(sorted, matrix->rank, sizeof(sorted[0]), compare_u64);
        for (node = 0; node < matrix->rank; ++node)
            feature_add(features,
                        token_hash(graph_tag + 20U, (uint64_t)round,
                                   sorted[node], 0),
                        1);
        if (selected >= 0)
            feature_add(features,
                        token_hash(graph_tag + 21U, (uint64_t)round,
                                   colors[selected], bond),
                        1);
        for (node = 0; node < matrix->rank; ++node) {
            uint64_t neighbors[R0_MAX_RANK];
            int count = 0, other;
            for (other = 0; other < matrix->rank; ++other) {
                int outgoing, incoming;
                if (other == node || CELL(matrix, node, other) == 0) continue;
                outgoing = -CELL(matrix, node, other);
                incoming = -CELL(matrix, other, node);
                neighbors[count++] =
                    token_hash(30, colors[other], (uint64_t)outgoing,
                               (uint64_t)incoming);
            }
            qsort(neighbors, count, sizeof(neighbors[0]), compare_u64);
            next[node] = token_hash(31, (uint64_t)round, colors[node], count);
            for (other = 0; other < count; ++other)
                next[node] = hash_mix(next[node], neighbors[other]);
        }
        for (node = 0; node < matrix->rank; ++node) colors[node] = next[node];
    }
}

static void distance_features(const R0CartanMatrix *matrix, int selected,
                              uint8_t bond, R1FeatureVector *features)
{
    uint8_t distance[R0_MAX_RANK];
    uint8_t queue[R0_MAX_RANK];
    int head = 0, tail = 0, node;
    memset(distance, UINT8_MAX, sizeof(distance));
    distance[selected] = 0;
    queue[tail++] = (uint8_t)selected;
    while (head < tail) {
        int current = queue[head++], other;
        for (other = 0; other < matrix->rank; ++other) {
            if (CELL(matrix, current, other) == 0 ||
                distance[other] != UINT8_MAX)
                continue;
            distance[other] = (uint8_t)(distance[current] + 1);
            queue[tail++] = (uint8_t)other;
        }
    }
    for (node = 0; node < matrix->rank; ++node) {
        int degree = 0, other;
        for (other = 0; other < matrix->rank; ++other)
            if (other != node && CELL(matrix, node, other) != 0) ++degree;
        feature_add(features,
                    token_hash(40, distance[node], (uint64_t)degree, bond), 1);
    }
}

static void encode_features(const R0CartanMatrix *base,
                            const R0CartanMatrix *candidate,
                            uint8_t attachment, uint8_t bond,
                            R0CartanFailure feedback,
                            R1FeatureVector *features)
{
    int column, degree = 0;
    memset(features, 0, sizeof(*features));
    feature_add_index(features, 0, 1);
    for (column = 0; column < base->rank; ++column)
        if (column != attachment && CELL(base, attachment, column) != 0)
            ++degree;
    feature_add(features, token_hash(50, bond, degree, 0), 1);
    feature_add(features, token_hash(56, 0, 0, 0), base->rank);
    feature_add(features,
                token_hash(51, (uint64_t)feedback, bond, 0), 1);
    graph_features(base, attachment, bond, 100, features);
    graph_features(candidate, -1, bond, 200, features);
    distance_features(base, attachment, bond, features);
}

static int64_t model_score(const R1Model *model,
                           const R1FeatureVector *features)
{
    int64_t score = 0;
    int index;
    for (index = 0; index < features->count; ++index)
        score += (int64_t)model->weights[features->indices[index]] *
                 features->values[index];
    return score;
}

static int train_pass(R1Model *model, const R1Corpus *corpus, uint8_t stage,
                      uint32_t *updates)
{
    R0CartanFailure feedback = R0_CARTAN_VALID;
    uint8_t current_rank = 0;
    int index;
    *updates = 0;
    for (index = 0; index < corpus->count; ++index) {
        const R1Example *example = &corpus->examples[index];
        R1FeatureVector features;
        int64_t score;
        int target, predicted, acted, feature;
        if (example->stage_rank > stage) continue;
        if (current_rank != example->stage_rank) {
            current_rank = example->stage_rank;
            feedback = R0_CARTAN_VALID;
        }
        encode_features(&example->base, &example->candidate,
                        example->attachment, example->bond, feedback,
                        &features);
        score = model_score(model, &features);
        target = example->accepted ? 1 : -1;
        predicted = score >= 0;
        acted = predicted || example->accepted;
        if ((target > 0 && score <= 0) || (target < 0 && score >= 0)) {
            for (feature = 0; feature < features.count; ++feature) {
                uint16_t weight_index = features.indices[feature];
                model->weights[weight_index] +=
                    target * example->weight * features.values[feature];
            }
            ++*updates;
        }
        if (acted) feedback = example->observation.failure;
    }
    return 1;
}

static uint32_t corpus_errors(const R1Model *model, const R1Corpus *corpus,
                              uint8_t stage)
{
    R0CartanFailure feedback = R0_CARTAN_VALID;
    uint8_t current_rank = 0;
    uint32_t errors = 0;
    int index;
    for (index = 0; index < corpus->count; ++index) {
        const R1Example *example = &corpus->examples[index];
        R1FeatureVector features;
        int predicted;
        if (example->stage_rank > stage) continue;
        if (current_rank != example->stage_rank) {
            current_rank = example->stage_rank;
            feedback = R0_CARTAN_VALID;
        }
        encode_features(&example->base, &example->candidate,
                        example->attachment, example->bond, feedback,
                        &features);
        predicted = model_score(model, &features) >= 0;
        if (predicted != example->accepted) ++errors;
        if (predicted) feedback = example->observation.failure;
    }
    return errors;
}

static int compare_type_names(const void *left, const void *right)
{
    const char *const *a = left;
    const char *const *b = right;
    return strcmp(*a, *b);
}

static int finish_rank_report(const R1MatrixList *list, uint8_t rank,
                              R1EvaluationReport *report)
{
    const char *names[R1_MAX_TYPES_PER_RANK];
    size_t used = 0;
    int index;
    report->count_by_rank[rank] = list->count;
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
    return list->count == R1_EXPECTED_COUNTS[rank] &&
           strcmp(report->types_by_rank[rank], R1_EXPECTED_TYPES[rank]) == 0;
}

static R0Status evaluate_internal(const R1Model *model, uint8_t maximum_rank,
                                  R1EvaluationReport *report,
                                  int require_trained_rank, char *error,
                                  size_t error_capacity)
{
    R1MatrixList ranks[R0_ENUMERATION_MAX_RANK + 1];
    uint32_t expected_total = 0;
    uint8_t rank;
    int exact = 1;
    if (model == NULL || report == NULL || maximum_rank < 2 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    if (require_trained_rank && model->trained_rank < maximum_rank) {
        set_error(error, error_capacity,
                  "model is trained only through rank %u",
                  (unsigned)model->trained_rank);
        return R0_POLICY_ERROR;
    }
    memset(ranks, 0, sizeof(ranks));
    memset(report, 0, sizeof(*report));
    report->maximum_rank = maximum_rank;
    matrix_diagonal(&ranks[1].items[0], 1);
    ranks[1].count = 1;
    report->accepted = 1;
    exact &= finish_rank_report(&ranks[1], 1, report);
    expected_total = 1;
    for (rank = 2; rank <= maximum_rank; ++rank) {
        R1ProposalSet seen;
        R0CartanFailure feedback = R0_CARTAN_VALID;
        int base_index;
        memset(&seen, 0, sizeof(seen));
        for (base_index = 0; base_index < ranks[rank - 1].count;
             ++base_index) {
            const R0CartanMatrix *base = &ranks[rank - 1].items[base_index];
            int attachment, bond;
            for (attachment = 0; attachment < base->rank; ++attachment) {
                for (bond = 0; bond < R1_BOND_ACTIONS; ++bond) {
                    R0CartanMatrix candidate, canonical;
                    R0VerifierObservation observation;
                    R1FeatureVector features;
                    R0Status status;
                    int added;
                    extend_leaf(base, attachment, bond, &candidate);
                    status = r0_cartan_canonicalize(&candidate, &canonical,
                                                    error, error_capacity);
                    if (status != R0_OK) return status;
                    added = proposal_add(&seen, &canonical);
                    if (added < 0) return R0_LIMIT_ERROR;
                    if (added == 0) continue;
                    ++report->candidate_actions;
                    encode_features(base, &canonical, (uint8_t)attachment,
                                    (uint8_t)bond, feedback, &features);
                    if (model_score(model, &features) < 0) {
                        ++report->skipped;
                        continue;
                    }
                    ++report->proposed;
                    status = r0_cartan_verify(&canonical, &observation, error,
                                              error_capacity);
                    if (status != R0_OK) return status;
                    feedback = observation.failure;
                    if (observation.accepted) {
                        added = accepted_add(&ranks[rank], &canonical);
                        if (added < 0) return R0_LIMIT_ERROR;
                        if (added > 0) ++report->accepted;
                    } else {
                        ++report->rejected;
                        if (observation.failure == R0_CARTAN_AFFINE_BOUNDARY) {
                            ++report->affine_rejections;
                            report->counterexample_weight += R1_AFFINE_WEIGHT;
                        } else {
                            ++report->counterexample_weight;
                        }
                    }
                }
            }
        }
        exact &= finish_rank_report(&ranks[rank], rank, report);
        expected_total += R1_EXPECTED_COUNTS[rank];
    }
    report->precision_milli =
        report->proposed == 0
            ? 0
            : (uint32_t)(((uint64_t)(report->accepted - 1U) * 1000U) /
                         report->proposed);
    report->recall_milli =
        (uint32_t)(((uint64_t)report->accepted * 1000U) / expected_total);
    report->exact_precision_recall =
        (uint8_t)(exact && report->precision_milli == 1000U &&
                  report->recall_milli == 1000U);
    return R0_OK;
}

void r1_model_init(R1Model *model)
{
    if (model != NULL) memset(model, 0, sizeof(*model));
}

R0Status r1_evaluate(const R1Model *model, uint8_t maximum_rank,
                     R1EvaluationReport *report, char *error,
                     size_t error_capacity)
{
    return evaluate_internal(model, maximum_rank, report, 1, error,
                             error_capacity);
}

R0Status r1_train(R1Model *model, uint8_t maximum_rank,
                  R1TrainingReport *report, char *error,
                  size_t error_capacity)
{
    R1Corpus corpus;
    uint8_t stage;
    R0Status status;
    if (model == NULL || report == NULL || maximum_rank < 2 ||
        maximum_rank > R0_ENUMERATION_MAX_RANK)
        return R0_INVALID_ARGUMENT;
    r1_model_init(model);
    memset(report, 0, sizeof(*report));
    status = build_corpus(maximum_rank, &corpus, error, error_capacity);
    if (status != R0_OK) return status;
    report->examples = corpus.count;
    report->positives = corpus.positives;
    report->negatives = corpus.negatives;
    report->affine_negatives = corpus.affine_negatives;
    report->weighted_examples = corpus.weighted_examples;
    report->rank8_holdout_expected = R1_EXPECTED_COUNTS[8];
    for (stage = 2; stage <= maximum_rank; ++stage) {
        uint32_t epoch;
        uint32_t errors = UINT32_MAX;
        for (epoch = 0; epoch < R1_MAX_STAGE_EPOCHS; ++epoch) {
            uint32_t updates;
            (void)train_pass(model, &corpus, stage, &updates);
            ++model->trained_epochs;
            model->training_mistakes += updates;
            errors = corpus_errors(model, &corpus, stage);
            if (errors == 0) break;
        }
        model->trained_rank = stage;
        if (errors != 0) {
            set_error(error, error_capacity,
                      "rank %u training did not separate %u examples",
                      (unsigned)stage, errors);
            report->final_errors = errors;
            return R0_POLICY_ERROR;
        }
        if (stage == 7 && maximum_rank >= 8) {
            R1EvaluationReport holdout;
            status = evaluate_internal(model, 8, &holdout, 0, error,
                                       error_capacity);
            if (status != R0_OK) return status;
            report->rank8_holdout_found = holdout.count_by_rank[8];
            report->rank8_holdout_exact_precision_recall =
                holdout.exact_precision_recall;
            report->rank8_holdout_precision_milli = holdout.precision_milli;
            report->rank8_holdout_recall_milli = holdout.recall_milli;
            report->rank8_holdout_rejected = holdout.rejected;
            (void)snprintf(report->rank8_holdout_types,
                           sizeof(report->rank8_holdout_types), "%s",
                           holdout.types_by_rank[8]);
        }
        {
            R1EvaluationReport gate;
            status = evaluate_internal(model, stage, &gate, 1, error,
                                       error_capacity);
            if (status != R0_OK) return status;
            if (!gate.exact_precision_recall) {
                set_error(error, error_capacity,
                          "rank %u curriculum gate failed", (unsigned)stage);
                return R0_POLICY_ERROR;
            }
        }
        ++report->curriculum_promotions;
    }
    report->epochs = model->trained_epochs;
    report->mistakes = model->training_mistakes;
    report->final_errors = corpus_errors(model, &corpus, maximum_rank);
    report->trained_rank = model->trained_rank;
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

R0Status r1_model_save(const R1Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '1', 'G', 'R', 'P', 'H', '1', '\0'};
    R1EvaluationReport evaluation;
    char *temporary;
    size_t path_length;
    FILE *file;
    int index;
    R0Status status;
    if (model == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    status = r1_evaluate(model, model->trained_rank, &evaluation, error,
                         error_capacity);
    if (status != R0_OK || !evaluation.exact_precision_recall) {
        set_error(error, error_capacity,
                  "only an exact Reasoner-1 model can be saved");
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
        !write_u32(file, R1_MODEL_VERSION) ||
        !write_u32(file, R1_FEATURE_COUNT) ||
        !write_u32(file, model->trained_epochs) ||
        !write_u32(file, model->training_mistakes) ||
        !write_u32(file, model->trained_rank)) {
        (void)fclose(file);
        (void)remove(temporary);
        free(temporary);
        return R0_IO_ERROR;
    }
    for (index = 0; index < R1_FEATURE_COUNT; ++index) {
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

R0Status r1_model_load(R1Model *model, const char *path,
                       char *error, size_t error_capacity)
{
    static const unsigned char magic[8] =
        {'R', '1', 'G', 'R', 'P', 'H', '1', '\0'};
    unsigned char read_magic[8];
    uint32_t version, feature_count, trained_rank;
    R1EvaluationReport evaluation;
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
    r1_model_init(model);
    if (fread(read_magic, 1, sizeof(read_magic), file) != sizeof(read_magic) ||
        memcmp(read_magic, magic, sizeof(magic)) != 0 ||
        !read_u32(file, &version) || !read_u32(file, &feature_count) ||
        !read_u32(file, &model->trained_epochs) ||
        !read_u32(file, &model->training_mistakes) ||
        !read_u32(file, &trained_rank) || version != R1_MODEL_VERSION ||
        feature_count != R1_FEATURE_COUNT || trained_rank < 2 ||
        trained_rank > R0_ENUMERATION_MAX_RANK) {
        (void)fclose(file);
        set_error(error, error_capacity, "%s is not a Reasoner-1 model", path);
        return R0_POLICY_ERROR;
    }
    model->trained_rank = (uint8_t)trained_rank;
    for (index = 0; index < R1_FEATURE_COUNT; ++index) {
        uint32_t value;
        if (!read_u32(file, &value)) {
            (void)fclose(file);
            return R0_IO_ERROR;
        }
        model->weights[index] = signed_from_u32(value);
    }
    if (fgetc(file) != EOF || fclose(file) != 0) return R0_IO_ERROR;
    if (r1_evaluate(model, model->trained_rank, &evaluation, error,
                    error_capacity) != R0_OK ||
        !evaluation.exact_precision_recall) {
        set_error(error, error_capacity,
                  "%s does not pass its rank curriculum", path);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}
