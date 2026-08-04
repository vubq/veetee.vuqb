import json
from pathlib import Path

import pytest

from veetee_server.mqtt_bridge import (
    BridgeAudioPacket,
    BridgeProtocolError,
    decode_bridge_audio,
    encode_bridge_audio,
)


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/mqtt_bridge_v3.json"


def _fixture() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_bridge_golden_vector_round_trips_exact_wire():
    fixture = _fixture()
    packet = BridgeAudioPacket(
        sequence=fixture["sequence"],
        timestamp_ms=fixture["timestamp_ms"],
        opus=bytes.fromhex(fixture["opus_hex"]),
    )
    wire = encode_bridge_audio(packet)
    assert wire.hex() == fixture["wire_hex"]
    assert decode_bridge_audio(wire) == packet


def test_bridge_rejects_type_reserved_length_and_trailing_bytes():
    fixture = _fixture()
    wire = bytearray(bytes.fromhex(fixture["wire_hex"]))
    wire[0] = 2
    with pytest.raises(BridgeProtocolError, match="type"):
        decode_bridge_audio(wire)
    wire = bytearray(bytes.fromhex(fixture["wire_hex"]))
    wire[1] = 1
    with pytest.raises(BridgeProtocolError, match="reserved"):
        decode_bridge_audio(wire)
    wire = bytearray(bytes.fromhex(fixture["wire_hex"]))
    wire[2:4] = (5).to_bytes(2, "big")
    with pytest.raises(BridgeProtocolError, match="length"):
        decode_bridge_audio(wire)
    with pytest.raises(BridgeProtocolError, match="match"):
        decode_bridge_audio(bytes.fromhex(fixture["wire_hex"]) + b"x")


def test_bridge_rejects_short_empty_and_uint16_overflow_payloads():
    with pytest.raises(BridgeProtocolError, match="shorter"):
        decode_bridge_audio(b"\x01")
    with pytest.raises(BridgeProtocolError, match="outside"):
        encode_bridge_audio(BridgeAudioPacket(sequence=1, timestamp_ms=0, opus=b""))
    with pytest.raises(BridgeProtocolError, match="outside"):
        encode_bridge_audio(BridgeAudioPacket(sequence=1, timestamp_ms=0, opus=b"x" * 65_536))


def test_bridge_rejects_invalid_sequence_and_timestamp_without_network_side_effect():
    for field in ("sequence", "timestamp_ms"):
        values = {"sequence": 1, "timestamp_ms": 0, "opus": b"x"}
        values[field] = -1
        with pytest.raises(BridgeProtocolError, match="uint32"):
            encode_bridge_audio(BridgeAudioPacket(**values))
