#include "reasoner34.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R34_FNV_OFFSET UINT64_C(1469598103934665603)
#define R34_FNV_PRIME UINT64_C(1099511628211)

typedef struct {
    R34Graph graph;
    uint32_t target;
    uint32_t candidate;
    uint32_t optimal;
    R34Witness witness;
} R34Case;

typedef struct {
    R34Case items[R34_MAX_CASES];
    uint32_t count;
} R34Corpus;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static uint32_t integer_power(uint32_t base, uint8_t exponent)
{
    uint32_t value = 1;
    while (exponent-- > 0) value *= base;
    return value;
}

R0Status r34_graph(uint8_t graph_id, R34Graph *graph)
{
    static const R34Graph graphs[] = {
        {2, 1, {0, 0, 0, 0}, {1, 0, 0, 0}},
        {3, 2, {0, 1, 0, 0}, {1, 2, 0, 0}},
        {4, 3, {0, 1, 2, 0}, {1, 2, 3, 0}},
        {4, 3, {0, 0, 0, 0}, {1, 2, 3, 0}},
        {5, 4, {0, 1, 2, 3}, {1, 2, 3, 4}},
        {5, 4, {0, 0, 0, 0}, {1, 2, 3, 4}},
        {5, 4, {0, 1, 1, 3}, {1, 2, 3, 4}},
    };
    if (graph == NULL || graph_id >= sizeof(graphs) / sizeof(graphs[0]))
        return R0_INVALID_ARGUMENT;
    *graph = graphs[graph_id];
    return R0_OK;
}

uint32_t r34_program_count(const R34Graph *graph)
{
    if (graph == NULL || graph->variables < 2 ||
        graph->variables > R34_MAX_VARIABLES || graph->edges < 1 ||
        graph->edges > R34_MAX_EDGES)
        return 0;
    return integer_power(R34_RELATIONS_PER_EDGE, graph->edges);
}

static uint32_t target_from_program(const R34Graph *graph,
                                    uint32_t program)
{
    uint32_t mask = 0;
    uint8_t edge;
    for (edge = 0; edge < graph->edges; ++edge) {
        uint32_t relation = program % R34_RELATIONS_PER_EDGE;
        mask |= UINT32_C(1) <<
                (edge * R34_RELATIONS_PER_EDGE + relation);
        program /= R34_RELATIONS_PER_EDGE;
    }
    return mask;
}

static void action_relation(const R34Graph *graph, int action,
                            uint8_t *left, uint8_t *right, int *constant)
{
    int edge = action / R34_RELATIONS_PER_EDGE;
    int relation = action % R34_RELATIONS_PER_EDGE;
    if (relation < 3) {
        *left = graph->u[edge];
        *right = graph->v[edge];
        *constant = relation - 1;
    } else {
        *left = graph->v[edge];
        *right = graph->u[edge];
        *constant = relation - 4;
    }
}

static int action_slack(const R34Graph *graph, int action,
                        const R34State *state)
{
    uint8_t left, right;
    int constant;
    action_relation(graph, action, &left, &right, &constant);
    return constant - (state->values[left] - state->values[right]);
}

static int action_holds(const R34Graph *graph, int action,
                        const R34State *state)
{
    return action_slack(graph, action, state) >= 0;
}

static int mask_holds(const R34Graph *graph, uint32_t mask,
                      const R34State *state)
{
    int action;
    for (action = 0; action < graph->edges * R34_RELATIONS_PER_EDGE;
         ++action)
        if ((mask & (UINT32_C(1) << action)) != 0 &&
            !action_holds(graph, action, state))
            return 0;
    return 1;
}

static R34State state_from_index(const R34Graph *graph, uint32_t index)
{
    R34State state;
    int variable;
    memset(&state, 0, sizeof(state));
    for (variable = graph->variables - 1; variable >= 0; --variable) {
        state.values[variable] =
            (int8_t)(R34_DOMAIN_MIN + (int)(index % 5U));
        index /= 5U;
    }
    return state;
}

static uint32_t pack_state(const R34Graph *graph, const R34State *state)
{
    uint32_t packed = 0;
    uint8_t variable;
    for (variable = 0; variable < graph->variables; ++variable)
        packed = packed * 5U +
                 (uint32_t)(state->values[variable] - R34_DOMAIN_MIN);
    return packed;
}

static int state_in_domain(const R34Graph *graph, const R34State *state)
{
    uint8_t variable;
    for (variable = 0; variable < graph->variables; ++variable)
        if (state->values[variable] < R34_DOMAIN_MIN ||
            state->values[variable] > R34_DOMAIN_MAX)
            return 0;
    return 1;
}

