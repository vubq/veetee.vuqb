#include "veetee_mcp_dispatch.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef VT_MCP_CONFORMANCE_FIXTURE_PATH
#error "VT_MCP_CONFORMANCE_FIXTURE_PATH must point at the shared fixture"
#endif

static vt_mcp_result_t invoke_fixture(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    (void)arguments_json;
    (void)context;
    const char *result = "{\"content\":[{\"type\":\"text\",\"text\":\"fixture-ok\"}],\"isError\":false}";
    const size_t length = strlen(result);
    if (result_json == NULL || result_length == NULL || result_capacity <= length) return VT_MCP_ERR_INVOKE;
    memcpy(result_json, result, length + 1U);
    *result_length = length;
    return VT_MCP_OK;
}

static cJSON *read_fixture(void) {
    FILE *file = fopen(VT_MCP_CONFORMANCE_FIXTURE_PATH, "rb");
    assert(file != NULL);
    assert(fseek(file, 0, SEEK_END) == 0);
    const long size = ftell(file);
    assert(size > 0 && size <= 65536);
    assert(fseek(file, 0, SEEK_SET) == 0);
    char *bytes = calloc((size_t)size + 1U, sizeof(char));
    assert(bytes != NULL);
    assert(fread(bytes, 1U, (size_t)size, file) == (size_t)size);
    assert(fclose(file) == 0);
    cJSON *fixture = cJSON_ParseWithLength(bytes, (size_t)size);
    free(bytes);
    assert(fixture != NULL);
    return fixture;
}

static const cJSON *required_item(const cJSON *object, const char *name) {
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, name);
    assert(item != NULL);
    return item;
}

int main(void) {
    cJSON *fixture = read_fixture();
    const char *session_id = required_item(fixture, "session_id")->valuestring;
    const char *server_name = required_item(fixture, "server_name")->valuestring;
    const char *server_version = required_item(fixture, "server_version")->valuestring;
    const cJSON *tools_json = required_item(fixture, "tools");
    assert(cJSON_IsArray(tools_json));
    const int tool_count = cJSON_GetArraySize(tools_json);
    assert(tool_count >= 0 && (size_t)tool_count <= VT_MCP_MAX_TOOLS);

    vt_mcp_tool_t tools[VT_MCP_MAX_TOOLS] = {0};
    char *schemas[VT_MCP_MAX_TOOLS] = {0};
    for (int index = 0; index < tool_count; ++index) {
        const cJSON *tool = cJSON_GetArrayItem(tools_json, index);
        assert(cJSON_IsObject(tool));
        const cJSON *name = required_item(tool, "name");
        const cJSON *description = required_item(tool, "description");
        const cJSON *schema = required_item(tool, "inputSchema");
        assert(cJSON_IsString(name) && cJSON_IsString(description) && cJSON_IsObject(schema));
        schemas[index] = cJSON_PrintUnformatted(schema);
        assert(schemas[index] != NULL);
        tools[index] = (vt_mcp_tool_t){
            .name = name->valuestring,
            .description = description->valuestring,
            .input_schema_json = schemas[index],
            .invoke = invoke_fixture,
        };
    }

    vt_mcp_registry_t registry;
    assert(vt_mcp_registry_init(&registry, tools, (size_t)tool_count) == VT_MCP_OK);
    const cJSON *cases = required_item(fixture, "firmware_cases");
    assert(cJSON_IsArray(cases));
    char output[VT_MCP_WIRE_MAX_BYTES + 1U] = {0};
    for (int index = 0; index < cJSON_GetArraySize(cases); ++index) {
        const cJSON *test_case = cJSON_GetArrayItem(cases, index);
        const cJSON *request = required_item(test_case, "request");
        const cJSON *expected = required_item(test_case, "response");
        size_t output_length = 0U;
        assert(vt_mcp_dispatch_message(request, session_id, server_name, server_version,
                                       &registry, output, sizeof(output), &output_length) == VT_MCP_DISPATCH_OK);
        cJSON *actual = cJSON_ParseWithLength(output, output_length);
        assert(actual != NULL);
        assert(cJSON_Compare(actual, expected, true));
        cJSON_Delete(actual);
    }

    for (int index = 0; index < tool_count; ++index) cJSON_free(schemas[index]);
    cJSON_Delete(fixture);
    puts("MCP cross-conformance firmware cases passed");
    return 0;
}
