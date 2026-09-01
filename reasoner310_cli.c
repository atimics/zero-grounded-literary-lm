#include "reasoner310.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R310_SEALED_EXECUTION");
    const char *lock = getenv("R310_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed active-law cases are cloud-only");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R310_EXECUTION_LOCK is required");
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

static void print_evaluation(const R310Evaluation *evaluation)
{
    printf("{\"episodes\":%u,\"target_programs\":%u,"
           "\"queries\":%u,\"exact_queries\":%u,"
           "\"exact_identifications\":%u,\"actions\":%u,"
           "\"exact_actions\":%u,\"premature_commits\":%u,"
           "\"maximum_queries\":%u,\"exact\":%s}",
           evaluation->episodes, evaluation->target_programs,
           evaluation->queries, evaluation->exact_queries,
           evaluation->exact_identifications, evaluation->actions,
           evaluation->exact_actions, evaluation->premature_commits,
           evaluation->maximum_queries,
           evaluation->exact ? "true" : "false");
}

static void print_development(const R310ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner310_active_law_screen.v1\","
           "\"version\":\"(3,9)\","
           "\"raw_point_programs\":%u,"
           "\"canonical_point_programs\":%u,"
           "\"canonical_fold_programs\":%u,"
           "\"raw_aggregate_programs\":%u,"
           "\"canonical_programs\":%u,"
           "\"curriculum_programs\":%u,"
           "\"open_programs\":%u,\"sealed_programs\":%u,"
           "\"canonicalization_passed\":%s,"
           "\"unique_minimum_passed\":%s,"
           "\"grammar_certificate_passed\":%s,"
           "\"fixed_quadratic_control_passed\":%s,"
           "\"curriculum_lookup_control_passed\":%s,"
           "\"no_query_control_passed\":%s,"
           "\"shuffled_feedback_control_passed\":%s,"
           "\"coefficient_only_control_passed\":%s,"
           "\"curriculum\":",
           report->raw_point_programs,
           report->canonical_point_programs,
           report->canonical_fold_programs,
           report->raw_aggregate_programs,
           report->canonical_programs,
           report->curriculum_programs, report->open_programs,
           report->sealed_programs,
           report->canonicalization_passed ? "true" : "false",
           report->unique_minimum_passed ? "true" : "false",
           report->grammar_certificate_passed ? "true" : "false",
           report->fixed_quadratic_control_passed ? "true" : "false",
           report->curriculum_lookup_control_passed ? "true" : "false",
           report->no_query_control_passed ? "true" : "false",
           report->shuffled_feedback_control_passed ? "true" : "false",
           report->coefficient_only_control_passed ? "true" : "false");
    print_evaluation(&report->curriculum);
    printf(",\"development\":");
    print_evaluation(&report->development);
    printf(",\"development_gate_passed\":%s,"
           "\"result_digest\":\"%016" PRIx64 "\"}\n",
           report->development_gate_passed ? "true" : "false",
           report->result_digest);
}

int main(int argc, char **argv)
{
    R310ExperimentReport report;
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
        status = r310_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r310_write_result(&report, argv[2], error,
                                       sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner310_sealed_summary.v1\","
               "\"version\":\"(3,9)\",\"episodes\":%u,"
               "\"target_programs\":%u,\"queries\":%u,"
               "\"exact_queries\":%u,\"actions\":%u,"
               "\"exact_actions\":%u,\"premature_commits\":%u,"
               "\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.episodes, report.sealed.target_programs,
               report.sealed.queries, report.sealed.exact_queries,
               report.sealed.actions, report.sealed.exact_actions,
               report.sealed.premature_commits,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r310_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner (3,9) active-law screen passed; the fresh three-part "
             "seal remains cloud-only");
        return EXIT_SUCCESS;
    }
    print_development(&report);
    return EXIT_SUCCESS;
}
