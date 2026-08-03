#include "veetee_transport.h"

#include <stdio.h>
#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_err.h"
#include "esp_log.h"

#define TAG "veetee-ws"
#define VT_TRANSPORT_BUFFER_SIZE 4096

static void transport_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data);
static int send_hello(vt_transport_t *transport);
static int send_raw_text(vt_transport_t *transport, const char *text);

static int profile_version_number(vt_protocol_profile_t profile) {
    return profile == VT_PROFILE_WS_V1_COMPAT ? 1 : profile == VT_PROFILE_WS_V2 ? 2 : profile == VT_PROFILE_WS_V3 ? 3 : 0;
}

int vt_transport_init(vt_transport_t *transport, const vt_transport_config_t *config) {
    if (transport == NULL || config == NULL || config->uri == NULL || config->device_id == NULL ||
        config->client_id == NULL || config->on_text == NULL || config->on_audio == NULL ||
        config->input_sample_rate <= 0 || config->frame_duration_ms <= 0) return ESP_ERR_INVALID_ARG;
    memset(transport, 0, sizeof(*transport));
    transport->config = *config;
    transport->events = xEventGroupCreate();
    if (transport->events == NULL) return ESP_ERR_NO_MEM;
    int header_length = snprintf(transport->headers, sizeof(transport->headers),
                                 "Protocol-Version: %d\r\nDevice-Id: %s\r\nClient-Id: %s\r\n",
                                 profile_version_number(config->profile), config->device_id, config->client_id);
    if (header_length <= 0 || (size_t)header_length >= sizeof(transport->headers)) return ESP_ERR_INVALID_SIZE;
    esp_websocket_client_config_t client_config = {
        .uri = config->uri,
        .headers = transport->headers,
        .disable_auto_reconnect = true,
        .enable_close_reconnect = false,
        .task_prio = 5,
        .task_name = "vt_ws_io",
        .task_stack = 8192,
        .buffer_size = VT_TRANSPORT_BUFFER_SIZE,
        .network_timeout_ms = 10000,
        .ping_interval_sec = 15,
        .pingpong_timeout_sec = 10,
        .user_agent = "veetee-firmware/0.1",
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    transport->client = esp_websocket_client_init(&client_config);
    if (transport->client == NULL) return ESP_ERR_NO_MEM;
    esp_err_t error = esp_websocket_register_events(transport->client, WEBSOCKET_EVENT_ANY, transport_event_handler, transport);
    if (error != ESP_OK) return error;
    return ESP_OK;
}

int vt_transport_start(vt_transport_t *transport, TickType_t timeout) {
    if (transport == NULL || transport->client == NULL) return ESP_ERR_INVALID_STATE;
    esp_err_t error = esp_websocket_client_start(transport->client);
    if (error != ESP_OK) return error;
    EventBits_t bits = xEventGroupWaitBits(transport->events, VT_TRANSPORT_READY_BIT, pdFALSE, pdFALSE, timeout);
    return (bits & VT_TRANSPORT_READY_BIT) != 0 ? ESP_OK : ESP_ERR_TIMEOUT;
}

int vt_transport_stop(vt_transport_t *transport) {
    if (transport == NULL) return ESP_ERR_INVALID_ARG;
    if (transport->client != NULL) {
        if (esp_websocket_client_is_connected(transport->client)) (void)esp_websocket_client_close(transport->client, pdMS_TO_TICKS(500));
        (void)esp_websocket_client_stop(transport->client);
        (void)esp_websocket_client_destroy(transport->client);
        transport->client = NULL;
    }
    if (transport->events != NULL) {
        vEventGroupDelete(transport->events);
        transport->events = NULL;
    }
    transport->connected = false;
    transport->ready = false;
    return ESP_OK;
}

bool vt_transport_is_ready(const vt_transport_t *transport) {
    return transport != NULL && transport->ready && transport->client != NULL && esp_websocket_client_is_connected(transport->client);
}

const char *vt_transport_session_id(const vt_transport_t *transport) {
    return transport == NULL ? "" : transport->session_id;
}

int vt_transport_send_text(vt_transport_t *transport, const char *text) {
    if (!vt_transport_is_ready(transport) || text == NULL) return ESP_ERR_INVALID_STATE;
    return send_raw_text(transport, text);
}

static int send_raw_text(vt_transport_t *transport, const char *text) {
    if (transport == NULL || transport->client == NULL || !transport->connected || text == NULL) return ESP_ERR_INVALID_STATE;
    int length = (int)strlen(text);
    if (length <= 0) return ESP_ERR_INVALID_ARG;
    return esp_websocket_client_send_text(transport->client, text, length, pdMS_TO_TICKS(500)) == length ? ESP_OK : ESP_FAIL;
}

int vt_transport_send_audio(vt_transport_t *transport, const uint8_t *opus, size_t opus_size, uint32_t timestamp_ms) {
    if (!vt_transport_is_ready(transport) || opus == NULL || opus_size == 0 || opus_size > VT_MAX_OPUS_PAYLOAD_BYTES) return ESP_ERR_INVALID_ARG;
    uint8_t frame[VT_MAX_OPUS_PAYLOAD_BYTES + 16];
    vt_audio_frame_t audio = {
        .profile = transport->config.profile,
        .payload = opus,
        .payload_len = (uint16_t)opus_size,
        .timestamp_ms = timestamp_ms,
    };
    size_t frame_size = 0;
    vt_protocol_result_t result = vt_protocol_encode_audio(&audio, frame, sizeof(frame), &frame_size);
    if (result != VT_PROTOCOL_OK) return ESP_ERR_INVALID_SIZE;
    return esp_websocket_client_send_bin(transport->client, (const char *)frame, (int)frame_size, pdMS_TO_TICKS(500)) == (int)frame_size ? ESP_OK : ESP_FAIL;
}

static int send_hello(vt_transport_t *transport) {
    cJSON *root = cJSON_CreateObject();
    cJSON *features = cJSON_CreateObject();
    cJSON *audio = cJSON_CreateObject();
    if (root == NULL || features == NULL || audio == NULL) {
        cJSON_Delete(root); cJSON_Delete(features); cJSON_Delete(audio);
        return ESP_ERR_NO_MEM;
    }
    cJSON_AddStringToObject(root, "type", "hello");
    cJSON_AddNumberToObject(root, "version", profile_version_number(transport->config.profile));
    cJSON_AddStringToObject(root, "transport", "websocket");
    cJSON_AddBoolToObject(features, "mcp", false);
    cJSON_AddItemToObject(root, "features", features);
    cJSON_AddStringToObject(audio, "format", "opus");
    cJSON_AddNumberToObject(audio, "sample_rate", transport->config.input_sample_rate);
    cJSON_AddNumberToObject(audio, "channels", 1);
    cJSON_AddNumberToObject(audio, "frame_duration", transport->config.frame_duration_ms);
    cJSON_AddItemToObject(root, "audio_params", audio);
    char *serialized = cJSON_PrintUnformatted(root);
    int result = serialized == NULL ? ESP_ERR_NO_MEM : send_raw_text(transport, serialized);
    cJSON_free(serialized);
    cJSON_Delete(root);
    return result;
}

static void transport_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data) {
    (void)event_base;
    vt_transport_t *transport = (vt_transport_t *)arg;
    if (transport == NULL) return;
    if (event_id == WEBSOCKET_EVENT_CONNECTED) {
        transport->connected = true;
        xEventGroupSetBits(transport->events, VT_TRANSPORT_CONNECTED_BIT);
        if (send_hello(transport) != ESP_OK) ESP_LOGE(TAG, "hello send failed");
        return;
    }
    if (event_id == WEBSOCKET_EVENT_DISCONNECTED || event_id == WEBSOCKET_EVENT_ERROR || event_id == WEBSOCKET_EVENT_CLOSED) {
        transport->connected = false;
        transport->ready = false;
        memset(transport->session_id, 0, sizeof(transport->session_id));
        xEventGroupClearBits(transport->events, VT_TRANSPORT_CONNECTED_BIT | VT_TRANSPORT_READY_BIT);
        return;
    }
    if (event_id != WEBSOCKET_EVENT_DATA || event_data == NULL) return;
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;
    if (data->data_ptr == NULL || data->data_len <= 0 || data->payload_offset != 0 || data->data_len != data->payload_len || !data->fin) return;
    if (data->op_code == 0x2) {
        transport->config.on_audio((const uint8_t *)data->data_ptr, (size_t)data->data_len, transport->config.context);
        return;
    }
    if (data->op_code != 0x1) return;
    cJSON *message = cJSON_ParseWithLength(data->data_ptr, (size_t)data->data_len);
    if (message == NULL) return;
    cJSON *type = cJSON_GetObjectItemCaseSensitive(message, "type");
    if (cJSON_IsString(type) && strcmp(type->valuestring, "hello") == 0) {
        cJSON *session = cJSON_GetObjectItemCaseSensitive(message, "session_id");
        if (cJSON_IsString(session) && session->valuestring != NULL) {
            (void)snprintf(transport->session_id, sizeof(transport->session_id), "%s", session->valuestring);
            transport->ready = true;
            xEventGroupSetBits(transport->events, VT_TRANSPORT_READY_BIT);
        }
    }
    transport->config.on_text(message, transport->config.context);
    cJSON_Delete(message);
}
