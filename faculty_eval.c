#include <errno.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"
#include "literary_infer.h"

enum {
    MAX_CASES = 2048,
    MAX_LINE = 1400,
    MAX_ID = 96,
    MAX_DOMAIN = 24,
    MAX_SUMMARY = 192,
    CASE_INPUT_CAPACITY = 320,
    MAX_ARTIFACT = 320,
    MAX_OUTPUT = 512,
    MAX_GENERATED = 320,
    EVAL_CASES_PER_DOMAIN = 20
};

typedef struct {
    char id[MAX_ID];
    char domain[MAX_DOMAIN];
    char previous_summary[MAX_SUMMARY];
    char input[CASE_INPUT_CAPACITY];
    char artifact[MAX_ARTIFACT];
    char summary[MAX_SUMMARY];
} EvalCase;

typedef struct {
    const char *id;
    int count;
    int closed;
    int syntax;
    int exact_artifact;
    int verified_artifact;
    int committed;
    int natural_artifact_close;
    int exact_chunk;
    double bits;
} DomainResult;

static unsigned char *read_binary(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) {
        if (file != NULL) fclose(file);
        fprintf(stderr, "error: cannot open model %s: %s\n", path,
                strerror(errno));
        return NULL;
    }
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size) {
        fclose(file);
        free(data);
        fprintf(stderr, "error: cannot read model %s\n", path);
        return NULL;
    }
    if (fclose(file) != 0) {
        free(data);
        return NULL;
    }
    *length = (size_t)size;
    return data;
}

static int copy_field(char *destination, size_t capacity, const char *source,
                      const char *name)
{
    size_t length = strlen(source);
    if (length >= capacity) {
        fprintf(stderr, "error: %s field is too long\n", name);
        return -1;
    }
    memcpy(destination, source, length + 1);
    return 0;
}

static int read_tsv(const char *path, EvalCase *cases, int *case_count)
{
    static const char header[] =
        "id\tdomain\tprevious_summary\tinput\tartifact\tsummary";
    FILE *file = fopen(path, "r");
    char line[MAX_LINE];
    int line_number = 0;
    if (file == NULL) {
        fprintf(stderr, "error: cannot open %s\n", path);
        return -1;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        char *fields[6];
        char *cursor;
        int field_count = 1;
        size_t length;
        ++line_number;
        length = strlen(line);
        if (length != 0 && line[length - 1] == '\n') line[--length] = '\0';
        if (length != 0 && line[length - 1] == '\r') line[--length] = '\0';
        if (line_number == 1) {
            if (strcmp(line, header) != 0) {
                fprintf(stderr, "error: invalid header in %s\n", path);
                fclose(file);
                return -1;
            }
            continue;
        }
        if (*case_count >= MAX_CASES) {
            fclose(file);
            fprintf(stderr, "error: too many faculty evaluation cases\n");
            return -1;
        }
        fields[0] = line;
        for (cursor = line; *cursor != '\0'; ++cursor) {
            if (*cursor == '\t' && field_count < 6) {
                *cursor = '\0';
                fields[field_count++] = cursor + 1;
            }
        }
        if (field_count != 6) {
            fclose(file);
            fprintf(stderr, "error: malformed %s line %d\n", path,
                    line_number);
            return -1;
        }
        {
            EvalCase *item = &cases[(*case_count)++];
            if (copy_field(item->id, sizeof(item->id), fields[0], "id") ||
                copy_field(item->domain, sizeof(item->domain), fields[1],
                           "domain") ||
                copy_field(item->previous_summary,
                           sizeof(item->previous_summary), fields[2],
                           "previous_summary") ||
                copy_field(item->input, sizeof(item->input), fields[3],
                           "input") ||
                copy_field(item->artifact, sizeof(item->artifact), fields[4],
                           "artifact") ||
                copy_field(item->summary, sizeof(item->summary), fields[5],
                           "summary")) {
                fclose(file);
                return -1;
            }
        }
    }
    if (ferror(file) || fclose(file) != 0) return -1;
    return 0;
}

