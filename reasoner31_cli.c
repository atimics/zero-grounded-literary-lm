#include "reasoner31.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s train MODEL.r31p\n"
            "  %s eval MODEL.r31p STAGE [full|ranker-masked|none|tool-only]\n"
            "  %s render MODEL.r31p PROGRAM_INDEX\n"
            "  %s demo\n"
            "  %s --self-test\n",
            program, program, program, program, program);
}

static int parse_u16(const char *text, uint16_t maximum, uint16_t *value)
{
    char *end;
    unsigned long parsed;
    errno = 0;
    parsed = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || parsed > maximum)
        return 0;
    *value = (uint16_t)parsed;
    return 1;
}

static int parse_stage(const char *text, uint8_t *stage)
{
    uint16_t value;
    if (!parse_u16(text, R31_TEST_STAGE, &value) || value < 1) return 0;
    *stage = (uint8_t)value;
    return 1;
}

static int parse_feedback(const char *text, uint8_t *mode)
{
    if (strcmp(text, "full") == 0)
        *mode = R31_FEEDBACK_FULL;
    else if (strcmp(text, "ranker-masked") == 0)
        *mode = R31_FEEDBACK_RANKER_MASKED;
    else if (strcmp(text, "none") == 0)
        *mode = R31_FEEDBACK_NONE;
    else if (strcmp(text, "tool-only") == 0)
        *mode = R31_FEEDBACK_TOOL_ONLY;
    else
        return 0;
    return 1;
}

static void print_evaluation(const R31EvaluationReport *report)
{
    printf("{\"schema\":\"zero.reasoner31_evaluation.v1\","
           "\"stage\":%u,\"feedback_mode\":\"%s\","
           "\"cases\":%u,\"solved\":%u,\"optimal\":%u,"
           "\"failed\":%u,\"verifier_calls\":%u,"
           "\"repeated_states\":%u,\"unresolved_edits\":%u,"
           "\"excess_edits\":%u,\"decisions\":%u,"
           "\"singleton_decisions\":%u,\"multiple_decisions\":%u,"
           "\"success_milli\":%u,\"optimal_milli\":%u,"
           "\"exact\":%s}\n",
           (unsigned)report->stage,
           r31_feedback_name(report->feedback_mode), report->cases,
           report->solved, report->optimal, report->failed,
           report->verifier_calls, report->repeated_states,
           report->unresolved_edits, report->excess_edits,
           report->decisions, report->singleton_decisions,
           report->multiple_decisions, report->success_milli,
           report->optimal_milli, report->exact ? "true" : "false");
}

static void print_training(const R31TrainingReport *report, const char *path)
{
    printf("{\"schema\":\"zero.reasoner31_training.v1\","
           "\"modality\":\"progress_constrained_3d_ice\","
           "\"language_targets\":0,\"programs\":%u,"
           "\"programs_by_stage\":[0,%u,%u,%u,%u,%u,%u],"
           "\"training_cases\":%u,\"positive_cases\":%u,"
           "\"negative_cases\":%u,\"implication_cases\":%u,"
           "\"epochs\":%u,\"mistakes\":%u,"
           "\"final_action_errors\":%u,\"trained_stage\":%u,"
           "\"development_cases\":%u,"
           "\"development_optimal\":%u,"
           "\"development_seen\":%u,"
           "\"development_unseen\":%u,"
           "\"development_ranker_masked_optimal\":%u,"
           "\"development_tool_only_optimal\":%u,"
           "\"development_no_feedback_optimal\":%u,"
           "\"development_equal_pairs\":%u,"
           "\"development_equal_pairs_exact\":%u,"
           "\"development_equal_pairs_masked_both_correct\":%u,"
           "\"development_gate_passed\":%s,"
           "\"sealed_test_cases\":%u,\"sealed_test_optimal\":%u,"
           "\"sealed_test_seen\":%u,\"sealed_test_unseen\":%u,"
           "\"sealed_test_ranker_masked_optimal\":%u,"
           "\"sealed_test_tool_only_optimal\":%u,"
           "\"sealed_test_no_feedback_optimal\":%u,"
           "\"sealed_test_equal_pairs\":%u,"
           "\"sealed_test_equal_pairs_exact\":%u,"
           "\"sealed_test_equal_pairs_masked_both_correct\":%u,"
           "\"sealed_test_permutation_exact\":%s,"
           "\"sealed_test_irrelevant_swap_exact\":%s,"
           "\"sealed_test_gate_passed\":%s,"
           "\"experiment_passed\":%s,\"model\":\"%s\"}\n",
           report->programs, report->programs_by_stage[1],
           report->programs_by_stage[2], report->programs_by_stage[3],
           report->programs_by_stage[4], report->programs_by_stage[5],
           report->programs_by_stage[6], report->cases,
           report->positive_cases, report->negative_cases,
           report->implication_cases, report->epochs, report->mistakes,
           report->final_action_errors, (unsigned)report->trained_stage,
           report->development.cases, report->development.full.optimal,
           report->development.seen_observations,
           report->development.unseen_observations,
           report->development.ranker_masked.optimal,
           report->development.tool_only.optimal,
           report->development.no_feedback.optimal,
           report->development.equal_admissibility_pairs,
           report->development.equal_admissibility_pairs_exact,
           report->development.equal_admissibility_masked_both_correct,
           report->development.gate_passed ? "true" : "false",
           report->sealed_test.cases, report->sealed_test.full.optimal,
           report->sealed_test.seen_observations,
           report->sealed_test.unseen_observations,
           report->sealed_test.ranker_masked.optimal,
           report->sealed_test.tool_only.optimal,
           report->sealed_test.no_feedback.optimal,
           report->sealed_test.equal_admissibility_pairs,
           report->sealed_test.equal_admissibility_pairs_exact,
           report->sealed_test.equal_admissibility_masked_both_correct,
           report->sealed_test.permutation_exact ? "true" : "false",
           report->sealed_test.irrelevant_swap_exact ? "true" : "false",
           report->sealed_test.gate_passed ? "true" : "false",
           report->experiment_passed ? "true" : "false",
           path == NULL ? "" : path);
}

