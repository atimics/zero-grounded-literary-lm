#include "reasoner3.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s train MODEL.r3p [MAX_STAGE]\n"
            "  %s eval MODEL.r3p MIN_STAGE MAX_STAGE\n"
            "  %s ablate MODEL.r3p MIN_STAGE MAX_STAGE\n"
            "  %s render MODEL.r3p PROGRAM_INDEX\n"
            "  %s demo\n"
            "  %s --self-test\n",
            program, program, program, program, program, program);
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
    uint16_t parsed;
    if (!parse_u16(text, R3_MAX_STAGE, &parsed) || parsed < 1) return 0;
    *stage = (uint8_t)parsed;
    return 1;
}

static void print_training(const R3TrainingReport *report, const char *path)
{
    printf("{\"schema\":\"zero.reasoner3_training.v1\","
           "\"modality\":\"integer_ice_invariant_synthesis\","
           "\"language_targets\":0,\"programs\":%u,\"cases\":%u,"
           "\"positive_cases\":%u,\"negative_cases\":%u,"
           "\"implication_cases\":%u,\"epochs\":%u,\"mistakes\":%u,"
           "\"final_action_errors\":%u,\"trained_stage\":%u,"
           "\"holdout_cases\":%u,\"holdout_solved\":%u,"
           "\"holdout_optimal\":%u,\"holdout_success_milli\":%u,"
           "\"holdout_optimal_milli\":%u,"
           "\"blind_ceiling_milli\":%u,"
           "\"blind_holdout_action_milli\":%u,"
           "\"interchange_pairs\":%u,\"interchange_exact\":%s,"
           "\"irrelevant_swap_exact\":%s,\"permutation_exact\":%s,"
           "\"holdout_exact\":%s,\"causal_gate_passed\":%s,"
           "\"model\":\"%s\"}\n",
           report->programs, report->cases, report->positive_cases,
           report->negative_cases, report->implication_cases, report->epochs,
           report->mistakes, report->final_action_errors,
           (unsigned)report->trained_stage, report->holdout_cases,
           report->holdout_solved, report->holdout_optimal,
           report->holdout_success_milli, report->holdout_optimal_milli,
           report->blind_ceiling_milli, report->blind_holdout_action_milli,
           report->interchange_pairs,
           report->interchange_exact ? "true" : "false",
           report->irrelevant_swap_exact ? "true" : "false",
           report->permutation_exact ? "true" : "false",
           report->holdout_exact ? "true" : "false",
           report->causal_gate_passed ? "true" : "false",
           path == NULL ? "" : path);
}

static void print_evaluation(const R3EvaluationReport *report)
{
    printf("{\"schema\":\"zero.reasoner3_evaluation.v1\","
           "\"minimum_stage\":%u,\"maximum_stage\":%u,"
           "\"feedback_masked\":%s,\"cases\":%u,\"solved\":%u,"
           "\"optimal\":%u,\"failed\":%u,\"verifier_calls\":%u,"
           "\"repeated_states\":%u,\"excess_edits\":%u,"
           "\"success_milli\":%u,\"optimal_milli\":%u,"
           "\"exact\":%s}\n",
           (unsigned)report->minimum_stage,
           (unsigned)report->maximum_stage,
           report->feedback_masked ? "true" : "false", report->cases,
           report->solved, report->optimal, report->failed,
           report->verifier_calls, report->repeated_states,
           report->excess_edits, report->success_milli,
           report->optimal_milli, report->exact ? "true" : "false");
}

static int check(int condition, const char *message)
{
    if (!condition) fprintf(stderr, "self-test failed: %s\n", message);
    return condition;
}

