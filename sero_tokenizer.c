#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SERO_VERSION 1u
#define SERO_BASE_TOKENS 264u
#define SERO_DOCUMENT_TOKEN 256u
#define SERO_FIRST_MERGE 264u
#define SERO_FLAG_LOSSLESS_BYTES 1u
#define SERO_MAX_VOCAB 2048u

typedef uint16_t Token;

typedef struct {
    Token left;
    Token right;
} Merge;

typedef struct {
    uint32_t merge_count;
    Merge *merges;
} Vocabulary;

static const unsigned char VOCAB_MAGIC[8] = {
    'S', 'E', 'R', 'O', 'T', 'O', 'K', '\0'
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
    if (size != 0 && count > SIZE_MAX / size) fail("allocation size overflow");
    memory = calloc(count ? count : 1, size ? size : 1);
    if (memory == NULL) fail("out of memory");
    return memory;
}

static unsigned char *read_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL) fail_path("open", path);
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

static uint16_t read_u16(const unsigned char *data)
{
    return (uint16_t)data[0] | ((uint16_t)data[1] << 8);
}

static uint32_t read_u32(const unsigned char *data)
{
    return (uint32_t)data[0] | ((uint32_t)data[1] << 8) |
           ((uint32_t)data[2] << 16) | ((uint32_t)data[3] << 24);
}

static void write_u16(FILE *file, uint16_t value)
{
    unsigned char bytes[2];
    bytes[0] = (unsigned char)(value & 0xffu);
    bytes[1] = (unsigned char)((value >> 8) & 0xffu);
    if (fwrite(bytes, 1, sizeof(bytes), file) != sizeof(bytes))
        fail("could not write token stream");
}

static void write_u32(FILE *file, uint32_t value)
{
    unsigned char bytes[4];
    bytes[0] = (unsigned char)(value & 0xffu);
    bytes[1] = (unsigned char)((value >> 8) & 0xffu);
    bytes[2] = (unsigned char)((value >> 16) & 0xffu);
    bytes[3] = (unsigned char)((value >> 24) & 0xffu);
    if (fwrite(bytes, 1, sizeof(bytes), file) != sizeof(bytes))
        fail("could not write vocabulary");
}

static void write_vocabulary(const char *path, const Merge *merges,
                             uint32_t merge_count)
{
    FILE *file;
    uint32_t index;
    file = fopen(path, "wb");
    if (file == NULL) fail_path("create", path);
    if (fwrite(VOCAB_MAGIC, 1, sizeof(VOCAB_MAGIC), file) != sizeof(VOCAB_MAGIC))
        fail("could not write vocabulary magic");
    write_u32(file, SERO_VERSION);
    write_u32(file, SERO_BASE_TOKENS);
    write_u32(file, merge_count);
    write_u32(file, SERO_FLAG_LOSSLESS_BYTES);
    for (index = 0; index < merge_count; ++index) {
        write_u16(file, merges[index].left);
        write_u16(file, merges[index].right);
    }
    if (fclose(file) != 0) fail_path("close", path);
}

static int is_structural(Token token)
{
    return (token >= 1u && token <= 7u) || token == SERO_DOCUMENT_TOKEN;
}

static Token byte_token(unsigned char value)
{
    if (value >= 1u && value <= 7u) return (Token)(256u + value);
    return (Token)value;
}

static void initialize(const char *path)
{
    write_vocabulary(path, NULL, 0u);
}

static Vocabulary load_vocabulary(const char *path)
{
    Vocabulary vocabulary = {0, NULL};
    unsigned char *data;
    size_t length;
    size_t expected;
    uint32_t version;
    uint32_t base_tokens;
    uint32_t flags;
    uint32_t index;
    data = read_file(path, &length);
    if (length < 24 || memcmp(data, VOCAB_MAGIC, sizeof(VOCAB_MAGIC)) != 0)
        fail("invalid Sero tokenizer magic");
    version = read_u32(data + 8);
    base_tokens = read_u32(data + 12);
    vocabulary.merge_count = read_u32(data + 16);
    flags = read_u32(data + 20);
    if (version != SERO_VERSION || base_tokens != SERO_BASE_TOKENS ||
        flags != SERO_FLAG_LOSSLESS_BYTES)
        fail("unsupported Sero tokenizer contract");
    if (vocabulary.merge_count > UINT16_MAX - SERO_FIRST_MERGE)
        fail("Sero vocabulary exceeds uint16 token space");
    expected = 24u + (size_t)vocabulary.merge_count * 4u;
    if (length != expected) fail("Sero tokenizer has a truncated or trailing merge table");
    vocabulary.merges = checked_alloc(vocabulary.merge_count, sizeof(*vocabulary.merges));
    for (index = 0; index < vocabulary.merge_count; ++index) {
        uint32_t token = SERO_FIRST_MERGE + index;
        Merge merge;
        merge.left = read_u16(data + 24u + (size_t)index * 4u);
        merge.right = read_u16(data + 26u + (size_t)index * 4u);
        if (merge.left >= token || merge.right >= token ||
            is_structural(merge.left) || is_structural(merge.right))
            fail("Sero merge table references an invalid or structural token");
        vocabulary.merges[index] = merge;
    }
    free(data);
    return vocabulary;
}

