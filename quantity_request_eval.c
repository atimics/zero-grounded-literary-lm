#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"
#include "faculty_protocol.h"
#include "literary_infer.h"
#include "quantity_oracle.h"

enum {
    MAX_CASES = 2048,
    MAX_LINE = 1600,
    MAX_ID = 96,
    MAX_SUMMARY = 192,
    CASE_INPUT_CAPACITY = 320,
    MAX_REQUEST = 160,
    MAX_ARTIFACT = 320,
    MAX_OUTPUT = 512,
    MAX_GENERATED = 128
};

typedef struct {
    char id[MAX_ID];
    char previous_summary[MAX_SUMMARY];
    char input[CASE_INPUT_CAPACITY];
    char request[MAX_REQUEST];
    char bound_request[MAX_REQUEST];
    char artifact[MAX_ARTIFACT];
    char summary[MAX_SUMMARY];
} RequestCase;

typedef struct {
    int cases;
    int closed;
    int syntax;
    int operation;
    int arguments;
    int exact_request;
    int oracle_arithmetic;
    int committed;
    int exact_artifact;
    int rejected;
    int rejected_state_mutations;
    int operation_only;
    double bits;
} RequestResult;

static unsigned char *read_binary(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) {
        if (file != NULL) fclose(file);
        return NULL;
    }
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) {
        free(data);
        return NULL;
    }
    *length = (size_t)size;
    return data;
}

static int copy_field(char *destination, size_t capacity, const char *source)
{
    size_t length = strlen(source);
    if (length >= capacity) return 0;
    memcpy(destination, source, length + 1);
    return 1;
}

static int read_tsv(const char *path, RequestCase *cases, int *count)
{
    static const char full_header[] =
        "id\tdomain\tprevious_summary\tinput\trequest\tartifact\tsummary";
    static const char operation_header[] =
        "id\tdomain\tprevious_summary\tinput\tmodel_request\trequest\tartifact\tsummary";
    FILE *file = fopen(path, "r");
    char line[MAX_LINE];
    int line_number = 0;
    int operation_mode = 0;
    int expected_fields = 7;
    if (file == NULL) return 0;
    while (fgets(line, sizeof(line), file) != NULL) {
        char *fields[8];
        char *cursor;
        int fields_seen = 1;
        size_t length;
        ++line_number;
        length = strlen(line);
        while (length > 0 && (line[length - 1] == '\n' ||
                              line[length - 1] == '\r')) {
            line[--length] = '\0';
        }
        if (line_number == 1) {
            if (strcmp(line, operation_header) == 0) {
                operation_mode = 1;
                expected_fields = 8;
            } else if (strcmp(line, full_header) != 0) {
                fclose(file);
                return 0;
            }
            continue;
        }
        if (*count >= MAX_CASES) {
            fclose(file);
            return 0;
        }
        fields[0] = line;
        for (cursor = line; *cursor != '\0'; ++cursor) {
            if (*cursor == '\t' && fields_seen < expected_fields) {
                *cursor = '\0';
                fields[fields_seen++] = cursor + 1;
            }
        }
        if (fields_seen != expected_fields ||
            strcmp(fields[1], "quantity") != 0 ||
            !copy_field(cases[*count].id, sizeof(cases[*count].id), fields[0]) ||
            !copy_field(cases[*count].previous_summary,
                        sizeof(cases[*count].previous_summary), fields[2]) ||
            !copy_field(cases[*count].input, sizeof(cases[*count].input),
                        fields[3]) ||
            !copy_field(cases[*count].request, sizeof(cases[*count].request),
                        fields[4]) ||
            !copy_field(cases[*count].bound_request,
                        sizeof(cases[*count].bound_request),
                        operation_mode ? fields[5] : fields[4]) ||
            !copy_field(cases[*count].artifact, sizeof(cases[*count].artifact),
                        fields[operation_mode ? 6 : 5]) ||
            !copy_field(cases[*count].summary, sizeof(cases[*count].summary),
                        fields[operation_mode ? 7 : 6])) {
            fclose(file);
            return 0;
        }
        ++*count;
    }
    return !ferror(file) && fclose(file) == 0;
}

static void feed_text(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    while (*cursor != '\0') {
        lm_feed(*cursor < 128 ? *cursor : '?');
        ++cursor;
    }
}

static void feed_context(const RequestCase *item)
{
    lm_reset();
    lm_feed(CHANNEL_START_TOKEN); lm_feed('Q');
    lm_feed(CHANNEL_SUMMARY_TOKEN); feed_text(item->previous_summary);
    lm_feed(CHANNEL_MESSAGE_END_TOKEN); lm_feed(CHANNEL_MESSAGE_TOKEN);
    lm_feed('U'); feed_text(item->input); lm_feed(CHANNEL_MESSAGE_END_TOKEN);
    lm_feed(CHANNEL_MESSAGE_TOKEN); lm_feed('Z'); lm_feed(CHANNEL_REPLY_TOKEN);
    lm_feed('U'); lm_feed(CHANNEL_TARGET_TOKEN);
}

