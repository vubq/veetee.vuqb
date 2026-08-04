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
UDP_PRESTART_MAX_PACKETS = 8
UDP_PRESTART_TIMEOUT_MS = 480
UDP_TTS_DRAIN_TIMEOUT_MS = 1_200
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


@dataclass(frozen=True, slots=True)
class UdpStreamResult:
    """Result of a stream-barrier operation.

    ``released`` is the only collection that may be handed to an audio
    decoder.  A packet buffered before ``tts/start`` never appears here until
    a valid start establishes its stream boundary.
    """

    released: tuple[UdpAudioPacket, ...] = ()
    lost_sequences: tuple[int, ...] = ()
    accepted: bool = True
    dropped: bool = False
    completed: bool = False
    invalidated: bool = False
    aborted: bool = False
    timed_out: bool = False
    state: str = "IDLE"
    stream_id: int | None = None
    reason: str | None = None


@dataclass(slots=True)
class UdpStreamMetrics:
    """Bounded counters for the MQTT/UDP ordering barrier."""

    prestart_buffered: int = 0
    prestart_overflows: int = 0
    prestart_timeouts: int = 0
    wrong_stream_drops: int = 0
    expired_packet_drops: int = 0
    duplicate_prestart_drops: int = 0
    invalid_controls: int = 0
    stop_timeouts: int = 0
    stream_aborts: int = 0


