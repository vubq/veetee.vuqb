"""Pure host-side MQTT control boundary for the staged UDP profile.

This module intentionally stops before an MQTT client or broker.  It validates
the opaque topic/session configuration, encodes one JSON object per MQTT
payload, and provides a small publish/subscribe adapter that a future carrier
can call.  No credential is logged or included in a redacted configuration
view, and no network side effect happens here.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
import json
import re
from typing import Any

from .mqtt_udp import UdpServerHello, parse_udp_server_hello
from .protocol import ProtocolError


MQTT_CONTROL_MAX_PAYLOAD_BYTES = 8_192
MQTT_DEFAULT_PORT = 8_883
MQTT_DEFAULT_KEEPALIVE_SECONDS = 240
MQTT_DEFAULT_QOS = 1
JSON_SAFE_INTEGER_MAX = (1 << 53) - 1
_HOST_RE = re.compile(r"^[^\s/\x00]+$")


class MqttProtocolError(ProtocolError):
    """Malformed MQTT configuration, topic, or control payload."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class MqttSessionConfig:
    """Validated MQTT settings supplied by an activated device config."""

    endpoint: str
    port: int
    client_id: str
    publish_topic: str
    subscribe_topic: str
    username: str | None = field(default=None, repr=False)
    password: str | None = field(default=None, repr=False)
    keepalive_seconds: int = MQTT_DEFAULT_KEEPALIVE_SECONDS
    control_qos: int = MQTT_DEFAULT_QOS
    retain: bool = False

    def redacted(self) -> dict[str, Any]:
        """Return an operator-safe view without credential material."""

        return {
            "endpoint": self.endpoint,
            "port": self.port,
            "client_id": self.client_id,
            "publish_topic": self.publish_topic,
            "subscribe_topic": self.subscribe_topic,
            "has_username": self.username is not None,
            "has_password": self.password is not None,
            "keepalive_seconds": self.keepalive_seconds,
            "control_qos": self.control_qos,
            "retain": self.retain,
        }


@dataclass(frozen=True, slots=True)
class MqttClientHello:
    """Validated device hello carried by MQTT before UDP is opened."""

    version: int | None
    transport: str
    features: dict[str, Any]
    audio_params: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class MqttPublish:
    """Carrier-neutral publish request for a future MQTT adapter."""

    topic: str
    payload: bytes
    qos: int
    retain: bool


def parse_mqtt_session_config(value: Mapping[str, Any]) -> MqttSessionConfig:
    """Validate the normative §5.2 settings without resolving the broker."""

    if not isinstance(value, Mapping):
        raise MqttProtocolError("MQTT_CONFIG_INVALID", "MQTT config must be an object")
    endpoint_value = _required_text(value.get("endpoint"), "endpoint")
    endpoint, port = _parse_endpoint(endpoint_value)
    client_id = _required_text(value.get("client_id"), "client_id")
    publish_topic = _parse_topic(value.get("publish_topic"), "publish_topic", allow_wildcard=False)
    subscribe_topic = _parse_topic(value.get("subscribe_topic"), "subscribe_topic", allow_wildcard=False)

    username = _optional_text(value.get("username"), "username")
    password = _optional_text(value.get("password"), "password")
    keepalive = value.get("keepalive", MQTT_DEFAULT_KEEPALIVE_SECONDS)
    if isinstance(keepalive, bool) or not isinstance(keepalive, int) or not 1 <= keepalive <= 65_535:
        raise MqttProtocolError("MQTT_CONFIG_INVALID", "keepalive must be an integer in 1..65535")
    qos = value.get("control_qos", MQTT_DEFAULT_QOS)
    if isinstance(qos, bool) or qos not in (0, 1):
        raise MqttProtocolError("MQTT_CONFIG_INVALID", "control_qos must be 0 or 1")
    retain = value.get("retain", False)
    if not isinstance(retain, bool):
        raise MqttProtocolError("MQTT_CONFIG_INVALID", "retain must be boolean")
    if retain:
        raise MqttProtocolError("MQTT_CONFIG_RETAIN", "state-changing control must not use retained MQTT messages")

    return MqttSessionConfig(
        endpoint=endpoint,
        port=port,
        client_id=client_id,
        publish_topic=publish_topic,
        subscribe_topic=subscribe_topic,
        username=username,
        password=password,
        keepalive_seconds=keepalive,
        control_qos=qos,
        retain=False,
    )


