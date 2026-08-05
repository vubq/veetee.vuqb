#include "veetee_mcp_dispatch.h"

#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

static unsigned int invocation_count;

static vt_mcp_result_t invoke_ok(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    (void)context;
    assert(strcmp(arguments_json, "{}") == 0 || strcmp(arguments_json, "{\"value\":7}") == 0);
    ++invocation_count;
    const char *result = "{\"content\":[{\"type\":\"text\",\"text\":\"ok\"}],\"isError\":false}";
    const size_t length = strlen(result);
    if (result_json == NULL || result_length == NULL || result_capacity <= length) return VT_MCP_ERR_INVOKE;
    memcpy(result_json, result, length + 1U);
    *result_length = length;
    return VT_MCP_OK;
}

static cJSON *parse(const char *text) {
    cJSON *value = cJSON_Parse(text);
    assert(value != NULL);
    return value;
}

static void test_initialize_and_notification(void) {
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, NULL, 0U) == VT_MCP_OK);
    char output[VT_MCP_WIRE_MAX_BYTES + 1U] = {0};
    size_t length = 0U;
    cJSON *initialize = parse("{\"session_id\":\"session\",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}}");
    assert(vt_mcp_dispatch_message(initialize, "session", "veetee-firmware", "0.1.0",
                                   &registry, output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(strstr(output, "protocolVersion\":\"2024-11-05") != NULL);
    cJSON_Delete(initialize);

    cJSON *notification = parse("{\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"method\":\"notifications/tools/list_changed\"}}");
    assert(vt_mcp_dispatch_message(notification, "session", "server", "0.1",
                                   &registry, output, sizeof(output), &length) == VT_MCP_DISPATCH_IGNORED);
    cJSON_Delete(notification);
}

static void test_list_and_call_deduplication(void) {
    const vt_mcp_tool_t tools[] = {
        {.name = "device.status.get", .description = "Status", .input_schema_json = "{\"type\":\"object\"}", .invoke = invoke_ok},
        {.name = "device.presence.read", .description = "Presence", .input_schema_json = "{\"type\":\"object\"}", .invoke = invoke_ok},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 2U) == VT_MCP_OK);
    char output[VT_MCP_WIRE_MAX_BYTES + 1U] = {0};
    size_t length = 0U;
    cJSON *list = parse("{\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}}");
    assert(vt_mcp_dispatch_message(list, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(strstr(output, "device.status.get") != NULL);
    assert(strstr(output, "device.presence.read") != NULL);
    cJSON_Delete(list);

    invocation_count = 0U;
    cJSON *call = parse("{\"session_id\":\"session\",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"device.status.get\",\"arguments\":{}}}}");
    assert(vt_mcp_dispatch_message(call, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(invocation_count == 1U);
    assert(strstr(output, "isError\":false") != NULL);
    assert(vt_mcp_dispatch_message(call, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(invocation_count == 1U);
    cJSON_Delete(call);

    cJSON *conflict = parse("{\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"device.status.get\",\"arguments\":{\"value\":7}}}}");
    assert(vt_mcp_dispatch_message(conflict, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(strstr(output, "conflicts") != NULL);
    assert(invocation_count == 1U);
    cJSON_Delete(conflict);
}

static void test_fail_closed_envelope_and_method(void) {
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, NULL, 0U) == VT_MCP_OK);
    char output[VT_MCP_WIRE_MAX_BYTES + 1U] = {0};
    size_t length = 0U;
    cJSON *wrong_session = parse("{\"session_id\":\"other\",\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}}");
    assert(vt_mcp_dispatch_message(wrong_session, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_ERR_ENVELOPE);
    cJSON_Delete(wrong_session);

    cJSON *unknown = parse("{\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"unknown\"}}");
    assert(vt_mcp_dispatch_message(unknown, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_OK);
    assert(strstr(output, "method not found") != NULL);
    cJSON_Delete(unknown);

    cJSON *bad_id = parse("{\"type\":\"mcp\",\"payload\":{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\"}}");
    assert(vt_mcp_dispatch_message(bad_id, "session", "server", "0.1", &registry,
                                   output, sizeof(output), &length) == VT_MCP_DISPATCH_ERR_REQUEST_ID);
    cJSON_Delete(bad_id);
}

int main(void) {
    test_initialize_and_notification();
    test_list_and_call_deduplication();
    test_fail_closed_envelope_and_method();
    puts("MCP dispatch host tests passed");
    return 0;
}