static void expected_output(const RequestCase *item, char *output,
                            size_t capacity)
{
    int written = snprintf(output, capacity, "@request %s @close",
                           item->request);
    if (written < 0 || (size_t)written >= capacity) exit(EXIT_FAILURE);
}

static double score_bits(const RequestCase *item, const char *expected)
{
    const unsigned char *cursor = (const unsigned char *)expected;
    double bits = 0.0;
    int count = 0;
    feed_context(item);
    while (*cursor != '\0') {
        float probability = lm_probability(*cursor);
        if (probability < 1.0e-12f) probability = 1.0e-12f;
        bits -= log2((double)probability);
        lm_feed(*cursor++);
        ++count;
    }
    {
        float probability = lm_probability(CHANNEL_MESSAGE_END_TOKEN);
        if (probability < 1.0e-12f) probability = 1.0e-12f;
        bits -= log2((double)probability);
        ++count;
    }
    return bits / count;
}

static int parse_request(const char *generated, char *request,
                         size_t capacity)
{
    static const char prefix[] = "@request ";
    static const char close[] = " @close";
    const char *end;
    size_t length;
    if (strncmp(generated, prefix, sizeof(prefix) - 1) != 0) return 0;
    end = strstr(generated + sizeof(prefix) - 1, close);
    if (end == NULL || strcmp(end, close) != 0) return 0;
    length = (size_t)(end - (generated + sizeof(prefix) - 1));
    if (length == 0 || length >= capacity) return 0;
    memcpy(request, generated + sizeof(prefix) - 1, length);
    request[length] = '\0';
    return 1;
}

static void request_parts(const char *request, char *operation,
                          size_t operation_capacity, const char **arguments)
{
    const char *space = strchr(request, ' ');
    size_t length = space == NULL ? strlen(request) : (size_t)(space - request);
    if (length >= operation_capacity) length = operation_capacity - 1;
    memcpy(operation, request, length);
    operation[length] = '\0';
    *arguments = space == NULL ? "" : space + 1;
}

static void evaluate_case(const RequestCase *item, RequestResult *result,
                          int print_sample)
{
    char expected[MAX_OUTPUT];
    char generated[MAX_OUTPUT];
    char request[MAX_REQUEST];
    char expected_operation[64], actual_operation[64];
    char canonical_request[MAX_REQUEST];
    const char *expected_arguments;
    const char *actual_arguments;
    char artifact[MAX_ARTIFACT], summary[MAX_SUMMARY];
    int length = 0;
    int closed = 0;
    int syntax;
    int operation_only = strcmp(item->request, item->bound_request) != 0;
    int index;
    FacultyController controller;
    FacultyChannelState before;
    const FacultyChannelState *state;
    expected_output(item, expected, sizeof(expected));
    result->bits += score_bits(item, expected);
    if (quantity_oracle_execute(item->bound_request, artifact, sizeof(artifact),
                                summary, sizeof(summary)) &&
        strcmp(artifact, item->artifact) == 0 &&
        strcmp(summary, item->summary) == 0) {
        ++result->oracle_arithmetic;
    }
    if (operation_only) {
        result->operation_only = 1;
        if (quantity_request_from_input(item->input, canonical_request,
                                        sizeof(canonical_request)) &&
            strcmp(canonical_request, item->bound_request) == 0) {
            ++result->arguments;
        }
    }
    feed_context(item);
    lm_seed(0);
    for (index = 0; index < MAX_GENERATED; ++index) {
        int token = lm_sample(0.0f, 0, 1.0f);
        lm_feed(token);
        if (token == CHANNEL_MESSAGE_END_TOKEN) {
            closed = 1;
            break;
        }
        if (token >= 32 && token < 127) generated[length++] = (char)token;
    }
    generated[length] = '\0';
    syntax = closed && parse_request(generated, request, sizeof(request));
    if (syntax) {
        ++result->syntax;
        request_parts(item->request, expected_operation,
                      sizeof(expected_operation), &expected_arguments);
        request_parts(request, actual_operation, sizeof(actual_operation),
                      &actual_arguments);
        if (strcmp(actual_operation, expected_operation) == 0) {
            ++result->operation;
        }
        if (!operation_only &&
            strcmp(actual_arguments, expected_arguments) == 0) {
            ++result->arguments;
        }
        if (strcmp(request, item->request) == 0) ++result->exact_request;
    }
    faculty_controller_init(&controller);
    if (!faculty_register(&controller, "quantity", "no exact result")) {
        exit(EXIT_FAILURE);
    }
    before = *faculty_get(&controller, "quantity");
    if (syntax && faculty_enter(&controller, "quantity", "execute") &&
        faculty_emit_quantity_request(&controller, request) &&
        faculty_close(&controller)) {
        if (faculty_execute_quantity(&controller, item->input)) {
            ++result->committed;
            state = faculty_get(&controller, "quantity");
            if (strcmp(state->artifact, item->artifact) == 0 &&
                strcmp(state->authority, "kernel") == 0) {
                ++result->exact_artifact;
            }
        } else {
            ++result->rejected;
            state = faculty_get(&controller, "quantity");
            if (memcmp(state, &before, sizeof(before)) != 0) {
                ++result->rejected_state_mutations;
            }
        }
    }
    ++result->cases;
    result->closed += closed;
    if (print_sample) {
        printf("\n[%s]\ninput:    %s\nexpected: %s\nmodel:    %s%s\n",
               item->id, item->input, expected, generated,
               closed ? " <END>" : " <FORCED-STOP>");
    }
}

