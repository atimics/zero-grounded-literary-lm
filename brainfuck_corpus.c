#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"

/*
 * brainfuck_corpus.c -- deterministic, interpreter-checked Brainfuck data.
 *
 * The generator constructs terminating programs from bounded templates and
 * then executes every example with the same strict interpreter used by
 * --verify.  The final validation tail uses program shapes that never occur
 * in the training region.  A model-facing uint16 channel stream masks loss to
 * the checked artifact, while the text form remains independently readable.
 */

#define TAPE_CELLS 32
#define PROGRAM_CAPACITY 256
#define IO_CAPACITY 64
#define TEXT_CAPACITY 1024
#define MAX_STEPS 100000
#define TRACE_CAPACITY 2048
#define MODEL_CONTEXT 512
#define RECORD_TOKENS (MODEL_CONTEXT + 1)

typedef uint16_t Token;

typedef struct {
    uint64_t state;
} Rng;

typedef struct {
    unsigned char tape[TAPE_CELLS];
    unsigned char output[IO_CAPACITY];
    size_t output_length;
    int pointer;
    long steps;
} Execution;

typedef struct {
    unsigned char tape[TAPE_CELLS];
    unsigned char output[IO_CAPACITY];
    size_t output_length;
    size_t input_position;
    size_t ip;
    int pointer;
    long steps;
    int halted;
} MachineState;

typedef struct {
    MachineState states[TRACE_CAPACITY];
    size_t count;
} MachineTrace;

typedef struct {
    int version;
    char task[24];
    char split[16];
    char prompt[160];
    char program[PROGRAM_CAPACITY];
    char input[IO_CAPACITY * 2 + 2];
    char expect[IO_CAPACITY * 2 + 2];
    char artifact[PROGRAM_CAPACITY + 128];
    char result[16];
    long episode;
    long chunk;
    long start;
    long advance;
    char memory[256];
    char summary[256];
} Record;

typedef struct {
    char program[PROGRAM_CAPACITY];
    unsigned char input[IO_CAPACITY];
    size_t input_length;
    char description[128];
    int held_out;
} GeneratedProgram;

typedef struct {
    char *data;
    size_t capacity;
    size_t length;
    int overflow;
} Writer;

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

static long parse_long(const char *text, const char *option)
{
    char *end = NULL;
    long value;
    errno = 0;
    value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0') {
        fprintf(stderr, "error: invalid integer for %s: '%s'\n", option,
                text);
        exit(EXIT_FAILURE);
    }
    return value;
}

static uint64_t rng_next(Rng *rng)
{
    uint64_t x = rng->state;
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    rng->state = x;
    return x * UINT64_C(2685821657736338717);
}

static unsigned rng_bounded(Rng *rng, unsigned bound)
{
    return bound == 0 ? 0 : (unsigned)(rng_next(rng) % bound);
}

static void writer_init(Writer *writer, char *data, size_t capacity)
{
    writer->data = data;
    writer->capacity = capacity;
    writer->length = 0;
    writer->overflow = 0;
    if (capacity != 0) data[0] = '\0';
}

static void writer_char(Writer *writer, char value)
{
    if (writer->length + 1 >= writer->capacity) {
        writer->overflow = 1;
        return;
    }
    writer->data[writer->length++] = value;
    writer->data[writer->length] = '\0';
}

static void writer_text(Writer *writer, const char *text)
{
    while (*text != '\0') writer_char(writer, *text++);
}

static void writer_repeat(Writer *writer, char value, int count)
{
    int i;
    for (i = 0; i < count; ++i) writer_char(writer, value);
}

static int brainfuck_command(int character)
{
    return character == '>' || character == '<' || character == '+' ||
           character == '-' || character == '.' || character == ',' ||
           character == '[' || character == ']';
}

static int execute(const char *program, const unsigned char *input,
                   size_t input_length, Execution *execution,
                   char *error, size_t error_capacity)
{
    int jumps[PROGRAM_CAPACITY];
    int stack[PROGRAM_CAPACITY];
    int stack_count = 0;
    size_t length = strlen(program);
    size_t input_position = 0;
    size_t ip = 0;
    size_t i;

    memset(execution, 0, sizeof(*execution));
    if (length == 0 || length >= PROGRAM_CAPACITY) {
        snprintf(error, error_capacity, "program length is outside 1..%d",
                 PROGRAM_CAPACITY - 1);
        return 0;
    }
    for (i = 0; i < length; ++i) {
        jumps[i] = -1;
        if (!brainfuck_command((unsigned char)program[i])) {
            snprintf(error, error_capacity,
                     "non-Brainfuck byte at program position %zu", i);
            return 0;
        }
        if (program[i] == '[') {
            stack[stack_count++] = (int)i;
        } else if (program[i] == ']') {
            int open;
            if (stack_count == 0) {
                snprintf(error, error_capacity,
                         "unmatched close bracket at position %zu", i);
                return 0;
            }
            open = stack[--stack_count];
            jumps[open] = (int)i;
            jumps[i] = open;
        }
    }
    if (stack_count != 0) {
        snprintf(error, error_capacity, "unmatched open bracket");
        return 0;
    }

    while (ip < length) {
        unsigned char *cell;
        if (++execution->steps > MAX_STEPS) {
            snprintf(error, error_capacity, "step limit exceeded");
            return 0;
        }
        cell = &execution->tape[execution->pointer];
        switch (program[ip]) {
        case '>':
            if (++execution->pointer == TAPE_CELLS) {
                snprintf(error, error_capacity, "pointer overflow");
                return 0;
            }
            ++ip;
            break;
        case '<':
            if (--execution->pointer < 0) {
                snprintf(error, error_capacity, "pointer underflow");
                return 0;
            }
            ++ip;
            break;
        case '+':
            *cell = (unsigned char)(*cell + 1U);
            ++ip;
            break;
        case '-':
            *cell = (unsigned char)(*cell - 1U);
            ++ip;
            break;
        case '.':
            if (execution->output_length == IO_CAPACITY) {
                snprintf(error, error_capacity, "output limit exceeded");
                return 0;
            }
            execution->output[execution->output_length++] = *cell;
            ++ip;
            break;
        case ',':
            *cell = input_position < input_length ? input[input_position++] : 0;
            ++ip;
            break;
        case '[':
            ip = *cell == 0 ? (size_t)jumps[ip] + 1 : ip + 1;
            break;
        case ']':
            ip = *cell != 0 ? (size_t)jumps[ip] + 1 : ip + 1;
            break;
        default:
            snprintf(error, error_capacity, "internal interpreter error");
            return 0;
        }
    }
    return 1;
}

