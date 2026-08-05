#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "led_strip.h"

#include "veetee_board_hal.h"

#define VT_BOARD_TOOLS_MAX_BOARD_NAME_BYTES 64U
#define VT_BOARD_TOOLS_MAX_OUTPUTS 2U

/*
 * Board capabilities are assembled once during bootstrap and then exposed to
 * the MCP owner task.  GPIO numbers enter through the board configuration
 * layer; the tool callbacks only receive a logical output context.
 */
typedef struct {
    const char *capability_id;
    const char *tool_name;
    int gpio;
    int active_level;
    bool configured;
    bool enabled;
    bool rgb;
    uint8_t brightness;
    uint8_t red;
    uint8_t green;
    uint8_t blue;
    led_strip_handle_t rgb_handle;
} vt_board_output_t;

typedef struct {
    char board_name[VT_BOARD_TOOLS_MAX_BOARD_NAME_BYTES];
    vt_board_hal_t hal;
    vt_board_output_t outputs[VT_BOARD_TOOLS_MAX_OUTPUTS];
    vt_mcp_tool_t tool_storage[VT_BOARD_TOOLS_MAX_OUTPUTS + 1U];
} vt_board_tools_t;

esp_err_t vt_board_tools_init(
    vt_board_tools_t *tools,
    const char *board_name,
    int status_led_gpio,
    int lamp_gpio,
    int status_led_active_level,
    int lamp_active_level,
    bool status_led_rgb,
    uint32_t capability_revision);

const vt_board_hal_t *vt_board_tools_hal(const vt_board_tools_t *tools);
