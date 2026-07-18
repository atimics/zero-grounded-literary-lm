#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "faculty_protocol.h"
#include "quantity_oracle.h"

static int copy_checked(char *destination, size_t capacity, const char *source)
{
    size_t length;
    if (source == NULL) source = "";
    length = strlen(source);
    if (length >= capacity) return 0;
    memcpy(destination, source, length + 1);
    return 1;
}

static size_t find_channel(const FacultyController *controller, const char *id)
{
    size_t index;
    for (index = 0; index < controller->channel_count; ++index) {
        if (strcmp(controller->channels[index].id, id) == 0) return index;
    }
    return FACULTY_MAX_CHANNELS;
}

static uint64_t mix64(uint64_t value)
{
    value ^= value >> 30;
    value *= UINT64_C(0xbf58476d1ce4e5b9);
    value ^= value >> 27;
    value *= UINT64_C(0x94d049bb133111eb);
    return value ^ (value >> 31);
}

static void holo_encode(FacultyChannelState *channel)
{
    const unsigned char *parts[5];
    const char *verdict = channel->verdict == FACULTY_VERIFIED
                              ? "verified"
                              : (channel->verdict == FACULTY_REJECTED
                                     ? "rejected"
                                     : "pending");
    float norm = 0.0f;
    size_t part;
    size_t index;
    memset(channel->holo, 0, sizeof(channel->holo));
    parts[0] = (const unsigned char *)channel->id;
    parts[1] = (const unsigned char *)channel->summary;
    parts[2] = (const unsigned char *)channel->artifact;
    parts[3] = (const unsigned char *)channel->authority;
    parts[4] = (const unsigned char *)verdict;
    for (part = 0; part < 5; ++part) {
        uint64_t rolling = mix64(UINT64_C(0x9e3779b97f4a7c15) + part);
        for (index = 0; parts[part][index] != '\0'; ++index) {
            uint64_t hash;
            size_t slot;
            float sign;
            rolling = mix64(rolling ^ ((uint64_t)parts[part][index] +
                                       UINT64_C(0x100) * (index + 1)));
            hash = mix64(rolling + part * UINT64_C(0x517cc1b727220a95));
            slot = (size_t)(hash % FACULTY_HOLO_DIMENSION);
            sign = (hash >> 63) ? -1.0f : 1.0f;
            channel->holo[slot] += sign;
        }
    }
    for (index = 0; index < FACULTY_HOLO_DIMENSION; ++index) {
        norm += channel->holo[index] * channel->holo[index];
    }
    if (norm > 0.0f) {
        norm = sqrtf(norm);
        for (index = 0; index < FACULTY_HOLO_DIMENSION; ++index) {
            channel->holo[index] /= norm;
        }
    }
}

void faculty_controller_init(FacultyController *controller)
{
    memset(controller, 0, sizeof(*controller));
    controller->state = FACULTY_IDLE;
    controller->active_channel = FACULTY_MAX_CHANNELS;
}

int faculty_register(FacultyController *controller, const char *id,
                     const char *initial_summary)
{
    FacultyChannelState *channel;
    if (controller->state != FACULTY_IDLE || id == NULL || id[0] == '\0' ||
        controller->channel_count >= FACULTY_MAX_CHANNELS ||
        find_channel(controller, id) != FACULTY_MAX_CHANNELS) {
        return 0;
    }
    channel = &controller->channels[controller->channel_count];
    if (!copy_checked(channel->id, sizeof(channel->id), id) ||
        !copy_checked(channel->summary, sizeof(channel->summary),
                      initial_summary)) {
        memset(channel, 0, sizeof(*channel));
        return 0;
    }
    channel->verdict = FACULTY_PENDING;
    holo_encode(channel);
    ++controller->channel_count;
    return 1;
}

int faculty_enter(FacultyController *controller, const char *id,
                  const char *task)
{
    size_t channel;
    if (controller->state != FACULTY_IDLE) return 0;
    channel = find_channel(controller, id);
    if (channel == FACULTY_MAX_CHANNELS ||
        !copy_checked(controller->task, sizeof(controller->task), task)) {
        return 0;
    }
    controller->active_channel = channel;
    controller->proposed_summary[0] = '\0';
    controller->proposed_artifact[0] = '\0';
    controller->queued_request[0] = '\0';
    controller->execution_request[0] = '\0';
    controller->state = FACULTY_EMITTING;
    return 1;
}

int faculty_emit(FacultyController *controller, const char *artifact,
                 const char *summary, const char *request)
{
    if (controller->state != FACULTY_EMITTING || artifact == NULL ||
        artifact[0] == '\0' || summary == NULL || summary[0] == '\0' ||
        controller->execution_request[0] != '\0' ||
        !copy_checked(controller->proposed_artifact,
                      sizeof(controller->proposed_artifact), artifact) ||
        !copy_checked(controller->proposed_summary,
                      sizeof(controller->proposed_summary), summary) ||
        !copy_checked(controller->queued_request,
                      sizeof(controller->queued_request), request)) {
        return 0;
    }
    return 1;
}

