#include "reasoner0.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CELL(matrix, row, column) \
    ((matrix)->entries[(size_t)(row) * R0_MAX_RANK + (column)])

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s train POLICY.r0p\n"
            "  %s verify POLICY.r0p RANK MATRIX_ENTRIES... [--trace]\n"
            "  %s enumerate POLICY.r0p MAX_RANK\n"
            "  %s dataset POLICY.r0p MAX_RANK OUTPUT.jsonl\n"
            "  %s demo\n"
            "  %s --self-test\n"
            "\n"
            "Matrix entries are row-major signed integers. Enumeration is "
            "bounded to rank 8.\n",
            program, program, program, program, program, program);
}

static int parse_u8(const char *text, uint8_t minimum, uint8_t maximum,
                    uint8_t *value)
{
    char *end;
    unsigned long parsed;
    errno = 0;
    parsed = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || parsed < minimum ||
        parsed > maximum)
        return 0;
    *value = (uint8_t)parsed;
    return 1;
}

static int parse_entry(const char *text, int8_t *value)
{
    char *end;
    long parsed;
    errno = 0;
    parsed = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || parsed < -127 ||
        parsed > 127)
        return 0;
    *value = (int8_t)parsed;
    return 1;
}

static const char *phase_name(R0Phase phase)
{
    switch (phase) {
    case R0_PHASE_PROPOSED: return "proposed";
    case R0_PHASE_VERIFIED: return "verified";
    case R0_PHASE_COUNTEREXAMPLE: return "counterexample";
    case R0_PHASE_SEALED: return "sealed";
    case R0_PHASE_COMPLETE: return "complete";
    }
    return "invalid";
}

static void print_matrix(const R0CartanMatrix *matrix)
{
    int row, column;
    putchar('[');
    for (row = 0; row < matrix->rank; ++row) {
        if (row != 0) putchar(',');
        putchar('[');
        for (column = 0; column < matrix->rank; ++column) {
            if (column != 0) putchar(',');
            printf("%d", CELL(matrix, row, column));
        }
        putchar(']');
    }
    putchar(']');
}

static void print_trace(const R0RunResult *result)
{
    size_t index;
    for (index = 0; index < result->event_count; ++index) {
        const R0TraceEvent *event = &result->events[index];
        if (event->kind == R0_EVENT_MODEL_ACTION) {
            printf("{\"event\":\"model_action\",\"cycle\":%u,"
                   "\"phase\":\"%s\",\"action\":\"%s\","
                   "\"tool\":\"%s\"}\n",
                   event->cycle, phase_name(event->phase),
                   r0_action_name(event->action), r0_tool_name(event->tool));
        } else if (event->kind == R0_EVENT_TOOL_RESULT) {
            if (event->tool == R0_TOOL_LANGUAGE_RENDER) {
                printf("{\"event\":\"tool_result\",\"cycle\":%u,"
                       "\"phase\":\"complete\","
                       "\"tool\":\"language.render\","
                       "\"seal\":\"%s\",\"text\":\"%s\"}\n",
                       event->cycle, event->seal, result->language);
            } else {
                printf("{\"event\":\"tool_result\",\"cycle\":%u,"
                       "\"phase\":\"%s\",\"tool\":\"cartan.verify\","
                       "\"accepted\":%s,\"failure\":\"%s\","
                       "\"determinant\":%lld}\n",
                       event->cycle, phase_name(event->phase),
                       event->accepted ? "true" : "false",
                       r0_failure_name(event->failure),
                       (long long)event->determinant);
            }
        } else if (event->kind == R0_EVENT_ANSWER_SEALED) {
            printf("{\"event\":\"answer_sealed\",\"cycle\":%u,"
                   "\"phase\":\"sealed\",\"seal\":\"%s\"}\n",
                   event->cycle, event->seal);
        } else {
            printf("{\"event\":\"candidate_rejected\",\"cycle\":%u,"
                   "\"failure\":\"%s\",\"determinant\":%lld}\n",
                   event->cycle, r0_failure_name(event->failure),
                   (long long)event->determinant);
        }
    }
}

static int run_candidate(const R0Policy *policy,
                         const R0CartanMatrix *matrix, int trace)
{
    R0RunResult result;
    char error[256] = {0};
    R0Status status = r0_run(policy, matrix, &result, error, sizeof(error));
    if (status != R0_OK) {
        fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
        return EXIT_FAILURE;
    }
    if (trace) print_trace(&result);
    else if (result.accepted) puts(result.language);
    else
        printf("rejected: %s (determinant %lld)\n",
               r0_failure_name(result.observation.failure),
               (long long)result.observation.determinant);
    return result.accepted ? EXIT_SUCCESS : 2;
}

