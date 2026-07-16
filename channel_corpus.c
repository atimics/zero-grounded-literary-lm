#include <ctype.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "channel_protocol.h"

/*
 * channel_corpus.c -- turn literary scripts and consented chat exports into
 * compact, reply-targeted channel records for the 128-token literary model.
 *
 * Protocol tokens deliberately use otherwise-unused ASCII control values, so
 * the representation adds no embedding rows and therefore no model parameters.
 */

#define TOK_CHANNEL CHANNEL_START_TOKEN
#define TOK_MESSAGE CHANNEL_MESSAGE_TOKEN
#define TOK_REPLY CHANNEL_REPLY_TOKEN
#define TOK_END_MESSAGE CHANNEL_MESSAGE_END_TOKEN
#define TOK_END_RECORD CHANNEL_RECORD_END_TOKEN
#define TOK_TARGET CHANNEL_TARGET_TOKEN
#define TOK_SUMMARY CHANNEL_SUMMARY_TOKEN

#define CONTEXT_MESSAGES 3
#define MEMORY_MESSAGES 2
#define CONTEXT_CHARS 65
#define TARGET_CHARS 180
#define SUMMARY_CHARS 80
#define MAX_RECORD_TOKENS 500

typedef uint16_t Token;

typedef struct {
    char *speaker;
    char *id;
    char *reply;
    char *text;
    char *summary;
} Message;

typedef struct {
    Message *messages;
    size_t count;
    size_t capacity;
    char *summary;
} Thread;

typedef struct {
    FILE *tokens;
    FILE *preview;
    uint64_t record_count;
    uint64_t token_count;
    int memory_only;
} Output;

typedef struct {
    Token data[MAX_RECORD_TOKENS];
    size_t length;
} Record;

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
    memory = calloc(count, size);
    if (memory == NULL) fail("out of memory");
    return memory;
}

static void *checked_resize(void *memory, size_t count, size_t size)
{
    void *resized;
    if (size != 0 && count > SIZE_MAX / size) fail("allocation overflow");
    resized = realloc(memory, count * size);
    if (resized == NULL) fail("out of memory");
    return resized;
}

static char *copy_string(const char *text)
{
    size_t length = strlen(text);
    char *copy = checked_alloc(length + 1, 1);
    memcpy(copy, text, length + 1);
    return copy;
}

static void message_destroy(Message *message)
{
    free(message->speaker);
    free(message->id);
    free(message->reply);
    free(message->text);
    free(message->summary);
    memset(message, 0, sizeof(*message));
}

static void thread_clear(Thread *thread)
{
    size_t i;
    for (i = 0; i < thread->count; ++i) message_destroy(&thread->messages[i]);
    thread->count = 0;
    free(thread->summary);
    thread->summary = NULL;
}

static void thread_destroy(Thread *thread)
{
    thread_clear(thread);
    free(thread->messages);
    memset(thread, 0, sizeof(*thread));
}

static void thread_add(Thread *thread, const char *speaker, const char *id,
                       const char *reply, const char *text,
                       const char *summary)
{
    Message *message;
    if (text[0] == '\0') return;
    if (thread->count == thread->capacity) {
        size_t capacity = thread->capacity == 0 ? 32 : thread->capacity * 2;
        thread->messages = checked_resize(thread->messages, capacity,
                                          sizeof(*thread->messages));
        memset(thread->messages + thread->capacity, 0,
               (capacity - thread->capacity) * sizeof(*thread->messages));
        thread->capacity = capacity;
    }
    message = &thread->messages[thread->count++];
    message->speaker = copy_string(speaker);
    message->id = copy_string(id != NULL ? id : "");
    message->reply = copy_string(reply != NULL ? reply : "");
    message->text = copy_string(text);
    message->summary = copy_string(summary != NULL ? summary : "");
}

static void thread_set_summary(Thread *thread, const char *summary)
{
    free(thread->summary);
    thread->summary = copy_string(summary != NULL && summary[0] != '\0'
                                      ? summary
                                      : "literary conversation");
}

static const char *default_summary(char style)
{
    if (style == 'S') return "Shakespearean dramatic scene";
    if (style == 'C') return "Crowleyan dramatic scene";
    if (style == 'B') return "Blakean visionary verse";
    if (style == 'D') return "mixed literary conversation";
    return "human channel conversation";
}

