import pytest

from veetee_server.protocol import AudioFrame, ProtocolError, decode_audio, encode_audio


@pytest.mark.parametrize(
    ("profile", "expected"),
    [
        ("ws-v1-compat", bytes.fromhex("deadbeef")),
        ("ws-v2", bytes.fromhex("00020000000000000102030400000004deadbeef")),
        ("ws-v3", bytes.fromhex("00000004deadbeef")),
    ],
)
def test_golden_audio_frames(profile, expected):
    timestamp = 0x01020304 if profile == "ws-v2" else 0
    frame = AudioFrame(profile=profile, payload=bytes.fromhex("deadbeef"), timestamp_ms=timestamp)
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
