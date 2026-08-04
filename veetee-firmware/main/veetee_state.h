#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    VT_DEVICE_IDLE = 0,
    VT_DEVICE_CONNECTING,
    VT_DEVICE_LISTENING,
    VT_DEVICE_THINKING,
    VT_DEVICE_SPEAKING,
} vt_device_state_t;

typedef enum {
    VT_EVENT_CONNECT = 0,
    VT_EVENT_HELLO_READY,
    VT_EVENT_LISTEN_START,
    VT_EVENT_LISTEN_STOP,
    VT_EVENT_TTS_START,
    VT_EVENT_TTS_STOP,
    /* Internal mode-aware graceful-stop events.  The wire message remains
       `{"type":"tts","state":"stop"}`; the owner records interaction
       mode locally before selecting one of these events. */
    VT_EVENT_TTS_STOP_MANUAL,
    VT_EVENT_TTS_STOP_AUTO,
    VT_EVENT_ABORT,
    VT_EVENT_DISCONNECT,
} vt_device_event_t;

typedef struct {
    vt_device_state_t state;
    uint32_t generation;
} vt_device_state_machine_t;

bool vt_state_apply(vt_device_state_machine_t *machine, vt_device_event_t event);
bool vt_state_can_transition(vt_device_state_t from, vt_device_state_t to);
bool vt_state_is_interruptible(vt_device_state_t state);
const char *vt_state_name(vt_device_state_t state);
