#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "veetee_mcp.h"

/* A manifest is copied into this fixed-size store; it never allocates heap.
 * Activation owns the two logical ID strings so a parsed source buffer may be
 * released after the snapshot swap. */
#define VT_BOARD_HAL_MAX_CAPABILITIES VT_MCP_MAX_TOOLS
#define VT_BOARD_HAL_MAX_CAPABILITY_ID_BYTES 64U
#define VT_BOARD_HAL_MAX_OWNER_ID_BYTES 32U
#define VT_BOARD_HAL_MAX_TIMEOUT_MS 60000U
#define VT_BOARD_HAL_MAX_SAFETY_CLASS 3U

typedef enum {
    VT_BOARD_HAL_OK = 0,
    VT_BOARD_HAL_ERR_ARGUMENT = -1,
    VT_BOARD_HAL_ERR_CAPACITY = -2,
    VT_BOARD_HAL_ERR_DESCRIPTOR = -3,
    VT_BOARD_HAL_ERR_DUPLICATE = -4,
    VT_BOARD_HAL_ERR_REVISION = -5,
    VT_BOARD_HAL_ERR_STALE_REVISION = -6,
} vt_board_hal_result_t;

/* Logical IDs are resolved by the board/config layer; no GPIO or broker detail
 * belongs in this descriptor. The callback remains owned by its peripheral
 * task and is not invoked by manifest validation or activation. */
typedef struct {
    const char *capability_id;
    const char *owner_id;
    const vt_mcp_tool_t *tool;
    uint16_t timeout_ms;
    uint8_t safety_class;
    bool enabled;
} vt_board_capability_descriptor_t;

typedef struct {
    uint32_t capability_revision;
    const vt_board_capability_descriptor_t *capabilities;
    size_t capability_count;
} vt_board_manifest_t;

typedef struct {
    char capability_id[VT_BOARD_HAL_MAX_CAPABILITY_ID_BYTES];
    char owner_id[VT_BOARD_HAL_MAX_OWNER_ID_BYTES];
    const vt_mcp_tool_t *tool;
    uint16_t timeout_ms;
    uint8_t safety_class;
    bool enabled;
} vt_board_capability_t;

typedef struct {
    uint32_t capability_revision;
    size_t capability_count;
    vt_board_capability_t capabilities[VT_BOARD_HAL_MAX_CAPABILITIES];
} vt_board_hal_t;

vt_board_hal_result_t vt_board_hal_validate(const vt_board_manifest_t *manifest);

void vt_board_hal_init(vt_board_hal_t *hal);

/* Validation happens in a temporary snapshot; the active manifest changes only
 * after every descriptor passes, so a bad revision cannot partially replace it. */
vt_board_hal_result_t vt_board_hal_activate(
    vt_board_hal_t *hal,
    const vt_board_manifest_t *manifest);

const vt_board_capability_t *vt_board_hal_capability_at(
    const vt_board_hal_t *hal,
    size_t index);

const vt_board_capability_t *vt_board_hal_find_capability(
    const vt_board_hal_t *hal,
    const char *capability_id);

size_t vt_board_hal_tool_count(const vt_board_hal_t *hal);

const vt_mcp_tool_t *vt_board_hal_tool_at(
    const vt_board_hal_t *hal,
    size_t index);
