#include "reasoner34.h"

#include <ctype.h>
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

static int lowercase_hex(const char *text, size_t length)
{
    size_t index;
    if (text == NULL || strlen(text) != length) return 0;
    for (index = 0; index < length; ++index)
        if (!isdigit((unsigned char)text[index]) &&
            (text[index] < 'a' || text[index] > 'f'))
            return 0;
    return 1;
}

static int sealed_cloud_guard(char *error, size_t capacity)
{
    const char *cloud = getenv("R34_SEALED_CLOUD");
    const char *commit = getenv("R34_SOURCE_COMMIT");
    const char *contract = getenv("R34_CONTRACT_SHA256");
    if (cloud == NULL || strcmp(cloud, "1") != 0 ||
        !lowercase_hex(commit, 40) || !lowercase_hex(contract, 64)) {
        (void)snprintf(error, capacity,
                       "sealed worlds require the authorized cloud wrapper");
        return 0;
    }
    return 1;
}

static void print_development(const R34ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner34_development.v1\","
           "\"version\":\"(3,3,2)\","
           "\"sealed_worlds_opened\":false,"
           "\"training_worlds\":[1,2,3],"
           "\"training_cases\":%u,\"epochs\":%u,"
           "\"mistakes\":%u,\"final_errors\":%u,"
           "\"hash_epochs\":%u,\"hash_mistakes\":%u,"
           "\"hash_final_errors\":%u,"
           "\"semantic_weight_bytes\":%u,"
           "\"hash_weight_bytes\":%u,"
           "\"lookup_bytes\":%u,"
           "\"development_worlds\":%u,"
           "\"semantic_optimal\":%u,"
           "\"nonmonotonic_worlds\":%u,"
           "\"opened_goal_correct_gates\":%u,"
           "\"restored_gates\":%u,"
           "\"relabel_steps\":%u,\"relabel_exact\":%u,"
           "\"greedy_optimal\":%u,\"tool_only_optimal\":%u,"
           "\"hash_optimal\":%u,\"lookup_optimal\":%u,"
           "\"gate_passed\":%s}\n",
           report->training.cases, report->training.epochs,
           report->training.mistakes, report->training.final_errors,
           report->training.hash_epochs,
           report->training.hash_mistakes,
           report->training.hash_final_errors,
           report->training.semantic_active_weight_bytes,
           report->training.hash_active_weight_bytes,
           report->training.lookup_active_bytes,
           report->development_semantic.worlds,
           report->development_semantic.optimal,
           report->development_semantic.nonmonotonic_worlds,
           report->development_semantic.opened_goal_correct_gates,
           report->development_semantic.restored_gates,
           report->development_semantic.relabel_steps,
           report->development_semantic.relabel_exact,
           report->development_greedy.optimal,
           report->development_tool_only.optimal,
           report->development_hash.optimal,
           report->development_lookup.optimal,
           report->development_gate_passed ? "true" : "false");
}

static int self_test(void)
{
    R34ExperimentReport report, repeated;
    char error[256] = {0};
    R0Status status;
    if (!check(r34_oracle_initial_distance(1) == 5 &&
                   r34_oracle_initial_distance(2) == 9 &&
                   r34_oracle_initial_distance(3) == 13 &&
                   r34_oracle_initial_distance(4) == 17,
               "the BFS oracle proves the 4n+1 shortest lengths"))
        return 0;
    status = r34_run_development(&report, error, sizeof(error));
    if (!check(status == R0_OK,
               error[0] == '\0' ? "development runs" : error) ||
        !check(report.training.cases == 101 &&
                   report.training.epochs == 2 &&
                   report.training.mistakes == 19 &&
                   report.training.final_errors == 0 &&
                   report.training.hash_epochs == 256 &&
                   report.training.hash_mistakes == 17406 &&
                   report.training.hash_final_errors == 54 &&
                   report.training.semantic_active_weight_bytes == 64 &&
                   report.training.hash_active_weight_bytes == 64 &&
                   report.training.lookup_active_bytes <= 64,
               "the compact semantic and matched controls are bounded") ||
        !check(report.development_semantic.worlds == 24 &&
                   report.development_semantic.optimal == 24 &&
                   report.development_semantic.plan_steps == 408 &&
                   report.development_semantic.oracle_steps == 408 &&
                   report.development_semantic.nonmonotonic_worlds == 24 &&
                   report.development_semantic.distance_increases == 192 &&
                   report.development_semantic.opened_goal_correct_gates ==
                       96 &&
                   report.development_semantic.restored_gates == 96 &&
                   report.development_semantic.relabel_steps == 408 &&
                   report.development_semantic.relabel_exact == 408 &&
                   report.development_semantic.exact,
               "all 24 renamed 4-gate worlds are exact and non-monotonic") ||
        !check(!report.development_greedy.exact &&
                   !report.development_tool_only.exact &&
                   !report.development_hash.exact &&
                   !report.development_lookup.exact &&
                   report.development_gate_passed,
               "every matched control stays below the development gate"))
        return 0;
    status = r34_run_development(&repeated, error, sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(report.semantic_weights,
                          repeated.semantic_weights,
                          sizeof(report.semantic_weights)) == 0 &&
                   memcmp(&report.training, &repeated.training,
                          sizeof(report.training)) == 0,
               "development is byte-for-byte deterministic"))
        return 0;
    puts("Reasoner (3,3,2) development passed; 5-7 gate worlds stayed sealed");
    return 1;
}

int main(int argc, char **argv)
{
    R34ExperimentReport report;
    char error[256] = {0};
    R0Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "development") == 0) {
        status = r34_run_development(&report, error, sizeof(error));
        if (status != R0_OK) goto fail;
        print_development(&report);
        return report.development_gate_passed ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        if (!sealed_cloud_guard(error, sizeof(error))) {
            status = R0_SEAL_ERROR;
            goto fail;
        }
        status = r34_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r34_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) goto fail;
        printf("{\"schema\":\"zero.reasoner34_sealed_summary.v1\","
               "\"version\":\"(3,3,2)\",\"worlds\":%u,"
               "\"semantic_optimal\":%u,\"greedy_optimal\":%u,"
               "\"tool_only_optimal\":%u,\"hash_optimal\":%u,"
               "\"lookup_optimal\":%u,\"relabel_steps\":%u,"
               "\"relabel_exact\":%u,\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed_semantic.worlds,
               report.sealed_semantic.optimal,
               report.sealed_greedy.optimal,
               report.sealed_tool_only.optimal,
               report.sealed_hash.optimal,
               report.sealed_lookup.optimal,
               report.sealed_semantic.relabel_steps,
               report.sealed_semantic.relabel_exact,
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
    return EXIT_FAILURE;
}