static int compile_jumps(const char *program, int *jumps, size_t *length,
                         char *error, size_t error_capacity)
{
    int stack[PROGRAM_CAPACITY];
    int stack_count = 0;
    size_t i;
    *length = strlen(program);
    if (*length == 0 || *length >= PROGRAM_CAPACITY) {
        snprintf(error, error_capacity, "program length is outside 1..%d",
                 PROGRAM_CAPACITY - 1);
        return 0;
    }
    for (i = 0; i < *length; ++i) {
        jumps[i] = -1;
        if (!brainfuck_command((unsigned char)program[i])) {
            snprintf(error, error_capacity,
                     "non-Brainfuck byte at program position %zu", i);
            return 0;
        }
        if (program[i] == '[') {
            stack[stack_count++] = (int)i;
        } else if (program[i] == ']') {
            int open;
            if (stack_count == 0) {
                snprintf(error, error_capacity,
                         "unmatched close bracket at position %zu", i);
                return 0;
            }
            open = stack[--stack_count];
            jumps[open] = (int)i;
            jumps[i] = open;
        }
    }
    if (stack_count != 0) {
        snprintf(error, error_capacity, "unmatched open bracket");
        return 0;
    }
    return 1;
}

static int machine_step(const char *program, size_t program_length,
                        const int *jumps, const unsigned char *input,
                        size_t input_length, MachineState *state,
                        char *error, size_t error_capacity)
{
    unsigned char *cell;
    if (state->halted || state->ip >= program_length) {
        state->halted = 1;
        return 1;
    }
    if (++state->steps > MAX_STEPS) {
        snprintf(error, error_capacity, "step limit exceeded");
        return 0;
    }
    cell = &state->tape[state->pointer];
    switch (program[state->ip]) {
    case '>':
        if (++state->pointer == TAPE_CELLS) {
            snprintf(error, error_capacity, "pointer overflow");
            return 0;
        }
        ++state->ip;
        break;
    case '<':
        if (--state->pointer < 0) {
            snprintf(error, error_capacity, "pointer underflow");
            return 0;
        }
        ++state->ip;
        break;
    case '+':
        *cell = (unsigned char)(*cell + 1U);
        ++state->ip;
        break;
    case '-':
        *cell = (unsigned char)(*cell - 1U);
        ++state->ip;
        break;
    case '.':
        if (state->output_length == IO_CAPACITY) {
            snprintf(error, error_capacity, "output limit exceeded");
            return 0;
        }
        state->output[state->output_length++] = *cell;
        ++state->ip;
        break;
    case ',':
        *cell = state->input_position < input_length
                    ? input[state->input_position++]
                    : 0;
        ++state->ip;
        break;
    case '[':
        state->ip = *cell == 0 ? (size_t)jumps[state->ip] + 1 : state->ip + 1;
        break;
    case ']':
        state->ip = *cell != 0 ? (size_t)jumps[state->ip] + 1 : state->ip + 1;
        break;
    default:
        snprintf(error, error_capacity, "internal interpreter error");
        return 0;
    }
    state->halted = state->ip >= program_length;
    return 1;
}

static int trace_program(const char *program, const unsigned char *input,
                         size_t input_length, MachineTrace *trace,
                         char *error, size_t error_capacity)
{
    int jumps[PROGRAM_CAPACITY];
    size_t program_length;
    MachineState state;
    if (!compile_jumps(program, jumps, &program_length, error,
                       error_capacity)) {
        return 0;
    }
    memset(&state, 0, sizeof(state));
    trace->count = 0;
    trace->states[trace->count++] = state;
    while (!state.halted) {
        if (trace->count == TRACE_CAPACITY) {
            snprintf(error, error_capacity, "trace capacity exceeded");
            return 0;
        }
        if (!machine_step(program, program_length, jumps, input, input_length,
                          &state, error, error_capacity)) {
            return 0;
        }
        trace->states[trace->count++] = state;
    }
    return 1;
}

static void hex_encode(const unsigned char *bytes, size_t length, char *output,
                       size_t capacity)
{
    static const char digits[] = "0123456789abcdef";
    size_t i;
    if (length == 0) {
        if (capacity < 2) fail("hex output buffer too small");
        strcpy(output, "-");
        return;
    }
    if (length * 2 + 1 > capacity) fail("hex output buffer too small");
    for (i = 0; i < length; ++i) {
        output[i * 2] = digits[bytes[i] >> 4];
        output[i * 2 + 1] = digits[bytes[i] & 15];
    }
    output[length * 2] = '\0';
}

static int hex_digit(int character)
{
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
}

static int hex_decode(const char *text, unsigned char *bytes, size_t *length,
                      char *error, size_t error_capacity)
{
    size_t text_length;
    size_t i;
    if (strcmp(text, "-") == 0) {
        *length = 0;
        return 1;
    }
    text_length = strlen(text);
    if (text_length == 0 || text_length % 2 != 0 ||
        text_length / 2 > IO_CAPACITY) {
        snprintf(error, error_capacity, "invalid hex byte string");
        return 0;
    }
    for (i = 0; i < text_length; i += 2) {
        int high = hex_digit((unsigned char)text[i]);
        int low = hex_digit((unsigned char)text[i + 1]);
        if (high < 0 || low < 0) {
            snprintf(error, error_capacity, "invalid hex byte string");
            return 0;
        }
        bytes[i / 2] = (unsigned char)((high << 4) | low);
    }
    *length = text_length / 2;
    return 1;
}

static void execution_trace(const Execution *execution, char *text,
                            size_t capacity)
{
    char output[IO_CAPACITY * 2 + 2];
    hex_encode(execution->output, execution->output_length, output,
               sizeof(output));
    snprintf(text, capacity,
             "pointer %d cells %02x,%02x,%02x,%02x output %s steps %ld",
             execution->pointer, execution->tape[0], execution->tape[1],
             execution->tape[2], execution->tape[3], output, execution->steps);
}

