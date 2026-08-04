#pragma once

#include <stdbool.h>

/*
 * A missing session_id is accepted for legacy peers.  Once a peer sends the
 * field, it must be a non-empty match for the currently active session.
 */
bool vt_wire_session_matches(const char *active_session,
                             bool incoming_present,
                             const char *incoming_session);
