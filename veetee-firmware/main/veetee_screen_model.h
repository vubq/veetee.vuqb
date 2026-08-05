#pragma once

#include <stdbool.h>

#include "veetee_state.h"

/* Pure screen semantics live outside LVGL so the state/display contract can
   be checked on the host and reused by another renderer later. */
typedef enum {
    VT_SCREEN_PAIRING = 0,
    VT_SCREEN_HOME,
    VT_SCREEN_CONNECTING,
    VT_SCREEN_LISTENING,
    VT_SCREEN_THINKING,
    VT_SCREEN_SPEAKING,
    VT_SCREEN_INTERRUPTED,
    VT_SCREEN_ERROR,
    VT_SCREEN_NOTICE,
} vt_screen_id_t;

vt_screen_id_t vt_screen_for_state(vt_device_state_t state);
bool vt_screen_is_overlay(vt_screen_id_t screen);
vt_screen_id_t vt_screen_overlay_restore(vt_screen_id_t screen, vt_device_state_t state);
