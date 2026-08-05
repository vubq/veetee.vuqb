#pragma once

#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "veetee_mcp.h"

#include "veetee_mcp_wire.h"

typedef enum {
    VT_MCP_DISPATCH_OK = 0,
    VT_MCP_DISPATCH_IGNORED = 1,
    VT_MCP_DISPATCH_ERR_ARGUMENT = -1,
    VT_MCP_DISPATCH_ERR_ENVELOPE = -2,
    VT_MCP_DISPATCH_ERR_REQUEST_ID = -3,
    VT_MCP_DISPATCH_ERR_METHOD = -4,
    VT_MCP_DISPATCH_ERR_CURSOR = -5,
    VT_MCP_DISPATCH_ERR_CAPACITY = -6,
    VT_MCP_DISPATCH_ERR_REGISTRY = -7,
} vt_mcp_dispatch_result_t;

/* Parse one already-framed MCP control object and serialize its response.
 * This function has no transport, task, GPIO, broker or audio side effect. */
vt_mcp_dispatch_result_t vt_mcp_dispatch_message(
    const cJSON *message,
    const char *active_session_id,
    const char *server_name,
    const char *server_version,
    vt_mcp_registry_t *registry,
    char *output,
    size_t output_capacity,
    size_t *output_length);
