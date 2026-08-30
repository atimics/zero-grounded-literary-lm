#include "reasoner333.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R333_FNV_OFFSET UINT64_C(1469598103934665603)
#define R333_FNV_PRIME UINT64_C(1099511628211)

enum {
    R333_TRAINING = 0,
    R333_DEVELOPMENT = 1,
    R333_SEALED = 2,
    R333_POSITIVE = 1,
    R333_NEGATIVE = 2,
    R333_MAX_TRAINING_CASES = 12,
    R333_MAX_EPOCHS = 32
};

typedef struct {
    int8_t values[R333_MAX_VARIABLES];
} R333State;

typedef struct {
    uint8_t left;
    uint8_t right;
    int8_t constant;
    uint8_t bridge;
} R333Atom;

typedef struct {
    uint8_t variables;
    uint8_t module_width;
    uint8_t module_count;
    uint8_t edge_count;
    uint8_t action_count;
    R333Atom atoms[R333_MAX_ACTIONS];
    uint64_t target_mask;
} R333Task;

typedef struct {
    uint8_t accepted;
    uint8_t kind;
    R333State source;
    R333State repair;
} R333Verification;

typedef struct {
    R333Task task;
    uint64_t mask;
    uint64_t optimal;
    R333Verification verification;
} R333Case;

typedef struct {
    R333Case cases[R333_MAX_TRAINING_CASES];
    uint32_t count;
} R333Corpus;

typedef enum {
    R333_ARM_SEMANTIC = 0,
    R333_ARM_LOOKUP = 1
} R333Arm;

static void set_error(char *error, size_t capacity, const char *format, ...)
{
    va_list arguments;
    if (error == NULL || capacity == 0) return;
    va_start(arguments, format);
    (void)vsnprintf(error, capacity, format, arguments);
    va_end(arguments);
}

const char *r333_status_name(R333Status status)
{
    switch (status) {
    case R333_OK: return "ok";
    case R333_INVALID_ARGUMENT: return "invalid argument";
    case R333_LIMIT_ERROR: return "limit error";
    case R333_VERIFIER_ERROR: return "verifier error";
    case R333_POLICY_ERROR: return "policy error";
    case R333_IO_ERROR: return "I/O error";
    }
    return "unknown";
}

uint32_t r333_training_program_count(void) { return 3; }
uint32_t r333_development_program_count(void) { return 15; }
uint32_t r333_sealed_program_count(void) { return 63; }

static int popcount64(uint64_t value)
{
    int count = 0;
    while (value != 0) {
        count += (int)(value & UINT64_C(1));
        value >>= 1;
    }
    return count;
}

static uint32_t integer_power(uint32_t base, uint8_t exponent)
{
    uint32_t result = 1;
    while (exponent-- > 0) result *= base;
    return result;
}

static R333State state_from_index(uint8_t variables, uint32_t index)
{
    R333State state;
    int variable;
    memset(&state, 0, sizeof(state));
    for (variable = variables - 1; variable >= 0; --variable) {
        state.values[variable] = (int8_t)((int)(index % 3U) - 1);
        index /= 3U;
    }
    return state;
}

static int atom_slack(const R333Atom *atom, const R333State *state)
{
    return atom->constant -
           (state->values[atom->left] - state->values[atom->right]);
}

static int atom_holds(const R333Atom *atom, const R333State *state)
{
    return atom_slack(atom, state) >= 0;
}

static int mask_holds(const R333Task *task, uint64_t mask,
                      const R333State *state)
{
    uint8_t action;
    for (action = 0; action < task->action_count; ++action)
        if ((mask & (UINT64_C(1) << action)) != 0 &&
            !atom_holds(&task->atoms[action], state))
            return 0;
    return 1;
}

