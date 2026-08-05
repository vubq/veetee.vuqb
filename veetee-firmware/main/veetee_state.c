#include "veetee_state.h"

#include <stddef.h>
#include <stdint.h>

static bool event_allowed(vt_device_state_t from, vt_device_event_t event) {
    switch (event) {
    case VT_EVENT_CONNECT:
        return from == VT_DEVICE_IDLE || from == VT_DEVICE_CONNECTING;
    case VT_EVENT_HELLO_READY:
        return from == VT_DEVICE_CONNECTING;
    case VT_EVENT_LISTEN_START:
        return from == VT_DEVICE_IDLE || from == VT_DEVICE_LISTENING;
    case VT_EVENT_LISTEN_STOP:
        return from == VT_DEVICE_LISTENING;
    case VT_EVENT_TTS_START:
        return from == VT_DEVICE_IDLE || from == VT_DEVICE_LISTENING || from == VT_DEVICE_THINKING;
    case VT_EVENT_TTS_STOP:
    case VT_EVENT_TTS_STOP_MANUAL:
    case VT_EVENT_TTS_STOP_AUTO:
        return from == VT_DEVICE_SPEAKING;
    case VT_EVENT_ABORT:
        return from == VT_DEVICE_THINKING || from == VT_DEVICE_SPEAKING;
    case VT_EVENT_DISCONNECT:
        return true;
    default:
        return false;
    }
}

bool vt_state_can_transition(vt_device_state_t from, vt_device_state_t to) {
    if (from == to) return true;
    if (to == VT_DEVICE_IDLE) return true;
    if (from == VT_DEVICE_IDLE && to == VT_DEVICE_CONNECTING) return true;
    /* A connected device can return to listening after a manual response has
       drained to idle. The transport remains ready; it does not reconnect for
       every PTT turn. */
    if (from == VT_DEVICE_IDLE && to == VT_DEVICE_LISTENING) return true;
    /* A delayed tts/start may arrive after the local listening/turn marker has
       already settled to idle. The current session still owns the response,
       so accept playback without manufacturing a reconnect. */
    if (from == VT_DEVICE_IDLE && to == VT_DEVICE_SPEAKING) return true;
    if (from == VT_DEVICE_CONNECTING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_LISTENING && to == VT_DEVICE_THINKING) return true;
    if (from == VT_DEVICE_THINKING && to == VT_DEVICE_SPEAKING) return true;
    if (from == VT_DEVICE_THINKING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_SPEAKING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_LISTENING && to == VT_DEVICE_SPEAKING) return true;
    return false;
}

bool vt_state_is_interruptible(vt_device_state_t state) {
    return state == VT_DEVICE_THINKING || state == VT_DEVICE_SPEAKING;
}

bool vt_state_apply(vt_device_state_machine_t *machine, vt_device_event_t event) {
    if (machine == NULL) return false;
    if (!event_allowed(machine->state, event)) return false;
    vt_device_state_t next = machine->state;
    switch (event) {
    case VT_EVENT_CONNECT: next = VT_DEVICE_CONNECTING; break;
    case VT_EVENT_HELLO_READY: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_LISTEN_START: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_LISTEN_STOP: next = VT_DEVICE_THINKING; break;
    case VT_EVENT_TTS_START: next = VT_DEVICE_SPEAKING; break;
    case VT_EVENT_TTS_STOP: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_TTS_STOP_MANUAL: next = VT_DEVICE_IDLE; break;
    case VT_EVENT_TTS_STOP_AUTO: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_ABORT: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_DISCONNECT: next = VT_DEVICE_IDLE; break;
    default: return false;
    }
    if (!vt_state_can_transition(machine->state, next)) return false;
    const bool changed = machine->state != next;
    machine->state = next;
    if (changed && (event == VT_EVENT_ABORT || event == VT_EVENT_DISCONNECT)) machine->generation++;
    return changed || event == VT_EVENT_CONNECT || event == VT_EVENT_LISTEN_START || event == VT_EVENT_DISCONNECT;
}

const char *vt_state_name(vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_IDLE: return "idle";
    case VT_DEVICE_CONNECTING: return "connecting";
    case VT_DEVICE_LISTENING: return "listening";
    case VT_DEVICE_THINKING: return "thinking";
    case VT_DEVICE_SPEAKING: return "speaking";
    default: return "unknown";
    }
}
