"""Internal gateway-to-Voice-Server audio bridge framing.

The bridge frame is not device wire protocol and is not the encrypted UDP
header.  It is the 16-byte clear header used by a future MQTT gateway adapter
when handing one Opus packet to the Voice Server.  This module only validates
and serializes bytes; it never opens a WebSocket/UDP socket or decodes audio.
"""

from __future__ import annotations

from dataclasses import dataclass
import struct
from typing import Any

from .protocol import ProtocolError


BRIDGE_HEADER_SIZE = 16
BRIDGE_PACKET_TYPE = 0x01
BRIDGE_RESERVED = 0x00
BRIDGE_MAX_OPUS_PAYLOAD_BYTES = 0xFFFF
UINT32_MAX = 0xFFFFFFFF


class BridgeProtocolError(ProtocolError):
    """Malformed internal gateway bridge frame."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class BridgeAudioPacket:
    """One clear bridge packet before the Voice Server Opus decoder."""

    sequence: int
    timestamp_ms: int
    opus: bytes


def encode_bridge_audio(packet: BridgeAudioPacket) -> bytes:
    """Serialize the normative 16-byte gateway bridge header."""

    sequence = _uint32(packet.sequence, "sequence")
    timestamp = _uint32(packet.timestamp_ms, "timestamp_ms")
    opus = bytes(packet.opus)
    if not 0 < len(opus) <= BRIDGE_MAX_OPUS_PAYLOAD_BYTES:
        raise BridgeProtocolError("BRIDGE_PAYLOAD_INVALID", "bridge Opus payload length is outside uint16 limits")
    header = bytearray(BRIDGE_HEADER_SIZE)
    header[0] = BRIDGE_PACKET_TYPE
    header[1] = BRIDGE_RESERVED
    header[2:4] = struct.pack(">H", len(opus))
    header[4:8] = struct.pack(">I", sequence)
    header[8:12] = struct.pack(">I", timestamp)
    header[12:16] = struct.pack(">I", len(opus))
    return bytes(header) + opus


def decode_bridge_audio(raw: bytes | bytearray | memoryview) -> BridgeAudioPacket:
    """Validate exact framing before exposing the Opus payload."""

    if not isinstance(raw, (bytes, bytearray, memoryview)):
        raise BridgeProtocolError("BRIDGE_FRAME_INVALID", "bridge frame must be bytes")
    data = bytes(raw)
    if len(data) < BRIDGE_HEADER_SIZE:
        raise BridgeProtocolError("BRIDGE_HEADER_SHORT", "bridge frame is shorter than its header")
    header = data[:BRIDGE_HEADER_SIZE]
    if header[0] != BRIDGE_PACKET_TYPE or header[1] != BRIDGE_RESERVED:
        raise BridgeProtocolError("BRIDGE_HEADER_INVALID", "bridge type or reserved byte is invalid")
    payload_len = struct.unpack(">H", header[2:4])[0]
    opus_len = struct.unpack(">I", header[12:16])[0]
    if not 0 < payload_len <= BRIDGE_MAX_OPUS_PAYLOAD_BYTES or opus_len != payload_len:
        raise BridgeProtocolError("BRIDGE_LENGTH_INVALID", "bridge payload and Opus lengths are invalid")
    if len(data) != BRIDGE_HEADER_SIZE + payload_len:
        raise BridgeProtocolError("BRIDGE_LENGTH_MISMATCH", "bridge frame length does not match payload length")
    return BridgeAudioPacket(
        sequence=struct.unpack(">I", header[4:8])[0],
        timestamp_ms=struct.unpack(">I", header[8:12])[0],
        opus=data[BRIDGE_HEADER_SIZE:],
    )


def _uint32(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= UINT32_MAX:
        raise BridgeProtocolError("BRIDGE_FIELD_INVALID", f"bridge {name} must fit uint32")
    return value