static void edge_component(const R34Graph *graph, uint8_t removed_edge,
                           uint8_t start,
                           uint8_t component[R34_MAX_VARIABLES])
{
    uint8_t changed = 1;
    memset(component, 0, R34_MAX_VARIABLES);
    component[start] = 1;
    while (changed) {
        uint8_t edge;
        changed = 0;
        for (edge = 0; edge < graph->edges; ++edge) {
            uint8_t u, v;
            if (edge == removed_edge) continue;
            u = graph->u[edge];
            v = graph->v[edge];
            if (component[u] && !component[v]) {
                component[v] = 1;
                changed = 1;
            } else if (component[v] && !component[u]) {
                component[u] = 1;
                changed = 1;
            }
        }
    }
}

static int structured_negative(const R34Graph *graph, uint32_t target,
                               uint32_t candidate,
                               R34Witness *witness)
{
    uint32_t states = integer_power(5, graph->variables);
    int action;
    for (action = 0; action < graph->edges * R34_RELATIONS_PER_EDGE;
         ++action) {
        uint8_t left, right, component[R34_MAX_VARIABLES];
        uint32_t index;
        int constant;
        if ((target & (UINT32_C(1) << action)) == 0 ||
            (candidate & (UINT32_C(1) << action)) != 0)
            continue;
        action_relation(graph, action, &left, &right, &constant);
        edge_component(graph,
                       (uint8_t)(action / R34_RELATIONS_PER_EDGE), left,
                       component);
        for (index = 0; index < states; ++index) {
            R34State safe = state_from_index(graph, index);
            R34State source;
            uint8_t variable;
            if (!mask_holds(graph, target, &safe) ||
                action_slack(graph, action, &safe) != 0)
                continue;
            source = safe;
            for (variable = 0; variable < graph->variables; ++variable)
                if (component[variable]) ++source.values[variable];
            if (state_in_domain(graph, &source) &&
                mask_holds(graph, candidate, &source) &&
                !mask_holds(graph, target, &source)) {
                witness->kind = R34_WITNESS_NEGATIVE;
                witness->source = source;
                witness->target = safe;
                return 1;
            }
            source = safe;
            for (variable = 0; variable < graph->variables; ++variable)
                if (!component[variable]) --source.values[variable];
            if (state_in_domain(graph, &source) &&
                mask_holds(graph, candidate, &source) &&
                !mask_holds(graph, target, &source)) {
                witness->kind = R34_WITNESS_NEGATIVE;
                witness->source = source;
                witness->target = safe;
                return 1;
            }
        }
        (void)right;
        (void)constant;
    }
    return 0;
}

R0Status r34_verify_exact(const R34Graph *graph, uint32_t target,
                          uint32_t candidate,
                          R34Verification *verification)
{
    uint32_t index, states, valid_mask;
    if (graph == NULL || verification == NULL ||
        r34_program_count(graph) == 0)
        return R0_INVALID_ARGUMENT;
    valid_mask = (UINT32_C(1) <<
                  (graph->edges * R34_RELATIONS_PER_EDGE)) - 1U;
    if (((target | candidate) & ~valid_mask) != 0)
        return R0_INVALID_ARGUMENT;
    memset(verification, 0, sizeof(*verification));
    if (target == candidate) {
        verification->accepted = 1;
        verification->witness.kind = R34_WITNESS_VALID;
        return R0_OK;
    }
    states = integer_power(5, graph->variables);
    for (index = 0; index < states; ++index) {
        R34State state = state_from_index(graph, index);
        if (mask_holds(graph, target, &state) &&
            !mask_holds(graph, candidate, &state)) {
            verification->witness.kind = R34_WITNESS_POSITIVE;
            verification->witness.source = state;
            verification->witness.target = state;
            return R0_OK;
        }
    }
    if (structured_negative(graph, target, candidate,
                            &verification->witness))
        return R0_OK;
    for (index = 0; index < states; ++index) {
        R34State source = state_from_index(graph, index);
        uint32_t safe_index;
        if (!mask_holds(graph, candidate, &source) ||
            mask_holds(graph, target, &source))
            continue;
        verification->witness.kind = R34_WITNESS_NEGATIVE;
        verification->witness.source = source;
        for (safe_index = 0; safe_index < states; ++safe_index) {
            R34State safe = state_from_index(graph, safe_index);
            if (mask_holds(graph, target, &safe)) {
                verification->witness.target = safe;
                return R0_OK;
            }
        }
        return R0_VERIFIER_ERROR;
    }
    verification->accepted = 1;
    verification->witness.kind = R34_WITNESS_VALID;
    return R0_OK;
}

static int witness_resolved(const R34Graph *graph, uint32_t candidate,
                            const R34Witness *witness)
{
    if (witness->kind == R34_WITNESS_POSITIVE)
        return mask_holds(graph, candidate, &witness->source);
    if (witness->kind == R34_WITNESS_NEGATIVE)
        return !mask_holds(graph, candidate, &witness->source);
    return 0;
}

