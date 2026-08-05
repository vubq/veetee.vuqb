#include "veetee_audio.h"
#include "veetee_config.h"
#include "veetee_display.h"
#include "veetee_board_tools.h"
#include "veetee_mcp_task.h"
#include "veetee_protocol.h"
#include "veetee_state.h"
#include "veetee_transport.h"
#include "veetee_wake.h"
#include "veetee_wire_guard.h"
#include "veetee_ptt.h"
#include "veetee_pairing.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_err.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "esp_http_server.h"
#include "esp_random.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "freertos/idf_additions.h"
#include "nvs_flash.h"
#include "psa/crypto.h"
#include "lwip/inet.h"
#include "lwip/sockets.h"

/* xTaskCreate() takes stack depth in words. Project/Kconfig values are kept
   in bytes so the memory budget remains readable and consistent. */
#define VT_STACK_WORDS(bytes) \
    ((uint32_t)(((bytes) + sizeof(StackType_t) - 1U) / sizeof(StackType_t)))

#ifndef CONFIG_VEETEE_PROTOCOL_PROFILE
#define CONFIG_VEETEE_PROTOCOL_PROFILE 3
#endif
#ifndef CONFIG_VEETEE_BOARD_PROFILE
#define CONFIG_VEETEE_BOARD_PROFILE "unconfigured"
#endif
#ifndef CONFIG_VEETEE_WS_URI
#define CONFIG_VEETEE_WS_URI ""
#endif
#ifndef CONFIG_VEETEE_ENABLE_HARDWARE
#define CONFIG_VEETEE_ENABLE_HARDWARE 0
#endif
#ifndef CONFIG_VEETEE_WIFI_SSID
#define CONFIG_VEETEE_WIFI_SSID ""
#endif
#ifndef CONFIG_VEETEE_WIFI_PASSWORD
#define CONFIG_VEETEE_WIFI_PASSWORD ""
#endif
#ifndef CONFIG_VEETEE_WIFI_OVERRIDE_NVS
#define CONFIG_VEETEE_WIFI_OVERRIDE_NVS 0
#endif
#ifndef CONFIG_VEETEE_AP_SSID_PREFIX
#define CONFIG_VEETEE_AP_SSID_PREFIX "Veetee"
#endif
#ifndef CONFIG_VEETEE_AP_CHANNEL
#define CONFIG_VEETEE_AP_CHANNEL 6
#endif
#ifndef CONFIG_VEETEE_LCD_ENABLED
#define CONFIG_VEETEE_LCD_ENABLED 0
#endif
#ifndef CONFIG_VEETEE_LCD_SPI_HOST
#define CONFIG_VEETEE_LCD_SPI_HOST 2
#endif
#ifndef CONFIG_VEETEE_LCD_WIDTH
#define CONFIG_VEETEE_LCD_WIDTH 240
#endif
#ifndef CONFIG_VEETEE_LCD_HEIGHT
#define CONFIG_VEETEE_LCD_HEIGHT 280
#endif
#ifndef CONFIG_VEETEE_LCD_OFFSET_X
#define CONFIG_VEETEE_LCD_OFFSET_X 0
#endif
#ifndef CONFIG_VEETEE_LCD_OFFSET_Y
#define CONFIG_VEETEE_LCD_OFFSET_Y 20
#endif
#ifndef CONFIG_VEETEE_LCD_MOSI_GPIO
#define CONFIG_VEETEE_LCD_MOSI_GPIO 47
#endif
#ifndef CONFIG_VEETEE_LCD_SCLK_GPIO
#define CONFIG_VEETEE_LCD_SCLK_GPIO 21
#endif
#ifndef CONFIG_VEETEE_LCD_DC_GPIO
#define CONFIG_VEETEE_LCD_DC_GPIO 40
#endif
#ifndef CONFIG_VEETEE_LCD_RESET_GPIO
#define CONFIG_VEETEE_LCD_RESET_GPIO 45
#endif
#ifndef CONFIG_VEETEE_LCD_CS_GPIO
#define CONFIG_VEETEE_LCD_CS_GPIO 41
#endif
#ifndef CONFIG_VEETEE_LCD_BACKLIGHT_GPIO
#define CONFIG_VEETEE_LCD_BACKLIGHT_GPIO 42
#endif
#ifndef CONFIG_VEETEE_LCD_BACKLIGHT_ACTIVE_LEVEL
#define CONFIG_VEETEE_LCD_BACKLIGHT_ACTIVE_LEVEL 1
#endif
#ifndef CONFIG_VEETEE_LCD_SPI_MODE
#define CONFIG_VEETEE_LCD_SPI_MODE 0
#endif
#ifndef CONFIG_VEETEE_LCD_INVERT_COLOR
#define CONFIG_VEETEE_LCD_INVERT_COLOR 1
#endif
#ifndef CONFIG_VEETEE_LCD_RGB_ORDER_BGR
#define CONFIG_VEETEE_LCD_RGB_ORDER_BGR 0
#endif
#ifndef CONFIG_VEETEE_LCD_MIRROR_X
#define CONFIG_VEETEE_LCD_MIRROR_X 0
#endif
#ifndef CONFIG_VEETEE_LCD_MIRROR_Y
#define CONFIG_VEETEE_LCD_MIRROR_Y 0
#endif
#ifndef CONFIG_VEETEE_LCD_SWAP_XY
#define CONFIG_VEETEE_LCD_SWAP_XY 0
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_ENABLED
#define CONFIG_VEETEE_BOOT_CHIME_ENABLED 0
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_FIRST_HZ
#define CONFIG_VEETEE_BOOT_CHIME_FIRST_HZ 880
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_SECOND_HZ
#define CONFIG_VEETEE_BOOT_CHIME_SECOND_HZ 1175
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_TONE_MS
#define CONFIG_VEETEE_BOOT_CHIME_TONE_MS 90
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_GAP_MS
#define CONFIG_VEETEE_BOOT_CHIME_GAP_MS 35
#endif
#ifndef CONFIG_VEETEE_BOOT_CHIME_AMPLITUDE
#define CONFIG_VEETEE_BOOT_CHIME_AMPLITUDE 9000
#endif
#ifndef CONFIG_VEETEE_WAKE_ENABLED
#define CONFIG_VEETEE_WAKE_ENABLED 0
#endif
#ifndef CONFIG_VEETEE_WAKE_DURING_PLAYBACK
#define CONFIG_VEETEE_WAKE_DURING_PLAYBACK 0
#endif
#ifndef CONFIG_VEETEE_WAKE_MODEL_NAME
#define CONFIG_VEETEE_WAKE_MODEL_NAME ""
#endif
#ifndef CONFIG_VEETEE_WAKE_MODEL_PARTITION
#define CONFIG_VEETEE_WAKE_MODEL_PARTITION "model"
#endif
#ifndef CONFIG_VEETEE_WAKE_DETECTION_MODE
#define CONFIG_VEETEE_WAKE_DETECTION_MODE 90
#endif
#ifndef CONFIG_VEETEE_WAKE_THRESHOLD_PERCENT
#define CONFIG_VEETEE_WAKE_THRESHOLD_PERCENT 90
#endif
#ifndef CONFIG_VEETEE_WAKE_INPUT_BUFFER_SAMPLES
#define CONFIG_VEETEE_WAKE_INPUT_BUFFER_SAMPLES 4096
#endif
#ifndef CONFIG_VEETEE_AUDIO_DIAGNOSTICS
#define CONFIG_VEETEE_AUDIO_DIAGNOSTICS 0
#endif
#ifndef CONFIG_VEETEE_PLAYBACK_QUEUE_DEPTH
#define CONFIG_VEETEE_PLAYBACK_QUEUE_DEPTH 32
#endif
#ifndef CONFIG_VEETEE_MCP_ENABLED
#define CONFIG_VEETEE_MCP_ENABLED 0
#endif
#ifndef CONFIG_VEETEE_MCP_QUEUE_DEPTH
#define CONFIG_VEETEE_MCP_QUEUE_DEPTH 2
#endif
#ifndef CONFIG_VEETEE_MCP_TASK_STACK
#define CONFIG_VEETEE_MCP_TASK_STACK 12288
#endif
#ifndef CONFIG_VEETEE_MCP_TASK_PRIORITY
#define CONFIG_VEETEE_MCP_TASK_PRIORITY 14
#endif
#ifndef CONFIG_VEETEE_MCP_CAPABILITY_REVISION
#define CONFIG_VEETEE_MCP_CAPABILITY_REVISION 1
#endif
#ifndef CONFIG_VEETEE_BOARD_STATUS_LED_GPIO
#define CONFIG_VEETEE_BOARD_STATUS_LED_GPIO (-1)
#endif
#ifndef CONFIG_VEETEE_BOARD_LAMP_GPIO
#define CONFIG_VEETEE_BOARD_LAMP_GPIO (-1)
#endif
#ifndef CONFIG_VEETEE_BOARD_STATUS_LED_ACTIVE_LEVEL
#define CONFIG_VEETEE_BOARD_STATUS_LED_ACTIVE_LEVEL 1
#endif
#ifndef CONFIG_VEETEE_BOARD_LAMP_ACTIVE_LEVEL
#define CONFIG_VEETEE_BOARD_LAMP_ACTIVE_LEVEL 1
#endif
#ifndef CONFIG_VEETEE_BOARD_STATUS_LED_RGB
#define CONFIG_VEETEE_BOARD_STATUS_LED_RGB 0
#endif

static const char *TAG = "veetee-fw";

typedef struct {
    uint16_t length;
    uint8_t bytes[VT_MAX_OPUS_PAYLOAD_BYTES];
} vt_playback_packet_t;

typedef enum {
    VT_WAKE_COMMAND_ARM = 1,
} vt_wake_command_t;

typedef enum {
    VT_INTERACTION_MANUAL = 0,
    VT_INTERACTION_AUTO,
} vt_interaction_mode_t;

