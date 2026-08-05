import pytest
import csv
from pathlib import Path

from veetee_server.protocol import AudioFrame, ProtocolError, decode_audio, encode_audio


def _golden_rows() -> list[dict[str, str]]:
    fixture = Path(__file__).parents[2] / "tests/fixtures/ws_audio_golden.csv"
    with fixture.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    assert rows
    return rows


@pytest.mark.parametrize(
    "row",
    _golden_rows(),
    ids=lambda row: row["profile"],
)
def test_golden_audio_frames(row):
    profile = row["profile"]
    timestamp = int(row["timestamp_ms"])
    expected = bytes.fromhex(row["wire_hex"])
    frame = AudioFrame(profile=profile, payload=bytes.fromhex(row["payload_hex"]), timestamp_ms=timestamp)
    assert encode_audio(frame) == expected
    parsed = decode_audio(profile, expected)
    assert parsed.payload == frame.payload
    assert parsed.timestamp_ms == timestamp


def test_rejects_v3_length_mismatch():
    with pytest.raises(ProtocolError):
        decode_audio("ws-v3", bytes.fromhex("00000003deadbeef"))


def test_rejects_oversize_payload():
    with pytest.raises(ProtocolError):
        encode_audio(AudioFrame(profile="ws-v3", payload=b"x" * 1501))


@pytest.mark.parametrize("profile", ["ws-v0", "", "mqtt-udp-v3"])
def test_rejects_unknown_profile_in_both_directions(profile: str):
    with pytest.raises(ProtocolError, match="unsupported protocol profile"):
        encode_audio(AudioFrame(profile=profile, payload=b"x"))  # type: ignore[arg-type]
    with pytest.raises(ProtocolError, match="unsupported protocol profile"):
        decode_audio(profile, b"x")  # type: ignore[arg-type]