static void record_add(Record *record, int token)
{
    if (record->length >= MAX_RECORD_TOKENS) fail("channel record overflow");
    record->data[record->length++] = (Token)token;
}

static void record_add_content(Record *record, const char *text,
                               size_t limit, int keep_tail)
{
    size_t length = strlen(text);
    size_t start = 0;
    size_t i;
    if (length > limit) {
        if (keep_tail) {
            start = length - limit;
            while (start < length && text[start] != ' ') ++start;
            if (start < length) ++start;
            if (length - start < limit / 2) start = length - limit;
        } else {
            length = limit;
            while (length > limit / 2 && text[length] != ' ') --length;
            if (length <= limit / 2) length = limit;
        }
    }
    for (i = start; i < length; ++i) {
        unsigned char value = (unsigned char)text[i];
        if (value >= 32 && value < 127) record_add(record, value);
        else if (value == '\n' || value == '\t') record_add(record, ' ');
    }
}

static int find_message_by_id(const Thread *thread, size_t target,
                              const char *id)
{
    size_t i;
    if (id == NULL || id[0] == '\0') return -1;
    for (i = 0; i < target; ++i) {
        if (strcmp(thread->messages[i].id, id) == 0) return (int)i;
    }
    return -1;
}

static char role_for(const Thread *thread, size_t target,
                     const size_t *context, size_t context_count,
                     size_t message_index)
{
    const char *target_speaker = thread->messages[target].speaker;
    const char *speaker = thread->messages[message_index].speaker;
    const char *seen[CONTEXT_MESSAGES];
    size_t seen_count = 0;
    size_t i;
    if (strcmp(speaker, target_speaker) == 0) return 'Z';
    for (i = 0; i < context_count; ++i) {
        const char *candidate = thread->messages[context[i]].speaker;
        size_t j;
        int existing = -1;
        if (strcmp(candidate, target_speaker) == 0) continue;
        for (j = 0; j < seen_count; ++j) {
            if (strcmp(seen[j], candidate) == 0) existing = (int)j;
        }
        if (existing < 0 && seen_count < CONTEXT_MESSAGES) {
            seen[seen_count++] = candidate;
            existing = (int)seen_count - 1;
        }
        if (strcmp(candidate, speaker) == 0) return (char)('A' + existing);
    }
    return 'X';
}

static void summary_append(char *output, size_t capacity, size_t *length,
                           const char *text, size_t limit)
{
    size_t amount = strlen(text);
    if (amount > limit) amount = limit;
    if (amount > capacity - 1 - *length) amount = capacity - 1 - *length;
    memcpy(output + *length, text, amount);
    *length += amount;
    output[*length] = '\0';
}

static void make_lossy_summary(const Thread *thread, size_t target,
                               const size_t *context, size_t context_count,
                               size_t upto, char style, char *output,
                               size_t capacity)
{
    const char *vibe = thread->summary != NULL ? thread->summary
                                               : default_summary(style);
    size_t length = 0;
    size_t start;
    size_t index;
    output[0] = '\0';
    summary_append(output, capacity, &length, vibe, 34);
    if (upto == 0 || length + 4 >= capacity) return;
    summary_append(output, capacity, &length, " | ", 3);
    if (thread->messages[upto - 1].summary[0] != '\0') {
        summary_append(output, capacity, &length,
                       thread->messages[upto - 1].summary,
                       capacity - 1 - length);
        return;
    }
    start = upto > 2 ? upto - 2 : 0;
    for (index = start; index < upto && length + 5 < capacity; ++index) {
        char role[4] = {'X', ':', ' ', '\0'};
        if (index != start) summary_append(output, capacity, &length, "; ", 2);
        role[0] = role_for(thread, target, context, context_count, index);
        summary_append(output, capacity, &length, role, 3);
        summary_append(output, capacity, &length, thread->messages[index].text,
                       18);
    }
}

