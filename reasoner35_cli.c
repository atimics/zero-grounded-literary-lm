#include "reasoner35.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R35_SEALED_EXECUTION");
    const char *lock = getenv("R35_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed combinations are cloud-only");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R35_EXECUTION_LOCK is required");
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

static void print_report(const R35ExperimentReport *report)
{
    static const char *names[R35_ARM_COUNT] = {
        "planning+composition", "planning+witness",
        "composition+witness", "planning+composition+witness",
        "sequential-control"};
    uint8_t arm;
    printf("{\"schema\":\"zero.reasoner35_joint_screen.v1\","
           "\"version\":\"(3,4)\",\"shared_policy_bytes\":%u,"
           "\"independent_control_bytes\":%u,\"arms\":[",
           report->shared_policy_bytes,
           report->independent_control_bytes);
    for (arm = 0; arm < R35_ARM_COUNT; ++arm) {
        const R35ArmReport *item = &report->arms[arm];
        printf("%s{\"name\":\"%s\",\"task_mask\":%u,"
               "\"sequential\":%s,\"epochs\":%u,\"mistakes\":%u,"
               "\"training_errors\":[%u,%u,%u],"
               "\"planning_optimal\":%u,"
               "\"composition_minimal\":%u,"
               "\"witness_robust\":%u,\"passed\":%s,"
               "\"weights\":[",
               arm == 0 ? "" : ",", names[arm], item->task_mask,
               item->sequential ? "true" : "false", item->epochs,
               item->mistakes, item->training_errors[0],
               item->training_errors[1], item->training_errors[2],
               item->planning.optimal, item->composition.minimal,
               item->witness.robust_programs,
               item->development_passed ? "true" : "false");
        {
            uint8_t feature;
            for (feature = 0; feature < R34_FEATURE_COUNT; ++feature)
                printf("%s%d", feature == 0 ? "" : ",",
                       item->weights[feature]);
        }
        putchar(']');
        putchar('}');
    }
    printf("],\"independent_control_passed\":%s,"
           "\"zero_control_passed_tasks\":%u,"
           "\"mechanics_passed\":%s,\"joint_gate_passed\":%s,"
           "\"result_digest\":\"%016" PRIx64 "\"}\n",
           report->independent_control_passed ? "true" : "false",
           report->zero_control_passed_tasks,
           report->mechanics_passed ? "true" : "false",
           report->joint_gate_passed ? "true" : "false",
           report->result_digest);
}

int main(int argc, char **argv)
{
    R35ExperimentReport report;
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
        status = r35_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r35_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner35_sealed_summary.v1\","
               "\"version\":\"(3,4)\",\"planning_worlds\":%u,"
               "\"planning_optimal\":%u,"
               "\"composition_programs\":%u,"
               "\"composition_minimal\":%u,"
               "\"witness_programs\":%u,"
               "\"witness_robust\":%u,\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed_planning.worlds,
               report.sealed_planning.optimal,
               report.sealed_composition.programs,
               report.sealed_composition.minimal,
               report.sealed_witness.programs,
               report.sealed_witness.robust_programs,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r35_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner (3,4) joint-policy screen passed its mechanics; "
             "the scientific gate is reported separately");
        return EXIT_SUCCESS;
    }
    print_report(&report);
    return EXIT_SUCCESS;
}
