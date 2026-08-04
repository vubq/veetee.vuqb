#include "veetee_audio.h"
#include "veetee_config.h"
#include "veetee_display.h"
#include "veetee_protocol.h"
#include "veetee_state.h"
#include "veetee_transport.h"
#include "veetee_wake.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_err.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "nvs_flash.h"

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

static const char *TAG = "veetee-fw";

typedef struct {
    uint16_t length;
    uint8_t bytes[VT_MAX_OPUS_PAYLOAD_BYTES];
} vt_playback_packet_t;

typedef enum {
    VT_WAKE_COMMAND_ARM = 1,
} vt_wake_command_t;

typedef struct {
    vt_audio_t audio;
    vt_display_t display;
    vt_transport_t transport;
    vt_device_state_machine_t state;
    vt_wake_t wake;
    QueueHandle_t playback_queue;
    QueueHandle_t wake_event_queue;
    QueueHandle_t wake_command_queue;
    SemaphoreHandle_t state_lock;
    SemaphoreHandle_t audio_encoder_lock;
    SemaphoreHandle_t audio_decoder_lock;
    EventGroupHandle_t wifi_events;
    volatile bool capture_active;
    volatile bool playback_busy;
    volatile bool wake_rearm_pending;
    volatile bool stop_requested;
    volatile bool wifi_stop_requested;
    bool wake_auto_capture;
    char device_id[32];
    char client_id[96];
} vt_app_t;

#define VT_WIFI_CONNECTED_BIT BIT0
#define VT_WS_RETRY_DELAY_MS 2000
#define VT_PTT_POLL_MS 10
#define VT_PTT_DEBOUNCE_SAMPLES 3
#define VT_PTT_RETRY_DELAY_MS 250

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static int wifi_start(vt_app_t *app);
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
    if (app == NULL) return;
    app->wake_rearm_pending = true;
    if (!playback_is_idle(app)) {
        ESP_LOGI(TAG, "wake re-arm deferred until playback idle");
        return;
    }
    app->wake_rearm_pending = false;
    request_wake_arm(app);
    ESP_LOGI(TAG, "wake detector re-arm requested after playback idle");
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
    while (!app->stop_requested) {
        vt_device_state_t current = state_read(app);
        if (current != previous) {
            if (vt_display_show_state(&app->display, current) != ESP_OK && app->display.ready) {
                ESP_LOGW(TAG, "LCD state render failed state=%s", vt_state_name(current));
            }
            previous = current;
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
        (void)state_apply(app, VT_EVENT_HELLO_READY);
        ESP_LOGI(TAG, "server hello accepted; session ready");
        return;
    }
    if (strcmp(type->valuestring, "tts") == 0) {
        cJSON *tts_state = cJSON_GetObjectItemCaseSensitive(message, "state");
        if (!cJSON_IsString(tts_state) || tts_state->valuestring == NULL) return;
        if (strcmp(tts_state->valuestring, "start") == 0) {
            app->wake_rearm_pending = false;
            (void)xQueueReset(app->playback_queue);
            vt_audio_reset_acoustic_reference(&app->audio);
            /* Stop capture before resetting the decoder. The decoder mutex
               serializes a possible in-flight decode. The Opus
               encoder remains continuous across turns; its reset path is not
               used here because the vendor API may return DATA_LACK at the
               start of a new stream. */
            app->capture_active = false;
            if (!audio_decoder_reset_locked(app)) ESP_LOGW(TAG, "audio decoder reset skipped: lock timeout");
            if (app->wake_auto_capture) {
                /* Auto-mode is half-duplex until AFE/AEC realtime capture is
                   promoted. Stop uplink as soon as the server starts speaking;
                   keep the flag so tts/stop can re-arm WakeNet exactly once. */
                ESP_LOGI(TAG, "wake capture paused while server is speaking");
            }
            (void)state_apply(app, VT_EVENT_TTS_START);
        } else if (strcmp(tts_state->valuestring, "stop") == 0) {
            if (app->wake_auto_capture) {
                app->capture_active = false;
                app->wake_auto_capture = false;
                request_wake_arm_when_playback_idle(app);
                ESP_LOGI(TAG, "wake capture complete; detector re-arm scheduled");
            }
            (void)state_apply(app, VT_EVENT_TTS_STOP);
        }
        return;
    }
    if (strcmp(type->valuestring, "alert") == 0) {
        app->capture_active = false;
        app->wake_auto_capture = false;
        (void)xQueueReset(app->playback_queue);
        vt_audio_reset_acoustic_reference(&app->audio);
        request_wake_arm_when_playback_idle(app);
        (void)state_apply(app, VT_EVENT_ABORT);
        cJSON *code = cJSON_GetObjectItemCaseSensitive(message, "code");
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
                if (app->wake_rearm_pending) request_wake_arm_when_playback_idle(app);
                continue;
            }
            int result = vt_audio_decode_and_play(&app->audio, packet.bytes, packet.length);
            audio_decoder_lock_give(app);
            if (result != ESP_OK) ESP_LOGW(TAG, "Opus playback decode failed");
            app->playback_busy = false;
            if (app->wake_rearm_pending) request_wake_arm_when_playback_idle(app);
        }
    }
    vTaskDelete(NULL);
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
    TickType_t next_read_error_log = 0;
    TickType_t next_partial_frame_log = 0;
