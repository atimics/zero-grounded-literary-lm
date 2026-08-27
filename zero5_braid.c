#include <ctype.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DOCUMENT_TOKEN 256u
#define BASE_VOCAB 264u

typedef struct {
    unsigned char *data;
    size_t length;
    size_t capacity;
} Buffer;

typedef struct {
    uint32_t state[8];
    uint64_t total_bytes;
    unsigned char block[64];
    size_t block_length;
} Sha256;

static const uint32_t SHA256_K[64] = {
    UINT32_C(0x428a2f98), UINT32_C(0x71374491), UINT32_C(0xb5c0fbcf),
    UINT32_C(0xe9b5dba5), UINT32_C(0x3956c25b), UINT32_C(0x59f111f1),
    UINT32_C(0x923f82a4), UINT32_C(0xab1c5ed5), UINT32_C(0xd807aa98),
    UINT32_C(0x12835b01), UINT32_C(0x243185be), UINT32_C(0x550c7dc3),
    UINT32_C(0x72be5d74), UINT32_C(0x80deb1fe), UINT32_C(0x9bdc06a7),
    UINT32_C(0xc19bf174), UINT32_C(0xe49b69c1), UINT32_C(0xefbe4786),
    UINT32_C(0x0fc19dc6), UINT32_C(0x240ca1cc), UINT32_C(0x2de92c6f),
    UINT32_C(0x4a7484aa), UINT32_C(0x5cb0a9dc), UINT32_C(0x76f988da),
    UINT32_C(0x983e5152), UINT32_C(0xa831c66d), UINT32_C(0xb00327c8),
    UINT32_C(0xbf597fc7), UINT32_C(0xc6e00bf3), UINT32_C(0xd5a79147),
    UINT32_C(0x06ca6351), UINT32_C(0x14292967), UINT32_C(0x27b70a85),
    UINT32_C(0x2e1b2138), UINT32_C(0x4d2c6dfc), UINT32_C(0x53380d13),
    UINT32_C(0x650a7354), UINT32_C(0x766a0abb), UINT32_C(0x81c2c92e),
    UINT32_C(0x92722c85), UINT32_C(0xa2bfe8a1), UINT32_C(0xa81a664b),
    UINT32_C(0xc24b8b70), UINT32_C(0xc76c51a3), UINT32_C(0xd192e819),
    UINT32_C(0xd6990624), UINT32_C(0xf40e3585), UINT32_C(0x106aa070),
    UINT32_C(0x19a4c116), UINT32_C(0x1e376c08), UINT32_C(0x2748774c),
    UINT32_C(0x34b0bcb5), UINT32_C(0x391c0cb3), UINT32_C(0x4ed8aa4a),
    UINT32_C(0x5b9cca4f), UINT32_C(0x682e6ff3), UINT32_C(0x748f82ee),
    UINT32_C(0x78a5636f), UINT32_C(0x84c87814), UINT32_C(0x8cc70208),
    UINT32_C(0x90befffa), UINT32_C(0xa4506ceb), UINT32_C(0xbef9a3f7),
    UINT32_C(0xc67178f2)
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
    if (size != 0 && count > SIZE_MAX / size) fail("allocation overflow");
    memory = calloc(count ? count : 1, size ? size : 1);
    if (memory == NULL) fail("out of memory");
    return memory;
}

static void buffer_reserve(Buffer *buffer, size_t required)
{
    size_t capacity;
    if (required <= buffer->capacity) return;
    capacity = buffer->capacity ? buffer->capacity : 256u;
    while (capacity < required) {
        if (capacity > SIZE_MAX / 2u) {
            capacity = required;
            break;
        }
        capacity *= 2u;
    }
    buffer->data = realloc(buffer->data, capacity);
    if (buffer->data == NULL) fail("out of memory");
    buffer->capacity = capacity;
}

static void buffer_append(Buffer *buffer, unsigned char value)
{
    buffer_reserve(buffer, buffer->length + 1u);
    buffer->data[buffer->length++] = value;
}

static uint32_t rotate_right(uint32_t value, unsigned amount)
{
    return (value >> amount) | (value << (32u - amount));
}

