#include "veetee_display.h"

#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_lvgl_port.h"
#include "veetee_pairing.h"

LV_FONT_DECLARE(veetee_font_vietnamese_16);
LV_FONT_DECLARE(veetee_font_vietnamese_26);

#define TAG "veetee-display"

#define VT_COLOR_BACKGROUND 0x0B1220U
#define VT_COLOR_BACKGROUND_TOP 0x17233AU
#define VT_COLOR_CARD 0x17233AU
#define VT_COLOR_CARD_EDGE 0x2A3B59U
#define VT_COLOR_TEXT 0xF4F8FFU
#define VT_COLOR_MUTED 0x9EABC0U
#define VT_COLOR_GREEN 0x35D39BU
#define VT_COLOR_AMBER 0xF4B95FU
#define VT_COLOR_ORANGE 0xFF8958U
#define VT_COLOR_PURPLE 0xB779FFU
#define VT_COLOR_BLUE 0x6EA8FEU

static const vt_display_texts_t fallback_texts = {
    .brand = "VEETEE",
    .pairing_title = "Kết nối thiết bị",
    .pairing_subtitle = "Mở dashboard để thêm robot vào không gian của bạn.",
    .pairing_hint = "Nhập mã 6 số để tiếp tục",
    .connection_label = "Đang kết nối",
    .idle_title = "Sẵn sàng",
    .idle_hint = "Nhấn nút hoặc gọi từ khóa để nói",
    .connecting_title = "Đang kết nối",
    .connecting_hint = "Đang thiết lập đường truyền an toàn",
    .listening_title = "Đang nghe",
    .listening_hint = "Bạn cứ nói, tôi đang lắng nghe",
    .thinking_title = "Đang xử lý",
    .thinking_hint = "Đang hiểu và chuẩn bị câu trả lời",
    .speaking_title = "Đang nói",
    .speaking_hint = "Nhấn nút để ngắt lời",
    .online_label = "Đã kết nối",
    .interaction_hint = "PTT  •  Wake word  •  Barge-in",
    .notice_title = "Thông báo",
    .notice_hint = "Veetee sẽ tiếp tục khi sẵn sàng",
    .interrupted_title = "Đã ngắt",
    .interrupted_hint = "Đang chuẩn bị lượt nói mới",
    .error_title = "Có lỗi",
    .error_hint = "Kiểm tra kết nối rồi thử lại",
};

static lv_color_t state_color(vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return lv_color_hex(VT_COLOR_AMBER);
    case VT_DEVICE_LISTENING: return lv_color_hex(VT_COLOR_GREEN);
    case VT_DEVICE_THINKING: return lv_color_hex(VT_COLOR_ORANGE);
    case VT_DEVICE_SPEAKING: return lv_color_hex(VT_COLOR_PURPLE);
    case VT_DEVICE_IDLE:
    default: return lv_color_hex(VT_COLOR_BLUE);
    }
}

static const char *state_title(const vt_display_texts_t *texts, vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return texts->connecting_title;
    case VT_DEVICE_LISTENING: return texts->listening_title;
    case VT_DEVICE_THINKING: return texts->thinking_title;
    case VT_DEVICE_SPEAKING: return texts->speaking_title;
    case VT_DEVICE_IDLE:
    default: return texts->idle_title;
    }
}

static const char *state_hint(const vt_display_texts_t *texts, vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return texts->connecting_hint;
    case VT_DEVICE_LISTENING: return texts->listening_hint;
    case VT_DEVICE_THINKING: return texts->thinking_hint;
    case VT_DEVICE_SPEAKING: return texts->speaking_hint;
    case VT_DEVICE_IDLE:
    default: return texts->idle_hint;
    }
}

static const char *state_chip_text(vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return "CONNECTING";
    case VT_DEVICE_LISTENING: return "LISTENING";
    case VT_DEVICE_THINKING: return "THINKING";
    case VT_DEVICE_SPEAKING: return "SPEAKING";
    case VT_DEVICE_IDLE:
    default: return "HOME";
    }
}

