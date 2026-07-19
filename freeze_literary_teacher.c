#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum { BUFFER_FLOATS = 16384 };

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t vocab;
    uint32_t context;
    uint32_t dim;
    uint32_t heads;
    uint32_t layers;
    uint32_t ff;
    uint32_t parameter_count;
    uint32_t reserved;
    uint64_t step;
    uint64_t rng_state;
} ArtifactHeader;

typedef struct {
    uint64_t attempts;
    uint32_t consecutive_rejections;
    uint32_t transaction_mode;
} CheckpointOrchestration;

static const char CHECKPOINT_MAGIC[8] =
    {'Z', 'E', 'R', 'O', 'L', 'M', '2', '\0'};
static const char TEACHER_MAGIC[8] =
    {'Z', 'E', 'R', 'O', 'T', 'C', 'H', '1'};

static void fail(const char *action, const char *path)
{
    fprintf(stderr, "error: %s '%s': %s\n", action, path, strerror(errno));
    exit(EXIT_FAILURE);
}

static int copy_floats(FILE *input, FILE *output, uint64_t count,
                       float *buffer)
{
    while (count > 0) {
        size_t chunk = count > BUFFER_FLOATS ? BUFFER_FLOATS : (size_t)count;
        if (fread(buffer, sizeof(float), chunk, input) != chunk ||
            fwrite(buffer, sizeof(float), chunk, output) != chunk) {
            return 0;
        }
        count -= chunk;
    }
    return 1;
}

static int discard_floats(FILE *input, uint64_t count, float *buffer)
{
    while (count > 0) {
        size_t chunk = count > BUFFER_FLOATS ? BUFFER_FLOATS : (size_t)count;
        if (fread(buffer, sizeof(float), chunk, input) != chunk) return 0;
        count -= chunk;
    }
    return 1;
}

int main(int argc, char **argv)
{
    const char *input_path;
    const char *output_path;
    char *temporary_path;
    size_t temporary_length;
    FILE *input;
    FILE *output;
    ArtifactHeader header;
    uint64_t source_step_override = 0;
    int has_source_step_override = 0;
    float *buffer;
    uint32_t parameter;

    if (argc != 3 && argc != 5) {
        fprintf(stderr,
                "usage: %s CHECKPOINT TEACHER_ARTIFACT "
                "[--source-step N]\n"
                "Extract immutable model weights and discard optimizer/RNG "
                "state.\n",
                argv[0]);
        return EXIT_FAILURE;
    }
    if (argc == 5) {
        char *end;
        if (strcmp(argv[3], "--source-step") != 0) {
            fprintf(stderr, "error: expected --source-step N\n");
            return EXIT_FAILURE;
        }
        errno = 0;
        source_step_override = strtoull(argv[4], &end, 10);
        if (errno != 0 || *argv[4] == '\0' || *end != '\0') {
            fprintf(stderr, "error: invalid source step '%s'\n", argv[4]);
            return EXIT_FAILURE;
        }
        has_source_step_override = 1;
    }
    input_path = argv[1];
    output_path = argv[2];
    input = fopen(input_path, "rb");
    if (input == NULL) fail("open", input_path);
    if (fread(&header, sizeof(header), 1, input) != 1 ||
        memcmp(header.magic, CHECKPOINT_MAGIC, sizeof(header.magic)) != 0 ||
        (header.version != 1U && header.version != 2U &&
         header.version != 3U && header.version != 4U) ||
        header.parameter_count == 0) {
        fclose(input);
        fprintf(stderr, "error: unsupported or corrupt checkpoint '%s'\n",
                input_path);
        return EXIT_FAILURE;
    }
    if (header.version >= 4U) {
        CheckpointOrchestration orchestration;
        if (fread(&orchestration, sizeof(orchestration), 1, input) != 1) {
            fclose(input);
            fprintf(stderr, "error: corrupt checkpoint orchestration '%s'\n",
                    input_path);
            return EXIT_FAILURE;
        }
    }

    temporary_length = strlen(output_path) + 5;
    temporary_path = calloc(temporary_length, 1);
    buffer = malloc(BUFFER_FLOATS * sizeof(float));
    if (temporary_path == NULL || buffer == NULL) {
        fclose(input);
        free(temporary_path);
        free(buffer);
        fprintf(stderr, "error: allocation failed\n");
        return EXIT_FAILURE;
    }
    snprintf(temporary_path, temporary_length, "%s.tmp", output_path);
    output = fopen(temporary_path, "wb");
    if (output == NULL) fail("create", temporary_path);

    memcpy(header.magic, TEACHER_MAGIC, sizeof(header.magic));
    header.version = 1U;
    if (has_source_step_override) header.step = source_step_override;
    header.rng_state = 0;
    if (fwrite(&header, sizeof(header), 1, output) != 1) {
        fail("write", temporary_path);
    }
    for (parameter = 0; parameter < header.parameter_count; ++parameter) {
        uint64_t count;
        if (fread(&count, sizeof(count), 1, input) != 1 || count == 0 ||
            fwrite(&count, sizeof(count), 1, output) != 1 ||
            !copy_floats(input, output, count, buffer) ||
            !discard_floats(input, count, buffer) ||
            !discard_floats(input, count, buffer)) {
            fclose(input);
            fclose(output);
            remove(temporary_path);
            fprintf(stderr,
                    "error: corrupt parameter %u in checkpoint '%s'\n",
                    parameter, input_path);
            free(temporary_path);
            free(buffer);
            return EXIT_FAILURE;
        }
    }
    if (fclose(input) != 0) fail("close", input_path);
    if (fclose(output) != 0) fail("close", temporary_path);
    if (rename(temporary_path, output_path) != 0) {
        remove(temporary_path);
        fail("install", output_path);
    }
    printf("froze %s -> %s source-update=%llu parameters=%u\n", input_path,
           output_path, (unsigned long long)header.step,
           header.parameter_count);
    free(temporary_path);
    free(buffer);
    return EXIT_SUCCESS;
}
