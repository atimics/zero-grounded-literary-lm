#include "reasoner333.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define R333_APPROVAL_ID "reasoner333-composition-seal-2026-08-30-v1"

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

static void print_development(const R333ExperimentReport *report)
{
    printf(
        "{\"schema\":\"zero.reasoner333_development.v1\","
        "\"version\":\"(3,3,3)\",\"sealed_family_opened\":false,"
        "\"training_programs\":%u,\"training_cases\":%u,"
        "\"epochs\":%u,\"mistakes\":%u,\"final_errors\":%u,"
        "\"lookup_training_errors\":%u,\"semantic_bytes\":%u,"
        "\"lookup_bytes\":%u,\"development_programs\":%u,"
        "\"semantic_minimal\":%u,\"relabel_cases\":%u,"
        "\"relabel_exact\":%u,\"lookup_minimal\":%u,"
        "\"bridge_masked_minimal\":%u,\"module_only_minimal\":%u,"
        "\"tool_only_minimal\":%u,\"gate_passed\":%s}\n",
        r333_training_program_count(), report->training.cases,
        report->training.epochs, report->training.mistakes,
        report->training.final_errors, report->training.lookup_errors,
        report->semantic_bytes, report->lookup_bytes,
        report->development.programs, report->development.minimal,
        report->development.relabel_cases,
        report->development.relabel_exact,
        report->development_lookup.minimal,
        report->development_bridge_masked.minimal,
        report->development_module_only.minimal,
        report->development_tool_only.minimal,
        report->development_gate_passed ? "true" : "false");
}

static int self_test(void)
{
    R333ExperimentReport report;
    char error[256] = {0};
    R333Status status;
    if (!check(r333_training_program_count() == 3 &&
                   r333_development_program_count() == 15 &&
                   r333_sealed_program_count() == 63,
               "the frozen program census is exact"))
        return 0;
    if (!check(sizeof(R333Model) == 64 && sizeof(R333Lookup) == 64,
               "the semantic and lookup arms are capacity matched"))
        return 0;
    status = r333_run_development(&report, error, sizeof(error));
    if (!check(status == R333_OK,
               error[0] == '\0' ? "development run succeeds" : error) ||
        !check(report.training.final_errors == 0 &&
                   report.training.lookup_errors == 0 &&
                   report.training.cases == 6 &&
                   report.training.epochs == 2 &&
                   report.training.mistakes == 1,
               "both compact arms fit isolated-module training") ||
        !check(report.development.programs == 15 &&
                   report.development.minimal == 15 &&
                   report.development.relabel_cases == 60 &&
                   report.development.relabel_exact == 60 &&
                   report.development.exact,
               "small compositions and all relabelings are exact") ||
        !check(report.development_lookup.minimal == 0 &&
                   report.development_bridge_masked.minimal == 0 &&
                   report.development_module_only.minimal == 0 &&
                   report.development_tool_only.minimal == 0,
               "the development controls stay separated") ||
        !check(report.development_gate_passed,
               "the development gate passes"))
        return 0;
    puts("Reasoner (3,3,3) development self-test passed; the sealed "
         "three-by-three family stayed closed");
    return 1;
}

int main(int argc, char **argv)
{
    R333ExperimentReport report;
    char error[256] = {0};
    R333Status status;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "development") == 0) {
        status = r333_run_development(&report, error, sizeof(error));
        if (status != R333_OK) goto fail;
        print_development(&report);
        return report.development_gate_passed ? EXIT_SUCCESS
                                              : EXIT_FAILURE;
    }
    if (argc == 3 && strcmp(argv[1], "sealed-run") == 0) {
        const char *approval = getenv("R333_SEAL_APPROVAL_ID");
        if (approval == NULL || strcmp(approval, R333_APPROVAL_ID) != 0) {
            fprintf(stderr,
                    "error: sealed-run requires the frozen approval id\n");
            return EXIT_FAILURE;
        }
        status = r333_run_sealed(&report, error, sizeof(error));
        if (status == R333_OK)
            status = r333_write_result(&report, argv[2], error,
                                       sizeof(error));
        if (status != R333_OK) goto fail;
        printf(
            "{\"schema\":\"zero.reasoner333_sealed_summary.v1\","
            "\"version\":\"(3,3,3)\",\"programs\":%u,"
            "\"semantic_minimal\":%u,\"lookup_minimal\":%u,"
            "\"bridge_masked_minimal\":%u,"
            "\"module_only_minimal\":%u,\"tool_only_minimal\":%u,"
            "\"relabel_cases\":%u,\"relabel_exact\":%u,"
            "\"gate_passed\":%s,\"result_digest\":\"%016" PRIx64
            "\",\"result\":\"%s\"}\n",
            report.semantic.programs, report.semantic.minimal,
            report.lookup.minimal, report.bridge_masked.minimal,
            report.module_only.minimal, report.tool_only.minimal,
            report.semantic.relabel_cases, report.semantic.relabel_exact,
            report.sealed_gate_passed ? "true" : "false",
            report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    usage(argv[0]);
    return EXIT_FAILURE;
fail:
    fprintf(stderr, "error: %s: %s\n", r333_status_name(status), error);
    return EXIT_FAILURE;
}