static void machine_state_text(const MachineState *state, const char *program,
                               char *text, size_t capacity)
{
    char output[IO_CAPACITY * 2 + 2];
    char operation = state->halted ? 'H' : program[state->ip];
    hex_encode(state->output, state->output_length, output, sizeof(output));
    snprintf(text, capacity,
             "step %ld ip %zu op %c ptr %d cells %02x,%02x,%02x,%02x in %zu out %s halt %d",
             state->steps, state->ip, operation, state->pointer,
             state->tape[0], state->tape[1], state->tape[2], state->tape[3],
             state->input_position, output, state->halted);
}

static void state_memory(const MachineState *state, const char *program,
                         char *text, size_t capacity)
{
    char state_text[224];
    machine_state_text(state, program, state_text, sizeof(state_text));
    snprintf(text, capacity, "bf2 %s", state_text);
}

static size_t select_chain_start(const MachineTrace *trace,
                                 const char *program, size_t limit, Rng *rng)
{
    static const char operations[] = "><+-.,[]";
    unsigned char available[8] = {0};
    unsigned class_count = 0;
    unsigned chosen_class;
    unsigned occurrence_count = 0;
    unsigned chosen_occurrence;
    size_t index;
    int operation;
    for (index = 0; index < limit; ++index) {
        const char *found = strchr(operations, program[trace->states[index].ip]);
        if (found != NULL) available[found - operations] = 1;
    }
    for (operation = 0; operation < 8; ++operation) {
        if (available[operation]) ++class_count;
    }
    if (class_count == 0) fail("trace has no valid transition-chain start");
    chosen_class = rng_bounded(rng, class_count);
    for (operation = 0; operation < 8; ++operation) {
        if (available[operation] && chosen_class-- == 0) break;
    }
    for (index = 0; index < limit; ++index) {
        if (program[trace->states[index].ip] == operations[operation]) {
            ++occurrence_count;
        }
    }
    chosen_occurrence = rng_bounded(rng, occurrence_count);
    for (index = 0; index < limit; ++index) {
        if (program[trace->states[index].ip] == operations[operation] &&
            chosen_occurrence-- == 0) {
            return index;
        }
    }
    fail("could not select transition-chain start");
    return 0;
}

static void generate_training_program(int shape, Rng *rng,
                                      GeneratedProgram *generated)
{
    Writer writer;
    int a;
    int b;
    writer_init(&writer, generated->program, sizeof(generated->program));
    generated->input_length = 0;
    generated->held_out = 0;
    switch (shape) {
    case 0:
        a = (int)rng_bounded(rng, 25);
        writer_text(&writer, "[-]");
        writer_repeat(&writer, '+', a);
        writer_char(&writer, '.');
        snprintf(generated->description, sizeof(generated->description),
                 "emit constant %d by direct cell construction", a);
        break;
    case 1:
        a = (int)rng_bounded(rng, 64);
        b = (int)rng_bounded(rng, 12) + 1;
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_char(&writer, ',');
        if (rng_bounded(rng, 2) == 0) {
            writer_repeat(&writer, '+', b);
            snprintf(generated->description, sizeof(generated->description),
                     "read one byte add %d and emit", b);
        } else {
            writer_repeat(&writer, '-', b);
            snprintf(generated->description, sizeof(generated->description),
                     "read one byte subtract %d and emit", b);
        }
        writer_char(&writer, '.');
        break;
    case 2:
        a = (int)rng_bounded(rng, 32);
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_text(&writer, ",[->+<]>.");
        snprintf(generated->description, sizeof(generated->description),
                 "transfer one input byte to the right cell and emit");
        break;
    case 3:
        a = (int)rng_bounded(rng, 7) + 2;
        b = (int)rng_bounded(rng, 7) + 2;
        writer_repeat(&writer, '+', a);
        writer_text(&writer, "[>");
        writer_repeat(&writer, '+', b);
        writer_text(&writer, "<-]>.");
        snprintf(generated->description, sizeof(generated->description),
                 "multiply constants %d and %d with one loop", a, b);
        break;
    case 4:
        a = (int)rng_bounded(rng, 64);
        b = (int)rng_bounded(rng, 25);
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_text(&writer, ",[-]");
        writer_repeat(&writer, '+', b);
        writer_char(&writer, '.');
        snprintf(generated->description, sizeof(generated->description),
                 "clear one input byte then emit constant %d", b);
        break;
    default:
        a = (int)rng_bounded(rng, 25);
        writer_char(&writer, '>');
        writer_repeat(&writer, '+', a);
        writer_char(&writer, '.');
        snprintf(generated->description, sizeof(generated->description),
                 "move right then emit constant %d", a);
        break;
    }
    if (writer.overflow) fail("generated training program overflow");
}

static void generate_validation_program(int shape, Rng *rng,
                                        GeneratedProgram *generated)
{
    Writer writer;
    int a;
    int b;
    int c;
    writer_init(&writer, generated->program, sizeof(generated->program));
    generated->input_length = 0;
    generated->held_out = 1;
    switch (shape) {
    case 0:
        a = (int)rng_bounded(rng, 25);
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_text(&writer, ",[->++<]>.");
        snprintf(generated->description, sizeof(generated->description),
                 "double one input byte through a transfer loop");
        break;
    case 1:
        a = (int)rng_bounded(rng, 25);
        b = (int)rng_bounded(rng, 25);
        generated->input[0] = (unsigned char)a;
        generated->input[1] = (unsigned char)b;
        generated->input_length = 2;
        writer_text(&writer, ",>,<[->+<]>.");
        snprintf(generated->description, sizeof(generated->description),
                 "sum two input bytes in the second cell and emit");
        break;
    case 2:
        a = (int)rng_bounded(rng, 3) + 2;
        b = (int)rng_bounded(rng, 3) + 2;
        c = (int)rng_bounded(rng, 3) + 2;
        writer_repeat(&writer, '+', a);
        writer_text(&writer, "[>");
        writer_repeat(&writer, '+', b);
        writer_text(&writer, "[>");
        writer_repeat(&writer, '+', c);
        writer_text(&writer, "<-]<-]>>.");
        snprintf(generated->description, sizeof(generated->description),
                 "multiply constants %d %d %d with nested loops", a, b, c);
        break;
    case 3:
        a = (int)rng_bounded(rng, 21);
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_text(&writer, ",[->+>+<<]>>[-<<+>>]<.");
        snprintf(generated->description, sizeof(generated->description),
                 "copy and restore one input byte before emitting the copy");
        break;
    default:
        a = (int)rng_bounded(rng, 8) + 1;
        generated->input[0] = (unsigned char)a;
        generated->input_length = 1;
        writer_text(&writer, ",[.-]");
        snprintf(generated->description, sizeof(generated->description),
                 "emit an input countdown through a decreasing loop");
        break;
    }
    if (writer.overflow) fail("generated validation program overflow");
}

