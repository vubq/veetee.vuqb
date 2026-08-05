#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "lvgl.h"
#include "veetee_state.h"

/* Text is supplied as a resource bundle instead of being coupled to the
   renderer.  The fallback Vietnamese bundle is only a safe boot resource; a
   locale/config loader can provide another bundle without changing this UI. */
typedef struct {
    const char *brand;
    const char *pairing_title;
    const char *pairing_subtitle;
    const char *pairing_hint;
    const char *connection_label;
    const char *idle_title;
    const char *idle_hint;
    const char *connecting_title;
    const char *connecting_hint;
    const char *listening_title;
    const char *listening_hint;
    const char *thinking_title;
    const char *thinking_hint;
    const char *speaking_title;
    const char *speaking_hint;
    const char *online_label;
    const char *interaction_hint;
    const char *notice_title;
    const char *notice_hint;
} vt_display_texts_t;

typedef enum {
    VT_DISPLAY_SCREEN_PAIRING = 0,
    VT_DISPLAY_SCREEN_HOME,
    VT_DISPLAY_SCREEN_CONNECTING,
    VT_DISPLAY_SCREEN_LISTENING,
    VT_DISPLAY_SCREEN_THINKING,
    VT_DISPLAY_SCREEN_SPEAKING,
    VT_DISPLAY_SCREEN_NOTICE,
} vt_display_screen_t;

typedef struct {
    lv_obj_t *screen;
    lv_obj_t *status_title;
    lv_obj_t *status_hint;
    lv_obj_t *connection_label;
    lv_obj_t *connection_dot;
    lv_obj_t *status_orb;
    lv_obj_t *status_ring;
} vt_display_view_t;

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
    const vt_display_texts_t *texts;
} vt_display_config_t;

typedef struct {
    esp_lcd_panel_io_handle_t panel_io;
    esp_lcd_panel_handle_t panel;
    lv_display_t *lv_display;
    lv_obj_t *status_screen;
    lv_obj_t *pairing_screen;
    lv_obj_t *notice_screen;
    lv_obj_t *notice_title;
    lv_obj_t *notice_message;
    lv_obj_t *pairing_code;
    lv_obj_t *pairing_title;
    lv_obj_t *pairing_subtitle;
    lv_obj_t *pairing_hint;
    const vt_display_texts_t *texts;
    vt_display_view_t views[5];
    vt_device_state_t last_state;
    vt_display_screen_t active_screen;
    volatile bool notice_active;
    uint32_t notice_deadline_ms;
    vt_device_state_t notice_restore_state;
    bool showing_pairing;
    int height;
    int spi_host;
    int backlight_gpio;
    int backlight_active_level;
    bool ready;
} vt_display_t;

esp_err_t vt_display_init(vt_display_t *display, const vt_display_config_t *config);
esp_err_t vt_display_show_state(vt_display_t *display, vt_device_state_t state);
esp_err_t vt_display_show_pairing_code(vt_display_t *display, const char *code);
esp_err_t vt_display_show_notice(vt_display_t *display, const char *title, const char *message, uint32_t duration_ms);
esp_err_t vt_display_tick(vt_display_t *display, vt_device_state_t state, uint32_t now_ms);
void vt_display_deinit(vt_display_t *display);