static void print_enumeration(const R0EnumerationReport *report)
{
    uint8_t rank;
    printf("{\"schema\":\"zero.reasoner0_cartan_enumeration.v1\","
           "\"maximum_rank\":%u,\"proposed\":%u,\"accepted\":%u,"
           "\"rejected\":%u,\"affine_negatives\":%u,"
           "\"counterexample_weight\":%u,"
           "\"exact_precision_recall\":%s}\n",
           (unsigned)report->maximum_rank, report->proposed, report->accepted,
           report->rejected, report->affine_negatives,
           report->counterexample_weight,
           report->exact_precision_recall ? "true" : "false");
    for (rank = 1; rank <= report->maximum_rank; ++rank)
        printf("{\"rank\":%u,\"count\":%u,\"types\":\"%s\"}\n",
               (unsigned)rank, (unsigned)report->count_by_rank[rank],
               report->types_by_rank[rank]);
}

static void diagonal(R0CartanMatrix *matrix, uint8_t rank)
{
    int index;
    memset(matrix, 0, sizeof(*matrix));
    matrix->rank = rank;
    for (index = 0; index < rank; ++index) CELL(matrix, index, index) = 2;
}

static void edge(R0CartanMatrix *matrix, int left, int right,
                 int8_t forward, int8_t backward)
{
    CELL(matrix, left, right) = forward;
    CELL(matrix, right, left) = backward;
}

static void make_e8(R0CartanMatrix *matrix)
{
    int index;
    diagonal(matrix, 8);
    for (index = 0; index < 6; ++index) edge(matrix, index, index + 1, -1, -1);
    edge(matrix, 2, 7, -1, -1);
}

static int check(int condition, const char *message)
{
    if (!condition) {
        fprintf(stderr, "self-test failed: %s\n", message);
        return 0;
    }
    return 1;
}