typedef struct {
    vt_audio_t audio;
    vt_display_t display;
    vt_transport_t transport;
    vt_device_state_machine_t state;
    vt_wake_t wake;
    QueueHandle_t playback_queue;
    QueueHandle_t wake_event_queue;
    QueueHandle_t wake_command_queue;
#if CONFIG_VEETEE_MCP_ENABLED
    vt_mcp_task_t *mcp_task;
    vt_board_tools_t board_tools;
#endif
    SemaphoreHandle_t state_lock;
    SemaphoreHandle_t audio_encoder_lock;
    SemaphoreHandle_t audio_decoder_lock;
    EventGroupHandle_t wifi_events;
    esp_netif_t *sta_netif;
    esp_netif_t *ap_netif;
    httpd_handle_t provisioning_http;
    TaskHandle_t provisioning_dns_task;
    volatile bool capture_active;
    volatile bool duplex_capture;
    volatile bool playback_busy;
    volatile bool wake_rearm_pending;
    volatile bool continuous_capture_pending;
    volatile bool stop_requested;
    volatile bool wifi_stop_requested;
    volatile bool provisioning_active;
    volatile bool provisioning_submitted;
    char pairing_code[VT_PAIRING_CODE_LENGTH + 1U];
    char pairing_code_hash[65];
    bool tts_stop_pending;
    bool wake_auto_capture;
    volatile vt_interaction_mode_t interaction_mode;
    vt_interaction_mode_t pending_tts_stop_mode;
    char tts_turn_id[64];
    char device_id[32];
    char client_id[96];
} vt_app_t;

#define VT_WIFI_CONNECTED_BIT BIT0
#define VT_WIFI_PROVISIONED_BIT BIT1
#define VT_WS_RETRY_DELAY_MS 2000
#define VT_PTT_POLL_MS 10
#define VT_PTT_DEBOUNCE_SAMPLES 3
#define VT_PTT_RETRY_DELAY_MS 250
#define VT_TTS_TURN_ID_MAX (sizeof(((vt_app_t *)0)->tts_turn_id))

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static int wifi_start(vt_app_t *app);
static int provisioning_start(vt_app_t *app);
static void provisioning_stop(vt_app_t *app);
static int pairing_load_or_create(vt_app_t *app);
static int pairing_hash(const char *code, char output[65]);
static esp_err_t provisioning_index_handler(httpd_req_t *request);
static esp_err_t provisioning_save_handler(httpd_req_t *request);
static void provisioning_dns_task(void *context);
static void websocket_text_callback(const cJSON *message, void *context);
static void websocket_audio_callback(const uint8_t *payload, size_t payload_size, void *context);
static void network_task(void *context);
static void capture_task(void *context);
static void playback_task(void *context);
static void ptt_task(void *context);
static void display_task(void *context);
static bool state_apply(vt_app_t *app, vt_device_event_t event);
static vt_device_state_t state_read(vt_app_t *app);
static int send_control(vt_app_t *app, const char *type, const char *state, const char *reason);
static int send_listen_start(vt_app_t *app, bool auto_mode);
static int device_identity(vt_app_t *app);
static void service_playback_idle(vt_app_t *app);
#if CONFIG_VEETEE_MCP_ENABLED
static int mcp_send_text(const char *text, const char *session_id, void *context);
static const char *mcp_current_session(void *context);
static void mcp_init(vt_app_t *app);
#endif

static void request_wake_arm(vt_app_t *app) {
    if (app == NULL || app->wake_command_queue == NULL) return;
    vt_wake_command_t command = VT_WAKE_COMMAND_ARM;
    /* Re-arm is idempotent; a full queue means another arm request is already
       pending and must not block a transport callback or network task. */
    (void)xQueueSend(app->wake_command_queue, &command, 0);
}

static bool playback_is_idle(const vt_app_t *app) {
    if (app == NULL || app->playback_queue == NULL) return true;
    return !app->playback_busy && uxQueueMessagesWaiting(app->playback_queue) == 0;
}

static void request_wake_arm_when_playback_idle(vt_app_t *app) {
    if (app == NULL || app->state_lock == NULL) return;
    if (xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "wake re-arm request skipped: state lock timeout");
        return;
    }
    app->wake_rearm_pending = true;
    xSemaphoreGive(app->state_lock);
    service_playback_idle(app);
}

/* A graceful tts/stop is not an abort: the ordered packet stream may still
   contain audio already received before the stop control frame. Keep the
   target under the state lock and let the single playback owner complete it
   only after both decoder work and the bounded packet queue are idle. */
static void clear_pending_tts_stop(vt_app_t *app) {
    if (app == NULL || app->state_lock == NULL) return;
    if (xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "clearing graceful tts stop skipped: state lock timeout");
        return;
    }
    app->tts_stop_pending = false;
    app->wake_rearm_pending = false;
    app->continuous_capture_pending = false;
    app->duplex_capture = false;
    app->tts_turn_id[0] = '\0';
    xSemaphoreGive(app->state_lock);
}

static bool schedule_graceful_tts_stop(vt_app_t *app, vt_interaction_mode_t mode) {
    if (app == NULL || app->state_lock == NULL) return false;
    if (xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "graceful tts stop skipped: state lock timeout");
        return false;
    }
    const bool speaking = app->state.state == VT_DEVICE_SPEAKING;
    if (speaking) {
        app->tts_stop_pending = true;
        app->pending_tts_stop_mode = mode;
        /* Only an auto interaction needs a fresh detector after draining.
           A manual PTT turn never consumed the detector in the first place. */
        app->wake_rearm_pending = mode == VT_INTERACTION_AUTO && !app->continuous_capture_pending;
    }
    xSemaphoreGive(app->state_lock);
    if (!speaking) return false;
    service_playback_idle(app);
    return true;
}

static void service_playback_idle(vt_app_t *app) {
    if (app == NULL || app->state_lock == NULL || !playback_is_idle(app)) return;

    bool request_arm = false;
    bool start_continuous_capture = false;
    bool stop_applied = false;
    vt_device_state_t stop_state = VT_DEVICE_IDLE;
    uint32_t stop_generation = 0U;
    if (xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) != pdTRUE) return;

    if (app->tts_stop_pending) {
        const vt_interaction_mode_t mode = app->pending_tts_stop_mode;
        app->tts_stop_pending = false;
        if (app->state.state == VT_DEVICE_SPEAKING) {
            const vt_device_event_t event = mode == VT_INTERACTION_AUTO
                ? VT_EVENT_TTS_STOP_AUTO
                : VT_EVENT_TTS_STOP_MANUAL;
            stop_applied = vt_state_apply(&app->state, event);
            if (stop_applied) {
                stop_state = app->state.state;
                stop_generation = app->state.generation;
                if (app->continuous_capture_pending) {
                    app->continuous_capture_pending = false;
                    start_continuous_capture = true;
                } else {
                    request_arm = mode == VT_INTERACTION_AUTO;
                }
            }
        }
    }

    /* A provider may finish without producing a TTS stream. In that case
       there is no speaking/drain barrier, so `listen.ready` itself is the
       ordered arm point once playback is already idle. */
    if (!app->tts_stop_pending && app->continuous_capture_pending && app->state.state != VT_DEVICE_SPEAKING) {
        app->continuous_capture_pending = false;
        start_continuous_capture = true;
    }

    if (app->wake_rearm_pending) {
        app->wake_rearm_pending = false;
        request_arm = true;
    }
    xSemaphoreGive(app->state_lock);

    if (stop_applied) {
        ESP_LOGI(TAG, "graceful tts drain complete state=%s generation=%lu",
                 vt_state_name(stop_state), (unsigned long)stop_generation);
    }
    if (start_continuous_capture) {
        app->interaction_mode = VT_INTERACTION_AUTO;
        if (state_read(app) == VT_DEVICE_THINKING) (void)state_apply(app, VT_EVENT_ABORT);
        (void)state_apply(app, VT_EVENT_LISTEN_START);
        app->capture_active = true;
        app->wake_auto_capture = true;
        ESP_LOGI(TAG, "continuous conversation capture armed after playback drain");
    }
    if (request_arm) {
        request_wake_arm(app);
        ESP_LOGI(TAG, "wake detector re-arm requested after playback idle");
    }
}

static bool state_apply(vt_app_t *app, vt_device_event_t event) {
    if (app == NULL || app->state_lock == NULL) return false;
    if (xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) != pdTRUE) return false;
    bool applied = vt_state_apply(&app->state, event);
    if (applied) ESP_LOGI(TAG, "state=%s generation=%lu", vt_state_name(app->state.state), (unsigned long)app->state.generation);
    xSemaphoreGive(app->state_lock);
    return applied;
}

static vt_device_state_t state_read(vt_app_t *app) {
    vt_device_state_t state = VT_DEVICE_IDLE;
    if (app != NULL && app->state_lock != NULL && xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
        state = app->state.state;
        xSemaphoreGive(app->state_lock);
    }
    return state;
}

static bool audio_encoder_lock_take(vt_app_t *app) {
    return app != NULL && app->audio_encoder_lock != NULL &&
           xSemaphoreTake(app->audio_encoder_lock, pdMS_TO_TICKS(250)) == pdTRUE;
}

static void audio_encoder_lock_give(vt_app_t *app) {
    if (app != NULL && app->audio_encoder_lock != NULL) (void)xSemaphoreGive(app->audio_encoder_lock);
}

static bool audio_decoder_lock_take(vt_app_t *app) {
    return app != NULL && app->audio_decoder_lock != NULL &&
           xSemaphoreTake(app->audio_decoder_lock, pdMS_TO_TICKS(250)) == pdTRUE;
}

static void audio_decoder_lock_give(vt_app_t *app) {
    if (app != NULL && app->audio_decoder_lock != NULL) (void)xSemaphoreGive(app->audio_decoder_lock);
}

static bool audio_decoder_reset_locked(vt_app_t *app) {
    if (!audio_decoder_lock_take(app)) return false;
    vt_audio_reset_decoder(&app->audio);
    audio_decoder_lock_give(app);
    return true;
}

