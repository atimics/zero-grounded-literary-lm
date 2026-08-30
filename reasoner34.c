#include "reasoner34.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
    R34_TOGGLE = 0,
    R34_CROSS = 1,
    R34_COLLECT = 2
};

enum {
    R34_POLICY_SEMANTIC = 0,
    R34_POLICY_GREEDY = 1,
    R34_POLICY_TOOL_ONLY = 2,
    R34_POLICY_HASH = 3,
    R34_POLICY_LOOKUP = 4
};

typedef struct {
    uint8_t gates;
    uint8_t labels[R34_MAX_GATES];
} R34World;

typedef struct {
    uint8_t position;
    uint8_t cargo;
    uint8_t open_gates;
} R34State;

typedef struct {
    uint8_t kind;
    uint8_t edge;
} R34Action;

typedef struct {
    uint8_t gates;
    uint16_t state_count;
    uint16_t distance[R34_MAX_STATES];
} R34Oracle;

typedef struct {
    R34World world;
    R34State state;
    uint32_t optimal_actions;
} R34TrainingCase;

typedef struct {
    R34TrainingCase cases[R34_MAX_TRAINING_CASES];
    uint16_t count;
} R34Corpus;

typedef struct {
    uint8_t solved;
    uint8_t optimal;
    uint8_t length;
    uint8_t actions[R34_MAX_PLAN_STEPS];
    uint8_t distance_increases;
    uint8_t gate_openings;
    uint8_t gate_restorations;
} R34Plan;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

static uint8_t popcount8(uint8_t value)
{
    uint8_t count = 0;
    while (value != 0) {
        count = (uint8_t)(count + (value & 1U));
        value >>= 1;
    }
    return count;
}

static uint32_t factorial(uint8_t value)
{
    uint32_t result = 1;
    while (value > 1) result *= value--;
    return result;
}

static uint16_t state_count(uint8_t gates)
{
    return (uint16_t)(2U * (gates + 1U) * (UINT16_C(1) << gates));
}

static uint16_t pack_state(uint8_t gates, R34State state)
{
    return (uint16_t)(((uint16_t)state.cargo * (gates + 1U) +
                       state.position) *
                          (UINT16_C(1) << gates) +
                      state.open_gates);
}

static R34State unpack_state(uint8_t gates, uint16_t packed)
{
    R34State state;
    uint16_t gate_states = (uint16_t)(UINT16_C(1) << gates);
    uint16_t upper;
    state.open_gates = (uint8_t)(packed % gate_states);
    upper = (uint16_t)(packed / gate_states);
    state.position = (uint8_t)(upper % (gates + 1U));
    state.cargo = (uint8_t)(upper / (gates + 1U));
    return state;
}

static int is_goal(R34State state)
{
    return state.position == 0 && state.cargo != 0 &&
           state.open_gates == 0;
}

static uint8_t goal_error(R34State state)
{
    return (uint8_t)(state.position + (state.cargo == 0) +
                     popcount8(state.open_gates));
}

static uint8_t action_id(const R34World *world, R34Action action)
{
    if (action.kind == R34_COLLECT) return (uint8_t)(2U * world->gates);
    return (uint8_t)(action.kind * world->gates + action.edge);
}

static R34Action action_from_id(const R34World *world, uint8_t id)
{
    R34Action action;
    if (id == 2U * world->gates) {
        action.kind = R34_COLLECT;
        action.edge = 0;
    } else {
        action.kind = (uint8_t)(id / world->gates);
        action.edge = (uint8_t)(id % world->gates);
    }
    return action;
}

static uint16_t symbolic_action(const R34World *world, R34Action action)
{
    if (action.kind == R34_COLLECT) return (uint16_t)(2U * world->gates);
    return (uint16_t)(2U * world->labels[action.edge] + action.kind);
}

static uint8_t legal_actions(const R34World *world, R34State state,
                             R34Action actions[2 * R34_MAX_GATES + 1])
{
    uint8_t count = 0;
    uint8_t edges[2], edge_count = 0, index;
    if (state.position > 0)
        edges[edge_count++] = (uint8_t)(state.position - 1U);
    if (state.position < world->gates)
        edges[edge_count++] = state.position;
    for (index = 0; index < edge_count; ++index) {
        uint8_t edge = edges[index];
        actions[count].kind = R34_TOGGLE;
        actions[count++].edge = edge;
        if ((state.open_gates & (UINT8_C(1) << edge)) != 0) {
            actions[count].kind = R34_CROSS;
            actions[count++].edge = edge;
        }
    }
    if (state.position == world->gates && state.cargo == 0) {
        actions[count].kind = R34_COLLECT;
        actions[count++].edge = 0;
    }
    return count;
}

