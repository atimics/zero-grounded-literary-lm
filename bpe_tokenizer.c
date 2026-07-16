#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * bpe_tokenizer.c -- a tiny, deterministic literary byte-pair tokenizer.
 *
 * ASCII bytes 0..127 remain literal.  Learned merge tokens occupy values
 * The current fixed-budget preset deliberately learns zero merges: experiments
 * with 256, 512, and 2,048 token vocabularies showed that this small corpus
 * generalizes best at the normalized-character level.  The merge trainer is
 * retained here so that the trade-off remains explicit and reproducible.
 */

#define BASE_TOKENS 128
#define MERGE_COUNT 0
#define MERGE_STORAGE 1
#define TOKEN_COUNT 128
#define PAIR_COUNT (TOKEN_COUNT * TOKEN_COUNT)

typedef uint16_t Token;

typedef struct {
    const char *input_path;
    const char *output_path;
    Token *data;
    size_t length;
    size_t original_length;
} Text;

static const unsigned char VOCAB_MAGIC[8] = {
    'L', 'I', 'T', 'B', 'P', 'E', '1', '\0'
};

static void fail(const char *message)
{
    fprintf(stderr, "error: %s\n", message);
    exit(EXIT_FAILURE);
}

static void fail_path(const char *action, const char *path)
{
    fprintf(stderr, "error: could not %s '%s': %s\n", action, path,
            strerror(errno));
    exit(EXIT_FAILURE);
}

static void *checked_alloc(size_t count, size_t size)
{
    void *memory;
    if (size != 0 && count > SIZE_MAX / size) {
        fail("allocation size overflow");
    }
    memory = calloc(count, size);
    if (memory == NULL) {
        fail("out of memory");
    }
    return memory;
}

static unsigned char *read_entire_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL) {
        fail_path("open", path);
    }
    if (fseek(file, 0, SEEK_END) != 0 || (size = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0) {
        fclose(file);
        fail_path("measure", path);
    }
    data = checked_alloc((size_t)size + 1, 1);
    if (fread(data, 1, (size_t)size, file) != (size_t)size) {
        fclose(file);
        free(data);
        fail_path("read", path);
    }
    if (fclose(file) != 0) {
        free(data);
        fail_path("close", path);
    }
    *length = (size_t)size;
    return data;
}

static uint32_t utf8_next(const unsigned char *data, size_t length,
                          size_t *offset)
{
    unsigned char a = data[(*offset)++];
    uint32_t value;
    int remaining;
    int i;
    if (a < 0x80) {
        return a;
    }
    if ((a & 0xe0) == 0xc0) {
        value = a & 0x1f;
        remaining = 1;
    } else if ((a & 0xf0) == 0xe0) {
        value = a & 0x0f;
        remaining = 2;
    } else if ((a & 0xf8) == 0xf0) {
        value = a & 0x07;
        remaining = 3;
    } else {
        return '?';
    }
    if (*offset + (size_t)remaining > length) {
        *offset = length;
        return '?';
    }
    for (i = 0; i < remaining; ++i) {
        unsigned char b = data[(*offset)++];
        if ((b & 0xc0) != 0x80) {
            return '?';
        }
        value = (value << 6) | (b & 0x3f);
    }
    return value;
}

static void append_byte(unsigned char *output, size_t *length,
                        unsigned char value)
{
    output[(*length)++] = value;
}

static void append_text(unsigned char *output, size_t *length,
                        const char *text)
{
    while (*text != '\0') {
        append_byte(output, length, (unsigned char)*text++);
    }
}

