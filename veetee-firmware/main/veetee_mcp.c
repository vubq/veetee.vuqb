#include "veetee_mcp.h"

#include <limits.h>
#include <string.h>

static const uint32_t VT_MCP_FNV_OFFSET = 2166136261U;
static const uint32_t VT_MCP_FNV_PRIME = 16777619U;

static bool valid_tool_name(const char *name) {
    if (name == NULL || name[0] == '\0') return false;
    return strnlen(name, VT_MCP_MAX_TOOL_NAME_BYTES) < VT_MCP_MAX_TOOL_NAME_BYTES;
}

static const vt_mcp_tool_t *find_tool(
    const vt_mcp_registry_t *registry,
    const char *name) {
    if (registry == NULL || name == NULL) return NULL;
    for (size_t index = 0U; index < registry->tool_count; ++index) {
        if (strcmp(registry->tools[index].name, name) == 0) return &registry->tools[index];
    }
    return NULL;
}

static vt_mcp_cache_entry_t *find_cache(
    vt_mcp_registry_t *registry,
    int32_t request_id) {
    for (size_t index = 0U; index < VT_MCP_MAX_CACHE_ENTRIES; ++index) {
        vt_mcp_cache_entry_t *entry = &registry->cache[index];
        if (entry->used && entry->request_id == request_id) return entry;
    }
    return NULL;
}

static vt_mcp_result_t cache_result(
    vt_mcp_call_result_t *result,
    vt_mcp_cache_entry_t *entry,
    bool cached) {
    result->status = entry->status;
    result->cached = cached;
    result->result_json = entry->result_json;
    result->result_length = entry->result_length;
    return entry->status;
}

vt_mcp_result_t vt_mcp_registry_init(
    vt_mcp_registry_t *registry,
    const vt_mcp_tool_t *tools,
    size_t tool_count) {
    if (registry == NULL || (tool_count > 0U && tools == NULL) || tool_count > VT_MCP_MAX_TOOLS) {
        return VT_MCP_ERR_ARGUMENT;
    }
    memset(registry, 0, sizeof(*registry));
    registry->tools = tools;
    registry->tool_count = tool_count;
    for (size_t index = 0U; index < tool_count; ++index) {
        const vt_mcp_tool_t *tool = &tools[index];
        if (!valid_tool_name(tool->name) || tool->invoke == NULL) {
            memset(registry, 0, sizeof(*registry));
            return VT_MCP_ERR_REGISTRY;
        }
        for (size_t previous = 0U; previous < index; ++previous) {
            if (strcmp(tool->name, tools[previous].name) == 0) {
                memset(registry, 0, sizeof(*registry));
                return VT_MCP_ERR_REGISTRY;
            }
        }
    }
    return VT_MCP_OK;
}

void vt_mcp_registry_reset_session(vt_mcp_registry_t *registry) {
    if (registry == NULL) return;
    registry->highest_request_id = 0;
    registry->next_cache_slot = 0U;
    memset(registry->cache, 0, sizeof(registry->cache));
}

const vt_mcp_tool_t *vt_mcp_registry_tool_at(
    const vt_mcp_registry_t *registry,
    size_t index) {
    if (registry == NULL || index >= registry->tool_count) return NULL;
    return &registry->tools[index];
}

vt_mcp_result_t vt_mcp_registry_call(
    vt_mcp_registry_t *registry,
    const vt_mcp_call_t *call,
    vt_mcp_call_result_t *result) {
    if (registry == NULL || call == NULL || result == NULL ||
        (registry->tool_count > 0U && registry->tools == NULL) ||
        call->tool_name == NULL || call->arguments_json == NULL) {
        return VT_MCP_ERR_ARGUMENT;
    }
    memset(result, 0, sizeof(*result));
    if (call->request_id <= 0 || call->request_id > INT32_MAX) {
        result->status = VT_MCP_ERR_REQUEST_ID;
        return result->status;
    }

    if (call->request_id <= registry->highest_request_id) {
        vt_mcp_cache_entry_t *cached = find_cache(registry, call->request_id);
        if (cached == NULL) {
            result->status = VT_MCP_ERR_DUPLICATE_EXPIRED;
            return result->status;
        }
        if (cached->argument_digest != call->argument_digest) {
            result->status = VT_MCP_ERR_DUPLICATE_CONFLICT;
            return result->status;
        }
        return cache_result(result, cached, true);
    }

    /* Advance high-water before invoking the owner callback.  A callback may
       yield/re-enter through a transport adapter; a newer request must not
       make this request eligible for replay. */
    registry->highest_request_id = call->request_id;
    vt_mcp_cache_entry_t *entry = &registry->cache[registry->next_cache_slot];
    registry->next_cache_slot = (registry->next_cache_slot + 1U) % VT_MCP_MAX_CACHE_ENTRIES;
    memset(entry, 0, sizeof(*entry));
    entry->used = true;
    entry->request_id = call->request_id;
    entry->argument_digest = call->argument_digest;

    const vt_mcp_tool_t *tool = find_tool(registry, call->tool_name);
    if (tool == NULL) {
        entry->status = VT_MCP_ERR_TOOL_NOT_FOUND;
        return cache_result(result, entry, false);
    }

    size_t result_length = 0U;
    entry->status = tool->invoke(
        call->arguments_json,
        entry->result_json,
        sizeof(entry->result_json),
        &result_length,
        tool->context);
    if (result_length > sizeof(entry->result_json)) {
        entry->status = VT_MCP_ERR_RESULT_TOO_LARGE;
        entry->result_length = 0U;
    } else {
        entry->result_length = (uint16_t)result_length;
    }
    return cache_result(result, entry, false);
}

static uint32_t digest_bytes(uint32_t digest, const uint8_t *bytes, size_t length) {
    for (size_t index = 0U; index < length; ++index) {
        digest ^= bytes[index];
        digest *= VT_MCP_FNV_PRIME;
    }
    return digest;
}

static uint32_t digest_string(uint32_t digest, const char *value) {
    const size_t length = value == NULL ? 0U : strlen(value);
    const uint32_t length_u32 = (uint32_t)length;
    const uint8_t length_bytes[] = {
        (uint8_t)(length_u32 >> 24U),
        (uint8_t)(length_u32 >> 16U),
        (uint8_t)(length_u32 >> 8U),
        (uint8_t)length_u32,
    };
    digest = digest_bytes(digest, length_bytes, sizeof(length_bytes));
    return digest_bytes(digest, (const uint8_t *)(value == NULL ? "" : value), length);
}

uint32_t vt_mcp_digest_call(
    const char *method,
    const char *tool_name,
    const char *arguments_json) {
    uint32_t digest = VT_MCP_FNV_OFFSET;
    digest = digest_string(digest, method);
    digest = digest_string(digest, tool_name);
    return digest_string(digest, arguments_json);
}
