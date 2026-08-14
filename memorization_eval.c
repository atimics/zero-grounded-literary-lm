#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "literary_infer.h"

#define MAX_SOURCES 16
#define MAX_SAMPLES 64

typedef struct {
    const char *id;
    const char *path;
    int blocking;
} Source;

typedef struct {
    size_t tokens;
    int max_exact_prefix;
    int full_exact_continuations;
    int warning_samples;
    double generated_aligned_accuracy;
    double teacher_top1_accuracy;
    double teacher_nll;
    size_t offsets[MAX_SAMPLES];
    int exact_prefixes[MAX_SAMPLES];
} Result;

_Noreturn static void fail(const char *message, const char *detail)
{
    fprintf(stderr, "error: %s%s%s\n", message, detail ? ": " : "",
            detail ? detail : "");
    exit(EXIT_FAILURE);
}

static long parse_positive(const char *name, const char *value)
{
    char *end = NULL;
    long parsed;
    errno = 0;
    parsed = strtol(value, &end, 10);
    if (errno != 0 || end == value || *end != '\0' || parsed <= 0) {
        fail("invalid positive integer", name);
    }
    return parsed;
}

static unsigned char *read_bytes(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) {
        if (file != NULL) fclose(file);
        fail("cannot open input", path);
    }
    data = malloc((size_t)size + 1);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size) {
        free(data);
        fclose(file);
        fail("cannot read input", path);
    }
    if (fclose(file) != 0) {
        free(data);
        fail("cannot close input", path);
    }
    *length = (size_t)size;
    return data;
}

static uint16_t *read_tokens(const char *path, size_t *length)
{
    size_t bytes;
    size_t index;
    unsigned char *raw = read_bytes(path, &bytes);
    uint16_t *tokens;
    if (bytes == 0 || bytes % 2 != 0) {
        free(raw);
        fail("token stream must contain little-endian uint16 values", path);
    }
    *length = bytes / 2;
    tokens = malloc(*length * sizeof(*tokens));
    if (tokens == NULL) {
        free(raw);
        fail("out of memory", path);
    }
    for (index = 0; index < *length; ++index) {
        tokens[index] = (uint16_t)(raw[index * 2] |
                                   ((uint16_t)raw[index * 2 + 1] << 8));
    }
    free(raw);
    return tokens;
}

