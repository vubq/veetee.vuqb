#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "veetee_mqtt_udp_wire.h"

#define VT_MQTT_UDP_KEY_BYTES 16U
#define VT_MQTT_UDP_NONCE_BYTES 16U

typedef enum {
    VT_MQTT_UDP_CRYPTO_OK = 0,
    VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT = -1,
    VT_MQTT_UDP_CRYPTO_ERR_KEY = -2,
    VT_MQTT_UDP_CRYPTO_ERR_NONCE = -3,
    VT_MQTT_UDP_CRYPTO_ERR_STATE = -4,
    VT_MQTT_UDP_CRYPTO_ERR_SEQUENCE = -5,
    VT_MQTT_UDP_CRYPTO_ERR_CAPACITY = -6,
    VT_MQTT_UDP_CRYPTO_ERR_FRAME = -7,
    VT_MQTT_UDP_CRYPTO_ERR_CRYPTO = -8,
} vt_mqtt_udp_crypto_result_t;

/* Per-MQTT-session material.  The caller owns this object and must reset it
 * before releasing the session; no key/nonce is persisted by this module. */
typedef struct {
    uint8_t key[VT_MQTT_UDP_KEY_BYTES];
    uint8_t nonce[VT_MQTT_UDP_NONCE_BYTES];
    uint32_t send_sequence;
    bool ready;
} vt_mqtt_udp_crypto_t;

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_init(
    vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *key,
    size_t key_length,
    const uint8_t *nonce,
    size_t nonce_length);

void vt_mqtt_udp_crypto_reset(vt_mqtt_udp_crypto_t *crypto);

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_encrypt(
    vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *opus,
    size_t opus_length,
    uint32_t timestamp_ms,
    uint32_t ssrc,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length);

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_decrypt(
    const vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *input,
    size_t input_length,
    uint8_t *opus_output,
    size_t opus_capacity,
    vt_mqtt_udp_frame_t *frame);
