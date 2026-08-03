#include "veetee_audio.h"
#include "veetee_config.h"
#include "veetee_protocol.h"
#include "veetee_state.h"
#include "veetee_transport.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_err.h"
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

static const char *TAG = "veetee-fw";

typedef struct {
    uint16_t length;
    uint8_t bytes[VT_MAX_OPUS_PAYLOAD_BYTES];
} vt_playback_packet_t;

typedef struct {
    vt_audio_t audio;
    vt_transport_t transport;
    vt_device_state_machine_t state;
    QueueHandle_t playback_queue;
    SemaphoreHandle_t state_lock;
    EventGroupHandle_t wifi_events;
    volatile bool capture_active;
    volatile bool stop_requested;
    volatile bool wifi_stop_requested;
    char device_id[32];
    char client_id[96];
} vt_app_t;

#define VT_WIFI_CONNECTED_BIT BIT0
#define VT_WS_RETRY_DELAY_MS 2000
#define VT_PTT_POLL_MS 10
#define VT_PTT_DEBOUNCE_SAMPLES 3

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static int wifi_start(vt_app_t *app);
static void websocket_text_callback(const cJSON *message, void *context);
static void websocket_audio_callback(const uint8_t *payload, size_t payload_size, void *context);
static void network_task(void *context);
static void capture_task(void *context);
static void playback_task(void *context);
static void ptt_task(void *context);
static bool state_apply(vt_app_t *app, vt_device_event_t event);
static vt_device_state_t state_read(vt_app_t *app);
static int send_control(vt_app_t *app, const char *type, const char *state, const char *reason);
static int device_identity(vt_app_t *app);

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
            (void)xQueueReset(app->playback_queue);
            vt_audio_reset(&app->audio);
            (void)state_apply(app, VT_EVENT_TTS_START);
        } else if (strcmp(tts_state->valuestring, "stop") == 0) {
            (void)state_apply(app, VT_EVENT_TTS_STOP);
        }
        return;
    }
    if (strcmp(type->valuestring, "alert") == 0) {
        app->capture_active = false;
        (void)xQueueReset(app->playback_queue);
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
    if (xQueueSend(app->playback_queue, &packet, 0) != pdTRUE) ESP_LOGW(TAG, "playback queue full; dropping frame");
}

static void playback_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    vt_playback_packet_t packet;
    while (!app->stop_requested) {
        if (xQueueReceive(app->playback_queue, &packet, pdMS_TO_TICKS(250)) == pdTRUE) {
            if (vt_audio_decode_and_play(&app->audio, packet.bytes, packet.length) != ESP_OK) ESP_LOGW(TAG, "Opus playback decode failed");
        }
    }
    vTaskDelete(NULL);
}

static void capture_task(void *context) {
    vt_app_t *app = (vt_app_t *)context;
    int16_t samples[CONFIG_VEETEE_MIC_SAMPLE_RATE * CONFIG_VEETEE_AUDIO_FRAME_DURATION_MS / 1000];
    uint8_t opus[VT_MAX_OPUS_PAYLOAD_BYTES];
    while (!app->stop_requested) {
        if (!app->capture_active || !vt_transport_is_ready(&app->transport)) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        size_t sample_count = 0;
        if (vt_audio_read_pcm(&app->audio, samples, sizeof(samples) / sizeof(samples[0]), &sample_count) != ESP_OK) continue;
        size_t opus_size = 0;
        if (vt_audio_encode(&app->audio, samples, sample_count, opus, sizeof(opus), &opus_size) != ESP_OK) {
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
    int samples = 0;
    while (!app->stop_requested) {
        bool active = gpio_get_level(CONFIG_VEETEE_PTT_GPIO) == CONFIG_VEETEE_PTT_ACTIVE_LEVEL;
        if (active != candidate) {
            candidate = active;
            samples = 0;
        } else if (samples < VT_PTT_DEBOUNCE_SAMPLES) {
            ++samples;
            if (samples >= VT_PTT_DEBOUNCE_SAMPLES && stable != candidate) {
                stable = candidate;
                if (stable) {
                    if (state_read(app) == VT_DEVICE_SPEAKING) {
                        app->capture_active = false;
                        (void)send_control(app, "abort", NULL, "button_interrupt");
                        (void)xQueueReset(app->playback_queue);
                        (void)state_apply(app, VT_EVENT_ABORT);
                    } else if (state_read(app) == VT_DEVICE_LISTENING) {
                        vt_audio_reset(&app->audio);
                        if (send_control(app, "listen", "start", NULL) == ESP_OK) {
                            app->capture_active = true;
                            ESP_LOGI(TAG, "PTT start");
                        }
                    }
                } else if (app->capture_active) {
                    app->capture_active = false;
                    (void)send_control(app, "listen", "stop", NULL);
                    (void)state_apply(app, VT_EVENT_LISTEN_STOP);
                    ESP_LOGI(TAG, "PTT stop");
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
            .profile = (vt_protocol_profile_t)CONFIG_VEETEE_PROTOCOL_PROFILE,
            .input_sample_rate = CONFIG_VEETEE_MIC_SAMPLE_RATE,
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
    app->playback_queue = xQueueCreate(12, sizeof(vt_playback_packet_t));
    if (app->state_lock == NULL || app->playback_queue == NULL || device_identity(app) != ESP_OK) {
        ESP_LOGE(TAG, "firmware bootstrap allocation failed");
        return;
    }
    ESP_LOGI(TAG, "board=%s protocol=v%d device=%s", CONFIG_VEETEE_BOARD_PROFILE, CONFIG_VEETEE_PROTOCOL_PROFILE, app->device_id);
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
    gpio_config_t ptt = {
        .pin_bit_mask = 1ULL << CONFIG_VEETEE_PTT_GPIO,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = CONFIG_VEETEE_PTT_ACTIVE_LEVEL == 0 ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = CONFIG_VEETEE_PTT_ACTIVE_LEVEL == 1 ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&ptt));
    BaseType_t task = xTaskCreate(capture_task, "vt_capture", 12288, app, 6, NULL);
    configASSERT(task == pdPASS);
    task = xTaskCreate(playback_task, "vt_playback", 8192, app, 6, NULL);
    configASSERT(task == pdPASS);
    task = xTaskCreate(ptt_task, "vt_ptt", 4096, app, 7, NULL);
    configASSERT(task == pdPASS);
#else
    ESP_LOGW(TAG, "hardware I/O disabled by config");
#endif
    BaseType_t network_task_result = xTaskCreate(network_task, "vt_network", 8192, app, 5, NULL);
    configASSERT(network_task_result == pdPASS);
}