static uint8_t state_activity(vt_device_state_t state) {
    switch (state) {
    case VT_DEVICE_CONNECTING: return 25U;
    case VT_DEVICE_LISTENING: return 72U;
    case VT_DEVICE_THINKING: return 58U;
    case VT_DEVICE_SPEAKING: return 92U;
    case VT_DEVICE_IDLE:
    default: return 8U;
    }
}

static esp_err_t configure_backlight(const vt_display_config_t *config) {
    if (config->backlight_gpio < 0) return ESP_OK;
    gpio_config_t gpio = {
        .pin_bit_mask = 1ULL << config->backlight_gpio,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    esp_err_t error = gpio_config(&gpio);
    if (error != ESP_OK) return error;
    return gpio_set_level(config->backlight_gpio, config->backlight_active_level ? 0 : 1);
}

static void release_panel(vt_display_t *display) {
    if (display->lv_display != NULL) {
        (void)lvgl_port_remove_disp(display->lv_display);
        display->lv_display = NULL;
    }
    (void)lvgl_port_deinit();
    if (display->panel != NULL) {
        (void)esp_lcd_panel_del(display->panel);
        display->panel = NULL;
    }
    if (display->panel_io != NULL) {
        (void)esp_lcd_panel_io_del(display->panel_io);
        display->panel_io = NULL;
    }
    if (display->spi_host > 0) (void)spi_bus_free((spi_host_device_t)display->spi_host);
}

static void style_screen(lv_obj_t *screen) {
    lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(screen, lv_color_hex(VT_COLOR_BACKGROUND), LV_PART_MAIN);
    lv_obj_set_style_bg_grad_color(screen, lv_color_hex(VT_COLOR_BACKGROUND_TOP), LV_PART_MAIN);
    lv_obj_set_style_bg_grad_dir(screen, LV_GRAD_DIR_VER, LV_PART_MAIN);
    lv_obj_clear_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
}

static lv_obj_t *make_panel(lv_obj_t *parent, int x, int y, int width, int height, int radius) {
    lv_obj_t *panel = lv_obj_create(parent);
    lv_obj_remove_style_all(panel);
    lv_obj_set_pos(panel, x, y);
    lv_obj_set_size(panel, width, height);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_bg_color(panel, lv_color_hex(VT_COLOR_CARD), LV_PART_MAIN);
    lv_obj_set_style_bg_grad_color(panel, lv_color_hex(VT_COLOR_BACKGROUND_TOP), LV_PART_MAIN);
    lv_obj_set_style_bg_grad_dir(panel, LV_GRAD_DIR_VER, LV_PART_MAIN);
    lv_obj_set_style_radius(panel, radius, LV_PART_MAIN);
    lv_obj_set_style_border_width(panel, 1, LV_PART_MAIN);
    lv_obj_set_style_border_color(panel, lv_color_hex(VT_COLOR_CARD_EDGE), LV_PART_MAIN);
    lv_obj_set_style_border_opa(panel, LV_OPA_70, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(panel, 18, LV_PART_MAIN);
    lv_obj_set_style_shadow_opa(panel, LV_OPA_30, LV_PART_MAIN);
    lv_obj_set_style_shadow_color(panel, lv_color_black(), LV_PART_MAIN);
    lv_obj_clear_flag(panel, LV_OBJ_FLAG_SCROLLABLE);
    return panel;
}

static lv_obj_t *make_text(lv_obj_t *parent, const char *text, const lv_font_t *font,
                           lv_color_t color, int width, int height, int x, int y,
                           lv_text_align_t align) {
    lv_obj_t *label = lv_label_create(parent);
    lv_label_set_text(label, text != NULL ? text : "");
    lv_obj_set_size(label, width, height);
    lv_obj_set_pos(label, x, y);
    lv_obj_set_style_text_font(label, font, LV_PART_MAIN);
    lv_obj_set_style_text_color(label, color, LV_PART_MAIN);
    lv_obj_set_style_text_align(label, align, LV_PART_MAIN);
    lv_obj_set_style_text_line_space(label, 2, LV_PART_MAIN);
    lv_label_set_long_mode(label, LV_LABEL_LONG_WRAP);
    return label;
}

static vt_display_view_t *view_for_state(vt_display_t *display, vt_device_state_t state) {
    if (display == NULL || state < VT_DEVICE_IDLE || state > VT_DEVICE_SPEAKING) return NULL;
    return &display->views[(size_t)state];
}

static void update_connection(vt_display_t *display, vt_display_view_t *view, vt_device_state_t state) {
    const bool connected = state != VT_DEVICE_CONNECTING;
    const lv_color_t accent = state_color(state);
    lv_obj_set_style_bg_color(view->connection_dot, accent, LV_PART_MAIN);
    lv_label_set_text(view->connection_label,
                      connected ? display->texts->online_label : display->texts->connection_label);
}

static void update_status(vt_display_t *display, vt_display_view_t *view, vt_device_state_t state) {
    const lv_color_t accent = state_color(state);
    lv_label_set_text(view->state_chip_label, state_chip_text(state));
    lv_obj_set_style_bg_color(view->state_chip, accent, LV_PART_MAIN);
    lv_obj_set_width(view->activity_fill, (int32_t)(112U * state_activity(state) / 100U));
    lv_label_set_text(view->status_title, state_title(display->texts, state));
    lv_label_set_text(view->status_hint, state_hint(display->texts, state));
    lv_obj_set_style_bg_color(view->status_orb, accent, LV_PART_MAIN);
    lv_obj_set_style_border_color(view->status_ring, accent, LV_PART_MAIN);
    lv_obj_set_style_shadow_color(view->status_orb, accent, LV_PART_MAIN);
    lv_obj_set_style_shadow_opa(view->status_orb,
                                state == VT_DEVICE_IDLE ? LV_OPA_20 : LV_OPA_60, LV_PART_MAIN);
    update_connection(display, view, state);
}

static esp_err_t create_state_view(vt_display_t *display, vt_device_state_t state) {
    vt_display_view_t *view = view_for_state(display, state);
    if (view == NULL) return ESP_ERR_INVALID_ARG;
    view->screen = lv_obj_create(NULL);
    if (view->screen == NULL) return ESP_ERR_NO_MEM;
    style_screen(view->screen);

    lv_obj_t *brand = make_text(view->screen, display->texts->brand,
                                &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_TEXT),
                                110, 24, 16, 12, LV_TEXT_ALIGN_LEFT);
    lv_obj_set_style_text_letter_space(brand, 2, LV_PART_MAIN);
    view->connection_dot = lv_obj_create(view->screen);
    lv_obj_remove_style_all(view->connection_dot);
    lv_obj_set_size(view->connection_dot, 9, 9);
    lv_obj_set_pos(view->connection_dot, 154, 20);
    lv_obj_set_style_radius(view->connection_dot, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    view->connection_label = make_text(view->screen, display->texts->connection_label,
                                       &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_MUTED),
                                       72, 24, 166, 12, LV_TEXT_ALIGN_RIGHT);

    view->state_chip = make_panel(view->screen, 14, 34, 76, 12, 6);
    lv_obj_set_style_bg_color(view->state_chip, state_color(state), LV_PART_MAIN);
    lv_obj_set_style_border_width(view->state_chip, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(view->state_chip, 0, LV_PART_MAIN);
    view->state_chip_label = make_text(view->state_chip, state_chip_text(state),
                                       &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_BACKGROUND),
                                       72, 12, 2, 0, LV_TEXT_ALIGN_CENTER);
    lv_obj_set_style_text_letter_space(view->state_chip_label, 1, LV_PART_MAIN);
    lv_obj_t *activity_track = make_panel(view->screen, 104, 36, 122, 8, 4);
    lv_obj_set_style_bg_color(activity_track, lv_color_hex(VT_COLOR_CARD_EDGE), LV_PART_MAIN);
    lv_obj_set_style_border_width(activity_track, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(activity_track, 0, LV_PART_MAIN);
    view->activity_fill = make_panel(activity_track, 0, 0, 10, 8, 4);
    lv_obj_set_style_bg_color(view->activity_fill, state_color(state), LV_PART_MAIN);
    lv_obj_set_style_border_width(view->activity_fill, 0, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(view->activity_fill, 0, LV_PART_MAIN);

    lv_obj_t *card = make_panel(view->screen, 14, 50, 212, 174, 26);
    view->status_ring = lv_obj_create(card);
    lv_obj_remove_style_all(view->status_ring);
    lv_obj_set_size(view->status_ring, 116, 116);
    lv_obj_align(view->status_ring, LV_ALIGN_TOP_MID, 0, 12);
    lv_obj_set_style_bg_opa(view->status_ring, LV_OPA_TRANSP, LV_PART_MAIN);
    lv_obj_set_style_radius(view->status_ring, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_border_width(view->status_ring, 2, LV_PART_MAIN);
    lv_obj_set_style_border_opa(view->status_ring, LV_OPA_60, LV_PART_MAIN);

    view->status_orb = lv_obj_create(card);
    lv_obj_remove_style_all(view->status_orb);
    lv_obj_set_size(view->status_orb, 88, 88);
    lv_obj_align(view->status_orb, LV_ALIGN_TOP_MID, 0, 26);
    lv_obj_set_style_radius(view->status_orb, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_bg_opa(view->status_orb, LV_OPA_90, LV_PART_MAIN);
    lv_obj_set_style_border_width(view->status_orb, 1, LV_PART_MAIN);
    lv_obj_set_style_border_color(view->status_orb, lv_color_hex(VT_COLOR_TEXT), LV_PART_MAIN);
    lv_obj_set_style_border_opa(view->status_orb, LV_OPA_30, LV_PART_MAIN);
    lv_obj_set_style_shadow_width(view->status_orb, 26, LV_PART_MAIN);
    lv_obj_set_style_shadow_spread(view->status_orb, 3, LV_PART_MAIN);

    view->status_title = make_text(card, state_title(display->texts, state),
                                   &veetee_font_vietnamese_26, lv_color_hex(VT_COLOR_TEXT),
                                   190, 34, 11, 120, LV_TEXT_ALIGN_CENTER);
    view->status_hint = make_text(card, state_hint(display->texts, state),
                                  &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_MUTED),
                                  188, 36, 12, 151, LV_TEXT_ALIGN_CENTER);

    lv_obj_t *hint_panel = make_panel(view->screen, 14, 236, 212, 30, 15);
    lv_obj_set_style_bg_color(hint_panel, lv_color_hex(VT_COLOR_BACKGROUND_TOP), LV_PART_MAIN);
    lv_obj_set_style_shadow_width(hint_panel, 0, LV_PART_MAIN);
    make_text(hint_panel, display->texts->interaction_hint, &veetee_font_vietnamese_16,
              lv_color_hex(VT_COLOR_MUTED), 200, 24, 6, 3, LV_TEXT_ALIGN_CENTER);
    update_status(display, view, state);
    return ESP_OK;
}

static esp_err_t create_notice_view(vt_display_t *display) {
    display->notice_screen = lv_obj_create(NULL);
    if (display->notice_screen == NULL) return ESP_ERR_NO_MEM;
    style_screen(display->notice_screen);
    make_text(display->notice_screen, display->texts->brand, &veetee_font_vietnamese_16,
              lv_color_hex(VT_COLOR_TEXT), 110, 24, 16, 12, LV_TEXT_ALIGN_LEFT);
    lv_obj_t *card = make_panel(display->notice_screen, 14, 50, 212, 174, 26);
    display->notice_title = make_text(card, display->texts->notice_title,
                                      &veetee_font_vietnamese_26, lv_color_hex(VT_COLOR_TEXT),
                                      190, 38, 11, 24, LV_TEXT_ALIGN_CENTER);
    display->notice_message = make_text(card, display->texts->notice_hint,
                                        &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_MUTED),
                                        184, 84, 14, 78, LV_TEXT_ALIGN_CENTER);
    lv_obj_t *hint_panel = make_panel(display->notice_screen, 14, 236, 212, 30, 15);
    lv_obj_set_style_bg_color(hint_panel, lv_color_hex(VT_COLOR_BACKGROUND_TOP), LV_PART_MAIN);
    lv_obj_set_style_shadow_width(hint_panel, 0, LV_PART_MAIN);
    make_text(hint_panel, display->texts->notice_hint, &veetee_font_vietnamese_16,
              lv_color_hex(VT_COLOR_MUTED), 200, 24, 6, 3, LV_TEXT_ALIGN_CENTER);
    return ESP_OK;
}

static esp_err_t create_ui(vt_display_t *display) {
    display->pairing_screen = lv_obj_create(NULL);
    if (display->pairing_screen == NULL) return ESP_ERR_NO_MEM;
    style_screen(display->pairing_screen);

    for (vt_device_state_t state = VT_DEVICE_IDLE; state <= VT_DEVICE_SPEAKING; state++) {
        esp_err_t error = create_state_view(display, state);
        if (error != ESP_OK) return error;
    }
    display->status_screen = display->views[VT_DEVICE_IDLE].screen;
    if (create_notice_view(display) != ESP_OK) return ESP_ERR_NO_MEM;

    /* Pairing screen: the code is presented as a readable typographic block,
       not hand-drawn seven-segment pixels, and remains clear at a glance. */
    make_text(display->pairing_screen, display->texts->brand, &veetee_font_vietnamese_16,
              lv_color_hex(VT_COLOR_TEXT), 110, 24, 16, 12, LV_TEXT_ALIGN_LEFT);
    lv_obj_t *pair_card = make_panel(display->pairing_screen, 14, 50, 212, 202, 26);
    display->pairing_title = make_text(pair_card, display->texts->pairing_title,
                                       &veetee_font_vietnamese_26, lv_color_hex(VT_COLOR_TEXT),
                                       190, 36, 11, 18, LV_TEXT_ALIGN_CENTER);
    display->pairing_subtitle = make_text(pair_card, display->texts->pairing_subtitle,
                                          &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_MUTED),
                                          184, 42, 14, 61, LV_TEXT_ALIGN_CENTER);
    display->pairing_code = make_text(pair_card, "------", &veetee_font_vietnamese_26,
                                      lv_color_hex(VT_COLOR_GREEN), 190, 42, 11, 112,
                                      LV_TEXT_ALIGN_CENTER);
    lv_obj_set_style_text_letter_space(display->pairing_code, 5, LV_PART_MAIN);
    display->pairing_hint = make_text(pair_card, display->texts->pairing_hint,
                                      &veetee_font_vietnamese_16, lv_color_hex(VT_COLOR_MUTED),
                                      184, 28, 14, 160, LV_TEXT_ALIGN_CENTER);

    display->last_state = VT_DEVICE_IDLE;
    display->active_screen = VT_DISPLAY_SCREEN_PAIRING;
    display->notice_active = false;
    display->showing_pairing = true;
    lv_screen_load(display->pairing_screen);
    return ESP_OK;
}

esp_err_t vt_display_init(vt_display_t *display, const vt_display_config_t *config) {
    if (display == NULL || config == NULL || config->width <= 0 || config->height <= 0 ||
        config->mosi_gpio < 0 || config->sclk_gpio < 0 || config->dc_gpio < 0 ||
        config->reset_gpio < 0 || config->cs_gpio < 0 || config->spi_mode < 0 || config->spi_mode > 3) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(display, 0, sizeof(*display));
    display->height = config->height;
    display->spi_host = config->spi_host;
    display->backlight_gpio = config->backlight_gpio;
    display->backlight_active_level = config->backlight_active_level;
    display->texts = config->texts != NULL ? config->texts : &fallback_texts;

    esp_err_t error = configure_backlight(config);
    if (error != ESP_OK) return error;
    /* A partial LVGL buffer of 40 rows is enough for smooth dirty-region
       rendering while keeping both DMA buffers in internal RAM. */
    const int transfer_rows = 40;
    spi_bus_config_t bus = {
        .mosi_io_num = config->mosi_gpio,
        .miso_io_num = GPIO_NUM_NC,
        .sclk_io_num = config->sclk_gpio,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = config->width * transfer_rows * (int)sizeof(uint16_t),
    };
    error = spi_bus_initialize((spi_host_device_t)config->spi_host, &bus, SPI_DMA_CH_AUTO);
    if (error != ESP_OK) return error;

    esp_lcd_panel_io_spi_config_t io = {
        .cs_gpio_num = config->cs_gpio,
        .dc_gpio_num = config->dc_gpio,
        .spi_mode = config->spi_mode,
        .pclk_hz = 40 * 1000 * 1000,
        .trans_queue_depth = 4,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    error = esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)config->spi_host, &io, &display->panel_io);
    if (error != ESP_OK) {
        release_panel(display);
        return error;
    }

    esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = config->reset_gpio,
        .rgb_ele_order = config->rgb_order_bgr ? LCD_RGB_ELEMENT_ORDER_BGR : LCD_RGB_ELEMENT_ORDER_RGB,
        .bits_per_pixel = 16,
    };
    error = esp_lcd_new_panel_st7789(display->panel_io, &panel_config, &display->panel);
    if (error == ESP_OK) error = esp_lcd_panel_reset(display->panel);
    if (error == ESP_OK) error = esp_lcd_panel_init(display->panel);
    if (error == ESP_OK) error = esp_lcd_panel_invert_color(display->panel, config->invert_color);
    if (error == ESP_OK) error = esp_lcd_panel_set_gap(display->panel, config->offset_x, config->offset_y);
    if (error == ESP_OK) error = esp_lcd_panel_swap_xy(display->panel, config->swap_xy);
    if (error == ESP_OK) error = esp_lcd_panel_mirror(display->panel, config->mirror_x, config->mirror_y);
    if (error == ESP_OK) error = esp_lcd_panel_disp_on_off(display->panel, true);
    if (error != ESP_OK) {
        release_panel(display);
        return error;
    }

    const lvgl_port_cfg_t lvgl_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    error = lvgl_port_init(&lvgl_cfg);
    if (error != ESP_OK) {
        release_panel(display);
        return error;
    }
    const lvgl_port_display_cfg_t display_cfg = {
        .io_handle = display->panel_io,
        .panel_handle = display->panel,
        .buffer_size = (uint32_t)config->width * transfer_rows,
        .double_buffer = true,
        .hres = (uint32_t)config->width,
        .vres = (uint32_t)config->height,
        .monochrome = false,
        .rotation = {
            .swap_xy = config->swap_xy,
            .mirror_x = config->mirror_x,
            .mirror_y = config->mirror_y,
        },
        .color_format = LV_COLOR_FORMAT_RGB565,
        .flags = {
            .buff_dma = 1,
            .buff_spiram = 0,
            .sw_rotate = 0,
            .swap_bytes = 1,
            .full_refresh = 0,
            .direct_mode = 0,
        },
    };
    display->lv_display = lvgl_port_add_disp(&display_cfg);
    if (display->lv_display == NULL) {
        release_panel(display);
        return ESP_ERR_NO_MEM;
    }
    if (!lvgl_port_lock(1000)) {
        release_panel(display);
        return ESP_ERR_TIMEOUT;
    }
    error = create_ui(display);
    lvgl_port_unlock();
    if (error != ESP_OK) {
        release_panel(display);
        return error;
    }
    display->ready = true;
    if (config->backlight_gpio >= 0) {
        (void)gpio_set_level(config->backlight_gpio, config->backlight_active_level ? 1 : 0);
    }
    ESP_LOGI(TAG, "ST7789 LVGL ready %dx%d offset=%d,%d spi=%d buffer=%d rows",
             config->width, config->height, config->offset_x, config->offset_y,
             config->spi_host, config->width * transfer_rows, transfer_rows);
    return ESP_OK;
}