#endif
    while (!app->stop_requested) {
        vt_wake_command_t command = 0;
        while (app->wake_command_queue != NULL && xQueueReceive(app->wake_command_queue, &command, 0) == pdTRUE) {
            if (command == VT_WAKE_COMMAND_ARM && vt_wake_is_ready(&app->wake)) {
                int arm_result = vt_wake_arm(&app->wake);
                if (arm_result != VT_WAKE_OK) {
                    ESP_LOGW(TAG, "wake re-arm failed result=%d", arm_result);
                } else {
                    ESP_LOGI(TAG, "wake detector armed model=%s", vt_wake_model_name(&app->wake));
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
        bool wake_allowed = !app->capture_active;
#if CONFIG_VEETEE_WAKE_DURING_PLAYBACK
        wake_allowed = wake_allowed &&
                       (audio_state != VT_DEVICE_SPEAKING || vt_audio_aec_ready(&app->audio));
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
    vTaskDelete(NULL);
}

static void ptt_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    bool stable = false;
    bool candidate = false;
    bool pending_start = false;
    bool pending_auto = false;
    int samples = 0;
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
            if (vt_state_is_interruptible(current)) {
                app->capture_active = false;
                app->wake_auto_capture = false;
                (void)send_control(app, "abort", NULL, "wake_word_detected");
                (void)xQueueReset(app->playback_queue);
                vt_audio_reset_acoustic_reference(&app->audio);
                request_wake_arm_when_playback_idle(app);
                (void)state_apply(app, VT_EVENT_ABORT);
                ESP_LOGI(TAG, "wake interrupt");
            }
        }
        bool active = gpio_get_level(CONFIG_VEETEE_PTT_GPIO) == CONFIG_VEETEE_PTT_ACTIVE_LEVEL;
        if (active != candidate) {
            candidate = active;
            samples = 0;
        } else if (samples < VT_PTT_DEBOUNCE_SAMPLES) {
            ++samples;
            if (samples >= VT_PTT_DEBOUNCE_SAMPLES && stable != candidate) {
                stable = candidate;
                if (stable) {
                    pending_start = true;
                    pending_auto = false;
                    vt_device_state_t current = state_read(app);
                    if (vt_state_is_interruptible(current)) {
                        bool was_auto_capture = app->wake_auto_capture;
                        app->capture_active = false;
                        app->wake_auto_capture = false;
                        (void)send_control(app, "abort", NULL, "button_interrupt");
                        (void)xQueueReset(app->playback_queue);
                        vt_audio_reset_acoustic_reference(&app->audio);
                        if (was_auto_capture) request_wake_arm_when_playback_idle(app);
                        (void)state_apply(app, VT_EVENT_ABORT);
                        ESP_LOGI(TAG, "PTT interrupt state=%s", vt_state_name(current));
                    }
                } else if (app->capture_active) {
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
        }
        if ((stable || pending_auto) && pending_start && !app->capture_active && state_read(app) == VT_DEVICE_LISTENING) {
            TickType_t now = xTaskGetTickCount();
            if ((int32_t)(now - retry_after) >= 0) {
                int result = send_listen_start(app, pending_auto);
                if (result == ESP_OK) {
                    app->capture_active = true;
                    app->wake_auto_capture = pending_auto;
                    pending_start = false;
                    ESP_LOGI(TAG, "%s start", pending_auto ? "wake" : "PTT");
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
        vTaskDelete(NULL);
        return;
    }
    if (wifi_start(app) != ESP_OK) {
        ESP_LOGW(TAG, "WiFi station did not obtain an IP; preserve NVS and provision credentials before retry");
        vTaskDelete(NULL);
        return;
    }
    while (!app->stop_requested) {
        vt_transport_config_t transport_config = {
            .uri = CONFIG_VEETEE_WS_URI,
            .device_id = app->device_id,
            .client_id = app->client_id,
            .firmware_version = esp_app_get_description()->version,
            .board_profile = CONFIG_VEETEE_BOARD_PROFILE,
            .profile = (vt_protocol_profile_t)CONFIG_VEETEE_PROTOCOL_PROFILE,
            .input_sample_rate = CONFIG_VEETEE_MIC_SAMPLE_RATE,
            .output_sample_rate = CONFIG_VEETEE_SPK_SAMPLE_RATE,
            .frame_duration_ms = CONFIG_VEETEE_AUDIO_FRAME_DURATION_MS,
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
        request_wake_arm(app);
        (void)vt_transport_stop(&app->transport);
        (void)state_apply(app, VT_EVENT_DISCONNECT);
        if (!app->stop_requested) vTaskDelay(pdMS_TO_TICKS(VT_WS_RETRY_DELAY_MS));
    }
    vTaskDelete(NULL);
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

static int wifi_start(vt_app_t *app) {
    app->wifi_events = xEventGroupCreate();
    if (app->wifi_events == NULL) return ESP_ERR_NO_MEM;
    esp_err_t error = esp_netif_init();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) return error;
    error = esp_event_loop_create_default();
    if (error != ESP_OK && error != ESP_ERR_INVALID_STATE) return error;
    if (esp_netif_create_default_wifi_sta() == NULL) return ESP_ERR_NO_MEM;
    wifi_init_config_t wifi_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_config));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, app));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, app));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
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
    ESP_ERROR_CHECK(esp_wifi_start());
    EventBits_t bits = xEventGroupWaitBits(app->wifi_events, VT_WIFI_CONNECTED_BIT, pdFALSE, pdFALSE, pdMS_TO_TICKS(30000));
    if ((bits & VT_WIFI_CONNECTED_BIT) != 0) return ESP_OK;
    /* Initial provisioning failure is operator-visible and terminal for this
       network task. Do not keep reconnecting in the background or erase NVS. */
    app->wifi_stop_requested = true;
    (void)esp_wifi_disconnect();
    (void)esp_wifi_stop();
    return ESP_ERR_TIMEOUT;
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
        app->wake_command_queue == NULL || device_identity(app) != ESP_OK) {
        ESP_LOGE(TAG, "firmware bootstrap allocation failed");
        return;
    }
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
    BaseType_t task = xTaskCreate(capture_task, "vt_capture", 32768, app, 6, NULL);
    configASSERT(task == pdPASS);
    task = xTaskCreate(playback_task, "vt_playback", 16384, app, 6, NULL);
    configASSERT(task == pdPASS);
    task = xTaskCreate(ptt_task, "vt_ptt", 4096, app, 7, NULL);
    configASSERT(task == pdPASS);
#else
    ESP_LOGW(TAG, "hardware I/O disabled by config");
#endif
#if CONFIG_VEETEE_LCD_ENABLED
    BaseType_t display_task_result = xTaskCreate(display_task, "vt_display", 4096, app, 3, NULL);
    configASSERT(display_task_result == pdPASS);
#endif
    BaseType_t network_task_result = xTaskCreate(network_task, "vt_network", 8192, app, 5, NULL);
    configASSERT(network_task_result == pdPASS);
}
