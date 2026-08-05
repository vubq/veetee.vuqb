"""Host-only composition for one MQTT-control/UDP-audio session.

The direct WebSocket transport remains the product default.  This module is a
small M3 boundary that owns the ordering between the already-tested MQTT
carrier, UDP datagram carrier and :class:`MqttUdpSession` coordinator.  It does
not register itself with :mod:`veetee_server.app`, decode Opus or start a
broker/socket unless a caller explicitly creates and starts a gateway.

The gateway is intentionally client-shaped: it publishes a v3 client hello,
waits for the server hello to supply the UDP endpoint/key, then opens the
explicitly configured local UDP bind.  A future production gateway can adapt
the same event/send contract without moving protocol validation into socket
callbacks.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from dataclasses import dataclass
import re
from typing import Any, Literal, Self

from .mqtt_carrier import ClientFactory, MqttControlCarrier
from .mqtt_control import (
    MqttSessionConfig,
    parse_mqtt_server_hello,
)
from .mqtt_session import MqttSessionEvent, MqttUdpSession, MqttUdpState
from .mqtt_udp import UdpStreamResult
from .protocol import ProtocolError
from .udp_carrier import (
    UDP_DEFAULT_QUEUE_CAPACITY,
    UDP_MAX_DATAGRAM_BYTES,
    UdpCarrierConfig,
    UdpDatagramCarrier,
)


MQTT_GATEWAY_DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000
MQTT_GATEWAY_MAX_HANDSHAKE_TIMEOUT_MS = 60_000
_HOST_RE = re.compile(r"^[^\s/\x00]+$")


class MqttGatewayError(ProtocolError):
    """Typed failure at the MQTT/UDP composition boundary."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class MqttUdpGatewayConfig:
    """Local bind and bounded I/O settings for an explicit gateway session.

    The remote peer is deliberately absent: it is taken from the validated
    server hello for this session.  ``bind_host``/``bind_port`` still have to
    be supplied by the deployment, so the gateway never discovers or changes
    a host route implicitly.
    """

    bind_host: str
    bind_port: int = 0
    max_datagram_bytes: int = UDP_MAX_DATAGRAM_BYTES
    queue_capacity: int = UDP_DEFAULT_QUEUE_CAPACITY
    handshake_timeout_ms: int = MQTT_GATEWAY_DEFAULT_HANDSHAKE_TIMEOUT_MS

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "MqttUdpGatewayConfig":
        """Parse caller-owned deployment settings without a hidden peer/default."""

        if not isinstance(value, Mapping):
            raise MqttGatewayError("MQTT_GATEWAY_CONFIG_INVALID", "gateway config must be an object")
        try:
            return cls(
                bind_host=value["bind_host"],
                bind_port=value.get("bind_port", 0),
                max_datagram_bytes=value.get("max_datagram_bytes", UDP_MAX_DATAGRAM_BYTES),
                queue_capacity=value.get("queue_capacity", UDP_DEFAULT_QUEUE_CAPACITY),
                handshake_timeout_ms=value.get("handshake_timeout_ms", MQTT_GATEWAY_DEFAULT_HANDSHAKE_TIMEOUT_MS),
            )
        except KeyError as exc:
            raise MqttGatewayError(
                "MQTT_GATEWAY_CONFIG_INVALID", f"missing gateway field: {exc.args[0]}"
            ) from exc
        except (TypeError, ValueError) as exc:
            if isinstance(exc, MqttGatewayError):
                raise
            raise MqttGatewayError("MQTT_GATEWAY_CONFIG_INVALID", "gateway config has invalid values") from exc

    def __post_init__(self) -> None:
        if not isinstance(self.bind_host, str) or not _HOST_RE.fullmatch(self.bind_host) or not self.bind_host.strip():
            raise MqttGatewayError("MQTT_GATEWAY_CONFIG_INVALID", "bind_host must be a non-empty host")
        if isinstance(self.bind_port, bool) or not isinstance(self.bind_port, int) or not 0 <= self.bind_port <= 65_535:
            raise MqttGatewayError("MQTT_GATEWAY_CONFIG_INVALID", "bind_port must be an integer in 0..65535")
        if isinstance(self.max_datagram_bytes, bool) or not isinstance(self.max_datagram_bytes, int) or not 1 <= self.max_datagram_bytes <= UDP_MAX_DATAGRAM_BYTES:
            raise MqttGatewayError(
                "MQTT_GATEWAY_CONFIG_INVALID",
                f"max_datagram_bytes must be in 1..{UDP_MAX_DATAGRAM_BYTES}",
            )
        if isinstance(self.queue_capacity, bool) or not isinstance(self.queue_capacity, int) or not 1 <= self.queue_capacity <= 256:
            raise MqttGatewayError("MQTT_GATEWAY_CONFIG_INVALID", "queue_capacity must be in 1..256")
        if (
            isinstance(self.handshake_timeout_ms, bool)
            or not isinstance(self.handshake_timeout_ms, int)
            or not 1_000 <= self.handshake_timeout_ms <= MQTT_GATEWAY_MAX_HANDSHAKE_TIMEOUT_MS
        ):
            raise MqttGatewayError(
                "MQTT_GATEWAY_CONFIG_INVALID",
                f"handshake_timeout_ms must be in 1000..{MQTT_GATEWAY_MAX_HANDSHAKE_TIMEOUT_MS}",
            )