static void make_recurrent_summary(const Thread *thread, size_t target,
                                   const size_t *context,
                                   size_t context_count, size_t first,
                                   size_t end, char style,
                                   const char *old_summary, char *output,
                                   size_t capacity)
{
    const char *vibe = thread->summary != NULL ? thread->summary
                                               : default_summary(style);
    const char *prior = strstr(old_summary, " | ");
    size_t length = 0;
    size_t index;
    if (thread->messages[end - 1].summary[0] != '\0') {
        make_lossy_summary(thread, target, context, context_count, end, style,
                           output, capacity);
        return;
    }
    output[0] = '\0';
    summary_append(output, capacity, &length, vibe, 22);
    summary_append(output, capacity, &length, " | ", 3);
    if (prior != NULL && prior[3] != '\0') {
        summary_append(output, capacity, &length, "~", 1);
        summary_append(output, capacity, &length, prior + 3, 14);
        summary_append(output, capacity, &length, "; ", 2);
    }
    for (index = first; index < end && length + 5 < capacity; ++index) {
        char role[4] = {'X', ':', ' ', '\0'};
        if (index != first) summary_append(output, capacity, &length, "; ", 2);
        role[0] = role_for(thread, target, context, context_count, index);
        summary_append(output, capacity, &length, role, 3);
        summary_append(output, capacity, &length, thread->messages[index].text,
                       12);
    }
}

static void preview_record(FILE *preview, const Record *record)
{
    size_t i;
    if (preview == NULL) return;
    for (i = 0; i < record->length; ++i) {
        int token = record->data[i];
        switch (token) {
        case TOK_CHANNEL: fputs("\n<CHANNEL:", preview); break;
        case TOK_MESSAGE: fputs("\n[", preview); break;
        case TOK_REPLY: fputc('>', preview); break;
        case TOK_END_MESSAGE: fputs("]\n", preview); break;
        case TOK_END_RECORD: fputs("<END>\n", preview); break;
        case TOK_TARGET: fputs("] => ", preview); break;
        case TOK_SUMMARY: fputs("\n<SUMMARY>", preview); break;
        default: fputc(token >= 32 && token < 127 ? token : '.', preview); break;
        }
    }
}

static void output_record(Output *output, const Record *record)
{
    size_t index;
    int is_memory = 0;
    for (index = 0; index + 1 < record->length; ++index) {
        if (record->data[index] == TOK_SUMMARY &&
            record->data[index + 1] == TOK_TARGET) {
            is_memory = 1;
            break;
        }
    }
    if (output->memory_only && !is_memory) return;
    if (record->length > MAX_RECORD_TOKENS || record->length < 8) {
        fail("invalid generated channel record");
    }
    if (fwrite(record->data, sizeof(Token), record->length, output->tokens) !=
        record->length) {
        fail("could not write channel tokens");
    }
    if (output->record_count < 40) preview_record(output->preview, record);
    ++output->record_count;
    output->token_count += record->length;
}

static void make_record(Output *output, const Thread *thread, size_t target,
                        char style)
{
    size_t context[CONTEXT_MESSAGES];
    size_t context_count = 0;
    size_t first = target > CONTEXT_MESSAGES ? target - CONTEXT_MESSAGES : 0;
    int explicit_reply = find_message_by_id(
        thread, target, thread->messages[target].reply);
    size_t i;
    Record record = {{0}, 0};
    char summary[SUMMARY_CHARS + 1];

    for (i = first; i < target; ++i) context[context_count++] = i;
    if (explicit_reply >= 0 && (size_t)explicit_reply < first && context_count) {
        context[0] = (size_t)explicit_reply;
    }
    if (context_count == 0) return;

    record_add(&record, TOK_CHANNEL);
    record_add(&record, style);
    record_add(&record, TOK_SUMMARY);
    make_lossy_summary(thread, target, context, context_count, context[0],
                       style, summary, sizeof(summary));
    record_add_content(&record, summary, SUMMARY_CHARS, 0);
    record_add(&record, TOK_END_MESSAGE);
    for (i = 0; i < context_count; ++i) {
        size_t index = context[i];
        char role = role_for(thread, target, context, context_count, index);
        record_add(&record, TOK_MESSAGE);
        record_add(&record, role);
        if (i != 0) {
            char reply_role = role_for(thread, target, context, context_count,
                                       context[i - 1]);
            record_add(&record, TOK_REPLY);
            record_add(&record, reply_role);
        }
        record_add_content(&record, thread->messages[index].text,
                           CONTEXT_CHARS, 1);
        record_add(&record, TOK_END_MESSAGE);
    }
    record_add(&record, TOK_MESSAGE);
    record_add(&record, 'Z');
    record_add(&record, TOK_REPLY);
    if (explicit_reply >= 0) {
        size_t reply_index = (size_t)explicit_reply;
        int present = 0;
        for (i = 0; i < context_count; ++i) {
            if (context[i] == reply_index) present = 1;
        }
        record_add(&record, present
                                ? role_for(thread, target, context,
                                           context_count, reply_index)
                                : role_for(thread, target, context,
                                           context_count,
                                           context[context_count - 1]));
    } else {
        record_add(&record, role_for(thread, target, context, context_count,
                                     context[context_count - 1]));
    }
    record_add(&record, TOK_TARGET);
    record_add_content(&record, thread->messages[target].text,
                       TARGET_CHARS, 0);
    record_add(&record, TOK_END_MESSAGE);
    record_add(&record, TOK_END_RECORD);
    output_record(output, &record);
}

