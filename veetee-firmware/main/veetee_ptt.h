#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    VT_PTT_EVENT_NONE = 0,
    VT_PTT_EVENT_PRESSED,
    VT_PTT_EVENT_RELEASED,
} vt_ptt_event_t;

typedef struct {
    bool stable;
    bool candidate;
    uint8_t consecutive_samples;
    uint8_t debounce_samples;
} vt_ptt_debouncer_t;

void vt_ptt_debouncer_init(vt_ptt_debouncer_t *debouncer, bool initial_state, uint8_t debounce_samples);
vt_ptt_event_t vt_ptt_debouncer_update(vt_ptt_debouncer_t *debouncer, bool active);
bool vt_ptt_debouncer_is_stable(const vt_ptt_debouncer_t *debouncer);
