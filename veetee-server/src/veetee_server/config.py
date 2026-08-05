"""Bootstrap configuration and dynamic runtime snapshot loading."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from typing import Any


class ConfigurationError(ValueError):
    """Invalid bootstrap or runtime snapshot."""


@dataclass(frozen=True, slots=True)
class AutoTurnPolicy:
    """Optional first-speech watchdog for an on-device wake turn."""

    no_speech_timeout_ms: int
    alert_status: str
    alert_message: str
    alert_emotion: str


@dataclass(frozen=True, slots=True)
class ServerConfig:
    host: str
    port: int
    ws_path: str
    config_source: str
    fixture_file: Path | None
    manager_api_url: str | None
    machine_token_file: Path | None
    allow_insecure_local_config: bool
    manager_runtime_path: str
    history_enabled: bool
    history_path: str
    history_queue_size: int
    history_request_timeout_ms: int
    history_max_retries: int
    history_retry_backoff_ms: int
    history_shutdown_drain_ms: int
    presence_enabled: bool
    presence_path: str
    presence_queue_size: int
    presence_request_timeout_ms: int
    presence_max_retries: int
    presence_retry_backoff_ms: int
    presence_shutdown_drain_ms: int
    config_poll_ms: int
    log_level: str
    max_ws_message_bytes: int
    hello_timeout_ms: int

    @classmethod
    def from_env(cls) -> "ServerConfig":
        source = os.getenv("VEETEE_CONFIG_SOURCE", "fixture").strip().lower()
        if source not in {"fixture", "manager"}:
            raise ConfigurationError("VEETEE_CONFIG_SOURCE must be fixture or manager")
        fixture = os.getenv("VEETEE_CONFIG_FIXTURE_FILE")
        manager_url = os.getenv("VEETEE_MANAGER_API_URL")
        token_file = os.getenv("VEETEE_MACHINE_TOKEN_FILE")
        if source == "fixture" and not fixture:
            raise ConfigurationError("VEETEE_CONFIG_FIXTURE_FILE is required for fixture source")
        if source == "manager" and not manager_url:
            raise ConfigurationError("VEETEE_MANAGER_API_URL is required for manager source")
        allow_insecure = os.getenv("VEETEE_ALLOW_INSECURE_LOCAL_CONFIG", "false").strip().lower() in {"1", "true", "yes"}
        if source == "manager" and not token_file and not allow_insecure:
            raise ConfigurationError("VEETEE_MACHINE_TOKEN_FILE is required for manager source")
        history_enabled = _bool_env("VEETEE_HISTORY_ENABLED", False)
        if history_enabled and not manager_url:
            raise ConfigurationError("VEETEE_MANAGER_API_URL is required when history reporting is enabled")
        presence_enabled = _bool_env("VEETEE_PRESENCE_ENABLED", False)
        if presence_enabled and not manager_url:
            raise ConfigurationError("VEETEE_MANAGER_API_URL is required when presence reporting is enabled")
        port = _positive_int("VEETEE_VOICE_PORT", os.getenv("VEETEE_VOICE_PORT", "8000"))
        poll_ms = _positive_int("VEETEE_CONFIG_POLL_MS", os.getenv("VEETEE_CONFIG_POLL_MS", "2000"))
        return cls(
            host=os.getenv("VEETEE_VOICE_HOST", "127.0.0.1"),
            port=port,
            ws_path=_normalise_path(os.getenv("VEETEE_WS_PATH", "/veetee/v1/")),
            config_source=source,
            fixture_file=Path(fixture).expanduser() if fixture else None,
            manager_api_url=manager_url.rstrip("/") if manager_url else None,
            machine_token_file=Path(token_file).expanduser() if token_file else None,
            allow_insecure_local_config=allow_insecure,
            manager_runtime_path=_normalise_path(os.getenv("VEETEE_MANAGER_RUNTIME_PATH", "/internal/v1/runtime-config")),
            history_enabled=history_enabled,
            history_path=_normalise_path(os.getenv("VEETEE_HISTORY_PATH", "/internal/v1/conversations/turns")),
            history_queue_size=_bounded_int("VEETEE_HISTORY_QUEUE_SIZE", os.getenv("VEETEE_HISTORY_QUEUE_SIZE", "64"), minimum=1, maximum=4096),
            history_request_timeout_ms=_bounded_int("VEETEE_HISTORY_REQUEST_TIMEOUT_MS", os.getenv("VEETEE_HISTORY_REQUEST_TIMEOUT_MS", "2000"), minimum=1, maximum=30000),
            history_max_retries=_bounded_int("VEETEE_HISTORY_MAX_RETRIES", os.getenv("VEETEE_HISTORY_MAX_RETRIES", "2"), minimum=0, maximum=8),
            history_retry_backoff_ms=_bounded_int("VEETEE_HISTORY_RETRY_BACKOFF_MS", os.getenv("VEETEE_HISTORY_RETRY_BACKOFF_MS", "100"), minimum=0, maximum=10000),
            history_shutdown_drain_ms=_bounded_int("VEETEE_HISTORY_SHUTDOWN_DRAIN_MS", os.getenv("VEETEE_HISTORY_SHUTDOWN_DRAIN_MS", "500"), minimum=0, maximum=30000),
            presence_enabled=presence_enabled,
            presence_path=_normalise_path(os.getenv("VEETEE_PRESENCE_PATH", "/internal/v1/devices/presence")),
            presence_queue_size=_bounded_int("VEETEE_PRESENCE_QUEUE_SIZE", os.getenv("VEETEE_PRESENCE_QUEUE_SIZE", "32"), minimum=1, maximum=1024),
            presence_request_timeout_ms=_bounded_int("VEETEE_PRESENCE_REQUEST_TIMEOUT_MS", os.getenv("VEETEE_PRESENCE_REQUEST_TIMEOUT_MS", "1000"), minimum=1, maximum=30000),
            presence_max_retries=_bounded_int("VEETEE_PRESENCE_MAX_RETRIES", os.getenv("VEETEE_PRESENCE_MAX_RETRIES", "1"), minimum=0, maximum=8),
            presence_retry_backoff_ms=_bounded_int("VEETEE_PRESENCE_RETRY_BACKOFF_MS", os.getenv("VEETEE_PRESENCE_RETRY_BACKOFF_MS", "100"), minimum=0, maximum=10000),
            presence_shutdown_drain_ms=_bounded_int("VEETEE_PRESENCE_SHUTDOWN_DRAIN_MS", os.getenv("VEETEE_PRESENCE_SHUTDOWN_DRAIN_MS", "500"), minimum=0, maximum=30000),
            config_poll_ms=poll_ms,
            log_level=os.getenv("VEETEE_LOG_LEVEL", "INFO").upper(),
            max_ws_message_bytes=_positive_int(
                "VEETEE_MAX_WS_MESSAGE_BYTES",
                os.getenv("VEETEE_MAX_WS_MESSAGE_BYTES", "16384"),
            ),
            hello_timeout_ms=_bounded_int(
                "VEETEE_HELLO_TIMEOUT_MS",
                os.getenv("VEETEE_HELLO_TIMEOUT_MS", "10000"),
                minimum=1000,
                maximum=60000,
            ),
        )


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    raw: dict[str, Any]
    checksum: str
    revision: int
    schema_version: int

    @property
    def assistant_id(self) -> str:
        return _required_string(self.raw, "assistantId")

    @property
    def locale(self) -> str:
        return _required_string(self.raw, "locale")

    @property
    def providers(self) -> dict[str, dict[str, Any]]:
        value = self.raw.get("providers")
        if not isinstance(value, dict):
            raise ConfigurationError("snapshot.providers must be an object")
        return value

    def provider(self, kind: str) -> dict[str, Any]:
        value = self.providers.get(kind)
        if not isinstance(value, dict):
            raise ConfigurationError(f"provider selection missing: {kind}")
        if value.get("mode") == "disabled":
            raise ConfigurationError(f"provider is disabled: {kind}")
        if not isinstance(value.get("providerId"), str):
            raise ConfigurationError(f"providerId missing: {kind}")
        return value

    def auto_turn_policy(self) -> AutoTurnPolicy | None:
        """Return the validated optional no-speech policy from this snapshot.

        The policy is intentionally absent by default for wire compatibility and
        to avoid imposing an arbitrary conversation timeout. A configured policy
        only bounds the wait before the first confirmed speech frame.
        """

        raw = self.raw.get("autoTurn")
        if raw is None:
            return None
        if not isinstance(raw, dict):
            raise ConfigurationError("snapshot.autoTurn must be an object")
        enabled = raw.get("enabled", False)
        if not isinstance(enabled, bool):
            raise ConfigurationError("snapshot.autoTurn.enabled must be a boolean")
        if not enabled:
            return None
        timeout = raw.get("noSpeechTimeoutMs")
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1_000 <= timeout <= 60_000:
            raise ConfigurationError("snapshot.autoTurn.noSpeechTimeoutMs must be between 1000 and 60000")
        alert = raw.get("noSpeechAlert")
        if not isinstance(alert, dict):
            raise ConfigurationError("snapshot.autoTurn.noSpeechAlert must be an object")
        status = _required_bounded_string(alert, "status", 32, "snapshot.autoTurn.noSpeechAlert")
        message = _required_bounded_string(alert, "message", 512, "snapshot.autoTurn.noSpeechAlert")
        emotion = _required_bounded_string(alert, "emotion", 64, "snapshot.autoTurn.noSpeechAlert")
        return AutoTurnPolicy(timeout, status, message, emotion)


def load_snapshot(path: Path) -> RuntimeSnapshot:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigurationError(f"cannot load runtime snapshot: {path}") from exc
    if not isinstance(raw, dict):
        raise ConfigurationError("runtime snapshot must be an object")
    schema_version = raw.get("schemaVersion")
    revision = raw.get("revision")
    if not isinstance(schema_version, int) or schema_version < 1:
        raise ConfigurationError("snapshot.schemaVersion must be a positive integer")
    if not isinstance(revision, int) or revision < 1:
        raise ConfigurationError("snapshot.revision must be a positive integer")
    canonical = json.dumps(raw, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    return RuntimeSnapshot(raw=raw, checksum=hashlib.sha256(canonical).hexdigest(), revision=revision, schema_version=schema_version)


def _normalise_path(value: str) -> str:
    value = "/" + value.strip("/") + "/"
    return "/" if value == "//" else value


def _positive_int(name: str, value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if parsed <= 0:
        raise ConfigurationError(f"{name} must be positive")
    return parsed


def _bounded_int(name: str, value: str, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer") from exc
    if parsed < minimum or parsed > maximum:
        raise ConfigurationError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be a boolean")


def _required_string(value: dict[str, Any], name: str) -> str:
    result = value.get(name)
    if not isinstance(result, str) or not result.strip():
        raise ConfigurationError(f"snapshot.{name} must be a non-empty string")
    return result


def _required_bounded_string(value: dict[str, Any], name: str, maximum: int, prefix: str) -> str:
    result = value.get(name)
    if not isinstance(result, str) or not result.strip() or len(result) > maximum:
        raise ConfigurationError(f"{prefix}.{name} must be a non-empty string of at most {maximum} characters")
    return result.strip()
