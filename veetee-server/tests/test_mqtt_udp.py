import json
from pathlib import Path

import pytest

from veetee_server.mqtt_udp import (
    UdpAudioPacket,
    UdpCryptoSession,
    UdpProtocolError,
    UdpReorderBuffer,
    UdpTtsStreamBarrier,
    parse_udp_server_hello,
)


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mqtt_udp_v3.json"


def _hello() -> dict[str, object]:
    return {
        "type": "hello",
        "version": 3,
        "transport": "udp",
        "session_id": "01JZ9R4GJ5M7Y0H2F6V3P8QKCE",
        "audio_params": {"format": "opus", "sample_rate": 24000, "channels": 1, "frame_duration": 60},
        "udp": {
            "server": "192.168.1.10",
            "port": 8884,
            "key": "00112233445566778899aabbccddeeff",
            "nonce": "01000000000000000000000000000000",
        },
    }


def test_udp_golden_vector_round_trips_exact_wire():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    session = UdpCryptoSession(bytes.fromhex(fixture["key"]), bytes.fromhex(fixture["nonce"]))
    wire = session.encrypt(bytes.fromhex(fixture["opus_hex"]), timestamp_ms=fixture["timestamp_ms"], ssrc=fixture["ssrc"])
    assert wire.hex() == fixture["wire_hex"]

    packet = session.decrypt(wire)
    assert packet.sequence == fixture["sequence"]
    assert packet.timestamp_ms == fixture["timestamp_ms"]
    assert packet.ssrc == fixture["ssrc"]
    assert packet.opus.hex() == fixture["opus_hex"]


def test_udp_server_hello_validates_material_and_audio_params():
    hello = parse_udp_server_hello(_hello())
    assert hello.port == 8884
    assert hello.sample_rate == 24000
    assert hello.frame_duration_ms == 60
    legacy = dict(_hello())
    legacy.pop("version")
    assert parse_udp_server_hello(legacy).session_id == hello.session_id


def test_udp_hello_rejects_invalid_transport_marker():
    value = _hello()
    value["transport"] = "websocket"
    with pytest.raises(UdpProtocolError, match="udp transport"):
        parse_udp_server_hello(value)


def test_udp_crypto_rejects_length_and_payload_before_decrypt():
    udp = _hello()["udp"]
    assert isinstance(udp, dict)
    session = UdpCryptoSession(bytes.fromhex(udp["key"]), bytes.fromhex(udp["nonce"]))
    with pytest.raises(UdpProtocolError, match="shorter"):
        session.decrypt(b"\x01")
    with pytest.raises(UdpProtocolError, match="payload length"):
        session.decrypt(bytes.fromhex("01000000000000000000000000000001"))


def _packet(sequence: int) -> UdpAudioPacket:
    return UdpAudioPacket(flags=0, ssrc=0, timestamp_ms=sequence * 60, sequence=sequence, opus=bytes([sequence & 0xFF]))


def test_udp_reorder_releases_contiguous_packets_and_drops_duplicate():
    reorder = UdpReorderBuffer()
    assert reorder.push(_packet(2), now=0).released == ()
    result = reorder.push(_packet(1), now=0)
    assert [packet.sequence for packet in result.released] == [1, 2]
    assert reorder.push(_packet(1), now=0).released == ()
    assert reorder.duplicates == 1


def test_udp_reorder_marks_gap_lost_after_bounded_timeout():
    reorder = UdpReorderBuffer()
    assert reorder.push(_packet(3), now=0).lost_sequences == ()
    assert reorder.flush(now=0.119).lost_sequences == ()
    result = reorder.flush(now=0.120)
    assert result.lost_sequences == (1, 2)
    assert [packet.sequence for packet in result.released] == [3]
    assert reorder.remote_sequence == 3


def test_udp_reorder_window_overflow_advances_only_bounded_missing_sequences():
    reorder = UdpReorderBuffer()
    first = reorder.push(_packet(5), now=0)
    assert first.lost_sequences == (1,)
    assert reorder.pending_sequences == (5,)
    released = list(reorder.push(_packet(2), now=0).released)
    released.extend(reorder.push(_packet(3), now=0).released)
    released.extend(reorder.push(_packet(4), now=0).released)
    assert [packet.sequence for packet in released] == [2, 3, 4, 5]
    assert reorder.remote_sequence == 5


def test_udp_reorder_rejects_large_jump_and_resets_pending_state():
    reorder = UdpReorderBuffer()
    reorder.push(_packet(2), now=0)
    with pytest.raises(UdpProtocolError, match="jumped"):
        reorder.push(_packet(258), now=0)
    assert reorder.remote_sequence == 0
    assert reorder.pending_sequences == ()
    assert reorder.protocol_errors == 1


def test_udp_session_refuses_sequence_wrap():
    session = UdpCryptoSession(b"k" * 16, b"\x01" + b"\x00" * 15)
    session.send_sequence = 0xFFFFFFFF
    with pytest.raises(UdpProtocolError, match="wrap"):
        session.encrypt(b"x")


def _stream_packet(stream_id: int, sequence: int) -> UdpAudioPacket:
    return UdpAudioPacket(
        flags=0,
        ssrc=stream_id,
        timestamp_ms=sequence * 60,
        sequence=sequence,
        opus=bytes([sequence & 0xFF]),
    )