@dataclass(slots=True)
class _PreStartStream:
    first_seen_at: float
    packets: dict[int, UdpAudioPacket]
    stop_sequence: int | None = None
    stop_seen_at: float | None = None


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
        self._released_sequence = 0
        self._slots: dict[int, UdpAudioPacket] = {}
        self._gap_started_at: float | None = None
        self.duplicates = 0
        self.lost = 0
        self.protocol_errors = 0

    @property
    def pending_sequences(self) -> tuple[int, ...]:
        return tuple(sorted(self._slots))

    @property
    def released_sequence(self) -> int:
        """Highest sequence actually released, excluding declared losses."""

        return self._released_sequence

    def push(self, packet: UdpAudioPacket, *, now: float | None = None) -> ReorderResult:
        observed_at = self._clock() if now is None else now
        sequence = packet.sequence
        if not 1 <= sequence <= UINT32_MAX:
            self.protocol_errors += 1
            raise UdpProtocolError("UDP_SEQUENCE_INVALID", "UDP sequence must be in 1..2^32-1")
        next_sequence = self.remote_sequence + 1
        if sequence <= self.remote_sequence or sequence in self._slots:
            self.duplicates += 1
            return ReorderResult()
        if sequence - next_sequence > self.max_forward_jump:
            self.protocol_errors += 1
            self.reset()
            raise UdpProtocolError("UDP_SEQUENCE_JUMP", "UDP sequence jumped beyond the bounded window")

        lost_sequences: list[int] = []
        released: list[UdpAudioPacket] = []
        # A forward packet may coexist with already buffered packets.  Never
        # declare a sequence that is already in a slot lost: first release the
        # contiguous prefix, then advance only genuinely missing sequences.
        while sequence >= next_sequence + self.window_packets:
            if next_sequence in self._slots:
                released.extend(self._drain_contiguous())
                next_sequence = self.remote_sequence + 1
                continue
            lost_sequences.append(next_sequence)
            self.remote_sequence = next_sequence
            self.lost += 1
            next_sequence += 1

        # Keep the slot map bounded even when several disjoint gaps arrive.
        while len(self._slots) >= self.window_packets and sequence != next_sequence:
            if next_sequence in self._slots:
                released.extend(self._drain_contiguous())
                next_sequence = self.remote_sequence + 1
                continue
            lost_sequences.append(next_sequence)
            self.remote_sequence = next_sequence
            self.lost += 1
            next_sequence += 1

        if sequence == next_sequence:
            self.remote_sequence = sequence
            self._released_sequence = sequence
            released.append(packet)
            released.extend(self._drain_contiguous())
        else:
            self._slots[sequence] = packet
            released.extend(self._drain_contiguous())
        released, timeout_lost = self._flush_if_due(observed_at, released)
        lost_sequences.extend(timeout_lost)
        self._update_gap_timer(observed_at)
        return ReorderResult(tuple(released), tuple(lost_sequences))

    def flush(self, *, now: float | None = None) -> ReorderResult:
        observed_at = self._clock() if now is None else now
        released, lost_sequences = self._flush_if_due(observed_at, [])
        self._update_gap_timer(observed_at)
        return ReorderResult(tuple(released), tuple(lost_sequences))

    def prime(self, start_sequence: int) -> ReorderResult:
        """Install an authoritative inclusive stream boundary.

        MQTT control and UDP do not share an arrival order.  ``tts/start``
        therefore moves the receiver to ``start_sequence - 1`` and declares
        the unresolved prefix lost before any buffered packet is released.
        The forward-jump rule intentionally matches :meth:`push`.
        """

        if not 1 <= start_sequence <= UINT32_MAX:
            raise UdpProtocolError("UDP_START_SEQUENCE_INVALID", "tts/start sequence is invalid")
        next_sequence = self.remote_sequence + 1
        if start_sequence <= self.remote_sequence:
            raise UdpProtocolError("UDP_START_SEQUENCE_STALE", "tts/start sequence is stale")
        if start_sequence - next_sequence > self.max_forward_jump:
            raise UdpProtocolError("UDP_SEQUENCE_JUMP", "tts/start sequence jumped beyond the bounded window")

        lost_sequences = tuple(range(next_sequence, start_sequence))
        self._slots.clear()
        self._gap_started_at = None
        self.remote_sequence = start_sequence - 1
        self._released_sequence = start_sequence - 1
        self.lost += len(lost_sequences)
        return ReorderResult((), lost_sequences)

    def discard_after(self, end_sequence: int, *, now: float | None = None) -> tuple[int, ...]:
        """Drop queued packets beyond an authoritative inclusive stop."""

        discarded = tuple(sorted(sequence for sequence in self._slots if sequence > end_sequence))
        for sequence in discarded:
            del self._slots[sequence]
        self._update_gap_timer(self._clock() if now is None else now)
        return discarded

    def reset(self) -> None:
        self.remote_sequence = 0
        self._released_sequence = 0
        self._slots.clear()
        self._gap_started_at = None

    def _drain_contiguous(self) -> list[UdpAudioPacket]:
        released: list[UdpAudioPacket] = []
        next_sequence = self.remote_sequence + 1
        while next_sequence in self._slots:
            released.append(self._slots.pop(next_sequence))
            self.remote_sequence = next_sequence
            self._released_sequence = next_sequence
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


