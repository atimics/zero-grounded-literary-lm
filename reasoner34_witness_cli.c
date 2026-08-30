#include "reasoner34_witness.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s development\n"
            "  %s sealed-run RESULT.json\n"
            "  %s --self-test\n",
            program, program, program);
}

static R0Status development(R33Model *model, R34WTrainingReport *training,
                            R34WEvaluation *evaluation,
                            R34WEvaluation *canonical,
                            R34WEvaluation *masked, R34WEvaluation *tool,
                            char *error, size_t error_capacity)
{
    R33Model canonical_model;
    R33TrainingReport canonical_training;
    R0Status status = r34w_train(model, 2, training, error,
                                 error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(model, 3, R31_FEEDBACK_FULL, 1,
                               evaluation, error, error_capacity);
    if (status == R0_OK)
        status = r33_train(&canonical_model, 2, &canonical_training,
                           error, error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(&canonical_model, 3, R31_FEEDBACK_FULL, 0,
                               canonical, error, error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(model, 3, R31_FEEDBACK_RANKER_MASKED, 0,
                               masked, error, error_capacity);
    if (status == R0_OK)
        status = r34w_evaluate(model, 3, R31_FEEDBACK_TOOL_ONLY, 0,
                               tool, error, error_capacity);
    return status;
}

static void print_development(const R33Model *model,
                              const R34WTrainingReport *training,
                              const R34WEvaluation *evaluation,
                              const R34WEvaluation *canonical,
                              const R34WEvaluation *masked,
                              const R34WEvaluation *tool)
{
    int feature;
    printf("{\"schema\":\"zero.reasoner34_witness_development.v1\","
           "\"version\":\"(3,3,4)\",\"sealed_dimension_opened\":false,"
           "\"training_cases\":%u,\"epochs\":%u,\"mistakes\":%u,"
           "\"final_errors\":%u,\"programs\":%u,"
           "\"robust_programs\":%u,\"decisions\":%u,"
           "\"exact_decisions\":%u,\"permutation_cases\":%u,"
           "\"permutation_exact\":%u,"
           "\"canonical_control_robust_programs\":%u,"
           "\"canonical_control_exact_decisions\":%u,"
           "\"masked_robust_programs\":%u,"
           "\"masked_exact_decisions\":%u,"
           "\"tool_robust_programs\":%u,"
           "\"tool_exact_decisions\":%u,\"weights\":[",
           training->cases, training->epochs, training->mistakes,
           training->final_errors, evaluation->programs,
           evaluation->robust_programs, evaluation->decisions,
           evaluation->exact_decisions, evaluation->permutation_cases,
           evaluation->permutation_exact, canonical->robust_programs,
           canonical->exact_decisions, masked->robust_programs,
           masked->exact_decisions, tool->robust_programs,
           tool->exact_decisions);
    for (feature = 0; feature < R33_FEATURE_COUNT; ++feature)
        printf("%s%d", feature == 0 ? "" : ",", model->weights[feature]);
    printf("],\"gate_passed\":%s}\n", evaluation->exact ? "true" : "false");
}

static int self_test(void)
{
    static const int32_t expected_weights[R33_FEATURE_COUNT] = {
        0, 0, 0, 0, 1, 0, 0, 0,
        0, 0, 1, 0, 0, 0, 0, 0,
    };
    R33Model model;
    R34WTrainingReport training;
    R34WEvaluation evaluation, canonical, masked, tool;
    char error[256] = {0};
    R0Status status = development(&model, &training, &evaluation,
                                  &canonical, &masked, &tool, error,
                                  sizeof(error));
    if (status != R0_OK || !evaluation.exact ||
        training.cases != 1845 || training.epochs != 3 ||
        training.mistakes != 2 || training.final_errors != 0 ||
        training.nonzero_weights != 2 ||
        training.active_weight_bytes != 64 ||
        evaluation.programs != 511 ||
        evaluation.robust_programs != 511 ||
        evaluation.decisions != 101436 ||
        evaluation.exact_decisions != 101436 ||
        evaluation.permutation_cases != 9600 ||
        evaluation.permutation_exact != 9600 ||
        canonical.exact_decisions != 67576 ||
        masked.exact_decisions != 19253 ||
        tool.exact_decisions != 19253 ||
        memcmp(model.weights, expected_weights,
               sizeof(expected_weights)) != 0) {
        fprintf(stderr, "self-test failed: %s\n",
                error[0] == '\0' ? "development gate failed" : error);
        return 0;
    }
    puts("Reasoner (3,3,4) witness-order development passed; 4D stayed sealed");
    return 1;
}

int main(int argc, char **argv)
{
    R33Model model;
    R34WTrainingReport training;
    R34WEvaluation evaluation, canonical, masked, tool;
    R34WExperimentReport experiment;
    char error[256] = {0};
    R0Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "development") == 0) {
        status = development(&model, &training, &evaluation, &canonical,
                             &masked, &tool, error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_development(&model, &training, &evaluation, &canonical,
                          &masked, &tool);
        return evaluation.exact ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        status = r34w_run_sealed(&experiment, error, sizeof(error));
        if (status == R0_OK)
            status = r34w_write_result(&experiment, argv[2], error,
                                       sizeof(error));
        if (status != R0_OK) goto fail;
        printf("{\"schema\":\"zero.reasoner34_witness_summary.v1\","
               "\"version\":\"(3,3,4)\",\"programs\":%u,"
               "\"robust_programs\":%u,\"decisions\":%u,"
               "\"exact_decisions\":%u,\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               experiment.semantic.programs,
               experiment.semantic.robust_programs,
               experiment.semantic.decisions,
               experiment.semantic.exact_decisions,
               experiment.sealed_gate_passed ? "true" : "false",
               experiment.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
    return EXIT_FAILURE;
}