static uint32_t progress_actions(const R34Graph *graph, uint32_t candidate,
                                 const R34Witness *witness)
{
    uint32_t actions = 0;
    int action;
    for (action = 0; action < graph->edges * R34_RELATIONS_PER_EDGE;
         ++action)
        if (witness_resolved(graph,
                             candidate ^ (UINT32_C(1) << action),
                             witness))
            actions |= UINT32_C(1) << action;
    return actions;
}

static uint32_t optimal_actions(const R34Graph *graph, uint32_t target,
                                uint32_t candidate,
                                const R34Witness *witness)
{
    uint32_t legal = progress_actions(graph, candidate, witness);
    if (witness->kind == R34_WITNESS_POSITIVE)
        return legal & candidate & ~target;
    if (witness->kind == R34_WITNESS_NEGATIVE)
        return legal & target & ~candidate;
    return 0;
}

static int graph_degree(const R34Graph *graph, uint8_t variable)
{
    uint8_t edge;
    int degree = 0;
    for (edge = 0; edge < graph->edges; ++edge)
        degree += graph->u[edge] == variable ||
                  graph->v[edge] == variable;
    return degree;
}

static void semantic_features(const R34Graph *graph, uint32_t candidate,
                              const R34Witness *witness, int action,
                              uint8_t feedback_mode,
                              int16_t features[R34_FEATURE_COUNT])
{
    uint32_t bit = UINT32_C(1) << action;
    uint8_t left, right;
    int constant, source_slack, target_slack, delta_left, delta_right;
    memset(features, 0, R34_FEATURE_COUNT * sizeof(features[0]));
    features[0] = 1;
    features[1] = (candidate & bit) == 0;
    features[2] = !features[1];
    if (feedback_mode != R34_FEEDBACK_FULL) return;
    action_relation(graph, action, &left, &right, &constant);
    source_slack = action_slack(graph, action, &witness->source);
    target_slack = action_slack(graph, action, &witness->target);
    delta_left = witness->target.values[left] -
                 witness->source.values[left];
    delta_right = witness->target.values[right] -
                  witness->source.values[right];
    features[3] = source_slack >= 0;
    features[4] = target_slack >= 0;
    features[5] = (int16_t)source_slack;
    features[6] = (int16_t)target_slack;
    features[7] = (int16_t)(delta_left - delta_right);
    features[8] = (int16_t)(graph_degree(graph, left) +
                            graph_degree(graph, right));
    features[9] = (int16_t)constant;
    features[10] = (int16_t)(action % R34_RELATIONS_PER_EDGE >= 3);
    features[11] = witness->kind == R34_WITNESS_NEGATIVE;
    features[12] = witness->kind == R34_WITNESS_POSITIVE;
    features[13] = (int16_t)(
        witness->kind == R34_WITNESS_NEGATIVE && features[1] &&
        source_slack == -1 && target_slack == 0 &&
        delta_left != delta_right);
    features[14] = (int16_t)(
        witness->kind == R34_WITNESS_POSITIVE && features[2] &&
        source_slack < 0);
    features[15] = (int16_t)(delta_left != delta_right);
}

static int64_t score(const R34Model *model,
                     const int16_t features[R34_FEATURE_COUNT])
{
    int feature;
    int64_t value = 0;
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        value += (int64_t)model->weights[feature] * features[feature];
    return value;
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    return value ^ (value >> 16);
}

static void hash_features(const R34Graph *graph, uint32_t candidate,
                          const R34Witness *witness, int action,
                          int16_t features[R34_FEATURE_COUNT])
{
    uint32_t base, keys[4];
    int item;
    memset(features, 0, R34_FEATURE_COUNT * sizeof(features[0]));
    base = candidate ^ (pack_state(graph, &witness->source) << 7) ^
           (pack_state(graph, &witness->target) << 19) ^
           ((uint32_t)witness->kind << 29) ^
           ((uint32_t)graph->variables << 25) ^ (uint32_t)action;
    keys[0] = base ^ UINT32_C(0x9e3779b9);
    keys[1] = base ^ ((uint32_t)action * UINT32_C(0x85ebca6b));
    keys[2] = base ^ ((uint32_t)graph->u[action / 6] << 12) ^
              ((uint32_t)graph->v[action / 6] << 16);
    keys[3] = base ^ ((uint32_t)(action % 6) << 20) ^
              UINT32_C(0xc2b2ae35);
    for (item = 0; item < 4; ++item) {
        uint32_t mixed = mix32(keys[item]);
        int index = (int)(mixed % R34_FEATURE_COUNT);
        features[index] = (int16_t)(features[index] +
                                    ((mixed >> 31) != 0 ? 1 : -1));
    }
}