static void make_permutation(uint8_t variables, uint8_t relabeling,
                             uint8_t permutation[R333_MAX_VARIABLES])
{
    uint8_t variable;
    for (variable = 0; variable < variables; ++variable)
        permutation[variable] = variable;
    if (relabeling == 1) {
        for (variable = 0; variable < variables; ++variable)
            permutation[variable] = (uint8_t)((variable + 1U) % variables);
    } else if (relabeling == 2) {
        for (variable = 0; variable < variables; ++variable)
            permutation[variable] = (uint8_t)(variables - 1U - variable);
    } else if (relabeling == 3) {
        for (variable = 0; variable + 1U < variables; variable += 2) {
            permutation[variable] = (uint8_t)(variable + 1U);
            permutation[variable + 1U] = variable;
        }
    } else if (relabeling == 4) {
        uint8_t cursor = 0;
        for (variable = 0; variable < variables; variable += 2)
            permutation[cursor++] = variable;
        for (variable = 1; variable < variables; variable += 2)
            permutation[cursor++] = variable;
    }
}

static void add_edge(R333Task *task, uint8_t parent, uint8_t child,
                     uint8_t bridge, int parent_label, int child_label,
                     const uint8_t permutation[R333_MAX_VARIABLES])
{
    int orientation, constant;
    int delta = child_label - parent_label;
    uint8_t edge = task->edge_count++;
    for (orientation = 0; orientation < 2; ++orientation) {
        for (constant = -1; constant <= 1; ++constant) {
            uint8_t action = (uint8_t)(edge * R333_ACTIONS_PER_EDGE +
                                       orientation * 3 + constant + 1);
            R333Atom *atom = &task->atoms[action];
            atom->left = permutation[orientation == 0 ? child : parent];
            atom->right = permutation[orientation == 0 ? parent : child];
            atom->constant = (int8_t)constant;
            atom->bridge = bridge;
            if ((orientation == 0 && constant == delta) ||
                (orientation == 1 && constant == -delta))
                task->target_mask |= UINT64_C(1) << action;
        }
    }
    task->action_count =
        (uint8_t)(task->edge_count * R333_ACTIONS_PER_EDGE);
}

static R333Status build_task(uint8_t role, uint32_t program,
                             uint8_t relabeling, R333Task *task)
{
    uint8_t labels[R333_MAX_VARIABLES] = {0};
    uint8_t permutation[R333_MAX_VARIABLES];
    uint8_t module, offset;
    uint32_t code;
    if (task == NULL || relabeling > R333_RELABELINGS)
        return R333_INVALID_ARGUMENT;
    memset(task, 0, sizeof(*task));
    if (role == R333_TRAINING) {
        if (program >= r333_training_program_count() || relabeling != 0)
            return R333_INVALID_ARGUMENT;
        task->variables = 2;
        task->module_width = 2;
        task->module_count = 1;
        labels[0] = 0;
        labels[1] = (uint8_t)program;
        if (program == 2) {
            labels[0] = 1;
            labels[1] = 0;
        }
    } else if (role == R333_DEVELOPMENT) {
        if (program >= r333_development_program_count())
            return R333_INVALID_ARGUMENT;
        task->variables = 4;
        task->module_width = 2;
        task->module_count = 2;
        code = program + 1U;
        for (offset = 0; offset < task->variables; ++offset)
            labels[offset] = (uint8_t)((code >> offset) & 1U);
    } else if (role == R333_SEALED) {
        if (program >= r333_sealed_program_count())
            return R333_INVALID_ARGUMENT;
        task->variables = 9;
        task->module_width = 3;
        task->module_count = 3;
        code = program + 1U;
        for (offset = 0; offset < 6; ++offset)
            labels[offset] = (uint8_t)((code >> offset) & 1U);
        labels[6] = (uint8_t)(labels[0] ^ labels[3]);
        labels[7] = (uint8_t)(labels[1] ^ labels[4]);
        labels[8] = (uint8_t)(labels[2] ^ labels[5]);
    } else {
        return R333_INVALID_ARGUMENT;
    }
    make_permutation(task->variables, relabeling, permutation);
    for (module = 0; module < task->module_count; ++module) {
        uint8_t base = (uint8_t)(module * task->module_width);
        for (offset = 0; offset + 1U < task->module_width; ++offset)
            add_edge(task, (uint8_t)(base + offset),
                     (uint8_t)(base + offset + 1U), 0,
                     labels[base + offset], labels[base + offset + 1U],
                     permutation);
    }
    for (module = 0; module + 1U < task->module_count; ++module) {
        uint8_t parent =
            (uint8_t)((module + 1U) * task->module_width - 1U);
        uint8_t child = (uint8_t)(parent + 1U);
        add_edge(task, parent, child, 1, labels[parent], labels[child],
                 permutation);
    }
    return task->edge_count <= R333_MAX_EDGES &&
                   task->action_count <= R333_MAX_ACTIONS
               ? R333_OK
               : R333_LIMIT_ERROR;
}

