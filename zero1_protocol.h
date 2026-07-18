#ifndef ZERO1_PROTOCOL_H
#define ZERO1_PROTOCOL_H

#include <stdint.h>

enum {
    ZERO1_CONTEXT = 16,
    ZERO1_EMBED = 12,
    ZERO1_HIDDEN = 32,
    ZERO1_MAX_VOCAB = 256,
    ZERO1_CHECKPOINT_VERSION = 1
};

typedef struct {
    char magic[8];
    uint32_t version;
    uint32_t vocab;
    uint32_t context;
    uint32_t embed;
    uint32_t hidden;
    uint64_t step;
    unsigned char token_to_char[ZERO1_MAX_VOCAB];
} Zero1CheckpointHeader;

static const char ZERO1_CHECKPOINT_MAGIC[8] = {
    'Z', 'E', 'R', 'O', '1', 'T', '1', '\0'
};

#endif