static int apply_action(const R34World *world, R34State source,
                        R34Action action, R34State *target)
{
    if (target == NULL) return 0;
    *target = source;
    if (action.kind == R34_COLLECT) {
        if (source.position != world->gates || source.cargo != 0) return 0;
        target->cargo = 1;
        return 1;
    }
    if (action.edge >= world->gates ||
        (source.position != action.edge &&
         source.position != action.edge + 1U))
        return 0;
    if (action.kind == R34_TOGGLE) {
        target->open_gates ^=
            (uint8_t)(UINT8_C(1) << action.edge);
        return 1;
    }
    if (action.kind == R34_CROSS &&
        (source.open_gates & (UINT8_C(1) << action.edge)) != 0) {
        target->position = source.position == action.edge
                               ? (uint8_t)(action.edge + 1U)
                               : action.edge;
        return 1;
    }
    return 0;
}

static R0Status build_oracle(uint8_t gates, R34Oracle *oracle)
{
    uint16_t queue[R34_MAX_STATES];
    uint16_t head = 0, tail = 0, index;
    R34State goal = {0, 1, 0};
    if (oracle == NULL || gates < 1 || gates > R34_MAX_GATES)
        return R0_INVALID_ARGUMENT;
    memset(oracle, 0, sizeof(*oracle));
    oracle->gates = gates;
    oracle->state_count = state_count(gates);
    for (index = 0; index < oracle->state_count; ++index)
        oracle->distance[index] = UINT16_MAX;
    index = pack_state(gates, goal);
    oracle->distance[index] = 0;
    queue[tail++] = index;
    while (head < tail) {
        uint16_t packed = queue[head++];
        uint16_t next_distance = (uint16_t)(oracle->distance[packed] + 1U);
        R34State state = unpack_state(gates, packed);
        uint8_t adjacent[2], adjacent_count = 0, item;
        if (state.position > 0)
            adjacent[adjacent_count++] = (uint8_t)(state.position - 1U);
        if (state.position < gates)
            adjacent[adjacent_count++] = state.position;
        for (item = 0; item < adjacent_count; ++item) {
            uint8_t edge = adjacent[item];
            R34State predecessor = state;
            uint16_t predecessor_index;
            predecessor.open_gates ^=
                (uint8_t)(UINT8_C(1) << edge);
            predecessor_index = pack_state(gates, predecessor);
            if (oracle->distance[predecessor_index] == UINT16_MAX) {
                oracle->distance[predecessor_index] = next_distance;
                queue[tail++] = predecessor_index;
            }
            if ((state.open_gates & (UINT8_C(1) << edge)) != 0) {
                predecessor = state;
                predecessor.position = state.position == edge
                                           ? (uint8_t)(edge + 1U)
                                           : edge;
                predecessor_index = pack_state(gates, predecessor);
                if (oracle->distance[predecessor_index] == UINT16_MAX) {
                    oracle->distance[predecessor_index] = next_distance;
                    queue[tail++] = predecessor_index;
                }
            }
        }
        if (state.cargo != 0 && state.position == gates) {
            R34State predecessor = state;
            uint16_t predecessor_index;
            predecessor.cargo = 0;
            predecessor_index = pack_state(gates, predecessor);
            if (oracle->distance[predecessor_index] == UINT16_MAX) {
                oracle->distance[predecessor_index] = next_distance;
                queue[tail++] = predecessor_index;
            }
        }
    }
    if (tail != oracle->state_count) return R0_VERIFIER_ERROR;
    return R0_OK;
}

uint16_t r34_oracle_initial_distance(uint8_t gates)
{
    R34Oracle oracle;
    R34State initial = {0, 0, 0};
    if (build_oracle(gates, &oracle) != R0_OK) return UINT16_MAX;
    return oracle.distance[pack_state(gates, initial)];
}

static uint32_t optimal_actions(const R34World *world,
                                const R34Oracle *oracle, R34State state)
{
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    uint16_t current = oracle->distance[pack_state(world->gates, state)];
    uint32_t optimal = 0;
    for (index = 0; index < count; ++index) {
        R34State target;
        uint16_t distance;
        if (!apply_action(world, state, actions[index], &target)) continue;
        distance = oracle->distance[pack_state(world->gates, target)];
        if (current != UINT16_MAX && distance + 1U == current)
            optimal |= UINT32_C(1) << action_id(world, actions[index]);
    }
    return optimal;
}

static void semantic_features(const R34World *world, R34State state,
                              R34Action action,
                              int16_t features[R34_FEATURE_COUNT])
{
    int toggle = action.kind == R34_TOGGLE;
    int cross = action.kind == R34_CROSS;
    int collect = action.kind == R34_COLLECT;
    int outbound = state.cargo == 0;
    int inbound = state.cargo != 0;
    int forward = !collect && action.edge == state.position;
    int backward = !collect && state.position > 0 &&
                   action.edge + 1U == state.position;
    int behind = !collect && state.position < world->gates &&
                 action.edge == state.position;
    int open = !collect &&
               (state.open_gates & (UINT8_C(1) << action.edge)) != 0;
    memset(features, 0, R34_FEATURE_COUNT * sizeof(features[0]));
    features[0] = 1;
    features[1] = (int16_t)toggle;
    features[2] = (int16_t)cross;
    features[3] = (int16_t)collect;
    features[4] = (int16_t)outbound;
    features[5] = (int16_t)inbound;
    features[6] = (int16_t)forward;
    features[7] = (int16_t)backward;
    features[8] = (int16_t)behind;
    features[9] = (int16_t)open;
    features[10] = (int16_t)(!collect && !open);
    features[11] = (int16_t)(collect && outbound &&
                             state.position == world->gates);
    features[12] = (int16_t)(outbound && toggle && forward && !open);
    features[13] = (int16_t)(outbound && cross && forward && open);
    features[14] = (int16_t)(inbound && cross && backward && open);
    features[15] = (int16_t)(inbound && toggle && behind && open);
}

