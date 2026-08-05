#include "veetee_board_tools.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "driver/gpio.h"

#define VT_BOARD_TOOL_STATUS_SCHEMA "{\"type\":\"object\",\"additionalProperties\":false}"
#define VT_BOARD_TOOL_OUTPUT_SCHEMA \
    "{\"type\":\"object\",\"additionalProperties\":false,\"properties\":{" \
    "\"enabled\":{\"type\":\"boolean\"}," \
    "\"brightness\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":100}," \
    "\"red\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":255}," \
    "\"green\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":255}," \
    "\"blue\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":255}," \
    "\"transition_ms\":{\"type\":\"integer\",\"minimum\":0,\"maximum\":5000}}}"

typedef struct {
    const char *capability_id;
    const char *tool_name;
    const char *description;
    int gpio;
    int active_level;
    bool rgb;
} output_config_t;

static bool valid_gpio(int gpio) {
    return gpio >= 0 && gpio < GPIO_NUM_MAX;
}

static bool valid_integer(const cJSON *value, int minimum, int maximum, int *result) {
    if (result == NULL || !cJSON_IsNumber(value) || value->valuedouble != (double)value->valueint ||
        value->valueint < minimum || value->valueint > maximum) {
        return false;
    }
    *result = value->valueint;
    return true;
}

static vt_mcp_result_t write_result(
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    const char *format,
    ...) {
    if (result_json == NULL || result_length == NULL || format == NULL || result_capacity == 0U) {
        return VT_MCP_ERR_ARGUMENT;
    }
    va_list arguments;
    va_start(arguments, format);
    const int written = vsnprintf(result_json, result_capacity, format, arguments);
    va_end(arguments);
    if (written < 0 || (size_t)written >= result_capacity) return VT_MCP_ERR_RESULT_TOO_LARGE;
    *result_length = (size_t)written;
    return VT_MCP_OK;
}