def _tts(session_id: str, stream_id: int, state: str, sequence: int) -> dict[str, object]:
    return {
        "type": "tts",
        "state": state,
        "session_id": session_id,
        "audio_stream_id": stream_id,
        ("start_sequence" if state == "start" else "end_sequence"): sequence,
    }


def test_udp_stream_barrier_buffers_before_start_and_releases_after_boundary():
    barrier = UdpTtsStreamBarrier("session")
    assert barrier.push(_stream_packet(42, 11), now=0).released == ()
    assert barrier.push(_stream_packet(42, 12), now=0).released == ()
    result = barrier.start(_tts("session", 42, "start", 11), now=0)
    assert [packet.sequence for packet in result.released] == [11, 12]
    assert barrier.state == barrier.ACTIVE


def test_udp_stream_barrier_rejects_invalid_stale_and_large_start():
    barrier = UdpTtsStreamBarrier("session")
    with pytest.raises(UdpProtocolError, match="nonzero"):
        barrier.start(_tts("session", 0, "start", 1), now=0)
    with pytest.raises(UdpProtocolError, match="beyond"):
        barrier.start(_tts("session", 42, "start", 258), now=0)

    barrier.push(_stream_packet(42, 1), now=0)
    with pytest.raises(UdpProtocolError, match="pending packets"):
        barrier.start(_tts("session", 43, "start", 1), now=0)

    barrier.start(_tts("session", 42, "start", 1), now=0)
    barrier.push(_stream_packet(42, 1), now=0)
    barrier.stop(_tts("session", 42, "stop", 1), now=0)
    with pytest.raises(UdpProtocolError, match="expired"):
        barrier.start(_tts("session", 42, "start", 1), now=0)


def test_udp_stream_barrier_prestart_overflow_invalidates_stream():
    barrier = UdpTtsStreamBarrier("session")
    for sequence in range(1, 9):
        barrier.push(_stream_packet(42, sequence), now=0)
    result = barrier.push(_stream_packet(42, 9), now=0)
    assert result.invalidated is True
    assert barrier.metrics.prestart_overflows == 1
    with pytest.raises(UdpProtocolError, match="expired"):
        barrier.start(_tts("session", 42, "start", 1), now=0)


def test_udp_stream_barrier_prestart_timeout_discards_pending_packets():
    barrier = UdpTtsStreamBarrier("session")
    barrier.push(_stream_packet(42, 1), now=0)
    result = barrier.tick(now=0.480)
    assert result.invalidated is True
    assert result.reason == "prestart_timeout"
    assert barrier.pending_prestart == {}
    with pytest.raises(UdpProtocolError, match="expired"):
        barrier.start(_tts("session", 42, "start", 1), now=0.480)


def test_udp_stream_barrier_stop_drains_exact_end_sequence():
    barrier = UdpTtsStreamBarrier("session")
    barrier.start(_tts("session", 42, "start", 1), now=0)
    assert [p.sequence for p in barrier.push(_stream_packet(42, 1), now=0).released] == [1]
    stop = barrier.stop(_tts("session", 42, "stop", 2), now=0)
    assert stop.state == barrier.DRAINING
    result = barrier.push(_stream_packet(42, 2), now=0.1)
    assert [p.sequence for p in result.released] == [2]
    assert result.completed is True
    assert barrier.state == barrier.COMPLETED
    assert barrier.push(_stream_packet(42, 3), now=0.1).dropped is True


def test_udp_stream_barrier_stop_timeout_flushes_and_aborts():
    barrier = UdpTtsStreamBarrier("session")
    barrier.start(_tts("session", 42, "start", 1), now=0)
    barrier.stop(_tts("session", 42, "stop", 2), now=0)
    result = barrier.tick(now=1.2)
    assert result.aborted is True
    assert result.timed_out is True
    assert result.reason == "stop_timeout"
    assert barrier.metrics.stop_timeouts == 1
    assert barrier.push(_stream_packet(42, 2), now=1.2).dropped is True


def test_udp_stream_barrier_drops_wrong_stream_and_expired_packets():
    barrier = UdpTtsStreamBarrier("session")
    barrier.start(_tts("session", 42, "start", 1), now=0)
    wrong = barrier.push(_stream_packet(99, 1), now=0)
    assert wrong.dropped is True
    assert wrong.reason == "wrong_stream"
    barrier.stop(_tts("session", 42, "stop", 1), now=0)
    assert barrier.push(_stream_packet(42, 2), now=0).dropped is True
    assert barrier.metrics.wrong_stream_drops == 1
    assert barrier.metrics.expired_packet_drops == 1


def test_udp_stream_barrier_abort_and_key_rotation_clear_all_state():
    barrier = UdpTtsStreamBarrier("session")
    barrier.push(_stream_packet(42, 1), now=0)
    barrier.push(_stream_packet(99, 1), now=0)
    result = barrier.key_rotation()
    assert result.aborted is True
    assert barrier.state == barrier.IDLE
    assert barrier.pending_prestart == {}
    assert barrier.reorder.remote_sequence == 0
    assert barrier.push(_stream_packet(42, 1), now=0).accepted is True
