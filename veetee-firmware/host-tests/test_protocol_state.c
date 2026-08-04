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
    vt_audio_frame_t decoded = {0};
    const uint8_t expected_v1[] = {0xdeU, 0xadU, 0xbeU, 0xefU};
    const uint8_t expected_v2[] = {
        0x00U, 0x02U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U, 0x00U,
        0x01U, 0x02U, 0x03U, 0x04U, 0x00U, 0x00U, 0x00U, 0x04U,
        0xdeU, 0xadU, 0xbeU, 0xefU,
    };
    const uint8_t expected_v3[] = {0x00U, 0x00U, 0x00U, 0x04U, 0xdeU, 0xadU, 0xbeU, 0xefU};
    const vt_protocol_profile_t profiles[] = {VT_PROFILE_WS_V1_COMPAT, VT_PROFILE_WS_V2, VT_PROFILE_WS_V3};
    const uint8_t *expected[] = {expected_v1, expected_v2, expected_v3};
    const size_t expected_lengths[] = {sizeof(expected_v1), sizeof(expected_v2), sizeof(expected_v3)};
    for (size_t index = 0U; index < sizeof(profiles) / sizeof(profiles[0]); ++index) {
        vt_audio_frame_t frame = {
            .profile = profiles[index],
            .payload = payload,
            .payload_len = (uint16_t)sizeof(payload),
            .timestamp_ms = profiles[index] == VT_PROFILE_WS_V2 ? 0x01020304U : 0U,
        };
        assert(vt_protocol_encode_audio(&frame, encoded, sizeof(encoded), &encoded_len) == VT_PROTOCOL_OK);
        assert(encoded_len == expected_lengths[index]);
        assert(memcmp(encoded, expected[index], expected_lengths[index]) == 0);
        assert(vt_protocol_decode_audio(profiles[index], encoded, encoded_len, &decoded) == VT_PROTOCOL_OK);
        assert(decoded.payload_len == sizeof(payload));
        assert(decoded.timestamp_ms == frame.timestamp_ms);
    }
}

static void test_protocol_rejections(void) {
    uint8_t frame[VT_MAX_OPUS_PAYLOAD_BYTES + 5U] = {0};
    vt_audio_frame_t decoded = {0};
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V1_COMPAT, frame, 0U, &decoded) == VT_PROTOCOL_ERR_ARGUMENT);
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V2, frame, 15U, &decoded) == VT_PROTOCOL_ERR_SHORT);

    frame[0] = 0U;
    frame[1] = 2U;
    frame[2] = 0U;
    frame[3] = 1U;
    frame[15] = 1U;
    frame[16] = 0x7fU;
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V2, frame, 17U, &decoded) == VT_PROTOCOL_ERR_HEADER);

    memset(frame, 0, sizeof(frame));
    frame[0] = 0U;
    frame[1] = 2U;
    frame[12] = 0U;
    frame[15] = 2U;
    frame[16] = 0x7fU;
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V2, frame, 17U, &decoded) == VT_PROTOCOL_ERR_LENGTH);

    memset(frame, 0, sizeof(frame));
    frame[1] = 1U;
    frame[3] = 1U;
    frame[4] = 0x7fU;
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V3, frame, 5U, &decoded) == VT_PROTOCOL_ERR_HEADER);

    memset(frame, 0, sizeof(frame));
    const size_t oversized_payload = VT_MAX_OPUS_PAYLOAD_BYTES + 1U;
    frame[2] = (uint8_t)(oversized_payload >> 8U);
    frame[3] = (uint8_t)oversized_payload;
    assert(vt_protocol_decode_audio(VT_PROFILE_WS_V3, frame, sizeof(frame), &decoded) == VT_PROTOCOL_ERR_PAYLOAD);

    const uint8_t payload[] = {0x01U};
    vt_audio_frame_t input = {.profile = VT_PROFILE_WS_V3, .payload = payload, .payload_len = 1U, .timestamp_ms = 0U};
    size_t output_length = 0U;
    assert(vt_protocol_encode_audio(&input, frame, 4U, &output_length) == VT_PROTOCOL_ERR_ARGUMENT);
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

static void test_abort_from_thinking(void) {
    vt_device_state_machine_t machine = {.state = VT_DEVICE_IDLE, .generation = 0U};
    assert(vt_state_apply(&machine, VT_EVENT_CONNECT));
    assert(vt_state_apply(&machine, VT_EVENT_HELLO_READY));
    assert(vt_state_apply(&machine, VT_EVENT_LISTEN_START));
    assert(vt_state_apply(&machine, VT_EVENT_LISTEN_STOP));
    assert(machine.state == VT_DEVICE_THINKING);
    assert(vt_state_apply(&machine, VT_EVENT_ABORT));
    assert(machine.state == VT_DEVICE_LISTENING);
    assert(machine.generation == 1U);
}

static void test_interruptible_states(void) {
    assert(!vt_state_is_interruptible(VT_DEVICE_IDLE));
    assert(!vt_state_is_interruptible(VT_DEVICE_LISTENING));
    assert(vt_state_is_interruptible(VT_DEVICE_THINKING));
    assert(vt_state_is_interruptible(VT_DEVICE_SPEAKING));
}

static void test_repeated_manual_turns(void) {
    vt_device_state_machine_t machine = {.state = VT_DEVICE_IDLE, .generation = 0U};
    assert(vt_state_apply(&machine, VT_EVENT_CONNECT));
    assert(vt_state_apply(&machine, VT_EVENT_HELLO_READY));
    for (unsigned int turn = 0U; turn < 30U; ++turn) {
        assert(vt_state_apply(&machine, VT_EVENT_LISTEN_START));
        assert(vt_state_apply(&machine, VT_EVENT_LISTEN_STOP));
        assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
        assert(vt_state_apply(&machine, VT_EVENT_TTS_STOP));
        assert(machine.state == VT_DEVICE_LISTENING);
    }
    assert(machine.generation == 0U);
}

static void test_config_gate(void) {
    vt_runtime_config_t config = {.profile_id = "board.example", .endpoint = "wss://configured", .device_id = "device", .client_id = "client", .protocol_version = 3, .uplink_sample_rate = 16000, .downlink_sample_rate = 24000, .frame_duration_ms = 60, .verified_hardware = false};
    assert(!vt_config_is_flash_safe(&config));
    config.verified_hardware = true;
    assert(vt_config_is_flash_safe(&config));
}

int main(void) {
    test_protocol();
    test_protocol_rejections();
    test_state();
    test_abort_from_thinking();
    test_interruptible_states();
    test_repeated_manual_turns();
    test_config_gate();
    puts("firmware host tests passed");
    return 0;
}
