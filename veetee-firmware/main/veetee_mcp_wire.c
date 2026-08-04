#include "veetee_mcp_wire.h"

#include <inttypes.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

/* Keep literal lengths coupled to their values.  Hand-counted lengths caused
 * malformed frames when the envelope was extended. */
#define APPEND_LITERAL(writer, value) \
    append_bytes((writer), (value), sizeof(value) - 1U)

typedef struct {
    char *buffer;
    size_t capacity;
    size_t length;
    bool failed;
} writer_t;

static bool append_bytes(writer_t *writer, const char *bytes, size_t length) {
    if (writer == NULL || bytes == NULL || writer->failed ||
        writer->length >= writer->capacity ||
        length > writer->capacity - writer->length - 1U) {
        if (writer != NULL) writer->failed = true;
        return false;
    }
    memcpy(writer->buffer + writer->length, bytes, length);
    writer->length += length;
    writer->buffer[writer->length] = '\0';
    return true;
}

static bool append_format(writer_t *writer, const char *format, ...) {
    if (writer == NULL || writer->failed || format == NULL ||
        writer->length >= writer->capacity) {
        if (writer != NULL) writer->failed = true;
        return false;
    }
    va_list arguments;
    va_start(arguments, format);
    const int written = vsnprintf(writer->buffer + writer->length,
                                  writer->capacity - writer->length,
                                  format,
                                  arguments);
    va_end(arguments);
    if (written < 0 || (size_t)written >= writer->capacity - writer->length) {
        writer->failed = true;
        return false;
    }
    writer->length += (size_t)written;
    return true;
}

static bool append_escaped_string(writer_t *writer, const char *value) {
    if (writer == NULL || value == NULL) {
        if (writer != NULL) writer->failed = true;
        return false;
    }
    if (!APPEND_LITERAL(writer, "\"")) return false;
    for (const unsigned char *cursor = (const unsigned char *)value;
         *cursor != '\0'; ++cursor) {
        char escape[7];
        switch (*cursor) {
        case '"':
            if (!APPEND_LITERAL(writer, "\\\"")) return false;
            break;
        case '\\':
            if (!APPEND_LITERAL(writer, "\\\\")) return false;
            break;
        case '\b':
            if (!APPEND_LITERAL(writer, "\\b")) return false;
            break;
        case '\f':
            if (!APPEND_LITERAL(writer, "\\f")) return false;
            break;
        case '\n':
            if (!APPEND_LITERAL(writer, "\\n")) return false;
            break;
        case '\r':
            if (!APPEND_LITERAL(writer, "\\r")) return false;
            break;
        case '\t':
            if (!APPEND_LITERAL(writer, "\\t")) return false;
            break;
        default:
            if (*cursor < 0x20U) {
                const int written = snprintf(escape, sizeof(escape), "\\u%04x", *cursor);
                if (written != 6 || !append_bytes(writer, escape, 6U)) return false;
            } else if (!append_bytes(writer, (const char *)cursor, 1U)) {
                return false;
            }
            break;
        }
    }
    return APPEND_LITERAL(writer, "\"");
}

static bool valid_request_id(int32_t request_id) {
    return request_id > 0;
}

/* This is deliberately a bounded envelope check, not a second JSON parser.
 * cJSON/parser integration will validate inbound payloads before dispatch. */
static bool valid_json_object(const char *json, size_t length) {
    if (json == NULL || length < 2U) return false;
    size_t first = 0U;
    while (first < length && (json[first] == ' ' || json[first] == '\n' ||
                              json[first] == '\r' || json[first] == '\t')) {
        ++first;
    }
    if (first >= length || json[first] != '{') return false;
    size_t last = length;
    while (last > first && (json[last - 1U] == ' ' || json[last - 1U] == '\n' ||
                            json[last - 1U] == '\r' || json[last - 1U] == '\t')) {
        --last;
    }
    return last > first && json[last - 1U] == '}';
}