static void feed_text(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    while (*cursor != '\0') {
        lm_feed(*cursor < 128 ? *cursor : '?');
        ++cursor;
    }
}

static int style_for(const char *domain)
{
    if (strcmp(domain, "quantity") == 0) return 'Q';
    if (strcmp(domain, "geometry") == 0) return 'G';
    if (strcmp(domain, "art") == 0) return 'A';
    return '?';
}

static void feed_context(const EvalCase *item)
{
    lm_reset();
    lm_feed(CHANNEL_START_TOKEN);
    lm_feed(style_for(item->domain));
    lm_feed(CHANNEL_SUMMARY_TOKEN);
    feed_text(item->previous_summary);
    lm_feed(CHANNEL_MESSAGE_END_TOKEN);
    lm_feed(CHANNEL_MESSAGE_TOKEN);
    lm_feed('U');
    feed_text(item->input);
    lm_feed(CHANNEL_MESSAGE_END_TOKEN);
    lm_feed(CHANNEL_MESSAGE_TOKEN);
    lm_feed('Z');
    lm_feed(CHANNEL_REPLY_TOKEN);
    lm_feed('U');
    lm_feed(CHANNEL_TARGET_TOKEN);
}

static void expected_output(const EvalCase *item, char *output,
                            size_t capacity)
{
    int written = snprintf(output, capacity,
                           "@artifact %s @summary %s @close", item->artifact,
                           item->summary);
    if (written < 0 || (size_t)written >= capacity) {
        fprintf(stderr, "error: expected output overflow for %s\n", item->id);
        exit(EXIT_FAILURE);
    }
}

static double score_bits(const EvalCase *item, const char *expected)
{
    const unsigned char *cursor = (const unsigned char *)expected;
    double total = 0.0;
    int count = 0;
    feed_context(item);
    while (*cursor != '\0') {
        int token = *cursor < 128 ? *cursor : '?';
        float probability = lm_probability(token);
        if (probability < 1.0e-12f) probability = 1.0e-12f;
        total -= log2((double)probability);
        lm_feed(token);
        ++cursor;
        ++count;
    }
    {
        float probability = lm_probability(CHANNEL_MESSAGE_END_TOKEN);
        if (probability < 1.0e-12f) probability = 1.0e-12f;
        total -= log2((double)probability);
        ++count;
    }
    return total / count;
}

static int extract_artifact(const char *generated, char *artifact,
                            size_t capacity)
{
    static const char prefix[] = "@artifact ";
    const char *end;
    size_t length;
    if (strncmp(generated, prefix, sizeof(prefix) - 1) != 0) return 0;
    end = strstr(generated + sizeof(prefix) - 1, " @summary ");
    if (end == NULL) return 0;
    length = (size_t)(end - (generated + sizeof(prefix) - 1));
    if (length >= capacity) return 0;
    memcpy(artifact, generated + sizeof(prefix) - 1, length);
    artifact[length] = '\0';
    return strstr(end + 10, " @close") != NULL;
}

static int parse_integer(const char *text, const char *prefix, long *value,
                         const char **tail)
{
    char *end;
    size_t prefix_length = strlen(prefix);
    if (strncmp(text, prefix, prefix_length) != 0) return 0;
    errno = 0;
    *value = strtol(text + prefix_length, &end, 10);
    if (errno != 0 || end == text + prefix_length) return 0;
    if (tail != NULL) *tail = end;
    return 1;
}

