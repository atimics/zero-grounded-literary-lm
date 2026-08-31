#include "reasoner39.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R39_SEALED_EXECUTION");
    const char *lock = getenv("R39_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed exact-law cases are cloud-only");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R39_EXECUTION_LOCK is required");
        return 0;
    }
    descriptor = open(lock, O_WRONLY | O_CREAT | O_EXCL, 0444);
    if (descriptor < 0) {
        (void)snprintf(error, capacity,
                       "sealed execution lock already exists");
        return 0;
    }
    if (close(descriptor) != 0) {
        (void)snprintf(error, capacity,
                       "cannot close sealed execution lock");
        return 0;
    }
    return 1;
}

static void print_report(const R39ExperimentReport *report)
{
    uint8_t feature;
    printf("{\"schema\":\"zero.reasoner39_exact_law_screen.v1\","
           "\"version\":\"(3,8)\",\"policy_bytes\":%u,"
           "\"raw_candidates_examined\":%u,"
           "\"raw_certified_candidates\":%u,"
           "\"raw_minimum_solutions\":%u,"
           "\"raw_description_length\":%u,"
           "\"protocol_candidates_examined\":%u,"
           "\"protocol_description_length\":%u,"
           "\"training_episodes\":%u,"
           "\"training_margin_errors\":%u,"
           "\"episodes\":%u,\"mixed_episodes\":%u,"
           "\"decisions\":%u,\"exact_decisions\":%u,"
           "\"margin_errors\":%u,"
           "\"coordinate_permutations\":%u,"
           "\"primitive_law_passed\":%s,"
           "\"algebraic_certificate_passed\":%s,"
           "\"minimum_description_passed\":%s,"
           "\"semantic_oracle_passed\":%s,"
           "\"zero_control_passed\":%s,"
           "\"shuffled_raw_feedback_passed\":%s,"
           "\"linear_only_control_passed\":%s,"
           "\"perceptron_training_fit_passed\":%s,"
           "\"perceptron_certificate_passed\":%s,"
           "\"development_gate_passed\":%s,\"weights\":[",
           report->policy_bytes,
           report->raw_candidates_examined,
           report->raw_certified_candidates,
           report->raw_minimum_solutions,
           report->raw_description_length,
           report->protocol_candidates_examined,
           report->protocol_description_length,
           report->training_episodes, report->training_margin_errors,
           report->development.episodes,
           report->development.mixed_episodes,
           report->development.decisions,
           report->development.exact_decisions,
           report->development.margin_errors,
           report->development.coordinate_permutations,
           report->primitive_law_passed ? "true" : "false",
           report->algebraic_certificate_passed ? "true" : "false",
           report->minimum_description_passed ? "true" : "false",
           report->semantic_oracle_passed ? "true" : "false",
           report->zero_control_passed ? "true" : "false",
           report->shuffled_raw_feedback_passed ? "true" : "false",
           report->linear_only_control_passed ? "true" : "false",
           report->perceptron_training_fit_passed ? "true" : "false",
           report->perceptron_certificate_passed ? "true" : "false",
           report->development_gate_passed ? "true" : "false");
    for (feature = 0; feature < R39_FEATURE_COUNT; ++feature)
        printf("%s%d", feature == 0 ? "" : ",",
               report->weights[feature]);
    printf("],\"perceptron_raw_weights\":[");
    for (feature = 0; feature < R39_RAW_FEATURES; ++feature)
        printf("%s%d", feature == 0 ? "" : ",",
               report->perceptron_raw_weights[feature]);
    printf("],\"result_digest\":\"%016" PRIx64 "\"}\n",
           report->result_digest);
}

int main(int argc, char **argv)
{
    R39ExperimentReport report;
    char error[512] = {0};
    R0Status status;
    if (!((argc == 2 && (strcmp(argv[1], "development") == 0 ||
                         strcmp(argv[1], "--self-test") == 0)) ||
          (argc == 3 && strcmp(argv[1], "sealed-run") == 0))) {
        fprintf(stderr,
                "usage: %s development|--self-test|sealed-run RESULT.json\n",
                argv[0]);
        return EXIT_FAILURE;
    }
    if (argc == 3) {
        if (!claim_sealed_execution(error, sizeof(error))) {
            fprintf(stderr, "error: %s\n", error);
            return EXIT_FAILURE;
        }
        status = r39_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r39_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner39_sealed_summary.v1\","
               "\"version\":\"(3,8)\",\"episodes\":%u,"
               "\"mixed_episodes\":%u,\"decisions\":%u,"
               "\"exact_decisions\":%u,\"margin_errors\":%u,"
               "\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.episodes, report.sealed.mixed_episodes,
               report.sealed.decisions, report.sealed.exact_decisions,
               report.sealed.margin_errors,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r39_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner (3,8) exact-law screen passed; the fresh sealed "
             "dimension transfer remains cloud-only");
        return EXIT_SUCCESS;
    }
    print_report(&report);
    return EXIT_SUCCESS;
}
