#include "veetee_config.h"
#include "veetee_protocol.h"
#include "veetee_state.h"
#include "veetee_wire_guard.h"

#include <assert.h>
#include <ctype.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>

#ifndef VT_WIRE_GOLDEN_FIXTURE_PATH
#define VT_WIRE_GOLDEN_FIXTURE_PATH "../../tests/fixtures/ws_audio_golden.csv"
#endif

static int hex_value(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static size_t decode_hex(const char *text, uint8_t *output, size_t capacity) {
    const size_t length = strlen(text);
    assert(length % 2U == 0U);
    assert(length / 2U <= capacity);
    for (size_t index = 0U; index < length / 2U; ++index) {
        const int high = hex_value(text[index * 2U]);
        const int low = hex_value(text[index * 2U + 1U]);
        assert(high >= 0 && low >= 0);
        output[index] = (uint8_t)((high << 4) | low);
    }
    return length / 2U;
}

static vt_protocol_profile_t profile_from_name(const char *name) {
    if (strcmp(name, "ws-v1-compat") == 0) return VT_PROFILE_WS_V1_COMPAT;
    if (strcmp(name, "ws-v2") == 0) return VT_PROFILE_WS_V2;
    if (strcmp(name, "ws-v3") == 0) return VT_PROFILE_WS_V3;
    assert(!"unknown protocol profile in golden fixture");
    return VT_PROFILE_WS_V3;
}

static char *next_field(char **cursor) {
    char *field = *cursor;
    char *separator = strchr(field, ',');
    if (separator != NULL) {
        *separator = '\0';
        *cursor = separator + 1;
    } else {
        *cursor = field + strlen(field);
    }
    return field;
}

static void trim_line(char *line) {
    const size_t length = strlen(line);
    if (length > 0U && line[length - 1U] == '\n') line[length - 1U] = '\0';
    const size_t trimmed = strlen(line);
    if (trimmed > 0U && line[trimmed - 1U] == '\r') line[trimmed - 1U] = '\0';
}

static void test_protocol(void) {
    FILE *fixture = fopen(VT_WIRE_GOLDEN_FIXTURE_PATH, "r");
    assert(fixture != NULL);
    char line[4096];
    assert(fgets(line, sizeof(line), fixture) != NULL);
    size_t row_count = 0U;
    while (fgets(line, sizeof(line), fixture) != NULL) {
        trim_line(line);
        if (line[0] == '\0' || line[0] == '#') continue;
        char *cursor = line;
        char *profile_name = next_field(&cursor);
        char *timestamp_text = next_field(&cursor);
        char *payload_text = next_field(&cursor);
        char *wire_text = next_field(&cursor);
        assert(*cursor == '\0');
        errno = 0;
        char *end = NULL;
        const unsigned long timestamp_value = strtoul(timestamp_text, &end, 10);
        assert(errno == 0 && end != timestamp_text && *end == '\0');
        uint8_t payload[VT_MAX_OPUS_PAYLOAD_BYTES];
        uint8_t expected[VT_MAX_OPUS_PAYLOAD_BYTES + 16U];
        const size_t payload_length = decode_hex(payload_text, payload, sizeof(payload));
        const size_t expected_length = decode_hex(wire_text, expected, sizeof(expected));
        const vt_protocol_profile_t profile = profile_from_name(profile_name);
        const uint32_t timestamp = (uint32_t)timestamp_value;
        uint8_t encoded[VT_MAX_OPUS_PAYLOAD_BYTES + 16U];
        size_t encoded_len = 0U;
        vt_audio_frame_t decoded = {0};
        vt_audio_frame_t frame = {
            .profile = profile,
            .payload = payload,
            .payload_len = (uint16_t)payload_length,
            .timestamp_ms = timestamp,
        };
        assert(vt_protocol_encode_audio(&frame, encoded, sizeof(encoded), &encoded_len) == VT_PROTOCOL_OK);
        assert(encoded_len == expected_length);
        assert(memcmp(encoded, expected, expected_length) == 0);
        assert(vt_protocol_decode_audio(profile, encoded, encoded_len, &decoded) == VT_PROTOCOL_OK);
        assert(decoded.payload_len == payload_length);
        assert(decoded.timestamp_ms == frame.timestamp_ms);
        ++row_count;
    }
    assert(fclose(fixture) == 0);
    assert(row_count == 3U);
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

static void test_mode_aware_graceful_tts_stop(void) {
    vt_device_state_machine_t machine = {.state = VT_DEVICE_IDLE, .generation = 0U};
    assert(vt_state_apply(&machine, VT_EVENT_CONNECT));
    assert(vt_state_apply(&machine, VT_EVENT_HELLO_READY));
    assert(vt_state_apply(&machine, VT_EVENT_LISTEN_STOP));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_STOP_MANUAL));
    assert(machine.state == VT_DEVICE_IDLE);

    /* A connected manual device can start repeated subsequent turns from idle. */
    for (unsigned int turn = 0U; turn < 30U; ++turn) {
        assert(vt_state_apply(&machine, VT_EVENT_LISTEN_START));
        assert(machine.state == VT_DEVICE_LISTENING);
        assert(vt_state_apply(&machine, VT_EVENT_LISTEN_STOP));
        assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
        assert(vt_state_apply(&machine, VT_EVENT_TTS_STOP_MANUAL));
        assert(machine.state == VT_DEVICE_IDLE);
    }

    assert(vt_state_apply(&machine, VT_EVENT_LISTEN_START));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_STOP_AUTO));
    assert(machine.state == VT_DEVICE_LISTENING);

    /* The legacy generic event keeps the existing compatibility behavior. */
    assert(vt_state_apply(&machine, VT_EVENT_TTS_START));
    assert(vt_state_apply(&machine, VT_EVENT_TTS_STOP));
    assert(machine.state == VT_DEVICE_LISTENING);
    assert(machine.generation == 0U);
}

static void test_config_gate(void) {
    vt_runtime_config_t config = {.profile_id = "board.example", .endpoint = "wss://configured", .device_id = "device", .client_id = "client", .protocol_version = 3, .uplink_sample_rate = 16000, .downlink_sample_rate = 24000, .frame_duration_ms = 60, .verified_hardware = false};
    assert(!vt_config_is_flash_safe(&config));
    config.verified_hardware = true;
    assert(vt_config_is_flash_safe(&config));
}

static void test_wire_session_guard(void) {
    assert(vt_wire_session_matches("session-a", false, NULL));
    assert(vt_wire_session_matches("session-a", true, "session-a"));
    assert(!vt_wire_session_matches("session-a", true, "session-b"));
    assert(!vt_wire_session_matches("session-a", true, ""));
    assert(!vt_wire_session_matches(NULL, true, "session-a"));
}

int main(void) {
    test_protocol();
    test_protocol_rejections();
    test_state();
    test_abort_from_thinking();
    test_interruptible_states();
    test_mode_aware_graceful_tts_stop();
    test_config_gate();
    test_wire_session_guard();
    puts("firmware host tests passed");
    return 0;
}
