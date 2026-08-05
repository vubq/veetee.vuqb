"""Bounded asyncio UDP carrier for the staged MQTT/UDP v3 profile.

The carrier owns datagram I/O only.  Session hello, AES/CTR, sequence
validation and the TTS ordering barrier remain in :mod:`mqtt_session` and
:mod:`mqtt_udp`.  A caller must pass the configured peer explicitly; this
module never discovers a gateway, changes the default WebSocket transport, or
decodes Opus/audio.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
import re
from typing import Any, Self

from .mqtt_udp import UDP_HEADER_SIZE, UDP_MAX_OPUS_PAYLOAD_BYTES
from .protocol import ProtocolError


UDP_MAX_DATAGRAM_BYTES = UDP_HEADER_SIZE + UDP_MAX_OPUS_PAYLOAD_BYTES
UDP_DEFAULT_QUEUE_CAPACITY = 32
UDP_MAX_QUEUE_CAPACITY = 256
_HOST_RE = re.compile(r"^[^\s/\x00]+$")


class UdpCarrierError(ProtocolError):
    """Typed configuration or datagram I/O failure at the carrier boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class UdpCarrierConfig:
    """Explicit bind/peer settings supplied by a runtime snapshot."""

    bind_host: str
    bind_port: int
    peer_host: str
    peer_port: int
    max_datagram_bytes: int = UDP_MAX_DATAGRAM_BYTES
    queue_capacity: int = UDP_DEFAULT_QUEUE_CAPACITY

    def __post_init__(self) -> None:
        _validate_host(self.bind_host, "bind_host")
        _validate_port(self.bind_port, "bind_port", allow_zero=True)
        _validate_host(self.peer_host, "peer_host")
        _validate_port(self.peer_port, "peer_port", allow_zero=False)
        if not 1 <= self.max_datagram_bytes <= UDP_MAX_DATAGRAM_BYTES:
            raise UdpCarrierError(
                "UDP_CARRIER_CONFIG_INVALID",
                f"max_datagram_bytes must be in 1..{UDP_MAX_DATAGRAM_BYTES}",
            )
        if not 1 <= self.queue_capacity <= UDP_MAX_QUEUE_CAPACITY:
            raise UdpCarrierError(
                "UDP_CARRIER_CONFIG_INVALID",
                f"queue_capacity must be in 1..{UDP_MAX_QUEUE_CAPACITY}",
            )

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "UdpCarrierConfig":
        """Parse an explicit carrier object without supplying a peer implicitly."""

        if not isinstance(value, Mapping):
            raise UdpCarrierError("UDP_CARRIER_CONFIG_INVALID", "UDP carrier config must be an object")
        try:
            return cls(
                bind_host=value["bind_host"],
                bind_port=value.get("bind_port", 0),
                peer_host=value["peer_host"],
                peer_port=value["peer_port"],
                max_datagram_bytes=value.get("max_datagram_bytes", UDP_MAX_DATAGRAM_BYTES),
                queue_capacity=value.get("queue_capacity", UDP_DEFAULT_QUEUE_CAPACITY),
            )
        except KeyError as exc:
            raise UdpCarrierError(
                "UDP_CARRIER_CONFIG_INVALID", f"missing carrier field: {exc.args[0]}"
            ) from exc
        except (TypeError, ValueError) as exc:
            if isinstance(exc, UdpCarrierError):
                raise
            raise UdpCarrierError("UDP_CARRIER_CONFIG_INVALID", "UDP carrier config has invalid values") from exc


@dataclass(frozen=True, slots=True)
class UdpCarrierMetrics:
    """Read-only counters for bounded carrier behavior."""

    packets_received: int = 0
    packets_sent: int = 0
    packets_dropped: int = 0
    oversized_packets: int = 0
    transport_errors: int = 0