static uint32_t little_u32(const unsigned char *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static int greedy_token(int vocab)
{
    int token;
    int best = 0;
    float best_probability = lm_probability(0);
    for (token = 1; token < vocab; ++token) {
        float probability = lm_probability(token);
        if (probability > best_probability) {
            best = token;
            best_probability = probability;
        }
    }
    return best;
}

static void feed_range(const uint16_t *tokens, size_t start, int length,
                       int vocab, const char *path)
{
    int index;
    for (index = 0; index < length; ++index) {
        int token = tokens[start + (size_t)index];
        if (token >= vocab || lm_feed(token) != 0) {
            fail("token outside model vocabulary", path);
        }
    }
}

static Result evaluate_source(const Source *source, int samples, int prompt,
                              int continuation, int warning_prefix,
                              int vocab)
{
    Result result = {0};
    uint16_t *tokens = read_tokens(source->path, &result.tokens);
    size_t span;
    long generated_matches = 0;
    long teacher_matches = 0;
    double teacher_nll = 0.0;
    int sample;
    if (result.tokens <= (size_t)(prompt + continuation)) {
        free(tokens);
        fail("token stream is shorter than the evaluation window", source->path);
    }
    span = result.tokens - (size_t)prompt - (size_t)continuation;
    for (sample = 0; sample < samples; ++sample) {
        size_t start = (size_t)(((uint64_t)(sample + 1) * (span + 1)) /
                                (uint64_t)(samples + 1));
        int exact_prefix = 0;
        int prefix_open = 1;
        int index;
        result.offsets[sample] = start;

        lm_reset();
        feed_range(tokens, start, prompt, vocab, source->path);
        for (index = 0; index < continuation; ++index) {
            int predicted = greedy_token(vocab);
            int expected = tokens[start + (size_t)prompt + (size_t)index];
            if (predicted == expected) {
                ++generated_matches;
                if (prefix_open) ++exact_prefix;
            } else {
                prefix_open = 0;
            }
            if (lm_feed(predicted) != 0) {
                free(tokens);
                fail("model rejected generated token", source->path);
            }
        }
        result.exact_prefixes[sample] = exact_prefix;
        if (exact_prefix > result.max_exact_prefix) {
            result.max_exact_prefix = exact_prefix;
        }
        if (exact_prefix == continuation) ++result.full_exact_continuations;
        if (exact_prefix >= warning_prefix) ++result.warning_samples;

        lm_reset();
        feed_range(tokens, start, prompt, vocab, source->path);
        for (index = 0; index < continuation; ++index) {
            int expected = tokens[start + (size_t)prompt + (size_t)index];
            float probability;
            if (greedy_token(vocab) == expected) ++teacher_matches;
            probability = lm_probability(expected);
            teacher_nll -= log(probability > 1e-30f ? probability : 1e-30f);
            if (lm_feed(expected) != 0) {
                free(tokens);
                fail("model rejected source token", source->path);
            }
        }
    }
    result.generated_aligned_accuracy =
        (double)generated_matches / (samples * continuation);
    result.teacher_top1_accuracy =
        (double)teacher_matches / (samples * continuation);
    result.teacher_nll = teacher_nll / (samples * continuation);
    free(tokens);
    return result;
}

static void print_json_string(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    putchar('"');
    while (*cursor != '\0') {
        unsigned char value = *cursor++;
        if (value == '"' || value == '\\') {
            putchar('\\');
            putchar(value);
        } else if (value == '\n') {
            fputs("\\n", stdout);
        } else if (value == '\r') {
            fputs("\\r", stdout);
        } else if (value == '\t') {
            fputs("\\t", stdout);
        } else if (value < 32) {
            printf("\\u%04x", value);
        } else {
            putchar(value);
        }
    }
    putchar('"');
}

static void usage(const char *program)
{
    fprintf(stderr,
            "usage: %s MODEL --source ID TOKENS "
            "[--informational-source ID TOKENS ...] "
            "[--samples N] [--prompt N] [--continuation N] "
            "[--warning-prefix N] [--block-prefix N]\n",
            program);
}

int main(int argc, char **argv)
{
    Source sources[MAX_SOURCES];
    Result results[MAX_SOURCES];
    int source_count = 0;
    int samples = 16;
    int prompt = 128;
    int continuation = 64;
    int warning_prefix = 32;
    int block_prefix = 64;
    size_t model_length;
    unsigned char *model;
    int vocab;
    int blocked = 0;
    int index;
    if (argc < 5) {
        usage(argv[0]);
        return EXIT_FAILURE;
    }
    for (index = 2; index < argc; ++index) {
        if ((strcmp(argv[index], "--source") == 0 ||
             strcmp(argv[index], "--informational-source") == 0) &&
            index + 2 < argc) {
            int blocking = strcmp(argv[index], "--source") == 0;
            if (source_count == MAX_SOURCES) fail("too many sources", NULL);
            sources[source_count].id = argv[++index];
            sources[source_count].path = argv[++index];
            sources[source_count].blocking = blocking;
            ++source_count;
        } else if (strcmp(argv[index], "--samples") == 0 && index + 1 < argc) {
            samples = (int)parse_positive("--samples", argv[++index]);
        } else if (strcmp(argv[index], "--prompt") == 0 && index + 1 < argc) {
            prompt = (int)parse_positive("--prompt", argv[++index]);
        } else if (strcmp(argv[index], "--continuation") == 0 && index + 1 < argc) {
            continuation =
                (int)parse_positive("--continuation", argv[++index]);
        } else if (strcmp(argv[index], "--warning-prefix") == 0 && index + 1 < argc) {
            warning_prefix =
                (int)parse_positive("--warning-prefix", argv[++index]);
        } else if (strcmp(argv[index], "--block-prefix") == 0 && index + 1 < argc) {
            block_prefix =
                (int)parse_positive("--block-prefix", argv[++index]);
        } else {
            usage(argv[0]);
            return EXIT_FAILURE;
        }
    }
    if (source_count == 0 || samples > MAX_SAMPLES ||
        warning_prefix > continuation || block_prefix > continuation ||
        warning_prefix > block_prefix) {
        fail("invalid evaluation configuration", NULL);
    }
    model = read_bytes(argv[1], &model_length);
    if (model_length > INT32_MAX || lm_load(model, (int)model_length) != 0) {
        free(model);
        fail("invalid model", argv[1]);
    }
    if (model_length < 16) {
        free(model);
        fail("model header is truncated", argv[1]);
    }
    vocab = (int)little_u32(model + 12);
    if (vocab < 2 || vocab > 2048) {
        free(model);
        fail("invalid model vocabulary", argv[1]);
    }
    for (index = 0; index < source_count; ++index) {
        results[index] = evaluate_source(&sources[index], samples, prompt,
                                         continuation, warning_prefix, vocab);
        if (sources[index].blocking &&
            results[index].max_exact_prefix >= block_prefix) {
            blocked = 1;
        }
    }

    printf("{\n  \"schema\": \"zero.memorization_raw.v1\",\n");
    printf("  \"decision\": \"%s\",\n", blocked ? "block" : "pass");
    printf("  \"model\": {\"parameters\": %d, \"context\": %d, "
           "\"update\": %d, \"vocab\": %d},\n",
           lm_get_parameters(), lm_get_context(), lm_get_update(), vocab);
    printf("  \"settings\": {\"samples_per_source\": %d, "
           "\"prompt_tokens\": %d, \"continuation_tokens\": %d, "
           "\"warning_exact_prefix\": %d, \"block_exact_prefix\": %d, "
           "\"sampling\": \"evenly-stratified deterministic offsets\"},\n",
           samples, prompt, continuation, warning_prefix, block_prefix);
    printf("  \"sources\": [\n");
    for (index = 0; index < source_count; ++index) {
        int sample;
        Result *result = &results[index];
        printf("    {\"id\": ");
        print_json_string(sources[index].id);
        printf(", \"path\": ");
        print_json_string(sources[index].path);
        printf(", \"blocking\": %s, \"tokens\": %zu, "
               "\"max_exact_prefix\": %d, "
               "\"full_exact_continuations\": %d, "
               "\"warning_samples\": %d, "
               "\"generated_aligned_accuracy\": %.9f, "
               "\"teacher_forced_top1_accuracy\": %.9f, "
               "\"teacher_forced_nll\": %.9f, \"sample_offsets\": [",
               sources[index].blocking ? "true" : "false",
               result->tokens, result->max_exact_prefix,
               result->full_exact_continuations, result->warning_samples,
               result->generated_aligned_accuracy,
               result->teacher_top1_accuracy, result->teacher_nll);
        for (sample = 0; sample < samples; ++sample) {
            printf("%s%zu", sample ? ", " : "", result->offsets[sample]);
        }
        printf("], \"exact_prefixes\": [");
        for (sample = 0; sample < samples; ++sample) {
            printf("%s%d", sample ? ", " : "",
                   result->exact_prefixes[sample]);
        }
        printf("]}%s\n", index + 1 == source_count ? "" : ",");
    }
    printf("  ]\n}\n");
    free(model);
    return blocked ? 2 : EXIT_SUCCESS;
}
