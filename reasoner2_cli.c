#include "reasoner2.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s train MODEL.r2p [MAX_RANK]\n"
            "  %s eval MODEL.r2p MIN_RANK MAX_RANK\n"
            "  %s ablate MODEL.r2p MIN_RANK MAX_RANK\n"
            "  %s demo\n"
            "  %s --self-test\n",
            program, program, program, program, program);
}

static int parse_rank(const char *text, uint8_t *rank)
{
    char *end;
    unsigned long parsed;
    errno = 0;
    parsed = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || parsed < 2 ||
        parsed > R0_ENUMERATION_MAX_RANK)
        return 0;
    *rank = (uint8_t)parsed;
    return 1;
}

static void print_training(const R2TrainingReport *report,
                           const char *model_path)
{
    printf("{\"schema\":\"zero.reasoner2_training.v1\","
           "\"modality\":\"structured_cartan_repair\","
           "\"language_targets\":0,\"graph_rounds\":%u,"
           "\"features\":%u,\"cases\":%u,\"one_step_cases\":%u,"
           "\"two_step_cases\":%u,\"affine_cases\":%u,"
           "\"epochs\":%u,\"mistakes\":%u,"
           "\"final_action_errors\":%u,"
           "\"curriculum_promotions\":%u,\"trained_rank\":%u,"
           "\"rank8_holdout_cases\":%u,"
           "\"rank8_holdout_solved\":%u,"
           "\"rank8_holdout_optimal\":%u,"
           "\"rank8_holdout_success_milli\":%u,"
           "\"rank8_holdout_optimal_milli\":%u,"
           "\"rank8_holdout_repeated_states\":%u,"
           "\"rank8_holdout_exact\":%s,"
           "\"rank8_ablation_solved\":%u,"
           "\"rank8_ablation_optimal\":%u,"
           "\"rank8_ablation_success_milli\":%u,"
           "\"rank8_ablation_optimal_milli\":%u,"
           "\"feedback_ablation_collapsed\":%s,"
           "\"model\":\"%s\"}\n",
           R2_GRAPH_ROUNDS, R2_FEATURE_COUNT, report->cases,
           report->one_step_cases, report->two_step_cases,
           report->affine_cases, report->epochs, report->mistakes,
           report->final_action_errors,
           (unsigned)report->curriculum_promotions,
           (unsigned)report->trained_rank, report->rank8_holdout_cases,
           report->rank8_holdout_solved, report->rank8_holdout_optimal,
           report->rank8_holdout_success_milli,
           report->rank8_holdout_optimal_milli,
           report->rank8_holdout_repeated_states,
           report->rank8_holdout_exact ? "true" : "false",
           report->rank8_ablation_solved, report->rank8_ablation_optimal,
           report->rank8_ablation_success_milli,
           report->rank8_ablation_optimal_milli,
           report->feedback_ablation_collapsed ? "true" : "false",
           model_path == NULL ? "" : model_path);
}

static void print_evaluation(const R2EvaluationReport *report)
{
    printf("{\"schema\":\"zero.reasoner2_evaluation.v1\","
           "\"minimum_rank\":%u,\"maximum_rank\":%u,"
           "\"feedback_masked\":%s,\"cases\":%u,\"solved\":%u,"
           "\"optimal\":%u,\"failed\":%u,\"verifier_calls\":%u,"
           "\"repeated_states\":%u,\"excess_edits\":%u,"
           "\"success_milli\":%u,\"optimal_milli\":%u,"
           "\"exact\":%s}\n",
           (unsigned)report->minimum_rank,
           (unsigned)report->maximum_rank,
           report->feedback_masked ? "true" : "false", report->cases,
           report->solved, report->optimal, report->failed,
           report->verifier_calls, report->repeated_states,
           report->excess_edits, report->success_milli,
           report->optimal_milli, report->exact ? "true" : "false");
}

static int check(int condition, const char *message)
{
    if (!condition) {
        fprintf(stderr, "self-test failed: %s\n", message);
        return 0;
    }
    return 1;
}