class UdpTtsStreamBarrier:
    """Coordinate MQTT ``tts`` controls with UDP audio for one session.

    The class is deliberately carrier-agnostic: callers decrypt a datagram
    with :class:`UdpCryptoSession`, then pass the resulting packet here.  It
    never opens a socket, decodes Opus, plays audio, or parses MQTT itself.
    Its output is the only place a future gateway may hand packets to the
    decoder/playback queue.

    A session has at most one active TTS stream.  Packets for an unknown stream
    can arrive before its control message and are held in a small bounded
    buffer.  ``tts/start`` establishes the inclusive sequence boundary;
    ``tts/stop`` establishes the exact sequence that must be released before
    the stream is considered complete.
    """

    IDLE = "IDLE"
    PRE_START = "PRE_START"
    ACTIVE = "ACTIVE"
    DRAINING = "DRAINING"
    COMPLETED = "COMPLETED"
    INVALID = "INVALID"

    def __init__(
        self,
        session_id: str,
        *,
        reorder: UdpReorderBuffer | None = None,
        prestart_max_packets: int = UDP_PRESTART_MAX_PACKETS,
        prestart_timeout_ms: int = UDP_PRESTART_TIMEOUT_MS,
        drain_timeout_ms: int = UDP_TTS_DRAIN_TIMEOUT_MS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if not isinstance(session_id, str) or not session_id.strip():
            raise ValueError("session_id must be a non-empty string")
        if prestart_max_packets < 1 or prestart_timeout_ms < 0 or drain_timeout_ms < 0:
            raise ValueError("invalid UDP stream barrier limits")
        self.session_id = session_id.strip()
        self.reorder = reorder or UdpReorderBuffer(clock=clock)
        self.prestart_max_packets = prestart_max_packets
        self.prestart_timeout_s = prestart_timeout_ms / 1000
        self.drain_timeout_s = drain_timeout_ms / 1000
        self._clock = clock
        self._prestart: dict[int, _PreStartStream] = {}
        self._invalid_streams: set[int] = set()
        self._active_stream_id: int | None = None
        self._start_sequence: int | None = None
        self._end_sequence: int | None = None
        self._drain_started_at: float | None = None
        self._state = self.IDLE
        self.metrics = UdpStreamMetrics()

    @property
    def state(self) -> str:
        if self._active_stream_id is None and self._prestart:
            return self.PRE_START
        return self._state

    @property
    def active_stream_id(self) -> int | None:
        return self._active_stream_id

    @property
    def start_sequence(self) -> int | None:
        return self._start_sequence

    @property
    def end_sequence(self) -> int | None:
        return self._end_sequence

    @property
    def pending_prestart(self) -> dict[int, tuple[int, ...]]:
        """A read-only snapshot useful to metrics/tests, never packet objects."""

        return {stream_id: tuple(sorted(pending.packets)) for stream_id, pending in self._prestart.items()}

    def push(self, packet: UdpAudioPacket, *, now: float | None = None) -> UdpStreamResult:
        """Accept one decrypted packet and return packets newly releasable."""

        observed_at = self._clock() if now is None else now
        self._expire_prestart(observed_at)
        stream_id = packet.ssrc
        if not 1 <= stream_id <= UINT32_MAX or not 1 <= packet.sequence <= UINT32_MAX:
            return self._drop(stream_id if 1 <= stream_id <= UINT32_MAX else None, "packet_out_of_range")

        if self._active_stream_id is None:
            if stream_id in self._invalid_streams:
                return self._drop(stream_id, "stream_expired")
            pending = self._prestart.get(stream_id)
            if pending is None:
                pending = _PreStartStream(observed_at, {})
                self._prestart[stream_id] = pending
            if packet.sequence in pending.packets:
                self.metrics.duplicate_prestart_drops += 1
                return self._drop(stream_id, "duplicate_prestart")
            if len(pending.packets) >= self.prestart_max_packets:
                self.metrics.prestart_overflows += 1
                self._invalidate_stream(stream_id, "prestart_overflow")
                return self._result(
                    stream_id=stream_id,
                    invalidated=True,
                    reason="prestart_overflow",
                )
            pending.packets[packet.sequence] = packet
            self.metrics.prestart_buffered += 1
            return self._result(stream_id=stream_id, reason="prestart_buffered")

        if stream_id != self._active_stream_id:
            self.metrics.wrong_stream_drops += 1
            return self._drop(stream_id, "wrong_stream")
        if self._state not in (self.ACTIVE, self.DRAINING):
            return self._drop(stream_id, "stream_not_active")
        if self._state == self.DRAINING and self._end_sequence is not None and packet.sequence > self._end_sequence:
            self.metrics.expired_packet_drops += 1
            return self._drop(stream_id, "after_end_sequence")

        try:
            reorder_result = self.reorder.push(packet, now=observed_at)
        except UdpProtocolError:
            self._invalidate_stream(stream_id, "sequence_error")
            raise
        completed = self._complete_if_released()
        return self._result(
            released=reorder_result.released,
            lost_sequences=reorder_result.lost_sequences,
            stream_id=stream_id,
            completed=completed,
        )

    def start(self, message: Mapping[str, Any], *, now: float | None = None) -> UdpStreamResult:
        """Apply a validated ``tts/start`` control message."""

        observed_at = self._clock() if now is None else now
        self._expire_prestart(observed_at)
        stream_id, start_sequence, matches = self._parse_control(message, "start")
        if not matches:
            return self._drop(stream_id, "session_mismatch")
        assert start_sequence is not None
        if stream_id in self._invalid_streams:
            raise self._control_error("UDP_TTS_START_EXPIRED", "tts/start refers to an expired stream")
        if self._active_stream_id is not None:
            if stream_id != self._active_stream_id:
                raise self._control_error("UDP_TTS_START_STREAM", "tts/start stream does not match active stream")
            raise self._control_error("UDP_TTS_START_DUPLICATE", "tts/start was already accepted")

        if self._prestart and stream_id not in self._prestart:
            raise self._control_error("UDP_TTS_START_STREAM", "tts/start stream does not match pending packets")
        pending = self._prestart.get(stream_id)
        if pending is not None and pending.stop_sequence is not None and pending.stop_sequence < start_sequence:
            raise self._control_error("UDP_TTS_STOP_RANGE", "tts/stop end_sequence precedes tts/start")
        try:
            boundary = self.reorder.prime(start_sequence)
        except UdpProtocolError:
            self.metrics.invalid_controls += 1
            raise

        self._prestart.pop(stream_id, None)
        self._active_stream_id = stream_id
        self._start_sequence = start_sequence
        self._end_sequence = pending.stop_sequence if pending is not None else None
        self._drain_started_at = observed_at if self._end_sequence is not None else None
        self._state = self.DRAINING if self._end_sequence is not None else self.ACTIVE
        released = list(boundary.released)
        lost_sequences = list(boundary.lost_sequences)

        if pending is not None:
            for sequence in sorted(pending.packets):
                packet = pending.packets[sequence]
                if (
                    sequence < start_sequence
                    or sequence > start_sequence + self.reorder.max_forward_jump
                    or (self._end_sequence is not None and sequence > self._end_sequence)
                ):
                    self.metrics.expired_packet_drops += 1
                    continue
                try:
                    result = self.reorder.push(packet, now=observed_at)
                except UdpProtocolError:
                    self._invalidate_stream(stream_id, "buffered_sequence_error")
                    raise
                released.extend(result.released)
                lost_sequences.extend(result.lost_sequences)

        if self._state == self.DRAINING and self._end_sequence is not None:
            for packet in released:
                if packet.sequence > self._end_sequence:
                    self.metrics.expired_packet_drops += 1
            released = [packet for packet in released if packet.sequence <= self._end_sequence]
        completed = self._complete_if_released()
        return self._result(
            released=tuple(released),
            lost_sequences=tuple(lost_sequences),
            accepted=True,
            completed=completed,
            stream_id=stream_id,
        )

    def stop(self, message: Mapping[str, Any], *, now: float | None = None) -> UdpStreamResult:
        """Apply a ``tts/stop`` control message and begin bounded draining."""

        observed_at = self._clock() if now is None else now
        self._expire_prestart(observed_at)
        stream_id, end_sequence, matches = self._parse_control(message, "stop")
        if not matches:
            return self._drop(stream_id, "session_mismatch")
        assert end_sequence is not None
        if stream_id in self._invalid_streams:
            raise self._control_error("UDP_TTS_STOP_EXPIRED", "tts/stop refers to an expired stream")

        if self._active_stream_id is None:
            pending = self._prestart.get(stream_id)
            if pending is None:
                raise self._control_error("UDP_TTS_STOP_STREAM", "tts/stop has no known stream")
            if pending.stop_sequence is not None and pending.stop_sequence != end_sequence:
                raise self._control_error("UDP_TTS_STOP_DUPLICATE", "tts/stop conflicts with an existing end_sequence")
            pending.stop_sequence = end_sequence
            pending.stop_seen_at = observed_at
            return self._result(stream_id=stream_id, reason="stop_pending_start")

        if stream_id != self._active_stream_id:
            self.metrics.wrong_stream_drops += 1
            return self._drop(stream_id, "wrong_stream")
        if self._start_sequence is None or end_sequence < self._start_sequence:
            raise self._control_error("UDP_TTS_STOP_RANGE", "tts/stop end_sequence is outside the active stream")
        if end_sequence < self.reorder.remote_sequence:
            raise self._control_error("UDP_TTS_STOP_STALE", "tts/stop end_sequence is behind the receiver")
        if self._state == self.DRAINING:
            if end_sequence != self._end_sequence:
                raise self._control_error("UDP_TTS_STOP_DUPLICATE", "tts/stop conflicts with an existing end_sequence")
            return self._result(stream_id=stream_id, reason="stop_already_draining")

        discarded = self.reorder.discard_after(end_sequence, now=observed_at)
        self.metrics.expired_packet_drops += len(discarded)
        self._end_sequence = end_sequence
        self._drain_started_at = observed_at
        self._state = self.DRAINING
        completed = self._complete_if_released()
        return self._result(stream_id=stream_id, completed=completed, reason="draining")

    def tick(self, *, now: float | None = None) -> UdpStreamResult:
        """Flush reorder gaps and enforce pre-start/stop deadlines."""

        observed_at = self._clock() if now is None else now
        expired_ids = self._expire_prestart(observed_at)
        released: tuple[UdpAudioPacket, ...] = ()
        lost_sequences: tuple[int, ...] = ()
        completed = False
        if self._active_stream_id is not None and self._state in (self.ACTIVE, self.DRAINING):
            result = self.reorder.flush(now=observed_at)
            released = result.released
            lost_sequences = result.lost_sequences
            completed = self._complete_if_released()
            if not completed and self._state == self.DRAINING and self._drain_started_at is not None:
                if observed_at - self._drain_started_at >= self.drain_timeout_s:
                    stream_id = self._active_stream_id
                    self.metrics.stop_timeouts += 1
                    self.metrics.stream_aborts += 1
                    self._invalidate_stream(stream_id, "stop_timeout")
                    return self._result(
                        released=released,
                        lost_sequences=lost_sequences,
                        aborted=True,
                        timed_out=True,
                        invalidated=True,
                        stream_id=stream_id,
                        reason="stop_timeout",
                    )
        invalidated = bool(expired_ids)
        return self._result(
            released=released,
            lost_sequences=lost_sequences,
            completed=completed,
            invalidated=invalidated,
            reason="prestart_timeout" if invalidated else None,
        )

    flush = tick

    def abort(self, *, reason: str = "abort") -> UdpStreamResult:
        """Clear active, pre-start and invalid-stream state for a new generation."""

        self._prestart.clear()
        self._invalid_streams.clear()
        self._active_stream_id = None
        self._start_sequence = None
        self._end_sequence = None
        self._drain_started_at = None
        self.reorder.reset()
        self._state = self.IDLE
        return UdpStreamResult(aborted=True, state=self.IDLE, reason=reason)

    def key_rotation(self) -> UdpStreamResult:
        """Key rotation has the same ordering cleanup as session abort."""

        return self.abort(reason="key_rotation")

    reset = abort
    clear = abort

    def handle_control(self, message: Mapping[str, Any], *, now: float | None = None) -> UdpStreamResult:
        """Dispatch a control message without making carrier assumptions."""

        if not isinstance(message, Mapping) or message.get("type") != "tts":
            raise self._control_error("UDP_TTS_INVALID", "stream barrier expects a tts control message")
        state = message.get("state")
        if state == "start":
            return self.start(message, now=now)
        if state == "stop":
            return self.stop(message, now=now)
        raise self._control_error("UDP_TTS_INVALID", "unsupported tts control state")

    def _parse_control(self, message: Mapping[str, Any], state: str) -> tuple[int, int | None, bool]:
        if not isinstance(message, Mapping) or message.get("type") != "tts" or message.get("state") != state:
            raise self._control_error("UDP_TTS_INVALID", f"tts/{state} control is malformed")
        raw_session = message.get("session_id")
        if not isinstance(raw_session, str) or not raw_session.strip():
            raise self._control_error("UDP_TTS_INVALID", "tts control session_id is invalid")
        if raw_session.strip() != self.session_id:
            return 0, None, False
        stream_id = self._parse_stream_id(message.get("audio_stream_id"))
        key = "start_sequence" if state == "start" else "end_sequence"
        try:
            sequence = _uint32(message.get(key), key)
        except UdpProtocolError as exc:
            self.metrics.invalid_controls += 1
            raise UdpProtocolError("UDP_TTS_INVALID", str(exc)) from exc
        if sequence == 0:
            raise self._control_error("UDP_TTS_INVALID", f"tts/{state} sequence must be nonzero")
        return stream_id, sequence, True

    def _parse_stream_id(self, value: Any) -> int:
        try:
            stream_id = _uint32(value, "audio_stream_id")
        except UdpProtocolError as exc:
            self.metrics.invalid_controls += 1
            raise UdpProtocolError("UDP_TTS_INVALID", str(exc)) from exc
        if stream_id == 0:
            raise self._control_error("UDP_TTS_INVALID", "audio_stream_id must be nonzero")
        return stream_id

    def _expire_prestart(self, now: float) -> tuple[int, ...]:
        expired: list[int] = []
        for stream_id, pending in tuple(self._prestart.items()):
            if now - pending.first_seen_at >= self.prestart_timeout_s:
                expired.append(stream_id)
                self.metrics.prestart_timeouts += 1
                self._invalidate_stream(stream_id, "prestart_timeout")
        return tuple(expired)

    def _invalidate_stream(self, stream_id: int, reason: str) -> None:
        if stream_id > 0:
            self._invalid_streams.add(stream_id)
        self._prestart.pop(stream_id, None)
        if self._active_stream_id == stream_id:
            self.reorder.reset()
            self._active_stream_id = None
            self._start_sequence = None
            self._end_sequence = None
            self._drain_started_at = None
            self._state = self.INVALID
        elif not self._prestart:
            self._state = self.INVALID if reason else self._state

    def _complete_if_released(self) -> bool:
        if self._state != self.DRAINING or self._end_sequence is None:
            return False
        if self.reorder.released_sequence < self._end_sequence:
            return False
        stream_id = self._active_stream_id
        if stream_id is None:
            return False
        self._invalid_streams.add(stream_id)
        self._active_stream_id = None
        self._start_sequence = None
        self._end_sequence = None
        self._drain_started_at = None
        self._state = self.COMPLETED
        return True

    def _control_error(self, code: str, message: str) -> UdpProtocolError:
        self.metrics.invalid_controls += 1
        return UdpProtocolError(code, message)

    def _drop(self, stream_id: int | None, reason: str) -> UdpStreamResult:
        return self._result(stream_id=stream_id, accepted=False, dropped=True, reason=reason)

    def _result(
        self,
        *,
        released: tuple[UdpAudioPacket, ...] = (),
        lost_sequences: tuple[int, ...] = (),
        accepted: bool = True,
        dropped: bool = False,
        completed: bool = False,
        invalidated: bool = False,
        aborted: bool = False,
        timed_out: bool = False,
        stream_id: int | None = None,
        reason: str | None = None,
    ) -> UdpStreamResult:
        return UdpStreamResult(
            released=tuple(released),
            lost_sequences=tuple(lost_sequences),
            accepted=accepted,
            dropped=dropped,
            completed=completed,
            invalidated=invalidated,
            aborted=aborted,
            timed_out=timed_out,
            state=self.state,
            stream_id=stream_id if stream_id is not None else self._active_stream_id,
            reason=reason,
        )


# Short aliases keep the carrier primitive easy to discover without making the
# gateway depend on a particular class name.
UdpStreamBarrier = UdpTtsStreamBarrier
UdpTtsStreamCoordinator = UdpTtsStreamBarrier
