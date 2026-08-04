import json
from pathlib import Path

import pytest

from veetee_server.mqtt_control import (
    MqttProtocolError,
    decode_control_payload,
    encode_control_payload,
    parse_mqtt_session_config,
)
from veetee_server.mqtt_session import MqttUdpSession, MqttUdpState
from veetee_server.mqtt_udp import UdpCryptoSession


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mqtt_control_v3.json"


def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _config():
    return parse_mqtt_session_config(_fixture()["config"])


def _hello():
    return _fixture()["server_hello"]


def _control(session_id, stream_id, state, sequence):
    return {
        "type": "tts",
        "state": state,
        "session_id": session_id,
        "audio_stream_id": stream_id,
        ("start_sequence" if state == "start" else "end_sequence"): sequence,
    }


def test_session_requires_explicit_v3_client_hello_and_builds_publish():
    session = MqttUdpSession(_config())
    hello = dict(_fixture()["client_hello"])
    publication = session.build_client_hello(hello)
    assert publication.topic == "upstream/opaque-7"
    assert session.state == MqttUdpState.HELLO_SENT
    assert decode_control_payload(publication.payload) == hello
    with pytest.raises(MqttProtocolError, match="only valid"):
        session.build_client_hello(hello)

    legacy = MqttUdpSession(_config())
    legacy_hello = dict(hello)
    legacy_hello.pop("version")
    with pytest.raises(MqttProtocolError, match="explicit version 3"):
        legacy.build_client_hello(legacy_hello)


def test_session_handshake_imports_key_and_routes_server_hello():
    session = MqttUdpSession(_config())
    session.build_client_hello(_fixture()["client_hello"])
    event = session.receive_control("downstream/opaque-7", encode_control_payload(_hello()))
    assert event.message["type"] == "hello"
    assert event.state == MqttUdpState.READY
    assert session.session_id == "session-1"


def test_session_composes_tts_barrier_with_encrypted_udp_datagram():
    session = MqttUdpSession(_config())
    session.accept_server_hello(_hello())
    start = session.receive_control(
        "downstream/opaque-7",
        encode_control_payload(_control("session-1", 42, "start", 1)),
        now=0,
    )
    assert start.stream_result.state == "ACTIVE"

    hello = _hello()
    crypto = UdpCryptoSession(bytes.fromhex(hello["udp"]["key"]), bytes.fromhex(hello["udp"]["nonce"]))
    result = session.receive_downlink_udp(crypto.encrypt(b"opus", timestamp_ms=60, ssrc=42), now=0.01)
    assert [packet.sequence for packet in result.released] == [1]

    stop = session.receive_control(
        "downstream/opaque-7",
        encode_control_payload(_control("session-1", 42, "stop", 1)),
        now=0.02,
    )
    assert stop.stream_result.completed is True
    assert session.state == MqttUdpState.READY


def test_session_abort_and_goodbye_clear_generation_state():
    session = MqttUdpSession(_config())
    session.accept_server_hello(_hello())
    session.receive_control("downstream/opaque-7", encode_control_payload(_control("session-1", 42, "start", 1)))
    abort = session.abort(reason="user_interrupt")
    assert decode_control_payload(abort.payload)["reason"] == "user_interrupt"
    assert session.barrier.state == "IDLE"
    assert session.state == MqttUdpState.READY

    goodbye = session.build_goodbye()
    assert decode_control_payload(goodbye.payload)["type"] == "goodbye"
    assert session.state == MqttUdpState.CLOSED
    assert session.session_id is None
    with pytest.raises(MqttProtocolError, match="READY"):
        session.tick()


def test_session_rejects_wrong_topic_or_non_hello_before_ready():
    session = MqttUdpSession(_config())
    session.build_client_hello(_fixture()["client_hello"])
    with pytest.raises(MqttProtocolError, match="unexpected topic"):
        session.receive_control("wrong/topic", encode_control_payload(_hello()))
    with pytest.raises(MqttProtocolError, match="only server hello"):
        session.receive_control("downstream/opaque-7", encode_control_payload({"type": "ping"}))