static void broken_program(const char *program, char *broken, size_t capacity)
{
    size_t length = strlen(program);
    size_t i;
    if (length + 1 > capacity) fail("broken program buffer too small");
    strcpy(broken, program);
    for (i = length; i > 0; --i) {
        if (broken[i - 1] == '.') {
            memmove(broken + i - 1, broken + i, length - i + 1);
            return;
        }
    }
    fail("generated program has no output command to remove");
}

static void build_record(long index, long training_records, Rng *rng,
                         Record *record)
{
    GeneratedProgram generated;
    Execution execution;
    char error[128];
    char trace[256];
    char broken[PROGRAM_CAPACITY];
    int held_out = index >= training_records;
    int task = (int)((index + (long)rng_bounded(rng, 4)) % 4);
    int shape = (int)rng_bounded(rng, held_out ? 5U : 6U);

    memset(record, 0, sizeof(*record));
    record->version = 1;
    if (held_out) {
        generate_validation_program(shape, rng, &generated);
        strcpy(record->split, "validation");
    } else {
        generate_training_program(shape, rng, &generated);
        strcpy(record->split, "train");
    }
    if (!execute(generated.program, generated.input, generated.input_length,
                 &execution, error, sizeof(error))) {
        fprintf(stderr, "generated program failed: %s (%s)\n", error,
                generated.program);
        exit(EXIT_FAILURE);
    }
    hex_encode(generated.input, generated.input_length, record->input,
               sizeof(record->input));
    hex_encode(execution.output, execution.output_length, record->expect,
               sizeof(record->expect));
    snprintf(record->prompt, sizeof(record->prompt), "%s",
             generated.description);
    strcpy(record->result, "valid");

    if (task == 0) {
        strcpy(record->task, "execute");
        strcpy(record->program, generated.program);
        snprintf(record->artifact, sizeof(record->artifact), "output %s",
                 record->expect);
    } else if (task == 1) {
        strcpy(record->task, "trace");
        strcpy(record->program, generated.program);
        execution_trace(&execution, trace, sizeof(trace));
        snprintf(record->artifact, sizeof(record->artifact), "%s", trace);
    } else if (task == 2) {
        strcpy(record->task, "synthesize");
        strcpy(record->program, "-");
        snprintf(record->artifact, sizeof(record->artifact), "program %s",
                 generated.program);
    } else {
        strcpy(record->task, "repair");
        broken_program(generated.program, broken, sizeof(broken));
        strcpy(record->program, broken);
        snprintf(record->artifact, sizeof(record->artifact), "program %s",
                 generated.program);
    }
}

static void build_trace_record(long index, long training_records, long seed,
                               Record *record)
{
    GeneratedProgram generated;
    MachineTrace trace;
    Rng rng;
    char error[160];
    char broken[PROGRAM_CAPACITY];
    size_t final_index;
    size_t block_advance;
    size_t chain_start;
    size_t target_index;
    int held_out = index >= training_records;
    int attempt;

    memset(record, 0, sizeof(*record));
    record->version = 2;
    record->episode = index / 6;
    record->chunk = index % 6;
    rng.state = (uint64_t)seed ^
                (UINT64_C(0x9e3779b97f4a7c15) *
                 (uint64_t)(record->episode + 1));
    if (rng.state == 0) rng.state = UINT64_C(1);

    for (attempt = 0; attempt < 128; ++attempt) {
        int shape = (int)rng_bounded(&rng, held_out ? 5U : 6U);
        if (held_out) generate_validation_program(shape, &rng, &generated);
        else generate_training_program(shape, &rng, &generated);
        if (!trace_program(generated.program, generated.input,
                           generated.input_length, &trace, error,
                           sizeof(error))) {
            fprintf(stderr, "generated trace failed: %s (%s)\n", error,
                    generated.program);
            exit(EXIT_FAILURE);
        }
        if (trace.count >= 13) break;
    }
    if (attempt == 128) fail("could not generate a sufficiently long trace");

    strcpy(record->split, held_out ? "validation" : "train");
    strcpy(record->program, generated.program);
    strcpy(record->result, "valid");
    hex_encode(generated.input, generated.input_length, record->input,
               sizeof(record->input));
    final_index = trace.count - 1;
    hex_encode(trace.states[final_index].output,
               trace.states[final_index].output_length, record->expect,
               sizeof(record->expect));

    block_advance = 2 + rng_bounded(&rng, 7);
    chain_start = select_chain_start(
        &trace, generated.program, final_index - (2 + block_advance), &rng);
    if (record->chunk == 0) {
        strcpy(record->task, "transition");
        record->start = (long)chain_start;
        record->advance = 1;
        snprintf(record->prompt, sizeof(record->prompt),
                 "advance one instruction; program %s input %s",
                 generated.program, record->input);
    } else if (record->chunk == 1) {
        strcpy(record->task, "transition");
        record->start = (long)chain_start + 1;
        record->advance = 1;
        snprintf(record->prompt, sizeof(record->prompt),
                 "advance one instruction; program %s input %s",
                 generated.program, record->input);
    } else if (record->chunk == 2) {
        strcpy(record->task, "block");
        record->start = (long)chain_start + 2;
        record->advance = (long)block_advance;
        snprintf(record->prompt, sizeof(record->prompt),
                 "compose next %ld instructions; program %s input %s",
                 record->advance, generated.program, record->input);
    } else if (record->chunk == 3) {
        strcpy(record->task, "complete");
        record->start = (long)(chain_start + 2 + block_advance);
        record->advance = (long)final_index - record->start;
        snprintf(record->prompt, sizeof(record->prompt),
                 "complete execution from summarized state; program %s input %s",
                 generated.program, record->input);
    } else if (record->chunk == 4) {
        record->start = 0;
        record->advance = (long)final_index;
        if ((record->episode & 1) == 0) {
            strcpy(record->task, "execute");
            snprintf(record->prompt, sizeof(record->prompt),
                     "execute whole program %s input %s", generated.program,
                     record->input);
        } else {
            strcpy(record->task, "trace");
            snprintf(record->prompt, sizeof(record->prompt),
                     "trace whole program %s input %s to final state",
                     generated.program, record->input);
        }
    } else {
        record->start = 0;
        record->advance = (long)final_index;
        if ((record->episode & 1) == 0) {
            strcpy(record->task, "synthesize");
            strcpy(record->program, "-");
            snprintf(record->prompt, sizeof(record->prompt),
                     "synthesize %s input %s required-output %s",
                     generated.description, record->input, record->expect);
        } else {
            strcpy(record->task, "repair");
            broken_program(generated.program, broken, sizeof(broken));
            strcpy(record->program, broken);
            snprintf(record->prompt, sizeof(record->prompt),
                     "repair program %s input %s required-output %s", broken,
                     record->input, record->expect);
        }
    }

    target_index = (size_t)(record->start + record->advance);
    state_memory(&trace.states[record->start], generated.program,
                 record->memory, sizeof(record->memory));
    state_memory(&trace.states[target_index], generated.program,
                 record->summary, sizeof(record->summary));
    if (strcmp(record->task, "transition") == 0 ||
        strcmp(record->task, "block") == 0 ||
        strcmp(record->task, "trace") == 0) {
        char state_text[224];
        machine_state_text(&trace.states[target_index], generated.program,
                           state_text, sizeof(state_text));
        snprintf(record->artifact, sizeof(record->artifact), "state %s",
                 state_text);
    } else if (strcmp(record->task, "complete") == 0 ||
               strcmp(record->task, "execute") == 0) {
        snprintf(record->artifact, sizeof(record->artifact), "output %s",
                 record->expect);
    } else {
        snprintf(record->artifact, sizeof(record->artifact), "program %s",
                 generated.program);
    }
}

