#include "reasoner56.h"

#include <stdio.h>
#include <string.h>

static void r56_usage(const char *program) {
    fprintf(stderr,
        "usage: %s --self-test\n"
        "       %s develop RESULT.json TRACE.jsonl ARTIFACT.bin\n"
        "       %s execute\n",
        program, program, program);
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        int status = r56_self_test();
        if (status != 0) {
            fprintf(stderr, "Reasoner 5.6 self-test failed at check %d\n",
                    status);
            return 1;
        }
        puts("Reasoner 5.6 self-test passed");
        return 0;
    }
    if (argc == 2 && strcmp(argv[1], "execute") == 0) {
        fprintf(stderr,
            "Reasoner 5.6 sealed execution is not authorized by the "
            "development contract\n");
        return 3;
    }
    if (argc == 5 && strcmp(argv[1], "develop") == 0) {
        r56_development_result result;
        int status = r56_run_development(&result, argv[3], argv[4]);
        if (status != 0) {
            fprintf(stderr,
                "Reasoner 5.6 development fixture failed at check %d\n",
                status);
            return 4;
        }
        if (r56_write_development_result(argv[2], &result) != 0) {
            fprintf(stderr,
                "Reasoner 5.6 could not write the development result\n");
            return 5;
        }
        printf("Reasoner 5.6 development fixture: %u exact rows, "
               "%u normalized rows\n",
               result.exact_rows, result.normalized_rows);
        return 0;
    }
    r56_usage(argv[0]);
    return 2;
}
