#include "reasoner41.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * Reasoner 4.1 embeds the unchanged Reasoner 4.0 representation learner,
 * which in turn embeds the unchanged Reasoner (3,9) law engine.  Keeping the
 * full implementations in this translation unit lets the joint experiment
 * reuse their exact canonical languages while the contract checker pins both
 * frozen source layers.
 */
#include "reasoner40.c"

#define R41_FROZEN_R40_DEVELOPMENT_DIGEST UINT64_C(0x6af623f4d0e176fe)
#define R41_FNV_OFFSET UINT64_C(1469598103934665603)

static uint32_t r41_count_laws(const R40Engine *engine, uint8_t term_count)
{
    return count_term_programs(&engine->core, term_count);
}

static uint16_t r41_curriculum_law(const R40Engine *engine,
                                   const uint8_t *consistent)
{
    return curriculum_lookup(&engine->core, consistent);
}

static uint8_t r41_certify_frozen_representation_core(void)
{
    R40ExperimentReport report;
    char error[256] = {0};
    return (uint8_t)(
        r40_run_development(&report, error, sizeof(error)) == R0_OK &&
        report.result_digest == R41_FROZEN_R40_DEVELOPMENT_DIGEST &&
        report.canonical_adapter_programs == 170u &&
        report.development_adapters == 29u &&
        report.sealed_adapters == 134u &&
        report.development_gate_passed);
}

static uint8_t r41_certify_frozen_law_core(void)
{
    R310ExperimentReport report;
    char error[256] = {0};
    return (uint8_t)(
        r310_run_development(&report, error, sizeof(error)) == R0_OK &&
        report.result_digest == R40_FROZEN_R310_DEVELOPMENT_DIGEST &&
        report.canonical_programs == 52u &&
        report.curriculum_programs == 6u &&
        report.open_programs == 15u &&
        report.sealed_programs == 31u &&
        report.development_gate_passed);
}

