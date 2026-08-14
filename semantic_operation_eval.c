#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"
#include "faculty_protocol.h"
#include "quantity_oracle.h"

#define OPERATION_HEAD_INFER_NO_MAIN
#include "operation_head_infer.c"

enum {
    SEM_MAX_CASES = 512,
    SEM_MAX_LINE = 1800,
    SEM_TEXT = 384,
    SEM_REQUEST = 192,
    SEM_OUTPUT = 512,
    SEM_CLASSES = 5,
    SEM_TEMPLATES = 5
};

typedef struct {
    char id[128], previous_summary[192], model_input[SEM_TEXT];
    char canonical_input[SEM_TEXT], model_request[SEM_REQUEST];
    char bound_request[SEM_REQUEST], artifact[SEM_TEXT], summary[192];
    char stratum[16];
    int template_id;
} SemanticCase;

typedef struct {
    int cases, closed, syntax, operation, canonical_binding;
    int oracle_arithmetic, committed, exact_artifact, rejected;
    int rejected_state_mutations;
    int predicted[SEM_CLASSES];
    int template_cases[SEM_TEMPLATES], template_correct[SEM_TEMPLATES];
    double bits;
} SemanticResult;

static const char *SEM_LABELS[SEM_CLASSES] = {
    "quantity.add", "quantity.multiply", "quantity.add-rational",
    "quantity.convert", "quantity.solve-linear"
};

static int sem_copy(char *destination, size_t capacity, const char *source)
{
    size_t length = strlen(source);
    if (length >= capacity) return 0;
    memcpy(destination, source, length + 1);
    return 1;
}

static int sem_class(const char *request)
{
    int index;
    for (index = 0; index < SEM_CLASSES; ++index)
        if (strcmp(request, SEM_LABELS[index]) == 0) return index;
    return -1;
}

static int sem_read(const char *path, SemanticCase *cases, int *count)
{
    static const char expected[] =
        "id\tdomain\tprevious_summary\tmodel_input\tcanonical_input\t"
        "model_request\tbound_request\tartifact\tsummary\tstratum\ttemplate_id";
    FILE *file = fopen(path, "r");
    char line[SEM_MAX_LINE];
    int line_number = 0;
    if (file == NULL) return 0;
    while (fgets(line, sizeof(line), file) != NULL) {
        char *fields[11], *cursor, *end;
        int seen = 1;
        size_t length;
        ++line_number; length = strlen(line);
        while (length && (line[length - 1] == '\n' || line[length - 1] == '\r'))
            line[--length] = '\0';
        if (line_number == 1) {
            if (strcmp(line, expected) != 0) { fclose(file); return 0; }
            continue;
        }
        if (*count >= SEM_MAX_CASES) { fclose(file); return 0; }
        fields[0] = line;
        for (cursor = line; *cursor; ++cursor)
            if (*cursor == '\t' && seen < 11) {
                *cursor = '\0'; fields[seen++] = cursor + 1;
            }
        if (seen != 11 || strcmp(fields[1], "quantity") != 0 ||
            !sem_copy(cases[*count].id, sizeof(cases[*count].id), fields[0]) ||
            !sem_copy(cases[*count].previous_summary,
                sizeof(cases[*count].previous_summary), fields[2]) ||
            !sem_copy(cases[*count].model_input,
                sizeof(cases[*count].model_input), fields[3]) ||
            !sem_copy(cases[*count].canonical_input,
                sizeof(cases[*count].canonical_input), fields[4]) ||
            !sem_copy(cases[*count].model_request,
                sizeof(cases[*count].model_request), fields[5]) ||
            !sem_copy(cases[*count].bound_request,
                sizeof(cases[*count].bound_request), fields[6]) ||
            !sem_copy(cases[*count].artifact,
                sizeof(cases[*count].artifact), fields[7]) ||
            !sem_copy(cases[*count].summary,
                sizeof(cases[*count].summary), fields[8]) ||
            !sem_copy(cases[*count].stratum,
                sizeof(cases[*count].stratum), fields[9])) {
            fclose(file); return 0;
        }
        errno = 0; cases[*count].template_id = (int)strtol(fields[10], &end, 10);
        if (errno || *end || cases[*count].template_id < 0 ||
            cases[*count].template_id >= SEM_TEMPLATES ||
            sem_class(cases[*count].model_request) < 0 ||
            (strcmp(cases[*count].stratum, "lexical") != 0 &&
             strcmp(cases[*count].stratum, "implicit") != 0)) {
            fclose(file); return 0;
        }
        ++*count;
    }
    return !ferror(file) && fclose(file) == 0;
}

