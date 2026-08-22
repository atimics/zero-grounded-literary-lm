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
    FILE *file = fopen(path, "wb");
    if (file == NULL) fail_path("create", path);
    if (fwrite(VOCAB_MAGIC, 1, sizeof(VOCAB_MAGIC), file) != sizeof(VOCAB_MAGIC))
        fail("could not write vocabulary magic");
    write_u32(file, SERO_VERSION);
    write_u32(file, SERO_BASE_TOKENS);
    write_u32(file, 0u);
    write_u32(file, SERO_FLAG_LOSSLESS_BYTES);
    if (fclose(file) != 0) fail_path("close", path);
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
            "  %s inspect --vocab FILE\n"
            "  %s encode --vocab FILE --text FILE --out FILE\n"
            "  %s decode --vocab FILE --tokens FILE --out FILE\n",
            program, program, program, program);
    exit(EXIT_FAILURE);
}

int main(int argc, char **argv)
{
    const char *vocab;
    const char *input;
    const char *output;
    if (argc < 2) usage(argv[0]);
    vocab = option(argc, argv, "--vocab");
    if (vocab == NULL) usage(argv[0]);
    if (strcmp(argv[1], "init") == 0) {
        initialize(vocab);
    } else if (strcmp(argv[1], "inspect") == 0) {
        inspect(vocab);
    } else if (strcmp(argv[1], "encode") == 0) {
        input = option(argc, argv, "--text");
        output = option(argc, argv, "--out");
        if (input == NULL || output == NULL) usage(argv[0]);
        encode(vocab, input, output);
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
