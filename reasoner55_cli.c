#include "reasoner55.h"

#include <stdio.h>
#include <string.h>

static void r55_usage(const char *program)
{
    fprintf(stderr,
        "usage:\n"
        "  %s --self-test\n"
        "  %s development RESULT.json TRACE.jsonl SOURCE_ARTIFACT.hex\n"
        "  %s execute\n",
        program, program, program);
}

static int r55_development(const char *result_path, const char *trace_path,
                           const char *artifact_path)
{
    r55_development_result result;
    r55_artifact artifact;
    FILE *trace = fopen(trace_path, "wb");
    if (!trace) {
        fprintf(stderr, "could not open development trace: %s\n", trace_path);
        return 1;
    }
    if (r55_run_development(&result, &artifact, trace) != 0) {
        fclose(trace);
        fprintf(stderr, "Reasoner 5.5 development run failed\n");
        return 1;
    }
    if (fclose(trace) != 0 ||
        r55_write_development_json(result_path, &result) != 0 ||
        r55_write_artifact_hex(artifact_path, &artifact) != 0) {
        fprintf(stderr, "could not write Reasoner 5.5 development outputs\n");
        return 1;
    }
    printf("Reasoner 5.5 development fixture: %u episodes, %u trace rows\n",
           result.episodes, result.trace_rows);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        if (r55_self_test() != 0) {
            fprintf(stderr, "Reasoner 5.5 self-test failed\n");
            return 1;
        }
        puts("Reasoner 5.5 self-test passed");
        return 0;
    }
    if (argc == 5 && strcmp(argv[1], "development") == 0)
        return r55_development(argv[2], argv[3], argv[4]);
    if (argc >= 2 && (strcmp(argv[1], "execute") == 0 ||
                      strcmp(argv[1], "sealed") == 0 ||
                      strcmp(argv[1], "run") == 0)) {
        fprintf(stderr,
            "Reasoner 5.5 sealed execution requires a frozen contract and "
            "explicit authorization\n");
        return 3;
    }
    r55_usage(argv[0]);
    return 2;
}