static int select_action(const R34Model *model, const R34Graph *graph,
                         uint32_t candidate, const R34Witness *witness,
                         uint8_t feedback_mode)
{
    uint32_t legal = progress_actions(graph, candidate, witness);
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < graph->edges * R34_RELATIONS_PER_EDGE;
         ++action) {
        int16_t features[R34_FEATURE_COUNT];
        int64_t value;
        if ((legal & (UINT32_C(1) << action)) == 0) continue;
        if (feedback_mode == R34_FEEDBACK_TOOL_ONLY) {
            value = 0;
        } else if (feedback_mode == R34_FEEDBACK_HASH) {
            hash_features(graph, candidate, witness, action, features);
            value = score(model, features);
        } else {
            semantic_features(graph, candidate, witness, action,
                              feedback_mode, features);
            value = score(model, features);
        }
        if (value > best_score ||
            (value == best_score && (best < 0 || action < best))) {
            best = action;
            best_score = value;
        }
    }
    return best;
}

static R0Status corpus_add(R34Corpus *corpus, const R34Graph *graph,
                           uint32_t target, uint32_t candidate)
{
    R34Verification verification;
    R0Status status;
    uint32_t optimal;
    if (corpus->count >= R34_MAX_CASES) return R0_LIMIT_ERROR;
    status = r34_verify_exact(graph, target, candidate, &verification);
    if (status != R0_OK || verification.accepted) return status;
    optimal = optimal_actions(graph, target, candidate,
                              &verification.witness);
    if (optimal == 0) return R0_OK;
    corpus->items[corpus->count].graph = *graph;
    corpus->items[corpus->count].target = target;
    corpus->items[corpus->count].candidate = candidate;
    corpus->items[corpus->count].optimal = optimal;
    corpus->items[corpus->count].witness = verification.witness;
    ++corpus->count;
    return R0_OK;
}

static R0Status build_training_corpus(R34Corpus *corpus)
{
    static const uint8_t training_graphs[] = {
        R34_GRAPH_PATH2, R34_GRAPH_PATH3,
    };
    size_t graph_index;
    memset(corpus, 0, sizeof(*corpus));
    for (graph_index = 0;
         graph_index < sizeof(training_graphs) / sizeof(training_graphs[0]);
         ++graph_index) {
        R34Graph graph;
        uint32_t program, programs;
        if (r34_graph(training_graphs[graph_index], &graph) != R0_OK)
            return R0_INVALID_ARGUMENT;
        programs = r34_program_count(&graph);
        for (program = 0; program < programs; ++program) {
            uint32_t target = target_from_program(&graph, program);
            uint32_t subsets = UINT32_C(1) << graph.edges;
            uint32_t subset;
            int action;
            for (subset = 0; subset < subsets; ++subset) {
                uint32_t candidate = 0;
                uint8_t edge;
                for (edge = 0; edge < graph.edges; ++edge)
                    if ((subset & (UINT32_C(1) << edge)) != 0)
                        candidate |= target &
                            (UINT32_C(63) << (edge * 6));
                if (corpus_add(corpus, &graph, target, candidate) != R0_OK)
                    return R0_VERIFIER_ERROR;
            }
            for (action = 0;
                 action < graph.edges * R34_RELATIONS_PER_EDGE; ++action) {
                uint32_t bit = UINT32_C(1) << action;
                if ((target & bit) != 0) continue;
                if (corpus_add(corpus, &graph, target, target | bit) !=
                    R0_OK)
                    return R0_VERIFIER_ERROR;
            }
        }
    }
    return R0_OK;
}

static int best_target(const R34Model *model, const R34Case *item,
                       uint8_t mode)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0;
         action < item->graph.edges * R34_RELATIONS_PER_EDGE; ++action) {
        int16_t features[R34_FEATURE_COUNT];
        int64_t value;
        if ((item->optimal & (UINT32_C(1) << action)) == 0) continue;
        if (mode == R34_FEEDBACK_HASH)
            hash_features(&item->graph, item->candidate, &item->witness,
                          action, features);
        else
            semantic_features(&item->graph, item->candidate,
                              &item->witness, action,
                              R34_FEEDBACK_FULL, features);
        value = score(model, features);
        if (value > best_score ||
            (value == best_score && (best < 0 || action < best))) {
            best = action;
            best_score = value;
        }
    }
    return best;
}

static void update_model(R34Model *model, const R34Case *item, int action,
                         int direction, uint8_t mode)
{
    int16_t features[R34_FEATURE_COUNT];
    int feature;
    if (mode == R34_FEEDBACK_HASH)
        hash_features(&item->graph, item->candidate, &item->witness,
                      action, features);
    else
        semantic_features(&item->graph, item->candidate, &item->witness,
                          action, R34_FEEDBACK_FULL, features);
    if (mode == R34_FEEDBACK_HASH) {
        for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
            model->weights[feature] += direction * features[feature];
    } else {
        model->weights[13] += direction * features[13];
        model->weights[14] += direction * features[14];
    }
}