static void make_memory_record(Output *output, const Thread *thread,
                               size_t target, char style)
{
    size_t context[MEMORY_MESSAGES];
    size_t end = target + 1;
    size_t first = end > MEMORY_MESSAGES ? end - MEMORY_MESSAGES : 0;
    size_t context_count = 0;
    size_t index;
    Record record = {{0}, 0};
    char old_summary[SUMMARY_CHARS + 1];
    char new_summary[SUMMARY_CHARS + 1];
    for (index = first; index < end; ++index) {
        context[context_count++] = index;
    }
    make_lossy_summary(thread, target, context, context_count, first, style,
                       old_summary, sizeof(old_summary));
    make_recurrent_summary(thread, target, context, context_count, first, end,
                           style, old_summary, new_summary,
                           sizeof(new_summary));

    record_add(&record, TOK_CHANNEL);
    record_add(&record, style);
    record_add(&record, TOK_SUMMARY);
    record_add_content(&record, old_summary, SUMMARY_CHARS, 0);
    record_add(&record, TOK_END_MESSAGE);
    for (index = 0; index < context_count; ++index) {
        size_t message_index = context[index];
        record_add(&record, TOK_MESSAGE);
        record_add(&record, role_for(thread, target, context, context_count,
                                     message_index));
        if (index != 0) {
            record_add(&record, TOK_REPLY);
            record_add(&record,
                       role_for(thread, target, context, context_count,
                                context[index - 1]));
        }
        record_add_content(&record, thread->messages[message_index].text,
                           CONTEXT_CHARS, 1);
        record_add(&record, TOK_END_MESSAGE);
    }
    record_add(&record, TOK_SUMMARY);
    record_add(&record, TOK_TARGET);
    record_add_content(&record, new_summary, SUMMARY_CHARS, 0);
    record_add(&record, TOK_END_MESSAGE);
    record_add(&record, TOK_END_RECORD);
    output_record(output, &record);
}

static void emit_thread(Output *output, const Thread *thread, char style)
{
    size_t target;
    for (target = 1; target < thread->count; ++target) {
        make_record(output, thread, target, style);
        if (style != 'D') make_record(output, thread, target, 'D');
        if (target % MEMORY_MESSAGES == 1) {
            make_memory_record(output, thread, target, style);
            if (style != 'D') make_memory_record(output, thread, target, 'D');
        }
    }
}

static Token *read_token_file(const char *path, size_t *length)
{
    FILE *file = fopen(path, "rb");
    Token *tokens;
    long size = 0;
    size_t i;
    if (file == NULL) fail_path("open", path);
    if (fseek(file, 0, SEEK_END) != 0 || (size = ftell(file)) < 0 ||
        fseek(file, 0, SEEK_SET) != 0 || size % (long)sizeof(Token) != 0) {
        fclose(file);
        fail_path("measure", path);
    }
    *length = (size_t)size / sizeof(Token);
    tokens = checked_alloc(*length + 1, sizeof(*tokens));
    if (fread(tokens, sizeof(*tokens), *length, file) != *length) {
        fclose(file);
        free(tokens);
        fail_path("read", path);
    }
    fclose(file);
    for (i = 0; i < *length; ++i) {
        if (tokens[i] >= 128) fail("channel input must use the 128-token vocabulary");
    }
    return tokens;
}

static char *tokens_to_text(const Token *tokens, size_t length)
{
    char *text = checked_alloc(length + 1, 1);
    size_t i;
    for (i = 0; i < length; ++i) text[i] = (char)tokens[i];
    return text;
}