static int check(int condition, const char *message)
{
    if (!condition) fprintf(stderr, "self-test failed: %s\n", message);
    return condition;
}

static int check_holdout_census(const R31HoldoutReport *development,
                                const R31HoldoutReport *test)
{
    return check(development->cases == 6066 &&
                     development->full.optimal == 6066 &&
                     development->full.decisions == 10368 &&
                     development->full.singleton_decisions == 2268 &&
                     development->full.multiple_decisions == 8100 &&
                     development->seen_observations == 2583 &&
                     development->unseen_observations == 3483 &&
                     development->seen_optimal == 2583 &&
                     development->unseen_optimal == 3483 &&
                     development->ranker_masked.optimal == 3381 &&
                     development->tool_only.optimal == 619 &&
                     development->no_feedback.optimal == 119 &&
                     development->equal_admissibility_pairs == 932 &&
                     development->equal_admissibility_pairs_exact == 932 &&
                     development->equal_admissibility_masked_both_correct ==
                         0 &&
                     development->gate_passed,
                 "the stage-5 development gate matches its frozen census") &&
           check(test->cases == 1674 && test->full.optimal == 1674 &&
                     test->full.decisions == 2862 &&
                     test->full.singleton_decisions == 567 &&
                     test->full.multiple_decisions == 2295 &&
                     test->seen_observations == 711 &&
                     test->unseen_observations == 963 &&
                     test->seen_optimal == 711 &&
                     test->unseen_optimal == 963 &&
                     test->ranker_masked.optimal == 1189 &&
                     test->tool_only.optimal == 139 &&
                     test->no_feedback.optimal == 30 &&
                     test->equal_admissibility_pairs == 27 &&
                     test->equal_admissibility_pairs_exact == 27 &&
                     test->equal_admissibility_masked_both_correct == 0 &&
                     test->irrelevant_swap_exact &&
                     test->permutation_exact && test->gate_passed,
                 "the sealed stage-6 test matches its frozen census");
}

