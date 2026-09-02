#define _POSIX_C_SOURCE 200809L

#include "reasoner52.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define R52_APPROVAL "reasoner52-nonlinear-depth-2026-09-02-v1"

static int r52_claim_lock(const char *path) {
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0444);
    if (fd < 0) return 1;
    const char payload[] = "reasoner52-nonlinear-depth-transfer-v1 consumed\n";
    int ok = write(fd, payload, sizeof(payload) - 1u) ==
             (ssize_t)(sizeof(payload) - 1u);
    if (close(fd) != 0) ok = 0;
    return ok ? 0 : 1;
}

static int r52_write_execution(const char *path, const char *result_path,
                               const char *artifact_path, double elapsed_ms,
                               int pass) {
    FILE *file = fopen(path, "wb");
    if (!file) return 1;
    time_t now = time(NULL);
    struct tm utc;
    gmtime_r(&now, &utc);
    char stamp[32];
    strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
    int ok = fprintf(file,
        "{\n"
        "  \"schema\": \"reasoner52-execution-v1\",\n"
        "  \"experiment\": \"reasoner52-nonlinear-depth-transfer-v1\",\n"
        "  \"approval_id\": \"%s\",\n"
        "  \"executed_at_utc\": \"%s\",\n"
        "  \"environment\": \"local\",\n"
        "  \"execution_count\": 1,\n"
        "  \"retry_count\": 0,\n"
        "  \"post_open_tuning\": false,\n"
        "  \"elapsed_ms\": %.3f,\n"
        "  \"cost_usd\": 0.0,\n"
        "  \"result_path\": \"%s\",\n"
        "  \"artifact_path\": \"%s\",\n"
        "  \"decision\": \"%s\"\n"
        "}\n", R52_APPROVAL, stamp, elapsed_ms, result_path, artifact_path,
        pass ? "pass" : "no-go") > 0;
    if (fclose(file) != 0) ok = 0;
    return ok ? 0 : 1;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        if (r52_self_test() != 0) {
            fprintf(stderr, "Reasoner 5.2 self-test failed\n");
            return 1;
        }
        puts("Reasoner 5.2 self-test passed");
        return 0;
    }
    if (argc != 5 || strcmp(argv[1], "execute") != 0) {
        fprintf(stderr,
            "usage: %s --self-test\n"
            "       %s execute RESULT.json EXECUTION.json ARTIFACT.bin\n",
            argv[0], argv[0]);
        return 2;
    }
    const char *approval = getenv("REASONER52_APPROVAL");
    const char *lock = getenv("REASONER52_LOCK");
    if (!approval || strcmp(approval, R52_APPROVAL) != 0 || !lock || !*lock) {
        fprintf(stderr, "Reasoner 5.2 execution is not authorized\n");
        return 3;
    }
    if (r52_claim_lock(lock) != 0) {
        fprintf(stderr, "Reasoner 5.2 execution lock unavailable: %s\n",
                strerror(errno));
        return 4;
    }
    struct timespec start;
    struct timespec end;
    clock_gettime(CLOCK_MONOTONIC, &start);
    r52_result result;
    r52_artifact artifact;
    if (r52_execute(&result, &artifact) != 0) return 5;
    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed_ms = (double)(end.tv_sec - start.tv_sec) * 1000.0 +
        (double)(end.tv_nsec - start.tv_nsec) / 1000000.0;
    if (r52_write_result_json(argv[2], &result) != 0 ||
        r52_write_artifact(argv[4], &artifact) != 0 ||
        r52_write_execution(argv[3], argv[2], argv[4], elapsed_ms,
                            (int)result.gate_pass) != 0) {
        fprintf(stderr, "Reasoner 5.2 could not publish execution files\n");
        return 6;
    }
    printf("Reasoner 5.2 %s: %u expansions vs %u target-only\n",
           result.gate_pass ? "pass" : "no-go", result.full_expansions,
           result.target_only_expansions);
    return 0;
}