static int quantity_artifact_valid(const EvalCase *item, const char *artifact)
{
    long a, b, c, value;
    int consumed = 0;
    const char *tail;
    if (sscanf(item->input, "add %ld %ld%n", &a, &b, &consumed) == 2 &&
        item->input[consumed] == '\0') {
        return parse_integer(artifact, "result ", &value, &tail) &&
               *tail == '\0' && value == a + b;
    }
    consumed = 0;
    if (sscanf(item->input, "multiply %ld %ld%n", &a, &b, &consumed) == 2 &&
        item->input[consumed] == '\0') {
        return parse_integer(artifact, "result ", &value, &tail) &&
               *tail == '\0' && value == a * b;
    }
    consumed = 0;
    if (sscanf(item->input, "solve %ld*x+%ld=%ld%n", &a, &b, &c,
               &consumed) == 3 && item->input[consumed] == '\0' && a != 0) {
        return parse_integer(artifact, "x ", &value, &tail) &&
               *tail == '\0' && a * value + b == c;
    }
    {
        char conversion[16];
        char unit[4];
        long factor;
        consumed = 0;
        if (sscanf(item->input, "convert %ld %15s%n", &a, conversion,
                   &consumed) == 2 && item->input[consumed] == '\0') {
            if (strcmp(conversion, "m-to-cm") == 0) {
                factor = 100;
                strcpy(unit, "cm");
            } else if (strcmp(conversion, "cm-to-mm") == 0) {
                factor = 10;
                strcpy(unit, "mm");
            } else if (strcmp(conversion, "kg-to-g") == 0) {
                factor = 1000;
                strcpy(unit, "g");
            } else {
                return 0;
            }
            return parse_integer(artifact, "result ", &value, &tail) &&
                   value == a * factor && *tail == ' ' &&
                   strcmp(tail + 1, unit) == 0;
        }
    }
    {
        long left_num, left_den, right_num, right_den;
        long output_num, output_den = 1;
        consumed = 0;
        if (sscanf(item->input, "add-rational %ld/%ld %ld/%ld%n",
                   &left_num, &left_den, &right_num, &right_den,
                   &consumed) == 4 && item->input[consumed] == '\0' &&
            left_den != 0 && right_den != 0 &&
            parse_integer(artifact, "result ", &output_num, &tail)) {
            if (*tail == '/') {
                char *end;
                errno = 0;
                output_den = strtol(tail + 1, &end, 10);
                if (errno != 0 || end == tail + 1 || *end != '\0' ||
                    output_den == 0) return 0;
            } else if (*tail != '\0') {
                return 0;
            }
            return output_num * left_den * right_den ==
                   output_den *
                       (left_num * right_den + right_num * left_den);
        }
    }
    return 0;
}

static int best_allowed_token(const char *allowed)
{
    int best = -1;
    float best_probability = -1.0f;
    const unsigned char *cursor = (const unsigned char *)allowed;
    while (*cursor != '\0') {
        float probability = lm_probability(*cursor);
        if (probability > best_probability) {
            best_probability = probability;
            best = *cursor;
        }
        ++cursor;
    }
    return best;
}

static int append_character(char *output, size_t capacity, int *length,
                            int token)
{
    if (*length + 1 >= (int)capacity) return 0;
    output[(*length)++] = (char)token;
    output[*length] = '\0';
    return 1;
}

static int quantity_unit(const char *input, const char **unit)
{
    if (strstr(input, " m-to-cm") != NULL) *unit = "cm";
    else if (strstr(input, " cm-to-mm") != NULL) *unit = "mm";
    else if (strstr(input, " kg-to-g") != NULL) *unit = "g";
    else return 0;
    return 1;
}