int faculty_emit_quantity_request(FacultyController *controller,
                                  const char *request)
{
    FacultyChannelState *channel;
    if (controller->state != FACULTY_EMITTING || request == NULL ||
        request[0] == '\0' || controller->active_channel >=
                                    controller->channel_count ||
        controller->proposed_artifact[0] != '\0' ||
        controller->proposed_summary[0] != '\0') {
        return 0;
    }
    channel = &controller->channels[controller->active_channel];
    if (strcmp(channel->id, "quantity") != 0) return 0;
    return copy_checked(controller->execution_request,
                        sizeof(controller->execution_request), request);
}

int faculty_close(FacultyController *controller)
{
    int has_artifact = controller->proposed_artifact[0] != '\0' &&
                       controller->proposed_summary[0] != '\0';
    int has_request = controller->execution_request[0] != '\0';
    if (controller->state != FACULTY_EMITTING || has_artifact == has_request) {
        return 0;
    }
    controller->state = FACULTY_CLOSED;
    return 1;
}

int faculty_resolve(FacultyController *controller, int verified)
{
    FacultyChannelState *channel;
    if (controller->state != FACULTY_CLOSED ||
        controller->execution_request[0] != '\0' ||
        controller->active_channel >= controller->channel_count) {
        return 0;
    }
    channel = &controller->channels[controller->active_channel];
    if (verified) {
        copy_checked(channel->artifact, sizeof(channel->artifact),
                     controller->proposed_artifact);
        copy_checked(channel->summary, sizeof(channel->summary),
                     controller->proposed_summary);
        copy_checked(channel->authority, sizeof(channel->authority),
                     "external-verifier");
        channel->verdict = FACULTY_VERIFIED;
        ++channel->revision;
        holo_encode(channel);
    } else {
        controller->queued_request[0] = '\0';
    }
    controller->state = FACULTY_IDLE;
    controller->active_channel = FACULTY_MAX_CHANNELS;
    controller->task[0] = '\0';
    controller->proposed_summary[0] = '\0';
    controller->proposed_artifact[0] = '\0';
    controller->execution_request[0] = '\0';
    return 1;
}

static void reset_active(FacultyController *controller)
{
    controller->state = FACULTY_IDLE;
    controller->active_channel = FACULTY_MAX_CHANNELS;
    controller->task[0] = '\0';
    controller->proposed_summary[0] = '\0';
    controller->proposed_artifact[0] = '\0';
    controller->execution_request[0] = '\0';
    controller->queued_request[0] = '\0';
}

static int request_operation_matches(const char *canonical,
                                     const char *proposal)
{
    const char *space = strchr(canonical, ' ');
    size_t length = space == NULL ? strlen(canonical)
                                  : (size_t)(space - canonical);
    return strlen(proposal) == length &&
           memcmp(canonical, proposal, length) == 0;
}

int faculty_execute_quantity(FacultyController *controller,
                             const char *source_input)
{
    FacultyChannelState *channel;
    char canonical[FACULTY_EXECUTION_REQUEST_CAPACITY];
    char artifact[FACULTY_ARTIFACT_CAPACITY];
    char summary[FACULTY_SUMMARY_CAPACITY];
    int valid;
    if (controller->state != FACULTY_CLOSED || source_input == NULL ||
        controller->active_channel >= controller->channel_count ||
        controller->execution_request[0] == '\0') {
        return 0;
    }
    channel = &controller->channels[controller->active_channel];
    valid = strcmp(channel->id, "quantity") == 0 &&
            quantity_request_from_input(source_input, canonical,
                                        sizeof(canonical)) &&
            (strcmp(canonical, controller->execution_request) == 0 ||
             request_operation_matches(canonical,
                                       controller->execution_request)) &&
            quantity_oracle_execute(canonical, artifact, sizeof(artifact),
                                    summary, sizeof(summary));
    if (!valid) {
        reset_active(controller);
        return 0;
    }
    if (!copy_checked(channel->artifact, sizeof(channel->artifact), artifact) ||
        !copy_checked(channel->summary, sizeof(channel->summary), summary) ||
        !copy_checked(channel->authority, sizeof(channel->authority),
                      "kernel")) {
        reset_active(controller);
        return 0;
    }
    channel->verdict = FACULTY_VERIFIED;
    ++channel->revision;
    holo_encode(channel);
    reset_active(controller);
    return 1;
}

const FacultyChannelState *faculty_get(const FacultyController *controller,
                                       const char *id)
{
    size_t channel = find_channel(controller, id);
    return channel == FACULTY_MAX_CHANNELS ? NULL
                                           : &controller->channels[channel];
}

const char *faculty_queued_request(const FacultyController *controller)
{
    return controller->queued_request;
}

const char *faculty_execution_request(const FacultyController *controller)
{
    return controller->execution_request;
}

