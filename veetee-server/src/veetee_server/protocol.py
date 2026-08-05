"""Wire-compatible WebSocket framing and control message validation."""

from __future__ import annotations

from dataclasses import dataclass
import json
import struct
from typing import Any, Literal

Profile = Literal["ws-v1-compat", "ws-v2", "ws-v3"]
MAX_WS_OPUS_PAYLOAD_BYTES = 1500
_PROFILES: tuple[Profile, ...] = ("ws-v1-compat", "ws-v2", "ws-v3")


class ProtocolError(ValueError):
    """Malformed wire message or frame."""


@dataclass(frozen=True, slots=True)
class AudioFrame:
    profile: Profile
    payload: bytes
    timestamp_ms: int = 0


def profile_version(profile: Profile) -> int:
    if profile not in _PROFILES:
        raise ProtocolError(f"unsupported protocol profile: {profile}")
    return {"ws-v1-compat": 1, "ws-v2": 2, "ws-v3": 3}[profile]


def profile_from_version(version: int) -> Profile:
    profiles: dict[int, Profile] = {1: "ws-v1-compat", 2: "ws-v2", 3: "ws-v3"}
    try:
        return profiles[version]
    except KeyError as exc:
        raise ProtocolError(f"unsupported protocol version: {version}") from exc


def encode_audio(frame: AudioFrame) -> bytes:
    if frame.profile not in _PROFILES:
        raise ProtocolError(f"unsupported protocol profile: {frame.profile}")
    payload = bytes(frame.payload)
    if not payload or len(payload) > MAX_WS_OPUS_PAYLOAD_BYTES:
        raise ProtocolError("opus payload length is outside wire limits")
    if frame.profile == "ws-v1-compat":
        return payload
    if frame.profile == "ws-v2":
        return struct.pack(
            ">HHIII", 2, 0, 0, frame.timestamp_ms & 0xFFFFFFFF, len(payload)
        ) + payload
    return struct.pack(">BBH", 0, 0, len(payload)) + payload


def decode_audio(profile: Profile, raw: bytes) -> AudioFrame:
    if profile not in _PROFILES:
        raise ProtocolError(f"unsupported protocol profile: {profile}")
    data = bytes(raw)
    if profile == "ws-v1-compat":
        payload = data
        timestamp = 0
    elif profile == "ws-v2":
        if len(data) < 16:
            raise ProtocolError("v2 frame is shorter than header")
        version, kind, reserved, timestamp, length = struct.unpack(">HHIII", data[:16])
        if version != 2 or kind != 0 or reserved != 0:
            raise ProtocolError("invalid v2 header")
        if length != len(data) - 16:
            raise ProtocolError("v2 payload length mismatch")
        payload = data[16:]
    else:
        if len(data) < 4:
            raise ProtocolError("v3 frame is shorter than header")
        kind, reserved, length = struct.unpack(">BBH", data[:4])
        if kind != 0 or reserved != 0:
            raise ProtocolError("invalid v3 header")
        if length != len(data) - 4:
            raise ProtocolError("v3 payload length mismatch")
        payload = data[4:]
        timestamp = 0
    if not payload or len(payload) > MAX_WS_OPUS_PAYLOAD_BYTES:
        raise ProtocolError("opus payload length is outside wire limits")
    return AudioFrame(profile=profile, payload=payload, timestamp_ms=timestamp)


def decode_json(raw: str | bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ProtocolError("control message is not valid JSON") from exc
    if not isinstance(value, dict):
        raise ProtocolError("control message must be a JSON object")
    return value


def control_message(kind: str, *, session_id: str, **fields: Any) -> dict[str, Any]:
    return {"type": kind, **fields, "session_id": session_id}