static void display_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    vt_device_state_t previous = (vt_device_state_t)-1;
    bool previous_show_pairing = false;
    while (!app->stop_requested) {
        vt_device_state_t current = state_read(app);
        (void)vt_display_tick(&app->display, current, esp_log_timestamp());
        /* The code is useful while the board is waiting to be claimed. Once
           the transport has accepted the server hello, the same LCD becomes
           the live interaction surface. Keeping this decision at the display
           owner avoids a second pairing/status state in the wire protocol. */
        const bool show_pairing = !vt_transport_is_ready(&app->transport);
        if (!app->display.notice_active && (current != previous || show_pairing != previous_show_pairing)) {
            esp_err_t render_result = show_pairing && app->pairing_code[0] != '\0'
                ? vt_display_show_pairing_code(&app->display, app->pairing_code)
                : vt_display_show_state(&app->display, current);
            if (render_result != ESP_OK && app->display.ready) {
                ESP_LOGW(TAG, "LCD state render failed state=%s", vt_state_name(current));
            }
            previous = current;
            previous_show_pairing = show_pairing;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    vTaskDelete(NULL);
}

static int send_control(vt_app_t *app, const char *type, const char *state, const char *reason) {
    if (app == NULL || type == NULL || !vt_transport_is_ready(&app->transport)) return ESP_ERR_INVALID_STATE;
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(root, "type", type);
    if (state != NULL) cJSON_AddStringToObject(root, "state", state);
    if (reason != NULL) cJSON_AddStringToObject(root, "reason", reason);
    const char *session_id = vt_transport_session_id(&app->transport);
    if (session_id != NULL && session_id[0] != '\0') cJSON_AddStringToObject(root, "session_id", session_id);
    char *serialized = cJSON_PrintUnformatted(root);
    int result = serialized == NULL ? ESP_ERR_NO_MEM : vt_transport_send_text(&app->transport, serialized);
    cJSON_free(serialized);
    cJSON_Delete(root);
    return result;
}

#if CONFIG_VEETEE_MCP_ENABLED
static const char *mcp_current_session(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    return app == NULL ? "" : vt_transport_session_id(&app->transport);
}

static int mcp_send_text(const char *text, const char *session_id, void *context) {
    vt_app_t *app = (vt_app_t *)context;
    if (app == NULL || text == NULL || !vt_transport_is_ready(&app->transport)) {
        return ESP_ERR_INVALID_STATE;
    }
    const char *current = vt_transport_session_id(&app->transport);
    if (session_id != NULL && session_id[0] != '\0' &&
        (current == NULL || strcmp(current, session_id) != 0)) {
        return ESP_ERR_INVALID_STATE;
    }
    return vt_transport_send_text(&app->transport, text);
}
#endif

static int send_listen_start(vt_app_t *app, bool auto_mode) {
    if (app == NULL || !vt_transport_is_ready(&app->transport)) return ESP_ERR_INVALID_STATE;
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return ESP_ERR_NO_MEM;
    cJSON_AddStringToObject(root, "type", "listen");
    cJSON_AddStringToObject(root, "state", "start");
    cJSON_AddStringToObject(root, "mode", auto_mode ? "auto" : "manual");
    const char *session_id = vt_transport_session_id(&app->transport);
    if (session_id != NULL && session_id[0] != '\0') cJSON_AddStringToObject(root, "session_id", session_id);
    char *serialized = cJSON_PrintUnformatted(root);
    int result = serialized == NULL ? ESP_ERR_NO_MEM : vt_transport_send_text(&app->transport, serialized);
    cJSON_free(serialized);
    cJSON_Delete(root);
    return result;
}

static void websocket_text_callback(const cJSON *message, void *context) {
    vt_app_t *app = (vt_app_t *)context;
    if (app == NULL || message == NULL) return;
    cJSON *type = cJSON_GetObjectItemCaseSensitive(message, "type");
    if (!cJSON_IsString(type) || type->valuestring == NULL) return;
    if (strcmp(type->valuestring, "hello") == 0) {
#if CONFIG_VEETEE_MCP_ENABLED
        if (app->mcp_task != NULL) vt_mcp_task_reset_session(app->mcp_task);
#endif
        (void)state_apply(app, VT_EVENT_HELLO_READY);
        ESP_LOGI(TAG, "server hello accepted; session ready");
        return;
    }
    cJSON *incoming_session = cJSON_GetObjectItemCaseSensitive(message, "session_id");
    if (incoming_session != NULL &&
        (!cJSON_IsString(incoming_session) ||
         !vt_wire_session_matches(vt_transport_session_id(&app->transport), true,
                                  incoming_session->valuestring))) {
        ESP_LOGW(TAG, "ignoring server message with mismatched session");
        return;
    }
    if (strcmp(type->valuestring, "mcp") == 0) {
#if CONFIG_VEETEE_MCP_ENABLED
        if (app->mcp_task == NULL || vt_mcp_task_enqueue(
                app->mcp_task, message, vt_transport_session_id(&app->transport)) != VT_MCP_TASK_OK) {
            ESP_LOGW(TAG, "MCP request rejected by bounded owner queue");
        }
#endif
        return;
    }
    if (strcmp(type->valuestring, "tts") == 0) {
        cJSON *tts_state = cJSON_GetObjectItemCaseSensitive(message, "state");
        if (!cJSON_IsString(tts_state) || tts_state->valuestring == NULL) return;
        if (strcmp(tts_state->valuestring, "start") == 0) {
            clear_pending_tts_stop(app);
            cJSON *barge = cJSON_GetObjectItemCaseSensitive(message, "barge_in");
            cJSON *barge_enabled = cJSON_IsObject(barge)
                ? cJSON_GetObjectItemCaseSensitive(barge, "enabled")
                : NULL;
            cJSON *barge_mode = cJSON_IsObject(barge)
                ? cJSON_GetObjectItemCaseSensitive(barge, "mode")
                : NULL;
            const bool acoustic_requested = cJSON_IsTrue(barge_enabled) && cJSON_IsString(barge_mode) &&
                                            strcmp(barge_mode->valuestring, "acoustic") == 0;
            cJSON *turn_id = cJSON_GetObjectItemCaseSensitive(message, "turn_id");
            if (cJSON_IsString(turn_id) && turn_id->valuestring != NULL &&
                turn_id->valuestring[0] != '\0' && strlen(turn_id->valuestring) < VT_TTS_TURN_ID_MAX) {
                snprintf(app->tts_turn_id, sizeof(app->tts_turn_id), "%s", turn_id->valuestring);
            }
            (void)xQueueReset(app->playback_queue);
            vt_audio_reset_acoustic_reference(&app->audio);
            /* Stop capture before resetting the decoder. The decoder mutex
               serializes a possible in-flight decode. The Opus
               encoder remains continuous across turns; its reset path is not
               used here because the vendor API may return DATA_LACK at the
               start of a new stream. */
            app->duplex_capture = acoustic_requested && app->interaction_mode == VT_INTERACTION_AUTO &&
                                  vt_audio_aec_ready(&app->audio);
            app->capture_active = app->duplex_capture;
            if (acoustic_requested && !app->duplex_capture) {
                ESP_LOGW(TAG, "acoustic duplex requested but AEC is unavailable; keep half-duplex");
            }
            if (!audio_decoder_reset_locked(app)) ESP_LOGW(TAG, "audio decoder reset skipped: lock timeout");
            if (app->wake_auto_capture && !app->duplex_capture) {
                /* Stop uplink as soon as the server starts speaking unless the
                   published snapshot explicitly enabled AEC-backed duplex. */
                ESP_LOGI(TAG, "wake capture paused while server is speaking");
            } else if (app->duplex_capture) {
                ESP_LOGI(TAG, "acoustic duplex capture enabled while server is speaking");
            }
#if CONFIG_VEETEE_WAKE_DURING_PLAYBACK
            const bool tts_started = state_apply(app, VT_EVENT_TTS_START);
            /* WakeNet disarms after detection. Re-arm it at the beginning of
               auto-mode playback so a second configured wake phrase can
               interrupt the response. Manual PTT playback remains half-duplex. */
            if (tts_started && app->interaction_mode == VT_INTERACTION_AUTO &&
                vt_audio_aec_ready(&app->audio)) {
                request_wake_arm(app);
                ESP_LOGI(TAG, "wake detector re-arm requested for auto playback");
            }
#else
            (void)state_apply(app, VT_EVENT_TTS_START);
#endif
        } else if (strcmp(tts_state->valuestring, "stop") == 0) {
            const vt_interaction_mode_t mode = app->interaction_mode;
            cJSON *continue_listening = cJSON_GetObjectItemCaseSensitive(message, "continue_listening");
            if (cJSON_IsTrue(continue_listening) && app->state_lock != NULL &&
                xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
                app->continuous_capture_pending = true;
                app->wake_rearm_pending = false;
                xSemaphoreGive(app->state_lock);
            }
            cJSON *reason = cJSON_GetObjectItemCaseSensitive(message, "reason");
            const bool acoustic_abort = cJSON_IsString(reason) && reason->valuestring != NULL &&
                                        strcmp(reason->valuestring, "barge_in") == 0 && app->duplex_capture;
            cJSON *turn_id = cJSON_GetObjectItemCaseSensitive(message, "turn_id");
            if (cJSON_IsString(turn_id) && turn_id->valuestring != NULL &&
                app->tts_turn_id[0] != '\0' && strcmp(turn_id->valuestring, app->tts_turn_id) != 0) {
                ESP_LOGW(TAG, "ignoring stale tts stop turn_id mismatch");
                return;
            }
            if (acoustic_abort) {
                clear_pending_tts_stop(app);
                app->capture_active = true;
                app->wake_auto_capture = true;
                (void)xQueueReset(app->playback_queue);
                vt_audio_reset_acoustic_reference(&app->audio);
                if (!audio_decoder_reset_locked(app)) ESP_LOGW(TAG, "acoustic barge decoder reset skipped: lock timeout");
                (void)state_apply(app, VT_EVENT_ABORT);
                ESP_LOGI(TAG, "acoustic barge-in committed; capture kept for new auto turn");
                return;
            }
            if (schedule_graceful_tts_stop(app, mode)) {
                app->capture_active = false;
                app->duplex_capture = false;
                app->wake_auto_capture = false;
                app->tts_turn_id[0] = '\0';
                ESP_LOGI(TAG, "graceful tts stop scheduled mode=%s",
                         mode == VT_INTERACTION_AUTO ? "auto" : "manual");
            } else {
                ESP_LOGW(TAG, "ignoring stale tts stop outside speaking state");
            }
        }
        return;
    }
    if (strcmp(type->valuestring, "listen") == 0) {
        cJSON *listen_state = cJSON_GetObjectItemCaseSensitive(message, "state");
        cJSON *mode = cJSON_GetObjectItemCaseSensitive(message, "mode");
        if (cJSON_IsString(listen_state) && strcmp(listen_state->valuestring, "ready") == 0 &&
            cJSON_IsString(mode) && strcmp(mode->valuestring, "auto") == 0 && app->state_lock != NULL &&
            xSemaphoreTake(app->state_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
            app->continuous_capture_pending = true;
            app->wake_rearm_pending = false;
            xSemaphoreGive(app->state_lock);
            service_playback_idle(app);
            ESP_LOGI(TAG, "server armed continuous conversation");
        }
        return;
    }
    if (strcmp(type->valuestring, "alert") == 0) {
        clear_pending_tts_stop(app);
        app->capture_active = false;
        app->duplex_capture = false;
        app->wake_auto_capture = false;
        (void)xQueueReset(app->playback_queue);
        vt_audio_reset_acoustic_reference(&app->audio);
        (void)state_apply(app, VT_EVENT_ABORT);
        request_wake_arm_when_playback_idle(app);
        cJSON *code = cJSON_GetObjectItemCaseSensitive(message, "code");
        cJSON *notice = cJSON_GetObjectItemCaseSensitive(message, "message");
        (void)vt_display_show_error(&app->display,
                                    cJSON_IsString(code) ? code->valuestring : NULL,
                                    cJSON_IsString(notice) ? notice->valuestring : NULL,
                                    2500U);
        ESP_LOGW(TAG, "server alert code=%s", cJSON_IsString(code) ? code->valuestring : "unknown");
        return;
    }
    if (strcmp(type->valuestring, "stt") == 0) {
        /* Do not log transcript content; this is only a timing/flow marker. */
        ESP_LOGI(TAG, "server accepted audio and produced transcript");
    }
}

static void websocket_audio_callback(const uint8_t *payload, size_t payload_size, void *context) {
    vt_app_t *app = (vt_app_t *)context;
    if (app == NULL || payload == NULL || payload_size == 0 || payload_size > VT_MAX_OPUS_PAYLOAD_BYTES) return;
    vt_audio_frame_t frame = {0};
    if (vt_protocol_decode_audio((vt_protocol_profile_t)CONFIG_VEETEE_PROTOCOL_PROFILE, payload, payload_size, &frame) != VT_PROTOCOL_OK) {
        ESP_LOGW(TAG, "dropping malformed server audio frame");
        return;
    }
    vt_playback_packet_t packet = { .length = frame.payload_len };
    memcpy(packet.bytes, frame.payload, frame.payload_len);
    if (xQueueSend(app->playback_queue, &packet, pdMS_TO_TICKS(100)) != pdTRUE) {
        ESP_LOGW(TAG, "playback queue backpressure; dropping frame");
    }
}

static void playback_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    /* The decoder/I2S write path is nested and can use more stack than the
       steady-state queue receive. Keep the packet in the single-owner task's
       static storage and give the task a measured headroom budget. */
    static vt_playback_packet_t packet;
    while (!app->stop_requested) {
        if (xQueueReceive(app->playback_queue, &packet, pdMS_TO_TICKS(250)) == pdTRUE) {
            app->playback_busy = true;
            if (!audio_decoder_lock_take(app)) {
                ESP_LOGW(TAG, "audio decoder lock timeout before playback");
                app->playback_busy = false;
                service_playback_idle(app);
                continue;
            }
            int result = vt_audio_decode_and_play(&app->audio, packet.bytes, packet.length);
            audio_decoder_lock_give(app);
            if (result != ESP_OK) ESP_LOGW(TAG, "Opus playback decode failed");
            app->playback_busy = false;
            service_playback_idle(app);
        }
    }
    vTaskDeleteWithCaps(NULL);
}

static void capture_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    /* One capture task owns these buffers. Keeping them out of the task stack
       avoids a wake->listen transition overflowing the stack when the Opus
       transport frame is nested below I2S/codec calls. */
    static int16_t samples[CONFIG_VEETEE_MIC_SAMPLE_RATE * CONFIG_VEETEE_AUDIO_FRAME_DURATION_MS / 1000];
    static uint8_t opus[VT_MAX_OPUS_PAYLOAD_BYTES];
#if CONFIG_VEETEE_AUDIO_DIAGNOSTICS
    TickType_t next_level_log = 0;
    TickType_t next_aec_log = 0;
    TickType_t next_read_error_log = 0;
    TickType_t next_partial_frame_log = 0;
#endif
    while (!app->stop_requested) {
        vt_wake_command_t command = 0;
        while (app->wake_command_queue != NULL && xQueueReceive(app->wake_command_queue, &command, 0) == pdTRUE) {
            if (command == VT_WAKE_COMMAND_ARM && vt_wake_is_ready(&app->wake)) {
                if (!vt_wake_is_armed(&app->wake)) {
                    int arm_result = vt_wake_arm(&app->wake);
                    if (arm_result != VT_WAKE_OK) {
                        ESP_LOGW(TAG, "wake re-arm failed result=%d", arm_result);
                    } else {
                        ESP_LOGI(TAG, "wake detector armed model=%s", vt_wake_model_name(&app->wake));
                    }
                } else {
                    /* Keep the existing marker for harnesses and operators,
                       while avoiding a destructive model recreate when a
                       pre-arm already completed before tts/start. */
                    ESP_LOGI(TAG, "wake detector armed model=%s (already ready)",
                             vt_wake_model_name(&app->wake));
                }
            }
        }
        if (!vt_wake_is_ready(&app->wake) && (!app->capture_active || !vt_transport_is_ready(&app->transport))) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        size_t sample_count = 0;
        esp_err_t read_result = vt_audio_read_pcm(&app->audio, samples, sizeof(samples) / sizeof(samples[0]), &sample_count);
        if (read_result != ESP_OK) {
#if CONFIG_VEETEE_AUDIO_DIAGNOSTICS
            TickType_t now = xTaskGetTickCount();
            if ((int32_t)(now - next_read_error_log) >= 0) {
                ESP_LOGW(TAG, "audio capture read failed result=%s", esp_err_to_name(read_result));
                next_read_error_log = now + pdMS_TO_TICKS(1000);
            }
#endif
            continue;
        }
        vt_device_state_t audio_state = state_read(app);
        bool duplex_capture = app->duplex_capture && audio_state == VT_DEVICE_SPEAKING &&
                               app->interaction_mode == VT_INTERACTION_AUTO &&
                               vt_audio_aec_ready(&app->audio);
        bool wake_allowed = !app->capture_active || duplex_capture;
#if CONFIG_VEETEE_WAKE_DURING_PLAYBACK
        wake_allowed = wake_allowed &&
                       (audio_state != VT_DEVICE_SPEAKING ||
                        (app->interaction_mode == VT_INTERACTION_AUTO &&
                         vt_audio_aec_ready(&app->audio)));
#else
        wake_allowed = wake_allowed && audio_state != VT_DEVICE_SPEAKING;
#endif
        esp_err_t process_result = (wake_allowed && audio_state == VT_DEVICE_SPEAKING)
            ? vt_audio_process_wake(&app->audio, samples, sample_count)
            : vt_audio_process_capture(&app->audio, samples, sample_count);
        if (process_result != ESP_OK) {
#if CONFIG_VEETEE_AUDIO_DIAGNOSTICS
            ESP_LOGW(TAG, "capture noise processing skipped result=%s", esp_err_to_name(process_result));
#endif
            continue;
        }
#if CONFIG_VEETEE_AUDIO_DIAGNOSTICS
        TickType_t now = xTaskGetTickCount();
        if ((int32_t)(now - next_level_log) >= 0) {
            uint32_t peak = 0;
            uint64_t absolute_sum = 0;
            for (size_t index = 0; index < sample_count; ++index) {
                int32_t magnitude = samples[index];
                if (magnitude < 0) magnitude = -magnitude;
                if ((uint32_t)magnitude > peak) peak = (uint32_t)magnitude;
                absolute_sum += (uint32_t)magnitude;
            }
            uint32_t mean_absolute = sample_count == 0 ? 0U : (uint32_t)(absolute_sum / sample_count);
            ESP_LOGI(TAG, "audio level samples=%u peak=%u mean_abs=%u wake_ready=%d capture=%d stack_free=%u",
                     (unsigned)sample_count, (unsigned)peak, (unsigned)mean_absolute,
                     vt_wake_is_ready(&app->wake) ? 1 : 0, app->capture_active ? 1 : 0,
                     (unsigned)uxTaskGetStackHighWaterMark(NULL));
            next_level_log = now + pdMS_TO_TICKS(1000);
        }
        if ((int32_t)(now - next_aec_log) >= 0 && vt_audio_aec_ready(&app->audio)) {
            vt_aec_stats_t aec_stats = {0};
            vt_audio_get_aec_stats(&app->audio, &aec_stats);
            ESP_LOGI(TAG, "aec stats delay=%u depth=%u peak=%u produced=%u consumed=%u underrun=%u overrun=%u frames=%u resets=%u",
                     (unsigned)aec_stats.delay_samples, (unsigned)aec_stats.depth_samples,
                     (unsigned)aec_stats.peak_depth_samples, (unsigned)aec_stats.producer_samples,
                     (unsigned)aec_stats.consumer_samples, (unsigned)aec_stats.underrun_count,
                     (unsigned)aec_stats.overrun_count, (unsigned)aec_stats.processed_frames,
                     (unsigned)aec_stats.reset_count);
            next_aec_log = now + pdMS_TO_TICKS(1000);
        }
#endif

        /* The detector owns idle and playback audio. During an active capture
           turn, do not let the same wake phrase interrupt its own utterance. */
        if (vt_wake_is_ready(&app->wake) && wake_allowed) {
            vt_wake_event_t wake_event = {0};
            int wake_result = vt_wake_feed(&app->wake, samples, sample_count, &wake_event);
            if (wake_result != VT_WAKE_OK) {
                ESP_LOGW(TAG, "wake feed failed result=%d", wake_result);
            } else if (wake_event.detected) {
                if (app->wake_event_queue == NULL || xQueueSend(app->wake_event_queue, &wake_event, 0) != pdTRUE) {
                    ESP_LOGW(TAG, "wake event queue full; dropping detection");
                } else {
                    ESP_LOGI(TAG, "wake detected model=%s phrase=%s index=%u",
                             vt_wake_model_name(&app->wake), wake_event.phrase, wake_event.word_index);
                }
            }
        }

        if (!app->capture_active || !vt_transport_is_ready(&app->transport)) continue;
        /* I2S may return a short frame while a remote tts/start or local
           interrupt pauses capture. Opus accepts only one complete configured
           frame; dropping the partial frame avoids a DATA_LACK warning and
           never sends malformed audio to the server. */
        if (sample_count != (size_t)app->audio.input_frame_samples) {
#if CONFIG_VEETEE_AUDIO_DIAGNOSTICS
            now = xTaskGetTickCount();
            if ((int32_t)(now - next_partial_frame_log) >= 0) {
                ESP_LOGW(TAG, "audio capture partial frame samples=%u expected=%u",
                         (unsigned)sample_count, (unsigned)app->audio.input_frame_samples);
                next_partial_frame_log = now + pdMS_TO_TICKS(1000);
            }
#endif
            continue;
        }
        size_t opus_size = 0;
        int encode_result = ESP_ERR_TIMEOUT;
        if (audio_encoder_lock_take(app)) {
            encode_result = vt_audio_encode(&app->audio, samples, sample_count, opus, sizeof(opus), &opus_size);
            audio_encoder_lock_give(app);
        }
        if (encode_result != ESP_OK) {
            ESP_LOGW(TAG, "Opus capture encode failed");
            continue;
        }
        (void)vt_transport_send_audio(&app->transport, opus, opus_size, 0);
    }
    vTaskDeleteWithCaps(NULL);
}

