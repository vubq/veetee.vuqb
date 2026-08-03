#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "cJSON.h"
#include "esp_websocket_client.h"

#include "veetee_protocol.h"

typedef void (*vt_transport_text_callback_t)(const cJSON *message, void *context);
typedef void (*vt_transport_audio_callback_t)(const uint8_t *payload, size_t payload_size, void *context);

typedef struct {
    const char *uri;
    const char *device_id;
    const char *client_id;
    const char *firmware_version;
    const char *board_profile;
    vt_protocol_profile_t profile;
    int input_sample_rate;
    int output_sample_rate;
    int frame_duration_ms;
    vt_transport_text_callback_t on_text;
    vt_transport_audio_callback_t on_audio;
    void *context;
} vt_transport_config_t;

typedef struct {
    esp_websocket_client_handle_t client;
    EventGroupHandle_t events;
    vt_transport_config_t config;
    char headers[256];
    char session_id[96];
    bool connected;
    bool ready;
} vt_transport_t;

#define VT_TRANSPORT_CONNECTED_BIT BIT0
#define VT_TRANSPORT_READY_BIT BIT1

int vt_transport_init(vt_transport_t *transport, const vt_transport_config_t *config);
int vt_transport_start(vt_transport_t *transport, TickType_t timeout);
int vt_transport_stop(vt_transport_t *transport);
bool vt_transport_is_ready(const vt_transport_t *transport);
const char *vt_transport_session_id(const vt_transport_t *transport);
int vt_transport_send_text(vt_transport_t *transport, const char *text);
int vt_transport_send_audio(vt_transport_t *transport, const uint8_t *opus, size_t opus_size, uint32_t timestamp_ms);