static int64_t semantic_score(const R34Model *model,
                              const int16_t features[R34_FEATURE_COUNT])
{
    int64_t score = 0;
    uint8_t index;
    for (index = 0; index < R34_FEATURE_COUNT; ++index)
        score += (int64_t)model->weights[index] * features[index];
    return score;
}

static uint32_t mix32(uint32_t value)
{
    value ^= value >> 16;
    value *= UINT32_C(0x7feb352d);
    value ^= value >> 15;
    value *= UINT32_C(0x846ca68b);
    value ^= value >> 16;
    return value;
}

static uint32_t label_code(const R34World *world)
{
    uint32_t code = world->gates;
    uint8_t edge;
    for (edge = 0; edge < world->gates; ++edge)
        code = code * 8U + world->labels[edge];
    return code;
}

static uint32_t lookup_key(const R34World *world, R34State state)
{
    return mix32((label_code(world) << 12) ^
                 pack_state(world->gates, state));
}

static uint8_t hash_bucket(const R34World *world, R34State state,
                           R34Action action)
{
    uint32_t value = lookup_key(world, state) ^
                     ((uint32_t)symbolic_action(world, action) *
                      UINT32_C(0x9e3779b9));
    return (uint8_t)(mix32(value) % R34_HASH_BUCKETS);
}

static int select_semantic(const R34Model *model, const R34World *world,
                           R34State state, uint32_t allowed)
{
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    int best = -1;
    int64_t best_score = INT64_MIN;
    uint16_t best_symbol = UINT16_MAX;
    for (index = 0; index < count; ++index) {
        uint8_t id = action_id(world, actions[index]);
        int16_t features[R34_FEATURE_COUNT];
        int64_t score;
        uint16_t symbol;
        if ((allowed & (UINT32_C(1) << id)) == 0) continue;
        semantic_features(world, state, actions[index], features);
        score = semantic_score(model, features);
        symbol = symbolic_action(world, actions[index]);
        if (score > best_score ||
            (score == best_score && symbol < best_symbol)) {
            best = id;
            best_score = score;
            best_symbol = symbol;
        }
    }
    return best;
}

static int select_hash(const R34HashModel *model, const R34World *world,
                       R34State state, uint32_t allowed)
{
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    int best = -1;
    int32_t best_score = INT32_MIN;
    uint16_t best_symbol = UINT16_MAX;
    for (index = 0; index < count; ++index) {
        uint8_t id = action_id(world, actions[index]);
        uint8_t bucket;
        uint16_t symbol;
        if ((allowed & (UINT32_C(1) << id)) == 0) continue;
        bucket = hash_bucket(world, state, actions[index]);
        symbol = symbolic_action(world, actions[index]);
        if (model->weights[bucket] > best_score ||
            (model->weights[bucket] == best_score &&
             symbol < best_symbol)) {
            best = id;
            best_score = model->weights[bucket];
            best_symbol = symbol;
        }
    }
    return best;
}

static int select_tool_only(const R34World *world, R34State state)
{
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    int best = -1;
    uint16_t best_symbol = UINT16_MAX;
    for (index = 0; index < count; ++index) {
        uint16_t symbol = symbolic_action(world, actions[index]);
        if (symbol < best_symbol) {
            best = action_id(world, actions[index]);
            best_symbol = symbol;
        }
    }
    return best;
}

static int select_greedy(const R34World *world, R34State state)
{
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    uint8_t current = goal_error(state), best_error = UINT8_MAX;
    uint16_t best_symbol = UINT16_MAX;
    int best = -1;
    for (index = 0; index < count; ++index) {
        R34State target;
        uint8_t candidate_error;
        uint16_t symbol;
        if (!apply_action(world, state, actions[index], &target)) continue;
        candidate_error = goal_error(target);
        symbol = symbolic_action(world, actions[index]);
        if (candidate_error < best_error ||
            (candidate_error == best_error && symbol < best_symbol)) {
            best = action_id(world, actions[index]);
            best_error = candidate_error;
            best_symbol = symbol;
        }
    }
    return best_error < current ? best : -1;
}

