#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LITERARY_INFER_NO_MAIN
#include "literary_infer.c"

static unsigned char *read_model(const char *path, int *length)
{
    FILE *file = fopen(path, "rb");
    unsigned char *data;
    long size;
    if (file == NULL || fseek(file, 0, SEEK_END) != 0 ||
        (size = ftell(file)) < 0 || fseek(file, 0, SEEK_SET) != 0) return NULL;
    data = malloc((size_t)size);
    if (data == NULL || fread(data, 1, (size_t)size, file) != (size_t)size ||
        fclose(file) != 0) { free(data); return NULL; }
    *length = (int)size;
    return data;
}

int main(int argc, char **argv)
{
    unsigned char *data;
    int length;
    int index;
    char style;
    if (argc != 5 || strcmp(argv[2], "--chat") != 0 ||
        strlen(argv[3]) != 1) return EXIT_FAILURE;
    data = read_model(argv[1], &length);
    if (data == NULL || lm_load(data, length) != 0) return EXIT_FAILURE;
    style = argv[3][0];
    lm_feed(CHANNEL_START_TOKEN); lm_feed(style);
    lm_feed(CHANNEL_SUMMARY_TOKEN);
    for (index = 0; argv[4][index] != '\0'; ++index)
        lm_feed((unsigned char)argv[4][index]);
    for (index = 0; index < 8; ++index)
        printf("%.9g\n", lm_probability(index + 32));
    free(data);
    release_working_memory();
    return EXIT_SUCCESS;
}
