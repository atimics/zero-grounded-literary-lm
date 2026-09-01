#include "reasoner41.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_evaluation(const R41Evaluation *evaluation)
{
    printf("{\"episodes\":%u,\"target_adapters\":%u,"
           "\"target_laws\":%u,\"target_pairs\":%u,"
           "\"adapter_queries\":%u,\"exact_adapter_queries\":%u,"
           "\"exact_adapter_identifications\":%u,"
           "\"exact_adapter_commits\":%u,"
           "\"premature_adapter_commits\":%u,"
           "\"replay_checks\":%u,\"exact_replays\":%u,"
           "\"law_queries\":%u,\"exact_law_queries\":%u,"
           "\"exact_law_identifications\":%u,"
           "\"exact_law_commits\":%u,"
           "\"premature_law_commits\":%u,"
           "\"actions\":%u,\"exact_actions\":%u,"
           "\"exact_commits\":%u,\"exact_reports\":%u,"
           "\"premature_commits\":%u,"
           "\"maximum_adapter_queries\":%u,"
           "\"maximum_law_queries\":%u,\"exact\":%s}",
           evaluation->episodes, evaluation->target_adapters,
           evaluation->target_laws, evaluation->target_pairs,
           evaluation->adapter_queries, evaluation->exact_adapter_queries,
           evaluation->exact_adapter_identifications,
           evaluation->exact_adapter_commits,
           evaluation->premature_adapter_commits,
           evaluation->replay_checks, evaluation->exact_replays,
           evaluation->law_queries, evaluation->exact_law_queries,
           evaluation->exact_law_identifications,
           evaluation->exact_law_commits,
           evaluation->premature_law_commits,
           evaluation->actions, evaluation->exact_actions,
           evaluation->exact_commits, evaluation->exact_reports,
           evaluation->premature_commits,
           evaluation->maximum_adapter_queries,
           evaluation->maximum_law_queries,
           evaluation->exact ? "true" : "false");
}

static void print_development(const R41ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner41_joint_transfer_screen.v1\","
           "\"version\":\"4.1\","
           "\"canonical_adapter_programs\":%u,"
           "\"canonical_law_programs\":%u,"
           "\"curriculum_adapters\":%u,"
           "\"development_adapters\":%u,"
           "\"sealed_adapters\":%u,"
           "\"curriculum_laws\":%u,"
           "\"development_laws\":%u,"
           "\"sealed_laws\":%u,"
           "\"development_pairs\":%u,"
           "\"planned_sealed_pairs\":%u,"
           "\"planned_sealed_episodes\":%u,"
           "\"frozen_representation_core_passed\":%s,"
           "\"frozen_law_core_passed\":%s,"
           "\"separate_commit_certificate_passed\":%s,"
           "\"oracle_adapter_control_passed\":%s,"
           "\"oracle_law_control_passed\":%s,"
           "\"identity_adapter_control_passed\":%s,"
           "\"curriculum_pair_control_passed\":%s,"
           "\"no_adapter_query_control_passed\":%s,"
           "\"no_law_query_control_passed\":%s,"
           "\"shuffled_alignment_control_passed\":%s,"
           "\"shuffled_law_feedback_control_passed\":%s,"
           "\"sealed_execution_locked\":%s,\"curriculum\":",
           report->canonical_adapter_programs,
           report->canonical_law_programs,
           report->curriculum_adapters, report->development_adapters,
           report->sealed_adapters, report->curriculum_laws,
           report->development_laws, report->sealed_laws,
           report->development_pairs, report->planned_sealed_pairs,
           report->planned_sealed_episodes,
           report->frozen_representation_core_passed ? "true" : "false",
           report->frozen_law_core_passed ? "true" : "false",
           report->separate_commit_certificate_passed ? "true" : "false",
           report->oracle_adapter_control_passed ? "true" : "false",
           report->oracle_law_control_passed ? "true" : "false",
           report->identity_adapter_control_passed ? "true" : "false",
           report->curriculum_pair_control_passed ? "true" : "false",
           report->no_adapter_query_control_passed ? "true" : "false",
           report->no_law_query_control_passed ? "true" : "false",
           report->shuffled_alignment_control_passed ? "true" : "false",
           report->shuffled_law_feedback_control_passed ? "true" : "false",
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
    R41ExperimentReport report;
    char error[512] = {0};
    R0Status status;
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        (void)argv[2];
        fprintf(stderr,
                "error: Reasoner 4.1 seal is locked and unauthorized\n");
        return EXIT_FAILURE;
    }
    if (argc != 2 ||
        (strcmp(argv[1], "development") != 0 &&
         strcmp(argv[1], "--self-test") != 0)) {
        fprintf(stderr,
                "usage: %s development|--self-test|sealed-run RESULT.json\n",
                argv[0]);
        return EXIT_FAILURE;
    }
    status = r41_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner 4.1 joint representation-and-law screen passed; "
             "the three-by-three seal remains locked and unauthorized");
        return EXIT_SUCCESS;
    }
    print_development(&report);
    return EXIT_SUCCESS;
}