static int select_lookup(const R34LookupModel *model,
                         const R34World *world, R34State state)
{
    uint32_t key = lookup_key(world, state);
    uint8_t slot;
    R34Action actions[2 * R34_MAX_GATES + 1];
    uint8_t count = legal_actions(world, state, actions), index;
    for (slot = 0; slot < R34_LOOKUP_ENTRIES; ++slot) {
        if (!model->used[slot] || model->keys[slot] != key) continue;
        for (index = 0; index < count; ++index)
            if (symbolic_action(world, actions[index]) ==
                model->actions[slot])
                return action_id(world, actions[index]);
        return -1;
    }
    return -1;
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

static void identity_world(uint8_t gates, R34World *world)
{
    uint8_t edge;
    memset(world, 0, sizeof(*world));
    world->gates = gates;
    for (edge = 0; edge < gates; ++edge) world->labels[edge] = edge;
}

static R0Status corpus_add_trace(R34Corpus *corpus, const R34World *world,
                                 const R34Oracle *oracle)
{
    R34State state = {0, 0, 0};
    uint16_t remaining = oracle->distance[pack_state(world->gates, state)];
    while (!is_goal(state)) {
        uint32_t optimal = optimal_actions(world, oracle, state);
        int selected = -1;
        uint8_t id;
        R34State target;
        if (corpus->count >= R34_MAX_TRAINING_CASES)
            return R0_LIMIT_ERROR;
        if (optimal == 0) return R0_VERIFIER_ERROR;
        corpus->cases[corpus->count].world = *world;
        corpus->cases[corpus->count].state = state;
        corpus->cases[corpus->count].optimal_actions = optimal;
        ++corpus->count;
        for (id = 0; id <= 2U * world->gates; ++id)
            if ((optimal & (UINT32_C(1) << id)) != 0) {
                selected = id;
                break;
            }
        if (selected < 0 ||
            !apply_action(world, state,
                          action_from_id(world, (uint8_t)selected), &target))
            return R0_VERIFIER_ERROR;
        if (oracle->distance[pack_state(world->gates, target)] + 1U !=
            remaining)
            return R0_VERIFIER_ERROR;
        state = target;
        --remaining;
    }
    return remaining == 0 ? R0_OK : R0_VERIFIER_ERROR;
}

static R0Status build_corpus(R34Corpus *corpus)
{
    uint8_t gates;
    memset(corpus, 0, sizeof(*corpus));
    for (gates = 1; gates <= R34_TRAINING_MAX_GATES; ++gates) {
        R34World world;
        R34Oracle oracle;
        R0Status status = build_oracle(gates, &oracle);
        if (status != R0_OK) return status;
        identity_world(gates, &world);
        do {
            status = corpus_add_trace(corpus, &world, &oracle);
            if (status != R0_OK) return status;
        } while (next_permutation(world.labels, gates));
    }
    return R0_OK;
}

static void update_semantic(R34Model *model, const R34TrainingCase *item,
                            int action_id_value, int direction)
{
    int16_t features[R34_FEATURE_COUNT];
    uint8_t feature;
    R34Action action = action_from_id(&item->world,
                                      (uint8_t)action_id_value);
    semantic_features(&item->world, item->state, action, features);
    for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
        model->weights[feature] += direction * features[feature];
}

static R0Status train_models(R34Model *semantic, R34HashModel *hashed,
                             R34LookupModel *lookup,
                             R34TrainingReport *report)
{
    R34Corpus corpus;
    uint32_t epoch;
    uint16_t index;
    R0Status status;
    if (semantic == NULL || hashed == NULL || lookup == NULL ||
        report == NULL)
        return R0_INVALID_ARGUMENT;
    memset(semantic, 0, sizeof(*semantic));
    memset(hashed, 0, sizeof(*hashed));
    memset(lookup, 0, sizeof(*lookup));
    memset(report, 0, sizeof(*report));
    status = build_corpus(&corpus);
    if (status != R0_OK) return status;
    report->cases = corpus.count;
    for (epoch = 0; epoch < R34_MAX_EPOCHS; ++epoch) {
        uint32_t mistakes = 0;
        for (index = 0; index < corpus.count; ++index) {
            R34TrainingCase *item = &corpus.cases[index];
            uint32_t all = (UINT32_C(1) <<
                            (2U * item->world.gates + 1U)) - 1U;
            int predicted = select_semantic(semantic, &item->world,
                                            item->state, all);
            if (predicted >= 0 &&
                (item->optimal_actions &
                 (UINT32_C(1) << predicted)) != 0)
                continue;
            {
                int target = select_semantic(semantic, &item->world,
                                             item->state,
                                             item->optimal_actions);
                if (predicted < 0 || target < 0) return R0_POLICY_ERROR;
                update_semantic(semantic, item, target, 1);
                update_semantic(semantic, item, predicted, -1);
                ++mistakes;
            }
        }
        ++report->epochs;
        report->mistakes += mistakes;
        if (mistakes == 0) break;
    }
    for (epoch = 0; epoch < R34_MAX_EPOCHS; ++epoch) {
        uint32_t mistakes = 0;
        for (index = 0; index < corpus.count; ++index) {
            R34TrainingCase *item = &corpus.cases[index];
            uint32_t all = (UINT32_C(1) <<
                            (2U * item->world.gates + 1U)) - 1U;
            int predicted = select_hash(hashed, &item->world,
                                        item->state, all);
            if (predicted >= 0 &&
                (item->optimal_actions &
                 (UINT32_C(1) << predicted)) != 0)
                continue;
            {
                int target = select_hash(hashed, &item->world, item->state,
                                         item->optimal_actions);
                R34Action predicted_action, target_action;
                uint8_t predicted_bucket, target_bucket;
                if (predicted < 0 || target < 0) return R0_POLICY_ERROR;
                predicted_action = action_from_id(
                    &item->world, (uint8_t)predicted);
                target_action = action_from_id(&item->world,
                                               (uint8_t)target);
                predicted_bucket = hash_bucket(&item->world, item->state,
                                               predicted_action);
                target_bucket = hash_bucket(&item->world, item->state,
                                            target_action);
                ++hashed->weights[target_bucket];
                --hashed->weights[predicted_bucket];
                ++mistakes;
            }
        }
        ++report->hash_epochs;
        report->hash_mistakes += mistakes;
        if (mistakes == 0) break;
    }
    for (index = 0; index < corpus.count; ++index) {
        R34TrainingCase *item = &corpus.cases[index];
        uint32_t all = (UINT32_C(1) <<
                        (2U * item->world.gates + 1U)) - 1U;
        int semantic_action = select_semantic(semantic, &item->world,
                                              item->state, all);
        int hash_action = select_hash(hashed, &item->world,
                                      item->state, all);
        if (semantic_action < 0 ||
            (item->optimal_actions &
             (UINT32_C(1) << semantic_action)) == 0)
            ++report->final_errors;
        if (hash_action < 0 ||
            (item->optimal_actions &
             (UINT32_C(1) << hash_action)) == 0)
            ++report->hash_final_errors;
        if (index < R34_LOOKUP_ENTRIES) {
            int target = select_semantic(semantic, &item->world,
                                         item->state,
                                         item->optimal_actions);
            lookup->used[index] = 1;
            lookup->keys[index] = lookup_key(&item->world, item->state);
            lookup->actions[index] = symbolic_action(
                &item->world,
                action_from_id(&item->world, (uint8_t)target));
        }
    }
    for (index = 0; index < R34_FEATURE_COUNT; ++index)
        if (semantic->weights[index] != 0)
            ++report->semantic_nonzero_weights;
    report->semantic_active_weight_bytes = sizeof(semantic->weights);
    report->hash_active_weight_bytes = sizeof(hashed->weights);
    report->lookup_active_bytes =
        sizeof(lookup->keys) + sizeof(lookup->actions) +
        sizeof(lookup->used);
    return report->final_errors == 0 ? R0_OK : R0_POLICY_ERROR;
}

R0Status r34_joint_train_epoch(int32_t weights[R34_FEATURE_COUNT],
                               uint32_t *mistakes, char *error,
                               size_t error_capacity)
{
    R34Corpus corpus;
    R34Model model;
    uint16_t index;
    R0Status status;
    if (weights == NULL || mistakes == NULL) return R0_INVALID_ARGUMENT;
    memcpy(model.weights, weights, sizeof(model.weights));
    *mistakes = 0;
    status = build_corpus(&corpus);
    if (status != R0_OK) return status;
    for (index = 0; index < corpus.count; ++index) {
        R34TrainingCase *item = &corpus.cases[index];
        uint32_t all = (UINT32_C(1) <<
                        (2U * item->world.gates + 1U)) - 1U;
        int predicted = select_semantic(&model, &item->world,
                                        item->state, all);
        if (predicted >= 0 &&
            (item->optimal_actions & (UINT32_C(1) << predicted)) != 0)
            continue;
        {
            int target = select_semantic(&model, &item->world,
                                         item->state,
                                         item->optimal_actions);
            if (predicted < 0 || target < 0) {
                set_error(error, error_capacity,
                          "joint planning epoch could not select an action");
                return R0_POLICY_ERROR;
            }
            update_semantic(&model, item, target, 1);
            update_semantic(&model, item, predicted, -1);
            ++*mistakes;
        }
    }
    memcpy(weights, model.weights, sizeof(model.weights));
    return R0_OK;
}

R0Status r34_joint_training_errors(
    const int32_t weights[R34_FEATURE_COUNT], uint32_t *errors,
    char *error, size_t error_capacity)
{
    R34Corpus corpus;
    R34Model model;
    uint16_t index;
    R0Status status;
    if (weights == NULL || errors == NULL) return R0_INVALID_ARGUMENT;
    memcpy(model.weights, weights, sizeof(model.weights));
    *errors = 0;
    status = build_corpus(&corpus);
    if (status != R0_OK) return status;
    for (index = 0; index < corpus.count; ++index) {
        R34TrainingCase *item = &corpus.cases[index];
        uint32_t all = (UINT32_C(1) <<
                        (2U * item->world.gates + 1U)) - 1U;
        int predicted = select_semantic(&model, &item->world,
                                        item->state, all);
        if (predicted < 0 ||
            (item->optimal_actions & (UINT32_C(1) << predicted)) == 0)
            ++*errors;
    }
    if (*errors > 0)
        set_error(error, error_capacity,
                  "joint planning policy has %u training errors", *errors);
    return R0_OK;
}

static int choose_action(uint8_t policy, const R34Model *semantic,
                         const R34HashModel *hashed,
                         const R34LookupModel *lookup,
                         const R34World *world, R34State state)
{
    uint32_t all =
        (UINT32_C(1) << (2U * world->gates + 1U)) - 1U;
    if (policy == R34_POLICY_SEMANTIC)
        return select_semantic(semantic, world, state, all);
    if (policy == R34_POLICY_GREEDY)
        return select_greedy(world, state);
    if (policy == R34_POLICY_TOOL_ONLY)
        return select_tool_only(world, state);
    if (policy == R34_POLICY_HASH)
        return select_hash(hashed, world, state, all);
    if (policy == R34_POLICY_LOOKUP)
        return select_lookup(lookup, world, state);
    return -1;
}

static R0Status run_plan(uint8_t policy, const R34Model *semantic,
                         const R34HashModel *hashed,
                         const R34LookupModel *lookup,
                         const R34World *world, const R34Oracle *oracle,
                         R34Plan *plan)
{
    R34State state = {0, 0, 0};
    uint16_t distance = oracle->distance[pack_state(world->gates, state)];
    uint8_t oracle_exact = 1;
    memset(plan, 0, sizeof(*plan));
    while (!is_goal(state) && plan->length < R34_MAX_PLAN_STEPS) {
        int selected = choose_action(policy, semantic, hashed, lookup,
                                     world, state);
        R34Action action;
        R34State target;
        uint16_t target_distance;
        uint8_t before_error, after_error;
        if (selected < 0 || selected > 2 * world->gates) break;
        action = action_from_id(world, (uint8_t)selected);
        before_error = goal_error(state);
        if (!apply_action(world, state, action, &target))
            return R0_POLICY_ERROR;
        target_distance =
            oracle->distance[pack_state(world->gates, target)];
        if (target_distance + 1U != distance) oracle_exact = 0;
        after_error = goal_error(target);
        if (after_error > before_error) ++plan->distance_increases;
        if (action.kind == R34_TOGGLE) {
            if ((state.open_gates &
                 (UINT8_C(1) << action.edge)) == 0)
                ++plan->gate_openings;
            else
                ++plan->gate_restorations;
        }
        plan->actions[plan->length++] = (uint8_t)selected;
        state = target;
        distance = target_distance;
    }
    plan->solved = (uint8_t)is_goal(state);
    plan->optimal = (uint8_t)(plan->solved && oracle_exact &&
                              plan->length ==
                                  oracle->distance[pack_state(
                                      world->gates,
                                      (R34State){0, 0, 0})]);
    return R0_OK;
}

static R0Status evaluate(uint8_t policy, const R34Model *semantic,
                         const R34HashModel *hashed,
                         const R34LookupModel *lookup,
                         uint8_t minimum_gates, uint8_t maximum_gates,
                         R34Evaluation *report)
{
    uint8_t gates;
    if (report == NULL || minimum_gates < 1 ||
        maximum_gates > R34_MAX_GATES || minimum_gates > maximum_gates)
        return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    report->minimum_gates = minimum_gates;
    report->maximum_gates = maximum_gates;
    for (gates = minimum_gates; gates <= maximum_gates; ++gates) {
        R34Oracle oracle;
        R34World world, base_world;
        R34Plan base_plan;
        R0Status status = build_oracle(gates, &oracle);
        if (status != R0_OK) return status;
        identity_world(gates, &base_world);
        status = run_plan(policy, semantic, hashed, lookup, &base_world,
                          &oracle, &base_plan);
        if (status != R0_OK) return status;
        identity_world(gates, &world);
        do {
            R34Plan plan;
            uint8_t step;
            status = run_plan(policy, semantic, hashed, lookup, &world,
                              &oracle, &plan);
            if (status != R0_OK) return status;
            ++report->worlds;
            report->oracle_steps +=
                oracle.distance[pack_state(gates,
                                           (R34State){0, 0, 0})];
            report->plan_steps += plan.length;
            report->distance_increases += plan.distance_increases;
            report->opened_goal_correct_gates += plan.gate_openings;
            report->restored_gates += plan.gate_restorations;
            if (plan.distance_increases > 0)
                ++report->nonmonotonic_worlds;
            if (plan.solved) ++report->solved;
            if (plan.optimal)
                ++report->optimal;
            else
                ++report->failed;
            if (policy == R34_POLICY_SEMANTIC) {
                report->relabel_steps += base_plan.length;
                for (step = 0; step < base_plan.length; ++step)
                    if (step < plan.length &&
                        base_plan.actions[step] == plan.actions[step])
                        ++report->relabel_exact;
            }
        } while (next_permutation(world.labels, gates));
        if (report->worlds < factorial(gates)) return R0_VERIFIER_ERROR;
    }
    report->exact = (uint8_t)(report->optimal == report->worlds &&
                              report->failed == 0);
    return R0_OK;
}

R0Status r34_joint_evaluate_development(
    const int32_t weights[R34_FEATURE_COUNT], R34Evaluation *report,
    char *error, size_t error_capacity)
{
    return r34_joint_evaluate_gates(
        weights, R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
        report, error, error_capacity);
}

R0Status r34_joint_evaluate_gates(
    const int32_t weights[R34_FEATURE_COUNT], uint8_t minimum_gates,
    uint8_t maximum_gates, R34Evaluation *report, char *error,
    size_t error_capacity)
{
    R34Model model;
    R34HashModel hashed;
    R34LookupModel lookup;
    R0Status status;
    if (weights == NULL || report == NULL) return R0_INVALID_ARGUMENT;
    memcpy(model.weights, weights, sizeof(model.weights));
    memset(&hashed, 0, sizeof(hashed));
    memset(&lookup, 0, sizeof(lookup));
    status = evaluate(R34_POLICY_SEMANTIC, &model, &hashed, &lookup,
                      minimum_gates, maximum_gates, report);
    if (status == R0_OK && !report->exact)
        set_error(error, error_capacity,
                  "joint planning gate range %u-%u did not pass",
                  minimum_gates, maximum_gates);
    return status;
}

static uint32_t required_gate_events(uint8_t minimum_gates,
                                     uint8_t maximum_gates)
{
    uint32_t events = 0;
    uint8_t gates;
    for (gates = minimum_gates; gates <= maximum_gates; ++gates)
        events += gates * factorial(gates);
    return events;
}

static uint64_t fnv1a(const void *data, size_t size)
{
    const unsigned char *bytes = data;
    uint64_t hash = UINT64_C(1469598103934665603);
    size_t index;
    for (index = 0; index < size; ++index) {
        hash ^= bytes[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

R0Status r34_run_development(R34ExperimentReport *report, char *error,
                              size_t error_capacity)
{
    R34Model semantic;
    R34HashModel hashed;
    R34LookupModel lookup;
    R0Status status;
    uint32_t required;
    if (report == NULL) return R0_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = train_models(&semantic, &hashed, &lookup, &report->training);
    if (status != R0_OK) {
        set_error(error, error_capacity, "semantic training did not separate");
        return status;
    }
    memcpy(report->semantic_weights, semantic.weights,
           sizeof(report->semantic_weights));
    status = evaluate(R34_POLICY_SEMANTIC, &semantic, &hashed, &lookup,
                      R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
                      &report->development_semantic);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_GREEDY, &semantic, &hashed, &lookup,
                          R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
                          &report->development_greedy);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_TOOL_ONLY, &semantic, &hashed, &lookup,
                          R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
                          &report->development_tool_only);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_HASH, &semantic, &hashed, &lookup,
                          R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
                          &report->development_hash);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_LOOKUP, &semantic, &hashed, &lookup,
                          R34_DEVELOPMENT_GATES, R34_DEVELOPMENT_GATES,
                          &report->development_lookup);
    if (status != R0_OK) {
        set_error(error, error_capacity, "development evaluation failed");
        return status;
    }
    required = required_gate_events(R34_DEVELOPMENT_GATES,
                                    R34_DEVELOPMENT_GATES);
    report->development_gate_passed = (uint8_t)(
        report->development_semantic.exact &&
        report->development_semantic.nonmonotonic_worlds ==
            report->development_semantic.worlds &&
        report->development_semantic.opened_goal_correct_gates == required &&
        report->development_semantic.restored_gates == required &&
        report->development_semantic.relabel_exact ==
            report->development_semantic.relabel_steps &&
        !report->development_greedy.exact &&
        !report->development_tool_only.exact &&
        !report->development_hash.exact &&
        !report->development_lookup.exact &&
        report->training.semantic_active_weight_bytes <=
            report->training.hash_active_weight_bytes);
    return R0_OK;
}