static char *trim(char *line)
{
    char *end;
    while (*line == ' ' || *line == '\t' || *line == '\r') ++line;
    end = line + strlen(line);
    while (end > line &&
           (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\r')) {
        *--end = '\0';
    }
    return line;
}

static int starts_with(const char *text, const char *prefix)
{
    return strncmp(text, prefix, strlen(prefix)) == 0;
}

static int scene_boundary(const char *line)
{
    return starts_with(line, "ACT ") || starts_with(line, "SCENE ") ||
           strcmp(line, "ACT") == 0 || strcmp(line, "SCENE") == 0;
}

static int speaker_line(const char *line)
{
    size_t length = strlen(line);
    size_t i;
    int letters = 0;
    if (length < 2 || length > 64 || line[length - 1] != '.') return 0;
    if (starts_with(line, "ACT ") || starts_with(line, "SCENE")) return 0;
    for (i = 0; i + 1 < length; ++i) {
        unsigned char value = (unsigned char)line[i];
        if (value >= 'A' && value <= 'Z') letters = 1;
        else if (!(value == ' ' || value == '\'' || value == '-' ||
                   value == '&' || value == ',' || value == '.' ||
                   (value >= '0' && value <= '9'))) {
            return 0;
        }
    }
    return letters;
}

static int stage_direction(const char *line)
{
    return line[0] == '[' || starts_with(line, "Enter ") ||
           starts_with(line, "Exit ") || starts_with(line, "Exeunt") ||
           starts_with(line, "Re-enter ");
}

static void append_words(char **body, size_t *length, size_t *capacity,
                         const char *line)
{
    size_t amount = strlen(line);
    size_t required = *length + amount + (*length != 0 ? 1 : 0) + 1;
    if (required > *capacity) {
        size_t next = *capacity == 0 ? 256 : *capacity;
        while (next < required) next *= 2;
        *body = checked_resize(*body, next, 1);
        *capacity = next;
    }
    if (*length != 0) (*body)[(*length)++] = ' ';
    memcpy(*body + *length, line, amount);
    *length += amount;
    (*body)[*length] = '\0';
}

static void finish_speech(Thread *thread, char **speaker, char **body,
                          size_t *body_length)
{
    char id[32];
    const char *reply = "";
    if (*speaker == NULL || *body == NULL || *body_length == 0) return;
    snprintf(id, sizeof(id), "%zu", thread->count + 1);
    if (thread->count != 0) reply = thread->messages[thread->count - 1].id;
    thread_add(thread, *speaker, id, reply, *body, NULL);
    free(*speaker);
    *speaker = NULL;
    (*body)[0] = '\0';
    *body_length = 0;
}

static void convert_play(Output *output, char style, const char *path)
{
    size_t token_length;
    Token *tokens = read_token_file(path, &token_length);
    char *text = tokens_to_text(tokens, token_length);
    char *cursor = text;
    Thread thread = {0};
    char *speaker = NULL;
    char *body = NULL;
    size_t body_length = 0;
    size_t body_capacity = 0;
    int in_scene = 0;

    while (*cursor != '\0') {
        char *line = cursor;
        char *clean;
        char *newline = strchr(cursor, '\n');
        if (newline != NULL) {
            *newline = '\0';
            cursor = newline + 1;
        } else {
            cursor += strlen(cursor);
        }
        clean = trim(line);
        if (scene_boundary(clean)) {
            finish_speech(&thread, &speaker, &body, &body_length);
            if (thread.count > 1) emit_thread(output, &thread, style);
            thread_clear(&thread);
            thread_set_summary(&thread, clean);
            in_scene = 1;
        } else if (in_scene && speaker_line(clean)) {
            size_t length;
            finish_speech(&thread, &speaker, &body, &body_length);
            length = strlen(clean);
            clean[length - 1] = '\0';
            speaker = copy_string(clean);
        } else if (in_scene && speaker != NULL && clean[0] != '\0' &&
                   !stage_direction(clean)) {
            append_words(&body, &body_length, &body_capacity, clean);
        }
    }
    finish_speech(&thread, &speaker, &body, &body_length);
    if (thread.count > 1) emit_thread(output, &thread, style);
    free(speaker);
    free(body);
    thread_destroy(&thread);
    free(text);
    free(tokens);
}

static void flush_verse(Output *output, Thread *thread, char style)
{
    if (thread->count > 1) emit_thread(output, thread, style);
    thread_clear(thread);
    thread_set_summary(thread, default_summary(style));
}

static void convert_verse(Output *output, char style, const char *path)
{
    size_t token_length;
    Token *tokens = read_token_file(path, &token_length);
    char *text = tokens_to_text(tokens, token_length);
    char *cursor = text;
    Thread thread = {0};
    thread_set_summary(&thread, default_summary(style));
    while (*cursor != '\0') {
        char *line = cursor;
        char *clean;
        char id[32];
        char *newline = strchr(cursor, '\n');
        if (newline != NULL) {
            *newline = '\0';
            cursor = newline + 1;
        } else {
            cursor += strlen(cursor);
        }
        clean = trim(line);
        if (clean[0] == '\0') {
            flush_verse(output, &thread, style);
        } else if (!stage_direction(clean) && strlen(clean) <= 240) {
            const char *speaker = thread.count % 2 == 0 ? "VOICE-A" : "VOICE-B";
            const char *reply = thread.count ? thread.messages[thread.count - 1].id : "";
            snprintf(id, sizeof(id), "%zu", thread.count + 1);
            thread_add(&thread, speaker, id, reply, clean, NULL);
        }
    }
    flush_verse(output, &thread, style);
    thread_destroy(&thread);
    free(text);
    free(tokens);
}

static unsigned char *read_bytes(const char *path, size_t *length)
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
    fclose(file);
    *length = (size_t)size;
    return data;
}