#ifndef FACULTY_CONTROLLER_NO_MAIN
static int close_enough(float left, float right)
{
    return fabsf(left - right) < 1.0e-5f;
}

static int self_test(void)
{
    FacultyController controller;
    FacultyChannelState geometry_before;
    FacultyChannelState quantity_before;
    const FacultyChannelState *geometry;
    const FacultyChannelState *art;
    const FacultyChannelState *quantity;
    float norm = 0.0f;
    size_t index;
    faculty_controller_init(&controller);
    if (!faculty_register(&controller, "geometry", "no construction") ||
        !faculty_register(&controller, "art", "empty scene") ||
        !faculty_register(&controller, "quantity", "no exact result") ||
        faculty_register(&controller, "geometry", "duplicate")) {
        return 0;
    }
    geometry_before = *faculty_get(&controller, "geometry");
    if (!faculty_enter(&controller, "geometry", "construct") ||
        faculty_enter(&controller, "art", "compose") ||
        !faculty_emit(&controller, "midpoint M 4 6",
                      "M is the midpoint", "art") ||
        faculty_resolve(&controller, 1) ||
        !faculty_close(&controller) ||
        strcmp(faculty_queued_request(&controller), "art") != 0 ||
        !faculty_resolve(&controller, 0)) {
        return 0;
    }
    geometry = faculty_get(&controller, "geometry");
    if (memcmp(geometry, &geometry_before, sizeof(*geometry)) != 0 ||
        faculty_queued_request(&controller)[0] != '\0' ||
        controller.state != FACULTY_IDLE) {
        return 0;
    }
    if (!faculty_enter(&controller, "geometry", "construct") ||
        !faculty_emit(&controller, "midpoint M 4 6",
                      "M is the midpoint", "art") ||
        !faculty_close(&controller) || !faculty_resolve(&controller, 1)) {
        return 0;
    }
    geometry = faculty_get(&controller, "geometry");
    art = faculty_get(&controller, "art");
    if (geometry->revision != 1 ||
        strcmp(geometry->summary, "M is the midpoint") != 0 ||
        art->revision != 0 || strcmp(art->summary, "empty scene") != 0) {
        return 0;
    }
    for (index = 0; index < FACULTY_HOLO_DIMENSION; ++index) {
        norm += geometry->holo[index] * geometry->holo[index];
    }
    if (!close_enough(norm, 1.0f)) return 0;
    quantity_before = *faculty_get(&controller, "quantity");
    if (!faculty_enter(&controller, "quantity", "add") ||
        !faculty_emit_quantity_request(&controller, "quantity.add 2 3") ||
        !faculty_close(&controller) ||
        faculty_execute_quantity(&controller, "add 2 4")) {
        return 0;
    }
    quantity = faculty_get(&controller, "quantity");
    if (memcmp(quantity, &quantity_before, sizeof(*quantity)) != 0 ||
        controller.state != FACULTY_IDLE) {
        return 0;
    }
    if (!faculty_enter(&controller, "quantity", "add") ||
        !faculty_emit_quantity_request(&controller, "quantity.add 2 3") ||
        !faculty_close(&controller) ||
        !faculty_execute_quantity(&controller, "add 2 3")) {
        return 0;
    }
    quantity = faculty_get(&controller, "quantity");
    if (quantity->revision != 1 ||
        strcmp(quantity->artifact, "result 5") != 0 ||
        strcmp(quantity->summary, "kernel committed result 5") != 0 ||
        strcmp(quantity->authority, "kernel") != 0) {
        return 0;
    }
    quantity_before = *quantity;
    if (!faculty_enter(&controller, "quantity", "multiply") ||
        !faculty_emit_quantity_request(&controller, "quantity.add") ||
        !faculty_close(&controller) ||
        faculty_execute_quantity(&controller, "multiply 2 3")) {
        return 0;
    }
    quantity = faculty_get(&controller, "quantity");
    if (memcmp(quantity, &quantity_before, sizeof(*quantity)) != 0) return 0;
    if (!faculty_enter(&controller, "quantity", "add") ||
        !faculty_emit_quantity_request(&controller, "quantity.add") ||
        !faculty_close(&controller) ||
        !faculty_execute_quantity(&controller, "add 4 6")) {
        return 0;
    }
    quantity = faculty_get(&controller, "quantity");
    if (quantity->revision != 2 ||
        strcmp(quantity->artifact, "result 10") != 0 ||
        strcmp(quantity->authority, "kernel") != 0) {
        return 0;
    }
    printf("faculty-controller self-test: atomic rejection, commit, switch "
           "lock, isolation, request binding, exact execution, authority, "
           "and 256D registration passed\n");
    return 1;
}

int main(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) {
        return self_test() ? EXIT_SUCCESS : EXIT_FAILURE;
    }
    fprintf(stderr, "usage: %s --self-test\n", argv[0]);
    return EXIT_FAILURE;
}
#endif
