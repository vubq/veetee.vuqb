#include "veetee_wire_guard.h"

#include <stddef.h>
#include <string.h>

bool vt_wire_session_matches(const char *active_session,
                             bool incoming_present,
                             const char *incoming_session) {
    if (!incoming_present) return true;
    if (active_session == NULL || active_session[0] == '\0' ||
        incoming_session == NULL || incoming_session[0] == '\0') {
        return false;
    }
    return strcmp(active_session, incoming_session) == 0;
}
