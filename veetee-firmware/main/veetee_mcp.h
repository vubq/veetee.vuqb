#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Bounds are protocol/resource guardrails, not a product tool catalog. */
#define VT_MCP_MAX_TOOLS 16U
#define VT_MCP_MAX_CACHE_ENTRIES 16U
#define VT_MCP_MAX_RESULT_BYTES 768U
#define VT_MCP_MAX_TOOL_NAME_BYTES 64U

typedef enum {
    VT_MCP_OK = 0,
    VT_MCP_ERR_ARGUMENT = -1,
    VT_MCP_ERR_REGISTRY = -2,
    VT_MCP_ERR_REQUEST_ID = -3,
    VT_MCP_ERR_TOOL_NOT_FOUND = -4,
    VT_MCP_ERR_DUPLICATE_CONFLICT = -5,
    VT_MCP_ERR_DUPLICATE_EXPIRED = -6,
    VT_MCP_ERR_RESULT_TOO_LARGE = -7,
    VT_MCP_ERR_INVOKE = -8,
} vt_mcp_result_t;

typedef vt_mcp_result_t (*vt_mcp_invoke_fn)(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context);

typedef struct {
    const char *name;
    const char *description;
    const char *input_schema_json;
    vt_mcp_invoke_fn invoke;
    void *context;
} vt_mcp_tool_t;

typedef struct {
    int32_t request_id;
    uint32_t argument_digest;
    const char *tool_name;
    const char *arguments_json;
} vt_mcp_call_t;

typedef struct {
    vt_mcp_result_t status;
    bool cached;
    const char *result_json;
    size_t result_length;
} vt_mcp_call_result_t;

typedef struct {
    bool used;
    int32_t request_id;
    uint32_t argument_digest;
    vt_mcp_result_t status;
    uint16_t result_length;
    char result_json[VT_MCP_MAX_RESULT_BYTES];
} vt_mcp_cache_entry_t;

typedef struct {
    const vt_mcp_tool_t *tools;
    size_t tool_count;
    int32_t highest_request_id;
    size_t next_cache_slot;
    vt_mcp_cache_entry_t cache[VT_MCP_MAX_CACHE_ENTRIES];
} vt_mcp_registry_t;

vt_mcp_result_t vt_mcp_registry_init(
    vt_mcp_registry_t *registry,
    const vt_mcp_tool_t *tools,
    size_t tool_count);

void vt_mcp_registry_reset_session(vt_mcp_registry_t *registry);

const vt_mcp_tool_t *vt_mcp_registry_tool_at(
    const vt_mcp_registry_t *registry,
    size_t index);

vt_mcp_result_t vt_mcp_registry_call(
    vt_mcp_registry_t *registry,
    const vt_mcp_call_t *call,
    vt_mcp_call_result_t *result);

uint32_t vt_mcp_digest_call(
    const char *method,
    const char *tool_name,
    const char *arguments_json);
