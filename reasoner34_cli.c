#include "reasoner34.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s development\n"
            "  %s sealed-run RESULT.json\n"
            "  %s --self-test\n",
            program, program, program);
}

static int claim_execution_lock(char *error, size_t error_capacity)
{
    const char *cloud = getenv("R34_SEALED_EXECUTION");
    const char *lock = getenv("R34_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, error_capacity,
                       "sealed cases are cloud-only; set "
                       "R34_SEALED_EXECUTION=cloud in the runner");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, error_capacity,
                       "R34_EXECUTION_LOCK is required");
        return 0;
    }
    descriptor = open(lock, O_WRONLY | O_CREAT | O_EXCL, 0444);
    if (descriptor < 0) {
        (void)snprintf(error, error_capacity,
                       "sealed execution lock already exists or cannot "
                       "be created");
        return 0;
    }
    {
        static const char claim[] =
            "reasoner34 sealed execution claimed\n";
        if (write(descriptor, claim, sizeof(claim) - 1) !=
            (ssize_t)(sizeof(claim) - 1)) {
            (void)close(descriptor);
            (void)snprintf(error, error_capacity,
                           "could not write sealed execution lock");
            return 0;
        }
    }
    if (close(descriptor) != 0) {
        (void)snprintf(error, error_capacity,
                       "could not close sealed execution lock");
        return 0;
    }
    return 1;
}

static void print_development(const R34TrainingReport *training,
                              const R34Evaluation *semantic,
                              const R34Evaluation *hash)
{
    printf("{\"schema\":\"zero.reasoner34_development.v1\","
           "\"version\":\"(3,3,1)\","
           "\"sealed_graphs_opened\":false,"
           "\"training_graphs\":[\"path2\",\"path3\"],"
           "\"training_cases\":%u,\"epochs\":%u,"
           "\"mistakes\":%u,\"final_errors\":%u,"
           "\"nonzero_weights\":%u,"
           "\"active_weight_bytes\":%u,"
           "\"development_graphs\":[\"path4\",\"star4\"],"
           "\"development_programs\":%u,"
           "\"development_minimal\":%u,"
           "\"relabeling_cases\":%" PRIu64 ","
           "\"relabeling_exact\":%" PRIu64 ","
           "\"hash_control_minimal\":%u,"
           "\"hash_control_exact\":%s,"
           "\"gate_passed\":%s}\n",
           training->cases, training->epochs, training->mistakes,
           training->final_errors, training->nonzero_weights,
           training->active_weight_bytes, semantic->programs,
           semantic->minimal, semantic->relabeling_cases,
           semantic->relabeling_exact, hash->minimal,
           hash->exact ? "true" : "false",
           semantic->exact && !hash->exact ? "true" : "false");
}

static int run_development(char *error, size_t error_capacity)
{
    R34Model semantic_model, hash_model;
    R34TrainingReport training;
    R34Evaluation semantic, hash;
    R0Status status = r34_train(&semantic_model, &hash_model, &training,
                                error, error_capacity);
    if (status == R0_OK)
        status = r34_evaluate_development(
            &semantic_model, &hash_model, &semantic, &hash, error,
            error_capacity);
    if (status != R0_OK) return 0;
    print_development(&training, &semantic, &hash);
    return semantic.exact && !hash.exact;
}

int main(int argc, char **argv)
{
    R34ExperimentReport report;
    char error[256] = {0};
    R0Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        if (!r34_self_test(error, sizeof(error))) goto fail;
        puts("Reasoner (3,3,1) development self-test passed; "
             "all five-variable graphs stayed sealed");
        return EXIT_SUCCESS;
    }
    if (argc == 2 && strcmp(argv[1], "development") == 0) {
        if (!run_development(error, sizeof(error))) goto fail;
        return EXIT_SUCCESS;
    }
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        if (!claim_execution_lock(error, sizeof(error))) goto fail;
        status = r34_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r34_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) goto fail;
        printf("{\"schema\":\"zero.reasoner34_sealed_summary.v1\","
               "\"version\":\"(3,3,1)\",\"programs\":%u,"
               "\"semantic_minimal\":%u,"
               "\"hash_control_minimal\":%u,"
               "\"witness_masked_minimal\":%u,"
               "\"tool_only_minimal\":%u,"
               "\"relabeling_cases\":%" PRIu64 ","
               "\"relabeling_exact\":%" PRIu64 ","
               "\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.semantic.programs, report.semantic.minimal,
               report.hash_control.minimal,
               report.witness_masked.minimal,
               report.tool_only.minimal,
               report.semantic.relabeling_cases,
               report.semantic.relabeling_exact,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s\n", error[0] == '\0' ?
            "Reasoner (3,3,1) failed" : error);
    return EXIT_FAILURE;
}