static void destroy_vocabulary(Vocabulary *vocabulary)
{
    free(vocabulary->merges);
    vocabulary->merges = NULL;
    vocabulary->merge_count = 0;
}

static void inspect(const char *path)
{
    Vocabulary vocabulary = load_vocabulary(path);
    printf("{\"schema\":\"sero.tokenizer.v1\",\"version\":1,"
           "\"base_tokens\":264,\"merge_count\":%u,\"vocab_size\":%u,"
           "\"lossless_bytes\":true,\"document_token\":256,"
           "\"channel_tokens\":[1,2,3,4,5,6,7]}\n",
           vocabulary.merge_count, SERO_BASE_TOKENS + vocabulary.merge_count);
    destroy_vocabulary(&vocabulary);
}

static Token *read_token_stream(const char *path, size_t *token_count,
                                int require_base_tokens)
{
    unsigned char *data;
    size_t length;
    size_t index;
    Token *tokens;
    data = read_file(path, &length);
    if (length % 2u != 0)
        fail("token stream is not aligned uint16 little-endian data");
    *token_count = length / 2u;
    tokens = checked_alloc(*token_count, sizeof(*tokens));
    for (index = 0; index < *token_count; ++index) {
        Token token = read_u16(data + index * 2u);
        if (require_base_tokens &&
            (token >= SERO_BASE_TOKENS ||
             (token >= 1u && token <= 7u))) {
            free(tokens);
            free(data);
            fail("base token stream contains an invalid or structural token");
        }
        tokens[index] = token;
    }
    free(data);
    return tokens;
}

static void write_token_stream(const char *path, const Token *tokens,
                               size_t token_count)
{
    FILE *file = fopen(path, "wb");
    size_t index;
    if (file == NULL) fail_path("create", path);
    for (index = 0; index < token_count; ++index)
        write_u16(file, tokens[index]);
    if (fclose(file) != 0) fail_path("close", path);
}

static size_t apply_merge(Token *tokens, Token *scratch, size_t length,
                          Merge merge, Token merged)
{
    size_t source = 0;
    size_t target = 0;
    while (source < length) {
        if (source + 1u < length && tokens[source] == merge.left &&
            tokens[source + 1u] == merge.right) {
            scratch[target++] = merged;
            source += 2u;
        } else {
            scratch[target++] = tokens[source++];
        }
    }
    memcpy(tokens, scratch, target * sizeof(*tokens));
    return target;
}

static uint32_t parse_u32(const char *text, const char *name)
{
    char *end = NULL;
    unsigned long value;
    errno = 0;
    value = strtoul(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || value > UINT32_MAX) {
        fprintf(stderr, "error: invalid value for %s: %s\n", name, text);
        exit(EXIT_FAILURE);
    }
    return (uint32_t)value;
}

static size_t parse_size(const char *text, const char *name)
{
    char *end = NULL;
    unsigned long long value;
    errno = 0;
    value = strtoull(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' ||
        value > (unsigned long long)SIZE_MAX) {
        fprintf(stderr, "error: invalid value for %s: %s\n", name, text);
        exit(EXIT_FAILURE);
    }
    return (size_t)value;
}