static R0Status r41_build_engine(R40Engine *engine, char *error,
                                 size_t error_capacity)
{
    R0Status status = r40_build_engine(engine, error, error_capacity);
    if (status != R0_OK) return status;
    if (!r41_certify_frozen_representation_core()) {
        set_error(error, error_capacity,
                  "frozen Reasoner 4.0 representation core changed");
        return R0_POLICY_ERROR;
    }
    if (!r41_certify_frozen_law_core()) {
        set_error(error, error_capacity,
                  "frozen Reasoner (3,9) law core changed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static void r41_evaluate_episode(const R40Engine *engine,
                                 uint16_t target_adapter,
                                 uint16_t target_law, uint8_t dimension,
                                 uint8_t variant, uint32_t salt,
                                 R41Control control,
                                 R41Evaluation *evaluation)
{
    uint8_t adapter_consistent[R40_MAX_ADAPTER_PROGRAMS];
    uint8_t align_used[R40_ALIGN_QUERY_COUNT];
    uint8_t law_consistent[R310_MAX_PROGRAMS];
    uint8_t law_used[R310_QUERY_COUNT];
    uint16_t adapter_remaining;
    uint16_t selected_adapter = UINT16_MAX;
    uint16_t law_remaining;
    uint16_t selected_law = UINT16_MAX;
    uint32_t adapter_steps = 0;
    uint32_t law_steps = 0;
    uint8_t replay_exact = 1;
    uint8_t all_actions_exact = 1;
    uint16_t initial_alignment;
    uint8_t demonstration;

    memset(adapter_consistent, 1, engine->adapter_count);
    memset(align_used, 0, sizeof(align_used));
    memset(law_consistent, 1, engine->core.program_count);
    memset(law_used, 0, sizeof(law_used));
    ++evaluation->episodes;

    initial_alignment = r40_zero_probe(variant, salt);
    {
        uint16_t raw[R310_MAX_DIMENSIONS];
        int16_t response[R310_MAX_DIMENSIONS];
        uint8_t response_dimension;
        r40_make_probe(engine, target_adapter, initial_alignment, variant,
                       salt, raw, response, &response_dimension);
        align_used[initial_alignment] = 1;
        r40_filter_adapters(engine, adapter_consistent, raw, response,
                            response_dimension);
        ++evaluation->alignment_demonstrations;
    }
    adapter_remaining = r40_remaining_adapters(adapter_consistent,
                                               engine->adapter_count);
    if (control == R41_CONTROL_MODEL ||
        control == R41_CONTROL_ORACLE_LAW ||
        control == R41_CONTROL_NO_LAW_QUERY ||
        control == R41_CONTROL_SHUFFLED_ALIGNMENT ||
        control == R41_CONTROL_SHUFFLED_LAW_FEEDBACK) {
        while (adapter_remaining > 1 &&
               adapter_steps < R40_MAX_ALIGN_QUERIES) {
            uint16_t query = r40_choose_alignment(engine, target_adapter,
                adapter_consistent, align_used, variant, salt);
            uint16_t raw[R310_MAX_DIMENSIONS];
            int16_t response[R310_MAX_DIMENSIONS];
            uint8_t response_dimension;
            if (query == UINT16_MAX) break;
            align_used[query] = 1;
            r40_make_probe(engine, target_adapter, query, variant, salt, raw,
                           response, &response_dimension);
            if (control == R41_CONTROL_SHUFFLED_ALIGNMENT) {
                uint16_t shifted = (uint16_t)((query + 37u) %
                                              R40_ALIGN_QUERY_COUNT);
                uint16_t ignored_raw[R310_MAX_DIMENSIONS];
                r40_make_probe(engine, target_adapter, shifted, variant, salt,
                               ignored_raw, response, &response_dimension);
            }
            ++evaluation->adapter_queries;
            ++evaluation->exact_adapter_queries;
            r40_filter_adapters(engine, adapter_consistent, raw, response,
                                response_dimension);
            adapter_remaining = r40_remaining_adapters(adapter_consistent,
                                                       engine->adapter_count);
            ++adapter_steps;
        }
    }
    if (adapter_steps > evaluation->maximum_adapter_queries)
        evaluation->maximum_adapter_queries = adapter_steps;

    switch (control) {
    case R41_CONTROL_ORACLE_ADAPTER:
        selected_adapter = target_adapter;
        adapter_remaining = 1;
        break;
    case R41_CONTROL_IDENTITY_ADAPTER:
        selected_adapter = 0;
        break;
    case R41_CONTROL_CURRICULUM_PAIR:
        selected_adapter = r40_curriculum_adapter(engine,
                                                  adapter_consistent);
        break;
    case R41_CONTROL_MODEL:
    case R41_CONTROL_ORACLE_LAW:
    case R41_CONTROL_NO_ADAPTER_QUERY:
    case R41_CONTROL_NO_LAW_QUERY:
    case R41_CONTROL_SHUFFLED_ALIGNMENT:
    case R41_CONTROL_SHUFFLED_LAW_FEEDBACK:
        selected_adapter = r40_first_adapter(adapter_consistent,
                                             engine->adapter_count);
        break;
    }
    ++evaluation->adapter_identifications;
    ++evaluation->adapter_commits;
    if (adapter_remaining > 1) ++evaluation->premature_adapter_commits;
    if (adapter_remaining == 1 && selected_adapter == target_adapter) {
        ++evaluation->exact_adapter_identifications;
        ++evaluation->exact_adapter_commits;
    }

    if (selected_adapter != UINT16_MAX) {
        uint16_t opaque;
        for (opaque = 0; opaque < R40_ALIGN_QUERY_COUNT; ++opaque) {
            uint16_t raw[R310_MAX_DIMENSIONS];
            int16_t semantic[R310_MAX_DIMENSIONS];
            int16_t decoded[R310_MAX_DIMENSIONS];
            uint8_t replay_dimension;
            r40_make_probe(engine, target_adapter, opaque, variant, salt, raw,
                           semantic, &replay_dimension);
            r40_decode(&engine->adapters[selected_adapter], raw,
                       replay_dimension, decoded);
            ++evaluation->replay_checks;
            if (memcmp(semantic, decoded,
                       replay_dimension * sizeof(semantic[0])) == 0)
                ++evaluation->exact_replays;
            else
                replay_exact = 0;
        }
    } else {
        replay_exact = 0;
    }

    for (demonstration = 0; demonstration < R310_INITIAL_DEMOS;
         ++demonstration) {
        uint16_t query = (uint16_t)(mix32(
            salt + (uint32_t)variant * 409u +
            (uint32_t)demonstration * 811u) % R310_QUERY_COUNT);
        int8_t observed;
        while (law_used[query])
            query = (uint16_t)((query + 1u) % R310_QUERY_COUNT);
        law_used[query] = 1;
        observed = engine->core.outcomes[target_law][query];
        if (selected_adapter != UINT16_MAX)
            r40_filter_laws(engine, law_consistent, selected_adapter,
                            target_adapter, query, dimension, observed);
        ++evaluation->law_demonstrations;
    }
    law_remaining = consistent_count(law_consistent,
                                     engine->core.program_count);
    if (control == R41_CONTROL_MODEL ||
        control == R41_CONTROL_ORACLE_ADAPTER ||
        control == R41_CONTROL_IDENTITY_ADAPTER ||
        control == R41_CONTROL_SHUFFLED_ALIGNMENT ||
        control == R41_CONTROL_SHUFFLED_LAW_FEEDBACK) {
        while (law_remaining > 1 && law_steps < 64u &&
               selected_adapter != UINT16_MAX) {
            uint16_t query = choose_query(&engine->core, law_consistent,
                                          law_used);
            int8_t observed;
            uint8_t exact_request = 0;
            if (query == UINT16_MAX) break;
            law_used[query] = 1;
            observed = r40_active_outcome(engine, selected_adapter,
                target_adapter, target_law, query, dimension, &exact_request);
            if (control == R41_CONTROL_SHUFFLED_LAW_FEEDBACK) {
                uint16_t shifted = (uint16_t)((query + 37u) %
                                              R310_QUERY_COUNT);
                observed = engine->core.outcomes[target_law][shifted];
            }
            ++evaluation->law_queries;
            if (exact_request) ++evaluation->exact_law_queries;
            filter_programs(&engine->core, law_consistent, query, observed);
            law_remaining = consistent_count(law_consistent,
                                             engine->core.program_count);
            ++law_steps;
        }
    }
    if (law_steps > evaluation->maximum_law_queries)
        evaluation->maximum_law_queries = law_steps;

    if (control == R41_CONTROL_ORACLE_LAW) {
        selected_law = target_law;
        law_remaining = 1;
    } else if (control == R41_CONTROL_CURRICULUM_PAIR) {
        selected_law = r41_curriculum_law(engine, law_consistent);
    } else {
        selected_law = first_consistent(law_consistent,
                                        engine->core.program_count);
    }
    ++evaluation->law_identifications;
    ++evaluation->law_commits;
    if (law_remaining > 1) ++evaluation->premature_law_commits;
    if (law_remaining == 1 && selected_law == target_law) {
        ++evaluation->exact_law_identifications;
        ++evaluation->exact_law_commits;
    }

    {
        uint8_t action_case;
        for (action_case = 0; action_case < R310_ACTION_CASES;
             ++action_case) {
            uint8_t vectors[R310_ACTION_CANDIDATES];
            uint8_t predicted = UINT8_MAX;
            uint8_t expected;
            make_action_vectors(action_case, variant, salt, vectors);
            expected = r40_choose_semantic_action(engine, target_law, vectors);
            if (selected_adapter != UINT16_MAX &&
                selected_law != UINT16_MAX)
                predicted = r40_choose_raw_action(engine, selected_adapter,
                    target_adapter, selected_law, vectors, dimension);
            ++evaluation->actions;
            if (predicted == expected)
                ++evaluation->exact_actions;
            else
                all_actions_exact = 0;
        }
    }

    ++evaluation->commits;
    if (adapter_remaining > 1 || law_remaining > 1)
        ++evaluation->premature_commits;
    if (adapter_remaining == 1 && law_remaining == 1 &&
        selected_adapter == target_adapter && selected_law == target_law &&
        replay_exact && all_actions_exact)
        ++evaluation->exact_commits;

    ++evaluation->reports;
    if (selected_adapter != UINT16_MAX && selected_law != UINT16_MAX) {
        char selected_adapter_text[128];
        char target_adapter_text[128];
        char selected_law_text[R310_MAX_REPORT_TEXT];
        char target_law_text[R310_MAX_REPORT_TEXT];
        if (r40_render_adapter(&engine->adapters[selected_adapter],
                               selected_adapter_text,
                               sizeof(selected_adapter_text)) &&
            r40_render_adapter(&engine->adapters[target_adapter],
                               target_adapter_text,
                               sizeof(target_adapter_text)) &&
            render_program(&engine->core, selected_law,
                           selected_law_text) &&
            render_program(&engine->core, target_law, target_law_text) &&
            strcmp(selected_adapter_text, target_adapter_text) == 0 &&
            strcmp(selected_law_text, target_law_text) == 0)
            ++evaluation->exact_reports;
    }
}

static void r41_finish_evaluation(R41Evaluation *evaluation)
{
    evaluation->exact = (uint8_t)(
        evaluation->episodes > 0 &&
        evaluation->adapter_identifications == evaluation->episodes &&
        evaluation->exact_adapter_identifications == evaluation->episodes &&
        evaluation->adapter_commits == evaluation->episodes &&
        evaluation->exact_adapter_commits == evaluation->episodes &&
        evaluation->premature_adapter_commits == 0 &&
        evaluation->replay_checks == evaluation->exact_replays &&
        evaluation->law_identifications == evaluation->episodes &&
        evaluation->exact_law_identifications == evaluation->episodes &&
        evaluation->law_commits == evaluation->episodes &&
        evaluation->exact_law_commits == evaluation->episodes &&
        evaluation->premature_law_commits == 0 &&
        evaluation->adapter_queries == evaluation->exact_adapter_queries &&
        evaluation->law_queries == evaluation->exact_law_queries &&
        evaluation->actions == evaluation->episodes * R310_ACTION_CASES &&
        evaluation->actions == evaluation->exact_actions &&
        evaluation->commits == evaluation->episodes &&
        evaluation->commits == evaluation->exact_commits &&
        evaluation->reports == evaluation->episodes &&
        evaluation->reports == evaluation->exact_reports &&
        evaluation->premature_commits == 0);
}

static void r41_evaluate_split(const R40Engine *engine,
                               uint8_t adapter_length,
                               uint8_t law_term_count,
                               uint8_t minimum_dimension,
                               uint8_t maximum_dimension, uint8_t variants,
                               uint32_t salt, R41Control control,
                               R41Evaluation *evaluation)
{
    uint16_t adapter;
    memset(evaluation, 0, sizeof(*evaluation));
    evaluation->target_adapters = r40_count_adapters(engine, adapter_length);
    evaluation->target_laws = r41_count_laws(engine, law_term_count);
    evaluation->target_pairs =
        evaluation->target_adapters * evaluation->target_laws;
    for (adapter = 0; adapter < engine->adapter_count; ++adapter) {
        uint16_t law;
        if (engine->adapters[adapter].length != adapter_length) continue;
        for (law = 0; law < engine->core.program_count; ++law) {
            uint8_t dimension;
            if (engine->core.programs[law].term_count != law_term_count)
                continue;
            for (dimension = minimum_dimension;
                 dimension <= maximum_dimension; ++dimension) {
                uint8_t variant;
                for (variant = 0; variant < variants; ++variant)
                    r41_evaluate_episode(engine, adapter, law, dimension,
                        variant, salt, control, evaluation);
            }
        }
    }
    r41_finish_evaluation(evaluation);
}

static uint64_t r41_digest_u64(uint64_t hash, uint64_t value)
{
    uint8_t byte;
    for (byte = 0; byte < 8; ++byte)
        hash = r40_digest_byte(hash, (uint8_t)(value >> (8u * byte)));
    return hash;
}

static uint64_t r41_digest_evaluation(uint64_t hash,
                                      const R41Evaluation *evaluation)
{
    hash = r41_digest_u64(hash, evaluation->episodes);
    hash = r41_digest_u64(hash, evaluation->target_adapters);
    hash = r41_digest_u64(hash, evaluation->target_laws);
    hash = r41_digest_u64(hash, evaluation->target_pairs);
    hash = r41_digest_u64(hash, evaluation->alignment_demonstrations);
    hash = r41_digest_u64(hash, evaluation->adapter_queries);
    hash = r41_digest_u64(hash, evaluation->exact_adapter_queries);
    hash = r41_digest_u64(hash, evaluation->exact_adapter_identifications);
    hash = r41_digest_u64(hash, evaluation->exact_adapter_commits);
    hash = r41_digest_u64(hash, evaluation->premature_adapter_commits);
    hash = r41_digest_u64(hash, evaluation->replay_checks);
    hash = r41_digest_u64(hash, evaluation->exact_replays);
    hash = r41_digest_u64(hash, evaluation->law_demonstrations);
    hash = r41_digest_u64(hash, evaluation->law_queries);
    hash = r41_digest_u64(hash, evaluation->exact_law_queries);
    hash = r41_digest_u64(hash, evaluation->exact_law_identifications);
    hash = r41_digest_u64(hash, evaluation->exact_law_commits);
    hash = r41_digest_u64(hash, evaluation->premature_law_commits);
    hash = r41_digest_u64(hash, evaluation->exact_actions);
    hash = r41_digest_u64(hash, evaluation->exact_commits);
    hash = r41_digest_u64(hash, evaluation->exact_reports);
    hash = r41_digest_u64(hash, evaluation->premature_commits);
    hash = r41_digest_u64(hash, evaluation->maximum_adapter_queries);
    hash = r41_digest_u64(hash, evaluation->maximum_law_queries);
    return r41_digest_u64(hash, evaluation->exact);
}

static uint64_t r41_experiment_digest(const R41ExperimentReport *report)
{
    uint64_t hash = R41_FNV_OFFSET;
    hash = r41_digest_u64(hash, report->canonical_adapter_programs);
    hash = r41_digest_u64(hash, report->canonical_law_programs);
    hash = r41_digest_u64(hash, report->curriculum_adapters);
    hash = r41_digest_u64(hash, report->development_adapters);
    hash = r41_digest_u64(hash, report->sealed_adapters);
    hash = r41_digest_u64(hash, report->curriculum_laws);
    hash = r41_digest_u64(hash, report->development_laws);
    hash = r41_digest_u64(hash, report->sealed_laws);
    hash = r41_digest_u64(hash, report->development_pairs);
    hash = r41_digest_u64(hash, report->planned_sealed_pairs);
    hash = r41_digest_u64(hash, report->planned_sealed_episodes);
    hash = r41_digest_u64(hash, report->frozen_representation_core_passed);
    hash = r41_digest_u64(hash, report->frozen_law_core_passed);
    hash = r41_digest_u64(hash, report->separate_commit_certificate_passed);
    hash = r41_digest_u64(hash, report->oracle_adapter_control_passed);
    hash = r41_digest_u64(hash, report->oracle_law_control_passed);
    hash = r41_digest_u64(hash, report->identity_adapter_control_passed);
    hash = r41_digest_u64(hash, report->curriculum_pair_control_passed);
    hash = r41_digest_u64(hash, report->no_adapter_query_control_passed);
    hash = r41_digest_u64(hash, report->no_law_query_control_passed);
    hash = r41_digest_u64(hash, report->shuffled_alignment_control_passed);
    hash = r41_digest_u64(hash, report->shuffled_law_feedback_control_passed);
    hash = r41_digest_evaluation(hash, &report->curriculum);
    hash = r41_digest_evaluation(hash, &report->development);
    hash = r41_digest_u64(hash, report->development_gate_passed);
    return r41_digest_u64(hash, report->sealed_execution_locked);
}

static uint64_t r41_sealed_digest(const R41ExperimentReport *report)
{
    uint64_t hash = report->result_digest;
    hash = r41_digest_evaluation(hash, &report->sealed);
    return r41_digest_u64(hash, report->sealed_gate_passed);
}

R0Status r41_run_development(R41ExperimentReport *report, char *error,
                             size_t error_capacity)
{
    R40Engine engine;
    R41Evaluation control;
    R0Status status;
    if (report == NULL) {
        set_error(error, error_capacity, "report is required");
        return R0_INVALID_ARGUMENT;
    }
    memset(report, 0, sizeof(*report));
    status = r41_build_engine(&engine, error, error_capacity);
    if (status != R0_OK) return status;

    report->canonical_adapter_programs = engine.adapter_count;
    report->canonical_law_programs = engine.core.program_count;
    report->curriculum_adapters = r40_count_adapters(&engine, 1);
    report->development_adapters = r40_count_adapters(&engine, 2);
    report->sealed_adapters = r40_count_adapters(&engine, 3);
    report->curriculum_laws = r41_count_laws(&engine, 1);
    report->development_laws = r41_count_laws(&engine, 2);
    report->sealed_laws = r41_count_laws(&engine, 3);
    report->development_pairs =
        report->development_adapters * report->development_laws;
    report->planned_sealed_pairs =
        report->sealed_adapters * report->sealed_laws;
    report->planned_sealed_episodes =
        report->planned_sealed_pairs * 4u * 2u;
    report->frozen_representation_core_passed =
        r41_certify_frozen_representation_core();
    report->frozen_law_core_passed = r41_certify_frozen_law_core();
    report->sealed_execution_locked = 1;

    r41_evaluate_split(&engine, 1, 1, 4, 4, 2,
                       UINT32_C(0x4100a11), R41_CONTROL_MODEL,
                       &report->curriculum);
    r41_evaluate_split(&engine, 2, 2, 5, 8, 2,
                       UINT32_C(0x4100b22), R41_CONTROL_MODEL,
                       &report->development);
    report->separate_commit_certificate_passed = (uint8_t)(
        report->curriculum.exact && report->development.exact &&
        report->curriculum.exact_adapter_commits ==
            report->curriculum.episodes &&
        report->curriculum.exact_law_commits ==
            report->curriculum.episodes &&
        report->development.exact_adapter_commits ==
            report->development.episodes &&
        report->development.exact_law_commits ==
            report->development.episodes);

    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_ORACLE_ADAPTER,
                       &control);
    report->oracle_adapter_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_ORACLE_LAW,
                       &control);
    report->oracle_law_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_IDENTITY_ADAPTER,
                       &control);
    report->identity_adapter_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_CURRICULUM_PAIR,
                       &control);
    report->curriculum_pair_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_NO_ADAPTER_QUERY,
                       &control);
    report->no_adapter_query_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_NO_LAW_QUERY,
                       &control);
    report->no_law_query_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33), R41_CONTROL_SHUFFLED_ALIGNMENT,
                       &control);
    report->shuffled_alignment_control_passed = control.exact;
    r41_evaluate_split(&engine, 2, 2, 5, 5, 1,
                       UINT32_C(0x4100c33),
                       R41_CONTROL_SHUFFLED_LAW_FEEDBACK, &control);
    report->shuffled_law_feedback_control_passed = control.exact;

    report->development_gate_passed = (uint8_t)(
        report->canonical_adapter_programs == 170u &&
        report->canonical_law_programs == 52u &&
        report->curriculum_adapters == 6u &&
        report->development_adapters == 29u &&
        report->sealed_adapters == 134u &&
        report->curriculum_laws == 6u &&
        report->development_laws == 15u &&
        report->sealed_laws == 31u &&
        report->development_pairs == 435u &&
        report->planned_sealed_pairs == 4154u &&
        report->planned_sealed_episodes == 33232u &&
        report->frozen_representation_core_passed &&
        report->frozen_law_core_passed &&
        report->separate_commit_certificate_passed &&
        report->curriculum.exact && report->development.exact &&
        report->oracle_adapter_control_passed &&
        report->oracle_law_control_passed &&
        !report->identity_adapter_control_passed &&
        !report->curriculum_pair_control_passed &&
        !report->no_adapter_query_control_passed &&
        !report->no_law_query_control_passed &&
        !report->shuffled_alignment_control_passed &&
        !report->shuffled_law_feedback_control_passed &&
        report->sealed_execution_locked);
    report->result_digest = r41_experiment_digest(report);
    if (!report->development_gate_passed) {
        set_error(error, error_capacity,
                  "joint-transfer development gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

R0Status r41_run_sealed(R41ExperimentReport *report, char *error,
                        size_t error_capacity)
{
    R40Engine engine;
    R0Status status = r41_run_development(report, error, error_capacity);
    if (status != R0_OK) return status;
    status = r41_build_engine(&engine, error, error_capacity);
    if (status != R0_OK) return status;
    r41_evaluate_split(&engine, 3, 3, 9, 12, 2,
                       UINT32_C(0x4105ea17), R41_CONTROL_MODEL,
                       &report->sealed);
    report->sealed_gate_passed = (uint8_t)(
        report->development_gate_passed &&
        report->sealed.target_pairs == report->planned_sealed_pairs &&
        report->sealed.episodes == report->planned_sealed_episodes &&
        report->sealed.exact);
    report->result_digest = r41_sealed_digest(report);
    if (!report->sealed_gate_passed) {
        set_error(error, error_capacity, "joint-transfer sealed gate failed");
        return R0_POLICY_ERROR;
    }
    return R0_OK;
}

static int r41_write_evaluation(FILE *file,
                                const R41Evaluation *evaluation)
{
    return fprintf(file,
        "{\"episodes\":%u,\"target_adapters\":%u,"
        "\"target_laws\":%u,\"target_pairs\":%u,"
        "\"alignment_demonstrations\":%u,\"adapter_queries\":%u,"
        "\"exact_adapter_queries\":%u,"
        "\"adapter_identifications\":%u,"
        "\"exact_adapter_identifications\":%u,"
        "\"adapter_commits\":%u,\"exact_adapter_commits\":%u,"
        "\"premature_adapter_commits\":%u,\"replay_checks\":%u,"
        "\"exact_replays\":%u,\"law_demonstrations\":%u,"
        "\"law_queries\":%u,\"exact_law_queries\":%u,"
        "\"law_identifications\":%u,"
        "\"exact_law_identifications\":%u,\"law_commits\":%u,"
        "\"exact_law_commits\":%u,\"premature_law_commits\":%u,"
        "\"actions\":%u,\"exact_actions\":%u,\"commits\":%u,"
        "\"exact_commits\":%u,\"reports\":%u,"
        "\"exact_reports\":%u,\"premature_commits\":%u,"
        "\"maximum_adapter_queries\":%u,"
        "\"maximum_law_queries\":%u,\"exact\":%s}",
        evaluation->episodes, evaluation->target_adapters,
        evaluation->target_laws, evaluation->target_pairs,
        evaluation->alignment_demonstrations,
        evaluation->adapter_queries, evaluation->exact_adapter_queries,
        evaluation->adapter_identifications,
        evaluation->exact_adapter_identifications,
        evaluation->adapter_commits, evaluation->exact_adapter_commits,
        evaluation->premature_adapter_commits,
        evaluation->replay_checks, evaluation->exact_replays,
        evaluation->law_demonstrations, evaluation->law_queries,
        evaluation->exact_law_queries, evaluation->law_identifications,
        evaluation->exact_law_identifications,
        evaluation->law_commits, evaluation->exact_law_commits,
        evaluation->premature_law_commits,
        evaluation->actions, evaluation->exact_actions,
        evaluation->commits, evaluation->exact_commits,
        evaluation->reports, evaluation->exact_reports,
        evaluation->premature_commits,
        evaluation->maximum_adapter_queries,
        evaluation->maximum_law_queries,
        evaluation->exact ? "true" : "false");
}

R0Status r41_write_result(const R41ExperimentReport *report,
                          const char *path, char *error,
                          size_t error_capacity)
{
    FILE *file;
    int failed = 0;
    if (report == NULL || path == NULL) {
        set_error(error, error_capacity, "report and path are required");
        return R0_INVALID_ARGUMENT;
    }
    file = fopen(path, "wb");
    if (file == NULL) {
        set_error(error, error_capacity, "cannot open result path");
        return R0_IO_ERROR;
    }
    if (fprintf(file,
        "{\n  \"schema\": \"zero.reasoner41_joint_transfer.v1\",\n"
        "  \"version\": \"4.1\",\n"
        "  \"canonical_adapter_programs\": %u,\n"
        "  \"canonical_law_programs\": %u,\n"
        "  \"curriculum_adapters\": %u,\n"
        "  \"development_adapters\": %u,\n"
        "  \"sealed_adapters\": %u,\n"
        "  \"curriculum_laws\": %u,\n"
        "  \"development_laws\": %u,\n"
        "  \"sealed_laws\": %u,\n"
        "  \"development_pairs\": %u,\n"
        "  \"planned_sealed_pairs\": %u,\n"
        "  \"planned_sealed_episodes\": %u,\n"
        "  \"frozen_representation_core_passed\": %s,\n"
        "  \"frozen_law_core_passed\": %s,\n"
        "  \"separate_commit_certificate_passed\": %s,\n"
        "  \"development_gate_passed\": %s,\n"
        "  \"sealed_gate_passed\": %s,\n"
        "  \"sealed_execution_locked\": %s,\n"
        "  \"result_digest\": \"%016" PRIx64 "\",\n"
        "  \"curriculum\": ",
        report->canonical_adapter_programs,
        report->canonical_law_programs,
        report->curriculum_adapters, report->development_adapters,
        report->sealed_adapters, report->curriculum_laws,
        report->development_laws, report->sealed_laws,
        report->development_pairs, report->planned_sealed_pairs,
        report->planned_sealed_episodes,
        report->frozen_representation_core_passed ? "true" : "false",
        report->frozen_law_core_passed ? "true" : "false",
        report->separate_commit_certificate_passed ? "true" : "false",
        report->development_gate_passed ? "true" : "false",
        report->sealed_gate_passed ? "true" : "false",
        report->sealed_execution_locked ? "true" : "false",
        report->result_digest) < 0)
        failed = 1;
    if (!failed && r41_write_evaluation(file, &report->curriculum) < 0)
        failed = 1;
    if (!failed && fprintf(file, ",\n  \"development\": ") < 0)
        failed = 1;
    if (!failed && r41_write_evaluation(file, &report->development) < 0)
        failed = 1;
    if (!failed && fprintf(file, ",\n  \"sealed\": ") < 0)
        failed = 1;
    if (!failed && r41_write_evaluation(file, &report->sealed) < 0)
        failed = 1;
    if (!failed && fprintf(file, "\n}\n") < 0) failed = 1;
    if (fclose(file) != 0) failed = 1;
    if (failed) {
        set_error(error, error_capacity, "cannot write result");
        return R0_IO_ERROR;
    }
    return R0_OK;
}