static void sha256_transform(Sha256 *sha, const unsigned char block[64])
{
    uint32_t words[64];
    uint32_t a;
    uint32_t b;
    uint32_t c;
    uint32_t d;
    uint32_t e;
    uint32_t f;
    uint32_t g;
    uint32_t h;
    int index;
    for (index = 0; index < 16; ++index) {
        words[index] =
            ((uint32_t)block[index * 4] << 24) |
            ((uint32_t)block[index * 4 + 1] << 16) |
            ((uint32_t)block[index * 4 + 2] << 8) |
            (uint32_t)block[index * 4 + 3];
    }
    for (index = 16; index < 64; ++index) {
        uint32_t s0 = rotate_right(words[index - 15], 7) ^
                      rotate_right(words[index - 15], 18) ^
                      (words[index - 15] >> 3);
        uint32_t s1 = rotate_right(words[index - 2], 17) ^
                      rotate_right(words[index - 2], 19) ^
                      (words[index - 2] >> 10);
        words[index] =
            words[index - 16] + s0 + words[index - 7] + s1;
    }
    a = sha->state[0];
    b = sha->state[1];
    c = sha->state[2];
    d = sha->state[3];
    e = sha->state[4];
    f = sha->state[5];
    g = sha->state[6];
    h = sha->state[7];
    for (index = 0; index < 64; ++index) {
        uint32_t s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^
                      rotate_right(e, 25);
        uint32_t choice = (e & f) ^ ((~e) & g);
        uint32_t temporary1 =
            h + s1 + choice + SHA256_K[index] + words[index];
        uint32_t s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^
                      rotate_right(a, 22);
        uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        uint32_t temporary2 = s0 + majority;
        h = g;
        g = f;
        f = e;
        e = d + temporary1;
        d = c;
        c = b;
        b = a;
        a = temporary1 + temporary2;
    }
    sha->state[0] += a;
    sha->state[1] += b;
    sha->state[2] += c;
    sha->state[3] += d;
    sha->state[4] += e;
    sha->state[5] += f;
    sha->state[6] += g;
    sha->state[7] += h;
}

static void sha256_init(Sha256 *sha)
{
    memset(sha, 0, sizeof(*sha));
    sha->state[0] = UINT32_C(0x6a09e667);
    sha->state[1] = UINT32_C(0xbb67ae85);
    sha->state[2] = UINT32_C(0x3c6ef372);
    sha->state[3] = UINT32_C(0xa54ff53a);
    sha->state[4] = UINT32_C(0x510e527f);
    sha->state[5] = UINT32_C(0x9b05688c);
    sha->state[6] = UINT32_C(0x1f83d9ab);
    sha->state[7] = UINT32_C(0x5be0cd19);
}

static void sha256_update(Sha256 *sha, const unsigned char *data, size_t length)
{
    size_t offset = 0;
    if (length > UINT64_MAX - sha->total_bytes)
        fail("SHA-256 input is too large");
    sha->total_bytes += length;
    while (offset < length) {
        size_t room = 64u - sha->block_length;
        size_t amount = length - offset < room ? length - offset : room;
        memcpy(sha->block + sha->block_length, data + offset, amount);
        sha->block_length += amount;
        offset += amount;
        if (sha->block_length == 64u) {
            sha256_transform(sha, sha->block);
            sha->block_length = 0;
        }
    }
}

static void sha256_final(Sha256 *sha, unsigned char digest[32])
{
    uint64_t bits = sha->total_bytes * UINT64_C(8);
    int index;
    sha->block[sha->block_length++] = 0x80u;
    if (sha->block_length > 56u) {
        while (sha->block_length < 64u) sha->block[sha->block_length++] = 0;
        sha256_transform(sha, sha->block);
        sha->block_length = 0;
    }
    while (sha->block_length < 56u) sha->block[sha->block_length++] = 0;
    for (index = 7; index >= 0; --index) {
        sha->block[sha->block_length++] =
            (unsigned char)((bits >> (unsigned)(index * 8)) & 0xffu);
    }
    sha256_transform(sha, sha->block);
    for (index = 0; index < 8; ++index) {
        digest[index * 4] = (unsigned char)(sha->state[index] >> 24);
        digest[index * 4 + 1] = (unsigned char)(sha->state[index] >> 16);
        digest[index * 4 + 2] = (unsigned char)(sha->state[index] >> 8);
        digest[index * 4 + 3] = (unsigned char)sha->state[index];
    }
}