static void ptt_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    vt_ptt_debouncer_t debouncer;
    vt_ptt_debouncer_init(&debouncer, false, VT_PTT_DEBOUNCE_SAMPLES);
    bool pending_start = false;
    bool pending_auto = false;
    TickType_t retry_after = 0;
    ESP_LOGI(TAG, "PTT monitor gpio=%d active_level=%d initial_level=%d",
             CONFIG_VEETEE_PTT_GPIO, CONFIG_VEETEE_PTT_ACTIVE_LEVEL,
             gpio_get_level(CONFIG_VEETEE_PTT_GPIO));
    while (!app->stop_requested) {
        vt_wake_event_t wake_event = {0};
        if (app->wake_event_queue != NULL && xQueueReceive(app->wake_event_queue, &wake_event, 0) == pdTRUE) {
            pending_start = true;
            pending_auto = true;
            vt_device_state_t current = state_read(app);
            /* WakeNet disarms after a hit. Re-arm through the capture owner
               immediately, while the new utterance is being captured. The
               detector is not fed while capture_active is true, so the user's
               utterance cannot self-trigger; by tts/start the model is already
               warm for an immediate wake interrupt. An event during speaking
               is already an interrupt; its existing playback-drain path owns
               the next re-arm and avoids feeding the tail of the same phrase
               into a fresh model instance. */
            if (!vt_state_is_interruptible(current)) request_wake_arm(app);
            if (vt_state_is_interruptible(current)) {
                clear_pending_tts_stop(app);
                app->capture_active = false;
                app->wake_auto_capture = false;
                (void)send_control(app, "abort", NULL, "wake_word_detected");
                (void)xQueueReset(app->playback_queue);
                vt_audio_reset_acoustic_reference(&app->audio);
                (void)state_apply(app, VT_EVENT_ABORT);
                (void)vt_display_show_interrupted(&app->display, 900U);
                request_wake_arm_when_playback_idle(app);
                ESP_LOGI(TAG, "wake interrupt");
            }
        }
        bool active = gpio_get_level(CONFIG_VEETEE_PTT_GPIO) == CONFIG_VEETEE_PTT_ACTIVE_LEVEL;
        const vt_ptt_event_t ptt_event = vt_ptt_debouncer_update(&debouncer, active);
        if (ptt_event == VT_PTT_EVENT_PRESSED) {
            pending_start = true;
            pending_auto = false;
            vt_device_state_t current = state_read(app);
            if (vt_state_is_interruptible(current)) {
                bool was_auto_capture = app->wake_auto_capture;
                clear_pending_tts_stop(app);
                app->capture_active = false;
                app->wake_auto_capture = false;
                (void)send_control(app, "abort", NULL, "button_interrupt");
                (void)xQueueReset(app->playback_queue);
                vt_audio_reset_acoustic_reference(&app->audio);
                (void)state_apply(app, VT_EVENT_ABORT);
                (void)vt_display_show_interrupted(&app->display, 900U);
                if (was_auto_capture) request_wake_arm_when_playback_idle(app);
                ESP_LOGI(TAG, "PTT interrupt state=%s", vt_state_name(current));
            }
        } else if (ptt_event == VT_PTT_EVENT_RELEASED) {
            if (app->capture_active) {
                pending_start = false;
                pending_auto = false;
                app->capture_active = false;
                app->wake_auto_capture = false;
                int result = send_control(app, "listen", "stop", NULL);
                (void)state_apply(app, VT_EVENT_LISTEN_STOP);
                ESP_LOGI(TAG, "PTT stop result=%s", esp_err_to_name(result));
            } else {
                pending_start = false;
                pending_auto = false;
            }
        }
        vt_device_state_t current = state_read(app);
        if ((vt_ptt_debouncer_is_stable(&debouncer) || pending_auto) && pending_start && !app->capture_active &&
            (current == VT_DEVICE_LISTENING ||
             (current == VT_DEVICE_IDLE && vt_transport_is_ready(&app->transport)))) {
            TickType_t now = xTaskGetTickCount();
            if ((int32_t)(now - retry_after) >= 0) {
                int result = send_listen_start(app, pending_auto);
                if (result == ESP_OK) {
                    pending_start = false;
                    app->interaction_mode = pending_auto ? VT_INTERACTION_AUTO : VT_INTERACTION_MANUAL;
                    if (state_apply(app, VT_EVENT_LISTEN_START)) {
                        app->capture_active = true;
                        app->wake_auto_capture = pending_auto;
                        ESP_LOGI(TAG, "%s start", pending_auto ? "wake" : "PTT");
                    } else {
                        ESP_LOGW(TAG, "%s start accepted by transport but state changed before capture enable",
                                 pending_auto ? "wake" : "PTT");
                    }
                } else {
                    retry_after = now + pdMS_TO_TICKS(VT_PTT_RETRY_DELAY_MS);
                    ESP_LOGW(TAG, "PTT start send failed result=%s; retrying", esp_err_to_name(result));
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(VT_PTT_POLL_MS));
    }
    vTaskDelete(NULL);
}

static void network_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    if (CONFIG_VEETEE_WS_URI[0] == '\0') {
        ESP_LOGW(TAG, "WebSocket endpoint is empty; provision VEETEE_WS_URI through config before M0 run");
        vTaskDeleteWithCaps(NULL);
        return;
    }
    if (wifi_start(app) != ESP_OK) {
        ESP_LOGW(TAG, "WiFi station did not obtain an IP; preserve NVS and provision credentials before retry");
        vTaskDeleteWithCaps(NULL);
        return;
    }
#if CONFIG_VEETEE_MCP_ENABLED
    /* Wi-Fi allocates several large internal RX buffers. Initialize the
       optional MCP owner only after that reservation and before advertising
       capabilities in the transport hello. */
    mcp_init(app);
#endif
    while (!app->stop_requested) {
        vt_transport_config_t transport_config = {
            .uri = CONFIG_VEETEE_WS_URI,
            .device_id = app->device_id,
            .client_id = app->client_id,
            .firmware_version = esp_app_get_description()->version,
            .board_profile = CONFIG_VEETEE_BOARD_PROFILE,
            .pairing_code_hash = app->pairing_code_hash,
            .profile = (vt_protocol_profile_t)CONFIG_VEETEE_PROTOCOL_PROFILE,
            .input_sample_rate = CONFIG_VEETEE_MIC_SAMPLE_RATE,
            .output_sample_rate = CONFIG_VEETEE_SPK_SAMPLE_RATE,
            .frame_duration_ms = CONFIG_VEETEE_AUDIO_FRAME_DURATION_MS,
#if CONFIG_VEETEE_MCP_ENABLED
            .mcp_enabled = app->mcp_task != NULL,
#else
            .mcp_enabled = false,
#endif
            .on_text = websocket_text_callback,
            .on_audio = websocket_audio_callback,
            .context = app,
        };
        (void)state_apply(app, VT_EVENT_CONNECT);
        int init_result = vt_transport_init(&app->transport, &transport_config);
        int start_result = init_result == ESP_OK ? vt_transport_start(&app->transport, pdMS_TO_TICKS(20000)) : init_result;
        if (start_result == ESP_OK) {
            ESP_LOGI(TAG, "WebSocket v%d ready", CONFIG_VEETEE_PROTOCOL_PROFILE);
            while (!app->stop_requested && vt_transport_is_ready(&app->transport)) vTaskDelay(pdMS_TO_TICKS(500));
        } else {
            ESP_LOGW(TAG, "WebSocket connection did not become ready; retrying");
        }
        app->capture_active = false;
        app->wake_auto_capture = false;
        clear_pending_tts_stop(app);
        app->interaction_mode = VT_INTERACTION_MANUAL;
        request_wake_arm(app);
        (void)vt_transport_stop(&app->transport);
        (void)state_apply(app, VT_EVENT_DISCONNECT);
        if (!app->stop_requested) vTaskDelay(pdMS_TO_TICKS(VT_WS_RETRY_DELAY_MS));
    }
    vTaskDeleteWithCaps(NULL);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    vt_app_t *app = (vt_app_t *)arg;
    if (app == NULL) return;
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        if (!app->wifi_stop_requested) (void)esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(app->wifi_events, VT_WIFI_CONNECTED_BIT);
        const wifi_event_sta_disconnected_t *disconnected = (const wifi_event_sta_disconnected_t *)event_data;
        if (app->wifi_stop_requested) {
            ESP_LOGW(TAG, "WiFi disconnected reason=%u; station stopped, preserve NVS and provision credentials before retry",
                     disconnected == NULL ? 0U : (unsigned)disconnected->reason);
        } else {
            ESP_LOGW(TAG, "WiFi disconnected reason=%u; retrying", disconnected == NULL ? 0U : (unsigned)disconnected->reason);
            (void)esp_wifi_connect();
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *got_ip = (const ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "WiFi ready ip=" IPSTR, IP2STR(&got_ip->ip_info.ip));
        app->wifi_stop_requested = false;
        xEventGroupSetBits(app->wifi_events, VT_WIFI_CONNECTED_BIT);
    }
}

