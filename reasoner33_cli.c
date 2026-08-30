#include "reasoner33.h"

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

static int check(int condition, const char *message)
{
    if (!condition) fprintf(stderr, "self-test failed: %s\n", message);
    return condition;
}

static void print_development(const R33TrainingReport *training,
                              const R33Evaluation *development,
                              const R33Evaluation *hashed)
{
    printf("{\"schema\":\"zero.reasoner33_development.v1\","
           "\"version\":\"(3,3)\",\"sealed_dimension_opened\":false,"
           "\"training_dimensions\":2,\"training_cases\":%u,"
           "\"epochs\":%u,\"mistakes\":%u,"
           "\"final_errors\":%u,\"nonzero_weights\":%u,"
           "\"active_weight_bytes\":%u,"
           "\"development_programs\":%u,"
           "\"development_minimal\":%u,"
           "\"permutation_cases\":%u,"
           "\"permutation_exact\":%u,"
           "\"hashed_control_programs\":%u,"
           "\"hashed_control_minimal\":%u,"
           "\"gate_passed\":%s}\n",
           training->cases, training->epochs, training->mistakes,
           training->final_errors, training->nonzero_weights,
           training->active_weight_bytes, development->programs,
           development->minimal, development->permutation_cases,
           development->permutation_exact, hashed->programs,
           hashed->minimal,
           development->exact && hashed->exact ? "true" : "false");
}

static R0Status run_development(R33TrainingReport *training,
                                R33Evaluation *development,
                                R33Evaluation *hashed, char *error,
                                size_t error_capacity)
{
    R33Model model;
    R0Status status =
        r33_train(&model, 2, training, error, error_capacity);
    if (status == R0_OK)
        status = r33_evaluate(&model, 3, R31_FEEDBACK_FULL, development,
                              error, error_capacity);
    if (status == R0_OK)
        status = r33_check_hashed_3d(hashed, error, error_capacity);
    return status;
}

static int self_test(void)
{
    static const int32_t expected_weights[R33_FEATURE_COUNT] = {
        0, -2, 2, 2, 0, 4, -2, 0,
        0, 0, 1, 2, 0, -2, 2, 0,
    };
    R33Model model;
    R33TrainingReport training;
    R33Evaluation development, hashed;
    char error[256] = {0};
    R0Status status;

    if (!check(r33_program_count(1) == 7 &&
                   r33_program_count(2) == 63 &&
                   r33_program_count(3) == 511 &&
                   r33_program_count(4) == 4095,
               "the dimension census is exact"))
        return 0;
    status = r33_train(&model, 2, &training, error, sizeof(error));
    if (status == R0_OK)
        status = r33_evaluate(&model, 3, R31_FEEDBACK_FULL,
                              &development, error, sizeof(error));
    if (status == R0_OK)
        status = r33_check_hashed_3d(&hashed, error, sizeof(error));
    if (!check(status == R0_OK,
               error[0] == '\0' ? "development checks pass" : error) ||
        !check(training.cases == 1496 && training.epochs == 4 &&
                   training.mistakes == 3 &&
                   training.final_errors == 0 &&
                   training.nonzero_weights == 9 &&
                   training.active_weight_bytes == 64 &&
                   memcmp(model.weights, expected_weights,
                          sizeof(expected_weights)) == 0,
               "the shared semantic learner is frozen") ||
        !check(development.programs == 511 &&
                   development.solved == 511 &&
                   development.minimal == 511 &&
                   development.failed == 0 &&
                   development.permutation_cases == 9600 &&
                   development.permutation_exact == 9600 &&
                   development.exact,
               "the unopened 3D development gate is exact") ||
        !check(hashed.programs == 511 && hashed.minimal == 511 &&
                   hashed.exact,
               "the generic hashed runner reproduces (3,2) in 3D"))
        return 0;
    puts("Reasoner (3,3) development self-test passed; 4D stayed sealed");
    return 1;
}

int main(int argc, char **argv)
{
    R33TrainingReport training;
    R33Evaluation development, hashed;
    R33ExperimentReport experiment;
    char error[256] = {0};
    R0Status status;

    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "development") == 0) {
        status = run_development(&training, &development, &hashed, error,
                                 sizeof(error));
        if (status != R0_OK) goto fail;
        print_development(&training, &development, &hashed);
        return development.exact && hashed.exact ? EXIT_SUCCESS
                                                  : EXIT_FAILURE;
    }
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        status = r33_run_sealed(&experiment, error, sizeof(error));
        if (status == R0_OK)
            status = r33_write_result(&experiment, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) goto fail;
        printf("{\"schema\":\"zero.reasoner33_sealed_summary.v1\","
               "\"version\":\"(3,3)\",\"programs\":%u,"
               "\"semantic_minimal\":%u,"
               "\"hashed_control_minimal\":%u,"
               "\"witness_masked_minimal\":%u,"
               "\"tool_only_minimal\":%u,"
               "\"equal_pairs\":%u,\"equal_pairs_exact\":%u,"
               "\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               experiment.semantic.programs,
               experiment.semantic.minimal,
               experiment.hashed_control.minimal,
               experiment.witness_masked.minimal,
               experiment.tool_only.minimal,
               experiment.equal_admissibility_pairs,
               experiment.equal_admissibility_pairs_exact,
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
