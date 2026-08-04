#include "veetee_display.h"

#include <string.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_lcd_panel_vendor.h"
#include "veetee_state.h"

#define TAG "veetee-display"

static uint16_t state_color(vt_device_state_t state, int row, int height) {
    const uint16_t idle = 0x18C3;
    const uint16_t connecting = 0xFD20;
    const uint16_t listening = 0x05E0;
    const uint16_t thinking = 0xFB80;
    const uint16_t speaking = 0x801F;
    uint16_t color = idle;
    switch (state) {
    case VT_DEVICE_CONNECTING: color = connecting; break;
    case VT_DEVICE_LISTENING: color = listening; break;
    case VT_DEVICE_THINKING: color = thinking; break;
    case VT_DEVICE_SPEAKING: color = speaking; break;
    default: break;
    }
    if (height > 1 && row >= height / 2) {
        uint16_t red = (uint16_t)((color >> 11) * 3U / 4U);
        uint16_t green = (uint16_t)(((color >> 5) & 0x3FU) * 3U / 4U);
        uint16_t blue = (uint16_t)((color & 0x1FU) * 3U / 4U);
        color = (uint16_t)((red << 11) | (green << 5) | blue);
    }
    return color;
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

esp_err_t vt_display_init(vt_display_t *display, const vt_display_config_t *config) {
    if (display == NULL || config == NULL || config->width <= 0 || config->height <= 0 ||
        config->mosi_gpio < 0 || config->sclk_gpio < 0 || config->dc_gpio < 0 ||
        config->reset_gpio < 0 || config->cs_gpio < 0 || config->spi_mode < 0 || config->spi_mode > 3) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(display, 0, sizeof(*display));
    display->row_width = config->width;
    display->height = config->height;
    display->spi_host = config->spi_host;
    display->backlight_gpio = config->backlight_gpio;
    display->backlight_active_level = config->backlight_active_level;

    esp_err_t error = configure_backlight(config);
    if (error != ESP_OK) return error;
    spi_bus_config_t bus = {
        .mosi_io_num = config->mosi_gpio,
        .miso_io_num = GPIO_NUM_NC,
        .sclk_io_num = config->sclk_gpio,
        .quadwp_io_num = GPIO_NUM_NC,
        .quadhd_io_num = GPIO_NUM_NC,
        .max_transfer_sz = config->width * sizeof(uint16_t),
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

    display->row_buffer = heap_caps_malloc((size_t)config->width * sizeof(uint16_t),
                                           MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    if (display->row_buffer == NULL) {
        release_panel(display);
        return ESP_ERR_NO_MEM;
    }
    display->ready = true;
    if (config->backlight_gpio >= 0) {
        (void)gpio_set_level(config->backlight_gpio, config->backlight_active_level ? 1 : 0);
    }
    ESP_LOGI(TAG, "ST7789 ready %dx%d offset=%d,%d spi=%d", config->width, config->height,
             config->offset_x, config->offset_y, config->spi_host);
    return vt_display_show_state(display, 0);
}

esp_err_t vt_display_show_state(vt_display_t *display, vt_device_state_t state) {
    if (display == NULL || !display->ready || display->panel == NULL || display->row_buffer == NULL) {
        return ESP_ERR_INVALID_STATE;
    }
    for (int row = 0; row < display->height; ++row) {
        uint16_t color = state_color(state, row, display->height);
        for (int column = 0; column < display->row_width; ++column) display->row_buffer[column] = color;
        esp_err_t error = esp_lcd_panel_draw_bitmap(display->panel, 0, row, display->row_width, row + 1,
                                                     display->row_buffer);
        if (error != ESP_OK) return error;
    }
    return ESP_OK;
}

void vt_display_deinit(vt_display_t *display) {
    if (display == NULL) return;
    if (display->backlight_gpio >= 0) (void)gpio_set_level(display->backlight_gpio, display->backlight_active_level ? 0 : 1);
    if (display->row_buffer != NULL) {
        heap_caps_free(display->row_buffer);
        display->row_buffer = NULL;
    }
    release_panel(display);
    display->ready = false;
}
