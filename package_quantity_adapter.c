#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char magic[8];
    uint32_t version, vocab, context, dim, heads, layers, ff;
    uint32_t parameter_count;
    uint64_t step;
} InferenceHeader;

typedef struct {
    char magic[8];
    uint32_t version, vocab, context, dim, layers, ff, rank;
    uint64_t step, base_state_digest, adapter_parameters;
} Q30CheckpointHeader;

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t base_length;
    uint32_t base_padded_length;
    uint32_t vocab, context, dim, heads, layers, ff, rank;
    uint64_t step;
    uint64_t adapter_parameters;
} Q30PackageHeader;

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

static void read_exact(FILE *file, void *data, size_t size, size_t count,
                       const char *path)
{
    if (fread(data, size, count, file) != count) fail_path("read", path);
}

static void write_exact(FILE *file, const void *data, size_t size,
                        size_t count, const char *path)
{
    if (fwrite(data, size, count, file) != count) fail_path("write", path);
}

static unsigned char *read_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size = 0;
    if (file == NULL) fail_path("open", path);
    if (fseek(file, 0, SEEK_END) != 0 || (size = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0)
        fail_path("open", path);
    data = malloc((size_t)size);
    if (data == NULL) fail("out of memory");
    read_exact(file, data, 1, (size_t)size, path);
    if (fclose(file) != 0) fail_path("close", path);
    *length = (size_t)size;
    return data;
}

int main(int argc, char **argv)
{
    static const char base_magic[8] =
        {'L', 'I', 'T', 'Q', '8', 'V', '1', '\0'};
    static const char checkpoint_magic[8] =
        {'Q', '3', '0', 'L', 'O', 'R', 'A', '1'};
    static const char package_magic[8] =
        {'L', 'I', 'T', 'Q', 'L', 'R', '1', '\0'};
    const char *base_path;
    const char *adapter_path;
    const char *output_path;
    unsigned char *base;
    size_t base_length;
    size_t padded;
    InferenceHeader base_header;
    Q30CheckpointHeader checkpoint;
    Q30PackageHeader package;
    FILE *adapter;
    FILE *output;
    char *temporary;
    uint32_t layer;
    if (argc != 4) {
        fprintf(stderr, "usage: %s BASE_LITQ8 ADAPTER_Q30 OUTPUT\n", argv[0]);
        return EXIT_FAILURE;
    }
    base_path = argv[1]; adapter_path = argv[2]; output_path = argv[3];
    base = read_file(base_path, &base_length);
    if (base_length < sizeof(base_header) || base_length > UINT32_MAX) fail("invalid base model size");
    memcpy(&base_header, base, sizeof(base_header));
    if (memcmp(base_header.magic, base_magic, 8) != 0 ||
        base_header.version != 1) fail("unsupported base model");
    adapter = fopen(adapter_path, "rb");
    if (adapter == NULL) fail_path("open", adapter_path);
    read_exact(adapter, &checkpoint, sizeof(checkpoint), 1, adapter_path);
    if (memcmp(checkpoint.magic, checkpoint_magic, 8) != 0 ||
        checkpoint.version != 1 || checkpoint.rank != 4 ||
        checkpoint.vocab != base_header.vocab ||
        checkpoint.context != base_header.context ||
        checkpoint.dim != base_header.dim ||
        checkpoint.layers != base_header.layers ||
        checkpoint.ff != base_header.ff ||
        checkpoint.adapter_parameters !=
            (uint64_t)checkpoint.layers * checkpoint.rank *
                2U * (checkpoint.dim + checkpoint.ff))
        fail("adapter checkpoint does not match base model");
    padded = (base_length + 3U) & ~(size_t)3U;
    temporary = malloc(strlen(output_path) + 5);
    if (temporary == NULL) fail("out of memory");
    sprintf(temporary, "%s.tmp", output_path);
    output = fopen(temporary, "wb");
    if (output == NULL) fail_path("create", temporary);
    memset(&package, 0, sizeof(package));
    memcpy(package.magic, package_magic, 8);
    package.version = 1;
    package.base_length = (uint32_t)base_length;
    package.base_padded_length = (uint32_t)padded;
    package.vocab = base_header.vocab; package.context = base_header.context;
    package.dim = base_header.dim; package.heads = base_header.heads;
    package.layers = base_header.layers; package.ff = base_header.ff;
    package.rank = checkpoint.rank; package.step = checkpoint.step;
    package.adapter_parameters = checkpoint.adapter_parameters;
    write_exact(output, &package, sizeof(package), 1, temporary);
    write_exact(output, base, 1, base_length, temporary);
    while (base_length++ < padded) fputc(0, output);
    for (layer = 0; layer < checkpoint.layers; ++layer) {
        uint32_t inputs[2] = {checkpoint.dim, checkpoint.ff};
        uint32_t outputs[2] = {checkpoint.ff, checkpoint.dim};
        int matrix;
        for (matrix = 0; matrix < 2; ++matrix) {
            size_t a = (size_t)checkpoint.rank * inputs[matrix];
            size_t b = (size_t)outputs[matrix] * checkpoint.rank;
            float *values = malloc((a > b ? a : b) * sizeof(float));
            if (values == NULL) fail("out of memory");
            read_exact(adapter, values, sizeof(float), a, adapter_path);
            write_exact(output, values, sizeof(float), a, temporary);
            read_exact(adapter, values, sizeof(float), b, adapter_path);
            write_exact(output, values, sizeof(float), b, temporary);
            if (fseek(adapter, (long)(2 * (a + b) * sizeof(float)),
                      SEEK_CUR) != 0) fail_path("skip optimizer state in", adapter_path);
            free(values);
        }
    }
    if (fgetc(adapter) != EOF) fail("adapter checkpoint has trailing data");
    if (fclose(adapter) != 0 || fclose(output) != 0 ||
        rename(temporary, output_path) != 0) fail_path("install", output_path);
    free(temporary); free(base);
    printf("packaged routed low-rank adapter at update %llu to %s\n",
           (unsigned long long)checkpoint.step, output_path);
    return EXIT_SUCCESS;
}
