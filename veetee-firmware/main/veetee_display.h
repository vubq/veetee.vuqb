#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "veetee_state.h"

typedef struct {
    int spi_host;
    int width;
    int height;
    int offset_x;
    int offset_y;
    int mosi_gpio;
    int sclk_gpio;
    int dc_gpio;
    int reset_gpio;
    int cs_gpio;
    int backlight_gpio;
    int backlight_active_level;
    int spi_mode;
    bool invert_color;
    bool rgb_order_bgr;
    bool mirror_x;
    bool mirror_y;
    bool swap_xy;
} vt_display_config_t;

typedef struct {
    esp_lcd_panel_io_handle_t panel_io;
    esp_lcd_panel_handle_t panel;
    uint16_t *row_buffer;
    int row_width;
    int height;
    int spi_host;
    int backlight_gpio;
    int backlight_active_level;
    bool ready;
} vt_display_t;

esp_err_t vt_display_init(vt_display_t *display, const vt_display_config_t *config);
esp_err_t vt_display_show_state(vt_display_t *display, vt_device_state_t state);
void vt_display_deinit(vt_display_t *display);
