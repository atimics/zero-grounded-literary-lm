#include "channel_protocol.h"
#include "literary_infer.h"

#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_CASES 256
#define MAX_HOLO_CASES 256
#define MAX_LINE 8192
#define MAX_FIELDS 16
#define MAX_TEXT 1024
#define MIN_PROBABILITY 1.0e-12f

typedef struct {
    char id[64];
    char task[64];
    char style[8];
    char vibe[MAX_TEXT];
    char memory[MAX_TEXT];
    char echo[MAX_TEXT];
    char prior_user[MAX_TEXT];
    char prior_zero[MAX_TEXT];
    char prompt[MAX_TEXT];
    char positive[MAX_TEXT];
    char negative[MAX_TEXT];
    char authority[64];
} EvalCase;

typedef struct {
    char id[64];
    char family[64];
    char key[3][MAX_TEXT];
    char query[MAX_TEXT];
    int expected;
    float threshold;
} HoloCase;

typedef struct {
    double positive_bits;
    double negative_bits;
    double margin_bits;
    int win;
} CaseResult;

typedef struct {
    int recalled_slot;
    float score;
    int pass;
} HoloResult;

typedef struct {
    const char *id;
    int holo_mode;
    int use_summary;
    int use_echo;
    int score_memory;
} EvalMode;

static const EvalMode EVAL_MODES[] = {
    {"transcript", LM_HOLO_DISABLED, 0, 0, 0},
    {"recurrent", LM_HOLO_DISABLED, 1, 0, 1},
    {"flat", LM_HOLO_FLAT, 1, 1, 1},
    {"partitioned", LM_HOLO_PARTITIONED, 1, 1, 1}
};

static void usage(const char *program)
{
    fprintf(stderr,
            "usage: %s MODEL CASES HOLO --json OUTPUT\n"
            "       %s --self-test\n",
            program, program);
}

static int copy_field(char *destination, size_t size, const char *source,
                      const char *label, int line_number)
{
    size_t length = strlen(source);
    if (length >= size) {
        fprintf(stderr, "line %d: %s exceeds %zu bytes\n",
                line_number, label, size - 1);
        return -1;
    }
    memcpy(destination, source, length + 1);
    return 0;
}

static int split_tsv(char *line, char **fields, int maximum)
{
    int count = 0;
    char *cursor = line;

    while (count < maximum) {
        char *tab;
        fields[count++] = cursor;
        tab = strchr(cursor, '\t');
        if (tab == NULL) break;
        *tab = '\0';
        cursor = tab + 1;
    }
    return count;
}

static void strip_line_end(char *line)
{
    size_t length = strlen(line);
    while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r')) {
        line[--length] = '\0';
    }
}

