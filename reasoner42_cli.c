#include "reasoner42.h"

#include <inttypes.h>
#include <stdio.h>
#include <string.h>

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
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return run_development(NULL);
    if (argc == 2 && strcmp(argv[1], "development") == 0)
        return run_development(NULL);
    if (argc == 3 && strcmp(argv[1], "development") == 0)
        return run_development(argv[2]);
    if (argc >= 2 && strcmp(argv[1], "sealed-run") == 0) {
        fprintf(stderr,
                "Reasoner 4.2 sealed execution is locked and unauthorized\n");
        return 1;
    }
    fprintf(stderr,
            "usage: %s --self-test | development [result.json]\n",
            argv[0]);
    return 2;
}