static void train_vocabulary(const char *token_path, const char *vocab_path,
                             uint32_t target_vocab, size_t maximum_tokens)
{
    Token *tokens;
    Token *scratch;
    Merge *merges;
    uint64_t *counts;
    size_t length;
    size_t training_length;
    uint32_t merge_count = 0;
    uint32_t current_vocab = SERO_BASE_TOKENS;
    if (target_vocab < SERO_BASE_TOKENS || target_vocab > SERO_MAX_VOCAB)
        fail("vocabulary size must be between 264 and 2048");
    tokens = read_token_stream(token_path, &length, 1);
    if (length == 0) fail("cannot train a tokenizer on an empty token stream");
    training_length =
        maximum_tokens != 0 && maximum_tokens < length ? maximum_tokens : length;
    scratch = checked_alloc(training_length, sizeof(*scratch));
    merges = checked_alloc(target_vocab - SERO_BASE_TOKENS, sizeof(*merges));
    counts = checked_alloc((size_t)target_vocab * target_vocab, sizeof(*counts));
    while (current_vocab < target_vocab) {
        size_t index;
        uint64_t best_count = 0;
        Token best_left = 0;
        Token best_right = 0;
        memset(counts, 0,
               (size_t)target_vocab * target_vocab * sizeof(*counts));
        for (index = 0; index + 1u < training_length; ++index) {
            Token left = tokens[index];
            Token right = tokens[index + 1u];
            size_t pair;
            if (is_structural(left) || is_structural(right)) continue;
            if (left >= current_vocab || right >= current_vocab)
                fail("training token escaped the active vocabulary");
            pair = (size_t)left * target_vocab + right;
            ++counts[pair];
        }
        for (index = 0; index < (size_t)current_vocab * target_vocab; ++index) {
            uint32_t left = (uint32_t)(index / target_vocab);
            uint32_t right = (uint32_t)(index % target_vocab);
            uint64_t count;
            if (right >= current_vocab) continue;
            count = counts[index];
            if (count > best_count) {
                best_count = count;
                best_left = (Token)left;
                best_right = (Token)right;
            }
        }
        if (best_count < 2u) break;
        merges[merge_count].left = best_left;
        merges[merge_count].right = best_right;
        training_length = apply_merge(
            tokens, scratch, training_length, merges[merge_count],
            (Token)current_vocab);
        ++merge_count;
        ++current_vocab;
    }
    write_vocabulary(vocab_path, merges, merge_count);
    printf("{\"schema\":\"sero.tokenizer_training.v1\","
           "\"input_tokens\":%zu,\"training_tokens\":%zu,"
           "\"requested_vocab_size\":%u,\"vocab_size\":%u,"
           "\"merge_count\":%u}\n",
           length,
           maximum_tokens != 0 && maximum_tokens < length
               ? maximum_tokens
               : length,
           target_vocab, SERO_BASE_TOKENS + merge_count, merge_count);
    free(tokens);
    free(scratch);
    free(merges);
    free(counts);
}

static void recode(const char *vocab_path, const char *input_path,
                   const char *output_path)
{
    Vocabulary vocabulary = load_vocabulary(vocab_path);
    Token *tokens;
    Token *scratch;
    size_t input_length;
    size_t length;
    uint32_t merge_index;
    tokens = read_token_stream(input_path, &input_length, 1);
    scratch = checked_alloc(input_length, sizeof(*scratch));
    length = input_length;
    for (merge_index = 0; merge_index < vocabulary.merge_count; ++merge_index) {
        length = apply_merge(
            tokens, scratch, length, vocabulary.merges[merge_index],
            (Token)(SERO_FIRST_MERGE + merge_index));
    }
    write_token_stream(output_path, tokens, length);
    printf("{\"schema\":\"sero.token_recode.v1\","
           "\"input_tokens\":%zu,\"tokens\":%zu,"
           "\"tokens_per_input_token\":%.9g}\n",
           input_length, length,
           input_length ? (double)length / (double)input_length : 0.0);
    free(tokens);
    free(scratch);
    destroy_vocabulary(&vocabulary);
}

static void encode(const char *vocab_path, const char *input_path,
                   const char *output_path)
{
    Vocabulary vocabulary = load_vocabulary(vocab_path);
    unsigned char *input;
    size_t input_length;
    Token *tokens;
    Token *scratch;
    size_t length;
    size_t index;
    uint32_t merge_index;
    FILE *output;
    input = read_file(input_path, &input_length);
    tokens = checked_alloc(input_length, sizeof(*tokens));
    scratch = checked_alloc(input_length, sizeof(*scratch));
    for (index = 0; index < input_length; ++index) tokens[index] = byte_token(input[index]);
    length = input_length;
    for (merge_index = 0; merge_index < vocabulary.merge_count; ++merge_index) {
        Merge merge = vocabulary.merges[merge_index];
        Token merged = (Token)(SERO_FIRST_MERGE + merge_index);
        size_t source = 0;
        size_t target = 0;
        while (source < length) {
            if (source + 1 < length && tokens[source] == merge.left &&
                tokens[source + 1] == merge.right) {
                scratch[target++] = merged;
                source += 2;
            } else {
                scratch[target++] = tokens[source++];
            }
        }
        {
            Token *swap = tokens;
            tokens = scratch;
            scratch = swap;
        }
        length = target;
    }
    output = fopen(output_path, "wb");
    if (output == NULL) fail_path("create", output_path);
    for (index = 0; index < length; ++index) write_u16(output, tokens[index]);
    if (fclose(output) != 0) fail_path("close", output_path);
    printf("{\"schema\":\"sero.tokenization_result.v1\","
           "\"input_bytes\":%zu,\"tokens\":%zu,\"bytes_per_token\":%.9g}\n",
           input_length, length, length ? (double)input_length / (double)length : 0.0);
    free(input);
    free(tokens);
    free(scratch);
    destroy_vocabulary(&vocabulary);
}