static int pairing_hash(const char *code, char output[65]) {
    if (output == NULL || !vt_pairing_code_is_valid(code)) return ESP_ERR_INVALID_ARG;
    unsigned char digest[32] = {0};
    size_t digest_length = 0U;
    psa_hash_operation_t operation = PSA_HASH_OPERATION_INIT;
    if (psa_crypto_init() != PSA_SUCCESS ||
        psa_hash_setup(&operation, PSA_ALG_SHA_256) != PSA_SUCCESS ||
        psa_hash_update(&operation, (const unsigned char *)code, VT_PAIRING_CODE_LENGTH) != PSA_SUCCESS ||
        psa_hash_finish(&operation, digest, sizeof(digest), &digest_length) != PSA_SUCCESS ||
        digest_length != sizeof(digest)) {
        psa_hash_abort(&operation);
        return ESP_FAIL;
    }
    for (size_t index = 0; index < sizeof(digest); ++index) {
        const int written = snprintf(output + index * 2U, 65U - index * 2U, "%02x", digest[index]);
        if (written != 2) return ESP_FAIL;
    }
    output[64] = '\0';
    return ESP_OK;
}

static int pairing_load_or_create(vt_app_t *app) {
    if (app == NULL) return ESP_ERR_INVALID_ARG;
    nvs_handle_t handle = 0;
    esp_err_t error = nvs_open("veetee", NVS_READWRITE, &handle);
    if (error != ESP_OK) return error;
    size_t required = sizeof(app->pairing_code);
    error = nvs_get_str(handle, "pair_code", app->pairing_code, &required);
    if (error == ESP_ERR_NVS_NOT_FOUND || !vt_pairing_code_is_valid(app->pairing_code)) {
        if (!vt_pairing_code_from_entropy(esp_random(), app->pairing_code)) {
            nvs_close(handle);
            return ESP_FAIL;
        }
        error = nvs_set_str(handle, "pair_code", app->pairing_code);
        if (error == ESP_OK) error = nvs_commit(handle);
    }
    nvs_close(handle);
    if (error != ESP_OK) return error;
    error = (esp_err_t)pairing_hash(app->pairing_code, app->pairing_code_hash);
    if (error == ESP_OK) ESP_LOGI(TAG, "pairing code ready digits=%u", (unsigned)VT_PAIRING_CODE_LENGTH);
    return error;
}

