#pragma once

#include <stddef.h>
#include <stdint.h>

#include "veetee_mcp.h"

#define VT_MCP_WIRE_MAX_BYTES 8000U
#define VT_MCP_WIRE_DEFAULT_PAGE_SIZE 4U

typedef enum {
    VT_MCP_WIRE_OK = 0,
    VT_MCP_WIRE_ERR_ARGUMENT = -1,
    VT_MCP_WIRE_ERR_CAPACITY = -2,
    VT_MCP_WIRE_ERR_JSON = -3,
    VT_MCP_WIRE_ERR_REQUEST_ID = -4,
    VT_MCP_WIRE_ERR_CURSOR = -5,
} vt_mcp_wire_result_t;

vt_mcp_wire_result_t vt_mcp_wire_write_initialize(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *protocol_version,
    const char *server_name,
    const char *server_version,
    size_t *output_length);

vt_mcp_wire_result_t vt_mcp_wire_write_tools_list(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const vt_mcp_registry_t *registry,
    size_t start_index,
    size_t page_size,
    size_t *next_index,
    size_t *output_length);

vt_mcp_wire_result_t vt_mcp_wire_write_result(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *result_json,
    size_t result_length,
    size_t *output_length);

vt_mcp_wire_result_t vt_mcp_wire_write_error(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *message,
    size_t *output_length);
