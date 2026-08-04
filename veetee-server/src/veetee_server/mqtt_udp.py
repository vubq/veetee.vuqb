"""Host-side primitives for the staged MQTT-control/UDP-audio v3 profile.

This module deliberately stops at the carrier boundary: it does not open an
MQTT broker connection or a UDP socket.  It validates the server hello,
serializes the normative 16-byte UDP header, encrypts one Opus payload with
the per-session AES-128/CTR material, and provides the bounded reorder core
used by a future gateway adapter.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import re
import struct
import time
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .protocol import ProtocolError


UDP_HEADER_SIZE = 16
UDP_PACKET_TYPE = 0x01
UDP_MAX_OPUS_PAYLOAD_BYTES = 1400
UDP_REORDER_WINDOW_PACKETS = 4
UDP_MAX_FORWARD_SEQUENCE_JUMP = 256
UDP_REORDER_GAP_TIMEOUT_MS = 120
UINT32_MAX = 0xFFFFFFFF
_HEX_32 = re.compile(r"^[0-9a-fA-F]{32}$")


class UdpProtocolError(ProtocolError):
    """Malformed MQTT/UDP v3 material, header, or sequence."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class UdpServerHello:
    """Validated UDP session material received through the control carrier."""

    session_id: str
    server: str
    port: int
    key: bytes
    nonce: bytes
    sample_rate: int | None
    frame_duration_ms: int | None


@dataclass(frozen=True, slots=True)
class UdpAudioPacket:
    """One decrypted UDP audio packet, before reorder release."""

    flags: int
    ssrc: int
    timestamp_ms: int
    sequence: int
    opus: bytes


@dataclass(frozen=True, slots=True)
class ReorderResult:
    """Packets/losses made visible by one reorder operation."""

    released: tuple[UdpAudioPacket, ...] = ()
    lost_sequences: tuple[int, ...] = ()


def parse_udp_server_hello(message: Mapping[str, Any]) -> UdpServerHello:
    """Validate the normative ``transport:"udp"`` server hello.

    The parser accepts a missing version for the explicitly documented legacy
    peer profile, but any present version must be ``3``.  It never logs or
    returns a textual copy of the key/nonce.
    """

    if not isinstance(message, Mapping) or message.get("type") != "hello":
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server hello must have type hello")
    if message.get("transport") != "udp":
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server hello must select udp transport")
    version = message.get("version")
    if version is not None and (isinstance(version, bool) or version != 3):
        raise UdpProtocolError("UDP_HELLO_VERSION", "unsupported UDP profile version")
    session_id = message.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 128:
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server hello session_id is invalid")

    udp = message.get("udp")
    if not isinstance(udp, Mapping):
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server hello udp block is required")
    server = udp.get("server")
    port = udp.get("port")
    if not isinstance(server, str) or not server.strip() or len(server) > 255:
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server endpoint is invalid")
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise UdpProtocolError("UDP_HELLO_INVALID", "UDP server port is invalid")
    key = _decode_material(udp.get("key"), "key")
    nonce = _decode_material(udp.get("nonce"), "nonce")
    if nonce[0] != UDP_PACKET_TYPE:
        raise UdpProtocolError("UDP_NONCE_INVALID", "UDP nonce template has an invalid type byte")

    sample_rate: int | None = None
    frame_duration_ms: int | None = None
    audio = message.get("audio_params")
    if audio is not None:
        if not isinstance(audio, Mapping) or audio.get("format") != "opus" or audio.get("channels") != 1:
            raise UdpProtocolError("UDP_AUDIO_PARAMS_INVALID", "UDP audio parameters are invalid")
        sample_rate = _positive_int(audio.get("sample_rate"), "sample_rate")
        frame_duration_ms = _positive_int(audio.get("frame_duration"), "frame_duration")

    return UdpServerHello(
        session_id=session_id.strip(),
        server=server.strip(),
        port=port,
        key=key,
        nonce=nonce,
        sample_rate=sample_rate,
        frame_duration_ms=frame_duration_ms,
    )