static char latin_base(uint32_t codepoint)
{
    switch (codepoint) {
    case 0x00c0: case 0x00c1: case 0x00c2: case 0x00c3: case 0x00c4:
    case 0x00c5: return 'A';
    case 0x00c7: return 'C';
    case 0x00c8: case 0x00c9: case 0x00ca: case 0x00cb: return 'E';
    case 0x00cc: case 0x00cd: case 0x00ce: case 0x00cf: return 'I';
    case 0x00d1: return 'N';
    case 0x00d2: case 0x00d3: case 0x00d4: case 0x00d5: case 0x00d6:
        return 'O';
    case 0x00d9: case 0x00da: case 0x00db: case 0x00dc: return 'U';
    case 0x00dd: return 'Y';
    case 0x00e0: case 0x00e1: case 0x00e2: case 0x00e3: case 0x00e4:
    case 0x00e5: return 'a';
    case 0x00e7: return 'c';
    case 0x00e8: case 0x00e9: case 0x00ea: case 0x00eb: return 'e';
    case 0x00ec: case 0x00ed: case 0x00ee: case 0x00ef: return 'i';
    case 0x00f1: return 'n';
    case 0x00f2: case 0x00f3: case 0x00f4: case 0x00f5: case 0x00f6:
        return 'o';
    case 0x00f9: case 0x00fa: case 0x00fb: case 0x00fc: return 'u';
    case 0x00fd: case 0x00ff: return 'y';
    default: return '\0';
    }
}

static unsigned char *normalize_ascii(const unsigned char *input,
                                      size_t input_length,
                                      size_t *output_length)
{
    unsigned char *output = checked_alloc(input_length * 3 + 1, 1);
    size_t in = 0;
    size_t out = 0;
    while (in < input_length) {
        uint32_t cp = utf8_next(input, input_length, &in);
        char base;
        if (cp < BASE_TOKENS) {
            append_byte(output, &out, (unsigned char)cp);
        } else if (cp == 0x2018 || cp == 0x2019 || cp == 0x201a ||
                   cp == 0x201b) {
            append_byte(output, &out, '\'');
        } else if (cp == 0x201c || cp == 0x201d || cp == 0x201e ||
                   cp == 0x201f) {
            append_byte(output, &out, '"');
        } else if (cp == 0x2013 || cp == 0x2014 || cp == 0x2212) {
            append_byte(output, &out, '-');
        } else if (cp == 0x2026) {
            append_text(output, &out, "...");
        } else if (cp == 0x00a0 || cp == 0x2002 || cp == 0x2003 ||
                   cp == 0x2009) {
            append_byte(output, &out, ' ');
        } else if (cp == 0x00c6) {
            append_text(output, &out, "AE");
        } else if (cp == 0x00e6) {
            append_text(output, &out, "ae");
        } else if (cp == 0x0152) {
            append_text(output, &out, "OE");
        } else if (cp == 0x0153) {
            append_text(output, &out, "oe");
        } else if ((base = latin_base(cp)) != '\0') {
            append_byte(output, &out, (unsigned char)base);
        } else {
            append_byte(output, &out, '?');
        }
    }
    *output_length = out;
    return output;
}

static int line_equals(const unsigned char *data, size_t start, size_t end,
                       const char *text)
{
    size_t length;
    while (start < end && (data[start] == ' ' || data[start] == '\t')) ++start;
    while (end > start &&
           (data[end - 1] == ' ' || data[end - 1] == '\t' ||
            data[end - 1] == '\r')) {
        --end;
    }
    length = strlen(text);
    return end - start == length && memcmp(data + start, text, length) == 0;
}

static int line_is_layout_noise(const unsigned char *data, size_t start,
                                size_t end)
{
    size_t i;
    size_t visible = 0;
    size_t rule_characters = 0;
    int pipes = 0;
    for (i = start; i < end; ++i) {
        unsigned char value = data[i];
        if (value != ' ' && value != '\t' && value != '\r') ++visible;
        if (value == '-' || value == '+' || value == '=') ++rule_characters;
        if (value == '|') ++pipes;
    }
    if (visible >= 20 && rule_characters == visible) return 1;
    if (end - start > 100 && pipes > 0) return 1;
    if (line_equals(data, start, end, "[]") ||
        line_equals(data, start, end,
                    "Graphics and textual content produced by Lolaness.")) {
        return 1;
    }
    return 0;
}