static int write_json(const char *path, const char *model,
                      const RequestResult *result)
{
    FILE *file = fopen(path, "w");
    if (file == NULL) return 0;
    fprintf(file,
            "{\n  \"schema\": \"zero.quantity_request_eval.v2\",\n"
            "  \"model\": \"%s\",\n"
            "  \"request_mode\": \"%s\",\n  \"quantity\": {\n"
            "    \"cases\": %d, \"closed\": %d, \"syntax\": %d,\n"
            "    \"operation\": %d, \"arguments\": %d, "
            "\"exact_request\": %d,\n"
            "    \"oracle_arithmetic\": %d, \"committed\": %d, "
            "\"exact_artifact\": %d,\n"
            "    \"rejected\": %d, \"rejected_state_mutations\": %d,\n"
            "    \"target_bits\": %.8f\n  }\n}\n",
            model, result->operation_only ? "operation" : "full",
            result->cases, result->closed, result->syntax,
            result->operation, result->arguments, result->exact_request,
            result->oracle_arithmetic, result->committed,
            result->exact_artifact, result->rejected,
            result->rejected_state_mutations,
            result->cases ? result->bits / result->cases : 0.0);
    return fclose(file) == 0;
}

int main(int argc, char **argv)
{
    RequestCase cases[MAX_CASES];
    RequestResult result = {0};
    unsigned char *model_data;
    size_t model_length;
    int case_count = 0;
    int limit = MAX_CASES;
    int samples = 0;
    int index;
    if ((argc != 5 && argc != 7) ||
        (strcmp(argv[3], "--json") != 0 &&
         strcmp(argv[3], "--samples") != 0) ||
        (argc == 7 && strcmp(argv[5], "--limit") != 0)) {
        fprintf(stderr, "usage: %s MODEL quantity-request.tsv --json OUTPUT\n"
                        "       %s MODEL quantity-request.tsv --json OUTPUT --limit N\n"
                        "       %s MODEL quantity-request.tsv --samples N\n",
                argv[0], argv[0], argv[0]);
        return EXIT_FAILURE;
    }
    if (strcmp(argv[3], "--samples") == 0) {
        char *end;
        long requested = strtol(argv[4], &end, 10);
        if (end == argv[4] || *end != '\0' || requested < 1 ||
            requested > 100) return EXIT_FAILURE;
        limit = (int)requested;
        samples = 1;
    }
    if (argc == 7) {
        char *end;
        long requested = strtol(argv[6], &end, 10);
        if (end == argv[6] || *end != '\0' || requested < 1 ||
            requested > MAX_CASES) return EXIT_FAILURE;
        limit = (int)requested;
    }
    if (!read_tsv(argv[2], cases, &case_count)) {
        fprintf(stderr, "error: cannot parse %s\n", argv[2]);
        return EXIT_FAILURE;
    }
    model_data = read_binary(argv[1], &model_length);
    if (model_data == NULL || model_length > INT_MAX ||
        lm_load(model_data, (int)model_length) != 0) {
        free(model_data);
        fprintf(stderr, "error: cannot load model %s: %s\n", argv[1],
                strerror(errno));
        return EXIT_FAILURE;
    }
    if (limit > case_count) limit = case_count;
    for (index = 0; index < limit; ++index) {
        evaluate_case(&cases[index], &result, samples);
    }
    printf("quantity request exact %d/%d operation %d/%d arguments %d/%d "
           "commit %d/%d oracle %d/%d mutations %d bits %.4f\n",
           result.exact_request, result.cases, result.operation, result.cases,
           result.arguments, result.cases, result.committed, result.cases,
           result.oracle_arithmetic, result.cases,
           result.rejected_state_mutations,
           result.cases ? result.bits / result.cases : 0.0);
    if (!samples && !write_json(argv[4], argv[1], &result)) {
        free(model_data);
        return EXIT_FAILURE;
    }
    free(model_data);
    return EXIT_SUCCESS;
}
