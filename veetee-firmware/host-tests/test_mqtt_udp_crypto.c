#include "veetee_mqtt_udp_crypto.h"

#include <assert.h>
#include <stdint.h>
#include <string.h>

static void test_golden_vector(void) {
    const uint8_t key[VT_MQTT_UDP_KEY_BYTES] = {
        0x00U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U, 0x66U, 0x77U,
        0x88U, 0x99U, 0xAAU, 0xBBU, 0xCCU, 0xDDU, 0xEEU, 0xFFU,
    };
    const uint8_t nonce[VT_MQTT_UDP_NONCE_BYTES] = {
        0x01U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U,
        0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U,
    };
    const uint8_t opus[] = {0x00U, 0x11U, 0x22U, 0x33U, 0x44U, 0x55U};
    const uint8_t expected[] = {
        0x01U, 0x00U, 0x00U, 0x06U, 0x00U, 0x00U, 0x00U, 0x00U,
        0x00U, 0x00U, 0x04U, 0xD2U, 0x00U, 0x00U, 0x00U, 0x01U,
        0x76U, 0x0BU, 0x5AU, 0xE6U, 0x66U, 0x90U,
    };
    vt_mqtt_udp_crypto_t crypto = {0};
    assert(vt_mqtt_udp_crypto_init(&crypto, key, sizeof(key), nonce, sizeof(nonce)) == VT_MQTT_UDP_CRYPTO_OK);

    uint8_t wire[sizeof(expected)] = {0};
    size_t wire_length = 0U;
    assert(vt_mqtt_udp_crypto_encrypt(&crypto, opus, sizeof(opus), 1234U, 0U,
                                      wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_CRYPTO_OK);
    assert(wire_length == sizeof(expected));
    assert(memcmp(wire, expected, sizeof(expected)) == 0);
    assert(crypto.send_sequence == 1U);

    uint8_t decoded_opus[sizeof(opus)] = {0};
    vt_mqtt_udp_frame_t frame = {0};
    assert(vt_mqtt_udp_crypto_decrypt(&crypto, wire, wire_length, decoded_opus,
                                      sizeof(decoded_opus), &frame) == VT_MQTT_UDP_CRYPTO_OK);
    assert(frame.flags == 0U);
    assert(frame.ssrc == 0U);
    assert(frame.timestamp_ms == 1234U);
    assert(frame.sequence == 1U);
    assert(frame.payload_len == sizeof(opus));
    assert(frame.payload == decoded_opus);
    assert(memcmp(decoded_opus, opus, sizeof(opus)) == 0);
}

static void test_resource_and_frame_guards(void) {
    const uint8_t key[VT_MQTT_UDP_KEY_BYTES] = {0};
    uint8_t nonce[VT_MQTT_UDP_NONCE_BYTES] = {0};
    nonce[0] = VT_MQTT_UDP_PACKET_TYPE;
    const uint8_t opus[] = {0x7FU};
    vt_mqtt_udp_crypto_t crypto = {0};
    assert(vt_mqtt_udp_crypto_init(&crypto, key, sizeof(key) - 1U, nonce, sizeof(nonce)) == VT_MQTT_UDP_CRYPTO_ERR_KEY);
    assert(vt_mqtt_udp_crypto_init(&crypto, key, sizeof(key), nonce, sizeof(nonce) - 1U) == VT_MQTT_UDP_CRYPTO_ERR_NONCE);
    assert(vt_mqtt_udp_crypto_encrypt(&crypto, opus, sizeof(opus), 0U, 1U,
                                      nonce, sizeof(nonce), NULL) == VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT);
    assert(vt_mqtt_udp_crypto_init(&crypto, key, sizeof(key), nonce, sizeof(nonce)) == VT_MQTT_UDP_CRYPTO_OK);

    uint8_t wire[VT_MQTT_UDP_HEADER_SIZE + sizeof(opus)] = {0};
    size_t wire_length = 0U;
    assert(vt_mqtt_udp_crypto_encrypt(&crypto, opus, sizeof(opus), 0U, 1U,
                                      wire, sizeof(wire) - 1U, &wire_length) == VT_MQTT_UDP_CRYPTO_ERR_CAPACITY);
    crypto.send_sequence = UINT32_MAX;
    assert(vt_mqtt_udp_crypto_encrypt(&crypto, opus, sizeof(opus), 0U, 1U,
                                      wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_CRYPTO_ERR_SEQUENCE);
    vt_mqtt_udp_crypto_reset(&crypto);
    assert(!crypto.ready);
    assert(vt_mqtt_udp_crypto_encrypt(&crypto, opus, sizeof(opus), 0U, 1U,
                                      wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_CRYPTO_ERR_STATE);
}

static void test_nonce_flags_are_bound_to_session(void) {
    const uint8_t key[VT_MQTT_UDP_KEY_BYTES] = {0};
    uint8_t nonce[VT_MQTT_UDP_NONCE_BYTES] = {0};
    nonce[0] = VT_MQTT_UDP_PACKET_TYPE;
    const uint8_t opus[] = {0x01U};
    vt_mqtt_udp_crypto_t sender = {0};
    vt_mqtt_udp_crypto_t receiver = {0};
    assert(vt_mqtt_udp_crypto_init(&sender, key, sizeof(key), nonce, sizeof(nonce)) == VT_MQTT_UDP_CRYPTO_OK);
    nonce[1] = 0x02U;
    assert(vt_mqtt_udp_crypto_init(&receiver, key, sizeof(key), nonce, sizeof(nonce)) == VT_MQTT_UDP_CRYPTO_OK);

    uint8_t wire[VT_MQTT_UDP_HEADER_SIZE + sizeof(opus)] = {0};
    size_t wire_length = 0U;
    assert(vt_mqtt_udp_crypto_encrypt(&sender, opus, sizeof(opus), 0U, 9U,
                                      wire, sizeof(wire), &wire_length) == VT_MQTT_UDP_CRYPTO_OK);
    uint8_t decoded[sizeof(opus)] = {0};
    vt_mqtt_udp_frame_t frame = {0};
    assert(vt_mqtt_udp_crypto_decrypt(&receiver, wire, wire_length, decoded,
                                      sizeof(decoded), &frame) == VT_MQTT_UDP_CRYPTO_ERR_FRAME);
}

int main(void) {
    test_golden_vector();
    test_resource_and_frame_guards();
    test_nonce_flags_are_bound_to_session();
    return 0;
}