static void clean_editorial_noise(unsigned char *data, size_t *length,
                                  int crowley)
{
    size_t read = 0;
    size_t write = 0;
    int skipped_block = 0;
    int blank_lines = 0;
    while (read < *length) {
        size_t start = read;
        size_t end;
        int drop = 0;
        while (read < *length && data[read] != '\n') ++read;
        end = read;
        if (read < *length) ++read;

        if (crowley && skipped_block == 0 &&
            line_equals(data, start, end, "Transcriber's Notes:")) {
            skipped_block = 1;
            drop = 1;
        } else if (crowley && skipped_block == 0 &&
                   line_equals(data, start, end, "PRESS NOTICES")) {
            skipped_block = 2;
            drop = 1;
        } else if (crowley && skipped_block == 0 &&
                   line_equals(data, start, end, "Notes")) {
            skipped_block = 3;
            drop = 1;
        } else if (skipped_block == 1) {
            if (line_equals(data, start, end, "TANNHAUSER")) {
                skipped_block = 0;
            } else {
                drop = 1;
            }
        } else if (skipped_block == 2) {
            if (line_equals(data, start, end, "HOUSEHOLD GODS")) {
                skipped_block = 0;
            } else {
                drop = 1;
            }
        } else if (skipped_block == 3) {
            if (line_equals(data, start, end, "A Prayer")) {
                skipped_block = 0;
            } else {
                drop = 1;
            }
        }
        if (!drop && line_is_layout_noise(data, start, end)) drop = 1;

        if (!drop) {
            size_t i;
            size_t first = start;
            size_t line_output_start = write;
            int emitted = 0;
            int pending_space = 0;
            while (first < end &&
                   (data[first] == ' ' || data[first] == '\t' ||
                    data[first] == '\r')) {
                ++first;
            }
            if (first > start && first < end) {
                data[write++] = ' ';
                data[write++] = ' ';
                data[write++] = ' ';
                data[write++] = ' ';
            }
            for (i = first; i < end; ++i) {
                unsigned char value = data[i];
                if (value == '_') continue;
                if (value == '\\' && i + 1 < end &&
                    (data[i + 1] == '!' || data[i + 1] == '?' ||
                     data[i + 1] == '.')) {
                    continue;
                }
                if (value == ' ' || value == '\t' || value == '\r') {
                    pending_space = emitted;
                    continue;
                }
                if (pending_space) {
                    data[write++] = ' ';
                    pending_space = 0;
                }
                data[write++] = value;
                emitted = 1;
            }
            if (!emitted) {
                write = line_output_start;
                if (blank_lines >= 2) {
                    continue;
                }
                ++blank_lines;
            } else {
                blank_lines = 0;
            }
            data[write++] = '\n';
        }
    }
    *length = write;
}

static void load_text(Text *text)
{
    unsigned char *raw;
    unsigned char *normalized;
    size_t raw_length;
    size_t i;
    raw = read_entire_file(text->input_path, &raw_length);
    normalized = normalize_ascii(raw, raw_length, &text->length);
    clean_editorial_noise(normalized, &text->length,
                          strstr(text->input_path, "crowley") != NULL);
    text->data = checked_alloc(text->length, sizeof(*text->data));
    for (i = 0; i < text->length; ++i) text->data[i] = normalized[i];
    text->original_length = text->length;
    free(normalized);
    free(raw);
}

static int token_contains_newline(int token, const Token *left,
                                  const Token *right,
                                  const unsigned char *known)
{
    if (token < BASE_TOKENS) {
        return token == '\n' || token == '\r';
    }
    if (known[token]) {
        return known[token] == 2;
    }
    return token_contains_newline(left[token - BASE_TOKENS], left, right,
                                  known) ||
           token_contains_newline(right[token - BASE_TOKENS], left, right,
                                  known);
}