static unsigned char *sem_binary(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) return NULL;
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) { free(data); return NULL; }
    *length = (size_t)size; return data;
}

static void sem_feed_text(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    while (*cursor) { lm_feed(*cursor < 128 ? *cursor : '?'); ++cursor; }
}

static void sem_context(const SemanticCase *item)
{
    lm_reset(); lm_feed(CHANNEL_START_TOKEN); lm_feed('Q');
    lm_feed(CHANNEL_SUMMARY_TOKEN); sem_feed_text(item->previous_summary);
    lm_feed(CHANNEL_MESSAGE_END_TOKEN); lm_feed(CHANNEL_MESSAGE_TOKEN);
    lm_feed('U'); sem_feed_text(item->model_input);
    lm_feed(CHANNEL_MESSAGE_END_TOKEN); lm_feed(CHANNEL_MESSAGE_TOKEN);
    lm_feed('Z'); lm_feed(CHANNEL_REPLY_TOKEN); lm_feed('U');
    lm_feed(CHANNEL_TARGET_TOKEN);
}

static int sem_parse(const char *generated, char *request, size_t capacity)
{
    static const char prefix[] = "@request ", suffix[] = " @close";
    const char *end;
    size_t length;
    if (strncmp(generated, prefix, sizeof(prefix) - 1) != 0) return 0;
    end = strstr(generated + sizeof(prefix) - 1, suffix);
    if (end == NULL || strcmp(end, suffix) != 0) return 0;
    length = (size_t)(end - generated - (sizeof(prefix) - 1));
    if (length == 0 || length >= capacity) return 0;
    memcpy(request, generated + sizeof(prefix) - 1, length);
    request[length] = '\0'; return 1;
}

static double sem_bits(const SemanticCase *item)
{
    char expected[SEM_OUTPUT];
    const unsigned char *cursor;
    double bits = 0.0;
    int count = 0;
    snprintf(expected, sizeof(expected), "@request %s @close",
             item->model_request);
    sem_context(item); cursor = (const unsigned char *)expected;
    while (*cursor) {
        float probability = fmaxf(lm_probability(*cursor), 1.0e-12f);
        bits -= log2((double)probability); lm_feed(*cursor++); ++count;
    }
    bits -= log2((double)fmaxf(lm_probability(CHANNEL_MESSAGE_END_TOKEN),
                               1.0e-12f));
    return bits / (count + 1);
}

static void sem_evaluate(const SemanticCase *item, SemanticResult *result)
{
    char generated[SEM_OUTPUT], request[SEM_REQUEST], canonical[SEM_REQUEST];
    char artifact[SEM_TEXT], summary[192];
    int length = 0, closed = 0, syntax, predicted, expected, index;
    FacultyController controller;
    FacultyChannelState before;
    const FacultyChannelState *state;
    expected = sem_class(item->model_request);
    result->bits += sem_bits(item);
    sem_context(item); lm_seed(0);
    for (index = 0; index < 128; ++index) {
        int token = lm_sample(0.0f, 0, 1.0f);
        lm_feed(token);
        if (token == CHANNEL_MESSAGE_END_TOKEN) { closed = 1; break; }
        if (token >= 32 && token < 127 && length + 1 < SEM_OUTPUT)
            generated[length++] = (char)token;
    }
    generated[length] = '\0'; syntax = closed &&
        sem_parse(generated, request, sizeof(request));
    predicted = syntax ? sem_class(request) : -1;
    ++result->cases; result->closed += closed; result->syntax += syntax;
    ++result->template_cases[item->template_id];
    if (predicted >= 0) ++result->predicted[predicted];
    if (predicted == expected) {
        ++result->operation; ++result->template_correct[item->template_id];
    }
    if (quantity_request_from_input(item->canonical_input, canonical,
                                    sizeof(canonical)) &&
        strcmp(canonical, item->bound_request) == 0)
        ++result->canonical_binding;
    if (quantity_oracle_execute(item->bound_request, artifact, sizeof(artifact),
                                summary, sizeof(summary)) &&
        strcmp(artifact, item->artifact) == 0 &&
        strcmp(summary, item->summary) == 0)
        ++result->oracle_arithmetic;
    faculty_controller_init(&controller);
    if (!faculty_register(&controller, "quantity", "no exact result"))
        exit(EXIT_FAILURE);
    before = *faculty_get(&controller, "quantity");
    if (syntax && faculty_enter(&controller, "quantity", "execute") &&
        faculty_emit_quantity_request(&controller, request) &&
        faculty_close(&controller)) {
        if (faculty_execute_quantity(&controller, item->canonical_input)) {
            ++result->committed; state = faculty_get(&controller, "quantity");
            if (strcmp(state->artifact, item->artifact) == 0 &&
                strcmp(state->authority, "kernel") == 0)
                ++result->exact_artifact;
        } else {
            ++result->rejected; state = faculty_get(&controller, "quantity");
            if (memcmp(state, &before, sizeof(before)) != 0)
                ++result->rejected_state_mutations;
        }
    }
}