static void convert_chat_tsv(Output *output, char style, const char *path)
{
    size_t length;
    unsigned char *bytes = read_bytes(path, &length);
    char *text = (char *)bytes;
    char *cursor = text;
    char *active_channel = NULL;
    Thread thread = {0};
    size_t i;
    for (i = 0; i < length; ++i) {
        if (bytes[i] >= 128) bytes[i] = '?';
        else if (bytes[i] < 32 && bytes[i] != '\n' && bytes[i] != '\r' &&
                 bytes[i] != '\t') bytes[i] = ' ';
    }
    text[length] = '\0';
    while (*cursor != '\0') {
        char *line = cursor;
        char *field[7];
        int field_count = 1;
        char *newline = strchr(cursor, '\n');
        char *scan;
        if (newline != NULL) {
            *newline = '\0';
            cursor = newline + 1;
        } else {
            cursor += strlen(cursor);
        }
        if (*line == '\0' || *line == '#') continue;
        field[0] = line;
        for (scan = line; *scan != '\0' && field_count < 7; ++scan) {
            if (*scan == '\t') {
                *scan = '\0';
                field[field_count++] = scan + 1;
            }
        }
        if (field_count < 5 || field_count > 7) {
            fail("chat TSV requires channel, id, reply-id, speaker, text, "
                 "and optional vibe and rolling memory");
        }
        if (active_channel == NULL || strcmp(active_channel, field[0]) != 0) {
            if (active_channel != NULL) emit_thread(output, &thread, style);
            thread_clear(&thread);
            free(active_channel);
            active_channel = copy_string(field[0]);
            thread_set_summary(&thread,
                               field_count >= 6 && field[5][0] != '\0'
                                   ? field[5]
                                   : default_summary(style));
        }
        thread_add(&thread, field[3], field[1], field[2], trim(field[4]),
                   field_count == 7 ? trim(field[6]) : NULL);
    }
    if (active_channel != NULL) emit_thread(output, &thread, style);
    free(active_channel);
    thread_destroy(&thread);
    free(bytes);
}