static int self_test(void)
{
    R2Model model, loaded, repeated;
    R2TrainingReport training, repeated_training;
    R2EvaluationReport evaluation, ablation, loaded_evaluation;
    char path[128];
    char error[256] = {0};
    R0Status status;

    status = r2_train(&model, 8, &training, error, sizeof(error));
    if (!check(status == R0_OK, error[0] == '\0' ?
                                    "repair curriculum trains" : error) ||
        !check(training.final_action_errors == 0 &&
                   training.curriculum_promotions == 7,
               "all seven repair ranks promote") ||
        !check(training.cases == 267 && training.one_step_cases == 241 &&
                   training.two_step_cases == 26 &&
                   training.affine_cases == 52,
               "repair corpus matches the frozen exact census") ||
        !check(training.rank8_holdout_cases == 69 &&
                   training.rank8_holdout_solved == 69 &&
                   training.rank8_holdout_optimal == 66 &&
                   training.rank8_holdout_success_milli == 1000 &&
                   training.rank8_holdout_optimal_milli == 956 &&
                   training.rank8_holdout_repeated_states == 0 &&
                   !training.rank8_holdout_exact,
               "rank-7 policy keeps its frozen rank-8 near-pass") ||
        !check(training.rank8_ablation_solved == 66 &&
                   training.rank8_ablation_optimal == 63 &&
                   training.rank8_ablation_success_milli == 956 &&
                   training.rank8_ablation_optimal_milli == 913 &&
                   !training.feedback_ablation_collapsed,
               "feedback ablation keeps the frozen causal-use no-go"))
        return 0;

    status = r2_evaluate(&model, 2, 8, 0, &evaluation, error, sizeof(error));
    if (!check(status == R0_OK && evaluation.exact,
               "fully trained repair rollout is exact") ||
        !check(evaluation.solved == evaluation.cases &&
                   evaluation.optimal == evaluation.cases &&
                   evaluation.repeated_states == 0,
               "every repair is minimal without repeated state"))
        return 0;

    status = r2_evaluate(&model, 2, 8, 1, &ablation, error, sizeof(error));
    if (!check(status == R0_OK &&
                   ablation.optimal_milli < evaluation.optimal_milli,
               "masking verifier feedback lowers optimal repair"))
        return 0;

    status = r2_train(&repeated, 8, &repeated_training, error, sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(model.weights, repeated.weights,
                          sizeof(model.weights)) == 0 &&
                   training.epochs == repeated_training.epochs &&
                   training.mistakes == repeated_training.mistakes,
               "repair training is exactly deterministic"))
        return 0;

    (void)snprintf(path, sizeof(path),
                   "/tmp/reasoner2-self-test-%ld.r2p", (long)getpid());
    (void)remove(path);
    status = r2_model_save(&model, path, error, sizeof(error));
    if (status == R0_OK)
        status = r2_model_load(&loaded, path, error, sizeof(error));
    if (status == R0_OK)
        status = r2_evaluate(&loaded, 2, 8, 0, &loaded_evaluation, error,
                             sizeof(error));
    (void)remove(path);
    if (!check(status == R0_OK && loaded_evaluation.exact &&
                   memcmp(model.weights, loaded.weights,
                          sizeof(model.weights)) == 0,
               "exact repair model artifact round-trips"))
        return 0;

    puts("Reasoner-2 counterexample repair self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R2Model model;
    R2TrainingReport training;
    R2EvaluationReport evaluation;
    char error[256] = {0};
    R0Status status;
    uint8_t minimum_rank = 2, maximum_rank = 8;

    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        status = r2_train(&model, 8, &training, error, sizeof(error));
        if (status == R0_OK)
            status = r2_evaluate(&model, 2, 8, 0, &evaluation, error,
                                 sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_training(&training, NULL);
        print_evaluation(&evaluation);
        return EXIT_SUCCESS;
    }
    if ((argc == 3 || argc == 4) && strcmp(argv[1], "train") == 0) {
        if (argc == 4 && !parse_rank(argv[3], &maximum_rank)) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        status = r2_train(&model, maximum_rank, &training, error,
                          sizeof(error));
        if (status == R0_OK)
            status = r2_model_save(&model, argv[2], error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_training(&training, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 5 &&
        (strcmp(argv[1], "eval") == 0 || strcmp(argv[1], "ablate") == 0)) {
        int mask_feedback = strcmp(argv[1], "ablate") == 0;
        if (!parse_rank(argv[3], &minimum_rank) ||
            !parse_rank(argv[4], &maximum_rank) ||
            minimum_rank > maximum_rank) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        status = r2_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r2_evaluate(&model, minimum_rank, maximum_rank,
                                 mask_feedback, &evaluation, error,
                                 sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_evaluation(&evaluation);
        return evaluation.exact ? EXIT_SUCCESS : 2;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
}
