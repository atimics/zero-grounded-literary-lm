#include <errno.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    char magic[8];
    uint32_t version, vocab, context, dim, heads, layers, ff;
    uint32_t parameter_count, reserved;
    uint64_t step, rng_state;
} CheckpointHeader;

typedef struct {
    char magic[8];
    uint32_t version, vocab, context, dim, heads, layers, ff;
    uint32_t parameter_count;
    uint64_t step;
} InferenceHeader;

typedef struct {
    uint32_t encoding, rows, columns, count;
} TensorHeader;

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
    memory = malloc(count * size);
    if (memory == NULL) fail("out of memory");
    return memory;
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

static void tensor_shape(const CheckpointHeader *header, int index,
                         uint32_t *rows, uint32_t *columns, int *quantized)
{
    int final_index = 1 + (int)header->layers * 8;
    if (index == 0) {
        *rows = header->vocab;
        *columns = header->dim;
        *quantized = 1;
    } else if (index == final_index) {
        *rows = 1;
        *columns = header->dim;
        *quantized = 0;
    } else {
        int slot = (index - 1) % 8;
        if (slot == 0 || slot == 5) {
            *rows = 1;
            *columns = header->dim;
            *quantized = 0;
        } else if (slot >= 1 && slot <= 4) {
            *rows = header->dim;
            *columns = header->dim;
            *quantized = 1;
        } else if (slot == 6) {
            *rows = header->ff;
            *columns = header->dim;
            *quantized = 1;
        } else {
            *rows = header->dim;
            *columns = header->ff;
            *quantized = 1;
        }
    }
}

static void write_quantized(FILE *output, const float *weights, uint32_t rows,
                            uint32_t columns, const char *path)
{
    float *scales = checked_alloc(rows, sizeof(*scales));
    int8_t *values = checked_alloc((size_t)rows * columns, sizeof(*values));
    uint32_t row;
    for (row = 0; row < rows; ++row) {
        uint32_t column;
        float maximum = 0.0f;
        float scale;
        for (column = 0; column < columns; ++column) {
            float value = fabsf(weights[(size_t)row * columns + column]);
            if (value > maximum) maximum = value;
        }
        scale = maximum > 0.0f ? maximum / 127.0f : 1.0f;
        scales[row] = scale;
        for (column = 0; column < columns; ++column) {
            long value = lrintf(weights[(size_t)row * columns + column] / scale);
            if (value < -127) value = -127;
            if (value > 127) value = 127;
            values[(size_t)row * columns + column] = (int8_t)value;
        }
    }
    write_exact(output, scales, sizeof(*scales), rows, path);
    write_exact(output, values, sizeof(*values), (size_t)rows * columns, path);
    free(scales);
    free(values);
}

int main(int argc, char **argv)
{
    static const char checkpoint_magic[8] =
        {'Z', 'E', 'R', 'O', 'L', 'M', '2', '\0'};
    static const char teacher_magic[8] =
        {'Z', 'E', 'R', 'O', 'T', 'C', 'H', '1'};
    static const char inference_magic[8] =
        {'L', 'I', 'T', 'Q', '8', 'V', '1', '\0'};
    const char *input_path;
    const char *output_path;
    char *temporary;
    FILE *input;
    FILE *output;
    CheckpointHeader checkpoint;
    InferenceHeader inference;
    int weight_only;
    int index;

    if (argc != 3) {
        fprintf(stderr, "usage: %s MODEL_ARTIFACT OUTPUT\n", argv[0]);
        return EXIT_FAILURE;
    }
    input_path = argv[1];
    output_path = argv[2];
    input = fopen(input_path, "rb");
    if (input == NULL) fail_path("open", input_path);
    read_exact(input, &checkpoint, sizeof(checkpoint), 1, input_path);
    weight_only = memcmp(checkpoint.magic, teacher_magic, 8) == 0;
    if ((!weight_only && memcmp(checkpoint.magic, checkpoint_magic, 8) != 0) ||
        (weight_only ? checkpoint.version != 1U
                     : (checkpoint.version < 2 || checkpoint.version > 3)) ||
        (checkpoint.reserved & 1U) == 0 || checkpoint.vocab < 2 ||
        checkpoint.vocab > 2048 || checkpoint.context < 2 ||
        checkpoint.parameter_count != 2 + checkpoint.layers * 8) {
        fclose(input);
        fail("checkpoint is not a supported rotary literary model");
    }

    temporary = checked_alloc(strlen(output_path) + 5, 1);
    sprintf(temporary, "%s.tmp", output_path);
    output = fopen(temporary, "wb");
    if (output == NULL) {
        fclose(input);
        fail_path("create", temporary);
    }
    memset(&inference, 0, sizeof(inference));
    memcpy(inference.magic, inference_magic, 8);
    inference.version = 1;
    inference.vocab = checkpoint.vocab;
    inference.context = checkpoint.context;
    inference.dim = checkpoint.dim;
    inference.heads = checkpoint.heads;
    inference.layers = checkpoint.layers;
    inference.ff = checkpoint.ff;
    inference.parameter_count = checkpoint.parameter_count;
    inference.step = checkpoint.step;
    write_exact(output, &inference, sizeof(inference), 1, temporary);

    for (index = 0; index < (int)checkpoint.parameter_count; ++index) {
        uint64_t file_count;
        uint32_t rows, columns;
        int quantized;
        float *weights;
        TensorHeader tensor;
        read_exact(input, &file_count, sizeof(file_count), 1, input_path);
        tensor_shape(&checkpoint, index, &rows, &columns, &quantized);
        if (file_count != (uint64_t)rows * columns || file_count > SIZE_MAX) {
            fclose(input);
            fclose(output);
            fail("checkpoint tensor shape mismatch");
        }
        weights = checked_alloc((size_t)file_count, sizeof(*weights));
        read_exact(input, weights, sizeof(*weights), (size_t)file_count,
                   input_path);
        if (!weight_only &&
            fseek(input, (long)(2 * file_count * sizeof(float)), SEEK_CUR) != 0) {
            fclose(input);
            fclose(output);
            fail_path("skip optimizer state in", input_path);
        }
        tensor.encoding = quantized ? 1U : 0U;
        tensor.rows = rows;
        tensor.columns = columns;
        tensor.count = (uint32_t)file_count;
        write_exact(output, &tensor, sizeof(tensor), 1, temporary);
        if (quantized) {
            write_quantized(output, weights, rows, columns, temporary);
        } else {
            write_exact(output, weights, sizeof(*weights), (size_t)file_count,
                        temporary);
        }
        free(weights);
    }
    if (fclose(input) != 0) fail_path("close", input_path);
    if (fclose(output) != 0) fail_path("close", temporary);
    if (rename(temporary, output_path) != 0) fail_path("install", output_path);
    free(temporary);
    printf("exported %s at update %llu to %s\n", input_path,
           (unsigned long long)checkpoint.step, output_path);
    return EXIT_SUCCESS;
}
