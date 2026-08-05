"""Optional MQTT control carrier for the staged MQTT/UDP profile.

The carrier owns only MQTT I/O.  Session, topic/session validation and UDP
crypto remain in :mod:`mqtt_control` and :mod:`mqtt_session`, which keeps the
direct WebSocket path independent and makes this adapter testable without a
broker.  The optional ``mqtt`` extra supplies ``aiomqtt`` at runtime.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol, Self

from .mqtt_control import MQTT_CONTROL_MAX_PAYLOAD_BYTES, MqttPublish, MqttSessionConfig
from .mqtt_control import MqttProtocolError


class MqttMessageLike(Protocol):
    topic: Any
    payload: bytes


class MqttClientLike(Protocol):
    messages: AsyncIterator[MqttMessageLike]

    async def __aenter__(self) -> Self: ...

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None: ...

    async def publish(self, topic: str, payload: bytes, *, qos: int, retain: bool) -> None: ...

    async def subscribe(self, topic: str, *, qos: int) -> Any: ...


ClientFactory = Callable[..., MqttClientLike]


class MqttCarrierError(MqttProtocolError):
    """Typed failure at the optional MQTT dependency/I/O boundary."""


class MqttControlCarrier(AbstractAsyncContextManager["MqttControlCarrier"]):
    """Connect, subscribe and publish bounded control payloads over MQTT.

    The adapter does not decode JSON or mutate a session coordinator.  Callers
    hand it a validated :class:`MqttPublish` and pass yielded ``(topic,
    payload)`` pairs to ``MqttUdpSession.receive_control``.  A finite incoming
    payload ceiling prevents a broker message from bypassing the protocol
    allocator limits.
    """

    def __init__(self, config: MqttSessionConfig, *, client_factory: ClientFactory | None = None) -> None:
        self.config = config
        self._client_factory = client_factory or _load_client_factory
        self._client_context: MqttClientLike | None = None
        self._client: MqttClientLike | None = None

    async def __aenter__(self) -> Self:
        if self._client_context is not None:
            raise MqttCarrierError("MQTT_CARRIER_STATE", "MQTT carrier is already connected")
        client = self._client_factory(
            self.config.endpoint,
            self.config.port,
            username=self.config.username,
            password=self.config.password,
            identifier=self.config.client_id,
            keepalive=self.config.keepalive_seconds,
        )
        self._client_context = client
        try:
            self._client = await client.__aenter__()
            await self._client.subscribe(self.config.subscribe_topic, qos=self.config.control_qos)
        except BaseException:
            self._client = None
            self._client_context = None
            await client.__aexit__(None, None, None)
            raise
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        context = self._client_context
        self._client = None
        self._client_context = None
        if context is not None:
            await context.__aexit__(exc_type, exc, traceback)

    async def publish(self, publication: MqttPublish) -> None:
        client = self._require_client()
        if publication.topic != self.config.publish_topic:
            raise MqttCarrierError("MQTT_TOPIC_MISMATCH", "publish topic does not match the active session")
        if publication.qos != self.config.control_qos or publication.retain != self.config.retain:
            raise MqttCarrierError("MQTT_PUBLISH_POLICY", "publish QoS/retain does not match the active session")
        if not isinstance(publication.payload, bytes):
            raise MqttCarrierError("MQTT_PAYLOAD_INVALID", "MQTT control payload must be bytes")
        if len(publication.payload) > MQTT_CONTROL_MAX_PAYLOAD_BYTES:
            raise MqttCarrierError("MQTT_PAYLOAD_TOO_LARGE", "MQTT control payload exceeds 8192 bytes")
        await client.publish(publication.topic, publication.payload, qos=publication.qos, retain=publication.retain)

    async def incoming(self) -> AsyncIterator[tuple[str, bytes]]:
        """Yield only messages from the configured exact subscribe topic."""

        client = self._require_client()
        async for message in client.messages:
            topic = str(message.topic)
            payload = bytes(message.payload)
            if topic != self.config.subscribe_topic:
                raise MqttCarrierError("MQTT_TOPIC_MISMATCH", "message arrived on an unexpected topic")
            if len(payload) > MQTT_CONTROL_MAX_PAYLOAD_BYTES:
                raise MqttCarrierError("MQTT_PAYLOAD_TOO_LARGE", "MQTT control payload exceeds 8192 bytes")
            yield topic, payload

    def _require_client(self) -> MqttClientLike:
        if self._client is None:
            raise MqttCarrierError("MQTT_CARRIER_STATE", "MQTT carrier is not connected")
        return self._client


def _load_client_factory(*args: Any, **kwargs: Any) -> MqttClientLike:
    try:
        import aiomqtt
    except ImportError as exc:
        raise MqttCarrierError("MQTT_CLIENT_MISSING", "install the optional mqtt extra to enable MQTT transport") from exc
    return aiomqtt.Client(*args, **kwargs)
