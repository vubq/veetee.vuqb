#include "veetee_mqtt_udp_crypto.h"

#include <string.h>

#if defined(ESP_PLATFORM)
#include "psa/crypto.h"
#else
#include <openssl/evp.h>
#endif

static void wipe_bytes(uint8_t *bytes, size_t length) {
    if (bytes == NULL) return;
    volatile uint8_t *cursor = bytes;
    while (length-- > 0U) *cursor++ = 0U;
}

static vt_mqtt_udp_crypto_result_t crypt_payload(
    const uint8_t *key,
    const uint8_t *iv,
    const uint8_t *input,
    size_t input_length,
    uint8_t *output) {
    if (key == NULL || iv == NULL || input == NULL || output == NULL) {
        return VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT;
    }
#if defined(ESP_PLATFORM)
    psa_status_t status = psa_crypto_init();
    if (status != PSA_SUCCESS) return VT_MQTT_UDP_CRYPTO_ERR_CRYPTO;
    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attributes, PSA_KEY_TYPE_AES);
    psa_set_key_bits(&attributes, 128U);
    psa_set_key_usage_flags(&attributes, PSA_KEY_USAGE_ENCRYPT);
    psa_set_key_algorithm(&attributes, PSA_ALG_CTR);
    mbedtls_svc_key_id_t key_id = MBEDTLS_SVC_KEY_ID_INIT;
    status = psa_import_key(&attributes, key, VT_MQTT_UDP_KEY_BYTES, &key_id);
    psa_reset_key_attributes(&attributes);
    if (status != PSA_SUCCESS) return VT_MQTT_UDP_CRYPTO_ERR_CRYPTO;

    psa_cipher_operation_t operation = PSA_CIPHER_OPERATION_INIT;
    size_t written = 0U;
    size_t finished = 0U;
    uint8_t tail[VT_MQTT_UDP_NONCE_BYTES] = {0};
    status = psa_cipher_encrypt_setup(&operation, key_id, PSA_ALG_CTR);
    if (status == PSA_SUCCESS) status = psa_cipher_set_iv(&operation, iv, VT_MQTT_UDP_NONCE_BYTES);
    if (status == PSA_SUCCESS) status = psa_cipher_update(&operation, input, input_length,
                                                           output, input_length, &written);
    if (status == PSA_SUCCESS) status = psa_cipher_finish(&operation, tail, sizeof(tail), &finished);
    (void)psa_cipher_abort(&operation);
    (void)psa_destroy_key(key_id);
    wipe_bytes(tail, sizeof(tail));
    return status == PSA_SUCCESS && finished == 0U && written == input_length
               ? VT_MQTT_UDP_CRYPTO_OK
               : VT_MQTT_UDP_CRYPTO_ERR_CRYPTO;
#else
    EVP_CIPHER_CTX *context = EVP_CIPHER_CTX_new();
    if (context == NULL) return VT_MQTT_UDP_CRYPTO_ERR_CRYPTO;
    int written = 0;
    int final_written = 0;
    const int initialized = EVP_EncryptInit_ex(context, EVP_aes_128_ctr(), NULL, key, iv);
    const int updated = initialized == 1
                            ? EVP_EncryptUpdate(context, output, &written, input, (int)input_length)
                            : 0;
    const int finalized = updated == 1 ? EVP_EncryptFinal_ex(context, output + written, &final_written) : 0;
    EVP_CIPHER_CTX_free(context);
    return initialized == 1 && updated == 1 && finalized == 1 &&
                   written >= 0 && final_written >= 0 &&
                   (size_t)(written + final_written) == input_length
               ? VT_MQTT_UDP_CRYPTO_OK
               : VT_MQTT_UDP_CRYPTO_ERR_CRYPTO;
#endif
}

static vt_mqtt_udp_crypto_result_t map_wire_error(vt_mqtt_udp_result_t result) {
    return result == VT_MQTT_UDP_ERR_SEQUENCE
               ? VT_MQTT_UDP_CRYPTO_ERR_SEQUENCE
               : result == VT_MQTT_UDP_ERR_PAYLOAD
                     ? VT_MQTT_UDP_CRYPTO_ERR_FRAME
                     : VT_MQTT_UDP_CRYPTO_ERR_FRAME;
}

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_init(
    vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *key,
    size_t key_length,
    const uint8_t *nonce,
    size_t nonce_length) {
    if (crypto == NULL || key == NULL || nonce == NULL) {
        return VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT;
    }
    if (key_length != VT_MQTT_UDP_KEY_BYTES) return VT_MQTT_UDP_CRYPTO_ERR_KEY;
    if (nonce_length != VT_MQTT_UDP_NONCE_BYTES || nonce[0] != VT_MQTT_UDP_PACKET_TYPE) {
        return VT_MQTT_UDP_CRYPTO_ERR_NONCE;
    }
    vt_mqtt_udp_crypto_reset(crypto);
    memcpy(crypto->key, key, VT_MQTT_UDP_KEY_BYTES);
    memcpy(crypto->nonce, nonce, VT_MQTT_UDP_NONCE_BYTES);
    crypto->ready = true;
    return VT_MQTT_UDP_CRYPTO_OK;
}

