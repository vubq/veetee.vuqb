#include "veetee_config.h"
#include "veetee_protocol.h"
#include "veetee_state.h"

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "sdkconfig.h"

#ifndef CONFIG_VEETEE_PROTOCOL_PROFILE
#define CONFIG_VEETEE_PROTOCOL_PROFILE 3
#endif

static const char *TAG = "veetee-fw";
static QueueHandle_t command_queue;

typedef enum {
    VT_COMMAND_CONNECT = 0,
    VT_COMMAND_ABORT,
} vt_command_t;

static void protocol_task(void *context) {
    (void)context;
    vt_device_state_machine_t machine = {.state = VT_DEVICE_IDLE, .generation = 0U};
    vt_command_t command;
    for (;;) {
        if (xQueueReceive(command_queue, &command, pdMS_TO_TICKS(1000)) == pdTRUE) {
            vt_device_event_t event = command == VT_COMMAND_CONNECT ? VT_EVENT_CONNECT : VT_EVENT_ABORT;
            if (!vt_state_apply(&machine, event)) {
                ESP_LOGW(TAG, "invalid state event state=%s", vt_state_name(machine.state));
            } else {
                ESP_LOGI(TAG, "state=%s generation=%lu", vt_state_name(machine.state), (unsigned long)machine.generation);
            }
        }
        configASSERT(uxTaskGetStackHighWaterMark(NULL) > 256U);
    }
}

void app_main(void) {
    command_queue = xQueueCreate(4U, sizeof(vt_command_t));
    configASSERT(command_queue != NULL);
    BaseType_t created = xTaskCreate(protocol_task, "vt_protocol", 4096U, NULL, 5U, NULL);
    configASSERT(created == pdPASS);

    ESP_LOGI(TAG, "protocol profile=%d (%s)", CONFIG_VEETEE_PROTOCOL_PROFILE,
             vt_protocol_profile_name((vt_protocol_profile_t)CONFIG_VEETEE_PROTOCOL_PROFILE));
    ESP_LOGW(TAG, "board profile is not verified; physical I/O and flash are disabled until runtime config is supplied");
}