static void apply_merge(Text *text, int left, int right, int merged)
{
    size_t read = 0;
    size_t write = 0;
    while (read < text->length) {
        if (read + 1 < text->length && text->data[read] == left &&
            text->data[read + 1] == right) {
            text->data[write++] = (Token)merged;
            read += 2;
        } else {
            text->data[write++] = text->data[read++];
        }
    }
    text->length = write;
}

static size_t render_token(int token, const Token *left,
                           const Token *right, char *output,
                           size_t capacity)
{
    size_t length = 0;
    if (token < BASE_TOKENS) {
        if (capacity > 1) {
            if (token == '\n') {
                output[length++] = '\\';
                if (length + 1 < capacity) output[length++] = 'n';
            } else if (token == '\t') {
                output[length++] = '\\';
                if (length + 1 < capacity) output[length++] = 't';
            } else if (token >= 32 && token < 127) {
                output[length++] = (char)token;
            } else {
                output[length++] = '.';
            }
        }
    } else {
        char part[256];
        size_t first = render_token(left[token - BASE_TOKENS], left, right,
                                    part, sizeof(part));
        size_t second = render_token(right[token - BASE_TOKENS], left, right,
                                     part + first, sizeof(part) - first);
        size_t amount = first + second;
        if (amount >= capacity) amount = capacity - 1;
        memcpy(output, part, amount);
        length = amount;
    }
    output[length] = '\0';
    return length;
}

static void learn_merges(Text *texts, int text_count, Token *left,
                         Token *right)
{
    double *scores = checked_alloc(PAIR_COUNT, sizeof(*scores));
    uint64_t *totals = checked_alloc(PAIR_COUNT, sizeof(*totals));
    uint32_t *counts = checked_alloc(PAIR_COUNT, sizeof(*counts));
    unsigned char newline_state[TOKEN_COUNT] = {0};
    int merge;
    for (merge = 0; merge < MERGE_COUNT; ++merge) {
        int text_index;
        int best = -1;
        int new_token = BASE_TOKENS + merge;
        memset(scores, 0, PAIR_COUNT * sizeof(*scores));
        memset(totals, 0, PAIR_COUNT * sizeof(*totals));
        for (text_index = 0; text_index < text_count; ++text_index) {
            Text *text = &texts[text_index];
            size_t i;
            memset(counts, 0, PAIR_COUNT * sizeof(*counts));
            for (i = 0; i + 1 < text->length; ++i) {
                size_t key =
                    (size_t)text->data[i] * TOKEN_COUNT + text->data[i + 1];
                ++counts[key];
            }
            for (i = 0; i < PAIR_COUNT; ++i) {
                if (counts[i] != 0) {
                    scores[i] += (double)counts[i] / (double)(text->length - 1);
                    totals[i] += counts[i];
                }
            }
        }
        for (int key = 0; key < PAIR_COUNT; ++key) {
            int a = key / TOKEN_COUNT;
            int b = key % TOKEN_COUNT;
            if (a >= new_token || b >= new_token || totals[key] < 2 ||
                token_contains_newline(a, left, right, newline_state) ||
                token_contains_newline(b, left, right, newline_state)) {
                continue;
            }
            if (best < 0 || scores[key] > scores[best] ||
                (scores[key] == scores[best] && totals[key] > totals[best])) {
                best = key;
            }
        }
        if (best < 0) {
            fail("not enough repeated pairs to build vocabulary");
        }
        left[merge] = (Token)(best / TOKEN_COUNT);
        right[merge] = (Token)(best % TOKEN_COUNT);
        newline_state[new_token] =
            (unsigned char)(token_contains_newline(new_token, left, right,
                                                   newline_state) ? 2 : 1);
        for (text_index = 0; text_index < text_count; ++text_index) {
            apply_merge(&texts[text_index], left[merge], right[merge], new_token);
        }
        if ((merge + 1) % 16 == 0 || merge == 0) {
            char rendered[256];
            render_token(new_token, left, right, rendered, sizeof(rendered));
            printf("merge %3d token=%3d text=\"%s\" score=%.6g count=%llu\n",
                   merge + 1, new_token, rendered, scores[best],
                   (unsigned long long)totals[best]);
            fflush(stdout);
        }
    }
    free(scores);
    free(totals);
    free(counts);
}