static int state_distance(uint8_t variables, const R333State *left,
                          const R333State *right)
{
    int distance = 0;
    uint8_t variable;
    for (variable = 0; variable < variables; ++variable)
        distance += abs(left->values[variable] - right->values[variable]);
    return distance;
}

static R333Status verify(const R333Task *task, uint64_t mask,
                         R333Verification *verification)
{
    uint32_t index, states, first_negative = UINT32_MAX;
    if (task == NULL || verification == NULL ||
        (mask >> task->action_count) != 0)
        return R333_INVALID_ARGUMENT;
    memset(verification, 0, sizeof(*verification));
    states = integer_power(3, task->variables);
    for (index = 0; index < states; ++index) {
        R333State state = state_from_index(task->variables, index);
        int target = mask_holds(task, task->target_mask, &state);
        int candidate = mask_holds(task, mask, &state);
        if (target && !candidate) {
            verification->kind = R333_POSITIVE;
            verification->source = state;
            verification->repair = state;
            return R333_OK;
        }
        if (!target && candidate && first_negative == UINT32_MAX)
            first_negative = index;
    }
    if (first_negative != UINT32_MAX) {
        int best_distance = INT_MAX;
        verification->kind = R333_NEGATIVE;
        verification->source =
            state_from_index(task->variables, first_negative);
        for (index = 0; index < states; ++index) {
            R333State state = state_from_index(task->variables, index);
            int distance;
            if (!mask_holds(task, task->target_mask, &state)) continue;
            distance = state_distance(task->variables,
                                      &verification->source, &state);
            if (distance < best_distance) {
                best_distance = distance;
                verification->repair = state;
            }
        }
        return best_distance == INT_MAX ? R333_VERIFIER_ERROR : R333_OK;
    }
    verification->accepted = 1;
    return R333_OK;
}

static uint64_t legal_actions(const R333Task *task, uint64_t mask,
                              const R333Verification *verification,
                              R333FeedbackMode mode)
{
    uint64_t legal = 0;
    uint8_t action;
    for (action = 0; action < task->action_count; ++action) {
        uint64_t bit = UINT64_C(1) << action;
        int active = (mask & bit) != 0;
        if (mode == R333_MODULE_ONLY && task->atoms[action].bridge)
            continue;
        if (verification->kind == R333_POSITIVE && active &&
            !atom_holds(&task->atoms[action], &verification->source))
            legal |= bit;
        if (verification->kind == R333_NEGATIVE && !active &&
            !atom_holds(&task->atoms[action], &verification->source))
            legal |= bit;
    }
    return legal;
}

