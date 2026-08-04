#include "veetee_mqtt_udp_wire.h"

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

vt_mqtt_udp_result_t vt_mqtt_udp_encode(
    const vt_mqtt_udp_frame_t *frame,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length) {
    if (frame == NULL || output == NULL || output_length == NULL || frame->payload == NULL ||
        frame->payload_len == 0U || frame->payload_len > VT_MQTT_UDP_MAX_PAYLOAD_BYTES) {
        return VT_MQTT_UDP_ERR_ARGUMENT;
    }
    if (frame->sequence == 0U) return VT_MQTT_UDP_ERR_SEQUENCE;
    const size_t frame_length = VT_MQTT_UDP_HEADER_SIZE + frame->payload_len;
    if (output_capacity < frame_length) return VT_MQTT_UDP_ERR_ARGUMENT;
    output[0] = VT_MQTT_UDP_PACKET_TYPE;
    output[1] = frame->flags;
    put_u16(output + 2U, frame->payload_len);
    put_u32(output + 4U, frame->ssrc);
    put_u32(output + 8U, frame->timestamp_ms);
    put_u32(output + 12U, frame->sequence);
    memcpy(output + VT_MQTT_UDP_HEADER_SIZE, frame->payload, frame->payload_len);
    *output_length = frame_length;
    return VT_MQTT_UDP_OK;
}

vt_mqtt_udp_result_t vt_mqtt_udp_decode(
    const uint8_t *input,
    size_t input_length,
    vt_mqtt_udp_frame_t *frame) {
    if (input == NULL || frame == NULL) return VT_MQTT_UDP_ERR_ARGUMENT;
    if (input_length < VT_MQTT_UDP_HEADER_SIZE) return VT_MQTT_UDP_ERR_SHORT;
    if (input[0] != VT_MQTT_UDP_PACKET_TYPE) return VT_MQTT_UDP_ERR_HEADER;
    const uint16_t payload_len = get_u16(input + 2U);
    if (payload_len == 0U || payload_len > VT_MQTT_UDP_MAX_PAYLOAD_BYTES) {
        return VT_MQTT_UDP_ERR_PAYLOAD;
    }
    if (input_length != VT_MQTT_UDP_HEADER_SIZE + payload_len) return VT_MQTT_UDP_ERR_LENGTH;
    const uint32_t sequence = get_u32(input + 12U);
    if (sequence == 0U) return VT_MQTT_UDP_ERR_SEQUENCE;
    frame->flags = input[1];
    frame->ssrc = get_u32(input + 4U);
    frame->timestamp_ms = get_u32(input + 8U);
    frame->sequence = sequence;
    frame->payload = input + VT_MQTT_UDP_HEADER_SIZE;
    frame->payload_len = payload_len;
    return VT_MQTT_UDP_OK;
}
