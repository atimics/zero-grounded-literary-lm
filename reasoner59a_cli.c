#include "reasoner59a.h"

#include <stdio.h>
#include <string.h>

static void r59a_usage(const char *program)
{
    fprintf(stderr,
        "usage:\n"
        "  %s --self-test\n"
        "  %s development CORE.json\n"
        "  %s execute\n",
        program, program, program);
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        if (r59a_self_test() != 0) {
            fputs("Reasoner 5.9a self-test failed\n", stderr);
            return 1;
        }
        puts("Reasoner 5.9a self-test passed");
        return 0;
    }
    if (argc == 3 && strcmp(argv[1], "development") == 0) {
        r59a_development_summary summary;
        if (r59a_run_development(&summary) != 0 ||
            r59a_write_development_json(argv[2], &summary) != 0) {
            fputs("Reasoner 5.9a development core failed\n", stderr);
            return 1;
        }
        printf("Reasoner 5.9a core fixture: %u exact symbolic scenes\n",
               summary.scene_count);
        return 0;
    }
    if (argc >= 2 && (strcmp(argv[1], "execute") == 0 ||
                      strcmp(argv[1], "sealed") == 0 ||
                      strcmp(argv[1], "run") == 0)) {
        fputs("Reasoner 5.9a sealed execution requires a frozen contract "
              "and explicit authorization\n", stderr);
        return 3;
    }
    r59a_usage(argv[0]);
    return 2;
}
