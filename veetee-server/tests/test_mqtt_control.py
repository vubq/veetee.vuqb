import json
from pathlib import Path

import pytest

from veetee_server.mqtt_control import (
    MQTT_CONTROL_MAX_PAYLOAD_BYTES,
    MqttControlChannel,
    MqttProtocolError,
    decode_control_payload,
    encode_control_payload,
    parse_mqtt_client_hello,
    parse_mqtt_server_hello,
    parse_mqtt_session_config,
)


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mqtt_control_v3.json"


def _fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_mqtt_config_and_control_payload_match_golden_fixture():
    fixture = _fixture()
    config = parse_mqtt_session_config(fixture["config"])
    assert config.endpoint == "broker.test"
    assert config.port == 8883
    assert config.redacted()["has_password"] is False

    message = {
        "type": "tts",
        "state": "start",
        "session_id": "session-1",
        "audio_stream_id": 42,
        "start_sequence": 1201,
    }
    assert encode_control_payload(message).hex() == fixture["tts_start_payload_hex"]
    assert decode_control_payload(encode_control_payload(message)) == message


def test_mqtt_hello_parsers_validate_client_and_server_shapes():
    fixture = _fixture()
    client = parse_mqtt_client_hello(fixture["client_hello"])
    assert client.version == 3
    assert client.transport == "udp"
    assert client.audio_params["sample_rate"] == 16000
    server = parse_mqtt_server_hello(fixture["server_hello"])
    assert server.session_id == "session-1"
    assert server.sample_rate == 24000


def test_mqtt_legacy_client_hello_may_omit_version_but_not_transport():
    hello = {"type": "hello", "transport": "udp"}
    assert parse_mqtt_client_hello(hello).version is None
    hello["transport"] = "websocket"
    with pytest.raises(MqttProtocolError, match="udp"):
        parse_mqtt_client_hello(hello)


def test_mqtt_channel_publishes_opaque_topic_with_configured_qos():
    config = parse_mqtt_session_config(
        {
            "endpoint": "broker.test",
            "client_id": "device",
            "publish_topic": "opaque/up",
            "subscribe_topic": "opaque/down",
        }
    )
    channel = MqttControlChannel(config, "session-1")
    publication = channel.publish({"type": "ping"})
    assert publication.topic == "opaque/up"
    assert publication.qos == 1
    assert publication.retain is False
    assert decode_control_payload(publication.payload) == {"type": "ping"}


def test_mqtt_channel_requires_exact_topic_and_session():
    config = parse_mqtt_session_config(
        {
            "endpoint": "broker.test",
            "client_id": "device",
            "publish_topic": "opaque/up",
            "subscribe_topic": "opaque/down",
        }
    )
    channel = MqttControlChannel(config, "session-1")
    payload = encode_control_payload({"type": "tts", "state": "stop", "session_id": "session-1"})
    assert channel.receive("opaque/down", payload)["type"] == "tts"
    with pytest.raises(MqttProtocolError, match="unexpected topic"):
        channel.receive("other/topic", payload)
    with pytest.raises(MqttProtocolError, match="session_id"):
        channel.receive(
            "opaque/down",
            encode_control_payload({"type": "tts", "state": "stop", "session_id": "old-session"}),
        )
    with pytest.raises(MqttProtocolError, match="session_id"):
        channel.publish({"type": "abort", "session_id": "old-session"})


def test_mqtt_channel_validates_server_hello_before_returning_it():
    fixture = _fixture()
    config = parse_mqtt_session_config(fixture["config"])
    channel = MqttControlChannel(config, "session-1")
    payload = encode_control_payload(fixture["server_hello"])
    assert channel.receive(config.subscribe_topic, payload)["transport"] == "udp"
    invalid = dict(fixture["server_hello"])
    invalid["transport"] = "websocket"
    with pytest.raises(MqttProtocolError, match="server hello"):
        channel.receive(config.subscribe_topic, encode_control_payload(invalid))


def test_mqtt_unknown_downstream_message_is_ignored_after_decode():
    config = parse_mqtt_session_config(
        {
            "endpoint": "broker.test",
            "client_id": "device",
            "publish_topic": "opaque/up",
            "subscribe_topic": "opaque/down",
        }
    )
    channel = MqttControlChannel(config, "session-1")
    payload = encode_control_payload({"type": "future_extension", "session_id": "session-1", "value": 1})
    assert channel.receive("opaque/down", payload) is None


@pytest.mark.parametrize(
    "config, match",
    [
        ({"endpoint": "mqtt://broker.test", "client_id": "d", "publish_topic": "u", "subscribe_topic": "s"}, "host"),
        ({"endpoint": "broker.test:0", "client_id": "d", "publish_topic": "u", "subscribe_topic": "s"}, "outside"),
        ({"endpoint": "broker.test", "client_id": "d", "publish_topic": "u/+", "subscribe_topic": "s"}, "opaque"),
        ({"endpoint": "broker.test", "client_id": "d", "publish_topic": "u", "subscribe_topic": "s", "retain": True}, "retained"),
        ({"endpoint": "broker.test", "client_id": "d", "publish_topic": "u", "subscribe_topic": "s", "control_qos": 2}, "0 or 1"),
    ],
)
def test_mqtt_config_rejects_unsafe_transport_settings(config, match):
    with pytest.raises(MqttProtocolError, match=match):
        parse_mqtt_session_config(config)


def test_mqtt_payload_is_bounded_before_json_decode_and_preserves_unicode():
    message = {"type": "alert", "message": "Đang xử lý…", "session_id": "session-1"}
    payload = encode_control_payload(message)
    assert decode_control_payload(payload) == message
    with pytest.raises(MqttProtocolError, match="8192"):
        decode_control_payload(b" " * (MQTT_CONTROL_MAX_PAYLOAD_BYTES + 1))
    with pytest.raises(MqttProtocolError, match="8192"):
        encode_control_payload({"type": "custom", "payload": "x" * MQTT_CONTROL_MAX_PAYLOAD_BYTES})


@pytest.mark.parametrize(
    "payload, match",
    [
        (b"[]", "one JSON object"),
        (b'{"type":"ping"}{"type":"pong"}', "valid UTF-8 JSON"),
        (b'{"type":NaN}', "valid UTF-8 JSON"),
        (b'{"type":"ping",}', "valid UTF-8 JSON"),
        (b"\xff", "valid UTF-8 JSON"),
    ],
)
def test_mqtt_decode_rejects_non_object_or_malformed_payload(payload, match):
    with pytest.raises(MqttProtocolError, match=match):
        decode_control_payload(payload)


def test_mqtt_json_safe_integer_and_non_json_values_are_rejected():
    with pytest.raises(MqttProtocolError, match="safe receiver range"):
        encode_control_payload({"type": "custom", "value": 1 << 53})
    with pytest.raises(MqttProtocolError, match="finite"):
        encode_control_payload({"type": "custom", "value": float("inf")})


def test_mqtt_credentials_are_not_present_in_repr_or_redacted_view():
    config = parse_mqtt_session_config(
        {
            "endpoint": "broker.test",
            "client_id": "device",
            "username": "user-secret",
            "password": "password-secret",
            "publish_topic": "opaque/up",
            "subscribe_topic": "opaque/down",
        }
    )
    assert "password-secret" not in repr(config)
    assert "user-secret" not in repr(config)
    assert "password-secret" not in repr(config.redacted())
    assert config.redacted()["has_password"] is True
