#pragma once

#include <stddef.h>
#include <stdint.h>

#define VT_MQTT_UDP_HEADER_SIZE 16U
#define VT_MQTT_UDP_PACKET_TYPE 0x01U
#define VT_MQTT_UDP_MAX_PAYLOAD_BYTES 1400U

typedef struct {
    uint8_t flags;
    uint32_t ssrc;
    uint32_t timestamp_ms;
    uint32_t sequence;
    const uint8_t *payload;
    uint16_t payload_len;
} vt_mqtt_udp_frame_t;

typedef enum {
    VT_MQTT_UDP_OK = 0,
    VT_MQTT_UDP_ERR_ARGUMENT = -1,
    VT_MQTT_UDP_ERR_SHORT = -2,
    VT_MQTT_UDP_ERR_HEADER = -3,
    VT_MQTT_UDP_ERR_LENGTH = -4,
    VT_MQTT_UDP_ERR_PAYLOAD = -5,
    VT_MQTT_UDP_ERR_SEQUENCE = -6,
} vt_mqtt_udp_result_t;

vt_mqtt_udp_result_t vt_mqtt_udp_encode(
    const vt_mqtt_udp_frame_t *frame,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length);

vt_mqtt_udp_result_t vt_mqtt_udp_decode(
    const uint8_t *input,
    size_t input_length,
    vt_mqtt_udp_frame_t *frame);