static int verify_record(const Record *record, char *error,
                         size_t error_capacity)
{
    unsigned char input[IO_CAPACITY];
    unsigned char expected[IO_CAPACITY];
    size_t input_length = 0;
    size_t expected_length = 0;
    Execution execution;
    MachineTrace machine_trace;
    const char *candidate = record->program;
    char expected_artifact[PROGRAM_CAPACITY + 128];
    char trace[256];
    char expected_memory[256];
    char expected_summary[256];

    if (record->version != 1 && record->version != 2) {
        snprintf(error, error_capacity, "invalid corpus version");
        return 0;
    }
    if (record->version == 2 &&
        (record->episode < 0 || record->chunk < 0 || record->chunk >= 6)) {
        snprintf(error, error_capacity, "invalid episode or chunk");
        return 0;
    }
    if (strcmp(record->split, "train") != 0 &&
        strcmp(record->split, "validation") != 0) {
        snprintf(error, error_capacity, "invalid split");
        return 0;
    }
    if (strcmp(record->result, "valid") != 0 || record->prompt[0] == '\0') {
        snprintf(error, error_capacity, "missing prompt or valid result");
        return 0;
    }
    if (!hex_decode(record->input, input, &input_length, error,
                    error_capacity) ||
        !hex_decode(record->expect, expected, &expected_length, error,
                    error_capacity)) {
        return 0;
    }
    if (strcmp(record->task, "synthesize") == 0 ||
        strcmp(record->task, "repair") == 0) {
        static const char prefix[] = "program ";
        if (strncmp(record->artifact, prefix, sizeof(prefix) - 1) != 0) {
            snprintf(error, error_capacity, "program artifact is missing");
            return 0;
        }
        candidate = record->artifact + sizeof(prefix) - 1;
        if (strcmp(record->task, "repair") == 0 &&
            strcmp(candidate, record->program) == 0) {
            snprintf(error, error_capacity, "repair did not change program");
            return 0;
        }
    } else if (strcmp(record->task, "execute") != 0 &&
               strcmp(record->task, "trace") != 0 &&
               !(record->version == 2 &&
                 (strcmp(record->task, "transition") == 0 ||
                  strcmp(record->task, "block") == 0 ||
                  strcmp(record->task, "complete") == 0))) {
        snprintf(error, error_capacity, "unknown task");
        return 0;
    }
    if (!execute(candidate, input, input_length, &execution, error,
                 error_capacity)) {
        return 0;
    }
    if (execution.output_length != expected_length ||
        memcmp(execution.output, expected, expected_length) != 0) {
        snprintf(error, error_capacity, "program output does not match @expect");
        return 0;
    }
    if (record->version == 2) {
        size_t final_index;
        size_t target_index;
        if (!trace_program(candidate, input, input_length, &machine_trace,
                           error, error_capacity)) {
            return 0;
        }
        final_index = machine_trace.count - 1;
        if (record->start < 0 || record->advance < 0 ||
            (size_t)record->start > final_index ||
            (size_t)(record->start + record->advance) > final_index) {
            snprintf(error, error_capacity, "trace span is outside execution");
            return 0;
        }
        target_index = (size_t)(record->start + record->advance);
        if (strcmp(record->task, "transition") == 0 && record->advance != 1) {
            snprintf(error, error_capacity, "transition must advance one step");
            return 0;
        }
        if ((strcmp(record->task, "complete") == 0 ||
             strcmp(record->task, "execute") == 0 ||
             strcmp(record->task, "trace") == 0 ||
             strcmp(record->task, "synthesize") == 0 ||
             strcmp(record->task, "repair") == 0) &&
            target_index != final_index) {
            snprintf(error, error_capacity, "completion task does not halt");
            return 0;
        }
        state_memory(&machine_trace.states[record->start], candidate,
                     expected_memory, sizeof(expected_memory));
        state_memory(&machine_trace.states[target_index], candidate,
                     expected_summary, sizeof(expected_summary));
        if (strcmp(record->memory, expected_memory) != 0) {
            snprintf(error, error_capacity, "rolling memory state mismatch");
            return 0;
        }
        if (strcmp(record->summary, expected_summary) != 0) {
            snprintf(error, error_capacity, "rolling summary state mismatch");
            return 0;
        }
    }
    if (strcmp(record->task, "execute") == 0 ||
        strcmp(record->task, "complete") == 0) {
        snprintf(expected_artifact, sizeof(expected_artifact), "output %s",
                 record->expect);
        if (strcmp(record->artifact, expected_artifact) != 0) {
            snprintf(error, error_capacity, "output artifact mismatch");
            return 0;
        }
    } else if (strcmp(record->task, "trace") == 0) {
        if (record->version == 2) {
            machine_state_text(&machine_trace.states[machine_trace.count - 1],
                               candidate, trace, sizeof(trace));
            snprintf(expected_artifact, sizeof(expected_artifact), "state %s",
                     trace);
        } else {
            execution_trace(&execution, trace, sizeof(trace));
            snprintf(expected_artifact, sizeof(expected_artifact), "%s", trace);
        }
        if (strcmp(record->artifact, expected_artifact) != 0) {
            snprintf(error, error_capacity, "trace artifact mismatch");
            return 0;
        }
    } else if (record->version == 2 &&
               (strcmp(record->task, "transition") == 0 ||
                strcmp(record->task, "block") == 0)) {
        size_t target_index = (size_t)(record->start + record->advance);
        machine_state_text(&machine_trace.states[target_index], candidate, trace,
                           sizeof(trace));
        snprintf(expected_artifact, sizeof(expected_artifact), "state %s", trace);
        if (strcmp(record->artifact, expected_artifact) != 0) {
            snprintf(error, error_capacity, "composed state artifact mismatch");
            return 0;
        }
    }
    return 1;
}

