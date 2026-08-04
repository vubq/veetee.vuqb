#include "veetee_mcp_wire.h"

#include <assert.h>
#include <string.h>

static vt_mcp_result_t invoke_ok(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    (void)arguments_json;
    (void)context;
    const char *result = "{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"isError\":false}";
    const size_t length = strlen(result);
    assert(length < result_capacity);
    memcpy(result_json, result, length + 1U);
    *result_length = length;
    return VT_MCP_OK;
}

static void test_initialize_and_error_escape(void) {
    char output[VT_MCP_WIRE_MAX_BYTES + 1U];
    size_t length = 0U;
    assert(vt_mcp_wire_write_initialize(output, sizeof(output), "session-1", 1, "2024-11-05", "veetee-firmware", "0.1.0", &length) == VT_MCP_WIRE_OK);
    assert(strcmp(output, "{\"session_id\":\"session-1\",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"veetee-firmware\",\"version\":\"0.1.0\"}}}}") == 0);
    assert(length == strlen(output));

    assert(vt_mcp_wire_write_error(output, sizeof(output), "session-1", 2, "bad \"argument\"", &length) == VT_MCP_WIRE_OK);
    assert(strcmp(output, "{\"session_id\":\"session-1\",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"message\":\"bad \\\"argument\\\"\"}}}") == 0);
}

static void test_tools_list_pagination_and_result(void) {
    const vt_mcp_tool_t tools[] = {
        {.name = "device.status.get", .description = "Status", .input_schema_json = "{\"type\":\"object\"}", .invoke = invoke_ok},
        {.name = "device.display.show_text", .description = "Hiển thị", .input_schema_json = "{\"type\":\"object\"}", .invoke = invoke_ok},
        {.name = "device.presence.read", .description = "Presence", .input_schema_json = "{\"type\":\"object\"}", .invoke = invoke_ok},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 3U) == VT_MCP_OK);
    char output[VT_MCP_WIRE_MAX_BYTES + 1U];
    size_t length = 0U;
    size_t next = 0U;
    assert(vt_mcp_wire_write_tools_list(output, sizeof(output), "session-1", 3, &registry, 0U, 2U, &next, &length) == VT_MCP_WIRE_OK);
    assert(next == 2U);
    assert(strstr(output, "device.status.get") != NULL);
    assert(strstr(output, "nextCursor\":\"device.presence.read\"") != NULL);
    assert(vt_mcp_wire_write_tools_list(output, sizeof(output), "session-1", 4, &registry, next, 2U, &next, &length) == VT_MCP_WIRE_OK);
    assert(next == 3U);
    assert(strstr(output, "nextCursor") == NULL);

    const char *result = "{\"content\":[],\"isError\":false}";
    assert(vt_mcp_wire_write_result(output, sizeof(output), "session-1", 5, result, strlen(result), &length) == VT_MCP_WIRE_OK);
    assert(strstr(output, "\"id\":5") != NULL);
}

static void test_wire_rejects_invalid_json_and_capacity(void) {
    char output[64];
    size_t length = 0U;
    assert(vt_mcp_wire_write_result(output, sizeof(output), "session", 1, "[]", 2U, &length) == VT_MCP_WIRE_ERR_JSON);
    assert(vt_mcp_wire_write_initialize(output, sizeof(output), "session", 1, "2024-11-05", "server", "0.1", &length) == VT_MCP_WIRE_ERR_CAPACITY);
    assert(vt_mcp_wire_write_initialize(output, sizeof(output), "session", 0, "2024-11-05", "server", "0.1", &length) == VT_MCP_WIRE_ERR_REQUEST_ID);
    assert(vt_mcp_wire_write_error(output, sizeof(output), "session", -1, "bad", &length) == VT_MCP_WIRE_ERR_REQUEST_ID);

    const vt_mcp_tool_t null_schema_tool = {
        .name = "device.schema.missing",
        .description = "missing schema",
        .input_schema_json = NULL,
        .invoke = invoke_ok,
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, &null_schema_tool, 1U) == VT_MCP_OK);
    char large_output[VT_MCP_WIRE_MAX_BYTES + 1U];
    size_t next = 0U;
    assert(vt_mcp_wire_write_tools_list(large_output, sizeof(large_output), "session", 1, &registry, 0U, 1U, &next, &length) == VT_MCP_WIRE_ERR_JSON);
}

int main(void) {
    test_initialize_and_error_escape();
    test_tools_list_pagination_and_result();
    test_wire_rejects_invalid_json_and_capacity();
    return 0;
}
