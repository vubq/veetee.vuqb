#include "veetee_protocol.h"

#include <string.h>

static void put_u16(uint8_t *buffer, uint16_t value) {
    buffer[0] = (uint8_t)(value >> 8U);
    buffer[1] = (uint8_t)value;
}

static void put_u32(uint8_t *buffer, uint32_t value) {
    buffer[0] = (uint8_t)(value >> 24U);
    buffer[1] = (uint8_t)(value >> 16U);
    buffer[2] = (uint8_t)(value >> 8U);
    buffer[3] = (uint8_t)value;
}

static uint16_t get_u16(const uint8_t *buffer) {
    return (uint16_t)(((uint16_t)buffer[0] << 8U) | buffer[1]);
}

static uint32_t get_u32(const uint8_t *buffer) {
    return ((uint32_t)buffer[0] << 24U) |
           ((uint32_t)buffer[1] << 16U) |
           ((uint32_t)buffer[2] << 8U) |
           buffer[3];
}

vt_protocol_result_t vt_protocol_encode_audio(
    const vt_audio_frame_t *frame,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length) {
    if (frame == NULL || output == NULL || output_length == NULL ||
        frame->payload == NULL || frame->payload_len == 0U ||
        frame->payload_len > VT_MAX_OPUS_PAYLOAD_BYTES) {
        return VT_PROTOCOL_ERR_ARGUMENT;
    }
    const size_t header_len = frame->profile == VT_PROFILE_WS_V1_COMPAT ? 0U :
                              frame->profile == VT_PROFILE_WS_V2 ? 16U : 4U;
    if (frame->profile < VT_PROFILE_WS_V1_COMPAT || frame->profile > VT_PROFILE_WS_V3 ||
        output_capacity < header_len + frame->payload_len) {
        return VT_PROTOCOL_ERR_ARGUMENT;
    }
    if (frame->profile == VT_PROFILE_WS_V1_COMPAT) {
        memcpy(output, frame->payload, frame->payload_len);
    } else if (frame->profile == VT_PROFILE_WS_V2) {
        put_u16(output, 2U);
        put_u16(output + 2U, 0U);
        put_u32(output + 4U, 0U);
        put_u32(output + 8U, frame->timestamp_ms);
        put_u32(output + 12U, frame->payload_len);
        memcpy(output + 16U, frame->payload, frame->payload_len);
    } else {
        output[0] = 0U;
        output[1] = 0U;
        put_u16(output + 2U, frame->payload_len);
        memcpy(output + 4U, frame->payload, frame->payload_len);
    }
    *output_length = header_len + frame->payload_len;
    return VT_PROTOCOL_OK;
}

vt_protocol_result_t vt_protocol_decode_audio(
    vt_protocol_profile_t profile,
    const uint8_t *input,
    size_t input_length,
    vt_audio_frame_t *frame) {
    if (input == NULL || frame == NULL || input_length == 0U) {
        return VT_PROTOCOL_ERR_ARGUMENT;
    }
    size_t header_len = profile == VT_PROFILE_WS_V1_COMPAT ? 0U : profile == VT_PROFILE_WS_V2 ? 16U : 4U;
    if (profile < VT_PROFILE_WS_V1_COMPAT || profile > VT_PROFILE_WS_V3 || input_length < header_len) {
        return VT_PROTOCOL_ERR_SHORT;
    }
    const uint8_t *payload = input + header_len;
    size_t payload_len = input_length - header_len;
    uint32_t timestamp = 0U;
    if (profile == VT_PROFILE_WS_V2) {
        if (get_u16(input) != 2U || get_u16(input + 2U) != 0U || get_u32(input + 4U) != 0U) {
            return VT_PROTOCOL_ERR_HEADER;
        }
        timestamp = get_u32(input + 8U);
        if (get_u32(input + 12U) != payload_len) {
            return VT_PROTOCOL_ERR_LENGTH;
        }
    } else if (profile == VT_PROFILE_WS_V3) {
        if (input[0] != 0U || input[1] != 0U) {
            return VT_PROTOCOL_ERR_HEADER;
        }
        if (get_u16(input + 2U) != payload_len) {
            return VT_PROTOCOL_ERR_LENGTH;
        }
    }
    if (payload_len == 0U || payload_len > VT_MAX_OPUS_PAYLOAD_BYTES) {
        return VT_PROTOCOL_ERR_PAYLOAD;
    }
    frame->profile = profile;
    frame->payload = payload;
    frame->payload_len = (uint16_t)payload_len;
    frame->timestamp_ms = timestamp;
    return VT_PROTOCOL_OK;
}

const char *vt_protocol_profile_name(vt_protocol_profile_t profile) {
    switch (profile) {
    case VT_PROFILE_WS_V1_COMPAT: return "ws-v1-compat";
    case VT_PROFILE_WS_V2: return "ws-v2";
    case VT_PROFILE_WS_V3: return "ws-v3";
    default: return "unknown";
    }
}