static void digest_hex(const unsigned char digest[32], char output[65])
{
    static const char alphabet[] = "0123456789abcdef";
    int index;
    for (index = 0; index < 32; ++index) {
        output[index * 2] = alphabet[digest[index] >> 4];
        output[index * 2 + 1] = alphabet[digest[index] & 15u];
    }
    output[64] = '\0';
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
    data = checked_alloc((size_t)size + 1u, 1);
    if (fread(data, 1, (size_t)size, file) != (size_t)size) {
        fclose(file);
        free(data);
        fail_path("read", path);
    }
    if (fclose(file) != 0) fail_path("close", path);
    data[size] = '\0';
    *length = (size_t)size;
    return data;
}

static void sha256_file(const char *path, char hex[65])
{
    FILE *file = fopen(path, "rb");
    unsigned char block[65536];
    unsigned char digest[32];
    size_t amount;
    Sha256 sha;
    if (file == NULL) fail_path("open", path);
    sha256_init(&sha);
    while ((amount = fread(block, 1, sizeof(block), file)) != 0)
        sha256_update(&sha, block, amount);
    if (ferror(file)) {
        fclose(file);
        fail_path("read", path);
    }
    if (fclose(file) != 0) fail_path("close", path);
    sha256_final(&sha, digest);
    digest_hex(digest, hex);
}

static const char *find_key(const char *start, const char *limit,
                            const char *key)
{
    const char *cursor = start;
    size_t key_length = strlen(key);
    while (cursor < limit) {
        const char *string_start;
        const char *string_end;
        const char *value;
        int escaped = 0;
        if (*cursor++ != '"') continue;
        string_start = cursor;
        while (cursor < limit) {
            if ((unsigned char)*cursor < 0x20u)
                fail("unescaped control byte in JSON string");
            if (*cursor == '\\') {
                escaped = 1;
                ++cursor;
                if (cursor >= limit) fail("truncated JSON escape");
                ++cursor;
                continue;
            }
            if (*cursor == '"') break;
            ++cursor;
        }
        if (cursor >= limit) fail("unterminated JSON string");
        string_end = cursor++;
        value = cursor;
        while (value < limit && isspace((unsigned char)*value)) ++value;
        if (value >= limit || *value != ':') continue;
        if (!escaped && (size_t)(string_end - string_start) == key_length &&
            memcmp(string_start, key, key_length) == 0) {
            ++value;
            while (value < limit && isspace((unsigned char)*value)) ++value;
            return value < limit ? value : NULL;
        }
    }
    return NULL;
}

static const char *skip_json_string(const char *quote, const char *limit)
{
    const char *cursor;
    if (quote >= limit || *quote != '"') fail("expected a JSON string");
    cursor = quote + 1;
    while (cursor < limit) {
        if ((unsigned char)*cursor < 0x20u)
            fail("unescaped control byte in JSON string");
        if (*cursor == '\\') {
            ++cursor;
            if (cursor >= limit) fail("truncated JSON escape");
            ++cursor;
        } else if (*cursor++ == '"') {
            return cursor;
        }
    }
    fail("unterminated JSON string");
    return NULL;
}

static void containing_object(const char *start, const char *limit,
                              const char *position,
                              const char **object_start,
                              const char **object_end)
{
    const char *stack[128];
    size_t depth = 0;
    const char *cursor = start;
    int nesting = 0;
    while (cursor < position) {
        if (*cursor == '"') {
            cursor = skip_json_string(cursor, limit);
        } else {
            if (*cursor == '{') {
                if (depth == sizeof(stack) / sizeof(stack[0]))
                    fail("JSON nesting is too deep");
                stack[depth++] = cursor;
            } else if (*cursor == '}') {
                if (depth == 0) fail("unbalanced JSON object");
                --depth;
            }
            ++cursor;
        }
    }
    if (depth == 0) fail("artifact path is outside a JSON object");
    *object_start = stack[depth - 1u];
    cursor = *object_start;
    while (cursor < limit) {
        if (*cursor == '"') {
            cursor = skip_json_string(cursor, limit);
            continue;
        }
        if (*cursor == '{') {
            ++nesting;
        } else if (*cursor == '}') {
            --nesting;
            if (nesting == 0) {
                *object_end = cursor;
                return;
            }
            if (nesting < 0) fail("unbalanced JSON object");
        }
        ++cursor;
    }
    fail("unterminated JSON object");
}