R0Status r34_run_sealed(R34ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R34Model semantic;
    R34HashModel hashed;
    R34LookupModel lookup;
    R0Status status;
    uint32_t required;
    status = r34_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "sealed run blocked by the development gate");
        return R0_SEAL_ERROR;
    }
    status = train_models(&semantic, &hashed, &lookup, &report->training);
    if (status != R0_OK) return status;
    memcpy(report->semantic_weights, semantic.weights,
           sizeof(report->semantic_weights));
    status = evaluate(R34_POLICY_SEMANTIC, &semantic, &hashed, &lookup,
                      R34_SEALED_MIN_GATES, R34_SEALED_MAX_GATES,
                      &report->sealed_semantic);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_GREEDY, &semantic, &hashed, &lookup,
                          R34_SEALED_MIN_GATES, R34_SEALED_MAX_GATES,
                          &report->sealed_greedy);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_TOOL_ONLY, &semantic, &hashed, &lookup,
                          R34_SEALED_MIN_GATES, R34_SEALED_MAX_GATES,
                          &report->sealed_tool_only);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_HASH, &semantic, &hashed, &lookup,
                          R34_SEALED_MIN_GATES, R34_SEALED_MAX_GATES,
                          &report->sealed_hash);
    if (status == R0_OK)
        status = evaluate(R34_POLICY_LOOKUP, &semantic, &hashed, &lookup,
                          R34_SEALED_MIN_GATES, R34_SEALED_MAX_GATES,
                          &report->sealed_lookup);
    if (status != R0_OK) return status;
    required = required_gate_events(R34_SEALED_MIN_GATES,
                                    R34_SEALED_MAX_GATES);
    report->sealed_gate_passed = (uint8_t)(
        report->sealed_semantic.exact &&
        report->sealed_semantic.nonmonotonic_worlds ==
            report->sealed_semantic.worlds &&
        report->sealed_semantic.opened_goal_correct_gates == required &&
        report->sealed_semantic.restored_gates == required &&
        report->sealed_semantic.relabel_exact ==
            report->sealed_semantic.relabel_steps &&
        !report->sealed_greedy.exact &&
        !report->sealed_tool_only.exact &&
        !report->sealed_hash.exact &&
        !report->sealed_lookup.exact);
    report->result_digest = 0;
    report->result_digest = fnv1a(report, sizeof(*report));
    return R0_OK;
}

