#include "veetee_screen_model.h"

vt_screen_id_t vt_screen_for_state(vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return VT_SCREEN_CONNECTING;
    case VT_DEVICE_LISTENING: return VT_SCREEN_LISTENING;
    case VT_DEVICE_THINKING: return VT_SCREEN_THINKING;
    case VT_DEVICE_SPEAKING: return VT_SCREEN_SPEAKING;
    case VT_DEVICE_IDLE:
    default: return VT_SCREEN_HOME;
    }
}

bool vt_screen_is_overlay(vt_screen_id_t screen) {
    return screen == VT_SCREEN_INTERRUPTED || screen == VT_SCREEN_ERROR || screen == VT_SCREEN_NOTICE;
}

vt_screen_id_t vt_screen_overlay_restore(vt_screen_id_t screen, vt_device_state_t state) {
    return vt_screen_is_overlay(screen) ? vt_screen_for_state(state) : screen;
}