def encode_control_payload(message: Mapping[str, Any]) -> bytes:
    """Encode exactly one bounded UTF-8 JSON object for MQTT."""

    if not isinstance(message, Mapping):
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT control message must be an object")
    _validate_json_values(message)
    try:
        encoded = json.dumps(
            dict(message),
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, UnicodeError, ValueError) as exc:
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT control message is not JSON encodable") from exc
    if len(encoded) > MQTT_CONTROL_MAX_PAYLOAD_BYTES:
        raise MqttProtocolError("MQTT_PAYLOAD_TOO_LARGE", "MQTT control payload exceeds 8192 bytes")
    return encoded


def decode_control_payload(payload: bytes | bytearray | memoryview) -> dict[str, Any]:
    """Decode and validate one MQTT payload before routing it to a handler."""

    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT payload must be bytes")
    raw = bytes(payload)
    if len(raw) > MQTT_CONTROL_MAX_PAYLOAD_BYTES:
        raise MqttProtocolError("MQTT_PAYLOAD_TOO_LARGE", "MQTT control payload exceeds 8192 bytes")
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, parse_constant=_reject_json_constant)
    except (UnicodeError, TypeError, json.JSONDecodeError, ValueError) as exc:
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT payload is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT payload must be one JSON object")
    _validate_json_values(value)
    return value


def parse_mqtt_client_hello(message: Mapping[str, Any]) -> MqttClientHello:
    """Validate the client hello that precedes UDP socket creation."""

    if not isinstance(message, Mapping) or message.get("type") != "hello":
        raise MqttProtocolError("MQTT_HELLO_INVALID", "MQTT client hello must have type hello")
    version = message.get("version")
    if version is not None and (isinstance(version, bool) or version != 3):
        raise MqttProtocolError("MQTT_HELLO_VERSION", "unsupported MQTT/UDP profile version")
    if message.get("transport") != "udp":
        raise MqttProtocolError("MQTT_HELLO_INVALID", "MQTT client hello must select udp transport")
    features = message.get("features", {})
    if not isinstance(features, Mapping):
        raise MqttProtocolError("MQTT_HELLO_INVALID", "MQTT hello features must be an object")
    audio = message.get("audio_params")
    audio_params = _parse_audio_params(audio) if audio is not None else None
    return MqttClientHello(
        version=version,
        transport="udp",
        features=dict(features),
        audio_params=audio_params,
    )


def parse_mqtt_server_hello(message: Mapping[str, Any]) -> UdpServerHello:
    """Share the UDP server-hello validator with the MQTT control boundary."""

    try:
        return parse_udp_server_hello(message)
    except ProtocolError as exc:
        raise MqttProtocolError("MQTT_SERVER_HELLO_INVALID", str(exc)) from exc


@dataclass(frozen=True, slots=True)
class MqttControlChannel:
    """Topic/session gate for an already-established MQTT session.

    ``publish`` and ``receive`` return carrier-neutral values.  A real MQTT
    client can map them to its library without moving validation into a socket
    callback or exposing credentials to the rest of the server.
    """

    config: MqttSessionConfig
    session_id: str

    def __post_init__(self) -> None:
        if not isinstance(self.session_id, str) or not self.session_id.strip():
            raise ValueError("session_id must be a non-empty string")

    def publish(self, message: Mapping[str, Any]) -> MqttPublish:
        """Build an upstream publish request after session validation."""

        _validate_message_session(message, self.session_id, direction="upstream")
        return MqttPublish(
            topic=self.config.publish_topic,
            payload=encode_control_payload(message),
            qos=self.config.control_qos,
            retain=self.config.retain,
        )

    def receive(self, topic: str, payload: bytes | bytearray | memoryview) -> dict[str, Any] | None:
        """Decode the exact subscribe topic; unknown message types are ignored."""

        if topic != self.config.subscribe_topic:
            raise MqttProtocolError("MQTT_TOPIC_MISMATCH", "MQTT message arrived on an unexpected topic")
        message = decode_control_payload(payload)
        known_types = {
            "alert",
            "custom",
            "goodbye",
            "hello",
            "iot",
            "llm",
            "mcp",
            "pong",
            "stt",
            "system",
            "tts",
        }
        if message.get("type") not in known_types:
            return None
        _validate_message_session(message, self.session_id, direction="downstream")
        if message.get("type") == "hello":
            parse_mqtt_server_hello(message)
        return message


