#include "reasoner36.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R36_SEALED_EXECUTION");
    const char *lock = getenv("R36_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed combinations are cloud-only");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R36_EXECUTION_LOCK is required");
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

static void print_report(const R36ExperimentReport *report)
{
    uint8_t feature;
    printf("{\"schema\":\"zero.reasoner36_task_blind_screen.v1\","
           "\"version\":\"(3,5)\",\"epochs\":%u,"
           "\"mistakes\":%u,\"training_errors\":%u,"
           "\"shared_policy_bytes\":%u,"
           "\"routed_control_bytes\":%u,"
           "\"development_episodes\":%u,"
           "\"mixed_episodes\":%u,\"decisions\":%u,"
           "\"exact_decisions\":%u,"
           "\"routed_control_passed\":%s,"
           "\"zero_control_passed\":%s,"
           "\"shuffled_feedback_passed\":%s,"
           "\"development_gate_passed\":%s,\"weights\":[",
           report->epochs, report->mistakes, report->training_errors,
           report->shared_policy_bytes, report->routed_control_bytes,
           report->development.episodes,
           report->development.mixed_episodes,
           report->development.decisions,
           report->development.exact_decisions,
           report->routed_control_passed ? "true" : "false",
           report->zero_control_passed ? "true" : "false",
           report->shuffled_feedback_passed ? "true" : "false",
           report->development_gate_passed ? "true" : "false");
    for (feature = 0; feature < R36_FEATURE_COUNT; ++feature)
        printf("%s%d", feature == 0 ? "" : ",", report->weights[feature]);
    printf("],\"result_digest\":\"%016" PRIx64 "\"}\n",
           report->result_digest);
}

int main(int argc, char **argv)
{
    R36ExperimentReport report;
    char error[256] = {0};
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
        status = r36_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r36_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner36_sealed_summary.v1\","
               "\"version\":\"(3,5)\",\"episodes\":%u,"
               "\"mixed_episodes\":%u,\"decisions\":%u,"
               "\"exact_decisions\":%u,\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.episodes, report.sealed.mixed_episodes,
               report.sealed.decisions, report.sealed.exact_decisions,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r36_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner (3,5) task-blind tool screen passed; the sealed "
             "combinations remain cloud-only");
        return EXIT_SUCCESS;
    }
    print_report(&report);
    return EXIT_SUCCESS;
}