static void semantic_features(const R333Task *task, uint64_t mask,
                              const R333Verification *verification,
                              uint8_t action, R333FeedbackMode mode,
                              int16_t features[R333_FEATURE_COUNT])
{
    const R333Atom *atom = &task->atoms[action];
    uint64_t bit = UINT64_C(1) << action;
    int adding = (mask & bit) == 0;
    int source_slack, repair_slack;
    memset(features, 0, sizeof(int16_t) * R333_FEATURE_COUNT);
    if (mode == R333_TOOL_ONLY) return;
    features[0] = 1;
    features[1] = (int16_t)adding;
    features[2] = (int16_t)!adding;
    if (mode == R333_BRIDGE_MASKED && atom->bridge) return;
    source_slack = atom_slack(atom, &verification->source);
    repair_slack = atom_slack(atom, &verification->repair);
    features[3] = (int16_t)(source_slack >= 0);
    features[4] = (int16_t)(repair_slack >= 0);
    features[5] = (int16_t)(repair_slack == 0);
    features[6] = (int16_t)(adding && repair_slack >= 0);
    features[7] = (int16_t)(adding && repair_slack == 0);
    features[8] =
        (int16_t)(adding && repair_slack >= 0 && repair_slack == 0);
    features[9] = (int16_t)(!adding && source_slack < 0);
    features[10] = (int16_t)source_slack;
    features[11] = (int16_t)repair_slack;
    features[12] = (int16_t)(repair_slack - source_slack);
    features[13] = (int16_t)abs(source_slack);
    features[14] = (int16_t)abs(repair_slack);
    features[15] = atom->constant;
}

static int64_t semantic_score(const R333Model *model,
                              const int16_t features[R333_FEATURE_COUNT])
{
    int64_t score = 0;
    uint8_t feature;
    for (feature = 0; feature < R333_FEATURE_COUNT; ++feature)
        score += (int64_t)model->weights[feature] * features[feature];
    return score;
}