static uint32_t corpus_errors(const R34Model *model,
                              const R34Corpus *corpus, uint8_t mode)
{
    uint32_t index, errors = 0;
    for (index = 0; index < corpus->count; ++index) {
        const R34Case *item = &corpus->items[index];
        int action = select_action(model, &item->graph, item->candidate,
                                   &item->witness, mode);
        if (action < 0 ||
            (item->optimal & (UINT32_C(1) << action)) == 0)
            ++errors;
    }
    return errors;
}

static void train_model(R34Model *model, const R34Corpus *corpus,
                        uint8_t mode, uint32_t *epochs,
                        uint32_t *mistakes)
{
    uint32_t epoch;
    memset(model, 0, sizeof(*model));
    *epochs = 0;
    *mistakes = 0;
    for (epoch = 0; epoch < R34_MAX_EPOCHS; ++epoch) {
        uint32_t index, current = 0;
        for (index = 0; index < corpus->count; ++index) {
            const R34Case *item = &corpus->items[index];
            int predicted = select_action(model, &item->graph,
                                          item->candidate, &item->witness,
                                          mode);
            if (predicted >= 0 &&
                (item->optimal & (UINT32_C(1) << predicted)) != 0)
                continue;
            {
                int target = best_target(model, item, mode);
                if (predicted < 0 || target < 0) continue;
                update_model(model, item, target, 1, mode);
                update_model(model, item, predicted, -1, mode);
                ++current;
            }
        }
        ++*epochs;
        *mistakes += current;
        if (current == 0) break;
    }
}

