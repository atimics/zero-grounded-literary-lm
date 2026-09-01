#include "reasoner40.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define R40_APPROVAL_ID \
    "reasoner40-active-representation-2026-09-01-v1"

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R40_SEALED_EXECUTION");
    const char *approval = getenv("R40_SEAL_APPROVAL_ID");
    const char *lock = getenv("R40_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed representation cases are cloud-only");
        return 0;
    }
    if (approval == NULL || strcmp(approval, R40_APPROVAL_ID) != 0) {
        (void)snprintf(error, capacity,
                       "sealed-run requires the frozen approval id");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R40_EXECUTION_LOCK is required");
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

static void print_evaluation(const R40Evaluation *evaluation)
{
    printf("{\"episodes\":%u,\"target_adapters\":%u,"
           "\"target_laws\":%u,\"alignment_demonstrations\":%u,"
           "\"adapter_queries\":%u,\"exact_adapter_queries\":%u,"
           "\"exact_adapter_identifications\":%u,"
           "\"replay_checks\":%u,\"exact_replays\":%u,"
           "\"law_demonstrations\":%u,\"law_queries\":%u,"
           "\"exact_law_queries\":%u,"
           "\"exact_law_identifications\":%u,\"actions\":%u,"
           "\"exact_actions\":%u,\"exact_commits\":%u,"
           "\"exact_reports\":%u,\"premature_commits\":%u,"
           "\"maximum_adapter_queries\":%u,"
           "\"maximum_law_queries\":%u,\"exact\":%s}",
           evaluation->episodes, evaluation->target_adapters,
           evaluation->target_laws,
           evaluation->alignment_demonstrations,
           evaluation->adapter_queries, evaluation->exact_adapter_queries,
           evaluation->exact_adapter_identifications,
           evaluation->replay_checks, evaluation->exact_replays,
           evaluation->law_demonstrations, evaluation->law_queries,
           evaluation->exact_law_queries,
           evaluation->exact_law_identifications, evaluation->actions,
           evaluation->exact_actions, evaluation->exact_commits,
           evaluation->exact_reports, evaluation->premature_commits,
           evaluation->maximum_adapter_queries,
           evaluation->maximum_law_queries,
           evaluation->exact ? "true" : "false");
}

static void print_development(const R40ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner40_active_representation_screen.v1\","
           "\"version\":\"4.0\",\"raw_adapter_programs\":%u,"
           "\"canonical_adapter_programs\":%u,"
           "\"identity_adapters\":%u,\"curriculum_adapters\":%u,"
           "\"development_adapters\":%u,\"sealed_adapters\":%u,"
           "\"frozen_core_programs\":%u,\"familiar_laws\":%u,"
           "\"planned_sealed_episodes\":%u,"
           "\"adapter_canonicalization_passed\":%s,"
           "\"adapter_unique_minimum_passed\":%s,"
           "\"adapter_grammar_certificate_passed\":%s,"
           "\"frozen_core_certificate_passed\":%s,"
           "\"oracle_adapter_control_passed\":%s,"
           "\"identity_adapter_control_passed\":%s,"
           "\"curriculum_lookup_control_passed\":%s,"
           "\"no_adapter_query_control_passed\":%s,"
           "\"shuffled_alignment_control_passed\":%s,"
           "\"sealed_execution_locked\":%s,\"curriculum\":",
           report->raw_adapter_programs,
           report->canonical_adapter_programs,
           report->identity_adapters, report->curriculum_adapters,
           report->development_adapters, report->sealed_adapters,
           report->frozen_core_programs, report->familiar_laws,
           report->planned_sealed_episodes,
           report->adapter_canonicalization_passed ? "true" : "false",
           report->adapter_unique_minimum_passed ? "true" : "false",
           report->adapter_grammar_certificate_passed ? "true" : "false",
           report->frozen_core_certificate_passed ? "true" : "false",
           report->oracle_adapter_control_passed ? "true" : "false",
           report->identity_adapter_control_passed ? "true" : "false",
           report->curriculum_lookup_control_passed ? "true" : "false",
           report->no_adapter_query_control_passed ? "true" : "false",
           report->shuffled_alignment_control_passed ? "true" : "false",
           report->sealed_execution_locked ? "true" : "false");
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
    R40ExperimentReport report;
    char error[512] = {0};
    R0Status status;
    if (!((argc == 2 &&
           (strcmp(argv[1], "development") == 0 ||
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
        status = r40_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r40_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner40_sealed_summary.v1\","
               "\"version\":\"4.0\",\"episodes\":%u,"
               "\"target_adapters\":%u,\"target_laws\":%u,"
               "\"adapter_queries\":%u,"
               "\"exact_adapter_queries\":%u,"
               "\"replay_checks\":%u,\"exact_replays\":%u,"
               "\"law_queries\":%u,\"exact_law_queries\":%u,"
               "\"actions\":%u,\"exact_actions\":%u,"
               "\"premature_commits\":%u,\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.episodes, report.sealed.target_adapters,
               report.sealed.target_laws, report.sealed.adapter_queries,
               report.sealed.exact_adapter_queries,
               report.sealed.replay_checks, report.sealed.exact_replays,
               report.sealed.law_queries,
               report.sealed.exact_law_queries,
               report.sealed.actions, report.sealed.exact_actions,
               report.sealed.premature_commits,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r40_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner 4.0 active representation screen passed; the "
             "three-operation seal remains locked and unauthorized");
        return EXIT_SUCCESS;
    }
    print_development(&report);
    return EXIT_SUCCESS;
}
