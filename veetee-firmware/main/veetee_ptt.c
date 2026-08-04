#include "veetee_ptt.h"

#include <stddef.h>

void vt_ptt_debouncer_init(vt_ptt_debouncer_t *debouncer, bool initial_state, uint8_t debounce_samples) {
    if (debouncer == NULL) return;
    debouncer->stable = initial_state;
    debouncer->candidate = initial_state;
    debouncer->consecutive_samples = 0U;
    debouncer->debounce_samples = debounce_samples == 0U ? 1U : debounce_samples;
}

vt_ptt_event_t vt_ptt_debouncer_update(vt_ptt_debouncer_t *debouncer, bool active) {
    if (debouncer == NULL) return VT_PTT_EVENT_NONE;
    if (active != debouncer->candidate) {
        debouncer->candidate = active;
        debouncer->consecutive_samples = 0U;
        return VT_PTT_EVENT_NONE;
    }
    if (debouncer->consecutive_samples < debouncer->debounce_samples) {
        ++debouncer->consecutive_samples;
    }
    if (debouncer->consecutive_samples < debouncer->debounce_samples ||
        debouncer->stable == debouncer->candidate) {
        return VT_PTT_EVENT_NONE;
    }
    debouncer->stable = debouncer->candidate;
    return debouncer->stable ? VT_PTT_EVENT_PRESSED : VT_PTT_EVENT_RELEASED;
}

bool vt_ptt_debouncer_is_stable(const vt_ptt_debouncer_t *debouncer) {
    return debouncer != NULL && debouncer->stable;
}