static int hex_digit(unsigned char value)
{
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static uint32_t parse_hex4(const char *text, const char *limit)
{
    uint32_t value = 0;
    int index;
    if (limit - text < 4) fail("truncated JSON Unicode escape");
    for (index = 0; index < 4; ++index) {
        int digit = hex_digit((unsigned char)text[index]);
        if (digit < 0) fail("invalid JSON Unicode escape");
        value = (value << 4) | (uint32_t)digit;
    }
    return value;
}

static void append_utf8(Buffer *output, uint32_t value)
{
    if (value <= 0x7fu) {
        buffer_append(output, (unsigned char)value);
    } else if (value <= 0x7ffu) {
        buffer_append(output, (unsigned char)(0xc0u | (value >> 6)));
        buffer_append(output, (unsigned char)(0x80u | (value & 0x3fu)));
    } else if (value <= 0xffffu) {
        buffer_append(output, (unsigned char)(0xe0u | (value >> 12)));
        buffer_append(output,
                      (unsigned char)(0x80u | ((value >> 6) & 0x3fu)));
        buffer_append(output, (unsigned char)(0x80u | (value & 0x3fu)));
    } else if (value <= 0x10ffffu) {
        buffer_append(output, (unsigned char)(0xf0u | (value >> 18)));
        buffer_append(output,
                      (unsigned char)(0x80u | ((value >> 12) & 0x3fu)));
        buffer_append(output,
                      (unsigned char)(0x80u | ((value >> 6) & 0x3fu)));
        buffer_append(output, (unsigned char)(0x80u | (value & 0x3fu)));
    } else {
        fail("JSON Unicode scalar is out of range");
    }
}

static const char *decode_json_string(const char *value, const char *limit,
                                      Buffer *output)
{
    const char *cursor;
    output->length = 0;
    if (value == NULL || value >= limit || *value != '"')
        fail("expected a JSON string");
    cursor = value + 1;
    while (cursor < limit) {
        unsigned char current = (unsigned char)*cursor++;
        if (current == '"') return cursor;
        if (current < 0x20u) fail("unescaped control byte in JSON string");
        if (current != '\\') {
            buffer_append(output, current);
            continue;
        }
        if (cursor >= limit) fail("truncated JSON escape");
        current = (unsigned char)*cursor++;
        switch (current) {
        case '"': case '\\': case '/': buffer_append(output, current); break;
        case 'b': buffer_append(output, '\b'); break;
        case 'f': buffer_append(output, '\f'); break;
        case 'n': buffer_append(output, '\n'); break;
        case 'r': buffer_append(output, '\r'); break;
        case 't': buffer_append(output, '\t'); break;
        case 'u': {
            uint32_t scalar = parse_hex4(cursor, limit);
            cursor += 4;
            if (scalar >= 0xd800u && scalar <= 0xdbffu) {
                uint32_t low;
                if (limit - cursor < 6 || cursor[0] != '\\' ||
                    cursor[1] != 'u')
                    fail("unpaired high surrogate in JSON string");
                low = parse_hex4(cursor + 2, limit);
                if (low < 0xdc00u || low > 0xdfffu)
                    fail("invalid low surrogate in JSON string");
                scalar = 0x10000u + ((scalar - 0xd800u) << 10) +
                         (low - 0xdc00u);
                cursor += 6;
            } else if (scalar >= 0xdc00u && scalar <= 0xdfffu) {
                fail("unpaired low surrogate in JSON string");
            }
            append_utf8(output, scalar);
            break;
        }
        default: fail("unsupported JSON escape");
        }
    }
    fail("unterminated JSON string");
    return NULL;
}

static char *json_string(const char *start, const char *limit, const char *key)
{
    Buffer decoded = {0};
    char *text;
    const char *value = find_key(start, limit, key);
    decode_json_string(value, limit, &decoded);
    if (memchr(decoded.data, '\0', decoded.length) != NULL)
        fail("manifest string contains NUL");
    text = checked_alloc(decoded.length + 1u, 1);
    memcpy(text, decoded.data, decoded.length);
    text[decoded.length] = '\0';
    free(decoded.data);
    return text;
}

static uint64_t json_u64(const char *start, const char *limit, const char *key)
{
    const char *value = find_key(start, limit, key);
    char *end = NULL;
    unsigned long long parsed;
    if (value == NULL) fail("required numeric JSON key is missing");
    errno = 0;
    parsed = strtoull(value, &end, 10);
    if (errno != 0 || end == value || end > limit)
        fail("invalid JSON integer");
    while (end < limit && isspace((unsigned char)*end)) ++end;
    if (end < limit && *end != ',' && *end != '}' && *end != ']')
        fail("invalid JSON integer terminator");
    return (uint64_t)parsed;
}

static int read_line(FILE *file, Buffer *line)
{
    int value;
    line->length = 0;
    while ((value = fgetc(file)) != EOF) {
        buffer_append(line, (unsigned char)value);
        if (value == '\n') break;
    }
    if (value == EOF && ferror(file)) fail("could not read Braid JSONL");
    return line->length != 0;
}

static void write_u16(FILE *file, uint16_t value)
{
    unsigned char bytes[2];
    bytes[0] = (unsigned char)(value & 0xffu);
    bytes[1] = (unsigned char)(value >> 8);
    if (fwrite(bytes, 1, 2, file) != 2u) fail("could not write token stream");
}

static uint16_t byte_token(unsigned char value)
{
    return value >= 1u && value <= 7u ? (uint16_t)(256u + value)
                                     : (uint16_t)value;
}

static void sha256_bytes(const unsigned char *data, size_t length,
                         char hex[65])
{
    Sha256 sha;
    unsigned char digest[32];
    sha256_init(&sha);
    sha256_update(&sha, data, length);
    sha256_final(&sha, digest);
    digest_hex(digest, hex);
}

static char *path_join(const char *left, const char *right)
{
    size_t length = strlen(left) + strlen(right) + 2u;
    char *path = checked_alloc(length, 1);
    snprintf(path, length, "%s/%s", left, right);
    return path;
}

static char *output_path(const char *prefix, const char *suffix, int temporary)
{
    size_t length = strlen(prefix) + strlen(suffix) +
                    (temporary ? strlen(".tmp") : 0u) + 1u;
    char *path = checked_alloc(length, 1);
    snprintf(path, length, "%s%s%s", prefix, suffix,
             temporary ? ".tmp" : "");
    return path;
}

static const char *option(int argc, char **argv, const char *name)
{
    int index;
    for (index = 1; index + 1 < argc; ++index)
        if (strcmp(argv[index], name) == 0) return argv[index + 1];
    return NULL;
}

static void usage(const char *program)
{
    fprintf(stderr, "usage: %s --release DIR --out-prefix PATH\n", program);
    exit(EXIT_FAILURE);
}

typedef struct {
    char *expected_hash;
    uint64_t expected_bytes;
    uint64_t expected_records;
} Artifact;

typedef struct {
    char hash[65];
    uint64_t file_bytes;
    uint64_t documents;
    uint64_t raw_bytes;
} SplitResult;

static Artifact manifest_artifact(const unsigned char *manifest,
                                  size_t manifest_length,
                                  const char *relative_path)
{
    Artifact artifact;
    Buffer decoded_path = {0};
    const char *search = (const char *)manifest;
    const char *limit = (const char *)manifest + manifest_length;
    const char *path_value = NULL;
    const char *object_start;
    const char *object_end;
    for (;;) {
        path_value = find_key(search, limit, "path");
        if (path_value == NULL) break;
        search = decode_json_string(path_value, limit, &decoded_path);
        if (decoded_path.length == strlen(relative_path) &&
            memcmp(decoded_path.data, relative_path,
                   decoded_path.length) == 0)
            break;
    }
    free(decoded_path.data);
    if (path_value == NULL) {
        fprintf(stderr, "error: Braid artifact '%s' is missing\n",
                relative_path);
        exit(EXIT_FAILURE);
    }
    containing_object((const char *)manifest, limit, path_value,
                      &object_start, &object_end);
    artifact.expected_hash =
        json_string(object_start, object_end, "sha256");
    artifact.expected_bytes =
        json_u64(object_start, object_end, "bytes");
    artifact.expected_records =
        json_u64(object_start, object_end, "records");
    return artifact;
}

static void destroy_artifact(Artifact *artifact)
{
    free(artifact->expected_hash);
    artifact->expected_hash = NULL;
}

static void process_split(const char *release_directory,
                          const char *relative_path,
                          const char *expected_split,
                          const Artifact *artifact,
                          const char *token_path,
                          const char *raw_path,
                          SplitResult *result)
{
    char *data_path = path_join(release_directory, relative_path);
    FILE *data = fopen(data_path, "rb");
    FILE *tokens = NULL;
    FILE *raw = NULL;
    Buffer line = {0};
    Buffer text = {0};
    Sha256 data_sha;
    unsigned char digest[32];
    if (data == NULL) fail_path("open", data_path);
    if (token_path != NULL) {
        tokens = fopen(token_path, "wb");
        raw = fopen(raw_path, "wb");
        if (tokens == NULL || raw == NULL)
            fail("could not create ZERO.5 Braid split outputs");
    }
    memset(result, 0, sizeof(*result));
    sha256_init(&data_sha);
    while (read_line(data, &line)) {
        const char *limit;
        const char *text_value;
        char *content_hash;
        char *split;
        char decoded_text_hash[65];
        size_t parse_length = line.length;
        size_t index;
        sha256_update(&data_sha, line.data, line.length);
        result->file_bytes += line.length;
        while (parse_length != 0 &&
               (line.data[parse_length - 1u] == '\n' ||
                line.data[parse_length - 1u] == '\r'))
            --parse_length;
        if (parse_length == 0) fail("Braid JSONL contains a blank row");
        limit = (const char *)line.data + parse_length;
        split = json_string((const char *)line.data, limit, "split");
        if (strcmp(split, expected_split) != 0)
            fail("Braid record is stored in the wrong split artifact");
        free(split);
        text_value = find_key((const char *)line.data, limit, "text");
        decode_json_string(text_value, limit, &text);
        content_hash =
            json_string((const char *)line.data, limit, "contentHash");
        sha256_bytes(text.data, text.length, decoded_text_hash);
        if (strcmp(content_hash, decoded_text_hash) != 0)
            fail("contentHash does not match decoded text");
        free(content_hash);
        if (tokens != NULL) {
            for (index = 0; index < text.length; ++index)
                write_u16(tokens, byte_token(text.data[index]));
            write_u16(tokens, DOCUMENT_TOKEN);
            if (fwrite(text.data, 1, text.length, raw) != text.length ||
                fwrite("\n\n", 1, 2, raw) != 2u)
                fail("could not write ZERO.5 raw corpus");
        }
        ++result->documents;
        result->raw_bytes += text.length;
    }
    if (fclose(data) != 0) fail("could not close Braid split input");
    if (tokens != NULL) {
        int close_failed = 0;
        if (fclose(tokens) != 0) close_failed = 1;
        if (fclose(raw) != 0) close_failed = 1;
        if (close_failed) fail("could not close ZERO.5 Braid split outputs");
    }
    sha256_final(&data_sha, digest);
    digest_hex(digest, result->hash);
    if (result->file_bytes != artifact->expected_bytes ||
        result->documents != artifact->expected_records ||
        strcmp(result->hash, artifact->expected_hash) != 0) {
        fprintf(stderr,
                "error: Braid artifact '%s' does not match release.json\n",
                relative_path);
        exit(EXIT_FAILURE);
    }
    free(data_path);
    free(line.data);
    free(text.data);
}

int main(int argc, char **argv)
{
    const char *release_directory = option(argc, argv, "--release");
    const char *prefix = option(argc, argv, "--out-prefix");
    char *manifest_path;
    unsigned char *manifest;
    size_t manifest_length;
    char manifest_hash[65];
    char *schema;
    char *status;
    char *release_id;
    char *release_digest;
    Artifact train_artifact;
    Artifact validation_artifact;
    Artifact test_artifact;
    SplitResult train_result;
    SplitResult validation_result;
    SplitResult test_result;
    char *train_tokens_tmp;
    char *validation_tokens_tmp;
    char *train_raw_tmp;
    char *validation_raw_tmp;
    char *train_tokens_final;
    char *validation_tokens_final;
    char *train_raw_final;
    char *validation_raw_final;
    if (release_directory == NULL || prefix == NULL) usage(argv[0]);

    manifest_path = path_join(release_directory, "release.json");
    manifest = read_file(manifest_path, &manifest_length);
    sha256_file(manifest_path, manifest_hash);
    schema = json_string((char *)manifest,
                         (char *)manifest + manifest_length, "schemaVersion");
    status = json_string((char *)manifest,
                         (char *)manifest + manifest_length, "status");
    release_id = json_string((char *)manifest,
                             (char *)manifest + manifest_length, "releaseId");
    release_digest = json_string((char *)manifest,
                                 (char *)manifest + manifest_length, "release");
    if (strcmp(schema, "braid.release/v2") != 0)
        fail("unsupported Braid release schema");
    if (strcmp(status, "RELEASED") != 0)
        fail("Braid release is not RELEASED");

    train_artifact =
        manifest_artifact(manifest, manifest_length, "data/train.jsonl");
    validation_artifact = manifest_artifact(
        manifest, manifest_length, "data/validation.jsonl");
    test_artifact =
        manifest_artifact(manifest, manifest_length, "data/test.jsonl");
    train_tokens_tmp = output_path(prefix, ".train.base.tok", 1);
    validation_tokens_tmp =
        output_path(prefix, ".validation.base.tok", 1);
    train_raw_tmp = output_path(prefix, ".train.raw", 1);
    validation_raw_tmp = output_path(prefix, ".validation.raw", 1);
    train_tokens_final = output_path(prefix, ".train.base.tok", 0);
    validation_tokens_final =
        output_path(prefix, ".validation.base.tok", 0);
    train_raw_final = output_path(prefix, ".train.raw", 0);
    validation_raw_final = output_path(prefix, ".validation.raw", 0);
    process_split(release_directory, "data/train.jsonl", "train",
                  &train_artifact, train_tokens_tmp, train_raw_tmp,
                  &train_result);
    process_split(release_directory, "data/validation.jsonl", "validation",
                  &validation_artifact, validation_tokens_tmp,
                  validation_raw_tmp, &validation_result);
    process_split(release_directory, "data/test.jsonl", "test",
                  &test_artifact, NULL, NULL, &test_result);
    if (train_result.documents == 0 || validation_result.documents == 0 ||
        test_result.documents == 0)
        fail("Braid release contains an empty governed split");
    if (rename(train_tokens_tmp, train_tokens_final) != 0 ||
        rename(validation_tokens_tmp, validation_tokens_final) != 0 ||
        rename(train_raw_tmp, train_raw_final) != 0 ||
        rename(validation_raw_tmp, validation_raw_final) != 0)
        fail("could not publish ZERO.5 Braid outputs");

    printf("{\"schema\":\"zero.braid_import.v2\","
           "\"release_id\":\"%s\",\"release_digest\":\"%s\","
           "\"release_manifest_sha256\":\"%s\","
           "\"split_authority\":\"braid\","
           "\"train\":{\"artifact_sha256\":\"%s\","
           "\"artifact_bytes\":%llu,\"documents\":%llu,\"raw_bytes\":%llu,"
           "\"base_tokens\":%llu},"
           "\"validation\":{\"artifact_sha256\":\"%s\","
           "\"artifact_bytes\":%llu,\"documents\":%llu,\"raw_bytes\":%llu,"
           "\"base_tokens\":%llu},"
           "\"test\":{\"artifact_sha256\":\"%s\","
           "\"artifact_bytes\":%llu,\"documents\":%llu,"
           "\"raw_bytes\":%llu,\"tokenizer_metrics_opened\":false}}\n",
           release_id, release_digest, manifest_hash,
           train_result.hash,
           (unsigned long long)train_result.file_bytes,
           (unsigned long long)train_result.documents,
           (unsigned long long)train_result.raw_bytes,
           (unsigned long long)(train_result.raw_bytes +
                                train_result.documents),
           validation_result.hash,
           (unsigned long long)validation_result.file_bytes,
           (unsigned long long)validation_result.documents,
           (unsigned long long)validation_result.raw_bytes,
           (unsigned long long)(validation_result.raw_bytes +
                                validation_result.documents),
           test_result.hash,
           (unsigned long long)test_result.file_bytes,
           (unsigned long long)test_result.documents,
           (unsigned long long)test_result.raw_bytes);

    free(manifest_path);
    free(manifest);
    free(schema);
    free(status);
    free(release_id);
    free(release_digest);
    destroy_artifact(&train_artifact);
    destroy_artifact(&validation_artifact);
    destroy_artifact(&test_artifact);
    free(train_tokens_tmp);
    free(validation_tokens_tmp);
    free(train_raw_tmp);
    free(validation_raw_tmp);
    free(train_tokens_final);
    free(validation_tokens_final);
    free(train_raw_final);
    free(validation_raw_final);
    return EXIT_SUCCESS;
}