static void write_text_record(FILE *file, const Record *record)
{
    int result;
    if (record->version == 2) {
        result = fprintf(file,
                         "@brainfuck bf2\n"
                         "@split %s\n"
                         "@episode %ld\n"
                         "@chunk %ld\n"
                         "@task %s\n"
                         "@prompt %s\n"
                         "@program %s\n"
                         "@input %s\n"
                         "@expect %s\n"
                         "@start %ld\n"
                         "@advance %ld\n"
                         "@memory %s\n"
                         "@artifact %s\n"
                         "@summary %s\n"
                         "@result %s\n"
                         "@end\n\n",
                         record->split, record->episode, record->chunk,
                         record->task, record->prompt, record->program,
                         record->input, record->expect, record->start,
                         record->advance, record->memory, record->artifact,
                         record->summary, record->result);
    } else {
        result = fprintf(file,
                         "@brainfuck bf1\n"
                         "@split %s\n"
                         "@task %s\n"
                         "@prompt %s\n"
                         "@program %s\n"
                         "@input %s\n"
                         "@expect %s\n"
                         "@artifact %s\n"
                         "@result %s\n"
                         "@end\n\n",
                         record->split, record->task, record->prompt,
                         record->program, record->input, record->expect,
                         record->artifact, record->result);
    }
    if (result < 0) {
        fail("could not write text corpus");
    }
}

static void token_append(Token *tokens, size_t *length, Token token)
{
    if (*length == RECORD_TOKENS) fail("Brainfuck channel record overflow");
    tokens[(*length)++] = token;
}

static void token_text(Token *tokens, size_t *length, const char *text)
{
    while (*text != '\0') {
        unsigned char value = (unsigned char)*text++;
        if (value < 32 || value >= 127) value = ' ';
        token_append(tokens, length, value);
    }
}

static void write_token_record(FILE *file, const Record *record)
{
    Token tokens[RECORD_TOKENS];
    size_t length = 0;
    char prompt[TEXT_CAPACITY];
    char target[TEXT_CAPACITY];

    if (record->version == 2) {
        snprintf(prompt, sizeof(prompt), "%s", record->prompt);
    } else if (strcmp(record->task, "synthesize") == 0) {
        snprintf(prompt, sizeof(prompt),
                 "synthesize %s input %s required-output %s", record->prompt,
                 record->input, record->expect);
    } else if (strcmp(record->task, "repair") == 0) {
        snprintf(prompt, sizeof(prompt),
                 "repair program %s input %s required-output %s", record->program,
                 record->input, record->expect);
    } else {
        snprintf(prompt, sizeof(prompt), "%s program %s input %s",
                 record->task, record->program, record->input);
    }
    if (record->version == 2) {
        snprintf(target, sizeof(target), "@artifact %s @summary %s @close",
                 record->artifact, record->summary);
    } else {
        snprintf(target, sizeof(target),
                 "@artifact %s @summary interpreter-verified %s %s @close",
                 record->artifact, record->split, record->task);
    }

    token_append(tokens, &length, CHANNEL_START_TOKEN);
    token_append(tokens, &length, 'K');
    token_append(tokens, &length, CHANNEL_SUMMARY_TOKEN);
    token_text(tokens, &length,
               record->version == 2
                   ? record->memory
                   : "brainfuck channel uses strict bounded 8-bit semantics");
    token_append(tokens, &length, CHANNEL_MESSAGE_END_TOKEN);
    token_append(tokens, &length, CHANNEL_MESSAGE_TOKEN);
    token_append(tokens, &length, 'U');
    token_text(tokens, &length, prompt);
    token_append(tokens, &length, CHANNEL_MESSAGE_END_TOKEN);
    token_append(tokens, &length, CHANNEL_MESSAGE_TOKEN);
    token_append(tokens, &length, 'Z');
    token_append(tokens, &length, CHANNEL_REPLY_TOKEN);
    token_append(tokens, &length, 'U');
    token_append(tokens, &length, CHANNEL_TARGET_TOKEN);
    token_text(tokens, &length, target);
    token_append(tokens, &length, CHANNEL_MESSAGE_END_TOKEN);
    token_append(tokens, &length, CHANNEL_RECORD_END_TOKEN);
    while (length < RECORD_TOKENS) token_append(tokens, &length, ' ');
    if (fwrite(tokens, sizeof(tokens[0]), length, file) != length) {
        fail("could not write token corpus");
    }
}

static const char *field_value(const char *line, const char *name)
{
    size_t length = strlen(name);
    if (strncmp(line, name, length) != 0 || line[length] != ' ') return NULL;
    return line + length + 1;
}

static void copy_field(char *destination, size_t capacity, const char *value,
                       const char *name, long line_number)
{
    size_t length = strlen(value);
    if (length + 1 > capacity) {
        fprintf(stderr, "error: %s too long at line %ld\n", name, line_number);
        exit(EXIT_FAILURE);
    }
    memcpy(destination, value, length + 1);
}

