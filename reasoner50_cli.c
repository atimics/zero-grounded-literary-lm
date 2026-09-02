#include "reasoner50.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define R50_APPROVAL_ID "reasoner50-residual-transfer-2026-09-02-v1"

static int claim_execution(char *error, size_t capacity)
{
    const char *mode = getenv("R50_SCIENTIFIC_EXECUTION");
    const char *approval = getenv("R50_APPROVAL_ID");
    const char *lock = getenv("R50_EXECUTION_LOCK");
    int descriptor;
    if (mode == NULL || strcmp(mode, "local") != 0) {
        (void)snprintf(error, capacity,
                       "scientific execution requires the local marker");
        return 0;
    }
    if (approval == NULL || strcmp(approval, R50_APPROVAL_ID) != 0) {
        (void)snprintf(error, capacity,
                       "scientific execution requires the frozen approval id");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R50_EXECUTION_LOCK is required");
        return 0;
    }
    descriptor = open(lock, O_WRONLY | O_CREAT | O_EXCL, 0444);
    if (descriptor < 0) {
        (void)snprintf(error, capacity,
                       "scientific execution lock already exists");
        return 0;
    }
    if (dprintf(descriptor, "%s\n", R50_APPROVAL_ID) < 0 ||
        close(descriptor) != 0) {
        (void)snprintf(error, capacity,
                       "cannot write scientific execution lock");
        return 0;
    }
    return 1;
}

static int write_execution(const char *path, const char *result_path,
                           const char *artifact_path,
                           const R50ExperimentReport *report,
                           time_t started_at, clock_t started_clock,
                           char *error, size_t error_capacity)
{
    FILE *file = fopen(path, "wb");
    double milliseconds =
        1000.0 * (double)(clock() - started_clock) / (double)CLOCKS_PER_SEC;
    if (file == NULL) {
        (void)snprintf(error, error_capacity,
                       "cannot create execution record");
        return 0;
    }
    if (fprintf(file,
        "{\n"
        "  \"schema\": \"zero.reasoner50_execution.v1\",\n"
        "  \"approval_id\": \"%s\",\n"
        "  \"mode\": \"local-deterministic\",\n"
        "  \"started_at_epoch\": %lld,\n"
        "  \"elapsed_milliseconds\": %.3f,\n"
        "  \"scientific_execution\": 1,\n"
        "  \"scientific_retries\": 0,\n"
        "  \"post_open_tuning\": false,\n"
        "  \"decision\": \"%s\",\n"
        "  \"result_path\": \"%s\",\n"
        "  \"artifact_path\": \"%s\",\n"
        "  \"source_artifact_sha256\": \"%s\",\n"
        "  \"result_digest\": \"%016" PRIx64 "\"\n"
        "}\n",
        R50_APPROVAL_ID, (long long)started_at, milliseconds,
        report->gate_passed ? "pass" : "no-go", result_path,
        artifact_path, report->source_artifact_sha256,
        report->result_digest) < 0 || fclose(file) != 0) {
        (void)snprintf(error, error_capacity,
                       "cannot write execution record");
        return 0;
    }
    return 1;
}

static int run_preflight(void)
{
    char error[512] = {0};
    R0Status status = r50_run_preflight(error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "Reasoner 5.0 preflight failed: %s\n",
                error[0] == '\0' ? r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    printf("{\"schema\":\"zero.reasoner50_preflight.v1\","
           "\"version\":\"5.0\",\"ready\":true,"
           "\"scientific_target_opened\":false}\n");
    return EXIT_SUCCESS;
}

static int run_experiment(const char *result_path,
                          const char *execution_path,
                          const char *artifact_path)
{
    R50ExperimentReport report;
    int32_t artifact[R50_FEATURES];
    char error[512] = {0};
    R0Status status;
    time_t started_at;
    clock_t started_clock;
    if (!claim_execution(error, sizeof(error))) {
        fprintf(stderr, "error: %s\n", error);
        return EXIT_FAILURE;
    }
    started_at = time(NULL);
    started_clock = clock();
    status = r50_run_experiment(&report, artifact, error, sizeof(error));
    if (status == R0_OK)
        status = r50_write_artifact(artifact, artifact_path,
                                    error, sizeof(error));
    if (status == R0_OK)
        status = r50_write_result(&report, result_path,
                                  error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n",
                error[0] == '\0' ? r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (!write_execution(execution_path, result_path, artifact_path,
                         &report, started_at, started_clock,
                         error, sizeof(error))) {
        fprintf(stderr, "error: %s\n", error);
        return EXIT_FAILURE;
    }
    printf("{\"schema\":\"zero.reasoner50_summary.v1\","
           "\"decision\":\"%s\",\"episodes\":%u,"
           "\"full_expansions\":%" PRIu64 ","
           "\"target_only_expansions\":%" PRIu64 ","
           "\"source_only_expansions\":%" PRIu64 ","
           "\"shuffled_source_expansions\":%" PRIu64 ","
           "\"runtime_mismatch_expansions\":%" PRIu64 ","
           "\"result_digest\":\"%016" PRIx64 "\"}\n",
           report.gate_passed ? "pass" : "no-go",
           report.full.episodes, report.full.expansions,
           report.target_only.expansions, report.source_only.expansions,
           report.shuffled_source.expansions,
           report.runtime_mismatch.expansions, report.result_digest);
    return EXIT_SUCCESS;
}

int main(int argc, char **argv)
{
    if (argc == 2 && (strcmp(argv[1], "--self-test") == 0 ||
                      strcmp(argv[1], "preflight") == 0))
        return run_preflight();
    if (argc == 5 && strcmp(argv[1], "execute") == 0)
        return run_experiment(argv[2], argv[3], argv[4]);
    fprintf(stderr,
        "usage: %s --self-test | preflight | "
        "execute RESULT.json EXECUTION.json ARTIFACT.bin\n",
        argv[0]);
    return 2;
}