static int read_cases(const char *path, EvalCase *cases, int *case_count)
{
    static const char *header =
        "id\ttask\tstyle\tvibe\tmemory\techo\tprior_user\tprior_zero\tprompt\tpositive\tnegative\tauthority";
    FILE *file = fopen(path, "rb");
    char line[MAX_LINE];
    int count = 0;
    int line_number = 0;

    if (file == NULL) {
        fprintf(stderr, "cannot open %s: %s\n", path, strerror(errno));
        return -1;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        char *fields[MAX_FIELDS];
        int field_count;
        EvalCase *item;
        line_number++;
        if (strchr(line, '\n') == NULL && !feof(file)) {
            fprintf(stderr, "%s:%d: line exceeds %d bytes\n", path, line_number, MAX_LINE - 1);
            fclose(file);
            return -1;
        }
        strip_line_end(line);
        if (line_number == 1) {
            if (strcmp(line, header) != 0) {
                fprintf(stderr, "%s: unexpected header\n", path);
                fclose(file);
                return -1;
            }
            continue;
        }
        if (line[0] == '\0') continue;
        if (count >= MAX_CASES) {
            fprintf(stderr, "%s: too many cases (maximum %d)\n", path, MAX_CASES);
            fclose(file);
            return -1;
        }
        field_count = split_tsv(line, fields, MAX_FIELDS);
        if (field_count != 12) {
            fprintf(stderr, "%s:%d: expected 12 fields, found %d\n",
                    path, line_number, field_count);
            fclose(file);
            return -1;
        }
        item = &cases[count];
        if (copy_field(item->id, sizeof(item->id), fields[0], "id", line_number) != 0 ||
            copy_field(item->task, sizeof(item->task), fields[1], "task", line_number) != 0 ||
            copy_field(item->style, sizeof(item->style), fields[2], "style", line_number) != 0 ||
            copy_field(item->vibe, sizeof(item->vibe), fields[3], "vibe", line_number) != 0 ||
            copy_field(item->memory, sizeof(item->memory), fields[4], "memory", line_number) != 0 ||
            copy_field(item->echo, sizeof(item->echo), fields[5], "echo", line_number) != 0 ||
            copy_field(item->prior_user, sizeof(item->prior_user), fields[6], "prior_user", line_number) != 0 ||
            copy_field(item->prior_zero, sizeof(item->prior_zero), fields[7], "prior_zero", line_number) != 0 ||
            copy_field(item->prompt, sizeof(item->prompt), fields[8], "prompt", line_number) != 0 ||
            copy_field(item->positive, sizeof(item->positive), fields[9], "positive", line_number) != 0 ||
            copy_field(item->negative, sizeof(item->negative), fields[10], "negative", line_number) != 0 ||
            copy_field(item->authority, sizeof(item->authority), fields[11], "authority", line_number) != 0) {
            fclose(file);
            return -1;
        }
        if (item->style[0] == '\0' || item->style[1] != '\0' ||
            item->positive[0] == '\0' || item->negative[0] == '\0') {
            fprintf(stderr, "%s:%d: style and contrast targets are required\n", path, line_number);
            fclose(file);
            return -1;
        }
        count++;
    }
    fclose(file);
    if (count == 0) {
        fprintf(stderr, "%s: no cases\n", path);
        return -1;
    }
    *case_count = count;
    return 0;
}

static int read_holo_cases(const char *path, HoloCase *cases, int *case_count)
{
    static const char *header = "id\tfamily\tkey0\tkey1\tkey2\tquery\texpected\tthreshold";
    FILE *file = fopen(path, "rb");
    char line[MAX_LINE];
    int count = 0;
    int line_number = 0;

    if (file == NULL) {
        fprintf(stderr, "cannot open %s: %s\n", path, strerror(errno));
        return -1;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        char *fields[MAX_FIELDS];
        char *end;
        int field_count;
        HoloCase *item;
        line_number++;
        strip_line_end(line);
        if (line_number == 1) {
            if (strcmp(line, header) != 0) {
                fprintf(stderr, "%s: unexpected header\n", path);
                fclose(file);
                return -1;
            }
            continue;
        }
        if (line[0] == '\0') continue;
        if (count >= MAX_HOLO_CASES) {
            fprintf(stderr, "%s: too many Holo cases (maximum %d)\n", path, MAX_HOLO_CASES);
            fclose(file);
            return -1;
        }
        field_count = split_tsv(line, fields, MAX_FIELDS);
        if (field_count != 8) {
            fprintf(stderr, "%s:%d: expected 8 fields, found %d\n",
                    path, line_number, field_count);
            fclose(file);
            return -1;
        }
        item = &cases[count];
        if (copy_field(item->id, sizeof(item->id), fields[0], "id", line_number) != 0 ||
            copy_field(item->family, sizeof(item->family), fields[1], "family", line_number) != 0 ||
            copy_field(item->key[0], sizeof(item->key[0]), fields[2], "key0", line_number) != 0 ||
            copy_field(item->key[1], sizeof(item->key[1]), fields[3], "key1", line_number) != 0 ||
            copy_field(item->key[2], sizeof(item->key[2]), fields[4], "key2", line_number) != 0 ||
            copy_field(item->query, sizeof(item->query), fields[5], "query", line_number) != 0) {
            fclose(file);
            return -1;
        }
        item->expected = (int)strtol(fields[6], &end, 10);
        if (*fields[6] == '\0' || *end != '\0' || item->expected < -1 || item->expected > 2) {
            fprintf(stderr, "%s:%d: invalid expected index\n", path, line_number);
            fclose(file);
            return -1;
        }
        item->threshold = strtof(fields[7], &end);
        if (*fields[7] == '\0' || *end != '\0' || item->threshold < 0.0f || item->threshold > 1.0f) {
            fprintf(stderr, "%s:%d: invalid threshold\n", path, line_number);
            fclose(file);
            return -1;
        }
        count++;
    }
    fclose(file);
    if (count == 0) {
        fprintf(stderr, "%s: no Holo cases\n", path);
        return -1;
    }
    *case_count = count;
    return 0;
}

