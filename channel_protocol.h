#ifndef CHANNEL_PROTOCOL_H
#define CHANNEL_PROTOCOL_H

/* Shared, parameter-free channel structure inside the 128-token vocabulary. */
enum {
    CHANNEL_START_TOKEN = 1,
    CHANNEL_MESSAGE_TOKEN = 2,
    CHANNEL_REPLY_TOKEN = 3,
    CHANNEL_MESSAGE_END_TOKEN = 4,
    CHANNEL_RECORD_END_TOKEN = 5,
    CHANNEL_TARGET_TOKEN = 6,
    CHANNEL_SUMMARY_TOKEN = 7
};

#endif