static bool form_decode(const char *input, size_t input_length, char *output, size_t output_capacity) {
    if (input == NULL || output == NULL || output_capacity == 0U) return false;
    size_t written = 0U;
    for (size_t index = 0U; index < input_length; ++index) {
        if (written + 1U >= output_capacity) return false;
        char value = input[index];
        if (value == '+') {
            value = ' ';
        } else if (value == '%' && index + 2U < input_length) {
            const char high = input[index + 1U];
            const char low = input[index + 2U];
            if (!isxdigit((unsigned char)high) || !isxdigit((unsigned char)low)) return false;
            const int high_value = high <= '9' ? high - '0' : (tolower((unsigned char)high) - 'a' + 10);
            const int low_value = low <= '9' ? low - '0' : (tolower((unsigned char)low) - 'a' + 10);
            value = (char)((high_value << 4) | low_value);
            index += 2U;
        } else if (value == '%') {
            return false;
        }
        output[written++] = value;
    }
    output[written] = '\0';
    return true;
}

static bool form_field(const char *body, size_t body_length, const char *name, char *output, size_t output_capacity) {
    if (body == NULL || name == NULL || output == NULL) return false;
    const size_t name_length = strlen(name);
    size_t offset = 0U;
    while (offset < body_length) {
        const bool at_field_start = offset == 0U || body[offset - 1U] == '&';
        if (at_field_start && offset + name_length + 1U <= body_length &&
            memcmp(body + offset, name, name_length) == 0 && body[offset + name_length] == '=') {
            const size_t value_start = offset + name_length + 1U;
            size_t value_end = value_start;
            while (value_end < body_length && body[value_end] != '&') ++value_end;
            return form_decode(body + value_start, value_end - value_start, output, output_capacity);
        }
        while (offset < body_length && body[offset] != '&') ++offset;
        if (offset < body_length) ++offset;
    }
    return false;
}

static esp_err_t provisioning_index_handler(httpd_req_t *request) {
    static const char page[] =
        "<!doctype html><html lang=\"vi\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Cài đặt Wi-Fi Veetee</title><style>body{font:16px system-ui;max-width:520px;margin:40px auto;padding:0 20px}"
        "label{display:block;margin:18px 0 6px}input,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #b8c5d6;border-radius:8px;font:inherit}"
        "button{margin-top:22px;background:#126b53;color:#fff;border:0;font-weight:700}</style>"
        "<h1>Kết nối Veetee</h1><p>Nhập Wi-Fi nhà bạn. Robot sẽ lưu cấu hình an toàn và tự kết nối.</p>"
        "<form method=post action=/save><label for=ssid>Tên Wi-Fi</label><input id=ssid name=ssid maxlength=31 required autocomplete=off>"
        "<label for=password>Mật khẩu</label><input id=password name=password maxlength=63 type=password autocomplete=new-password>"
        "<button type=submit>Lưu và kết nối</button></form></html>";
    httpd_resp_set_type(request, "text/html; charset=utf-8");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    return httpd_resp_send(request, page, HTTPD_RESP_USE_STRLEN);
}

/* Mobile OS connectivity checks use different well-known paths.  Returning a
 * short redirect keeps captive WebViews on the setup page while leaving
 * genuinely unknown paths as normal HTTP 404 responses from esp_http_server. */
static esp_err_t provisioning_probe_handler(httpd_req_t *request) {
    if (request == NULL) return ESP_ERR_INVALID_ARG;
    char location[96] = {0};
    const int written = snprintf(location, sizeof(location), "http://192.168.4.1/?_=%lu",
                                 (unsigned long)xTaskGetTickCount());
    if (written <= 0 || written >= (int)sizeof(location)) {
        return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Portal khong san sang");
    }
    httpd_resp_set_status(request, "302 Found");
    httpd_resp_set_hdr(request, "Location", location);
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    return httpd_resp_send(request, NULL, 0);
}

static esp_err_t provisioning_favicon_handler(httpd_req_t *request) {
    if (request == NULL) return ESP_ERR_INVALID_ARG;
    httpd_resp_set_status(request, "204 No Content");
    httpd_resp_set_hdr(request, "Cache-Control", "no-store");
    return httpd_resp_send(request, NULL, 0);
}

static esp_err_t provisioning_save_handler(httpd_req_t *request) {
    vt_app_t *app = (vt_app_t *)request->user_ctx;
    if (app == NULL || request->content_len == 0U || request->content_len > 512U) {
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "Form khong hop le");
    }
    char body[513] = {0};
    size_t received = 0U;
    while (received < request->content_len) {
        const int count = httpd_req_recv(request, body + received, request->content_len - received);
        if (count <= 0) return httpd_resp_send_err(request, HTTPD_408_REQ_TIMEOUT, "Khong doc duoc form");
        received += (size_t)count;
    }
    char ssid[33] = {0};
    char password[65] = {0};
    wifi_config_t station = {0};
    if (!form_field(body, received, "ssid", ssid, sizeof(ssid)) || ssid[0] == '\0' ||
        strlen(ssid) >= sizeof(station.sta.ssid) ||
        !form_field(body, received, "password", password, sizeof(password)) ||
        strlen(password) >= sizeof(station.sta.password)) {
        return httpd_resp_send_err(request, HTTPD_400_BAD_REQUEST, "SSID hoac mat khau khong hop le");
    }
    memcpy(station.sta.ssid, ssid, strlen(ssid));
    memcpy(station.sta.password, password, strlen(password));
    station.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
    station.sta.sort_method = WIFI_CONNECT_AP_BY_SIGNAL;
    if (esp_wifi_set_config(WIFI_IF_STA, &station) != ESP_OK) {
        return httpd_resp_send_err(request, HTTPD_500_INTERNAL_SERVER_ERROR, "Khong luu duoc Wi-Fi");
    }
    app->provisioning_submitted = true;
    app->wifi_stop_requested = false;
    xEventGroupSetBits(app->wifi_events, VT_WIFI_PROVISIONED_BIT);
    (void)esp_wifi_set_mode(WIFI_MODE_STA);
    (void)esp_wifi_connect();
    static const char accepted[] = "<p>Da luu Wi-Fi. Robot dang ket noi, ban co the dong trang nay.</p>";
    httpd_resp_set_type(request, "text/html; charset=utf-8");
    return httpd_resp_send(request, accepted, HTTPD_RESP_USE_STRLEN);
}

static void provisioning_dns_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    int socket_fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (socket_fd < 0) {
        vTaskDelete(NULL);
        return;
    }
    struct timeval timeout = {.tv_sec = 1, .tv_usec = 0};
    (void)setsockopt(socket_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons(53);
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(socket_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
        close(socket_fd);
        vTaskDelete(NULL);
        return;
    }
    uint8_t query[512];
    uint8_t response[512];
    while (app->provisioning_active) {
        struct sockaddr_in peer = {0};
        socklen_t peer_length = sizeof(peer);
        const int length = recvfrom(socket_fd, query, sizeof(query), 0, (struct sockaddr *)&peer, &peer_length);
        if (length < 12 || length > (int)(sizeof(response) - 16U)) continue;
        memcpy(response, query, (size_t)length);
        response[2] = 0x81U;
        response[3] = 0x80U;
        response[4] = 0;
        response[5] = 1;
        response[6] = 0;
        response[7] = 1;
        size_t answer_offset = (size_t)length;
        response[answer_offset++] = 0xC0U;
        response[answer_offset++] = 0x0CU;
        response[answer_offset++] = 0;
        response[answer_offset++] = 1;
        response[answer_offset++] = 0;
        response[answer_offset++] = 1;
        response[answer_offset++] = 0;
        response[answer_offset++] = 0;
        response[answer_offset++] = 0;
        response[answer_offset++] = 60;
        response[answer_offset++] = 0;
        response[answer_offset++] = 4;
        response[answer_offset++] = 192;
        response[answer_offset++] = 168;
        response[answer_offset++] = 4;
        response[answer_offset++] = 1;
        (void)sendto(socket_fd, response, answer_offset, 0, (struct sockaddr *)&peer, peer_length);
    }
    close(socket_fd);
    app->provisioning_dns_task = NULL;
    vTaskDelete(NULL);
}