void vt_mqtt_udp_crypto_reset(vt_mqtt_udp_crypto_t *crypto) {
    if (crypto == NULL) return;
    wipe_bytes(crypto->key, sizeof(crypto->key));
    wipe_bytes(crypto->nonce, sizeof(crypto->nonce));
    crypto->send_sequence = 0U;
    crypto->ready = false;
}

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_encrypt(
    vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *opus,
    size_t opus_length,
    uint32_t timestamp_ms,
    uint32_t ssrc,
    uint8_t *output,
    size_t output_capacity,
    size_t *output_length) {
    if (crypto == NULL || opus == NULL || output == NULL || output_length == NULL) {
        return VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT;
    }
    if (!crypto->ready) return VT_MQTT_UDP_CRYPTO_ERR_STATE;
    if (opus_length == 0U || opus_length > VT_MQTT_UDP_MAX_PAYLOAD_BYTES) {
        return VT_MQTT_UDP_CRYPTO_ERR_FRAME;
    }
    if (crypto->send_sequence >= UINT32_MAX) return VT_MQTT_UDP_CRYPTO_ERR_SEQUENCE;
    const size_t frame_capacity = VT_MQTT_UDP_HEADER_SIZE + opus_length;
    if (output_capacity < frame_capacity) return VT_MQTT_UDP_CRYPTO_ERR_CAPACITY;

    const vt_mqtt_udp_frame_t frame = {
        .flags = crypto->nonce[1],
        .ssrc = ssrc,
        .timestamp_ms = timestamp_ms,
        .sequence = crypto->send_sequence + 1U,
        .payload = opus,
        .payload_len = (uint16_t)opus_length,
    };
    size_t encoded_length = 0U;
    const vt_mqtt_udp_result_t wire_result = vt_mqtt_udp_encode(
        &frame, output, output_capacity, &encoded_length);
    if (wire_result != VT_MQTT_UDP_OK) return map_wire_error(wire_result);
    const vt_mqtt_udp_crypto_result_t crypt_result = crypt_payload(
        crypto->key, output, output + VT_MQTT_UDP_HEADER_SIZE,
        opus_length, output + VT_MQTT_UDP_HEADER_SIZE);
    if (crypt_result != VT_MQTT_UDP_CRYPTO_OK) return crypt_result;
    crypto->send_sequence = frame.sequence;
    *output_length = encoded_length;
    return VT_MQTT_UDP_CRYPTO_OK;
}

vt_mqtt_udp_crypto_result_t vt_mqtt_udp_crypto_decrypt(
    const vt_mqtt_udp_crypto_t *crypto,
    const uint8_t *input,
    size_t input_length,
    uint8_t *opus_output,
    size_t opus_capacity,
    vt_mqtt_udp_frame_t *frame) {
    if (crypto == NULL || input == NULL || opus_output == NULL || frame == NULL) {
        return VT_MQTT_UDP_CRYPTO_ERR_ARGUMENT;
    }
    if (!crypto->ready) return VT_MQTT_UDP_CRYPTO_ERR_STATE;
    vt_mqtt_udp_frame_t wire_frame = {0};
    const vt_mqtt_udp_result_t wire_result = vt_mqtt_udp_decode(input, input_length, &wire_frame);
    if (wire_result != VT_MQTT_UDP_OK) return map_wire_error(wire_result);
    if (wire_frame.flags != crypto->nonce[1]) return VT_MQTT_UDP_CRYPTO_ERR_FRAME;
    if (opus_capacity < wire_frame.payload_len) return VT_MQTT_UDP_CRYPTO_ERR_CAPACITY;
    const vt_mqtt_udp_crypto_result_t crypt_result = crypt_payload(
        crypto->key, input, wire_frame.payload, wire_frame.payload_len, opus_output);
    if (crypt_result != VT_MQTT_UDP_CRYPTO_OK) return crypt_result;
    *frame = wire_frame;
    frame->payload = opus_output;
    return VT_MQTT_UDP_CRYPTO_OK;
}