esp_err_t vt_display_show_state(vt_display_t *display, vt_device_state_t state) {
    if (display == NULL || !display->ready || display->lv_display == NULL) return ESP_ERR_INVALID_STATE;
    vt_display_view_t *view = view_for_state(display, state);
    if (view == NULL || view->screen == NULL) return ESP_ERR_INVALID_ARG;
    if (!lvgl_port_lock(250)) return ESP_ERR_TIMEOUT;
    update_status(display, view, state);
    display->notice_active = false;
    lv_screen_load(view->screen);
    display->active_screen = vt_screen_for_state(state);
    display->showing_pairing = false;
    display->last_state = state;
    lvgl_port_unlock();
    return ESP_OK;
}

esp_err_t vt_display_show_pairing_code(vt_display_t *display, const char *code) {
    if (display == NULL || !display->ready || display->lv_display == NULL ||
        !vt_pairing_code_is_valid(code)) return ESP_ERR_INVALID_ARG;
    if (!lvgl_port_lock(250)) return ESP_ERR_TIMEOUT;
    char formatted[VT_PAIRING_CODE_LENGTH + 2U] = {0};
    memcpy(formatted, code, 3U);
    formatted[3] = ' ';
    memcpy(formatted + 4, code + 3, VT_PAIRING_CODE_LENGTH - 3U);
    lv_label_set_text(display->pairing_code, formatted);
    if (!display->showing_pairing) {
        lv_screen_load(display->pairing_screen);
        display->showing_pairing = true;
        display->active_screen = VT_DISPLAY_SCREEN_PAIRING;
    }
    lvgl_port_unlock();
    return ESP_OK;
}

