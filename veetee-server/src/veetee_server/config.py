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
    config_poll_ms: int
    log_level: str
    max_ws_message_bytes: int

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
            config_poll_ms=poll_ms,
            log_level=os.getenv("VEETEE_LOG_LEVEL", "INFO").upper(),
            max_ws_message_bytes=_positive_int(
                "VEETEE_MAX_WS_MESSAGE_BYTES",
                os.getenv("VEETEE_MAX_WS_MESSAGE_BYTES", "16384"),
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


def _required_string(value: dict[str, Any], name: str) -> str:
    result = value.get(name)
    if not isinstance(result, str) or not result.strip():
        raise ConfigurationError(f"snapshot.{name} must be a non-empty string")
    return result
