#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define VT_MAX_OPUS_PAYLOAD_BYTES 1500U

typedef enum {
    VT_PROFILE_WS_V1_COMPAT = 1,
    VT_PROFILE_WS_V2 = 2,
    VT_PROFILE_WS_V3 = 3,
} vt_protocol_profile_t;

typedef struct {
    vt_protocol_profile_t profile;
    const uint8_t *payload;
    uint16_t payload_len;
    uint32_t timestamp_ms;
} vt_audio_frame_t;

typedef enum {
    VT_PROTOCOL_OK = 0,
    VT_PROTOCOL_ERR_ARGUMENT = -1,
    VT_PROTOCOL_ERR_SHORT = -2,
    VT_PROTOCOL_ERR_HEADER = -3,
    VT_PROTOCOL_ERR_LENGTH = -4,
    VT_PROTOCOL_ERR_PAYLOAD = -5,
} vt_protocol_result_t;

vt_protocol_result_t vt_protocol_encode_audio(
    const vt_audio_frame_t *frame,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length);

vt_protocol_result_t vt_protocol_decode_audio(
    vt_protocol_profile_t profile,
    const uint8_t *input,
    size_t input_length,
    vt_audio_frame_t *frame);

const char *vt_protocol_profile_name(vt_protocol_profile_t profile);

/*
 * The legacy direct-WebSocket peer echoes the client hello audio parameters,
 * which can advertise 16 kHz server audio even when the device speaker is
 * configured for 24 kHz. Keep that exception isolated to the explicit v1
 * compatibility profile; product profiles still require the negotiated rate
 * to match the configured decoder contract.
 */
bool vt_protocol_is_supported_opus_sample_rate(int sample_rate);
bool vt_protocol_server_sample_rate_compatible(
    vt_protocol_profile_t profile,
    int advertised_sample_rate,
    int configured_sample_rate);
