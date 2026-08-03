#include "veetee_config.h"
#include "veetee_protocol.h"
#include "veetee_state.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void test_protocol(void) {
    const uint8_t payload[] = {0xdeU, 0xadU, 0xbeU, 0xefU};
    uint8_t encoded[32];
    size_t encoded_len = 0U;
    vt_audio_frame_t frame = {.profile = VT_PROFILE_WS_V3, .payload = payload, .payload_len = 4U, .timestamp_ms = 0U};
    assert(vt_protocol_encode_audio(&frame, encoded, sizeof(encoded), &encoded_len) == VT_PROTOCOL_OK);
    const uint8_t expected[] = {0x00U, 0x00U, 0x00U, 0x04U, 0xdeU, 0xadU, 0xbeU, 0xefU};
    assert(encoded_len == sizeof(expected));
    assert(memcmp(encoded, expected, sizeof(expected)) == 0);
    vt_audio_frame_t decoded = {0};
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V3, encoded, encoded_len, &decoded) == VT_PROTOCOL_OK);
    assert(decoded.payload_len == sizeof(payload));
    encoded[3] = 3U;
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V3, encoded, encoded_len, &decoded) == VT_PROTOCOL_ERR_LENGTH);
}

static void test_state(void) {
    vt_device_state_machine_t machine = {.state = VT_DEVICE_IDLE, .generation = 0U};
    assert(vt_state_apply(&machine, VT_EVENT_CONNECT));
    assert(vt_state_apply(&machine, VT_EVENT_HELLO_READY));
    assert(vt_state_apply(&machine, VT_EVENT_LISTEN_STOP));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
    assert(vt_state_apply(&machine, VT_EVENT_ABORT));
    assert(machine.state == VT_DEVICE_LISTENING);
    assert(machine.generation == 1U);
}

static void test_config_gate(void) {
    vt_runtime_config_t config = {.profile_id = "board.example", .endpoint = "wss://configured", .device_id = "device", .client_id = "client", .protocol_version = 3, .uplink_sample_rate = 16000, .downlink_sample_rate = 24000, .frame_duration_ms = 60, .verified_hardware = false};
    assert(!vt_config_is_flash_safe(&config));
    config.verified_hardware = true;
    assert(vt_config_is_flash_safe(&config));
}

int main(void) {
    test_protocol();
    test_state();
    test_config_gate();
    puts("firmware host tests passed");
    return 0;
}
