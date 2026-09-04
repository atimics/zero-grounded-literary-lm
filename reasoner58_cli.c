#include "reasoner58.h"

#include <stdio.h>
#include <string.h>

static void r58_usage(const char *program)
{
    fprintf(stderr,
        "usage:\n"
        "  %s --self-test\n"
        "  %s development CORE.json SOURCE_ARTIFACT.hex\n"
        "  %s execute\n",
        program, program, program);
}

static int r58_development(const char *result_path, const char *artifact_path)
{
    r58_development_summary summary;
    r58_artifact artifact;
    if (r58_run_development(&summary, &artifact) != 0 ||
        r58_write_development_json(result_path, &summary) != 0 ||
        r58_write_artifact_hex(artifact_path, &artifact) != 0) {
        fprintf(stderr, "Reasoner 5.8 development fixture failed\n");
        return 1;
    }
    printf("Reasoner 5.8 core fixture: %u syntax programs, %u semantic classes\n",
           summary.syntax_programs, summary.semantic_classes);
    return 0;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        if (r58_self_test() != 0) {
            fprintf(stderr, "Reasoner 5.8 self-test failed\n");
            return 1;
        }
        puts("Reasoner 5.8 self-test passed");
        return 0;
    }
    if (argc == 4 && strcmp(argv[1], "development") == 0)
        return r58_development(argv[2], argv[3]);
    if (argc >= 2 && (strcmp(argv[1], "execute") == 0 ||
                      strcmp(argv[1], "sealed") == 0 ||
                      strcmp(argv[1], "run") == 0)) {
        fprintf(stderr,
            "Reasoner 5.8 scientific execution requires a frozen contract "
            "and explicit authorization\n");
        return 3;
    }
    r58_usage(argv[0]);
    return 2;
}