static int decode_quantity_artifact(const EvalCase *item, char *artifact,
                                    size_t capacity, int *natural_close)
{
    const char *fixed_prefix = strncmp(item->input, "solve ", 6) == 0
                                   ? "x " : "result ";
    const char *unit = NULL;
    int rational = strncmp(item->input, "add-rational ", 13) == 0;
    int conversion = quantity_unit(item->input, &unit);
    int saw_digit = 0;
    int saw_slash = 0;
    int need_denominator_digit = 0;
    int length = 0;
    int steps;
    size_t prefix_length = strlen(fixed_prefix);
    if (prefix_length >= capacity) return 0;
    memcpy(artifact, fixed_prefix, prefix_length + 1);
    length = (int)prefix_length;
    feed_text(fixed_prefix);
    *natural_close = 0;
    for (steps = 0; steps < 16; ++steps) {
        const char *allowed;
        int token;
        if (!saw_digit) allowed = steps == 0 ? "-0123456789" : "0123456789";
        else if (need_denominator_digit) allowed = "123456789";
        else if (rational && !saw_slash) allowed = "0123456789/ ";
        else allowed = "0123456789 ";
        token = best_allowed_token(allowed);
        if (token < 0) return 0;
        lm_feed(token);
        if (token == ' ') {
            *natural_close = 1;
            break;
        }
        if (!append_character(artifact, capacity, &length, token)) return 0;
        if (token == '/') {
            saw_slash = 1;
            need_denominator_digit = 1;
            saw_digit = 0;
        } else if (token >= '0' && token <= '9') {
            saw_digit = 1;
            need_denominator_digit = 0;
        }
    }
    if (!*natural_close) lm_feed(' ');
    if (!saw_digit || need_denominator_digit) return 0;
    if (conversion) {
        int unit_length = (int)strlen(unit);
        int index;
        if (!append_character(artifact, capacity, &length, ' ')) return 0;
        for (index = 0; index < unit_length; ++index) {
            if (!append_character(artifact, capacity, &length, unit[index])) {
                return 0;
            }
        }
        feed_text(unit);
        lm_feed(' ');
    }
    return 1;
}

static void feed_scaffolded_close(const char *summary)
{
    feed_text("@summary ");
    feed_text(summary);
    feed_text(" @close");
    lm_feed(CHANNEL_MESSAGE_END_TOKEN);
}

static int run_self_test(void)
{
    static const struct {
        const char *input;
        const char *valid;
        const char *invalid;
    } cases[] = {
        {"add -8 13", "result 5", "result 4"},
        {"multiply -9 13", "result -117", "result 117"},
        {"add-rational -2/4 -9/12", "result -5/4", "result -11/16"},
        {"convert 188 m-to-cm", "result 18800 cm", "result 18800 mm"},
        {"solve 6*x+-19=-25", "x -1", "x 1"}
    };
    EvalCase item;
    size_t index;
    memset(&item, 0, sizeof(item));
    strcpy(item.domain, "quantity");
    for (index = 0; index < sizeof(cases) / sizeof(cases[0]); ++index) {
        strcpy(item.input, cases[index].input);
        if (!quantity_artifact_valid(&item, cases[index].valid) ||
            quantity_artifact_valid(&item, cases[index].invalid)) {
            fprintf(stderr, "quantity validator self-test failed at %zu\n",
                    index);
            return 0;
        }
    }
    printf("faculty evaluator self-test: quantity semantics passed\n");
    return 1;
}