static int semantic_select(const R333Model *model, const R333Task *task,
                           uint64_t mask,
                           const R333Verification *verification,
                           R333FeedbackMode mode)
{
    uint64_t legal = legal_actions(task, mask, verification, mode);
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < task->action_count; ++action) {
        int16_t features[R333_FEATURE_COUNT];
        int64_t score;
        if ((legal & (UINT64_C(1) << action)) == 0) continue;
        semantic_features(task, mask, verification, (uint8_t)action, mode,
                          features);
        score = semantic_score(model, features);
        if (score > best_score) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static int oracle_select(const R333Model *model, const R333Case *item)
{
    int action, best = -1;
    int64_t best_score = INT64_MIN;
    for (action = 0; action < item->task.action_count; ++action) {
        int16_t features[R333_FEATURE_COUNT];
        int64_t score;
        if ((item->optimal & (UINT64_C(1) << action)) == 0) continue;
        semantic_features(&item->task, item->mask, &item->verification,
                          (uint8_t)action, R333_FULL_FEEDBACK, features);
        score = semantic_score(model, features);
        if (score > best_score) {
            best = action;
            best_score = score;
        }
    }
    return best;
}

static void update(R333Model *model, const R333Case *item, int action,
                   int direction)
{
    int16_t features[R333_FEATURE_COUNT];
    uint8_t feature;
    semantic_features(&item->task, item->mask, &item->verification,
                      (uint8_t)action, R333_FULL_FEEDBACK, features);
    for (feature = 0; feature < R333_FEATURE_COUNT; ++feature)
        model->weights[feature] += direction * features[feature];
}

static R333Status build_training_corpus(R333Corpus *corpus)
{
    uint32_t program;
    memset(corpus, 0, sizeof(*corpus));
    for (program = 0; program < r333_training_program_count(); ++program) {
        R333Task task;
        uint64_t mask = 0;
        R333Status status = build_task(R333_TRAINING, program, 0, &task);
        if (status != R333_OK) return status;
        while (mask != task.target_mask) {
            R333Case *item;
            uint64_t legal, optimal;
            int action;
            R333Verification verification;
            status = verify(&task, mask, &verification);
            if (status != R333_OK || verification.accepted)
                return R333_VERIFIER_ERROR;
            legal = legal_actions(&task, mask, &verification,
                                  R333_FULL_FEEDBACK);
            optimal = legal & (task.target_mask ^ mask);
            if (optimal == 0 || corpus->count >= R333_MAX_TRAINING_CASES)
                return R333_POLICY_ERROR;
            item = &corpus->cases[corpus->count++];
            item->task = task;
            item->mask = mask;
            item->optimal = optimal;
            item->verification = verification;
            action = 0;
            while ((optimal & (UINT64_C(1) << action)) == 0) ++action;
            mask ^= UINT64_C(1) << action;
        }
    }
    return R333_OK;
}

static uint64_t fnv_byte(uint64_t hash, uint8_t byte)
{
    return (hash ^ byte) * R333_FNV_PRIME;
}

static uint32_t lookup_key(const R333Task *task, uint64_t mask,
                           const R333Verification *verification)
{
    uint64_t hash = R333_FNV_OFFSET;
    uint8_t variable, byte;
    hash = fnv_byte(hash, task->variables);
    hash = fnv_byte(hash, verification->kind);
    for (byte = 0; byte < 8; ++byte)
        hash = fnv_byte(hash, (uint8_t)(mask >> (byte * 8)));
    for (variable = 0; variable < task->variables; ++variable) {
        hash = fnv_byte(
            hash, (uint8_t)(verification->source.values[variable] + 1));
        hash = fnv_byte(
            hash, (uint8_t)(verification->repair.values[variable] + 1));
    }
    return (uint32_t)(hash ^ (hash >> 32));
}

static int lookup_select(const R333Lookup *lookup, const R333Task *task,
                         uint64_t mask,
                         const R333Verification *verification)
{
    uint64_t legal = legal_actions(task, mask, verification,
                                   R333_FULL_FEEDBACK);
    uint32_t key = lookup_key(task, mask, verification);
    uint32_t slot;
    int action;
    for (slot = 0; slot < lookup->count; ++slot)
        if (lookup->keys[slot] == key &&
            (legal & (UINT64_C(1) << lookup->actions[slot])) != 0)
            return lookup->actions[slot];
    for (action = 0; action < task->action_count; ++action)
        if ((legal & (UINT64_C(1) << action)) != 0) return action;
    return -1;
}

static R333Status train_models(R333Model *model, R333Lookup *lookup,
                               R333TrainingReport *report)
{
    R333Corpus corpus;
    uint32_t epoch, index;
    R333Status status;
    memset(model, 0, sizeof(*model));
    memset(lookup, 0, sizeof(*lookup));
    memset(report, 0, sizeof(*report));
    status = build_training_corpus(&corpus);
    if (status != R333_OK) return status;
    for (epoch = 0; epoch < R333_MAX_EPOCHS; ++epoch) {
        uint32_t mistakes = 0;
        for (index = 0; index < corpus.count; ++index) {
            R333Case *item = &corpus.cases[index];
            int predicted = semantic_select(model, &item->task, item->mask,
                                            &item->verification,
                                            R333_FULL_FEEDBACK);
            if (predicted >= 0 &&
                (item->optimal & (UINT64_C(1) << predicted)) != 0)
                continue;
            {
                int target = oracle_select(model, item);
                if (predicted < 0 || target < 0) return R333_POLICY_ERROR;
                update(model, item, target, 1);
                update(model, item, predicted, -1);
                ++mistakes;
            }
        }
        ++report->epochs;
        report->mistakes += mistakes;
        if (mistakes == 0) break;
    }
    report->cases = corpus.count;
    for (index = 0; index < corpus.count; ++index) {
        R333Case *item = &corpus.cases[index];
        int predicted = semantic_select(model, &item->task, item->mask,
                                        &item->verification,
                                        R333_FULL_FEEDBACK);
        int target = oracle_select(model, item);
        uint32_t key = lookup_key(&item->task, item->mask,
                                  &item->verification);
        uint32_t slot;
        if (predicted < 0 ||
            (item->optimal & (UINT64_C(1) << predicted)) == 0)
            ++report->final_errors;
        for (slot = 0; slot < lookup->count; ++slot)
            if (lookup->keys[slot] == key) break;
        if (slot == lookup->count) {
            if (lookup->count >= R333_LOOKUP_SLOTS)
                return R333_LIMIT_ERROR;
            ++lookup->count;
        }
        lookup->keys[slot] = key;
        lookup->actions[slot] = (uint8_t)target;
    }
    report->lookup_cases = corpus.count;
    for (index = 0; index < corpus.count; ++index) {
        R333Case *item = &corpus.cases[index];
        int predicted = lookup_select(lookup, &item->task, item->mask,
                                      &item->verification);
        if (predicted < 0 ||
            (item->optimal & (UINT64_C(1) << predicted)) == 0)
            ++report->lookup_errors;
    }
    for (index = 0; index < R333_FEATURE_COUNT; ++index)
        if (model->weights[index] != 0) ++report->nonzero_weights;
    report->semantic_bytes = sizeof(model->weights);
    report->lookup_bytes = sizeof(*lookup);
    return report->final_errors == 0 && report->lookup_errors == 0
               ? R333_OK
               : R333_POLICY_ERROR;
}

static R333Status run_trace(const R333Model *model,
                            const R333Lookup *lookup, const R333Task *task,
                            R333Arm arm, R333FeedbackMode mode,
                            uint32_t *calls, uint8_t *accepted)
{
    uint64_t mask = 0;
    *calls = 0;
    *accepted = 0;
    while (*calls <= R333_MAX_STEPS) {
        R333Verification verification;
        int action;
        R333Status status = verify(task, mask, &verification);
        if (status != R333_OK) return status;
        if (verification.accepted) {
            *accepted = 1;
            return R333_OK;
        }
        if (*calls == R333_MAX_STEPS) return R333_OK;
        action = arm == R333_ARM_LOOKUP
                     ? lookup_select(lookup, task, mask, &verification)
                     : semantic_select(model, task, mask, &verification,
                                       mode);
        if (action < 0) return R333_OK;
        mask ^= UINT64_C(1) << action;
        ++*calls;
    }
    return R333_OK;
}

static R333Status evaluate(const R333Model *model,
                           const R333Lookup *lookup, uint8_t role,
                           R333Arm arm, R333FeedbackMode mode,
                           uint8_t check_relabelings,
                           R333Evaluation *report)
{
    uint32_t program, programs = role == R333_DEVELOPMENT
                                     ? r333_development_program_count()
                                     : r333_sealed_program_count();
    memset(report, 0, sizeof(*report));
    report->programs = programs;
    for (program = 0; program < programs; ++program) {
        R333Task task;
        uint32_t calls;
        uint8_t accepted;
        R333Status status = build_task(role, program, 0, &task);
        if (status == R333_OK)
            status = run_trace(model, lookup, &task, arm, mode, &calls,
                               &accepted);
        if (status != R333_OK) return status;
        report->verifier_calls += calls;
        if (!accepted) {
            ++report->failed;
        } else {
            ++report->solved;
            if (calls == (uint32_t)popcount64(task.target_mask))
                ++report->minimal;
            else
                ++report->excess_edits;
        }
        if (check_relabelings) {
            uint8_t relabeling;
            for (relabeling = 1; relabeling <= R333_RELABELINGS;
                 ++relabeling) {
                R333Task changed;
                uint32_t changed_calls;
                uint8_t changed_accepted;
                status = build_task(role, program, relabeling, &changed);
                if (status == R333_OK)
                    status = run_trace(model, lookup, &changed, arm, mode,
                                       &changed_calls, &changed_accepted);
                if (status != R333_OK) return status;
                ++report->relabel_cases;
                if (changed_accepted &&
                    changed_calls ==
                        (uint32_t)popcount64(changed.target_mask))
                    ++report->relabel_exact;
            }
        }
    }
    report->exact =
        (uint8_t)(report->minimal == report->programs &&
                  (!check_relabelings ||
                   report->relabel_exact == report->relabel_cases));
    return R333_OK;
}

static R333Status evaluate_role(const R333Model *model,
                                const R333Lookup *lookup, uint8_t role,
                                R333Evaluation *semantic,
                                R333Evaluation *lookup_report,
                                R333Evaluation *bridge_masked,
                                R333Evaluation *module_only,
                                R333Evaluation *tool_only)
{
    R333Status status = evaluate(model, lookup, role, R333_ARM_SEMANTIC,
                                 R333_FULL_FEEDBACK, 1, semantic);
    if (status == R333_OK)
        status = evaluate(model, lookup, role, R333_ARM_LOOKUP,
                          R333_FULL_FEEDBACK, 0, lookup_report);
    if (status == R333_OK)
        status = evaluate(model, lookup, role, R333_ARM_SEMANTIC,
                          R333_BRIDGE_MASKED, 0, bridge_masked);
    if (status == R333_OK)
        status = evaluate(model, lookup, role, R333_ARM_SEMANTIC,
                          R333_MODULE_ONLY, 0, module_only);
    if (status == R333_OK)
        status = evaluate(model, lookup, role, R333_ARM_SEMANTIC,
                          R333_TOOL_ONLY, 0, tool_only);
    return status;
}

R333Status r333_run_development(R333ExperimentReport *report, char *error,
                                size_t error_capacity)
{
    R333Model model;
    R333Lookup lookup;
    R333Status status;
    if (report == NULL) return R333_INVALID_ARGUMENT;
    memset(report, 0, sizeof(*report));
    status = train_models(&model, &lookup, &report->training);
    if (status == R333_OK)
        status = evaluate_role(
            &model, &lookup, R333_DEVELOPMENT, &report->development,
            &report->development_lookup,
            &report->development_bridge_masked,
            &report->development_module_only,
            &report->development_tool_only);
    memcpy(report->semantic_weights, model.weights,
           sizeof(report->semantic_weights));
    report->semantic_bytes = sizeof(model.weights);
    report->lookup_bytes = sizeof(lookup);
    report->development_gate_passed =
        (uint8_t)(status == R333_OK && report->development.exact &&
                  report->training.final_errors == 0 &&
                  report->training.lookup_errors == 0 &&
                  report->semantic_bytes <= report->lookup_bytes);
    if (status == R333_OK && !report->development_gate_passed) {
        set_error(error, error_capacity,
                  "development composition gate did not pass");
        return R333_POLICY_ERROR;
    }
    return status;
}

static uint64_t digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte)
        hash = fnv_byte(hash, (uint8_t)(value >> (byte * 8)));
    return hash;
}