static vt_mcp_result_t invoke_output(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    if (arguments_json == NULL || context == NULL) return VT_MCP_ERR_ARGUMENT;
    vt_board_output_t *output = context;
    cJSON *arguments = cJSON_Parse(arguments_json);
    if (arguments == NULL || !cJSON_IsObject(arguments)) {
        cJSON_Delete(arguments);
        return VT_MCP_ERR_INVOKE;
    }

    bool present = false;
    bool enabled = output->enabled;
    uint8_t brightness = output->brightness;
    const cJSON *enabled_value = cJSON_GetObjectItemCaseSensitive(arguments, "enabled");
    if (enabled_value != NULL) {
        if (!cJSON_IsBool(enabled_value)) {
            cJSON_Delete(arguments);
            return VT_MCP_ERR_INVOKE;
        }
        enabled = cJSON_IsTrue(enabled_value);
        brightness = enabled ? 100U : 0U;
        present = true;
    }
    const cJSON *brightness_value = cJSON_GetObjectItemCaseSensitive(arguments, "brightness");
    if (brightness_value != NULL) {
        int value = 0;
        if (!valid_integer(brightness_value, 0, 100, &value)) {
            cJSON_Delete(arguments);
            return VT_MCP_ERR_INVOKE;
        }
        brightness = (uint8_t)value;
        enabled = value > 0;
        present = true;
    }

    int channel = 0;
    int red = output->red;
    int green = output->green;
    int blue = output->blue;
    bool channel_present = false;
    const char *channels[] = {"red", "green", "blue"};
    int *channel_values[] = {&red, &green, &blue};
    for (size_t index = 0U; index < sizeof(channels) / sizeof(channels[0]); ++index) {
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(arguments, channels[index]);
        if (value == NULL) continue;
        int channel_value = 0;
        if (!valid_integer(value, 0, 255, &channel_value)) {
            cJSON_Delete(arguments);
            return VT_MCP_ERR_INVOKE;
        }
        *channel_values[index] = channel_value;
        if (channel_value > channel) channel = channel_value;
        channel_present = true;
    }
    if (channel_present) {
        enabled = channel > 0;
        brightness = (uint8_t)((channel * 100 + 127) / 255);
        present = true;
    }
    const cJSON *transition = cJSON_GetObjectItemCaseSensitive(arguments, "transition_ms");
    if (transition != NULL) {
        int ignored = 0;
        if (!valid_integer(transition, 0, 5000, &ignored)) {
            cJSON_Delete(arguments);
            return VT_MCP_ERR_INVOKE;
        }
    }
    cJSON_Delete(arguments);
    if (!present) return VT_MCP_ERR_INVOKE;

    if (output->rgb) {
        /* RMT allocation is deliberately lazy.  The board manifest is built
           during bootstrap, while the RMT driver may enter a long critical
           section on ESP32-S3 during early app_main.  Creating it here keeps
           hardware ownership in the MCP task and leaves boot deterministic. */
        if (output->rgb_handle == NULL) {
            led_strip_config_t strip_config = {
                .strip_gpio_num = (gpio_num_t)output->gpio,
                .max_leds = 1U,
                .led_model = LED_MODEL_WS2812,
                .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
                .flags.invert_out = false,
            };
            led_strip_rmt_config_t rmt_config = {
                .resolution_hz = 10U * 1000U * 1000U,
                .flags.with_dma = false,
            };
            if (led_strip_new_rmt_device(&strip_config, &rmt_config, &output->rgb_handle) != ESP_OK) {
                output->rgb_handle = NULL;
                return VT_MCP_ERR_INVOKE;
            }
        }
        if (!enabled) {
            if (led_strip_clear(output->rgb_handle) != ESP_OK || led_strip_refresh(output->rgb_handle) != ESP_OK) {
                return VT_MCP_ERR_INVOKE;
            }
        } else {
            const unsigned int scale = brightness == 0U ? 100U : brightness;
            red = (red * (int)scale) / 100;
            green = (green * (int)scale) / 100;
            blue = (blue * (int)scale) / 100;
            if (red == 0 && green == 0 && blue == 0) red = green = blue = 255;
            if (led_strip_set_pixel(output->rgb_handle, 0, (uint32_t)red, (uint32_t)green, (uint32_t)blue) != ESP_OK ||
                led_strip_refresh(output->rgb_handle) != ESP_OK) {
                return VT_MCP_ERR_INVOKE;
            }
        }
    } else {
        const int level = enabled ? output->active_level : (output->active_level == 0 ? 1 : 0);
        if (gpio_set_level((gpio_num_t)output->gpio, level) != ESP_OK) return VT_MCP_ERR_INVOKE;
    }
    output->enabled = enabled;
    output->brightness = enabled ? (brightness == 0U ? 100U : brightness) : 0U;
    output->red = (uint8_t)red;
    output->green = (uint8_t)green;
    output->blue = (uint8_t)blue;
    return write_result(result_json, result_capacity, result_length,
                        "{\"capability\":\"%s\",\"enabled\":%s,\"brightness\":%u}",
                        output->capability_id, output->enabled ? "true" : "false", output->brightness);
}

static vt_mcp_result_t invoke_status(
    const char *arguments_json,
    char *result_json,
    size_t result_capacity,
    size_t *result_length,
    void *context) {
    if (arguments_json == NULL || context == NULL) return VT_MCP_ERR_ARGUMENT;
    cJSON *arguments = cJSON_Parse(arguments_json);
    if (arguments == NULL || !cJSON_IsObject(arguments) || cJSON_GetArraySize(arguments) != 0) {
        cJSON_Delete(arguments);
        return VT_MCP_ERR_INVOKE;
    }
    vt_board_tools_t *tools = context;
    cJSON_Delete(arguments);
    return write_result(result_json, result_capacity, result_length,
                        "{\"board\":\"%s\",\"status_led\":{\"available\":%s,\"enabled\":%s},\"lamp\":{\"available\":%s,\"enabled\":%s}}",
                        tools->board_name,
                        tools->outputs[0].configured ? "true" : "false",
                        tools->outputs[0].enabled ? "true" : "false",
                        tools->outputs[1].configured ? "true" : "false",
                        tools->outputs[1].enabled ? "true" : "false");
}