static long verify_file(const char *path)
{
    FILE *file = fopen(path, "rb");
    char line[TEXT_CAPACITY];
    long line_number = 0;
    long record_count = 0;
    long train_count = 0;
    long validation_count = 0;
    long next_episode = -1;
    long next_chunk = 0;
    char rolling_summary[256] = "";
    Record record;
    int active = 0;
    if (file == NULL) fail_path("open", path);
    memset(&record, 0, sizeof(record));
    while (fgets(line, sizeof(line), file) != NULL) {
        const char *value;
        size_t length;
        ++line_number;
        length = strlen(line);
        if (length == sizeof(line) - 1 && line[length - 1] != '\n') {
            fprintf(stderr, "error: overlong line %ld in '%s'\n", line_number,
                    path);
            exit(EXIT_FAILURE);
        }
        while (length > 0 && (line[length - 1] == '\n' ||
                              line[length - 1] == '\r')) {
            line[--length] = '\0';
        }
        if (line[0] == '\0') continue;
        if (strcmp(line, "@brainfuck bf1") == 0 ||
            strcmp(line, "@brainfuck bf2") == 0) {
            if (active) fail("nested Brainfuck record");
            memset(&record, 0, sizeof(record));
            record.version = line[strlen(line) - 1] - '0';
            active = 1;
        } else if (!active) {
            fprintf(stderr, "error: content outside record at line %ld\n",
                    line_number);
            exit(EXIT_FAILURE);
        } else if ((value = field_value(line, "@split")) != NULL) {
            copy_field(record.split, sizeof(record.split), value, "split",
                       line_number);
        } else if ((value = field_value(line, "@task")) != NULL) {
            copy_field(record.task, sizeof(record.task), value, "task",
                       line_number);
        } else if ((value = field_value(line, "@episode")) != NULL) {
            record.episode = parse_long(value, "@episode");
        } else if ((value = field_value(line, "@chunk")) != NULL) {
            record.chunk = parse_long(value, "@chunk");
        } else if ((value = field_value(line, "@prompt")) != NULL) {
            copy_field(record.prompt, sizeof(record.prompt), value, "prompt",
                       line_number);
        } else if ((value = field_value(line, "@program")) != NULL) {
            copy_field(record.program, sizeof(record.program), value, "program",
                       line_number);
        } else if ((value = field_value(line, "@input")) != NULL) {
            copy_field(record.input, sizeof(record.input), value, "input",
                       line_number);
        } else if ((value = field_value(line, "@expect")) != NULL) {
            copy_field(record.expect, sizeof(record.expect), value, "expect",
                       line_number);
        } else if ((value = field_value(line, "@start")) != NULL) {
            record.start = parse_long(value, "@start");
        } else if ((value = field_value(line, "@advance")) != NULL) {
            record.advance = parse_long(value, "@advance");
        } else if ((value = field_value(line, "@memory")) != NULL) {
            copy_field(record.memory, sizeof(record.memory), value, "memory",
                       line_number);
        } else if ((value = field_value(line, "@artifact")) != NULL) {
            copy_field(record.artifact, sizeof(record.artifact), value,
                       "artifact", line_number);
        } else if ((value = field_value(line, "@summary")) != NULL) {
            copy_field(record.summary, sizeof(record.summary), value, "summary",
                       line_number);
        } else if ((value = field_value(line, "@result")) != NULL) {
            copy_field(record.result, sizeof(record.result), value, "result",
                       line_number);
        } else if (strcmp(line, "@end") == 0) {
            char error[160];
            if (!verify_record(&record, error, sizeof(error))) {
                fprintf(stderr, "error: invalid record ending at line %ld: %s\n",
                        line_number, error);
                exit(EXIT_FAILURE);
            }
            if (record.version == 2) {
                if (next_episode < 0) next_episode = record.episode;
                if (record.episode != next_episode ||
                    record.chunk != next_chunk) {
                    fprintf(stderr,
                            "error: non-contiguous bf2 episode at line %ld\n",
                            line_number);
                    exit(EXIT_FAILURE);
                }
                if (record.chunk >= 1 && record.chunk <= 3 &&
                    strcmp(record.memory, rolling_summary) != 0) {
                    fprintf(stderr,
                            "error: broken rolling-summary chain at line %ld\n",
                            line_number);
                    exit(EXIT_FAILURE);
                }
                snprintf(rolling_summary, sizeof(rolling_summary), "%s",
                         record.summary);
                if (++next_chunk == 6) {
                    next_chunk = 0;
                    ++next_episode;
                }
            }
            if (strcmp(record.split, "train") == 0) ++train_count;
            else ++validation_count;
            ++record_count;
            active = 0;
        } else {
            fprintf(stderr, "error: unknown field at line %ld: %s\n",
                    line_number, line);
            exit(EXIT_FAILURE);
        }
    }
    if (ferror(file)) fail_path("read", path);
    if (fclose(file) != 0) fail_path("close", path);
    if (active) fail("unterminated Brainfuck record");
    if (next_episode >= 0 && next_chunk != 0) {
        fail("bf2 corpus ends inside an episode");
    }
    if (record_count < 20 || train_count == 0 || validation_count == 0) {
        fail("verified corpus requires at least 20 records and both splits");
    }
    printf("brainfuck_corpus: verified %ld records (%ld train, %ld structurally held-out validation)\n",
           record_count, train_count, validation_count);
    return record_count;
}

static int self_test(void)
{
    static const unsigned char no_input[] = {0};
    Execution execution;
    MachineTrace machine_trace;
    char error[128];
    char previous_summary[256] = "";
    Rng rng = {UINT64_C(1)};
    long i;
    if (!execute("++++++++[>++++++++<-]>+.", no_input, 0, &execution,
                 error, sizeof(error)) || execution.output_length != 1 ||
        execution.output[0] != 'A') {
        fprintf(stderr, "self-test: interpreter failed: %s\n", error);
        return 0;
    }
    if (execute("[+", no_input, 0, &execution, error, sizeof(error)) ||
        execute("<", no_input, 0, &execution, error, sizeof(error))) {
        fprintf(stderr, "self-test: invalid program was accepted\n");
        return 0;
    }
    if (!trace_program("++>+<.", no_input, 0, &machine_trace, error,
                       sizeof(error)) || machine_trace.count != 7 ||
        machine_trace.states[6].halted != 1 ||
        machine_trace.states[6].tape[0] != 2 ||
        machine_trace.states[6].tape[1] != 1) {
        fprintf(stderr, "self-test: state trace failed: %s\n", error);
        return 0;
    }
    for (i = 0; i < 200; ++i) {
        Record record;
        char record_error[160];
        build_record(i, 180, &rng, &record);
        if (!verify_record(&record, record_error, sizeof(record_error))) {
            fprintf(stderr, "self-test: generated record %ld failed: %s\n", i,
                    record_error);
            return 0;
        }
    }
    for (i = 0; i < 240; ++i) {
        Record record;
        char record_error[160];
        build_trace_record(i, 216, 17, &record);
        if (!verify_record(&record, record_error, sizeof(record_error))) {
            fprintf(stderr,
                    "self-test: generated trace record %ld failed: %s\n", i,
                    record_error);
            return 0;
        }
        if (record.chunk >= 1 && record.chunk <= 3 &&
            strcmp(record.memory, previous_summary) != 0) {
            fprintf(stderr,
                    "self-test: episode %ld rolling summary did not compose\n",
                    record.episode);
            return 0;
        }
        snprintf(previous_summary, sizeof(previous_summary), "%s",
                 record.summary);
    }
    printf("brainfuck_corpus: self-test passed\n");
    return 1;
}