@dataclass(frozen=True, slots=True)
class MqttGatewayEvent:
    """One carrier event after session validation and UDP decryption."""

    source: Literal["control", "audio"]
    control: MqttSessionEvent | None = None
    stream_result: UdpStreamResult | None = None


UdpCarrierFactory = Callable[[UdpCarrierConfig], UdpDatagramCarrier]


class MqttUdpGateway:
    """Compose MQTT control and encrypted UDP audio for one explicit session.

    ``start`` performs the client/server hello and opens UDP only after the
    server hello has passed the shared validator.  ``events`` owns both receive
    iterators and closes the gateway when the stream ends, is cancelled, or a
    carrier reports an error.  Outbound methods never retry or silently switch
    transport.
    """

    NEW = "NEW"
    HANDSHAKING = "HANDSHAKING"
    READY = "READY"
    CLOSING = "CLOSING"
    CLOSED = "CLOSED"

    def __init__(
        self,
        config: MqttSessionConfig,
        gateway_config: MqttUdpGatewayConfig,
        *,
        client_factory: ClientFactory | None = None,
        udp_carrier_factory: UdpCarrierFactory | None = None,
    ) -> None:
        self.config = config
        self.gateway_config = gateway_config
        self.session = MqttUdpSession(config)
        self._control = MqttControlCarrier(config, client_factory=client_factory)
        self._udp_carrier_factory = udp_carrier_factory or UdpDatagramCarrier
        self._udp: UdpDatagramCarrier | None = None
        self._control_iterator: AsyncIterator[tuple[str, bytes]] | None = None
        self._control_open = False
        self._state = self.NEW

    @property
    def state(self) -> str:
        return self._state

    @property
    def session_id(self) -> str | None:
        return self.session.session_id

    @property
    def udp_carrier(self) -> UdpDatagramCarrier:
        if self._udp is None:
            raise MqttGatewayError("MQTT_GATEWAY_STATE", "UDP carrier is not ready")
        return self._udp

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        await self.close()

    async def start(self, client_hello: Mapping[str, Any]) -> MqttSessionEvent:
        """Connect MQTT, publish client hello, accept server hello and bind UDP."""

        if self._state != self.NEW:
            raise self._state_error("start is only valid in NEW state")
        self._state = self.HANDSHAKING
        try:
            await self._control.__aenter__()
            self._control_open = True
            publication = self.session.build_client_hello(client_hello)
            await self._control.publish(publication)
            incoming = self._control.incoming().__aiter__()
            self._control_iterator = incoming
            deadline = self.gateway_config.handshake_timeout_ms / 1000
            while True:
                try:
                    topic, payload = await asyncio.wait_for(anext(incoming), timeout=deadline)
                except asyncio.TimeoutError as exc:
                    raise MqttGatewayError("MQTT_HANDSHAKE_TIMEOUT", "server hello was not received before the deadline") from exc
                except StopAsyncIteration as exc:
                    raise MqttGatewayError("MQTT_CONTROL_CLOSED", "MQTT control stream closed during handshake") from exc
                event = self.session.receive_control(topic, payload)
                if event.message is None or event.message.get("type") != "hello":
                    raise MqttGatewayError("MQTT_HELLO_INVALID", "handshake did not produce a server hello")
                server_hello = parse_mqtt_server_hello(event.message)
                udp_config = UdpCarrierConfig(
                    bind_host=self.gateway_config.bind_host,
                    bind_port=self.gateway_config.bind_port,
                    peer_host=server_hello.server,
                    peer_port=server_hello.port,
                    max_datagram_bytes=self.gateway_config.max_datagram_bytes,
                    queue_capacity=self.gateway_config.queue_capacity,
                )
                udp = self._udp_carrier_factory(udp_config)
                try:
                    await udp.open()
                except BaseException as exc:
                    await udp.close()
                    raise MqttGatewayError("UDP_CARRIER_OPEN_FAILED", "could not open UDP endpoint from server hello") from exc
                self._udp = udp
                self._state = self.READY
                return event
        except BaseException:
            await self.close()
            raise

    async def send_control(self, message: Mapping[str, Any]) -> None:
        """Publish one validated control message on the active MQTT topic."""

        self._require_ready()
        await self._control.publish(self.session.publish(message))

    async def send_audio(self, opus: bytes, *, timestamp_ms: int = 0, ssrc: int | None = None) -> None:
        """Encrypt and send one bounded UDP payload; no Opus decode is done."""

        self._require_ready()
        await self.udp_carrier.send(self.session.send_udp(opus, timestamp_ms=timestamp_ms, ssrc=ssrc))

    async def abort(self, *, reason: str | None = None) -> None:
        """Clear the local playback barrier, then publish an explicit abort."""

        self._require_ready()
        await self._control.publish(self.session.abort(reason=reason))

    async def goodbye(self) -> None:
        """Publish device-initiated goodbye and close both carriers."""

        self._require_ready()
        await self._control.publish(self.session.build_goodbye())
        await self.close()

    async def events(self) -> AsyncIterator[MqttGatewayEvent]:
        """Yield validated control/audio events until either carrier ends."""

        self._require_ready()
        control_iterator = self._control_iterator
        if control_iterator is None or self._udp is None:
            raise self._state_error("receive iterators are not initialized")
        udp_iterator = self._udp.incoming().__aiter__()
        tasks: dict[str, asyncio.Task[Any]] = {
            "control": asyncio.create_task(anext(control_iterator), name=f"mqtt-control-{self.session_id}"),
            "audio": asyncio.create_task(anext(udp_iterator), name=f"udp-audio-{self.session_id}"),
        }
        try:
            while tasks:
                done, _ = await asyncio.wait(tuple(tasks.values()), return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    source = next(key for key, value in tasks.items() if value is task)
                    del tasks[source]
                    if source == "control":
                        try:
                            topic, payload = task.result()
                        except StopAsyncIteration as exc:
                            raise MqttGatewayError("MQTT_CONTROL_CLOSED", "MQTT control stream closed") from exc
                        event = self.session.receive_control(topic, payload)
                        yield MqttGatewayEvent(source="control", control=event)
                        if event.closed:
                            return
                        tasks[source] = asyncio.create_task(anext(control_iterator), name=f"mqtt-control-{self.session_id}")
                    else:
                        try:
                            datagram = task.result()
                        except StopAsyncIteration as exc:
                            raise MqttGatewayError("UDP_CARRIER_CLOSED", "UDP audio stream closed") from exc
                        result = self.session.receive_downlink_udp(datagram)
                        yield MqttGatewayEvent(source="audio", stream_result=result)
                        tasks[source] = asyncio.create_task(anext(udp_iterator), name=f"udp-audio-{self.session_id}")
        finally:
            for task in tasks.values():
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks.values(), return_exceptions=True)
            await _close_shielded(self)

    async def close(self) -> None:
        """Close session/key material and both carrier resources idempotently."""

        if self._state == self.CLOSED:
            return
        self._state = self.CLOSING
        try:
            self.session.close()
        finally:
            udp = self._udp
            self._udp = None
            try:
                if udp is not None:
                    await udp.close()
            finally:
                try:
                    if self._control_open:
                        self._control_open = False
                        await self._control.__aexit__(None, None, None)
                finally:
                    self._control_iterator = None
                    self._state = self.CLOSED

    def _require_ready(self) -> None:
        if self._state != self.READY or self.session.state != MqttUdpState.READY:
            raise self._state_error("gateway is not READY")

    @staticmethod
    def _state_error(message: str) -> MqttGatewayError:
        return MqttGatewayError("MQTT_GATEWAY_STATE", message)


async def _close_shielded(gateway: MqttUdpGateway) -> None:
    cleanup = asyncio.create_task(gateway.close(), name="mqtt-gateway-close")
    try:
        await asyncio.shield(cleanup)
    except asyncio.CancelledError:
        await cleanup
        raise