static int self_test(void)
{
    static const uint16_t expected_programs[R31_TEST_STAGE + 1] = {
        0, 12, 57, 136, 171, 108, 27};
    R31Model model, repeated, loaded;
    R31TrainingReport training, repeated_training;
    R31EvaluationReport loaded_test;
    R31Invariant invariant;
    R31AnswerIR answer;
    uint32_t calls;
    uint16_t program, test_program = UINT16_MAX;
    char path[128], output[256], error[256] = {0};
    R0Status status;
    if (!check(r31_program_count() == 511,
               "the exact 3D world has 511 programs"))
        return 0;
    for (program = 1; program <= R31_TEST_STAGE; ++program)
        if (!check(r31_program_count_at_stage((uint8_t)program) ==
                       expected_programs[program],
                   "the 3D stage census is exact"))
            return 0;
    status = r31_train(&model, &training, error, sizeof(error));
    if (!check(status == R0_OK,
               error[0] == '\0' ? "3D training succeeds" : error) ||
        !check(training.experiment_passed &&
                   model.sealed_test_passed && model.trained_stage == 5 &&
                   model.evaluated_stage == 6,
               "development and sealed-test gates pass") ||
        !check(training.cases == 22276 &&
                   training.positive_cases == 9123 &&
                   training.negative_cases == 11485 &&
                   training.implication_cases == 1668 &&
                   training.epochs == 9 && training.mistakes == 31 &&
                   training.final_action_errors == 0,
               "the learned 3D corpus and training census is frozen") ||
        !check_holdout_census(&training.development,
                              &training.sealed_test))
        return 0;
    status = r31_train(&repeated, &repeated_training, error, sizeof(error));
    if (!check(status == R0_OK && repeated_training.experiment_passed &&
                   memcmp(model.weights, repeated.weights,
                          sizeof(model.weights)) == 0 &&
                   training.epochs == repeated_training.epochs &&
                   training.mistakes == repeated_training.mistakes,
               "3D training and the sealed result are deterministic"))
        return 0;
    memset(&answer, 0, sizeof(answer));
    status = r31_language_render(&answer, output, sizeof(output), error,
                                 sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "language cannot run before a 3D proof is sealed"))
        return 0;
    invariant.atom_mask = 0;
    status = r31_answer_seal(0, &invariant, &answer, error, sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "an invalid 3D invariant cannot be sealed"))
        return 0;
    for (program = 0; program < r31_program_count(); ++program)
        if (r31_program_stage(program) == R31_TEST_STAGE) {
            test_program = program;
            break;
        }
    status = r31_solve(&model, test_program, &invariant, &calls, error,
                       sizeof(error));
    if (status == R0_OK)
        status = r31_answer_seal(test_program, &invariant, &answer, error,
                                 sizeof(error));
    if (status == R0_OK)
        status = r31_language_render(&answer, output, sizeof(output), error,
                                     sizeof(error));
    if (!check(status == R0_OK && calls <= R31_MAX_REPAIR_STEPS &&
                   strstr(output, "The verified invariant is ") == output,
               "language renders a sealed stage-6 result"))
        return 0;
    answer.checksum ^= UINT64_C(1);
    status = r31_language_render(&answer, output, sizeof(output), error,
                                 sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "tampering blocks the 3D language tool"))
        return 0;
    (void)snprintf(path, sizeof(path),
                   "/tmp/reasoner31-self-test-%ld.r31p", (long)getpid());
    (void)remove(path);
    status = r31_model_save(&model, path, error, sizeof(error));
    if (status == R0_OK)
        status = r31_model_load(&loaded, path, error, sizeof(error));
    if (status == R0_OK)
        status = r31_evaluate(&loaded, R31_TEST_STAGE,
                              R31_FEEDBACK_FULL, &loaded_test, error,
                              sizeof(error));
    (void)remove(path);
    if (!check(status == R0_OK && loaded_test.exact &&
                   memcmp(model.weights, loaded.weights,
                          sizeof(model.weights)) == 0,
               "the sealed 3D model artifact round-trips"))
        return 0;
    puts("Reasoner (3,1) progress-constrained 3D self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R31Model model;
    R31TrainingReport training;
    R31EvaluationReport evaluation;
    R31Invariant invariant;
    R31AnswerIR answer;
    uint32_t calls;
    uint16_t program_index;
    uint8_t stage, feedback_mode = R31_FEEDBACK_FULL;
    char output[256], error[256] = {0};
    R0Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        status = r31_train(&model, &training, error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_training(&training, NULL);
        return EXIT_SUCCESS;
    }
    if (argc == 3 && strcmp(argv[1], "train") == 0) {
        status = r31_train(&model, &training, error, sizeof(error));
        if (status == R0_OK)
            status = r31_model_save(&model, argv[2], error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_training(&training, argv[2]);
        return EXIT_SUCCESS;
    }
    if ((argc == 4 || argc == 5) && strcmp(argv[1], "eval") == 0) {
        if (!parse_stage(argv[3], &stage) ||
            (argc == 5 && !parse_feedback(argv[4], &feedback_mode)))
            goto bad_usage;
        status = r31_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r31_evaluate(&model, stage, feedback_mode, &evaluation,
                                  error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_evaluation(&evaluation);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "render") == 0) {
        if (!parse_u16(argv[3], (uint16_t)(r31_program_count() - 1),
                       &program_index))
            goto bad_usage;
        status = r31_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r31_solve(&model, program_index, &invariant, &calls,
                               error, sizeof(error));
        if (status == R0_OK)
            status = r31_answer_seal(program_index, &invariant, &answer,
                                     error, sizeof(error));
        if (status == R0_OK)
            status = r31_language_render(&answer, output, sizeof(output),
                                         error, sizeof(error));
        if (status != R0_OK) goto fail;
        printf("%s\n", output);
        return EXIT_SUCCESS;
    }
bad_usage:
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
    return EXIT_FAILURE;
}