class UdpCryptoSession:
    """Encrypt/decrypt independent UDP datagrams for one session key/nonce."""

    def __init__(self, key: bytes, nonce: bytes) -> None:
        _validate_material(key, nonce)
        self.key = bytes(key)
        self.nonce = bytes(nonce)
        self.send_sequence = 0

    @classmethod
    def from_server_hello(cls, message: Mapping[str, Any]) -> "UdpCryptoSession":
        hello = parse_udp_server_hello(message)
        return cls(hello.key, hello.nonce)

    def encrypt(self, opus: bytes, *, timestamp_ms: int = 0, ssrc: int | None = None) -> bytes:
        payload = bytes(opus)
        if not 0 < len(payload) <= UDP_MAX_OPUS_PAYLOAD_BYTES:
            raise UdpProtocolError("UDP_PAYLOAD_INVALID", "Opus payload length is outside UDP limits")
        timestamp = _uint32(timestamp_ms, "timestamp_ms")
        if self.send_sequence >= UINT32_MAX:
            raise UdpProtocolError("UDP_SEQUENCE_WRAP", "UDP session must rotate before sequence wrap")
        sequence = self.send_sequence + 1
        self.send_sequence = sequence
        header = bytearray(self.nonce)
        header[0] = UDP_PACKET_TYPE
        header[2:4] = struct.pack(">H", len(payload))
        if ssrc is not None:
            header[4:8] = struct.pack(">I", _uint32(ssrc, "ssrc"))
        header[8:12] = struct.pack(">I", timestamp)
        header[12:16] = struct.pack(">I", sequence)
        return bytes(header) + _crypt(self.key, bytes(header), payload)

    def decrypt(self, datagram: bytes) -> UdpAudioPacket:
        raw = bytes(datagram)
        if len(raw) < UDP_HEADER_SIZE:
            raise UdpProtocolError("UDP_HEADER_SHORT", "UDP datagram is shorter than its header")
        header = raw[:UDP_HEADER_SIZE]
        if header[0] != UDP_PACKET_TYPE or header[1] != self.nonce[1]:
            raise UdpProtocolError("UDP_HEADER_INVALID", "UDP datagram type or flags are invalid")
        payload_len = struct.unpack(">H", header[2:4])[0]
        if not 0 < payload_len <= UDP_MAX_OPUS_PAYLOAD_BYTES:
            raise UdpProtocolError("UDP_PAYLOAD_INVALID", "UDP payload length is outside limits")
        if len(raw) != UDP_HEADER_SIZE + payload_len:
            raise UdpProtocolError("UDP_LENGTH_MISMATCH", "UDP datagram length does not match payload_len")
        return UdpAudioPacket(
            flags=header[1],
            ssrc=struct.unpack(">I", header[4:8])[0],
            timestamp_ms=struct.unpack(">I", header[8:12])[0],
            sequence=struct.unpack(">I", header[12:16])[0],
            opus=_crypt(self.key, header, raw[UDP_HEADER_SIZE:]),
        )


