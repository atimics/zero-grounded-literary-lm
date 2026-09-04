#include "reasoner57.h"

#include <stdio.h>
#include <string.h>

static const char *default_r56_artifact =
    "benchmarks/reasoner56-passive-noise-development-v1/development/artifact.bin";

static void usage(const char *program) {
    fprintf(stderr,
        "usage: %s --self-test [r56-artifact]\n"
        "       %s develop RESULT TRACE POLICY [r56-artifact]\n"
        "       %s execute\n",
        program, program, program);
}

int main(int argc, char **argv) {
    if (argc >= 2 && strcmp(argv[1], "--self-test") == 0) {
        const char *artifact = argc == 3 ? argv[2] : default_r56_artifact;
        int status;
        if (argc > 3) {
            usage(argv[0]);
            return 2;
        }
        status = r57_self_test(artifact);
        if (status != 0)
            fprintf(stderr, "Reasoner 5.7 self-test failed at check %d\n",
                    status);
        return status == 0 ? 0 : 1;
    }
    if (argc >= 2 && strcmp(argv[1], "develop") == 0) {
        if (argc != 5 && argc != 6) {
            usage(argv[0]);
            return 2;
        }
        fprintf(stderr,
            "Reasoner 5.7 development is gated on corrected Reasoner 5.6 "
            "channel-readiness evidence.\n");
        return 3;
    }
    if (argc == 2 && strcmp(argv[1], "execute") == 0) {
        fprintf(stderr,
            "Reasoner 5.7 sealed execution is closed; a reviewed contract, "
            "fresh commitments, and explicit approval are required.\n");
        return 3;
    }
    usage(argv[0]);
    return 2;
}