static vt_mcp_wire_result_t finish(writer_t *writer, size_t *output_length) {
    if (writer == NULL || output_length == NULL) return VT_MCP_WIRE_ERR_ARGUMENT;
    if (writer->failed) return VT_MCP_WIRE_ERR_CAPACITY;
    *output_length = writer->length;
    return VT_MCP_WIRE_OK;
}

/* Starts the outer envelope and JSON-RPC id.  The caller chooses result/error
 * because JSON-RPC errors are siblings of result, not nested in it. */
static vt_mcp_wire_result_t begin(
    writer_t *writer,
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id) {
    if (writer == NULL || output == NULL || output_capacity == 0U || session_id == NULL) {
        return VT_MCP_WIRE_ERR_ARGUMENT;
    }
    if (!valid_request_id(request_id)) return VT_MCP_WIRE_ERR_REQUEST_ID;
    writer->buffer = output;
    writer->capacity = output_capacity > VT_MCP_WIRE_MAX_BYTES + 1U
                           ? VT_MCP_WIRE_MAX_BYTES + 1U
                           : output_capacity;
    writer->length = 0U;
    writer->failed = false;
    output[0] = '\0';
    if (!APPEND_LITERAL(writer, "{\"session_id\":")) return VT_MCP_WIRE_ERR_CAPACITY;
    if (!append_escaped_string(writer, session_id)) return VT_MCP_WIRE_ERR_CAPACITY;
    if (!append_format(writer,
                       ",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":%" PRId32,
                       request_id)) {
        return VT_MCP_WIRE_ERR_CAPACITY;
    }
    return VT_MCP_WIRE_OK;
}

static vt_mcp_wire_result_t begin_result(
    writer_t *writer,
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id) {
    const vt_mcp_wire_result_t status = begin(writer, output, output_capacity, session_id, request_id);
    if (status != VT_MCP_WIRE_OK) return status;
    if (!APPEND_LITERAL(writer, ",\"result\":")) return VT_MCP_WIRE_ERR_CAPACITY;
    return VT_MCP_WIRE_OK;
}

static vt_mcp_wire_result_t write_result_json(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *result_json,
    size_t result_length,
    size_t *output_length) {
    writer_t writer = {0};
    if (!valid_json_object(result_json, result_length)) return VT_MCP_WIRE_ERR_JSON;
    const vt_mcp_wire_result_t status = begin_result(
        &writer, output, output_capacity, session_id, request_id);
    if (status != VT_MCP_WIRE_OK) return status;
    if (!append_bytes(&writer, result_json, result_length) ||
        !APPEND_LITERAL(&writer, "}}")) {
        return writer.failed ? VT_MCP_WIRE_ERR_CAPACITY : VT_MCP_WIRE_ERR_JSON;
    }
    return finish(&writer, output_length);
}

