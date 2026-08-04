"""Host-only MQTT/UDP session composition.

The coordinator joins the already-tested config, control codec, UDP crypto and
TTS ordering barrier without owning an MQTT client or a socket.  A future
carrier can map its callbacks to these methods while keeping handshake and
generation cleanup deterministic in ordinary unit tests.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import time
from typing import Any

from .mqtt_control import (
    MqttClientHello,
    MqttControlChannel,
    MqttPublish,
    MqttSessionConfig,
    MqttProtocolError,
    decode_control_payload,
    encode_control_payload,
    parse_mqtt_client_hello,
    parse_mqtt_server_hello,
)
from .mqtt_udp import UdpCryptoSession, UdpStreamResult, UdpTtsStreamBarrier


class MqttUdpState:
    """State names exposed to a carrier supervisor/metric adapter."""

    NEW = "NEW"
    HELLO_SENT = "HELLO_SENT"
    READY = "READY"
    CLOSING = "CLOSING"
    CLOSED = "CLOSED"


@dataclass(frozen=True, slots=True)
class MqttSessionEvent:
    """Result of one inbound control callback."""

    message: dict[str, Any] | None = None
    stream_result: UdpStreamResult | None = None
    ignored: bool = False
    closed: bool = False
    reason: str | None = None
    state: str = MqttUdpState.NEW


class MqttUdpSession:
    """Coordinate one MQTT control + UDP audio session without I/O."""

    def __init__(self, config: MqttSessionConfig, *, clock: Callable[[], float] = time.monotonic) -> None:
        self.config = config
        self._clock = clock
        self._state = MqttUdpState.NEW
        self._session_id: str | None = None
        self._channel: MqttControlChannel | None = None
        self._crypto: UdpCryptoSession | None = None
        self._barrier: UdpTtsStreamBarrier | None = None

    @property
    def state(self) -> str:
        return self._state

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def barrier(self) -> UdpTtsStreamBarrier:
        if self._barrier is None:
            raise self._state_error("UDP stream barrier is not initialized")
        return self._barrier

    def build_client_hello(self, message: Mapping[str, Any]) -> MqttPublish:
        """Validate and encode the explicit v3 client hello."""

        if self._state != MqttUdpState.NEW:
            raise self._state_error("client hello is only valid in NEW state")
        hello: MqttClientHello = parse_mqtt_client_hello(message)
        if hello.version != 3:
            raise MqttProtocolError("MQTT_HELLO_VERSION", "Veetee MQTT/UDP session requires explicit version 3")
        self._state = MqttUdpState.HELLO_SENT
        return MqttPublish(
            topic=self.config.publish_topic,
            payload=encode_control_payload(message),
            qos=self.config.control_qos,
            retain=self.config.retain,
        )

    def accept_server_hello(self, message: Mapping[str, Any]) -> None:
        """Import per-session material and reset sequence/barrier state."""

        if self._state not in (MqttUdpState.NEW, MqttUdpState.HELLO_SENT):
            raise self._state_error("server hello is not valid in the current state")
        hello = parse_mqtt_server_hello(message)
        self._session_id = hello.session_id
        self._channel = MqttControlChannel(self.config, hello.session_id)
        self._crypto = UdpCryptoSession(hello.key, hello.nonce)
        self._barrier = UdpTtsStreamBarrier(hello.session_id, clock=self._clock)
        self._state = MqttUdpState.READY

    def receive_control(
        self,
        topic: str,
        payload: bytes | bytearray | memoryview,
        *,
        now: float | None = None,
    ) -> MqttSessionEvent:
        """Route one subscribed MQTT payload to handshake/barrier state."""

        if self._state == MqttUdpState.HELLO_SENT:
            if topic != self.config.subscribe_topic:
                raise MqttProtocolError("MQTT_TOPIC_MISMATCH", "MQTT message arrived on an unexpected topic")
            message = decode_control_payload(payload)
            if message.get("type") != "hello":
                raise self._state_error("only server hello is accepted before READY")
            self.accept_server_hello(message)
            return MqttSessionEvent(message=message, state=self._state)
        if self._state != MqttUdpState.READY:
            raise self._state_error("control message is not valid before handshake or after close")
        assert self._channel is not None
        message = self._channel.receive(topic, payload)
        if message is None:
            return MqttSessionEvent(ignored=True, state=self._state, reason="unknown_message_type")
        stream_result: UdpStreamResult | None = None
        message_type = message.get("type")
        if message_type == "tts" and self._has_stream_boundary(message):
            stream_result = self.barrier.handle_control(message, now=now)
        elif message_type == "abort":
            stream_result = self.barrier.abort(reason="abort")
        elif message_type == "goodbye":
            stream_result = self.barrier.abort(reason="goodbye")
            self._state = MqttUdpState.CLOSED
            self._clear_transport()
            return MqttSessionEvent(
                message=message,
                stream_result=stream_result,
                closed=True,
                state=self._state,
            )
        return MqttSessionEvent(message=message, stream_result=stream_result, state=self._state)

    def publish(self, message: Mapping[str, Any]) -> MqttPublish:
        """Build an upstream publish request after the handshake."""

        if self._state != MqttUdpState.READY or self._channel is None:
            raise self._state_error("publish requires READY state")
        return self._channel.publish(message)

    def build_goodbye(self) -> MqttPublish:
        """Build device-initiated goodbye, then close local generation state."""

        publication = self.publish({"session_id": self._require_session(), "type": "goodbye"})
        self.close()
        return publication

    def abort(self, *, reason: str | None = None) -> MqttPublish:
        """Clear the local playback generation before publishing an abort."""

        session_id = self._require_session()
        self.barrier.abort(reason="abort")
        message: dict[str, Any] = {"session_id": session_id, "type": "abort"}
        if reason is not None:
            message["reason"] = reason
        return self.publish(message)

    def send_udp(self, opus: bytes, *, timestamp_ms: int = 0, ssrc: int | None = None) -> bytes:
        """Encrypt one datagram; the carrier remains responsible for sending it."""

        if self._state != MqttUdpState.READY or self._crypto is None:
            raise self._state_error("UDP send requires READY state")
        return self._crypto.encrypt(opus, timestamp_ms=timestamp_ms, ssrc=ssrc)

    def receive_downlink_udp(self, datagram: bytes, *, now: float | None = None) -> UdpStreamResult:
        """Decrypt one downlink datagram and apply the stream barrier."""

        if self._state != MqttUdpState.READY or self._crypto is None:
            raise self._state_error("UDP receive requires READY state")
        return self.barrier.push(self._crypto.decrypt(datagram), now=now)

    def tick(self, *, now: float | None = None) -> UdpStreamResult:
        if self._state != MqttUdpState.READY:
            raise self._state_error("tick requires READY state")
        return self.barrier.tick(now=now)

    def close(self) -> None:
        """Clear stream/key material before the session generation ends."""

        if self._barrier is not None:
            self._barrier.abort(reason="session_close")
        self._clear_transport()
        self._state = MqttUdpState.CLOSED

    def _clear_transport(self) -> None:
        self._crypto = None
        self._barrier = None
        self._channel = None
        self._session_id = None

    @staticmethod
    def _has_stream_boundary(message: Mapping[str, Any]) -> bool:
        state = message.get("state")
        return (
            isinstance(message.get("audio_stream_id"), int)
            and not isinstance(message.get("audio_stream_id"), bool)
            and ((state == "start" and "start_sequence" in message) or (state == "stop" and "end_sequence" in message))
        )

    def _require_session(self) -> str:
        if self._session_id is None:
            raise self._state_error("session_id is not initialized")
        return self._session_id

    @staticmethod
    def _state_error(message: str) -> MqttProtocolError:
        return MqttProtocolError("MQTT_SESSION_STATE", message)
