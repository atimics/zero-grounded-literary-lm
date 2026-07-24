#include "literary_infer.h"

#include <errno.h>
#include <float.h>
#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
    MAX_LINE = 16384,
    MAX_FIELDS = 10,
    MAX_CHOICES = 4,
    MAX_JOBS = 32
};

typedef struct {
    double bits;
    int bytes;
    int greedy_exact;
} Score;

static void usage(const char *program)
{
    fprintf(stderr,
            "usage: %s MODEL CASES.tsv --jsonl OUTPUT "
            "[--shard-index I --shard-count N] [--limit N]\n",
            program);
}

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
    if (data == NULL ||
        fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) {
        free(data);
        return NULL;
    }
    *length = (size_t)size;
    return data;
}

static int parse_integer(const char *text, int minimum, int maximum, int *value)
{
    char *end;
    long parsed;
    errno = 0;
    parsed = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' ||
        parsed < minimum || parsed > maximum) {
        return 0;
    }
    *value = (int)parsed;
    return 1;
}

static void strip_line_end(char *line)
{
    size_t length = strlen(line);
    while (length > 0 &&
           (line[length - 1] == '\n' || line[length - 1] == '\r')) {
        line[--length] = '\0';
    }
}

static int split_tsv(char *line, char **fields)
{
    int count = 1;
    char *cursor;
    fields[0] = line;
    for (cursor = line; *cursor != '\0'; ++cursor) {
        if (*cursor == '\t') {
            if (count >= MAX_FIELDS) return 0;
            *cursor = '\0';
            fields[count++] = cursor + 1;
        }
    }
    return count;
}

static void feed_text(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    while (*cursor != '\0') {
        int token = *cursor < 128 ? *cursor : '?';
        if (lm_feed(token) != 0) {
            fprintf(stderr, "model rejected input token\n");
            exit(EXIT_FAILURE);
        }
        ++cursor;
    }
}

static Score score_continuation(const char *context, const char *continuation,
                                int check_greedy)
{
    const unsigned char *cursor = (const unsigned char *)continuation;
    Score score = {0};
    score.greedy_exact = check_greedy;
    lm_reset();
    feed_text("\n");
    feed_text(context);
    while (*cursor != '\0') {
        int token = *cursor < 128 ? *cursor : '?';
        float probability = lm_probability(token);
        if (probability <= 0.0f) probability = FLT_MIN;
        score.bits -= log2((double)probability);
        if (check_greedy && lm_sample(0.0f, 0, 1.0f) != token) {
            score.greedy_exact = 0;
        }
        if (lm_feed(token) != 0) {
            fprintf(stderr, "model rejected continuation token\n");
            exit(EXIT_FAILURE);
        }
        ++cursor;
        ++score.bytes;
    }
    if (score.bytes == 0) {
        fprintf(stderr, "empty continuation is not scoreable\n");
        exit(EXIT_FAILURE);
    }
    return score;
}

static void json_string(FILE *file, const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    fputc('"', file);
    while (*cursor != '\0') {
        unsigned char value = *cursor++;
        if (value == '"' || value == '\\') {
            fputc('\\', file);
            fputc(value, file);
        } else if (value >= 32 && value < 127) {
            fputc(value, file);
        } else {
            fprintf(file, "\\u%04x", value);
        }
    }
    fputc('"', file);
}

static int choice_count_for(const char *kind)
{
    if (strcmp(kind, "pair") == 0) return 2;
    if (strcmp(kind, "multiple_choice") == 0) return 4;
    if (strcmp(kind, "cloze") == 0 || strcmp(kind, "rolling") == 0) return 1;
    return 0;
}

static int evaluate_line(FILE *output, char **fields, int ordinal)
{
    const char *id = fields[0];
    const char *benchmark = fields[1];
    const char *group = fields[2];
    const char *kind = fields[3];
    const char *context = fields[5];
    int gold;
    int choices = choice_count_for(kind);
    int raw_prediction = 0;
    int normalized_prediction = 0;
    Score scores[MAX_CHOICES];
    int index;
    if (!parse_integer(fields[4], 0, MAX_CHOICES - 1, &gold) ||
        choices == 0 || gold >= choices) {
        return 0;
    }
    for (index = 0; index < choices; ++index) {
        scores[index] = score_continuation(
            context, fields[6 + index], strcmp(kind, "cloze") == 0);
        if (index > 0) {
            if (scores[index].bits < scores[raw_prediction].bits) {
                raw_prediction = index;
            }
            if (scores[index].bits / scores[index].bytes <
                scores[normalized_prediction].bits /
                    scores[normalized_prediction].bytes) {
                normalized_prediction = index;
            }
        }
    }
    fprintf(output, "{\"schema\":\"zero.external_eval_case_result.v1\",");
    fprintf(output, "\"ordinal\":%d,\"id\":", ordinal);
    json_string(output, id);
    fprintf(output, ",\"benchmark\":");
    json_string(output, benchmark);
    fprintf(output, ",\"group\":");
    json_string(output, group);
    fprintf(output, ",\"kind\":");
    json_string(output, kind);
    fprintf(output,
            ",\"gold\":%d,\"raw_prediction\":%d,"
            "\"normalized_prediction\":%d,\"scores\":[",
            gold, raw_prediction, normalized_prediction);
    for (index = 0; index < choices; ++index) {
        if (index != 0) fputc(',', output);
        fprintf(output,
                "{\"bits\":%.12f,\"bytes\":%d,\"greedy_exact\":%s}",
                scores[index].bits, scores[index].bytes,
                scores[index].greedy_exact ? "true" : "false");
    }
    fprintf(output, "]}\n");
    return !ferror(output);
}