static int sem_json(const char *path, const SemanticResult *result)
{
    FILE *file = fopen(path, "w");
    if (file == NULL) return 0;
    fprintf(file,
        "{\n  \"schema\": \"zero.semantic_operation_eval.v1\",\n"
        "  \"cases\": %d, \"closed\": %d, \"syntax\": %d,\n"
        "  \"operation\": %d, \"canonical_binding\": %d,\n"
        "  \"oracle_arithmetic\": %d, \"committed\": %d,\n"
        "  \"exact_artifact\": %d, \"rejected\": %d,\n"
        "  \"rejected_state_mutations\": %d,\n"
        "  \"predicted_counts\": [%d,%d,%d,%d,%d],\n"
        "  \"template_cases\": [%d,%d,%d,%d,%d],\n"
        "  \"template_correct\": [%d,%d,%d,%d,%d],\n"
        "  \"target_bits\": %.8f\n}\n",
        result->cases, result->closed, result->syntax, result->operation,
        result->canonical_binding, result->oracle_arithmetic,
        result->committed, result->exact_artifact, result->rejected,
        result->rejected_state_mutations, result->predicted[0],
        result->predicted[1], result->predicted[2], result->predicted[3],
        result->predicted[4], result->template_cases[0],
        result->template_cases[1], result->template_cases[2],
        result->template_cases[3], result->template_cases[4],
        result->template_correct[0], result->template_correct[1],
        result->template_correct[2], result->template_correct[3],
        result->template_correct[4],
        result->cases ? result->bits / result->cases : 0.0);
    return fclose(file) == 0;
}

int main(int argc, char **argv)
{
    SemanticCase cases[SEM_MAX_CASES];
    SemanticResult result = {0};
    unsigned char *model;
    size_t model_length;
    int count = 0, index;
    if (argc != 5 || strcmp(argv[3], "--json") != 0) {
        fprintf(stderr, "usage: %s MODEL semantic.tsv --json OUTPUT\n", argv[0]);
        return EXIT_FAILURE;
    }
    if (!sem_read(argv[2], cases, &count)) {
        fprintf(stderr, "error: cannot parse semantic data\n");
        return EXIT_FAILURE;
    }
    model = sem_binary(argv[1], &model_length);
    if (model == NULL || model_length > INT_MAX ||
        lm_load(model, (int)model_length) != 0) {
        free(model); return EXIT_FAILURE;
    }
    for (index = 0; index < count; ++index) sem_evaluate(&cases[index], &result);
    printf("semantic operation %d/%d commit %d/%d mutations %d bits %.4f\n",
           result.operation, result.cases, result.committed, result.cases,
           result.rejected_state_mutations,
           result.cases ? result.bits / result.cases : 0.0);
    if (!sem_json(argv[4], &result)) { free(model); return EXIT_FAILURE; }
    free(model); q31_release(); release_working_memory();
    return EXIT_SUCCESS;
}