static void print_usage(const char *program)
{
    printf("usage: %s [options]\n\n", program);
    printf("generation:\n");
    printf("  --output FILE          readable checked corpus (required with --tokens)\n");
    printf("  --tokens FILE          uint16 hard-channel corpus for literary_lm\n");
    printf("  --examples N           record count (default: 30000)\n");
    printf("  --seed N               deterministic seed (default: 1)\n");
    printf("  --validation-percent N held-out structural tail (default: 5)\n\n");
    printf("  --trace-composition    emit grouped bf2 transition/composition episodes\n\n");
    printf("verification and execution:\n");
    printf("  --verify FILE          parse and independently execute every text record\n");
    printf("  --check PROGRAM        execute one strict Brainfuck program\n");
    printf("  --input HEX            input bytes for --check; '-' means empty\n");
    printf("  --self-test            interpreter and generator checks\n");
    printf("  --help                 show this message\n");
}

int main(int argc, char **argv)
{
    const char *output_path = NULL;
    const char *tokens_path = NULL;
    const char *verify_path = NULL;
    const char *check_program = NULL;
    const char *check_input = "-";
    long examples = 30000;
    long seed = 1;
    long validation_percent = 5;
    int run_tests = 0;
    int trace_composition = 0;
    int i;

    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "--tokens") == 0 && i + 1 < argc) {
            tokens_path = argv[++i];
        } else if (strcmp(argv[i], "--examples") == 0 && i + 1 < argc) {
            examples = parse_long(argv[++i], "--examples");
        } else if (strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            seed = parse_long(argv[++i], "--seed");
        } else if (strcmp(argv[i], "--validation-percent") == 0 &&
                   i + 1 < argc) {
            validation_percent =
                parse_long(argv[++i], "--validation-percent");
        } else if (strcmp(argv[i], "--verify") == 0 && i + 1 < argc) {
            verify_path = argv[++i];
        } else if (strcmp(argv[i], "--check") == 0 && i + 1 < argc) {
            check_program = argv[++i];
        } else if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            check_input = argv[++i];
        } else if (strcmp(argv[i], "--self-test") == 0) {
            run_tests = 1;
        } else if (strcmp(argv[i], "--trace-composition") == 0) {
            trace_composition = 1;
        } else if (strcmp(argv[i], "--help") == 0) {
            print_usage(argv[0]);
            return EXIT_SUCCESS;
        } else {
            fprintf(stderr, "error: unknown or incomplete option '%s'\n",
                    argv[i]);
            return EXIT_FAILURE;
        }
    }

    if (run_tests) return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    if (verify_path != NULL) {
        verify_file(verify_path);
        return EXIT_SUCCESS;
    }
    if (check_program != NULL) {
        unsigned char input[IO_CAPACITY];
        size_t input_length = 0;
        Execution execution;
        char error[160];
        char output[IO_CAPACITY * 2 + 2];
        char trace[256];
        if (!hex_decode(check_input, input, &input_length, error,
                        sizeof(error)) ||
            !execute(check_program, input, input_length, &execution, error,
                     sizeof(error))) {
            fprintf(stderr, "invalid: %s\n", error);
            return EXIT_FAILURE;
        }
        hex_encode(execution.output, execution.output_length, output,
                   sizeof(output));
        execution_trace(&execution, trace, sizeof(trace));
        printf("output %s\n%s\n", output, trace);
        return EXIT_SUCCESS;
    }
    if (output_path == NULL || tokens_path == NULL) {
        print_usage(argv[0]);
        return EXIT_FAILURE;
    }
    if (examples < 20 || validation_percent < 1 || validation_percent > 50) {
        fail("require examples >= 20 and validation percent in 1..50");
    }
    if (trace_composition && examples % 6 != 0) {
        fail("trace-composition examples must be divisible by six");
    }
    {
        FILE *output = fopen(output_path, "wb");
        FILE *tokens = fopen(tokens_path, "wb");
        Rng rng;
        long training_records = trace_composition
                                    ? (examples / 6) *
                                          (100 - validation_percent) / 100 * 6
                                    : examples *
                                          (100 - validation_percent) / 100;
        long index;
        if (output == NULL) fail_path("open", output_path);
        if (tokens == NULL) fail_path("open", tokens_path);
        rng.state = (uint64_t)seed;
        if (rng.state == 0) rng.state = UINT64_C(1);
        for (index = 0; index < examples; ++index) {
            Record record;
            char error[160];
            if (trace_composition) {
                build_trace_record(index, training_records, seed, &record);
            } else {
                build_record(index, training_records, &rng, &record);
            }
            if (!verify_record(&record, error, sizeof(error))) {
                fprintf(stderr, "error: generated record %ld failed: %s\n",
                        index, error);
                return EXIT_FAILURE;
            }
            write_text_record(output, &record);
            write_token_record(tokens, &record);
        }
        if (fclose(output) != 0) fail_path("close", output_path);
        if (fclose(tokens) != 0) fail_path("close", tokens_path);
        if (trace_composition) {
            printf("brainfuck_corpus: generated %ld checked bf2 trace-composition records (%ld train, %ld held-out composition validation), %d tokens each\n",
                   examples, training_records, examples - training_records,
                   RECORD_TOKENS);
        } else {
            printf("brainfuck_corpus: generated %ld checked bf1 records (%ld train, %ld structurally held-out validation), %d tokens each\n",
                   examples, training_records, examples - training_records,
                   RECORD_TOKENS);
        }
    }
    verify_file(output_path);
    return EXIT_SUCCESS;
}