static uint64_t experiment_digest(const R333ExperimentReport *report)
{
    const R333Evaluation *arms[] = {
        &report->semantic, &report->lookup, &report->bridge_masked,
        &report->module_only, &report->tool_only,
    };
    uint64_t hash = R333_FNV_OFFSET;
    uint8_t arm, feature;
    for (arm = 0; arm < 5; ++arm) {
        hash = digest_u64(hash, arms[arm]->programs);
        hash = digest_u64(hash, arms[arm]->solved);
        hash = digest_u64(hash, arms[arm]->minimal);
        hash = digest_u64(hash, arms[arm]->failed);
        hash = digest_u64(hash, arms[arm]->excess_edits);
        hash = digest_u64(hash, arms[arm]->relabel_cases);
        hash = digest_u64(hash, arms[arm]->relabel_exact);
    }
    for (feature = 0; feature < R333_FEATURE_COUNT; ++feature)
        hash = digest_u64(
            hash, (uint64_t)(uint32_t)report->semantic_weights[feature]);
    hash = digest_u64(hash, report->sealed_gate_passed);
    return hash;
}

R333Status r333_run_sealed(R333ExperimentReport *report, char *error,
                           size_t error_capacity)
{
    R333Model model;
    R333Lookup lookup;
    R333Status status = r333_run_development(report, error, error_capacity);
    if (status != R333_OK) return status;
    status = train_models(&model, &lookup, &report->training);
    if (status == R333_OK)
        status = evaluate_role(&model, &lookup, R333_SEALED,
                               &report->semantic, &report->lookup,
                               &report->bridge_masked, &report->module_only,
                               &report->tool_only);
    if (status != R333_OK) return status;
    report->sealed_gate_passed =
        (uint8_t)(report->development_gate_passed &&
                  report->semantic.exact && !report->lookup.exact &&
                  !report->bridge_masked.exact &&
                  !report->module_only.exact &&
                  !report->tool_only.exact &&
                  report->semantic_bytes <= report->lookup_bytes);
    report->result_digest = experiment_digest(report);
    return R333_OK;
}

