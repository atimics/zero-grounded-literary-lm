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
    uint32_t version, vocab, base_context, feature_context;
    uint32_t dim, layers, classes, feature_dim;
    uint64_t step, base_state_digest, head_parameters;
} Q32CheckpointHeader;

typedef struct {
    char magic[8];
    uint32_t version, base_length, base_padded_length;
    uint32_t vocab, context, dim, heads, layers, ff;
    uint32_t classes, feature_dim;
    uint64_t step, head_parameters;
} OperationHeadPackageHeader;

static void fail(const char *message)
{
    fprintf(stderr, "error: %s\n", message); exit(EXIT_FAILURE);
}

static void fail_path(const char *action, const char *path)
{
    fprintf(stderr, "error: could not %s '%s': %s\n", action, path,
            strerror(errno)); exit(EXIT_FAILURE);
}

static void exact_read(FILE *file, void *data, size_t size, size_t count,
                       const char *path)
{
    if (fread(data, size, count, file) != count) fail_path("read", path);
}

static void exact_write(FILE *file, const void *data, size_t size, size_t count,
                        const char *path)
{
    if (fwrite(data, size, count, file) != count) fail_path("write", path);
}

static unsigned char *read_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data; long size = 0;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0)
        fail_path("open", path);
    data = malloc((size_t)size);
    if (data == NULL) fail("out of memory");
    exact_read(file, data, 1, (size_t)size, path);
    if (fclose(file) != 0) fail_path("close", path);
    *length = (size_t)size; return data;
}

int main(int argc, char **argv)
{
    static const char base_magic[8] =
        {'L', 'I', 'T', 'Q', '8', 'V', '1', '\0'};
    static const char checkpoint_magic[8] =
        {'Q', '3', '2', 'H', 'E', 'A', 'D', '1'};
    static const char package_magic[8] =
        {'L', 'I', 'T', 'Q', 'H', 'D', '1', '\0'};
    const char *base_path, *head_path, *output_path;
    unsigned char *base; float *values; char *temporary;
    size_t base_length, padded, weights;
    InferenceHeader base_header; Q32CheckpointHeader checkpoint;
    OperationHeadPackageHeader package;
    FILE *head, *output;
    if (argc != 4) {
        fprintf(stderr, "usage: %s BASE_LITQ8 HEAD_Q32 OUTPUT\n", argv[0]);
        return EXIT_FAILURE;
    }
    base_path = argv[1]; head_path = argv[2]; output_path = argv[3];
    base = read_file(base_path, &base_length);
    if (base_length < sizeof(base_header) || base_length > UINT32_MAX)
        fail("invalid base model size");
    memcpy(&base_header, base, sizeof(base_header));
    if (memcmp(base_header.magic, base_magic, 8) != 0 || base_header.version != 1)
        fail("unsupported base model");
    head = fopen(head_path, "rb");
    if (head == NULL) fail_path("open", head_path);
    exact_read(head, &checkpoint, sizeof(checkpoint), 1, head_path);
    if (memcmp(checkpoint.magic, checkpoint_magic, 8) != 0 ||
        checkpoint.version != 1 || checkpoint.classes != 5 ||
        checkpoint.vocab != base_header.vocab ||
        checkpoint.base_context != base_header.context ||
        checkpoint.dim != base_header.dim ||
        checkpoint.layers != base_header.layers ||
        checkpoint.feature_dim != checkpoint.dim * checkpoint.layers ||
        checkpoint.head_parameters !=
            (uint64_t)checkpoint.classes * (checkpoint.feature_dim + 1U))
        fail("Q3.2 head checkpoint does not match base model");
    weights = (size_t)checkpoint.classes * checkpoint.feature_dim;
    values = malloc((weights + checkpoint.classes) * sizeof(float));
    if (values == NULL) fail("out of memory");
    exact_read(head, values, sizeof(float), weights + checkpoint.classes,
               head_path);
    if (fseek(head, (long)(2 * (weights + checkpoint.classes) * sizeof(float)),
              SEEK_CUR) != 0 || fgetc(head) != EOF)
        fail("Q3.2 head optimizer state is corrupt");
    if (fclose(head) != 0) fail_path("close", head_path);
    padded = (base_length + 3U) & ~(size_t)3U;
    temporary = malloc(strlen(output_path) + 5);
    if (temporary == NULL) fail("out of memory");
    sprintf(temporary, "%s.tmp", output_path);
    output = fopen(temporary, "wb");
    if (output == NULL) fail_path("create", temporary);
    memset(&package, 0, sizeof(package));
    memcpy(package.magic, package_magic, 8); package.version = 1;
    package.base_length = (uint32_t)base_length;
    package.base_padded_length = (uint32_t)padded;
    package.vocab = base_header.vocab; package.context = base_header.context;
    package.dim = base_header.dim; package.heads = base_header.heads;
    package.layers = base_header.layers; package.ff = base_header.ff;
    package.classes = checkpoint.classes;
    package.feature_dim = checkpoint.feature_dim; package.step = checkpoint.step;
    package.head_parameters = checkpoint.head_parameters;
    exact_write(output, &package, sizeof(package), 1, temporary);
    exact_write(output, base, 1, base_length, temporary);
    while (base_length++ < padded) fputc(0, output);
    exact_write(output, values, sizeof(float), weights + checkpoint.classes,
                temporary);
    if (fclose(output) != 0 || rename(temporary, output_path) != 0)
        fail_path("install", output_path);
    free(values); free(temporary); free(base);
    printf("packaged Q3.2 runtime-trained head at update %llu to %s\n",
           (unsigned long long)checkpoint.step, output_path);
    return EXIT_SUCCESS;
}