def _parse_endpoint(value: str) -> tuple[str, int]:
    if "://" in value:
        raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint must be a host, not a URI")
    if value.startswith("["):
        closing = value.find("]")
        if closing <= 1:
            raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "bracketed MQTT endpoint host is invalid")
        host = _validate_host(value[1:closing])
        suffix = value[closing + 1 :]
        if not suffix:
            return host, MQTT_DEFAULT_PORT
        if not suffix.startswith(":"):
            raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint suffix is invalid")
        return host, _parse_port(suffix[1:])
    if value.count(":") == 1:
        host, raw_port = value.rsplit(":", 1)
        if not host:
            raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint host is empty")
        return _validate_host(host), _parse_port(raw_port)
    return _validate_host(value), MQTT_DEFAULT_PORT


def _validate_host(value: str) -> str:
    if not _HOST_RE.fullmatch(value) or value.startswith(".") or value.endswith("."):
        raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint host is invalid")
    return value


def _parse_port(value: str) -> int:
    if not value.isdigit():
        raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint port is invalid")
    port = int(value)
    if not 1 <= port <= 65_535:
        raise MqttProtocolError("MQTT_ENDPOINT_INVALID", "MQTT endpoint port is outside 1..65535")
    return port


def _parse_topic(value: Any, name: str, *, allow_wildcard: bool) -> str:
    topic = _required_text(value, name)
    if len(topic.encode("utf-8")) > 65_535 or "\x00" in topic:
        raise MqttProtocolError("MQTT_TOPIC_INVALID", f"{name} exceeds MQTT topic limits")
    if not allow_wildcard and ("+" in topic or "#" in topic):
        raise MqttProtocolError("MQTT_TOPIC_INVALID", f"{name} must be an opaque exact topic")
    return topic


def _required_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MqttProtocolError("MQTT_CONFIG_INVALID", f"{name} must be a non-empty string")
    return value.strip()


def _optional_text(value: Any, name: str) -> str | None:
    if value is None:
        return None
    return _required_text(value, name)


def _parse_audio_params(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise MqttProtocolError("MQTT_AUDIO_PARAMS_INVALID", "MQTT audio_params must be an object")
    if value.get("format") != "opus" or value.get("channels") != 1:
        raise MqttProtocolError("MQTT_AUDIO_PARAMS_INVALID", "MQTT audio_params must be mono Opus")
    for name in ("sample_rate", "frame_duration"):
        item = value.get(name)
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0:
            raise MqttProtocolError("MQTT_AUDIO_PARAMS_INVALID", f"MQTT {name} must be positive")
    return dict(value)


def _validate_message_session(message: Mapping[str, Any], session_id: str, *, direction: str) -> None:
    if not isinstance(message, Mapping):
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT control message must be an object")
    message_type = message.get("type")
    if not isinstance(message_type, str) or not message_type:
        raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "MQTT control message type is required")
    if direction == "upstream" and message_type in {"hello", "ping"}:
        return
    raw_session = message.get("session_id")
    if not isinstance(raw_session, str) or raw_session.strip() != session_id:
        raise MqttProtocolError("MQTT_SESSION_MISMATCH", "MQTT message session_id does not match current session")


def _validate_json_values(value: Any) -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, int):
        if not -JSON_SAFE_INTEGER_MAX <= value <= JSON_SAFE_INTEGER_MAX:
            raise MqttProtocolError("MQTT_JSON_NUMBER_INVALID", "JSON integer exceeds safe receiver range")
        return
    if isinstance(value, float):
        if not (value == value and abs(value) != float("inf")):
            raise MqttProtocolError("MQTT_JSON_NUMBER_INVALID", "JSON number must be finite")
        return
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str):
                raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "JSON object keys must be strings")
            _validate_json_values(item)
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _validate_json_values(item)
        return
    raise MqttProtocolError("MQTT_PAYLOAD_INVALID", "value is not JSON serializable")


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"invalid JSON constant: {value}")