static int write_evaluation(FILE *file, const char *name,
                            const R333Evaluation *evaluation, int comma)
{
    return fprintf(
               file,
               "  \"%s\": {\"programs\": %u, \"solved\": %u, "
               "\"minimal\": %u, \"failed\": %u, "
               "\"excess_edits\": %u, \"verifier_calls\": %u, "
               "\"relabel_cases\": %u, \"relabel_exact\": %u, "
               "\"exact\": %s}%s\n",
               name, evaluation->programs, evaluation->solved,
               evaluation->minimal, evaluation->failed,
               evaluation->excess_edits, evaluation->verifier_calls,
               evaluation->relabel_cases, evaluation->relabel_exact,
               evaluation->exact ? "true" : "false", comma ? "," : "")
           >= 0;
}

R333Status r333_write_result(const R333ExperimentReport *report,
                             const char *path, char *error,
                             size_t error_capacity)
{
    FILE *file;
    uint8_t feature;
    if (report == NULL || path == NULL) return R333_INVALID_ARGUMENT;
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open %s: %s", path,
                  strerror(errno));
        return R333_IO_ERROR;
    }
    fprintf(file,
            "{\n  \"schema\": "
            "\"zero.reasoner333_composition_transfer.v1\",\n"
            "  \"version\": \"(3,3,3)\",\n"
            "  \"training_modules\": {\"count\": 1, \"width\": 2, "
            "\"programs\": 3},\n"
            "  \"development_modules\": {\"count\": 2, "
            "\"width\": 2, \"programs\": 15},\n"
            "  \"sealed_modules\": {\"count\": 3, \"width\": 3, "
            "\"programs\": 63},\n"
            "  \"training\": {\"cases\": %u, \"epochs\": %u, "
            "\"mistakes\": %u, \"final_errors\": %u, "
            "\"lookup_errors\": %u},\n",
            report->training.cases, report->training.epochs,
            report->training.mistakes, report->training.final_errors,
            report->training.lookup_errors);
    write_evaluation(file, "semantic", &report->semantic, 1);
    write_evaluation(file, "lookup", &report->lookup, 1);
    write_evaluation(file, "bridge_masked", &report->bridge_masked, 1);
    write_evaluation(file, "module_only", &report->module_only, 1);
    write_evaluation(file, "tool_only", &report->tool_only, 1);
    fprintf(file,
            "  \"semantic_bytes\": %u,\n"
            "  \"lookup_bytes\": %u,\n"
            "  \"semantic_weights\": [",
            report->semantic_bytes, report->lookup_bytes);
    for (feature = 0; feature < R333_FEATURE_COUNT; ++feature)
        fprintf(file, "%s%d", feature == 0 ? "" : ", ",
                report->semantic_weights[feature]);
    fprintf(file,
            "],\n  \"development_gate_passed\": %s,\n"
            "  \"sealed_gate_passed\": %s,\n"
            "  \"result_digest\": \"%016" PRIx64 "\"\n}\n",
            report->development_gate_passed ? "true" : "false",
            report->sealed_gate_passed ? "true" : "false",
            report->result_digest);
    if (fclose(file) != 0) {
        set_error(error, error_capacity, "cannot close %s: %s", path,
                  strerror(errno));
        return R333_IO_ERROR;
    }
    return R333_OK;
}