int main(int argc, char **argv)
{
    static const char *header =
        "id\tbenchmark\tgroup\tkind\tgold\tcontext\tchoice0\tchoice1\tchoice2\tchoice3";
    const char *model_path;
    const char *cases_path;
    const char *output_path;
    unsigned char *model_data;
    size_t model_length;
    FILE *cases;
    FILE *output;
    char line[MAX_LINE];
    int line_number = 0;
    int ordinal = 0;
    int evaluated = 0;
    int shard_index = 0;
    int shard_count = 1;
    int limit = INT_MAX;
    int index;

    if (argc < 5 || strcmp(argv[3], "--jsonl") != 0) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }
    model_path = argv[1];
    cases_path = argv[2];
    output_path = argv[4];
    for (index = 5; index < argc; index += 2) {
        if (index + 1 >= argc) {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
        if (strcmp(argv[index], "--shard-index") == 0) {
            if (!parse_integer(argv[index + 1], 0, MAX_JOBS - 1,
                               &shard_index)) {
                usage(argv[0]);
                return EXIT_FAILURE;
            }
        } else if (strcmp(argv[index], "--shard-count") == 0) {
            if (!parse_integer(argv[index + 1], 1, MAX_JOBS, &shard_count)) {
                usage(argv[0]);
                return EXIT_FAILURE;
            }
        } else if (strcmp(argv[index], "--limit") == 0) {
            if (!parse_integer(argv[index + 1], 1, INT_MAX, &limit)) {
                usage(argv[0]);
                return EXIT_FAILURE;
            }
        } else {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
    }
    if (shard_index >= shard_count) {
        fprintf(stderr, "shard index must be below shard count\n");
        return EXIT_FAILURE;
    }

    model_data = read_binary(model_path, &model_length);
    if (model_data == NULL || model_length > INT_MAX ||
        lm_load(model_data, (int)model_length) != 0) {
        free(model_data);
        fprintf(stderr, "cannot load model %s\n", model_path);
        return EXIT_FAILURE;
    }
    cases = fopen(cases_path, "rb");
    output = fopen(output_path, "wb");
    if (cases == NULL || output == NULL) {
        if (cases != NULL) fclose(cases);
        if (output != NULL) fclose(output);
        free(model_data);
        fprintf(stderr, "cannot open cases or output\n");
        return EXIT_FAILURE;
    }
    while (fgets(line, sizeof(line), cases) != NULL) {
        char *fields[MAX_FIELDS];
        int field_count;
        ++line_number;
        if (strchr(line, '\n') == NULL && !feof(cases)) {
            fprintf(stderr, "%s:%d exceeds %d bytes\n",
                    cases_path, line_number, MAX_LINE - 1);
            goto failure;
        }
        strip_line_end(line);
        if (line_number == 1) {
            if (strcmp(line, header) != 0) {
                fprintf(stderr, "%s has an unexpected header\n", cases_path);
                goto failure;
            }
            continue;
        }
        if (ordinal >= limit) break;
        field_count = split_tsv(line, fields);
        if (field_count != MAX_FIELDS) {
            fprintf(stderr, "%s:%d expected %d fields, found %d\n",
                    cases_path, line_number, MAX_FIELDS, field_count);
            goto failure;
        }
        if (ordinal % shard_count == shard_index) {
            if (!evaluate_line(output, fields, ordinal)) {
                fprintf(stderr, "%s:%d is invalid\n", cases_path, line_number);
                goto failure;
            }
            ++evaluated;
        }
        ++ordinal;
    }
    if (ferror(cases) || fclose(cases) != 0 || fclose(output) != 0) {
        free(model_data);
        return EXIT_FAILURE;
    }
    free(model_data);
    fprintf(stderr, "evaluated %d/%d cases from %s on shard %d/%d\n",
            evaluated, ordinal, cases_path, shard_index, shard_count);
    return EXIT_SUCCESS;

failure:
    fclose(cases);
    fclose(output);
    remove(output_path);
    free(model_data);
    return EXIT_FAILURE;
}
