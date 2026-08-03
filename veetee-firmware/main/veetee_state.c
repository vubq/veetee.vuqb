#include "veetee_state.h"

#include <stddef.h>
#include <stdint.h>

bool vt_state_can_transition(vt_device_state_t from, vt_device_state_t to) {
    if (from == to) return true;
    if (to == VT_DEVICE_IDLE) return true;
    if (from == VT_DEVICE_IDLE && to == VT_DEVICE_CONNECTING) return true;
    if (from == VT_DEVICE_CONNECTING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_LISTENING && to == VT_DEVICE_THINKING) return true;
    if (from == VT_DEVICE_THINKING && to == VT_DEVICE_SPEAKING) return true;
    if (from == VT_DEVICE_THINKING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_SPEAKING && to == VT_DEVICE_LISTENING) return true;
    if (from == VT_DEVICE_LISTENING && to == VT_DEVICE_SPEAKING) return true;
    return false;
}

bool vt_state_apply(vt_device_state_machine_t *machine, vt_device_event_t event) {
    if (machine == NULL) return false;
    vt_device_state_t next = machine->state;
    switch (event) {
    case VT_EVENT_CONNECT: next = VT_DEVICE_CONNECTING; break;
    case VT_EVENT_HELLO_READY: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_LISTEN_START: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_LISTEN_STOP: next = VT_DEVICE_THINKING; break;
    case VT_EVENT_TTS_START: next = VT_DEVICE_SPEAKING; break;
    case VT_EVENT_TTS_STOP: next = VT_DEVICE_LISTENING; break;
    case VT_EVENT_ABORT: next = VT_DEVICE_LISTENING; machine->generation++; break;
    case VT_EVENT_DISCONNECT: next = VT_DEVICE_IDLE; machine->generation++; break;
    default: return false;
    }
    if (!vt_state_can_transition(machine->state, next)) return false;
    machine->state = next;
    return true;
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