R0Status r34_train(R34Model *semantic, R34Model *hash,
                   R34TrainingReport *report, char *error,
                   size_t error_capacity)
{
    R34Corpus *corpus;
    uint32_t hash_epochs;
    int feature;
    if (semantic == NULL || hash == NULL || report == NULL)
        return R0_INVALID_ARGUMENT;
    corpus = malloc(sizeof(*corpus));
    if (corpus == NULL) return R0_LIMIT_ERROR;
    memset(report, 0, sizeof(*report));
    if (build_training_corpus(corpus) != R0_OK) {
        free(corpus);
        set_error(error, error_capacity, "could not build training corpus");
        return R0_VERIFIER_ERROR;
    }
    train_model(semantic, corpus, R34_FEEDBACK_FULL, &report->epochs,
                &report->mistakes);
    train_model(hash, corpus, R34_FEEDBACK_HASH, &hash_epochs,
                &report->hash_mistakes);
    report->cases = corpus->count;
    report->final_errors =
        corpus_errors(semantic, corpus, R34_FEEDBACK_FULL);
    report->hash_final_errors =
        corpus_errors(hash, corpus, R34_FEEDBACK_HASH);
    report->active_weight_bytes = sizeof(semantic->weights);
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        if (semantic->weights[feature] != 0) ++report->nonzero_weights;
    free(corpus);
    if (report->final_errors != 0) {
        set_error(error, error_capacity,
                  "relational policy has %u training errors",
                  report->final_errors);
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int next_permutation(uint8_t *values, uint8_t count)
{
    int left = count - 2;
    int right = count - 1;
    while (left >= 0 && values[left] >= values[left + 1]) --left;
    if (left < 0) return 0;
    while (values[right] <= values[left]) --right;
    {
        uint8_t temporary = values[left];
        values[left] = values[right];
        values[right] = temporary;
    }
    for (right = count - 1, ++left; left < right; ++left, --right) {
        uint8_t temporary = values[left];
        values[left] = values[right];
        values[right] = temporary;
    }
    return 1;
}

static void sort_graph_edges(R34Graph *graph)
{
    uint8_t left, right;
    for (left = 0; left < graph->edges; ++left)
        for (right = (uint8_t)(left + 1); right < graph->edges; ++right)
            if (graph->u[right] < graph->u[left] ||
                (graph->u[right] == graph->u[left] &&
                 graph->v[right] < graph->v[left])) {
                uint8_t temporary;
                temporary = graph->u[left];
                graph->u[left] = graph->u[right];
                graph->u[right] = temporary;
                temporary = graph->v[left];
                graph->v[left] = graph->v[right];
                graph->v[right] = temporary;
            }
}

static R34Graph transform_graph(const R34Graph *graph,
                                const uint8_t *permutation)
{
    R34Graph transformed = *graph;
    uint8_t edge;
    memset(transformed.u, 0, sizeof(transformed.u));
    memset(transformed.v, 0, sizeof(transformed.v));
    for (edge = 0; edge < graph->edges; ++edge) {
        uint8_t u = permutation[graph->u[edge]];
        uint8_t v = permutation[graph->v[edge]];
        transformed.u[edge] = u < v ? u : v;
        transformed.v[edge] = u < v ? v : u;
    }
    sort_graph_edges(&transformed);
    return transformed;
}

static int find_action(const R34Graph *graph, uint8_t left,
                       uint8_t right, int constant)
{
    uint8_t edge;
    for (edge = 0; edge < graph->edges; ++edge) {
        int relation;
        if (graph->u[edge] == left && graph->v[edge] == right)
            relation = constant + 1;
        else if (graph->u[edge] == right && graph->v[edge] == left)
            relation = constant + 4;
        else
            continue;
        return edge * R34_RELATIONS_PER_EDGE + relation;
    }
    return -1;
}

static int transform_action(const R34Graph *graph,
                            const R34Graph *transformed, int action,
                            const uint8_t *permutation)
{
    uint8_t left, right;
    int constant;
    action_relation(graph, action, &left, &right, &constant);
    return find_action(transformed, permutation[left], permutation[right],
                       constant);
}

static uint32_t transform_mask(const R34Graph *graph,
                               const R34Graph *transformed, uint32_t mask,
                               const uint8_t *permutation)
{
    uint32_t changed = 0;
    int action;
    for (action = 0; action < graph->edges * R34_RELATIONS_PER_EDGE;
         ++action)
        if ((mask & (UINT32_C(1) << action)) != 0) {
            int mapped = transform_action(graph, transformed, action,
                                          permutation);
            if (mapped >= 0) changed |= UINT32_C(1) << mapped;
        }
    return changed;
}

static R34State transform_state(const R34Graph *graph, R34State state,
                                const uint8_t *permutation)
{
    R34State transformed;
    uint8_t variable;
    memset(&transformed, 0, sizeof(transformed));
    for (variable = 0; variable < graph->variables; ++variable)
        transformed.values[permutation[variable]] = state.values[variable];
    return transformed;
}

static int check_relabelings(const R34Model *model,
                             const R34Graph *graph, uint32_t candidate,
                             const R34Witness *witness, int action,
                             uint64_t *cases, uint64_t *exact)
{
    uint8_t permutation[R34_MAX_VARIABLES];
    uint8_t variable;
    for (variable = 0; variable < graph->variables; ++variable)
        permutation[variable] = variable;
    do {
        R34Graph changed_graph = transform_graph(graph, permutation);
        R34Witness changed_witness = *witness;
        uint32_t changed_candidate = transform_mask(
            graph, &changed_graph, candidate, permutation);
        int changed_action, expected;
        changed_witness.source = transform_state(
            graph, witness->source, permutation);
        changed_witness.target = transform_state(
            graph, witness->target, permutation);
        changed_action = select_action(
            model, &changed_graph, changed_candidate, &changed_witness,
            R34_FEEDBACK_FULL);
        expected = transform_action(graph, &changed_graph, action,
                                    permutation);
        ++*cases;
        if (changed_action == expected) ++*exact;
    } while (next_permutation(permutation, graph->variables));
    return 1;
}

static R0Status evaluate_graphs(const R34Model *model,
                                const uint8_t *graph_ids,
                                size_t graph_count, uint8_t mode,
                                R34Evaluation *report)
{
    size_t graph_index;
    memset(report, 0, sizeof(*report));
    report->graphs = (uint32_t)graph_count;
    for (graph_index = 0; graph_index < graph_count; ++graph_index) {
        R34Graph graph;
        uint32_t program, programs;
        if (r34_graph(graph_ids[graph_index], &graph) != R0_OK)
            return R0_INVALID_ARGUMENT;
        programs = r34_program_count(&graph);
        report->programs += programs;
        for (program = 0; program < programs; ++program) {
            uint32_t target = target_from_program(&graph, program);
            uint32_t candidate = 0, calls = 0;
            int accepted = 0;
            while (calls <= R34_MAX_STEPS) {
                R34Verification verification;
                int action;
                R0Status status = r34_verify_exact(
                    &graph, target, candidate, &verification);
                if (status != R0_OK) return status;
                if (verification.accepted) {
                    accepted = 1;
                    break;
                }
                if (calls == R34_MAX_STEPS) break;
                action = select_action(model, &graph, candidate,
                                       &verification.witness, mode);
                if (action < 0) break;
                if (mode == R34_FEEDBACK_FULL)
                    (void)check_relabelings(
                        model, &graph, candidate, &verification.witness,
                        action, &report->relabeling_cases,
                        &report->relabeling_exact);
                candidate ^= UINT32_C(1) << action;
                ++calls;
            }
            report->verifier_calls += calls;
            if (!accepted) {
                ++report->failed;
                continue;
            }
            ++report->solved;
            if (calls == graph.edges)
                ++report->minimal;
            else
                ++report->excess_edits;
        }
    }
    report->exact = (uint8_t)(
        report->solved == report->programs &&
        report->minimal == report->programs &&
        (mode != R34_FEEDBACK_FULL ||
         report->relabeling_exact == report->relabeling_cases));
    return R0_OK;
}

R0Status r34_evaluate_development(const R34Model *semantic,
                                  const R34Model *hash,
                                  R34Evaluation *semantic_report,
                                  R34Evaluation *hash_report,
                                  char *error, size_t error_capacity)
{
    static const uint8_t development_graphs[] = {
        R34_GRAPH_PATH4, R34_GRAPH_STAR4,
    };
    R0Status status;
    if (semantic == NULL || hash == NULL || semantic_report == NULL ||
        hash_report == NULL)
        return R0_INVALID_ARGUMENT;
    status = evaluate_graphs(
        semantic, development_graphs,
        sizeof(development_graphs) / sizeof(development_graphs[0]),
        R34_FEEDBACK_FULL, semantic_report);
    if (status == R0_OK)
        status = evaluate_graphs(
            hash, development_graphs,
            sizeof(development_graphs) / sizeof(development_graphs[0]),
            R34_FEEDBACK_HASH, hash_report);
    if (status == R0_OK && !semantic_report->exact) {
        set_error(error, error_capacity,
                  "development relation gate solved %u/%u exactly",
                  semantic_report->minimal, semantic_report->programs);
        return R0_POLICY_ERROR;
    }
    return status;
}

static int equivalent_exhaustive(const R34Graph *graph, uint32_t left,
                                 uint32_t right)
{
    uint32_t index, states = integer_power(5, graph->variables);
    for (index = 0; index < states; ++index) {
        R34State state = state_from_index(graph, index);
        if (mask_holds(graph, left, &state) !=
            mask_holds(graph, right, &state))
            return 0;
    }
    return 1;
}

int r34_self_test(char *error, size_t error_capacity)
{
    R34Graph graph;
    R34Model semantic, hash;
    R34TrainingReport training;
    R34Evaluation development, hash_development;
    uint32_t program;
    if (r34_graph(R34_GRAPH_PATH2, &graph) != R0_OK ||
        r34_program_count(&graph) != 6)
        goto fail_census;
    for (program = 0; program < r34_program_count(&graph); ++program) {
        uint32_t target = target_from_program(&graph, program);
        uint32_t candidate;
        for (candidate = 0; candidate < 64; ++candidate) {
            R34Verification verification;
            int equivalent = equivalent_exhaustive(
                &graph, target, candidate);
            if (r34_verify_exact(&graph, target, candidate,
                                 &verification) != R0_OK ||
                verification.accepted != equivalent) {
                set_error(error, error_capacity,
                          "exact verifier mismatch at program %u mask %u",
                          program, candidate);
                return 0;
            }
        }
    }
    if (r34_train(&semantic, &hash, &training, error, error_capacity) !=
        R0_OK)
        return 0;
    if (r34_evaluate_development(&semantic, &hash, &development,
                                 &hash_development, error,
                                 error_capacity) != R0_OK)
        return 0;
    if (training.cases != 426 || training.epochs != 2 ||
        training.mistakes != 1 || training.final_errors != 0 ||
        training.nonzero_weights != 1 ||
        training.active_weight_bytes != 64 ||
        development.graphs != 2 || development.programs != 432 ||
        development.minimal != 432 ||
        development.relabeling_cases != UINT64_C(31104) ||
        development.relabeling_exact != UINT64_C(31104) ||
        !development.exact || hash_development.minimal != 2 ||
        hash_development.exact) {
        set_error(error, error_capacity,
                  "frozen development census changed");
        return 0;
    }
    return 1;
fail_census:
    set_error(error, error_capacity, "graph census changed");
    return 0;
}

static void digest_u32(uint64_t *digest, uint32_t value)
{
    unsigned byte;
    for (byte = 0; byte < 4; ++byte) {
        *digest ^= (value >> (byte * 8U)) & UINT32_C(0xff);
        *digest *= R34_FNV_PRIME;
    }
}

static void digest_u64(uint64_t *digest, uint64_t value)
{
    digest_u32(digest, (uint32_t)value);
    digest_u32(digest, (uint32_t)(value >> 32));
}

R0Status r34_run_sealed(R34ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    static const uint8_t sealed_graphs[] = {
        R34_GRAPH_PATH5, R34_GRAPH_STAR5, R34_GRAPH_FORK5,
    };
    R34Model semantic, hash;
    R0Status status;
    uint64_t digest = R34_FNV_OFFSET;
    int feature;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = r34_train(&semantic, &hash, &report->training, error,
                       error_capacity);
    if (status != R0_OK) return status;
    status = r34_evaluate_development(
        &semantic, &hash, &report->development_semantic,
        &report->development_hash, error, error_capacity);
    if (status != R0_OK) return status;
    report->development_gate_passed = (uint8_t)(
        report->development_semantic.exact &&
        !report->development_hash.exact);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "sealed relation suite remains closed");
        return R0_POLICY_ERROR;
    }

    /* The three sealed five-variable graph families open below this line. */
    status = evaluate_graphs(
        &semantic, sealed_graphs,
        sizeof(sealed_graphs) / sizeof(sealed_graphs[0]),
        R34_FEEDBACK_FULL, &report->semantic);
    if (status == R0_OK)
        status = evaluate_graphs(
            &hash, sealed_graphs,
            sizeof(sealed_graphs) / sizeof(sealed_graphs[0]),
            R34_FEEDBACK_HASH, &report->hash_control);
    if (status == R0_OK)
        status = evaluate_graphs(
            &semantic, sealed_graphs,
            sizeof(sealed_graphs) / sizeof(sealed_graphs[0]),
            R34_FEEDBACK_WITNESS_MASKED, &report->witness_masked);
    if (status == R0_OK)
        status = evaluate_graphs(
            &semantic, sealed_graphs,
            sizeof(sealed_graphs) / sizeof(sealed_graphs[0]),
            R34_FEEDBACK_TOOL_ONLY, &report->tool_only);
    if (status != R0_OK) return status;
    memcpy(report->semantic_weights, semantic.weights,
           sizeof(report->semantic_weights));
    memcpy(report->hash_weights, hash.weights,
           sizeof(report->hash_weights));
    report->semantic_active_weight_bytes = sizeof(semantic.weights);
    report->hash_active_weight_bytes = sizeof(hash.weights);
    report->sealed_gate_passed = (uint8_t)(
        report->semantic.exact && !report->hash_control.exact &&
        !report->witness_masked.exact && !report->tool_only.exact &&
        report->semantic_active_weight_bytes <=
            report->hash_active_weight_bytes);
    digest_u32(&digest, report->development_semantic.programs);
    digest_u32(&digest, report->development_semantic.minimal);
    digest_u64(&digest, report->development_semantic.relabeling_exact);
    digest_u32(&digest, report->semantic.programs);
    digest_u32(&digest, report->semantic.minimal);
    digest_u64(&digest, report->semantic.relabeling_exact);
    digest_u32(&digest, report->hash_control.minimal);
    digest_u32(&digest, report->witness_masked.minimal);
    digest_u32(&digest, report->tool_only.minimal);
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        digest_u32(&digest, (uint32_t)semantic.weights[feature]);
    report->result_digest = digest;
    return R0_OK;
}