static void evaluate_case(const EvalCase *item, DomainResult *result,
                          int print_sample, int constrained_quantity)
{
    char expected[MAX_OUTPUT];
    char generated[MAX_OUTPUT];
    char artifact[MAX_ARTIFACT];
    int closed = 0;
    int length = 0;
    int index;
    expected_output(item, expected, sizeof(expected));
    result->bits += score_bits(item, expected);
    if (constrained_quantity) {
        int natural_close = 0;
        int valid;
        feed_context(item);
        lm_seed(0);
        feed_text("@artifact ");
        if (decode_quantity_artifact(item, artifact, sizeof(artifact),
                                     &natural_close)) {
            valid = quantity_artifact_valid(item, artifact);
            snprintf(generated, sizeof(generated),
                     "@artifact %s @summary %s @close", artifact,
                     valid ? item->summary
                           : "candidate rejected by quantity checker");
            feed_scaffolded_close(valid ? item->summary
                                        : "candidate rejected by quantity checker");
            closed = 1;
            ++result->syntax;
            result->natural_artifact_close += natural_close;
            if (valid) {
                ++result->verified_artifact;
                ++result->committed;
            }
            if (strcmp(artifact, item->artifact) == 0) {
                ++result->exact_artifact;
            }
        } else {
            strcpy(generated, "@artifact <invalid> @summary candidate rejected by quantity checker @close");
            feed_scaffolded_close("candidate rejected by quantity checker");
            closed = 1;
        }
    } else {
        feed_context(item);
        lm_seed(0);
        for (index = 0; index < MAX_GENERATED; ++index) {
            int token = lm_sample(0.0f, 0, 1.0f);
            lm_feed(token);
            if (token == CHANNEL_MESSAGE_END_TOKEN) {
                closed = 1;
                break;
            }
            if (token >= 32 && token < 127 && length + 1 < MAX_OUTPUT) {
                generated[length++] = (char)token;
            }
        }
        generated[length] = '\0';
        if (extract_artifact(generated, artifact, sizeof(artifact))) {
            ++result->syntax;
            if (strcmp(artifact, item->artifact) == 0) {
                ++result->exact_artifact;
            }
            if (strcmp(item->domain, "quantity") == 0 &&
                quantity_artifact_valid(item, artifact)) {
                ++result->verified_artifact;
                ++result->committed;
            }
        }
    }
    if (print_sample) {
        printf("\n[%s] %s\ninput:    %s\nexpected: %s\nmodel:    %s%s\n",
               item->domain, item->id, item->input, expected, generated,
               closed ? " <END>" : " <FORCED-STOP>");
    }
    ++result->count;
    result->closed += closed;
    if (closed && strcmp(generated, expected) == 0) ++result->exact_chunk;
}

static int write_json(const char *path, const char *model_path,
                      const DomainResult *results, int result_count)
{
    FILE *file = fopen(path, "w");
    int index;
    if (file == NULL) return -1;
    fprintf(file,
            "{\n  \"schema\": \"zero.faculty_eval.v1\",\n"
            "  \"model\": \"%s\",\n  \"domains\": {\n",
            model_path);
    for (index = 0; index < result_count; ++index) {
        const DomainResult *result = &results[index];
        fprintf(file,
                "    \"%s\": {\"cases\": %d, \"closed\": %d, "
                "\"syntax\": %d, \"exact_artifact\": %d, "
                "\"verified_artifact\": %d, \"committed\": %d, "
                "\"natural_artifact_close\": %d, "
                "\"exact_chunk\": %d, \"target_bits\": %.8f}%s\n",
                result->id, result->count, result->closed, result->syntax,
                result->exact_artifact, result->verified_artifact,
                result->committed, result->natural_artifact_close,
                result->exact_chunk,
                result->count ? result->bits / result->count : 0.0,
                index + 1 == result_count ? "" : ",");
    }
    fprintf(file, "  }\n}\n");
    return fclose(file) == 0 ? 0 : -1;
}