static int provisioning_start(vt_app_t *app) {
    if (app == NULL || app->wifi_events == NULL) return ESP_ERR_INVALID_ARG;
    if (app->ap_netif == NULL) {
        app->ap_netif = esp_netif_create_default_wifi_ap();
        if (app->ap_netif == NULL) return ESP_ERR_NO_MEM;
    }
    wifi_config_t access_point = {0};
    uint8_t mac[6] = {0};
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) return ESP_FAIL;
    int written = snprintf((char *)access_point.ap.ssid, sizeof(access_point.ap.ssid), "%s-%02X%02X%02X",
                           CONFIG_VEETEE_AP_SSID_PREFIX, mac[3], mac[4], mac[5]);
    if (written <= 0 || written >= (int)sizeof(access_point.ap.ssid)) return ESP_ERR_INVALID_SIZE;
    access_point.ap.ssid_len = (uint8_t)written;
    access_point.ap.channel = CONFIG_VEETEE_AP_CHANNEL;
    access_point.ap.max_connection = 4;
    access_point.ap.authmode = WIFI_AUTH_OPEN;
    if (esp_wifi_set_mode(WIFI_MODE_APSTA) != ESP_OK || esp_wifi_set_config(WIFI_IF_AP, &access_point) != ESP_OK) return ESP_FAIL;
    app->provisioning_active = true;
    app->provisioning_submitted = false;
    httpd_config_t server_config = HTTPD_DEFAULT_CONFIG();
    server_config.max_uri_handlers = 12;
    server_config.stack_size = 6144;
    server_config.uri_match_fn = httpd_uri_match_wildcard;
    if (httpd_start(&app->provisioning_http, &server_config) != ESP_OK) return ESP_FAIL;
    httpd_uri_t index_uri = {.uri = "/", .method = HTTP_GET, .handler = provisioning_index_handler, .user_ctx = app};
    httpd_uri_t save_uri = {.uri = "/save", .method = HTTP_POST, .handler = provisioning_save_handler, .user_ctx = app};
    static const char *const probe_paths[] = {
        "/generate_204", "/hotspot-detect.html", "/connecttest.txt",
        "/ncsi.txt", "/success.txt", "/canonical.html",
    };
    httpd_uri_t probe_uri = {.uri = NULL, .method = HTTP_GET, .handler = provisioning_probe_handler, .user_ctx = app};
    httpd_uri_t favicon_uri = {.uri = "/favicon.ico", .method = HTTP_GET, .handler = provisioning_favicon_handler, .user_ctx = app};
    if (httpd_register_uri_handler(app->provisioning_http, &index_uri) != ESP_OK ||
        httpd_register_uri_handler(app->provisioning_http, &save_uri) != ESP_OK) {
        (void)httpd_stop(app->provisioning_http);
        app->provisioning_http = NULL;
        return ESP_FAIL;
    }
    for (size_t index = 0U; index < sizeof(probe_paths) / sizeof(probe_paths[0]); ++index) {
        probe_uri.uri = probe_paths[index];
        if (httpd_register_uri_handler(app->provisioning_http, &probe_uri) != ESP_OK) {
            (void)httpd_stop(app->provisioning_http);
            app->provisioning_http = NULL;
            return ESP_FAIL;
        }
    }
    if (httpd_register_uri_handler(app->provisioning_http, &favicon_uri) != ESP_OK) {
        (void)httpd_stop(app->provisioning_http);
        app->provisioning_http = NULL;
        return ESP_FAIL;
    }
    BaseType_t result = xTaskCreate(provisioning_dns_task, "vt_dns", VT_STACK_WORDS(4096), app, 3, &app->provisioning_dns_task);
    if (result != pdPASS) {
        (void)httpd_stop(app->provisioning_http);
        app->provisioning_http = NULL;
        app->provisioning_active = false;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGW(TAG, "WiFi provisioning AP active; connect to the Veetee setup network and open http://192.168.4.1/");
    return ESP_OK;
}

static void provisioning_stop(vt_app_t *app) {
    if (app == NULL) return;
    app->provisioning_active = false;
    if (app->provisioning_http != NULL) {
        (void)httpd_stop(app->provisioning_http);
        app->provisioning_http = NULL;
    }
    for (unsigned int attempt = 0U; attempt < 20U && app->provisioning_dns_task != NULL; ++attempt) {
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

static int wifi_wait_for_portal(vt_app_t *app) {
    if (provisioning_start(app) != ESP_OK) return ESP_FAIL;
    while (!app->stop_requested) {
        EventBits_t bits = xEventGroupWaitBits(app->wifi_events, VT_WIFI_CONNECTED_BIT | VT_WIFI_PROVISIONED_BIT,
                                               pdFALSE, pdFALSE, pdMS_TO_TICKS(1000));
        if ((bits & VT_WIFI_CONNECTED_BIT) != 0) {
            provisioning_stop(app);
            return ESP_OK;
        }
        if ((bits & VT_WIFI_PROVISIONED_BIT) != 0) {
            xEventGroupClearBits(app->wifi_events, VT_WIFI_PROVISIONED_BIT);
            app->provisioning_submitted = false;
            EventBits_t connected = xEventGroupWaitBits(app->wifi_events, VT_WIFI_CONNECTED_BIT,
                                                        pdFALSE, pdFALSE, pdMS_TO_TICKS(30000));
            if ((connected & VT_WIFI_CONNECTED_BIT) != 0) {
                provisioning_stop(app);
                return ESP_OK;
            }
            ESP_LOGW(TAG, "WiFi credentials did not obtain an IP; keeping provisioning portal available");
            (void)esp_wifi_set_mode(WIFI_MODE_APSTA);
        }
    }
    provisioning_stop(app);
    return ESP_ERR_INVALID_STATE;
}

static int wifi_start(vt_app_t *app) {
    app->wifi_events = xEventGroupCreate();
    if (app->wifi_events == NULL) return ESP_ERR_NO_MEM;
    esp_err_t error = esp_netif_init();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) return error;
    error = esp_event_loop_create_default();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) return error;
    app->sta_netif = esp_netif_create_default_wifi_sta();
    if (app->sta_netif == NULL) return ESP_ERR_NO_MEM;
    wifi_init_config_t wifi_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_config));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, app));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, app));
    wifi_config_t station_config = {0};
    ESP_ERROR_CHECK(esp_wifi_get_config(WIFI_IF_STA, &station_config));
    if ((station_config.sta.ssid[0] == '\0' || CONFIG_VEETEE_WIFI_OVERRIDE_NVS) &&
        CONFIG_VEETEE_WIFI_SSID[0] != '\0' && CONFIG_VEETEE_WIFI_PASSWORD[0] != '\0') {
        snprintf((char *)station_config.sta.ssid, sizeof(station_config.sta.ssid), "%s", CONFIG_VEETEE_WIFI_SSID);
        snprintf((char *)station_config.sta.password, sizeof(station_config.sta.password), "%s", CONFIG_VEETEE_WIFI_PASSWORD);
        ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &station_config));
        ESP_LOGI(TAG, "WiFi station profile provisioned from local build config");
    } else {
        ESP_LOGI(TAG, "WiFi station profile loaded from NVS");
    }
    const bool has_station_profile = station_config.sta.ssid[0] != '\0';
    ESP_ERROR_CHECK(esp_wifi_set_mode(has_station_profile ? WIFI_MODE_STA : WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_start());
    if (!has_station_profile) return wifi_wait_for_portal(app);
    EventBits_t bits = xEventGroupWaitBits(app->wifi_events, VT_WIFI_CONNECTED_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(30000));
    if ((bits & VT_WIFI_CONNECTED_BIT) != 0) return ESP_OK;
    /* A stale or unreachable station profile falls back to the local portal.
       The profile remains in NVS until the owner submits a replacement. */
    app->wifi_stop_requested = true;
    (void)esp_wifi_disconnect();
    xEventGroupClearBits(app->wifi_events, VT_WIFI_CONNECTED_BIT | VT_WIFI_PROVISIONED_BIT);
    return wifi_wait_for_portal(app);
}