vt_mcp_wire_result_t vt_mcp_wire_write_initialize(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *protocol_version,
    const char *server_name,
    const char *server_version,
    size_t *output_length) {
    if (protocol_version == NULL || server_name == NULL || server_version == NULL) {
        return VT_MCP_WIRE_ERR_ARGUMENT;
    }
    writer_t writer = {0};
    const vt_mcp_wire_result_t status = begin_result(
        &writer, output, output_capacity, session_id, request_id);
    if (status != VT_MCP_WIRE_OK) return status;
    if (!APPEND_LITERAL(&writer, "{\"protocolVersion\":") ||
        !append_escaped_string(&writer, protocol_version) ||
        !APPEND_LITERAL(&writer, ",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":") ||
        !append_escaped_string(&writer, server_name) ||
        !APPEND_LITERAL(&writer, ",\"version\":") ||
        !append_escaped_string(&writer, server_version) ||
        !APPEND_LITERAL(&writer, "}}}}")) {
        return VT_MCP_WIRE_ERR_CAPACITY;
    }
    return finish(&writer, output_length);
}

vt_mcp_wire_result_t vt_mcp_wire_write_tools_list(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const vt_mcp_registry_t *registry,
    size_t start_index,
    size_t page_size,
    size_t *next_index,
    size_t *output_length) {
    if (registry == NULL || next_index == NULL || start_index > registry->tool_count) {
        return VT_MCP_WIRE_ERR_ARGUMENT;
    }
    if (page_size == 0U) page_size = VT_MCP_WIRE_DEFAULT_PAGE_SIZE;
    writer_t writer = {0};
    const vt_mcp_wire_result_t status = begin_result(
        &writer, output, output_capacity, session_id, request_id);
    if (status != VT_MCP_WIRE_OK) return status;
    if (!APPEND_LITERAL(&writer, "{\"tools\":[")) return VT_MCP_WIRE_ERR_CAPACITY;

    size_t emitted = 0U;
    size_t index = start_index;
    while (index < registry->tool_count && emitted < page_size) {
        const vt_mcp_tool_t *tool = vt_mcp_registry_tool_at(registry, index);
        const char *schema = tool == NULL ? NULL : tool->input_schema_json;
        if (tool == NULL || schema == NULL || !valid_json_object(schema, strlen(schema))) {
            return VT_MCP_WIRE_ERR_JSON;
        }
        if (emitted > 0U && !APPEND_LITERAL(&writer, ",")) {
            return VT_MCP_WIRE_ERR_CAPACITY;
        }
        if (!APPEND_LITERAL(&writer, "{\"name\":") ||
            !append_escaped_string(&writer, tool->name) ||
            !APPEND_LITERAL(&writer, ",\"description\":") ||
            !append_escaped_string(&writer, tool->description == NULL ? "" : tool->description) ||
            !APPEND_LITERAL(&writer, ",\"inputSchema\":") ||
            !append_bytes(&writer, schema, strlen(schema)) ||
            !APPEND_LITERAL(&writer, "}")) {
            return VT_MCP_WIRE_ERR_CAPACITY;
        }
        ++index;
        ++emitted;
    }
    if (!APPEND_LITERAL(&writer, "]")) return VT_MCP_WIRE_ERR_CAPACITY;
    if (index < registry->tool_count) {
        const vt_mcp_tool_t *next_tool = vt_mcp_registry_tool_at(registry, index);
        if (next_tool == NULL || next_tool->name == NULL) return VT_MCP_WIRE_ERR_JSON;
        if (!APPEND_LITERAL(&writer, ",\"nextCursor\":") ||
            !append_escaped_string(&writer, next_tool->name)) {
            return VT_MCP_WIRE_ERR_CAPACITY;
        }
    }
    if (!APPEND_LITERAL(&writer, "}}}")) {
        return VT_MCP_WIRE_ERR_CAPACITY;
    }
    *next_index = index;
    return finish(&writer, output_length);
}

vt_mcp_wire_result_t vt_mcp_wire_write_result(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *result_json,
    size_t result_length,
    size_t *output_length) {
    return write_result_json(output, output_capacity, session_id, request_id,
                             result_json, result_length, output_length);
}

vt_mcp_wire_result_t vt_mcp_wire_write_error(
    char *output,
    size_t output_capacity,
    const char *session_id,
    int32_t request_id,
    const char *message,
    size_t *output_length) {
    if (message == NULL) return VT_MCP_WIRE_ERR_ARGUMENT;
    writer_t writer = {0};
    const vt_mcp_wire_result_t status = begin(
        &writer, output, output_capacity, session_id, request_id);
    if (status != VT_MCP_WIRE_OK) return status;
    if (!APPEND_LITERAL(&writer, ",\"error\":{\"message\":") ||
        !append_escaped_string(&writer, message) ||
        !APPEND_LITERAL(&writer, "}}}")) {
        return VT_MCP_WIRE_ERR_CAPACITY;
    }
    return finish(&writer, output_length);
}