static unsigned char *read_binary(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size;

    if (file == NULL) {
        fprintf(stderr, "cannot open %s: %s\n", path, strerror(errno));
        return NULL;
    }
    if (fseek(file, 0, SEEK_END) != 0 || (size = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0) {
        fprintf(stderr, "cannot size %s\n", path);
        fclose(file);
        return NULL;
    }
    data = (unsigned char *)malloc((size_t)size == 0 ? 1 : (size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size) {
        fprintf(stderr, "cannot read %s\n", path);
        free(data);
        fclose(file);
        return NULL;
    }
    fclose(file);
    *length = (size_t)size;
    return data;
}

static uint64_t fnv1a64(const unsigned char *data, size_t length)
{
    uint64_t hash = UINT64_C(14695981039346656037);
    size_t index;
    for (index = 0; index < length; index++) {
        hash ^= data[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static int fnv_file(const char *path, uint64_t *hash)
{
    unsigned char buffer[32768];
    FILE *file = fopen(path, "rb");
    uint64_t value = UINT64_C(14695981039346656037);
    size_t count;
    size_t index;

    if (file == NULL) return -1;
    while ((count = fread(buffer, 1, sizeof(buffer), file)) > 0) {
        for (index = 0; index < count; index++) {
            value ^= buffer[index];
            value *= UINT64_C(1099511628211);
        }
    }
    if (ferror(file)) {
        fclose(file);
        return -1;
    }
    fclose(file);
    *hash = value;
    return 0;
}

static void feed_byte(int token)
{
    lm_feed(token >= 0 && token < 128 ? token : '?');
}

static void feed_text(const char *text)
{
    const unsigned char *cursor = (const unsigned char *)text;
    while (*cursor != '\0') {
        feed_byte(*cursor < 128 ? *cursor : '?');
        cursor++;
    }
}

static const char *summary_for(const EvalCase *item, const EvalMode *mode)
{
    if (mode->use_summary && item->memory[0] != '\0') return item->memory;
    return item->vibe;
}

static void feed_context(const EvalCase *item, const EvalMode *mode)
{
    const char *summary = summary_for(item, mode);
    int memory_case = strncmp(item->task, "memory_", 7) == 0;

    lm_reset();
    feed_byte(CHANNEL_START_TOKEN);
    feed_byte((unsigned char)item->style[0]);
    feed_byte(CHANNEL_SUMMARY_TOKEN);
    feed_text(summary);
    if (mode->use_echo && item->echo[0] != '\0') {
        feed_text(" | ~");
        feed_text(item->echo);
    }
    feed_byte(CHANNEL_MESSAGE_END_TOKEN);

    if (item->prior_user[0] != '\0') {
        feed_byte(CHANNEL_MESSAGE_TOKEN);
        feed_byte('A');
        feed_text(item->prior_user);
        feed_byte(CHANNEL_MESSAGE_END_TOKEN);
    }
    if (item->prior_zero[0] != '\0') {
        feed_byte(CHANNEL_MESSAGE_TOKEN);
        feed_byte('Z');
        feed_byte(CHANNEL_REPLY_TOKEN);
        feed_byte('A');
        feed_text(item->prior_zero);
        feed_byte(CHANNEL_MESSAGE_END_TOKEN);
    }

    if (memory_case) {
        feed_byte(CHANNEL_SUMMARY_TOKEN);
        feed_byte(CHANNEL_TARGET_TOKEN);
    } else {
        feed_byte(CHANNEL_MESSAGE_TOKEN);
        feed_byte('A');
        feed_text(item->prompt);
        feed_byte(CHANNEL_MESSAGE_END_TOKEN);
        feed_byte(CHANNEL_MESSAGE_TOKEN);
        feed_byte('Z');
        feed_byte(CHANNEL_REPLY_TOKEN);
        feed_byte('A');
        feed_byte(CHANNEL_TARGET_TOKEN);
    }
}

static double score_target(const EvalCase *item, const EvalMode *mode,
                           const char *target)
{
    const unsigned char *cursor = (const unsigned char *)target;
    double bits = 0.0;
    int tokens = 0;

    feed_context(item, mode);
    while (*cursor != '\0') {
        int token = *cursor < 128 ? *cursor : '?';
        float probability = lm_probability(token);
        if (probability < MIN_PROBABILITY) probability = MIN_PROBABILITY;
        bits -= log2((double)probability);
        feed_byte(token);
        cursor++;
        tokens++;
    }
    {
        float probability = lm_probability(CHANNEL_MESSAGE_END_TOKEN);
        if (probability < MIN_PROBABILITY) probability = MIN_PROBABILITY;
        bits -= log2((double)probability);
        tokens++;
    }
    return bits / (double)tokens;
}

static HoloResult run_holo_case(const HoloCase *item, int mode)
{
    HoloResult result;
    int slots[3];
    int index;

    lm_holo_set_mode(mode);
    lm_holo_reset();
    for (index = 0; index < 3; index++) {
        slots[index] = lm_holo_remember((const unsigned char *)item->key[index],
                                        (int)strlen(item->key[index]));
    }
    result.recalled_slot = lm_holo_recall((const unsigned char *)item->query,
                                          (int)strlen(item->query));
    result.score = lm_holo_get_score();
    if (item->expected < 0) {
        result.pass = result.recalled_slot < 0 || result.score < item->threshold;
    } else {
        result.pass = slots[item->expected] >= 0 &&
                      result.recalled_slot == slots[item->expected] &&
                      result.score >= item->threshold;
    }
    return result;
}

static int holo_self_test_mode(int mode)
{
    static const unsigned char first[] = "the moonlit gate answers with a silver bell";
    static const unsigned char second[] = "the king wears a golden crown at morning court";
    static const unsigned char third[] = "winter rivers cross the dark forest";
    static const unsigned char query[] = "what answers at the gate beneath the moon";
    static const unsigned char unrelated[] = "database transaction isolation levels";
    int expected;
    int recalled;
    float relevant_score;
    float unrelated_score;

    if (lm_holo_set_mode(mode) != 0) return -1;
    lm_holo_reset();
    expected = lm_holo_remember(first, (int)sizeof(first) - 1);
    if (expected < 0 || lm_holo_remember(second, (int)sizeof(second) - 1) < 0 ||
        lm_holo_remember(third, (int)sizeof(third) - 1) < 0) return -1;
    recalled = lm_holo_recall(query, (int)sizeof(query) - 1);
    relevant_score = lm_holo_get_score();
    (void)lm_holo_recall(unrelated, (int)sizeof(unrelated) - 1);
    unrelated_score = lm_holo_get_score();
    return recalled == expected && relevant_score >= 0.22f && unrelated_score < 0.22f ? 0 : -1;
}

static int self_test(void)
{
    int flat = holo_self_test_mode(LM_HOLO_FLAT);
    int partitioned = holo_self_test_mode(LM_HOLO_PARTITIONED);
    printf("zero_eval self-test: flat=%s partitioned=%s\n",
           flat == 0 ? "ok" : "fail", partitioned == 0 ? "ok" : "fail");
    return flat == 0 && partitioned == 0 ? 0 : 1;
}

static int write_json(const char *path, const char *model_path,
                      const char *cases_path, const char *holo_path,
                      uint64_t model_hash, uint64_t cases_hash, uint64_t holo_hash,
                      const EvalCase *cases, int case_count,
                      const HoloCase *holo_cases, int holo_count,
                      CaseResult results[4][MAX_CASES],
                      HoloResult holo_results[4][MAX_HOLO_CASES])
{
    FILE *file = fopen(path, "wb");
    int mode_index;

    if (file == NULL) {
        fprintf(stderr, "cannot write %s: %s\n", path, strerror(errno));
        return -1;
    }
    fprintf(file,
            "{\n  \"schema\": \"zero.eval.result.v1\",\n"
            "  \"benchmark_id\": \"zero-channel-v1\",\n"
            "  \"model\": {\"path\": \"%s\", \"fnv1a64\": \"%016llx\", "
            "\"parameters\": %d, \"context\": %d, \"update\": %d},\n"
            "  \"inputs\": {\"cases_path\": \"%s\", \"cases_fnv1a64\": \"%016llx\", "
            "\"holo_path\": \"%s\", \"holo_fnv1a64\": \"%016llx\"},\n"
            "  \"modes\": [\n",
            model_path, (unsigned long long)model_hash, lm_get_parameters(),
            lm_get_context(), lm_get_update(), cases_path,
            (unsigned long long)cases_hash, holo_path, (unsigned long long)holo_hash);

    for (mode_index = 0; mode_index < 4; mode_index++) {
        const EvalMode *mode = &EVAL_MODES[mode_index];
        int scored = 0;
        int wins = 0;
        int ties = 0;
        int holo_scored = mode->holo_mode == LM_HOLO_DISABLED ? 0 : holo_count;
        int holo_hits = 0;
        double positive_sum = 0.0;
        double margin_sum = 0.0;
        int index;

        for (index = 0; index < case_count; index++) {
            if (!mode->score_memory && strncmp(cases[index].task, "memory_", 7) == 0) continue;
            scored++;
            positive_sum += results[mode_index][index].positive_bits;
            margin_sum += results[mode_index][index].margin_bits;
            if (results[mode_index][index].win > 0) wins++;
            if (results[mode_index][index].win == 0) ties++;
        }
        for (index = 0; index < holo_scored; index++) {
            if (holo_results[mode_index][index].pass) holo_hits++;
        }
        fprintf(file,
                "    {\n      \"id\": \"%s\", \"contrast_cases\": %d, \"wins\": %d, "
                "\"ties\": %d, \"win_rate\": %.8f, \"mean_positive_bits\": %.8f, "
                "\"mean_margin_bits\": %.8f, \"holo_cases\": %d, \"holo_hits\": %d, "
                "\"holo_rate\": %.8f,\n      \"cases\": [\n",
                mode->id, scored, wins, ties,
                scored > 0 ? (double)wins / (double)scored : 0.0,
                scored > 0 ? positive_sum / (double)scored : 0.0,
                scored > 0 ? margin_sum / (double)scored : 0.0,
                holo_scored, holo_hits,
                holo_scored > 0 ? (double)holo_hits / (double)holo_scored : 0.0);

        {
            int emitted = 0;
            for (index = 0; index < case_count; index++) {
                const CaseResult *result = &results[mode_index][index];
                if (!mode->score_memory && strncmp(cases[index].task, "memory_", 7) == 0) continue;
                if (emitted++) fprintf(file, ",\n");
                fprintf(file,
                        "        {\"id\": \"%s\", \"task\": \"%s\", "
                        "\"positive_bits\": %.8f, \"negative_bits\": %.8f, "
                        "\"margin_bits\": %.8f, \"win\": %d}",
                        cases[index].id, cases[index].task, result->positive_bits,
                        result->negative_bits, result->margin_bits, result->win);
            }
        }
        fprintf(file, "\n      ],\n      \"holo\": [\n");
        for (index = 0; index < holo_scored; index++) {
            const HoloResult *result = &holo_results[mode_index][index];
            if (index > 0) fprintf(file, ",\n");
            fprintf(file,
                    "        {\"id\": \"%s\", \"family\": \"%s\", \"expected\": %d, "
                    "\"recalled_slot\": %d, \"score\": %.8f, \"pass\": %s}",
                    holo_cases[index].id, holo_cases[index].family,
                    holo_cases[index].expected, result->recalled_slot,
                    result->score, result->pass ? "true" : "false");
        }
        fprintf(file, "\n      ]\n    }%s\n", mode_index == 3 ? "" : ",");
    }
    fprintf(file, "  ]\n}\n");
    if (fclose(file) != 0) {
        fprintf(stderr, "cannot finish %s\n", path);
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    EvalCase cases[MAX_CASES];
    HoloCase holo_cases[MAX_HOLO_CASES];
    CaseResult results[4][MAX_CASES];
    HoloResult holo_results[4][MAX_HOLO_CASES];
    const char *model_path;
    const char *cases_path;
    const char *holo_path;
    const char *json_path;
    unsigned char *model_data;
    size_t model_length;
    uint64_t model_hash;
    uint64_t cases_hash;
    uint64_t holo_hash;
    int case_count;
    int holo_count;
    int mode_index;

    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) return self_test();
    if (argc != 6 || strcmp(argv[4], "--json") != 0) {
        usage(argv[0]);
        return 2;
    }
    model_path = argv[1];
    cases_path = argv[2];
    holo_path = argv[3];
    json_path = argv[5];

    memset(results, 0, sizeof(results));
    memset(holo_results, 0, sizeof(holo_results));
    if (read_cases(cases_path, cases, &case_count) != 0 ||
        read_holo_cases(holo_path, holo_cases, &holo_count) != 0 ||
        fnv_file(cases_path, &cases_hash) != 0 || fnv_file(holo_path, &holo_hash) != 0) {
        return 1;
    }
    model_data = read_binary(model_path, &model_length);
    if (model_data == NULL) return 1;
    model_hash = fnv1a64(model_data, model_length);
    if (model_length > (size_t)INT32_MAX || lm_load(model_data, (int)model_length) != 0) {
        fprintf(stderr, "cannot load model %s\n", model_path);
        free(model_data);
        return 1;
    }

    for (mode_index = 0; mode_index < 4; mode_index++) {
        const EvalMode *mode = &EVAL_MODES[mode_index];
        int wins = 0;
        int scored = 0;
        int index;

        for (index = 0; index < case_count; index++) {
            CaseResult *result = &results[mode_index][index];
            if (!mode->score_memory && strncmp(cases[index].task, "memory_", 7) == 0) continue;
            result->positive_bits = score_target(&cases[index], mode, cases[index].positive);
            result->negative_bits = score_target(&cases[index], mode, cases[index].negative);
            result->margin_bits = result->negative_bits - result->positive_bits;
            result->win = result->margin_bits > 1.0e-8 ? 1 :
                          (result->margin_bits < -1.0e-8 ? -1 : 0);
            if (result->win > 0) wins++;
            scored++;
        }
        if (mode->holo_mode != LM_HOLO_DISABLED) {
            for (index = 0; index < holo_count; index++) {
                holo_results[mode_index][index] = run_holo_case(&holo_cases[index], mode->holo_mode);
            }
        }
        printf("%-11s contrast %2d/%2d (%5.1f%%)", mode->id, wins, scored,
               scored > 0 ? 100.0 * (double)wins / (double)scored : 0.0);
        if (mode->holo_mode != LM_HOLO_DISABLED) {
            int hits = 0;
            for (index = 0; index < holo_count; index++) hits += holo_results[mode_index][index].pass;
            printf("  holo %d/%d", hits, holo_count);
        }
        putchar('\n');
    }

    if (write_json(json_path, model_path, cases_path, holo_path,
                   model_hash, cases_hash, holo_hash, cases, case_count,
                   holo_cases, holo_count, results, holo_results) != 0) {
        free(model_data);
        return 1;
    }
    printf("wrote %s\n", json_path);
    free(model_data);
    return 0;
}
