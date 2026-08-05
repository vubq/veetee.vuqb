#include "veetee_board_hal.h"

#include <string.h>

static bool bounded_nonempty(const char *value, size_t capacity) {
    return value != NULL && value[0] != '\0' && strnlen(value, capacity) < capacity;
}

static bool duplicate_capability_id(
    const vt_board_capability_descriptor_t *capabilities,
    size_t end,
    const char *capability_id) {
    for (size_t index = 0U; index < end; ++index) {
        if (strcmp(capabilities[index].capability_id, capability_id) == 0) return true;
    }
    return false;
}

vt_board_hal_result_t vt_board_hal_validate(const vt_board_manifest_t *manifest) {
    if (manifest == NULL || manifest->capability_revision == 0U) {
        return VT_BOARD_HAL_ERR_REVISION;
    }
    if (manifest->capability_count > VT_BOARD_HAL_MAX_CAPABILITIES ||
        (manifest->capability_count > 0U && manifest->capabilities == NULL)) {
        return VT_BOARD_HAL_ERR_CAPACITY;
    }

    vt_mcp_tool_t all_tools[VT_BOARD_HAL_MAX_CAPABILITIES] = {0};
    size_t all_count = 0U;
    for (size_t index = 0U; index < manifest->capability_count; ++index) {
        const vt_board_capability_descriptor_t *capability = &manifest->capabilities[index];
        if (!bounded_nonempty(capability->capability_id, VT_BOARD_HAL_MAX_CAPABILITY_ID_BYTES) ||
            !bounded_nonempty(capability->owner_id, VT_BOARD_HAL_MAX_OWNER_ID_BYTES) ||
            capability->tool == NULL || capability->timeout_ms == 0U ||
            capability->timeout_ms > VT_BOARD_HAL_MAX_TIMEOUT_MS ||
            capability->safety_class > VT_BOARD_HAL_MAX_SAFETY_CLASS) {
            return VT_BOARD_HAL_ERR_DESCRIPTOR;
        }
        if (duplicate_capability_id(manifest->capabilities, index, capability->capability_id)) {
            return VT_BOARD_HAL_ERR_DUPLICATE;
        }
        all_tools[all_count++] = *capability->tool;
    }

    vt_mcp_registry_t registry = {0};
    if (vt_mcp_registry_init(&registry, all_tools, all_count) != VT_MCP_OK) {
        return VT_BOARD_HAL_ERR_DUPLICATE;
    }
    return VT_BOARD_HAL_OK;
}

void vt_board_hal_init(vt_board_hal_t *hal) {
    if (hal == NULL) return;
    memset(hal, 0, sizeof(*hal));
}

vt_board_hal_result_t vt_board_hal_activate(
    vt_board_hal_t *hal,
    const vt_board_manifest_t *manifest) {
    if (hal == NULL || manifest == NULL) return VT_BOARD_HAL_ERR_ARGUMENT;
    if (manifest->capability_revision != 0U &&
        manifest->capability_revision <= hal->capability_revision) {
        return VT_BOARD_HAL_ERR_STALE_REVISION;
    }
    vt_board_hal_result_t validation = vt_board_hal_validate(manifest);
    if (validation != VT_BOARD_HAL_OK) return validation;

    vt_board_hal_t next = {0};
    next.capability_revision = manifest->capability_revision;
    next.capability_count = manifest->capability_count;
    for (size_t index = 0U; index < manifest->capability_count; ++index) {
        const vt_board_capability_descriptor_t *source = &manifest->capabilities[index];
        vt_board_capability_t *destination = &next.capabilities[index];
        const size_t capability_id_length = strlen(source->capability_id);
        const size_t owner_id_length = strlen(source->owner_id);
        memcpy(destination->capability_id, source->capability_id, capability_id_length + 1U);
        memcpy(destination->owner_id, source->owner_id, owner_id_length + 1U);
        destination->tool = source->tool;
        destination->timeout_ms = source->timeout_ms;
        destination->safety_class = source->safety_class;
        destination->enabled = source->enabled;
    }
    *hal = next;
    return VT_BOARD_HAL_OK;
}

const vt_board_capability_t *vt_board_hal_capability_at(
    const vt_board_hal_t *hal,
    size_t index) {
    if (hal == NULL || index >= hal->capability_count) return NULL;
    return &hal->capabilities[index];
}

const vt_board_capability_t *vt_board_hal_find_capability(
    const vt_board_hal_t *hal,
    const char *capability_id) {
    if (hal == NULL || capability_id == NULL) return NULL;
    for (size_t index = 0U; index < hal->capability_count; ++index) {
        if (strcmp(hal->capabilities[index].capability_id, capability_id) == 0) {
            return &hal->capabilities[index];
        }
    }
    return NULL;
}

size_t vt_board_hal_tool_count(const vt_board_hal_t *hal) {
    if (hal == NULL) return 0U;
    size_t count = 0U;
    for (size_t index = 0U; index < hal->capability_count; ++index) {
        if (hal->capabilities[index].enabled) ++count;
    }
    return count;
}

const vt_mcp_tool_t *vt_board_hal_tool_at(
    const vt_board_hal_t *hal,
    size_t index) {
    if (hal == NULL) return NULL;
    size_t enabled_index = 0U;
    for (size_t capability_index = 0U; capability_index < hal->capability_count; ++capability_index) {
        const vt_board_capability_t *capability = &hal->capabilities[capability_index];
        if (!capability->enabled) continue;
        if (enabled_index == index) return capability->tool;
        ++enabled_index;
    }
    return NULL;
}