static void emit_token(FILE *output, const Vocabulary *vocabulary, Token token,
                       uint32_t depth)
{
    if (depth > vocabulary->merge_count + 1u) fail("cyclic Sero merge table");
    if (token == 0u || (token >= 8u && token <= 255u)) {
        if (fputc((int)token, output) == EOF) fail("could not write decoded byte");
        return;
    }
    if (token >= 257u && token <= 263u) {
        if (fputc((int)(token - 256u), output) == EOF) fail("could not write decoded byte");
        return;
    }
    if (is_structural(token))
        fail("structural token cannot be decoded as standalone raw bytes");
    if (token >= SERO_FIRST_MERGE &&
        (uint32_t)(token - SERO_FIRST_MERGE) < vocabulary->merge_count) {
        Merge merge = vocabulary->merges[token - SERO_FIRST_MERGE];
        emit_token(output, vocabulary, merge.left, depth + 1u);
        emit_token(output, vocabulary, merge.right, depth + 1u);
        return;
    }
    fail("token stream contains an id outside the vocabulary");
}

static void decode(const char *vocab_path, const char *input_path,
                   const char *output_path)
{
    Vocabulary vocabulary = load_vocabulary(vocab_path);
    unsigned char *input;
    size_t input_length;
    size_t offset;
    FILE *output;
    input = read_file(input_path, &input_length);
    if (input_length % 2u != 0) fail("token stream is not aligned uint16 little-endian data");
    output = fopen(output_path, "wb");
    if (output == NULL) fail_path("create", output_path);
    for (offset = 0; offset < input_length; offset += 2u)
        emit_token(output, &vocabulary, read_u16(input + offset), 0u);
    if (fclose(output) != 0) fail_path("close", output_path);
    free(input);
    destroy_vocabulary(&vocabulary);
}

static const char *option(int argc, char **argv, const char *name)
{
    int index;
    for (index = 2; index + 1 < argc; ++index)
        if (strcmp(argv[index], name) == 0) return argv[index + 1];
    return NULL;
}

static void usage(const char *program)
{
    fprintf(stderr,
            "usage:\n"
            "  %s init --vocab FILE\n"
            "  %s train --tokens FILE --vocab FILE --vocab-size N "
            "[--maximum-tokens N]\n"
            "  %s inspect --vocab FILE\n"
            "  %s encode --vocab FILE --text FILE --out FILE\n"
            "  %s recode --vocab FILE --tokens FILE --out FILE\n"
            "  %s decode --vocab FILE --tokens FILE --out FILE\n",
            program, program, program, program, program, program);
    exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
    const char *vocab;
    const char *input;
    const char *output;
    const char *value;
    if (argc < 2) usage(argv[0]);
    vocab = option(argc, argv, "--vocab");
    if (vocab == NULL) usage(argv[0]);
    if (strcmp(argv[1], "init") == 0) {
        initialize(vocab);
    } else if (strcmp(argv[1], "train") == 0) {
        input = option(argc, argv, "--tokens");
        value = option(argc, argv, "--vocab-size");
        if (input == NULL || value == NULL) usage(argv[0]);
        train_vocabulary(
            input, vocab, parse_u32(value, "--vocab-size"),
            option(argc, argv, "--maximum-tokens")
                ? parse_size(option(argc, argv, "--maximum-tokens"),
                             "--maximum-tokens")
                : 0u);
    } else if (strcmp(argv[1], "inspect") == 0) {
        inspect(vocab);
    } else if (strcmp(argv[1], "encode") == 0) {
        input = option(argc, argv, "--text");
        output = option(argc, argv, "--out");
        if (input == NULL || output == NULL) usage(argv[0]);
        encode(vocab, input, output);
    } else if (strcmp(argv[1], "recode") == 0) {
        input = option(argc, argv, "--tokens");
        output = option(argc, argv, "--out");
        if (input == NULL || output == NULL) usage(argv[0]);
        recode(vocab, input, output);
    } else if (strcmp(argv[1], "decode") == 0) {
        input = option(argc, argv, "--tokens");
        output = option(argc, argv, "--out");
        if (input == NULL || output == NULL) usage(argv[0]);
        decode(vocab, input, output);
    } else {
        usage(argv[0]);
    }
    return EXIT_SUCCESS;
}
