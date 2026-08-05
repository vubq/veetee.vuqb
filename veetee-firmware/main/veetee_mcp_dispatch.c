#include "veetee_mcp_dispatch.h"

#include <limits.h>
#include <stdio.h>
#include <string.h>

static const cJSON *object_item(const cJSON *object, const char *name) {
    return object == NULL || name == NULL ? NULL : cJSON_GetObjectItemCaseSensitive(object, name);
}

static bool positive_request_id(const cJSON *value, int32_t *request_id) {
    if (request_id == NULL || !cJSON_IsNumber(value) ||
        value->valuedouble != (double)value->valueint || value->valueint <= 0 ||
        value->valueint > INT32_MAX) {
        return false;
    }
    *request_id = value->valueint;
    return true;
}

static const char *error_message(vt_mcp_result_t result) {
    switch (result) {
    case VT_MCP_ERR_TOOL_NOT_FOUND: return "tool not found";
    case VT_MCP_ERR_DUPLICATE_CONFLICT: return "request id conflicts with a previous call";
    case VT_MCP_ERR_DUPLICATE_EXPIRED: return "request id has expired from the duplicate cache";
    case VT_MCP_ERR_RESULT_TOO_LARGE: return "tool result exceeds the bounded response size";
    case VT_MCP_ERR_REQUEST_ID: return "request id is invalid";
    default: return "tool call failed";
    }
}

static size_t cursor_index(const vt_mcp_registry_t *registry, const cJSON *params, bool *valid) {
    if (valid == NULL) return 0U;
    *valid = true;
    if (params == NULL) return 0U;
    const cJSON *cursor = object_item(params, "cursor");
    if (cursor == NULL) return 0U;
    if (!cJSON_IsString(cursor) || cursor->valuestring == NULL || registry == NULL) {
        *valid = false;
        return 0U;
    }
    for (size_t index = 0U; index < registry->tool_count; ++index) {
        const vt_mcp_tool_t *tool = vt_mcp_registry_tool_at(registry, index);
        if (tool != NULL && tool->name != NULL && strcmp(tool->name, cursor->valuestring) == 0) return index;
    }
    *valid = false;
    return 0U;
}

static vt_mcp_dispatch_result_t write_error(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *message,
    size_t *output_length) {
    const vt_mcp_wire_result_t result = vt_mcp_wire_write_error(
        output, output_capacity, session_id, request_id, message, output_length);
    return result == VT_MCP_WIRE_OK ? VT_MCP_DISPATCH_OK : VT_MCP_DISPATCH_ERR_CAPACITY;
}