static int self_test(void)
{
    R0Policy policy, loaded;
    R0TrainingReport training;
    R0CartanMatrix a2, disconnected, affine_a1, affine_a2, affine_d4;
    R0CartanMatrix product_five, g2, b3, b4, c4, f4, e8, affine_e8;
    R0CartanMatrix canonical, relabeled, relabeled_canonical;
    R0RunResult result;
    R0EnumerationReport enumeration;
    R0SealedAnswer tampered;
    char rendered[R0_LANGUAGE_CAPACITY];
    char error[256] = {0};
    char policy_path[128];
    char dataset_path[128];
    char dataset_line[4096];
    R0Status status;
    int cumulative_rank_two;
    int affine_e8_found = 0;
    int dataset_lines = 0;
    int dataset_has_affine_weight = 0;
    int dataset_has_text = 0;
    FILE *dataset_file;

    r0_policy_init(&policy);
    status = r0_policy_train(&policy, &training);
    if (!check(status == R0_OK && training.examples == 4 &&
                   training.final_errors == 0,
               "structured control policy trains"))
        return 0;

    diagonal(&a2, 2);
    edge(&a2, 0, 1, -1, -1);
    status = r0_run(&policy, &a2, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted,
               "A2 is accepted") ||
        !check(result.observation.determinant == 3,
               "A2 determinant is exact") ||
        !check(strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                      "A2") == 0,
               "A2 is classified") ||
        !check(result.event_count == 6 &&
                   result.events[0].action ==
                       R0_ACTION_CALL_CARTAN_VERIFY &&
                   result.events[2].action == R0_ACTION_COMMIT &&
                   result.events[4].action == R0_ACTION_RENDER,
               "accepted trace is verify, commit, render"))
        return 0;

    diagonal(&disconnected, 3);
    status = r0_run(&policy, &disconnected, &result, error, sizeof(error));
    if (!check(status == R0_OK && !result.accepted &&
                   result.observation.failure == R0_CARTAN_DISCONNECTED,
               "A1 farm is rejected as reducible") ||
        !check(result.event_count == 4 &&
                   result.events[2].action == R0_ACTION_REJECT,
               "rejected trace returns a local counterexample"))
        return 0;

    diagonal(&affine_a2, 3);
    edge(&affine_a2, 0, 1, -1, -1);
    edge(&affine_a2, 1, 2, -1, -1);
    edge(&affine_a2, 2, 0, -1, -1);
    status = r0_run(&policy, &affine_a2, &result, error, sizeof(error));
    if (!check(status == R0_OK && !result.accepted &&
                   result.observation.failure == R0_CARTAN_AFFINE_BOUNDARY &&
                   result.observation.determinant == 0,
               "affine A2 is an exact determinant-zero negative"))
        return 0;

    diagonal(&affine_a1, 2);
    edge(&affine_a1, 0, 1, -2, -2);
    status = r0_run(&policy, &affine_a1, &result, error, sizeof(error));
    if (!check(status == R0_OK && !result.accepted &&
                   result.observation.failure == R0_CARTAN_AFFINE_BOUNDARY &&
                   result.observation.determinant == 0,
               "affine A1 reaches the exact product-four boundary"))
        return 0;

    diagonal(&affine_d4, 5);
    edge(&affine_d4, 0, 1, -1, -1);
    edge(&affine_d4, 0, 2, -1, -1);
    edge(&affine_d4, 0, 3, -1, -1);
    edge(&affine_d4, 0, 4, -1, -1);
    status = r0_run(&policy, &affine_d4, &result, error, sizeof(error));
    if (!check(status == R0_OK && !result.accepted &&
                   result.observation.failure == R0_CARTAN_AFFINE_BOUNDARY &&
                   result.observation.determinant == 0,
               "affine D4 valence-four star is determinant zero"))
        return 0;

    diagonal(&product_five, 2);
    edge(&product_five, 0, 1, -1, -5);
    status = r0_run(&policy, &product_five, &result, error, sizeof(error));
    if (!check(status == R0_OK && !result.accepted &&
                   result.observation.failure ==
                       R0_CARTAN_BAD_BOND_PRODUCT &&
                   result.observation.checked_principal_minors == 0,
               "product five fails before positive-definiteness checks"))
        return 0;

    diagonal(&g2, 2);
    edge(&g2, 0, 1, -3, -1);
    status = r0_run(&policy, &g2, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   result.observation.determinant == 1 &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "G2") == 0,
               "G2 exercises and accepts bond product three"))
        return 0;

    diagonal(&b3, 3);
    edge(&b3, 0, 1, -1, -1);
    edge(&b3, 1, 2, -2, -1);
    status = r0_run(&policy, &b3, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "B3") == 0,
               "B3 is accepted and oriented"))
        return 0;

    diagonal(&f4, 4);
    edge(&f4, 0, 1, -1, -1);
    edge(&f4, 1, 2, -2, -1);
    edge(&f4, 2, 3, -1, -1);
    status = r0_run(&policy, &f4, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   result.observation.determinant == 1 &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "F4") == 0,
               "F4 exercises and accepts an internal double bond"))
        return 0;

    diagonal(&b4, 4);
    edge(&b4, 0, 1, -1, -1);
    edge(&b4, 1, 2, -1, -1);
    edge(&b4, 2, 3, -2, -1);
    diagonal(&c4, 4);
    edge(&c4, 0, 1, -1, -1);
    edge(&c4, 1, 2, -1, -1);
    edge(&c4, 2, 3, -1, -2);
    status = r0_cartan_canonicalize(&b4, &canonical, error, sizeof(error));
    if (status == R0_OK)
        status = r0_cartan_canonicalize(&c4, &relabeled_canonical, error,
                                        sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(&canonical, &relabeled_canonical,
                          sizeof(canonical)) != 0,
               "canonicalization preserves the B4-C4 arrow direction"))
        return 0;
    status = r0_run(&policy, &b4, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "B4") == 0,
               "B4 is accepted as B4"))
        return 0;
    status = r0_run(&policy, &c4, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "C4") == 0,
               "C4 is accepted separately from B4"))
        return 0;
    relabeled = b3;
    CELL(&relabeled, 0, 0) = CELL(&b3, 2, 2);
    CELL(&relabeled, 0, 1) = CELL(&b3, 2, 1);
    CELL(&relabeled, 0, 2) = CELL(&b3, 2, 0);
    CELL(&relabeled, 1, 0) = CELL(&b3, 1, 2);
    CELL(&relabeled, 1, 1) = CELL(&b3, 1, 1);
    CELL(&relabeled, 1, 2) = CELL(&b3, 1, 0);
    CELL(&relabeled, 2, 0) = CELL(&b3, 0, 2);
    CELL(&relabeled, 2, 1) = CELL(&b3, 0, 1);
    CELL(&relabeled, 2, 2) = CELL(&b3, 0, 0);
    status = r0_cartan_canonicalize(&b3, &canonical, error, sizeof(error));
    if (status == R0_OK)
        status = r0_cartan_canonicalize(&relabeled, &relabeled_canonical,
                                        error, sizeof(error));
    if (!check(status == R0_OK &&
                   memcmp(&canonical, &relabeled_canonical,
                          sizeof(canonical)) == 0,
               "simultaneous row-column relabeling canonicalizes once"))
        return 0;

    make_e8(&e8);
    status = r0_run(&policy, &e8, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted &&
                   strcmp(r0_cartan_type(&result.sealed_answer.answer.matrix),
                          "E8") == 0,
               "E8 is accepted at the interesting rank"))
        return 0;
    {
        int attachment, row, column;
        for (attachment = 0; attachment < 8 && !affine_e8_found;
             ++attachment) {
            diagonal(&affine_e8, 9);
            for (row = 0; row < 8; ++row)
                for (column = 0; column < 8; ++column)
                    CELL(&affine_e8, row, column) = CELL(&e8, row, column);
            edge(&affine_e8, attachment, 8, -1, -1);
            status = r0_run(&policy, &affine_e8, &result, error,
                            sizeof(error));
            affine_e8_found = status == R0_OK && !result.accepted &&
                              result.observation.failure ==
                                  R0_CARTAN_AFFINE_BOUNDARY &&
                              result.observation.determinant == 0;
        }
    }
    if (!check(affine_e8_found,
               "affine E8 is separated by one node and determinant zero"))
        return 0;

    status = r0_run(&policy, &e8, &result, error, sizeof(error));
    if (!check(status == R0_OK && result.accepted,
               "E8 remains accepted after the affine boundary test"))
        return 0;
    tampered = result.sealed_answer;
    tampered.answer.matrix.entries[0] = 3;
    status = r0_render_language(&tampered, rendered, sizeof(rendered), error,
                                sizeof(error));
    if (!check(status != R0_OK, "semantic tampering is rejected")) return 0;
    tampered = result.sealed_answer;
    tampered.seal[0] = tampered.seal[0] == '0' ? '1' : '0';
    status = r0_render_language(&tampered, rendered, sizeof(rendered), error,
                                sizeof(error));
    if (!check(status == R0_SEAL_ERROR, "seal tampering is rejected")) return 0;

    status = r0_enumerate(&policy, 8, &enumeration, error, sizeof(error));
    cumulative_rank_two = enumeration.count_by_rank[1] +
                          enumeration.count_by_rank[2];
    if (!check(status == R0_OK && enumeration.exact_precision_recall,
               "rank-one through rank-eight enumeration is exact") ||
        !check(enumeration.accepted == 31,
               "bounded classification contains 31 connected types") ||
        !check(cumulative_rank_two == 4,
               "rank-two curriculum has A1, A2, B2/C2, G2") ||
        !check(enumeration.count_by_rank[3] == 3 &&
                   strcmp(enumeration.types_by_rank[3], "A3,B3,C3") == 0,
               "rank three excludes reducible rank-two-plus-A1 cases") ||
        !check(strcmp(enumeration.types_by_rank[8],
                      "A8,B8,C8,D8,E8") == 0,
               "rank eight contains E8 and four families") ||
        !check(enumeration.affine_negatives > 0 &&
                   enumeration.counterexample_weight >=
                       enumeration.affine_negatives * 8U,
               "affine near-misses receive extra training weight"))
        return 0;

    (void)snprintf(dataset_path, sizeof(dataset_path),
                   "/tmp/reasoner0-cartan-self-test-%ld.jsonl",
                   (long)getpid());
    (void)remove(dataset_path);
    status = r0_enumerate_dataset(&policy, 8, dataset_path, &enumeration,
                                  error, sizeof(error));
    dataset_file = status == R0_OK ? fopen(dataset_path, "rb") : NULL;
    while (dataset_file != NULL &&
           fgets(dataset_line, sizeof(dataset_line), dataset_file) != NULL) {
        ++dataset_lines;
        if (strstr(dataset_line,
                   "\"failure\":\"affine_determinant_zero\"") != NULL &&
            strstr(dataset_line, "\"weight\":8") != NULL)
            dataset_has_affine_weight = 1;
        if (strstr(dataset_line, "\"text\"") != NULL)
            dataset_has_text = 1;
    }
    if (dataset_file != NULL) {
        if (ferror(dataset_file)) status = R0_IO_ERROR;
        (void)fclose(dataset_file);
    }
    (void)remove(dataset_path);
    if (!check(status == R0_OK && dataset_lines ==
                                         (int)(enumeration.accepted +
                                               enumeration.rejected),
               "dataset contains every in-scope positive and exact negative") ||
        !check(dataset_has_affine_weight,
               "dataset contains weighted affine counterexamples") ||
        !check(!dataset_has_text,
               "dataset has typed renderer calls but no language targets"))
        return 0;

    (void)snprintf(policy_path, sizeof(policy_path),
                   "/tmp/reasoner0-cartan-self-test-%ld.r0p",
                   (long)getpid());
    (void)remove(policy_path);
    status = r0_policy_save(&policy, policy_path, error, sizeof(error));
    if (status == R0_OK)
        status = r0_policy_load(&loaded, policy_path, error, sizeof(error));
    (void)remove(policy_path);
    if (!check(status == R0_OK, "policy artifact round-trips")) return 0;

    puts("Reasoner-0 Cartan self-test passed");
    return 1;
}