static void write_evaluation(FILE *file, const R34Evaluation *evaluation)
{
    fprintf(file,
            "{\"minimum_gates\":%u,\"maximum_gates\":%u,"
            "\"worlds\":%u,\"solved\":%u,\"optimal\":%u,"
            "\"failed\":%u,\"plan_steps\":%u,\"oracle_steps\":%u,"
            "\"nonmonotonic_worlds\":%u,\"distance_increases\":%u,"
            "\"opened_goal_correct_gates\":%u,\"restored_gates\":%u,"
            "\"relabel_steps\":%u,\"relabel_exact\":%u,\"exact\":%s}",
            evaluation->minimum_gates, evaluation->maximum_gates,
            evaluation->worlds, evaluation->solved, evaluation->optimal,
            evaluation->failed, evaluation->plan_steps,
            evaluation->oracle_steps, evaluation->nonmonotonic_worlds,
            evaluation->distance_increases,
            evaluation->opened_goal_correct_gates,
            evaluation->restored_gates, evaluation->relabel_steps,
            evaluation->relabel_exact,
            evaluation->exact ? "true" : "false");
}

R0Status r34_write_result(const R34ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    uint8_t index;
    if (report == NULL || path == NULL || path[0] == '\0')
        return R0_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    fprintf(file,
            "{\n  \"schema\": \"zero.reasoner34_nonmonotonic_planning.v1\",\n"
            "  \"version\": \"(3,3,2)\",\n"
            "  \"training_worlds\": [1, 2, 3],\n"
            "  \"development_world\": 4,\n"
            "  \"sealed_worlds\": [5, 6, 7],\n"
            "  \"training\": {\"cases\":%u,\"epochs\":%u,"
            "\"mistakes\":%u,\"final_errors\":%u,"
            "\"hash_epochs\":%u,\"hash_mistakes\":%u,"
            "\"hash_final_errors\":%u,"
            "\"semantic_nonzero_weights\":%u,"
            "\"semantic_active_weight_bytes\":%u,"
            "\"hash_active_weight_bytes\":%u,"
            "\"lookup_active_bytes\":%u},\n",
            report->training.cases, report->training.epochs,
            report->training.mistakes, report->training.final_errors,
            report->training.hash_epochs, report->training.hash_mistakes,
            report->training.hash_final_errors,
            report->training.semantic_nonzero_weights,
            report->training.semantic_active_weight_bytes,
            report->training.hash_active_weight_bytes,
            report->training.lookup_active_bytes);
    fputs("  \"semantic_weights\": [", file);
    for (index = 0; index < R34_FEATURE_COUNT; ++index)
        fprintf(file, "%s%d", index == 0 ? "" : ",",
                report->semantic_weights[index]);
    fputs("],\n  \"development\": {\"semantic\":", file);
    write_evaluation(file, &report->development_semantic);
    fputs(",\"greedy_distance\":", file);
    write_evaluation(file, &report->development_greedy);
    fputs(",\"tool_only\":", file);
    write_evaluation(file, &report->development_tool_only);
    fputs(",\"hash\":", file);
    write_evaluation(file, &report->development_hash);
    fputs(",\"lookup\":", file);
    write_evaluation(file, &report->development_lookup);
    fputs("},\n  \"sealed\": {\"semantic\":", file);
    write_evaluation(file, &report->sealed_semantic);
    fputs(",\"greedy_distance\":", file);
    write_evaluation(file, &report->sealed_greedy);
    fputs(",\"tool_only\":", file);
    write_evaluation(file, &report->sealed_tool_only);
    fputs(",\"hash\":", file);
    write_evaluation(file, &report->sealed_hash);
    fputs(",\"lookup\":", file);
    write_evaluation(file, &report->sealed_lookup);
    fprintf(file,
            "},\n  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->result_digest);
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot close %s: %s", path,
                  strerror(errno));
        return R0_IO_ERROR;
    }
    return R0_OK;
}