static void write_vocab(const char *path, const Token *left,
                        const Token *right)
{
    FILE *file = fopen(path, "wb");
    uint32_t version = 2;
    uint32_t count = MERGE_COUNT;
    int i;
    if (file == NULL) fail_path("create", path);
    if (fwrite(VOCAB_MAGIC, 1, sizeof(VOCAB_MAGIC), file) !=
            sizeof(VOCAB_MAGIC) ||
        fwrite(&version, sizeof(version), 1, file) != 1 ||
        fwrite(&count, sizeof(count), 1, file) != 1) {
        fclose(file);
        fail_path("write", path);
    }
    for (i = 0; i < MERGE_COUNT; ++i) {
        if (fwrite(&left[i], sizeof(left[i]), 1, file) != 1 ||
            fwrite(&right[i], sizeof(right[i]), 1, file) != 1) {
            fclose(file);
            fail_path("write", path);
        }
    }
    if (fclose(file) != 0) fail_path("close", path);
}

static void write_tokens(const Text *text)
{
    FILE *file = fopen(text->output_path, "wb");
    if (file == NULL) fail_path("create", text->output_path);
    if (fwrite(text->data, sizeof(*text->data), text->length, file) !=
        text->length) {
        fclose(file);
        fail_path("write", text->output_path);
    }
    if (fclose(file) != 0) fail_path("close", text->output_path);
    printf("encoded %s: %zu -> %zu tokens (%.2fx compression)\n",
           text->input_path, text->original_length, text->length,
           text->length == 0 ? 0.0 :
               (double)text->original_length / (double)text->length);
}

static void usage(const char *program)
{
    printf("usage: %s --vocab FILE --text INPUT --out OUTPUT "
           "[--text INPUT --out OUTPUT ...]\n", program);
}

int main(int argc, char **argv)
{
    const char *vocab_path = NULL;
    Text *texts = checked_alloc((size_t)argc, sizeof(*texts));
    int text_count = 0;
    int output_count = 0;
    Token left[MERGE_STORAGE] = {0};
    Token right[MERGE_STORAGE] = {0};
    int i;
    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--help") == 0) {
            usage(argv[0]);
            free(texts);
            return EXIT_SUCCESS;
        } else if (strcmp(argv[i], "--vocab") == 0 && i + 1 < argc) {
            vocab_path = argv[++i];
        } else if (strcmp(argv[i], "--text") == 0 && i + 1 < argc) {
            texts[text_count++].input_path = argv[++i];
        } else if (strcmp(argv[i], "--out") == 0 && i + 1 < argc) {
            if (output_count >= text_count) {
                fail("--out must follow its --text");
            }
            texts[output_count++].output_path = argv[++i];
        } else {
            usage(argv[0]);
            fail("unknown or incomplete option");
        }
    }
    if (vocab_path == NULL || text_count == 0 || output_count != text_count) {
        usage(argv[0]);
        fail("--vocab and matching --text/--out pairs are required");
    }
    for (i = 0; i < text_count; ++i) load_text(&texts[i]);
    learn_merges(texts, text_count, left, right);
    write_vocab(vocab_path, left, right);
    for (i = 0; i < text_count; ++i) {
        write_tokens(&texts[i]);
        free(texts[i].data);
    }
    printf("saved vocabulary %s\n", vocab_path);
    free(texts);
    return EXIT_SUCCESS;
}