static esp_err_t show_notice_kind(vt_display_t *display, vt_display_screen_t kind,
                                  const char *title, const char *message, uint32_t duration_ms) {
    if (display == NULL || !display->ready || display->lv_display == NULL || display->notice_screen == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    if (!lvgl_port_lock(250)) return ESP_ERR_TIMEOUT;
    lv_label_set_text(display->notice_title, title != NULL && title[0] != '\0' ? title : display->texts->notice_title);
    lv_label_set_text(display->notice_message, message != NULL && message[0] != '\0' ? message : display->texts->notice_hint);
    display->notice_restore_state = display->last_state;
    display->notice_deadline_ms = duration_ms == 0U ? 0U : esp_log_timestamp() + duration_ms;
    display->notice_active = duration_ms != 0U;
    lv_screen_load(display->notice_screen);
    display->active_screen = kind;
    lvgl_port_unlock();
    return ESP_OK;
}

esp_err_t vt_display_show_notice(vt_display_t *display, const char *title, const char *message,
                                 uint32_t duration_ms) {
    return show_notice_kind(display, VT_DISPLAY_SCREEN_NOTICE, title, message, duration_ms);
}

esp_err_t vt_display_show_interrupted(vt_display_t *display, uint32_t duration_ms) {
    if (display == NULL) return ESP_ERR_INVALID_ARG;
    return show_notice_kind(display, VT_DISPLAY_SCREEN_INTERRUPTED,
                            display->texts != NULL ? display->texts->interrupted_title : NULL,
                            display->texts != NULL ? display->texts->interrupted_hint : NULL,
                            duration_ms);
}

esp_err_t vt_display_show_error(vt_display_t *display, const char *title, const char *message,
                                uint32_t duration_ms) {
    if (display == NULL) return ESP_ERR_INVALID_ARG;
    return show_notice_kind(display, VT_DISPLAY_SCREEN_ERROR,
                            title != NULL ? title : (display->texts != NULL ? display->texts->error_title : NULL),
                            message != NULL ? message : (display->texts != NULL ? display->texts->error_hint : NULL),
                            duration_ms);
}

esp_err_t vt_display_tick(vt_display_t *display, vt_device_state_t state, uint32_t now_ms) {
    if (display == NULL || !display->ready || display->lv_display == NULL) return ESP_ERR_INVALID_STATE;
    if (!display->notice_active || display->notice_deadline_ms == 0U) return ESP_OK;
    /* The display task owns the tick.  A monotonic unsigned subtraction keeps
       wrap-around safe without introducing a timer callback that can race LVGL. */
    if ((int32_t)(now_ms - display->notice_deadline_ms) >= 0) {
        display->notice_active = false;
        return vt_display_show_state(display, state);
    }
    return ESP_OK;
}

void vt_display_deinit(vt_display_t *display) {
    if (display == NULL) return;
    if (display->backlight_gpio >= 0) {
        (void)gpio_set_level(display->backlight_gpio, display->backlight_active_level ? 0 : 1);
    }
    release_panel(display);
    display->ready = false;
}