class UdpReorderBuffer:
    """Bounded per-direction receiver state from protocol §5.6."""

    def __init__(
        self,
        *,
        window_packets: int = UDP_REORDER_WINDOW_PACKETS,
        max_forward_jump: int = UDP_MAX_FORWARD_SEQUENCE_JUMP,
        gap_timeout_ms: int = UDP_REORDER_GAP_TIMEOUT_MS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if window_packets < 1 or max_forward_jump < window_packets or gap_timeout_ms < 0:
            raise ValueError("invalid UDP reorder limits")
        self.window_packets = window_packets
        self.max_forward_jump = max_forward_jump
        self.gap_timeout_s = gap_timeout_ms / 1000
        self._clock = clock
        self.remote_sequence = 0
        self._slots: dict[int, UdpAudioPacket] = {}
        self._gap_started_at: float | None = None
        self.duplicates = 0
        self.lost = 0
        self.protocol_errors = 0

    @property
    def pending_sequences(self) -> tuple[int, ...]:
        return tuple(sorted(self._slots))

    def push(self, packet: UdpAudioPacket, *, now: float | None = None) -> ReorderResult:
        observed_at = self._clock() if now is None else now
        sequence = packet.sequence
        next_sequence = self.remote_sequence + 1
        if sequence <= self.remote_sequence or sequence in self._slots:
            self.duplicates += 1
            return ReorderResult()
        if sequence - next_sequence > self.max_forward_jump:
            self.protocol_errors += 1
            self.reset()
            raise UdpProtocolError("UDP_SEQUENCE_JUMP", "UDP sequence jumped beyond the bounded window")

        lost_sequences: list[int] = []
        while sequence >= next_sequence + self.window_packets:
            lost_sequences.append(next_sequence)
            self.remote_sequence = next_sequence
            self.lost += 1
            next_sequence += 1
        self._slots[sequence] = packet
        released = self._drain_contiguous()
        released, timeout_lost = self._flush_if_due(observed_at, released)
        lost_sequences.extend(timeout_lost)
        self._update_gap_timer(observed_at)
        return ReorderResult(tuple(released), tuple(lost_sequences))

    def flush(self, *, now: float | None = None) -> ReorderResult:
        observed_at = self._clock() if now is None else now
        released, lost_sequences = self._flush_if_due(observed_at, [])
        self._update_gap_timer(observed_at)
        return ReorderResult(tuple(released), tuple(lost_sequences))

    def reset(self) -> None:
        self.remote_sequence = 0
        self._slots.clear()
        self._gap_started_at = None

    def _drain_contiguous(self) -> list[UdpAudioPacket]:
        released: list[UdpAudioPacket] = []
        next_sequence = self.remote_sequence + 1
        while next_sequence in self._slots:
            released.append(self._slots.pop(next_sequence))
            self.remote_sequence = next_sequence
            next_sequence += 1
        return released

    def _flush_if_due(self, now: float, released: list[UdpAudioPacket]) -> tuple[list[UdpAudioPacket], list[int]]:
        if self._gap_started_at is None or now - self._gap_started_at < self.gap_timeout_s or not self._slots:
            return released, []
        lowest = min(self._slots)
        lost_sequences: list[int] = []
        next_sequence = self.remote_sequence + 1
        while next_sequence < lowest:
            lost_sequences.append(next_sequence)
            self.remote_sequence = next_sequence
            self.lost += 1
            next_sequence += 1
        released.extend(self._drain_contiguous())
        return released, lost_sequences

    def _update_gap_timer(self, now: float) -> None:
        next_sequence = self.remote_sequence + 1
        if not self._slots or min(self._slots) <= next_sequence:
            self._gap_started_at = None
        elif self._gap_started_at is None:
            # A newer packet must not extend an already-running gap timer.
            self._gap_started_at = now


def _crypt(key: bytes, iv: bytes, payload: bytes) -> bytes:
    encryptor = Cipher(algorithms.AES(key), modes.CTR(iv)).encryptor()
    return encryptor.update(payload) + encryptor.finalize()


def _validate_material(key: bytes, nonce: bytes) -> None:
    if not isinstance(key, bytes) or len(key) != 16:
        raise UdpProtocolError("UDP_KEY_INVALID", "UDP key must be exactly 16 bytes")
    if not isinstance(nonce, bytes) or len(nonce) != 16 or nonce[0] != UDP_PACKET_TYPE:
        raise UdpProtocolError("UDP_NONCE_INVALID", "UDP nonce must be 16 bytes with type byte 0x01")


def _decode_material(value: Any, name: str) -> bytes:
    if not isinstance(value, str) or not _HEX_32.fullmatch(value):
        raise UdpProtocolError("UDP_MATERIAL_INVALID", f"UDP {name} must be 32 hexadecimal characters")
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise UdpProtocolError("UDP_MATERIAL_INVALID", f"UDP {name} is not valid hexadecimal") from exc


def _positive_int(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise UdpProtocolError("UDP_AUDIO_PARAMS_INVALID", f"UDP {name} must be a positive integer")
    return value


def _uint32(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= UINT32_MAX:
        raise UdpProtocolError("UDP_FIELD_INVALID", f"UDP {name} must fit uint32")
    return value