static int device_identity(vt_app_t *app) {
    uint8_t mac[6] = {0};
    esp_err_t error = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (error != ESP_OK) return error;
    int result = snprintf(app->device_id, sizeof(app->device_id), "%02X:%02X:%02X:%02X:%02X:%02X",
                          mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    if (result <= 0 || (size_t)result >= sizeof(app->device_id)) return ESP_ERR_INVALID_SIZE;
    result = snprintf(app->client_id, sizeof(app->client_id), "veetee-%s", app->device_id);
    return result > 0 && (size_t)result < sizeof(app->client_id) ? ESP_OK : ESP_ERR_INVALID_SIZE;
}

#if CONFIG_VEETEE_MCP_ENABLED
/* MCP/board drivers are initialized by the network owner after Wi-Fi has
   reserved its internal RX buffers.  This keeps the optional capability
   owner out of app_main and guarantees the hello snapshot is complete. */
static void mcp_init(vt_app_t *app) {
    if (app == NULL) return;
    app->mcp_task = heap_caps_calloc(1, sizeof(*app->mcp_task), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    const esp_app_desc_t *app_description = esp_app_get_description();
    esp_err_t board_result = ESP_ERR_INVALID_STATE;
    vt_mcp_task_result_t task_result = VT_MCP_TASK_ERR_ARGUMENT;
    if (app->mcp_task != NULL && app_description != NULL) {
        board_result = vt_board_tools_init(&app->board_tools, CONFIG_VEETEE_BOARD_PROFILE,
                                           CONFIG_VEETEE_BOARD_STATUS_LED_GPIO, CONFIG_VEETEE_BOARD_LAMP_GPIO,
                                           CONFIG_VEETEE_BOARD_STATUS_LED_ACTIVE_LEVEL, CONFIG_VEETEE_BOARD_LAMP_ACTIVE_LEVEL,
                                           CONFIG_VEETEE_BOARD_STATUS_LED_RGB != 0,
                                           CONFIG_VEETEE_MCP_CAPABILITY_REVISION);
        if (board_result == ESP_OK) {
            task_result = vt_mcp_task_init_from_board_hal(
                app->mcp_task, vt_board_tools_hal(&app->board_tools),
                app_description->project_name, app_description->version,
                mcp_send_text, mcp_current_session, app,
                CONFIG_VEETEE_MCP_QUEUE_DEPTH);
        }
    }
    const bool ready = app->mcp_task != NULL && app_description != NULL &&
                       board_result == ESP_OK && task_result == VT_MCP_TASK_OK;
    if (!ready) {
        ESP_LOGW(TAG, "MCP owner task unavailable; continuing without device tools board=%s task=%d stack_free=%u",
                 esp_err_to_name(board_result), (int)task_result,
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
        if (app->mcp_task != NULL) {
            if (app->mcp_task->registry_lock != NULL) vSemaphoreDeleteWithCaps(app->mcp_task->registry_lock);
            if (app->mcp_task->queue != NULL) vQueueDeleteWithCaps(app->mcp_task->queue);
            heap_caps_free(app->mcp_task->output);
        }
        heap_caps_free(app->mcp_task);
        app->mcp_task = NULL;
        return;
    }
    BaseType_t owner_result = xTaskCreateWithCaps(vt_mcp_task_run, "vt_mcp",
                                                  VT_STACK_WORDS(CONFIG_VEETEE_MCP_TASK_STACK),
                                                  app->mcp_task, CONFIG_VEETEE_MCP_TASK_PRIORITY, NULL,
                                                  MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (owner_result != pdPASS) {
        ESP_LOGW(TAG, "MCP owner task creation failed; continuing without device tools");
        vSemaphoreDeleteWithCaps(app->mcp_task->registry_lock);
        vQueueDeleteWithCaps(app->mcp_task->queue);
        heap_caps_free(app->mcp_task->output);
        heap_caps_free(app->mcp_task);
        app->mcp_task = NULL;
    } else {
        ESP_LOGI(TAG, "MCP owner task ready");
    }
}
#endif

void app_main(void) {
    esp_err_t nvs_error = nvs_flash_init();
    if (nvs_error == ESP_ERR_NVS_NO_FREE_PAGES || nvs_error == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGE(TAG, "NVS requires maintenance (%s); refusing automatic erase to preserve Wi-Fi credentials", esp_err_to_name(nvs_error));
        return;
    }
    ESP_ERROR_CHECK(nvs_error);
    vt_app_t *app = calloc(1, sizeof(*app));
    if (app == NULL) return;
    app->state.state = VT_DEVICE_IDLE;
    app->state_lock = xSemaphoreCreateMutex();
    app->audio_encoder_lock = xSemaphoreCreateMutex();
    app->audio_decoder_lock = xSemaphoreCreateMutex();
    app->playback_queue = xQueueCreate(CONFIG_VEETEE_PLAYBACK_QUEUE_DEPTH, sizeof(vt_playback_packet_t));
    app->wake_event_queue = xQueueCreate(4, sizeof(vt_wake_event_t));
    app->wake_command_queue = xQueueCreate(4, sizeof(vt_wake_command_t));
    if (app->state_lock == NULL || app->audio_encoder_lock == NULL || app->audio_decoder_lock == NULL ||
        app->playback_queue == NULL || app->wake_event_queue == NULL ||
        app->wake_command_queue == NULL || device_identity(app) != ESP_OK || pairing_load_or_create(app) != ESP_OK) {
        ESP_LOGE(TAG, "firmware bootstrap allocation failed");
        return;
    }
#if CONFIG_VEETEE_MCP_ENABLED
    /* Board/MCP peripheral ownership is started after app_main yields. */
#endif
    ESP_LOGI(TAG, "board=%s protocol=v%d device=%s", CONFIG_VEETEE_BOARD_PROFILE, CONFIG_VEETEE_PROTOCOL_PROFILE, app->device_id);
#if CONFIG_VEETEE_LCD_ENABLED
    vt_display_config_t display_config = {
        .spi_host = CONFIG_VEETEE_LCD_SPI_HOST,
        .width = CONFIG_VEETEE_LCD_WIDTH,
        .height = CONFIG_VEETEE_LCD_HEIGHT,
        .offset_x = CONFIG_VEETEE_LCD_OFFSET_X,
        .offset_y = CONFIG_VEETEE_LCD_OFFSET_Y,
        .mosi_gpio = CONFIG_VEETEE_LCD_MOSI_GPIO,
        .sclk_gpio = CONFIG_VEETEE_LCD_SCLK_GPIO,
        .dc_gpio = CONFIG_VEETEE_LCD_DC_GPIO,
        .reset_gpio = CONFIG_VEETEE_LCD_RESET_GPIO,
        .cs_gpio = CONFIG_VEETEE_LCD_CS_GPIO,
        .backlight_gpio = CONFIG_VEETEE_LCD_BACKLIGHT_GPIO,
        .backlight_active_level = CONFIG_VEETEE_LCD_BACKLIGHT_ACTIVE_LEVEL,
        .spi_mode = CONFIG_VEETEE_LCD_SPI_MODE,
        .invert_color = CONFIG_VEETEE_LCD_INVERT_COLOR,
        .rgb_order_bgr = CONFIG_VEETEE_LCD_RGB_ORDER_BGR,
        .mirror_x = CONFIG_VEETEE_LCD_MIRROR_X,
        .mirror_y = CONFIG_VEETEE_LCD_MIRROR_Y,
        .swap_xy = CONFIG_VEETEE_LCD_SWAP_XY,
    };
    esp_err_t display_error = vt_display_init(&app->display, &display_config);
    if (display_error != ESP_OK) ESP_LOGE(TAG, "LCD init failed: %s", esp_err_to_name(display_error));
#endif
#if CONFIG_VEETEE_ENABLE_HARDWARE
    vt_audio_config_t audio_config = {
        .input_sample_rate = CONFIG_VEETEE_MIC_SAMPLE_RATE,
        .output_sample_rate = CONFIG_VEETEE_SPK_SAMPLE_RATE,
        .frame_duration_ms = CONFIG_VEETEE_AUDIO_FRAME_DURATION_MS,
        .speaker_bclk_gpio = CONFIG_VEETEE_SPK_BCLK_GPIO,
        .speaker_ws_gpio = CONFIG_VEETEE_SPK_WS_GPIO,
        .speaker_dout_gpio = CONFIG_VEETEE_SPK_DOUT_GPIO,
        .microphone_bclk_gpio = CONFIG_VEETEE_MIC_BCLK_GPIO,
        .microphone_ws_gpio = CONFIG_VEETEE_MIC_WS_GPIO,
        .microphone_din_gpio = CONFIG_VEETEE_MIC_DIN_GPIO,
    };
    ESP_ERROR_CHECK(vt_audio_init(&app->audio, &audio_config));
    ESP_ERROR_CHECK(vt_audio_start(&app->audio));
#if CONFIG_VEETEE_WAKE_ENABLED
    vt_wake_config_t wake_config = {
        .partition_label = CONFIG_VEETEE_WAKE_MODEL_PARTITION,
        .model_name = CONFIG_VEETEE_WAKE_MODEL_NAME,
        .threshold_percent = CONFIG_VEETEE_WAKE_THRESHOLD_PERCENT,
        .detection_mode = CONFIG_VEETEE_WAKE_DETECTION_MODE,
        .input_buffer_samples = CONFIG_VEETEE_WAKE_INPUT_BUFFER_SAMPLES,
    };
    int wake_result = vt_wake_init(&app->wake, &wake_config);
    if (wake_result != VT_WAKE_OK) {
        ESP_LOGW(TAG, "wake disabled result=%d; PTT remains available", wake_result);
    }
#endif
#if CONFIG_VEETEE_BOOT_CHIME_ENABLED
    bool chime_ok = true;
    if (vt_audio_play_tone(&app->audio, CONFIG_VEETEE_BOOT_CHIME_FIRST_HZ,
                           CONFIG_VEETEE_BOOT_CHIME_TONE_MS, CONFIG_VEETEE_BOOT_CHIME_AMPLITUDE) != ESP_OK) {
        ESP_LOGW(TAG, "startup chime first tone failed");
        chime_ok = false;
    }
    vTaskDelay(pdMS_TO_TICKS(CONFIG_VEETEE_BOOT_CHIME_GAP_MS));
    if (vt_audio_play_tone(&app->audio, CONFIG_VEETEE_BOOT_CHIME_SECOND_HZ,
                           CONFIG_VEETEE_BOOT_CHIME_TONE_MS, CONFIG_VEETEE_BOOT_CHIME_AMPLITUDE) != ESP_OK) {
        ESP_LOGW(TAG, "startup chime second tone failed");
        chime_ok = false;
    }
    if (chime_ok) ESP_LOGI(TAG, "startup chime played");
#endif
    gpio_config_t ptt = {
        .pin_bit_mask = 1ULL << CONFIG_VEETEE_PTT_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = CONFIG_VEETEE_PTT_ACTIVE_LEVEL == 0 ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = CONFIG_VEETEE_PTT_ACTIVE_LEVEL == 1 ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&ptt));
    BaseType_t task = xTaskCreateWithCaps(capture_task, "vt_capture", VT_STACK_WORDS(32768), app, 6, NULL,
                                          MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    configASSERT(task == pdPASS);
    task = xTaskCreateWithCaps(playback_task, "vt_playback", VT_STACK_WORDS(16384), app, 6, NULL,
                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    configASSERT(task == pdPASS);
    task = xTaskCreate(ptt_task, "vt_ptt", VT_STACK_WORDS(4096), app, 7, NULL);
    configASSERT(task == pdPASS);
#else
    ESP_LOGW(TAG, "hardware I/O disabled by config");
#endif
#if CONFIG_VEETEE_LCD_ENABLED
    BaseType_t display_task_result = xTaskCreate(display_task, "vt_display", VT_STACK_WORDS(4096), app, 3, NULL);
    configASSERT(display_task_result == pdPASS);
#endif
    BaseType_t network_task_result = xTaskCreateWithCaps(network_task, "vt_network", VT_STACK_WORDS(8192), app, 5, NULL,
                                                         MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    configASSERT(network_task_result == pdPASS);
}