int main(int argc, char **argv)
{
    R0Policy policy;
    R0TrainingReport training;
    R0Status status;
    char error[256] = {0};
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0)
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (argc == 2 && strcmp(argv[1], "demo") == 0) {
        R0EnumerationReport report;
        r0_policy_init(&policy);
        status = r0_policy_train(&policy, &training);
        if (status == R0_OK)
            status = r0_enumerate(&policy, 8, &report, error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_enumeration(&report);
        return EXIT_SUCCESS;
    }
    if (argc == 3 && strcmp(argv[1], "train") == 0) {
        r0_policy_init(&policy);
        status = r0_policy_train(&policy, &training);
        if (status == R0_OK)
            status = r0_policy_save(&policy, argv[2], error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        printf("{\"schema\":\"zero.reasoner0_training.v1\","
               "\"modality\":\"structured_cartan_control\","
               "\"language_targets\":0,\"examples\":%u,"
               "\"epochs\":%u,\"mistakes\":%u,"
               "\"final_errors\":%u,\"policy\":\"%s\"}\n",
               training.examples, training.epochs, training.mistakes,
               training.final_errors, argv[2]);
        return EXIT_SUCCESS;
    }
    if (argc == 4 && strcmp(argv[1], "enumerate") == 0) {
        R0EnumerationReport report;
        uint8_t maximum_rank;
        if (!parse_u8(argv[3], 1, R0_ENUMERATION_MAX_RANK, &maximum_rank)) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        status = r0_policy_load(&policy, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r0_enumerate(&policy, maximum_rank, &report, error,
                                  sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_enumeration(&report);
        return EXIT_SUCCESS;
    }
    if (argc == 5 && strcmp(argv[1], "dataset") == 0) {
        R0EnumerationReport report;
        uint8_t maximum_rank;
        if (!parse_u8(argv[3], 1, R0_ENUMERATION_MAX_RANK, &maximum_rank)) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        status = r0_policy_load(&policy, argv[2], error, sizeof(error));
        if (status == R0_OK)
            status = r0_enumerate_dataset(&policy, maximum_rank, argv[4],
                                          &report, error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        print_enumeration(&report);
        return EXIT_SUCCESS;
    }
    if (argc >= 5 && strcmp(argv[1], "verify") == 0) {
        R0CartanMatrix matrix;
        uint8_t rank;
        int trace;
        int expected;
        int index;
        if (!parse_u8(argv[3], 1, R0_MAX_RANK, &rank)) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        expected = 4 + rank * rank;
        trace = argc == expected + 1 && strcmp(argv[expected], "--trace") == 0;
        if (argc != expected && !trace) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        memset(&matrix, 0, sizeof(matrix));
        matrix.rank = rank;
        for (index = 0; index < rank * rank; ++index) {
            int row = index / rank;
            int column = index % rank;
            if (!parse_entry(argv[4 + index], &CELL(&matrix, row, column))) {
                usage(argv[0]);
                return EXIT_FAILURE;
            }
        }
        status = r0_policy_load(&policy, argv[2], error, sizeof(error));
        if (status != R0_OK) {
            fprintf(stderr, "error: %s: %s\n", r0_status_name(status), error);
            return EXIT_FAILURE;
        }
        if (trace) {
            printf("{\"event\":\"candidate\",\"matrix\":");
            print_matrix(&matrix);
            puts("}");
        }
        return run_candidate(&policy, &matrix, trace);
    }
    usage(argv[0]);
    return EXIT_FAILURE;
}