static void write_evaluation(FILE *file, const char *name,
                             const R34Evaluation *report)
{
    fprintf(file,
            "  \"%s\": {\"graphs\": %u, \"programs\": %u, "
            "\"solved\": %u, \"minimal\": %u, \"failed\": %u, "
            "\"verifier_calls\": %u, \"relabeling_cases\": "
            "%" PRIu64 ", \"relabeling_exact\": %" PRIu64
            ", \"exact\": %s}",
            name, report->graphs, report->programs, report->solved,
            report->minimal, report->failed, report->verifier_calls,
            report->relabeling_cases, report->relabeling_exact,
            report->exact ? "true" : "false");
}

R0Status r34_write_result(const R34ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    int feature;
    if (report == NULL || path == NULL) return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    fprintf(file,
            "{\n"
            "  \"schema\": \"zero.reasoner34_relational_graph.v1\",\n"
            "  \"version\": \"(3,3,1)\",\n"
            "  \"sealed_graphs\": [\"path5\", \"star5\", "
            "\"fork5\"],\n"
            "  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"training\": {\"graphs\": [\"path2\", "
            "\"path3\"], \"cases\": %u, \"epochs\": %u, "
            "\"mistakes\": %u, \"final_errors\": %u, "
            "\"hash_mistakes\": %u, \"hash_final_errors\": %u},\n",
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->training.cases, report->training.epochs,
            report->training.mistakes, report->training.final_errors,
            report->training.hash_mistakes,
            report->training.hash_final_errors);
    write_evaluation(file, "development_semantic",
                     &report->development_semantic);
    fputs(",\n", file);
    write_evaluation(file, "development_hash",
                     &report->development_hash);
    fputs(",\n", file);
    write_evaluation(file, "semantic", &report->semantic);
    fputs(",\n", file);
    write_evaluation(file, "hash_control", &report->hash_control);
    fputs(",\n", file);
    write_evaluation(file, "witness_masked", &report->witness_masked);
    fputs(",\n", file);
    write_evaluation(file, "tool_only", &report->tool_only);
    fprintf(file,
            ",\n  \"capacity\": {\"semantic_active_weight_bytes\": %u, "
            "\"hash_active_weight_bytes\": %u},\n"
            "  \"semantic_weights\": [",
            report->semantic_active_weight_bytes,
            report->hash_active_weight_bytes);
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                report->semantic_weights[feature]);
    fprintf(file,
            "],\n  \"hash_weights\": [");
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                report->hash_weights[feature]);
    fprintf(file,
            "],\n  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
            report->result_digest);
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot close %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    return R0_OK;
}