static int self_test(void)
{
    Thread thread = {0};
    Output output = {0};
    Token tokens[4096];
    size_t count;
    size_t i;
    int found_target = 0;
    int found_memory_target = 0;
    output.tokens = tmpfile();
    if (output.tokens == NULL) fail("could not create self-test stream");
    thread_add(&thread, "HAMLET", "1", "", "What dreams may come?", NULL);
    thread_add(&thread, "HORATIO", "2", "1", "The moon keeps counsel.",
               NULL);
    thread_add(&thread, "HAMLET", "3", "2", "Then let us ask the night.",
               "Hamlet and Horatio ask the night about dreams.");
    thread_add(&thread, "HORATIO", "4", "3", "It answers in silver.",
               "Two friends hear the night answer in silver.");
    thread_set_summary(&thread, "two friends considering a strange night");
    emit_thread(&output, &thread, 'S');
    rewind(output.tokens);
    count = fread(tokens, sizeof(Token), 4096, output.tokens);
    for (i = 0; i < count; ++i) {
        if (tokens[i] == TOK_TARGET) found_target = 1;
        if (i + 1 < count && tokens[i] == TOK_SUMMARY &&
            tokens[i + 1] == TOK_TARGET) {
            found_memory_target = 1;
        }
    }
    fclose(output.tokens);
    thread_destroy(&thread);
    if (output.record_count != 10 || count == 0 || tokens[0] != TOK_CHANNEL ||
        !found_target || !found_memory_target ||
        tokens[count - 1] != TOK_END_RECORD) {
        fprintf(stderr, "channel_corpus self-test failed\n");
        return 0;
    }
    printf("channel_corpus self-test passed: %llu records\n",
           (unsigned long long)output.record_count);
    return 1;
}

static void usage(const char *program)
{
    printf("usage: %s --out FILE [--preview FILE] sources...\n", program);
    printf("  --memory-only          emit only recurrent-memory targets\n");
    printf("sources:\n");
    printf("  --play STYLE TOKENS     parse dramatic speaker turns\n");
    printf("  --verse STYLE TOKENS    alternate lines within each stanza\n");
    printf("  --chat STYLE TSV        channel, id, reply-id, speaker, text"
           "[, vibe[, rolling-memory]]\n");
    printf("  --self-test             verify record construction\n");
}

int main(int argc, char **argv)
{
    const char *output_path = NULL;
    const char *preview_path = NULL;
    Output output = {0};
    int i;
    int source_count = 0;
    for (i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--self-test") == 0) {
            return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
        } else if (strcmp(argv[i], "--out") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "--preview") == 0 && i + 1 < argc) {
            preview_path = argv[++i];
        } else if (strcmp(argv[i], "--memory-only") == 0) {
            output.memory_only = 1;
        } else if ((strcmp(argv[i], "--play") == 0 ||
                    strcmp(argv[i], "--verse") == 0 ||
                    strcmp(argv[i], "--chat") == 0) && i + 2 < argc) {
            i += 2;
            ++source_count;
        } else if (strcmp(argv[i], "--help") == 0) {
            usage(argv[0]);
            return EXIT_SUCCESS;
        } else {
            usage(argv[0]);
            fail("unknown or incomplete option");
        }
    }
    if (output_path == NULL || source_count == 0) {
        usage(argv[0]);
        fail("--out and at least one source are required");
    }
    output.tokens = fopen(output_path, "wb");
    if (output.tokens == NULL) fail_path("create", output_path);
    if (preview_path != NULL) {
        output.preview = fopen(preview_path, "w");
        if (output.preview == NULL) fail_path("create", preview_path);
    }
    for (i = 1; i < argc; ++i) {
        const char *kind = argv[i];
        if ((strcmp(kind, "--play") == 0 || strcmp(kind, "--verse") == 0 ||
             strcmp(kind, "--chat") == 0) && i + 2 < argc) {
            const char *style_text = argv[++i];
            const char *path = argv[++i];
            char style;
            if (strlen(style_text) != 1 || style_text[0] < 32 ||
                style_text[0] >= 127) {
                fail("STYLE must be one printable ASCII character");
            }
            style = style_text[0];
            if (strcmp(kind, "--play") == 0) convert_play(&output, style, path);
            else if (strcmp(kind, "--verse") == 0) convert_verse(&output, style, path);
            else convert_chat_tsv(&output, style, path);
        } else if ((strcmp(kind, "--out") == 0 ||
                    strcmp(kind, "--preview") == 0) && i + 1 < argc) {
            ++i;
        } else if (strcmp(kind, "--memory-only") == 0) {
            continue;
        }
    }
    if (fclose(output.tokens) != 0) fail_path("close", output_path);
    if (output.preview != NULL && fclose(output.preview) != 0) {
        fail_path("close", preview_path);
    }
    printf("wrote %llu channel records, %llu tokens to %s\n",
           (unsigned long long)output.record_count,
           (unsigned long long)output.token_count, output_path);
    return output.record_count == 0 ? EXIT_FAILURE : EXIT_SUCCESS;
}
