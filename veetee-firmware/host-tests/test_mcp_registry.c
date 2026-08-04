#include "veetee_mcp.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct {
    unsigned int calls;
} invoke_context_t;

static vt_mcp_result_t invoke_ok(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    invoke_context_t *state = (invoke_context_t *)context;
    assert(arguments_json != NULL);
    assert(result_json != NULL);
    assert(result_length != NULL);
    assert(state != NULL);
    state->calls += 1U;
    const int written = snprintf(result_json, result_capacity, "{\"ok\":true,\"args\":%s}", arguments_json);
    assert(written >= 0);
    *result_length = (size_t)written;
    return VT_MCP_OK;
}

static vt_mcp_result_t invoke_too_large(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    (void)arguments_json;
    (void)context;
    memset(result_json, 'x', result_capacity);
    *result_length = result_capacity + 1U;
    return VT_MCP_OK;
}

static void test_registry_validates_descriptor_shape(void) {
    invoke_context_t context = {0};
    const vt_mcp_tool_t tools[] = {
        {.name = "device.status.get", .description = "status", .input_schema_json = "{}", .invoke = invoke_ok, .context = &context},
        {.name = "device.display.show_text", .description = "display", .input_schema_json = "{}", .invoke = invoke_ok, .context = &context},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 2U) == VT_MCP_OK);
    assert(vt_mcp_registry_tool_at(&registry, 0U) == &tools[0]);
    assert(vt_mcp_registry_tool_at(&registry, 2U) == NULL);

    vt_mcp_tool_t duplicate[] = {
        {.name = "same", .invoke = invoke_ok},
        {.name = "same", .invoke = invoke_ok},
    };
    assert(vt_mcp_registry_init(&registry, duplicate, 2U) == VT_MCP_ERR_REGISTRY);
    assert(vt_mcp_registry_init(&registry, tools, VT_MCP_MAX_TOOLS + 1U) == VT_MCP_ERR_ARGUMENT);
}

static void test_call_idempotency_and_high_water(void) {
    invoke_context_t context = {0};
    const vt_mcp_tool_t tools[] = {
        {.name = "device.status.get", .description = "status", .input_schema_json = "{}", .invoke = invoke_ok, .context = &context},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 1U) == VT_MCP_OK);
    const uint32_t digest = vt_mcp_digest_call("tools/call", "device.status.get", "{}");
    const vt_mcp_call_t call = {.request_id = 1, .argument_digest = digest, .tool_name = "device.status.get", .arguments_json = "{}"};
    vt_mcp_call_result_t result;
    assert(vt_mcp_registry_call(&registry, &call, &result) == VT_MCP_OK);
    assert(!result.cached);
    assert(context.calls == 1U);
    assert(strcmp(result.result_json, "{\"ok\":true,\"args\":{}}") == 0);

    assert(vt_mcp_registry_call(&registry, &call, &result) == VT_MCP_OK);
    assert(result.cached);
    assert(context.calls == 1U);

    const vt_mcp_call_t conflict = {.request_id = 1, .argument_digest = digest + 1U, .tool_name = "device.status.get", .arguments_json = "{\"x\":1}"};
    assert(vt_mcp_registry_call(&registry, &conflict, &result) == VT_MCP_ERR_DUPLICATE_CONFLICT);
    assert(context.calls == 1U);

    const vt_mcp_call_t bad_id = {.request_id = 0, .argument_digest = digest, .tool_name = "device.status.get", .arguments_json = "{}"};
    assert(vt_mcp_registry_call(&registry, &bad_id, &result) == VT_MCP_ERR_REQUEST_ID);
}

static void test_cache_eviction_and_session_reset(void) {
    invoke_context_t context = {0};
    const vt_mcp_tool_t tools[] = {
        {.name = "device.status.get", .description = "status", .input_schema_json = "{}", .invoke = invoke_ok, .context = &context},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 1U) == VT_MCP_OK);
    for (int32_t request_id = 1; request_id <= (int32_t)VT_MCP_MAX_CACHE_ENTRIES + 1; ++request_id) {
        const vt_mcp_call_t call = {
            .request_id = request_id,
            .argument_digest = (uint32_t)request_id,
            .tool_name = "device.status.get",
            .arguments_json = "{}",
        };
        vt_mcp_call_result_t result;
        assert(vt_mcp_registry_call(&registry, &call, &result) == VT_MCP_OK);
    }
    const vt_mcp_call_t expired = {.request_id = 1, .argument_digest = 1U, .tool_name = "device.status.get", .arguments_json = "{}"};
    vt_mcp_call_result_t result;
    assert(vt_mcp_registry_call(&registry, &expired, &result) == VT_MCP_ERR_DUPLICATE_EXPIRED);
    vt_mcp_registry_reset_session(&registry);
    assert(vt_mcp_registry_call(&registry, &expired, &result) == VT_MCP_OK);
    assert(!result.cached);
}

static void test_tool_and_result_bounds(void) {
    invoke_context_t context = {0};
    const vt_mcp_tool_t tools[] = {
        {.name = "device.too.large", .description = "large", .input_schema_json = "{}", .invoke = invoke_too_large, .context = &context},
    };
    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, 1U) == VT_MCP_OK);
    const vt_mcp_call_t unknown = {.request_id = 1, .argument_digest = 1U, .tool_name = "unknown", .arguments_json = "{}"};
    vt_mcp_call_result_t result;
    assert(vt_mcp_registry_call(&registry, &unknown, &result) == VT_MCP_ERR_TOOL_NOT_FOUND);
    const vt_mcp_call_t large = {.request_id = 2, .argument_digest = 2U, .tool_name = "device.too.large", .arguments_json = "{}"};
    assert(vt_mcp_registry_call(&registry, &large, &result) == VT_MCP_ERR_RESULT_TOO_LARGE);

    assert(vt_mcp_registry_init(&registry, NULL, 0U) == VT_MCP_OK);
    assert(vt_mcp_registry_call(&registry, &unknown, &result) == VT_MCP_ERR_TOOL_NOT_FOUND);
}

int main(void) {
    test_registry_validates_descriptor_shape();
    test_call_idempotency_and_high_water();
    test_cache_eviction_and_session_reset();
    test_tool_and_result_bounds();
    return 0;
}
