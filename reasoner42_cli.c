#include "reasoner42.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define R42_APPROVAL_ID \
    "reasoner42-abstraction-library-2026-09-01-v1"

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R42_SEALED_EXECUTION");
    const char *approval = getenv("R42_SEAL_APPROVAL_ID");
    const char *lock = getenv("R42_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed abstraction-library cases are cloud-only");
        return 0;
    }
    if (approval == NULL || strcmp(approval, R42_APPROVAL_ID) != 0) {
        (void)snprintf(error, capacity,
                       "sealed-run requires the frozen approval id");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R42_EXECUTION_LOCK is required");
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

static void print_evaluation(const R42Evaluation *evaluation)
{
    printf("{\"target_programs\":%u,\"episodes\":%u,"
           "\"queries\":%u,\"exact_queries\":%u,"
           "\"exact_identifications\":%u,\"exact_commits\":%u,"
           "\"premature_commits\":%u,\"replay_checks\":%u,"
           "\"exact_replays\":%u,\"exact_applications\":%u,"
           "\"exact_reports\":%u,\"maximum_queries\":%u,"
           "\"exact\":%s}",
           evaluation->target_programs, evaluation->episodes,
           evaluation->queries, evaluation->exact_queries,
           evaluation->exact_identifications, evaluation->exact_commits,
           evaluation->premature_commits, evaluation->replay_checks,
           evaluation->exact_replays, evaluation->exact_applications,
           evaluation->exact_reports, evaluation->maximum_queries,
           evaluation->exact ? "true" : "false");
}

static void print_report(const R42ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner42_abstraction_library.v1\","
           "\"version\":\"4.2\","
           "\"curriculum_raw_programs\":%u,"
           "\"curriculum_canonical_programs\":%u,"
           "\"learned_library_entries\":%u,"
           "\"learned_library_occurrences\":%u,"
           "\"learned_library_mdl_gain\":%u,"
           "\"development_raw_programs\":%u,"
           "\"development_canonical_programs\":%u,"
           "\"development_target_programs\":%u,"
           "\"development_base_tokens\":%u,"
           "\"development_library_tokens\":%u,"
           "\"base_depth_four_raw_programs\":%u,"
           "\"planned_sealed_raw_programs\":%u,"
           "\"planned_sealed_base_raw_programs\":%u,"
           "\"sealed_base_tokens\":%u,"
           "\"sealed_library_tokens\":%u,"
           "\"frozen_base_certificate_passed\":%s,"
           "\"affine_certificate_passed\":%s,"
           "\"library_discovery_certificate_passed\":%s,"
           "\"compression_certificate_passed\":%s,"
           "\"search_budget_certificate_passed\":%s,"
           "\"semantic_oracle_control_passed\":%s,"
           "\"no_library_control_passed\":%s,"
           "\"shuffled_curriculum_control_passed\":%s,"
           "\"single_use_library_control_passed\":%s,"
           "\"curriculum_lookup_control_passed\":%s,"
           "\"no_query_control_passed\":%s,"
           "\"sealed_minimum_certificate_passed\":%s,"
           "\"development_gate_passed\":%s,"
           "\"sealed_execution_locked\":%s,"
           "\"library_digest\":\"%016" PRIx64 "\","
           "\"result_digest\":\"%016" PRIx64 "\","
           "\"curriculum\":",
           report->curriculum_raw_programs,
           report->curriculum_canonical_programs,
           report->learned_library_entries,
           report->learned_library_occurrences,
           report->learned_library_mdl_gain,
           report->development_raw_programs,
           report->development_canonical_programs,
           report->development_target_programs,
           report->development_base_tokens,
           report->development_library_tokens,
           report->base_depth_four_raw_programs,
           report->planned_sealed_raw_programs,
           report->planned_sealed_base_raw_programs,
           report->sealed_base_tokens,
           report->sealed_library_tokens,
           report->frozen_base_certificate_passed ? "true" : "false",
           report->affine_certificate_passed ? "true" : "false",
           report->library_discovery_certificate_passed ? "true" : "false",
           report->compression_certificate_passed ? "true" : "false",
           report->search_budget_certificate_passed ? "true" : "false",
           report->semantic_oracle_control_passed ? "true" : "false",
           report->no_library_control_passed ? "true" : "false",
           report->shuffled_curriculum_control_passed ? "true" : "false",
           report->single_use_library_control_passed ? "true" : "false",
           report->curriculum_lookup_control_passed ? "true" : "false",
           report->no_query_control_passed ? "true" : "false",
           report->sealed_minimum_certificate_passed ? "true" : "false",
           report->development_gate_passed ? "true" : "false",
           report->sealed_execution_locked ? "true" : "false",
           report->library_digest, report->result_digest);
    print_evaluation(&report->curriculum);
    printf(",\"development\":");
    print_evaluation(&report->development);
    printf(",\"planned_sealed_targets\":%u}\n",
           report->sealed.target_programs);
}

static int run_development(const char *output_path)
{
    R42ExperimentReport report;
    char error[256] = {0};
    if (r42_run_development(&report, error, sizeof(error)) != R0_OK) {
        fprintf(stderr, "Reasoner 4.2 failed: %s\n", error);
        return 1;
    }
    if (output_path != NULL &&
        r42_write_result(&report, output_path, error, sizeof(error)) != R0_OK) {
        fprintf(stderr, "Reasoner 4.2 result failed: %s\n", error);
        return 1;
    }
    print_report(&report);
    return 0;
}

int main(int argc, char **argv)
{
    R42ExperimentReport report;
    char error[512] = {0};
    R0Status status;
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        if (!claim_sealed_execution(error, sizeof(error))) {
            fprintf(stderr, "error: %s\n", error);
            return EXIT_FAILURE;
        }
        status = r42_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r42_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner42_sealed_summary.v1\","
               "\"version\":\"4.2\",\"target_programs\":%u,"
               "\"episodes\":%u,\"queries\":%u,"
               "\"exact_queries\":%u,\"replay_checks\":%u,"
               "\"exact_replays\":%u,\"applications\":%u,"
               "\"exact_applications\":%u,\"exact_commits\":%u,"
               "\"exact_reports\":%u,\"premature_commits\":%u,"
               "\"maximum_queries\":%u,\"gate_passed\":%s,"
               "\"library_digest\":\"%016" PRIx64 "\","
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.target_programs, report.sealed.episodes,
               report.sealed.queries, report.sealed.exact_queries,
               report.sealed.replay_checks, report.sealed.exact_replays,
               report.sealed.applications,
               report.sealed.exact_applications,
               report.sealed.exact_commits, report.sealed.exact_reports,
               report.sealed.premature_commits,
               report.sealed.maximum_queries,
               report.sealed_gate_passed ? "true" : "false",
               report.library_digest, report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return run_development(NULL);
    if (argc == 2 && strcmp(argv[1], "development") == 0)
        return run_development(NULL);
    if (argc == 3 && strcmp(argv[1], "development") == 0)
        return run_development(argv[2]);
    fprintf(stderr,
            "usage: %s --self-test | development [result.json] | "
            "sealed-run RESULT.json\n",
            argv[0]);
    return 2;
}
