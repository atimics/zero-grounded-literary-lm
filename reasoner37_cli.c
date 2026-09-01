#include "reasoner37.h"

#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int claim_sealed_execution(char *error, size_t capacity)
{
    const char *cloud = getenv("R37_SEALED_EXECUTION");
    const char *lock = getenv("R37_EXECUTION_LOCK");
    int descriptor;
    if (cloud == NULL || strcmp(cloud, "cloud") != 0) {
        (void)snprintf(error, capacity,
                       "sealed language traces are cloud-only");
        return 0;
    }
    if (lock == NULL || lock[0] == '\0') {
        (void)snprintf(error, capacity,
                       "R37_EXECUTION_LOCK is required");
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

static void print_report(const R37ExperimentReport *report)
{
    printf("{\"schema\":\"zero.reasoner37_language_screen.v1\","
           "\"version\":\"(3,6)\",\"language_epochs\":%u,"
           "\"language_mistakes\":%u,"
           "\"language_training_errors\":%u,"
           "\"frozen_reasoner_bytes\":%u,"
           "\"language_readout_bytes\":%u,"
           "\"episodes\":%u,\"mixed_episodes\":%u,"
           "\"trace_events\":%u,\"utterances\":%u,"
           "\"exact_utterances\":%u,"
           "\"trace_hash\":\"%016" PRIx64 "\","
           "\"frozen_reasoner_matched\":%s,"
           "\"reasoning_isolated\":%s,"
           "\"adversarial_language_failed\":%s,"
           "\"development_gate_passed\":%s,"
           "\"result_digest\":\"%016" PRIx64 "\"}\n",
           report->language_epochs, report->language_mistakes,
           report->language_training_errors,
           report->frozen_reasoner_bytes,
           report->language_readout_bytes,
           report->development.episodes,
           report->development.mixed_episodes,
           report->development.trace_events,
           report->development.utterances,
           report->development.exact_utterances,
           report->development.trace_hash,
           report->frozen_reasoner_matched ? "true" : "false",
           report->reasoning_isolated ? "true" : "false",
           report->adversarial_language_failed ? "true" : "false",
           report->development_gate_passed ? "true" : "false",
           report->result_digest);
}

int main(int argc, char **argv)
{
    R37ExperimentReport report;
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
        status = r37_run_sealed(&report, error, sizeof(error));
        if (status == R0_OK)
            status = r37_write_result(&report, argv[2], error,
                                      sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                    r0_status_name(status) : error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner37_sealed_summary.v1\","
               "\"version\":\"(3,6)\",\"episodes\":%u,"
               "\"trace_events\":%u,\"utterances\":%u,"
               "\"exact_utterances\":%u,"
               "\"reasoning_isolated\":%s,"
               "\"gate_passed\":%s,"
               "\"result_digest\":\"%016" PRIx64 "\","
               "\"result\":\"%s\"}\n",
               report.sealed.episodes, report.sealed.trace_events,
               report.sealed.utterances,
               report.sealed.exact_utterances,
               report.reasoning_isolated ? "true" : "false",
               report.sealed_gate_passed ? "true" : "false",
               report.result_digest, argv[2]);
        return EXIT_SUCCESS;
    }
    status = r37_run_development(&report, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s\n", error[0] == '\0' ?
                r0_status_name(status) : error);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[1], "--self-test") == 0) {
        puts("Reasoner (3,6) frozen-trace language screen passed; the "
             "sealed language gate remains cloud-only");
        return EXIT_SUCCESS;
    }
    print_report(&report);
    return EXIT_SUCCESS;
}
