#include "reasoner1.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s train MODEL.r1p [MAX_RANK]\n"
            "  %s eval MODEL.r1p MAX_RANK\n"
            "  %s demo\n"
            "  %s --self-test\n",
            program, program, program, program);
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

static void print_training(const R1TrainingReport *report,
                           const char *model_path)
{
    printf("{\"schema\":\"zero.reasoner1_training.v1\","
           "\"modality\":\"structured_cartan_actions\","
           "\"language_targets\":0,\"graph_rounds\":%u,"
           "\"features\":%u,\"examples\":%u,\"positives\":%u,"
           "\"negatives\":%u,\"affine_negatives\":%u,"
           "\"weighted_examples\":%u,\"epochs\":%u,"
           "\"mistakes\":%u,\"final_errors\":%u,"
           "\"curriculum_promotions\":%u,\"trained_rank\":%u,"
           "\"rank8_holdout_found\":%u,"
           "\"rank8_holdout_expected\":%u,"
           "\"rank8_holdout_exact_precision_recall\":%s,"
           "\"rank8_holdout_precision_milli\":%u,"
           "\"rank8_holdout_recall_milli\":%u,"
           "\"rank8_holdout_rejected\":%u,"
           "\"rank8_holdout_types\":\"%s\",\"model\":\"%s\"}\n",
           R1_GRAPH_ROUNDS, R1_FEATURE_COUNT, report->examples,
           report->positives, report->negatives, report->affine_negatives,
           report->weighted_examples, report->epochs, report->mistakes,
           report->final_errors, (unsigned)report->curriculum_promotions,
           (unsigned)report->trained_rank,
           (unsigned)report->rank8_holdout_found,
           (unsigned)report->rank8_holdout_expected,
           report->rank8_holdout_exact_precision_recall ? "true" : "false",
           report->rank8_holdout_precision_milli,
           report->rank8_holdout_recall_milli,
           report->rank8_holdout_rejected, report->rank8_holdout_types,
           model_path == NULL ? "" : model_path);
}

static void print_evaluation(const R1EvaluationReport *report)
{
    uint8_t rank;
    printf("{\"schema\":\"zero.reasoner1_evaluation.v1\","
           "\"maximum_rank\":%u,\"candidate_actions\":%u,"
           "\"proposed\":%u,\"skipped\":%u,\"accepted\":%u,"
           "\"rejected\":%u,\"affine_rejections\":%u,"
           "\"counterexample_weight\":%u,\"precision_milli\":%u,"
           "\"recall_milli\":%u,\"exact_precision_recall\":%s}\n",
           (unsigned)report->maximum_rank, report->candidate_actions,
           report->proposed, report->skipped, report->accepted,
           report->rejected, report->affine_rejections,
           report->counterexample_weight, report->precision_milli,
           report->recall_milli,
           report->exact_precision_recall ? "true" : "false");
    for (rank = 1; rank <= report->maximum_rank; ++rank)
        printf("{\"rank\":%u,\"count\":%u,\"types\":\"%s\"}\n",
               (unsigned)rank, (unsigned)report->count_by_rank[rank],
               report->types_by_rank[rank]);
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
    R1Model model, loaded, repeated;
    R1TrainingReport training, repeated_training;
    R1EvaluationReport evaluation, loaded_evaluation;
    char path[128];
    char error[256] = {0};
    R0Status status;

    status = r1_train(&model, 8, &training, error, sizeof(error));
    if (!check(status == R0_OK, error[0] == '\0' ?
                                    "rank curriculum trains" : error) ||
        !check(training.final_errors == 0 &&
                   training.curriculum_promotions == 7,
               "all seven rank gates promote") ||
        !check(training.positives == 30 && training.negatives == 553 &&
                   training.affine_negatives == 45,
               "training uses the canonical Reasoner-0 proposal stream") ||
        !check(training.rank8_holdout_found == 5 &&
                   training.rank8_holdout_recall_milli == 1000 &&
                   training.rank8_holdout_precision_milli == 967 &&
                   training.rank8_holdout_rejected == 1 &&
                   !training.rank8_holdout_exact_precision_recall &&
                   strcmp(training.rank8_holdout_types,
                          "A8,B8,C8,D8,E8") == 0,
               "rank-seven holdout has exact rank-eight recall but one reject"))
        return 0;

    status = r1_train(&repeated, 8, &repeated_training, error, sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(model.weights, repeated.weights,
                          sizeof(model.weights)) == 0 &&
                   training.epochs == repeated_training.epochs &&
                   training.mistakes == repeated_training.mistakes,
               "structured training is exactly deterministic"))
        return 0;

    status = r1_evaluate(&model, 8, &evaluation, error, sizeof(error));
    if (!check(status == R0_OK && evaluation.exact_precision_recall,
               "learned proposer reaches exact precision and recall") ||
        !check(evaluation.accepted == 31 && evaluation.rejected == 0,
               "learned proposer recovers 31 types without invalid calls") ||
        !check(evaluation.proposed == 30 && evaluation.precision_milli == 1000 &&
                   evaluation.recall_milli == 1000,
               "only the 30 non-seed positive actions reach the verifier") ||
        !check(strcmp(evaluation.types_by_rank[3], "A3,B3,C3") == 0,
               "rank three excludes reducible systems") ||
        !check(strcmp(evaluation.types_by_rank[8],
                      "A8,B8,C8,D8,E8") == 0,
               "rank eight exact census is recovered"))
        return 0;

    (void)snprintf(path, sizeof(path),
                   "/tmp/reasoner1-self-test-%ld.r1p", (long)getpid());
    (void)remove(path);
    status = r1_model_save(&model, path, error, sizeof(error));
    if (status == R0_OK)
        status = r1_model_load(&loaded, path, error, sizeof(error));
    if (status == R0_OK)
        status = r1_evaluate(&loaded, 8, &loaded_evaluation, error,
                             sizeof(error));
    (void)remove(path);
    if (!check(status == R0_OK &&
                   loaded_evaluation.exact_precision_recall &&
                   memcmp(model.weights, loaded.weights,
                          sizeof(model.weights)) == 0,
               "exact model artifact round-trips"))
        return 0;

    puts("Reasoner-1 recurrent proposer self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R1Model model;
    R1TrainingReport training;
    R1EvaluationReport evaluation;
    char error[256] = {0};
    R0Status status;
    uint8_t maximum_rank = 8;

    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        status = r1_train(&model, 8, &training, error, sizeof(error));
        if (status == R0_OK)
            status = r1_evaluate(&model, 8, &evaluation, error,
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
        status = r1_train(&model, maximum_rank, &training, error,
                          sizeof(error));
        if (status == R0_OK)
            status = r1_model_save(&model, argv[2], error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_training(&training, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "eval") == 0) {
        if (!parse_rank(argv[3], &maximum_rank)) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        status = r1_model_load(&model, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r1_evaluate(&model, maximum_rank, &evaluation, error,
                                 sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_evaluation(&evaluation);
        return evaluation.exact_precision_recall ? EXIT_SUCCESS : 2;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
}