static int self_test(void)
{
    R3Model model, repeated, loaded;
    R3TrainingReport training, repeated_training;
    R3EvaluationReport evaluation, ablation, loaded_evaluation;
    R3Invariant invariant;
    R3AnswerIR answer;
    uint32_t calls;
    char output[256], error[256] = {0}, path[128];
    R0Status status;
    uint16_t program_count = r3_program_count();

    if (!check(program_count > 0 && program_count <= R3_MAX_PROGRAMS,
               "the bounded program suite exists"))
        return 0;
    status = r3_train(&model, R3_MAX_STAGE, &training, error, sizeof(error));
    if (!check(status == R0_OK, error[0] == '\0' ? "training succeeds" : error) ||
        !check(training.final_action_errors == 0 &&
                   training.curriculum_promotions == R3_MAX_STAGE,
               "every supervised curriculum stage separates") ||
        !check(training.positive_cases > 0 && training.negative_cases > 0 &&
                   training.implication_cases > 0,
               "all three ICE counterexample classes are present") ||
        !check(training.programs == 168 && training.cases == 6428 &&
                   training.positive_cases == 2868 &&
                   training.negative_cases == 2968 &&
                   training.implication_cases == 592 &&
                   training.epochs == 11 && training.mistakes == 120,
               "the exact program and training census is frozen") ||
        !check(training.ambiguity_cases > 0 &&
                   training.blind_ceiling_milli <= 500,
               "the no-feedback task has a frozen low ceiling") ||
        !check(training.holdout_cases == 1740 &&
                   training.holdout_solved == 1740 &&
                   training.holdout_optimal == 1738 &&
                   training.holdout_success_milli == 1000 &&
                   training.holdout_optimal_milli == 998 &&
                   !training.holdout_exact &&
                   !training.causal_gate_passed,
               "the stage-4 causal holdout keeps its frozen near-pass no-go") ||
        !check(training.blind_ceiling_milli == 500 &&
                   training.blind_holdout_action_milli == 0 &&
                   training.interchange_pairs == 396 &&
                   training.interchange_exact,
               "the blinded ceiling and witness interventions are frozen") ||
        !check(training.interchange_pairs > 0 &&
                   training.irrelevant_swap_exact &&
                   training.permutation_exact,
               "causal interventions and symmetry checks execute"))
        return 0;
    status = r3_evaluate(&model, 1, R3_MAX_STAGE, 0, &evaluation, error,
                         sizeof(error));
    if (!check(status == R0_OK && evaluation.exact,
               "the fully trained learner repairs every case minimally") ||
        !check(evaluation.repeated_states == 0,
               "exact repair never repeats an invariant"))
        return 0;
    status = r3_evaluate(&model, 1, R3_MAX_STAGE, 1, &ablation, error,
                         sizeof(error));
    if (!check(status == R0_OK &&
                   ablation.optimal_milli < evaluation.optimal_milli,
               "masking counterexamples lowers optimal repair"))
        return 0;
    status = r3_train(&repeated, R3_MAX_STAGE, &repeated_training, error,
                      sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(model.weights, repeated.weights,
                          sizeof(model.weights)) == 0 &&
                   training.epochs == repeated_training.epochs &&
                   training.mistakes == repeated_training.mistakes,
               "training is byte-for-byte deterministic"))
        return 0;
    memset(&answer, 0, sizeof(answer));
    status = r3_language_render(&answer, output, sizeof(output), error,
                                sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "language cannot run before proof is sealed"))
        return 0;
    invariant.atom_mask = 0;
    status = r3_answer_seal((uint16_t)(program_count - 1), &invariant,
                            &answer, error, sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "an invalid invariant cannot be sealed"))
        return 0;
    status = r3_solve(&model, (uint16_t)(program_count - 1), &invariant,
                      &calls, error, sizeof(error));
    if (status == R0_OK)
        status = r3_answer_seal((uint16_t)(program_count - 1), &invariant,
                                &answer, error, sizeof(error));
    if (status == R0_OK)
        status = r3_language_render(&answer, output, sizeof(output), error,
                                    sizeof(error));
    if (!check(status == R0_OK && calls <= R3_MAX_REPAIR_STEPS &&
                   strstr(output, "The verified invariant is ") == output,
               "language renders only the sealed verified result"))
        return 0;
    answer.checksum ^= UINT64_C(1);
    status = r3_language_render(&answer, output, sizeof(output), error,
                                sizeof(error));
    if (!check(status == R0_SEAL_ERROR,
               "tampering with a sealed answer blocks language"))
        return 0;
    (void)snprintf(path, sizeof(path),
                   "/tmp/reasoner3-self-test-%ld.r3p", (long)getpid());
    (void)remove(path);
    status = r3_model_save(&model, path, error, sizeof(error));
    if (status == R0_OK)
        status = r3_model_load(&loaded, path, error, sizeof(error));
    if (status == R0_OK)
        status = r3_evaluate(&loaded, 1, R3_MAX_STAGE, 0,
                             &loaded_evaluation, error, sizeof(error));
    (void)remove(path);
    if (!check(status == R0_OK && loaded_evaluation.exact &&
                   memcmp(model.weights, loaded.weights,
                          sizeof(model.weights)) == 0,
               "the exact learned artifact round-trips"))
        return 0;
    puts("Reasoner-3 exact ICE synthesis self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R3Model model;
    R3TrainingReport training;
    R3EvaluationReport evaluation;
    R3Invariant invariant;
    R3AnswerIR answer;
    uint32_t calls;
    uint8_t minimum_stage = 1, maximum_stage = R3_MAX_STAGE;
    uint16_t program_index;
    char output[256], error[256] = {0};
    R0Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        status = r3_train(&model, R3_MAX_STAGE, &training, error,
                          sizeof(error));
        if (status == R0_OK)
            status = r3_evaluate(&model, 1, R3_MAX_STAGE, 0, &evaluation,
                                 error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_training(&training, NULL);
        print_evaluation(&evaluation);
        return EXIT_SUCCESS;
    }
    if ((argc == 3 || argc == 4) && strcmp(argv[1], "train") == 0) {
        if (argc == 4 && !parse_stage(argv[3], &maximum_stage)) goto bad_usage;
        status = r3_train(&model, maximum_stage, &training, error,
                          sizeof(error));
        if (status == R0_OK)
            status = r3_model_save(&model, argv[2], error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_training(&training, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 5 &&
        (strcmp(argv[1], "eval") == 0 ||
         strcmp(argv[1], "ablate") == 0)) {
        if (!parse_stage(argv[3], &minimum_stage) ||
            !parse_stage(argv[4], &maximum_stage) ||
            minimum_stage > maximum_stage)
            goto bad_usage;
        status = r3_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r3_evaluate(&model, minimum_stage, maximum_stage,
                                 strcmp(argv[1], "ablate") == 0, &evaluation,
                                 error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_evaluation(&evaluation);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "render") == 0) {
        if (!parse_u16(argv[3], (uint16_t)(r3_program_count() - 1),
                       &program_index))
            goto bad_usage;
        status = r3_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r3_solve(&model, program_index, &invariant, &calls,
                              error, sizeof(error));
        if (status == R0_OK)
            status = r3_answer_seal(program_index, &invariant, &answer, error,
                                    sizeof(error));
        if (status == R0_OK)
            status = r3_language_render(&answer, output, sizeof(output), error,
                                        sizeof(error));
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