vt_mcp_dispatch_result_t vt_mcp_dispatch_message(
    const cJSON *message,
    const char *active_session_id,
    const char *server_name,
    const char *server_version,
    vt_mcp_registry_t *registry,
    char *output,
    size_t output_capacity,
    size_t *output_length) {
    if (message == NULL || active_session_id == NULL || server_name == NULL ||
        server_version == NULL || registry == NULL || output == NULL || output_length == NULL) {
        return VT_MCP_DISPATCH_ERR_ARGUMENT;
    }
    *output_length = 0U;
    if (!cJSON_IsObject(message)) return VT_MCP_DISPATCH_ERR_ENVELOPE;
    const cJSON *type = object_item(message, "type");
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "mcp") != 0) {
        return VT_MCP_DISPATCH_ERR_ENVELOPE;
    }
    const cJSON *session = object_item(message, "session_id");
    if (session != NULL && (!cJSON_IsString(session) || strcmp(session->valuestring, active_session_id) != 0)) {
        return VT_MCP_DISPATCH_ERR_ENVELOPE;
    }
    const cJSON *payload = object_item(message, "payload");
    if (!cJSON_IsObject(payload)) return VT_MCP_DISPATCH_ERR_ENVELOPE;
    const cJSON *jsonrpc = object_item(payload, "jsonrpc");
    if (!cJSON_IsString(jsonrpc) || strcmp(jsonrpc->valuestring, "2.0") != 0) {
        return VT_MCP_DISPATCH_ERR_ENVELOPE;
    }
    const cJSON *id_value = object_item(payload, "id");
    const cJSON *method_value = object_item(payload, "method");
    if (!cJSON_IsString(method_value) || method_value->valuestring == NULL) {
        return VT_MCP_DISPATCH_ERR_METHOD;
    }
    if (strncmp(method_value->valuestring, "notifications", 13U) == 0) {
        return VT_MCP_DISPATCH_IGNORED;
    }
    int32_t request_id = 0;
    if (!positive_request_id(id_value, &request_id)) return VT_MCP_DISPATCH_ERR_REQUEST_ID;
    const cJSON *params = object_item(payload, "params");
    if (params != NULL && !cJSON_IsObject(params)) return write_error(
        output, output_capacity, active_session_id, request_id, "params must be an object", output_length);

    if (strcmp(method_value->valuestring, "initialize") == 0) {
        const vt_mcp_wire_result_t result = vt_mcp_wire_write_initialize(
            output, output_capacity, active_session_id, request_id, "2024-11-05",
            server_name, server_version, output_length);
        return result == VT_MCP_WIRE_OK ? VT_MCP_DISPATCH_OK : VT_MCP_DISPATCH_ERR_CAPACITY;
    }
    if (strcmp(method_value->valuestring, "tools/list") == 0) {
        bool valid_cursor = true;
        const size_t start = cursor_index(registry, params, &valid_cursor);
        if (!valid_cursor) return write_error(
            output, output_capacity, active_session_id, request_id, "cursor is invalid", output_length);
        size_t next = start;
        const vt_mcp_wire_result_t result = vt_mcp_wire_write_tools_list(
            output, output_capacity, active_session_id, request_id, registry, start,
            VT_MCP_WIRE_DEFAULT_PAGE_SIZE, &next, output_length);
        return result == VT_MCP_WIRE_OK ? VT_MCP_DISPATCH_OK :
               result == VT_MCP_WIRE_ERR_CAPACITY ? VT_MCP_DISPATCH_ERR_CAPACITY : VT_MCP_DISPATCH_ERR_REGISTRY;
    }
    if (strcmp(method_value->valuestring, "tools/call") == 0) {
        const cJSON *name = object_item(params, "name");
        const cJSON *arguments = object_item(params, "arguments");
        if (!cJSON_IsString(name) || name->valuestring == NULL ||
            (arguments != NULL && !cJSON_IsObject(arguments))) {
            return write_error(output, output_capacity, active_session_id, request_id,
                               "tool name and object arguments are required", output_length);
        }
        cJSON *empty_arguments = arguments == NULL ? cJSON_CreateObject() : NULL;
        const cJSON *arguments_object = arguments == NULL ? empty_arguments : arguments;
        char *arguments_json = cJSON_PrintUnformatted(arguments_object);
        if (empty_arguments != NULL) cJSON_Delete(empty_arguments);
        if (arguments_json == NULL) return VT_MCP_DISPATCH_ERR_CAPACITY;
        const uint32_t digest = vt_mcp_digest_call(method_value->valuestring, name->valuestring, arguments_json);
        vt_mcp_call_result_t call_result = {0};
        const vt_mcp_result_t registry_result = vt_mcp_registry_call(
            registry, &(vt_mcp_call_t){.request_id = request_id, .argument_digest = digest,
                                       .tool_name = name->valuestring, .arguments_json = arguments_json},
            &call_result);
        cJSON_free(arguments_json);
        if (registry_result != VT_MCP_OK) return write_error(
            output, output_capacity, active_session_id, request_id,
            error_message(registry_result), output_length);
        const vt_mcp_wire_result_t wire_result = vt_mcp_wire_write_result(
            output, output_capacity, active_session_id, request_id,
            call_result.result_json, call_result.result_length, output_length);
        return wire_result == VT_MCP_WIRE_OK ? VT_MCP_DISPATCH_OK : VT_MCP_DISPATCH_ERR_CAPACITY;
    }
    return write_error(output, output_capacity, active_session_id, request_id,
                       "method not found", output_length);
}
