#include "veetee_board_hal.h"

#include <assert.h>
#include <string.h>

static vt_mcp_result_t invoke_stub(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    (void)arguments_json;
    (void)context;
    const char *value = "{}";
    const size_t length = strlen(value);
    if (result_json == NULL || result_length == NULL || result_capacity <= length) {
        return VT_MCP_ERR_RESULT_TOO_LARGE;
    }
    memcpy(result_json, value, length + 1U);
    *result_length = length;
    return VT_MCP_OK;
}

static const vt_mcp_tool_t STATUS_TOOL = {
    .name = "device.status.get",
    .description = "Read device status",
    .input_schema_json = "{}",
    .invoke = invoke_stub,
    .context = NULL,
};

static const vt_mcp_tool_t LED_TOOL = {
    .name = "device.led.set",
    .description = "Set logical LED state",
    .input_schema_json = "{}",
    .invoke = invoke_stub,
    .context = NULL,
};

static void test_activation_filters_disabled_tools(void) {
    char status_id[] = "status";
    char status_owner[] = "app_main";
    char led_id[] = "led";
    char led_owner[] = "led_owner";
    vt_board_capability_descriptor_t capabilities[] = {
        {status_id, status_owner, &STATUS_TOOL, 1000U, 0U, true},
        {led_id, led_owner, &LED_TOOL, 5000U, 1U, false},
    };
    const vt_board_manifest_t manifest = {7U, capabilities, 2U};
    vt_board_hal_t hal;
    vt_board_hal_init(&hal);
    assert(vt_board_hal_activate(&hal, &manifest) == VT_BOARD_HAL_OK);
    assert(hal.capability_revision == 7U);
    assert(hal.capability_count == 2U);
    assert(vt_board_hal_tool_count(&hal) == 1U);
    assert(vt_board_hal_tool_at(&hal, 0U) == &STATUS_TOOL);
    assert(vt_board_hal_tool_at(&hal, 1U) == NULL);
    status_id[0] = 'x';
    status_owner[0] = 'x';
    assert(strcmp(vt_board_hal_capability_at(&hal, 0U)->capability_id, "status") == 0);
    assert(strcmp(vt_board_hal_capability_at(&hal, 0U)->owner_id, "app_main") == 0);
    assert(vt_board_hal_find_capability(&hal, "led") != NULL);
    assert(!vt_board_hal_find_capability(&hal, "led")->enabled);
}

static void test_invalid_manifest_does_not_replace_active_snapshot(void) {
    const vt_board_capability_descriptor_t valid_capability = {"status", "app_main", &STATUS_TOOL, 1000U, 0U, true};
    const vt_board_manifest_t valid = {3U, &valid_capability, 1U};
    const vt_board_capability_descriptor_t invalid_capabilities[] = {
        {"status", "app_main", &STATUS_TOOL, 1000U, 0U, true},
        {"status", "display", &LED_TOOL, 1000U, 0U, true},
    };
    const vt_board_manifest_t invalid = {4U, invalid_capabilities, 2U};
    vt_board_hal_t hal;
    vt_board_hal_init(&hal);
    assert(vt_board_hal_activate(&hal, &valid) == VT_BOARD_HAL_OK);
    assert(vt_board_hal_activate(&hal, &invalid) == VT_BOARD_HAL_ERR_DUPLICATE);
    assert(hal.capability_revision == 3U);
    assert(vt_board_hal_tool_count(&hal) == 1U);
    assert(vt_board_hal_tool_at(&hal, 0U) == &STATUS_TOOL);
}

static void test_rejects_stale_and_malformed_descriptors(void) {
    const vt_board_capability_descriptor_t valid_capability = {"status", "app_main", &STATUS_TOOL, 1000U, 0U, true};
    const vt_board_manifest_t valid = {5U, &valid_capability, 1U};
    const vt_board_manifest_t stale = {5U, &valid_capability, 1U};
    const vt_board_capability_descriptor_t bad_capability = {"status", "", &STATUS_TOOL, 1000U, 0U, true};
    const vt_board_manifest_t bad = {6U, &bad_capability, 1U};
    vt_board_hal_t hal;
    vt_board_hal_init(&hal);
    assert(vt_board_hal_validate(NULL) == VT_BOARD_HAL_ERR_REVISION);
    assert(vt_board_hal_activate(&hal, &valid) == VT_BOARD_HAL_OK);
    assert(vt_board_hal_activate(&hal, &stale) == VT_BOARD_HAL_ERR_STALE_REVISION);
    assert(vt_board_hal_validate(&bad) == VT_BOARD_HAL_ERR_DESCRIPTOR);
}

static void test_rejects_duplicate_tool_names_even_when_one_is_disabled(void) {
    const vt_mcp_tool_t duplicate_tool = {
        .name = "device.status.get",
        .description = "Duplicate logical tool",
        .input_schema_json = "{}",
        .invoke = invoke_stub,
        .context = NULL,
    };
    const vt_board_capability_descriptor_t capabilities[] = {
        {"status", "app_main", &STATUS_TOOL, 1000U, 0U, true},
        {"status_backup", "display", &duplicate_tool, 1000U, 0U, false},
    };
    const vt_board_manifest_t manifest = {8U, capabilities, 2U};
    assert(vt_board_hal_validate(&manifest) == VT_BOARD_HAL_ERR_DUPLICATE);
}

int main(void) {
    test_activation_filters_disabled_tools();
    test_invalid_manifest_does_not_replace_active_snapshot();
    test_rejects_stale_and_malformed_descriptors();
    test_rejects_duplicate_tool_names_even_when_one_is_disabled();
    return 0;
}