class UdpDatagramCarrier(AbstractAsyncContextManager["UdpDatagramCarrier"]):
    """Connected UDP endpoint with bounded, non-blocking receive delivery.

    The kernel filters datagrams to the configured peer.  Incoming packets are
    copied into a bounded queue; a full queue drops the newest packet and
    increments a metric instead of blocking the event-loop callback.
    """

    def __init__(self, config: UdpCarrierConfig) -> None:
        self.config = config
        self._transport: asyncio.DatagramTransport | None = None
        self._protocol: _DatagramProtocol | None = None
        self._queue: asyncio.Queue[bytes | None] | None = None
        self._metrics = _MutableMetrics()

    @property
    def is_open(self) -> bool:
        return self._transport is not None and not self._transport.is_closing()

    @property
    def local_address(self) -> tuple[str, int] | None:
        if self._transport is None:
            return None
        address = self._transport.get_extra_info("sockname")
        if not isinstance(address, tuple) or len(address) < 2:
            return None
        return str(address[0]), int(address[1])

    @property
    def metrics(self) -> UdpCarrierMetrics:
        return self._metrics.snapshot()

    async def __aenter__(self) -> Self:
        await self.open()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        await self.close()

    async def open(self) -> None:
        if self._transport is not None:
            raise UdpCarrierError("UDP_CARRIER_STATE", "UDP carrier is already open")
        loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=self.config.queue_capacity)
        protocol = _DatagramProtocol(self)
        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: protocol,
                local_addr=(self.config.bind_host, self.config.bind_port),
                remote_addr=(self.config.peer_host, self.config.peer_port),
            )
        except (OSError, asyncio.TimeoutError) as exc:
            self._queue = None
            raise UdpCarrierError("UDP_CARRIER_OPEN_FAILED", "could not open configured UDP endpoint") from exc
        self._transport = transport
        self._protocol = protocol

    async def close(self) -> None:
        transport = self._transport
        self._transport = None
        self._protocol = None
        queue = self._queue
        if transport is not None:
            transport.close()
        if queue is not None:
            while not queue.empty():
                queue.get_nowait()
            queue.put_nowait(None)

    async def send(self, datagram: bytes | bytearray | memoryview) -> None:
        transport = self._require_transport()
        raw = _validate_datagram(datagram, self.config.max_datagram_bytes)
        try:
            transport.sendto(raw)
        except (OSError, RuntimeError) as exc:
            self._metrics.transport_errors += 1
            raise UdpCarrierError("UDP_SEND_FAILED", "configured UDP endpoint rejected datagram") from exc
        self._metrics.packets_sent += 1

    async def incoming(self) -> AsyncIterator[bytes]:
        """Yield validated datagrams until the carrier is closed."""

        queue = self._require_queue()
        while True:
            item = await queue.get()
            if item is None:
                return
            yield item

    def _receive(self, datagram: bytes) -> None:
        if len(datagram) == 0 or len(datagram) > self.config.max_datagram_bytes:
            self._metrics.oversized_packets += 1
            return
        queue = self._queue
        if queue is None:
            return
        try:
            queue.put_nowait(bytes(datagram))
        except asyncio.QueueFull:
            self._metrics.packets_dropped += 1
            return
        self._metrics.packets_received += 1

    def _error(self) -> None:
        self._metrics.transport_errors += 1

    def _require_transport(self) -> asyncio.DatagramTransport:
        if not self.is_open or self._transport is None:
            raise UdpCarrierError("UDP_CARRIER_STATE", "UDP carrier is not open")
        return self._transport

    def _require_queue(self) -> asyncio.Queue[bytes | None]:
        # Keep a closed queue alive long enough for an iterator that was
        # acquired before close() to observe its sentinel and terminate.
        if self._queue is None:
            raise UdpCarrierError("UDP_CARRIER_STATE", "UDP carrier is not open")
        return self._queue


class _DatagramProtocol(asyncio.DatagramProtocol):
    def __init__(self, owner: UdpDatagramCarrier) -> None:
        self._owner = owner

    def datagram_received(self, data: bytes, _addr: tuple[str, int]) -> None:
        self._owner._receive(data)

    def error_received(self, _exc: Exception) -> None:
        self._owner._error()


@dataclass(slots=True)
class _MutableMetrics:
    packets_received: int = 0
    packets_sent: int = 0
    packets_dropped: int = 0
    oversized_packets: int = 0
    transport_errors: int = 0

    def snapshot(self) -> UdpCarrierMetrics:
        return UdpCarrierMetrics(
            packets_received=self.packets_received,
            packets_sent=self.packets_sent,
            packets_dropped=self.packets_dropped,
            oversized_packets=self.oversized_packets,
            transport_errors=self.transport_errors,
        )


def _validate_datagram(value: bytes | bytearray | memoryview, maximum: int) -> bytes:
    if not isinstance(value, (bytes, bytearray, memoryview)):
        raise UdpCarrierError("UDP_DATAGRAM_INVALID", "UDP datagram must be bytes")
    raw = bytes(value)
    if not raw or len(raw) > maximum:
        raise UdpCarrierError("UDP_DATAGRAM_INVALID", "UDP datagram length is outside configured limits")
    return raw


def _validate_host(value: Any, field: str) -> None:
    if not isinstance(value, str) or not value.strip() or not _HOST_RE.fullmatch(value):
        raise UdpCarrierError("UDP_CARRIER_CONFIG_INVALID", f"{field} must be a non-empty host")


def _validate_port(value: Any, field: str, *, allow_zero: bool) -> None:
    lower = 0 if allow_zero else 1
    if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= 65_535:
        range_text = f"{lower}..65535" if allow_zero else "1..65535"
        raise UdpCarrierError("UDP_CARRIER_CONFIG_INVALID", f"{field} must be an integer in {range_text}")