int main(int argc, char **argv)
{
    EvalCase cases[MAX_CASES];
    DomainResult results[] = {
        {"quantity", 0, 0, 0, 0, 0, 0, 0, 0, 0.0},
        {"geometry", 0, 0, 0, 0, 0, 0, 0, 0, 0.0},
        {"art", 0, 0, 0, 0, 0, 0, 0, 0, 0.0}
    };
    unsigned char *model_data;
    size_t model_length;
    int case_count = 0;
    int domain_seen[3] = {0, 0, 0};
    int case_limit = EVAL_CASES_PER_DOMAIN;
    int sample_mode = 0;
    int constrained_quantity = 0;
    int quantity_only = 0;
    int result_count = 3;
    const char *output_path = NULL;
    int index;
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        return run_self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    if (argc == 5 &&
        (strcmp(argv[3], "--quantity-json") == 0 ||
         strcmp(argv[3], "--quantity-samples") == 0 ||
         strcmp(argv[3], "--quantity-constrained-json") == 0 ||
         strcmp(argv[3], "--quantity-constrained-samples") == 0)) {
        quantity_only = 1;
        constrained_quantity =
            strstr(argv[3], "-constrained-") != NULL;
        result_count = 1;
        output_path = argv[4];
        case_limit = MAX_CASES;
        if (strstr(argv[3], "-samples") != NULL) {
            char *end = NULL;
            long requested = strtol(argv[4], &end, 10);
            if (end == argv[4] || *end != '\0' || requested < 1 ||
                requested > 100) {
                fprintf(stderr, "error: quantity samples must be between 1 and 100\n");
                return EXIT_FAILURE;
            }
            case_limit = (int)requested;
            sample_mode = 1;
        }
        if (read_tsv(argv[2], cases, &case_count) != 0) return EXIT_FAILURE;
    } else if (argc != 7 ||
               (strcmp(argv[5], "--json") != 0 &&
                strcmp(argv[5], "--samples") != 0)) {
        fprintf(stderr,
                "usage: %s MODEL Q.tsv G.tsv A.tsv --json OUTPUT\n"
                "       %s MODEL Q.tsv G.tsv A.tsv --samples N\n"
                "       %s MODEL Q.tsv --quantity-json OUTPUT\n"
                "       %s MODEL Q.tsv --quantity-samples N\n"
                "       %s MODEL Q.tsv --quantity-constrained-json OUTPUT\n"
                "       %s MODEL Q.tsv --quantity-constrained-samples N\n",
                argv[0], argv[0], argv[0], argv[0], argv[0], argv[0]);
        return EXIT_FAILURE;
    } else if (strcmp(argv[5], "--samples") == 0) {
        char *end = NULL;
        long requested = strtol(argv[6], &end, 10);
        if (end == argv[6] || *end != '\0' || requested < 1 ||
            requested > EVAL_CASES_PER_DOMAIN) {
            fprintf(stderr, "error: samples must be between 1 and %d\n",
                    EVAL_CASES_PER_DOMAIN);
            return EXIT_FAILURE;
        }
        case_limit = (int)requested;
        sample_mode = 1;
    }
    if (!quantity_only) {
        output_path = argv[6];
        for (index = 2; index <= 4; ++index) {
            if (read_tsv(argv[index], cases, &case_count) != 0) {
                return EXIT_FAILURE;
            }
        }
    }
    model_data = read_binary(argv[1], &model_length);
    if (model_data == NULL || model_length > INT_MAX ||
        lm_load(model_data, (int)model_length) != 0) {
        free(model_data);
        fprintf(stderr, "error: cannot load inference model\n");
        return EXIT_FAILURE;
    }
    for (index = 0; index < case_count; ++index) {
        int domain;
        for (domain = 0; domain < 3; ++domain) {
            if (strcmp(cases[index].domain, results[domain].id) == 0) break;
        }
        if (domain == 3) {
            free(model_data);
            fprintf(stderr, "error: unknown domain %s\n", cases[index].domain);
            return EXIT_FAILURE;
        }
        if (domain_seen[domain] >= case_limit) continue;
        ++domain_seen[domain];
        evaluate_case(&cases[index], &results[domain], sample_mode,
                      constrained_quantity);
    }
    for (index = 0; index < result_count; ++index) {
        const DomainResult *result = &results[index];
        printf("%-8s exact %4d/%4d  verified %4d/%4d  syntax %4d/%4d  "
               "close %4d/%4d  bits %.4f\n",
               result->id, result->exact_artifact, result->count,
               result->verified_artifact, result->count,
               result->syntax, result->count, result->closed, result->count,
               result->bits / result->count);
    }
    if (!sample_mode &&
        write_json(output_path, argv[1], results, result_count) != 0) {
        free(model_data);
        fprintf(stderr, "error: cannot write %s\n", output_path);
        return EXIT_FAILURE;
    }
    free(model_data);
    return EXIT_SUCCESS;
}
