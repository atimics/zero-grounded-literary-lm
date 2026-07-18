#ifndef FACULTY_PROTOCOL_H
#define FACULTY_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

enum {
    FACULTY_MAX_CHANNELS = 16,
    FACULTY_ID_CAPACITY = 32,
    FACULTY_TASK_CAPACITY = 32,
    FACULTY_SUMMARY_CAPACITY = 192,
    FACULTY_ARTIFACT_CAPACITY = 320,
    FACULTY_REQUEST_CAPACITY = 32,
    FACULTY_EXECUTION_REQUEST_CAPACITY = 160,
    FACULTY_AUTHORITY_CAPACITY = 24,
    FACULTY_HOLO_DIMENSION = 256
};

typedef enum {
    FACULTY_IDLE = 0,
    FACULTY_EMITTING = 1,
    FACULTY_CLOSED = 2
} FacultyControllerState;

typedef enum {
    FACULTY_PENDING = 0,
    FACULTY_VERIFIED = 1,
    FACULTY_REJECTED = 2
} FacultyVerdict;

typedef struct {
    char id[FACULTY_ID_CAPACITY];
    char summary[FACULTY_SUMMARY_CAPACITY];
    char artifact[FACULTY_ARTIFACT_CAPACITY];
    char authority[FACULTY_AUTHORITY_CAPACITY];
    float holo[FACULTY_HOLO_DIMENSION];
    uint64_t revision;
    FacultyVerdict verdict;
} FacultyChannelState;

typedef struct {
    FacultyControllerState state;
    FacultyChannelState channels[FACULTY_MAX_CHANNELS];
    size_t channel_count;
    size_t active_channel;
    char task[FACULTY_TASK_CAPACITY];
    char proposed_summary[FACULTY_SUMMARY_CAPACITY];
    char proposed_artifact[FACULTY_ARTIFACT_CAPACITY];
    char queued_request[FACULTY_REQUEST_CAPACITY];
    char execution_request[FACULTY_EXECUTION_REQUEST_CAPACITY];
} FacultyController;

void faculty_controller_init(FacultyController *controller);
int faculty_register(FacultyController *controller, const char *id,
                     const char *initial_summary);
int faculty_enter(FacultyController *controller, const char *id,
                  const char *task);
int faculty_emit(FacultyController *controller, const char *artifact,
                 const char *summary, const char *request);
int faculty_emit_quantity_request(FacultyController *controller,
                                  const char *request);
int faculty_close(FacultyController *controller);
int faculty_resolve(FacultyController *controller, int verified);
int faculty_execute_quantity(FacultyController *controller,
                             const char *source_input);
const FacultyChannelState *faculty_get(const FacultyController *controller,
                                       const char *id);
const char *faculty_queued_request(const FacultyController *controller);
const char *faculty_execution_request(const FacultyController *controller);

#endif