static esp_err_t configure_output(
    vt_board_output_t *output,
    const output_config_t *config) {
    output->capability_id = config->capability_id;
    output->tool_name = config->tool_name;
    output->gpio = config->gpio;
    output->active_level = config->active_level == 0 ? 0 : 1;
    output->rgb = config->rgb;
    output->configured = valid_gpio(config->gpio);
    output->enabled = false;
    output->brightness = 0U;
    output->red = 255U;
    output->green = 255U;
    output->blue = 255U;
    if (!output->configured) return ESP_OK;
    if (output->rgb) return ESP_OK;
    esp_err_t error = gpio_reset_pin((gpio_num_t)config->gpio);
    if (error != ESP_OK) return error;
    error = gpio_set_direction((gpio_num_t)config->gpio, GPIO_MODE_OUTPUT);
    if (error != ESP_OK) return error;
    return gpio_set_level((gpio_num_t)config->gpio, output->active_level == 0 ? 1 : 0);
}

esp_err_t vt_board_tools_init(
    vt_board_tools_t *tools,
    const char *board_name,
    int status_led_gpio,
    int lamp_gpio,
    int status_led_active_level,
    int lamp_active_level,
    bool status_led_rgb,
    uint32_t capability_revision) {
    if (tools == NULL || board_name == NULL || board_name[0] == '\0' ||
        strlen(board_name) >= VT_BOARD_TOOLS_MAX_BOARD_NAME_BYTES || capability_revision == 0U) {
        return ESP_ERR_INVALID_ARG;
    }
    memset(tools, 0, sizeof(*tools));
    memcpy(tools->board_name, board_name, strlen(board_name) + 1U);
    const output_config_t configs[VT_BOARD_TOOLS_MAX_OUTPUTS] = {
        {"status_led", "device.led.set", "Điều khiển đèn trạng thái của board", status_led_gpio, status_led_active_level, status_led_rgb},
        {"lamp", "device.lamp.set", "Điều khiển đèn phụ của board", lamp_gpio, lamp_active_level, false},
    };
    for (size_t index = 0U; index < VT_BOARD_TOOLS_MAX_OUTPUTS; ++index) {
        esp_err_t error = configure_output(&tools->outputs[index], &configs[index]);
        if (error != ESP_OK) return error;
    }

    tools->tool_storage[0] = (vt_mcp_tool_t){
        .name = "device.status.get",
        .description = "Đọc trạng thái capability hiện có trên board",
        .input_schema_json = VT_BOARD_TOOL_STATUS_SCHEMA,
        .invoke = invoke_status,
        .context = tools,
    };
    for (size_t index = 0U; index < VT_BOARD_TOOLS_MAX_OUTPUTS; ++index) {
        tools->tool_storage[index + 1U] = (vt_mcp_tool_t){
            .name = tools->outputs[index].tool_name,
            .description = index == 0U ? "Điều khiển đèn trạng thái của board" : "Điều khiển đèn phụ của board",
            .input_schema_json = VT_BOARD_TOOL_OUTPUT_SCHEMA,
            .invoke = invoke_output,
            .context = &tools->outputs[index],
        };
    }

    vt_board_capability_descriptor_t descriptors[VT_BOARD_TOOLS_MAX_OUTPUTS + 1U] = {
        {"status", "app_main", &tools->tool_storage[0], 1000U, 0U, true},
        {"status_led", "led_owner", &tools->tool_storage[1], 1000U, 1U, tools->outputs[0].configured},
        {"lamp", "device_io", &tools->tool_storage[2], 1000U, 1U, tools->outputs[1].configured},
    };
    const vt_board_manifest_t manifest = {
        .capability_revision = capability_revision,
        .capabilities = descriptors,
        .capability_count = VT_BOARD_TOOLS_MAX_OUTPUTS + 1U,
    };
    return vt_board_hal_activate(&tools->hal, &manifest) == VT_BOARD_HAL_OK ? ESP_OK : ESP_ERR_INVALID_STATE;
}

const vt_board_hal_t *vt_board_tools_hal(const vt_board_tools_t *tools) {
    return tools == NULL ? NULL : &tools->hal;
}
