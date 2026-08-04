#include "veetee_mqtt_udp_wire.h"

#include <assert.h>
#include <stdint.h>
#include <string.h>

static void test_golden_round_trip(void) {
    const uint8_t payload[] = {0x00U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U};
    const uint8_t expected[] = {
        0x01U, 0x00U, 0x00U, 0x06U, 0x00U, 0x00U, 0x00U, 0x00U,
        0x00U, 0x00U, 0x04U, 0xD2U, 0x00U, 0x00U, 0x00U, 0x01U,
        0x00U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U,
    };
    const vt_mqtt_udp_frame_t input = {
        .flags = 0U,
        .ssrc = 0U,
        .timestamp_ms = 1234U,
        .sequence = 1U,
        .payload = payload,
        .payload_len = (uint16_t)sizeof(payload),
    };
    uint8_t wire[sizeof(expected)] = {0};
    size_t wire_length = 0U;
    assert(vt_mqtt_udp_encode(&input, wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_OK);
    assert(wire_length == sizeof(expected));
    assert(memcmp(wire, expected, sizeof(expected)) == 0);

    vt_mqtt_udp_frame_t decoded = {0};
    assert(vt_mqtt_udp_decode(wire, wire_length, &decoded) == VT_MQTT_UDP_OK);
    assert(decoded.flags == input.flags);
    assert(decoded.ssrc == input.ssrc);
    assert(decoded.timestamp_ms == input.timestamp_ms);
    assert(decoded.sequence == input.sequence);
    assert(decoded.payload_len == input.payload_len);
    assert(memcmp(decoded.payload, payload, sizeof(payload)) == 0);
}

static void test_rejections(void) {
    const uint8_t payload[] = {0x01U};
    const vt_mqtt_udp_frame_t input = {
        .flags = 0U,
        .ssrc = 42U,
        .timestamp_ms = 0U,
        .sequence = 1U,
        .payload = payload,
        .payload_len = 1U,
    };
    uint8_t wire[VT_MQTT_UDP_HEADER_SIZE + 1U] = {0};
    size_t wire_length = 0U;
    assert(vt_mqtt_udp_encode(&input, wire, sizeof(wire) - 1U, &wire_length) == VT_MQTT_UDP_ERR_ARGUMENT);
    vt_mqtt_udp_frame_t decoded = {0};
    assert(vt_mqtt_udp_decode(wire, VT_MQTT_UDP_HEADER_SIZE - 1U, &decoded) == VT_MQTT_UDP_ERR_SHORT);

    assert(vt_mqtt_udp_encode(&(vt_mqtt_udp_frame_t){
               .flags = 0U, .ssrc = 0U, .timestamp_ms = 0U, .sequence = 0U,
               .payload = payload, .payload_len = 1U,
           }, wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_ERR_SEQUENCE);

    assert(vt_mqtt_udp_encode(&(vt_mqtt_udp_frame_t){
               .flags = 0U, .ssrc = 0U, .timestamp_ms = 0U, .sequence = 1U,
               .payload = payload, .payload_len = 0U,
           }, wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_ERR_ARGUMENT);

    wire[0] = 2U;
    wire[2] = 0U;
    wire[3] = 1U;
    wire[12] = 0U;
    wire[13] = 0U;
    wire[14] = 0U;
    wire[15] = 1U;
    wire[16] = 0x01U;
    assert(vt_mqtt_udp_decode(wire, sizeof(wire), &decoded) == VT_MQTT_UDP_ERR_HEADER);
    wire[0] = VT_MQTT_UDP_PACKET_TYPE;
    wire[2] = 0U;
    wire[3] = 2U;
    assert(vt_mqtt_udp_decode(wire, sizeof(wire), &decoded) == VT_MQTT_UDP_ERR_LENGTH);
}

int main(void) {
    test_golden_round_trip();
    test_rejections();
    return 0;
}
