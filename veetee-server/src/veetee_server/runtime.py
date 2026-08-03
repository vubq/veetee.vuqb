"""Dynamic snapshot polling and atomic provider generation activation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import tempfile
from typing import Any, Awaitable, Callable

import httpx

from .config import ConfigurationError, RuntimeSnapshot, ServerConfig, load_snapshot
from .providers import ProviderError, ProviderRegistry
from .secrets import EncryptedFileSecretResolver


LOG = logging.getLogger("veetee.voice.runtime")


@dataclass(frozen=True, slots=True)
class RuntimeView:
    snapshot: RuntimeSnapshot
    registry: ProviderRegistry


class RuntimeConfigManager:
    def __init__(
        self,
        config: ServerConfig,
        *,
        secret_file: Path | None = None,
        secret_resolver: EncryptedFileSecretResolver | None = None,
    ) -> None:
        self.config = config
        self.secret_file = secret_file
        self.secret_resolver = secret_resolver
        self._view: RuntimeView | None = None
        self._etag: str | None = None
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self._listeners: list[Callable[[RuntimeView], Awaitable[None]]] = []
        self.activation_failures = 0
        self.last_activation_error_type: str | None = None

    @property
    def view(self) -> RuntimeView:
        if self._view is None:
            raise RuntimeError("runtime configuration is not ready")
        return self._view

    def add_listener(self, listener: Callable[[RuntimeView], Awaitable[None]]) -> None:
        self._listeners.append(listener)

    async def start(self) -> None:
        source = await self._read_source()
        await self._activate(source)
        self._task = asyncio.create_task(self._poll_loop(), name="runtime-config-poll")

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
        self._task = None

    async def refresh_now(self) -> bool:
        source = await self._read_source()
        if source.checksum == self.view.snapshot.checksum:
            return False
        return await self._activate(source)

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(self.config.config_poll_ms / 1000)
            try:
                await self.refresh_now()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.activation_failures += 1
                self.last_activation_error_type = type(exc).__name__
                LOG.warning("runtime refresh failed error_type=%s", self.last_activation_error_type)

    async def _read_source(self) -> RuntimeSnapshot:
        if self.config.config_source == "fixture":
            assert self.config.fixture_file is not None
            return load_snapshot(self.config.fixture_file)
        assert self.config.manager_api_url is not None
        token = None
        if self.config.machine_token_file is not None:
            try:
                token = self.config.machine_token_file.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise ConfigurationError("cannot read machine token file") from exc
            if not token:
                raise ConfigurationError("machine token file is empty")
        elif not self.config.allow_insecure_local_config:
            raise ConfigurationError("machine token is required outside explicit local config mode")
        path = self.config.manager_api_url + self.config.manager_runtime_path.rstrip("/")
        headers = {"Authorization": f"Bearer {token}"}
        if token is None:
            headers.pop("Authorization")
        if self._etag:
            headers["If-None-Match"] = self._etag
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(path, headers=headers)
        if response.status_code == 304:
            return self.view.snapshot
        if response.status_code >= 400:
            raise ConfigurationError(f"manager runtime-config returned HTTP {response.status_code}")
        etag = response.headers.get("etag")
        if etag:
            self._etag = etag
        try:
            raw = response.json()
        except ValueError as exc:
            raise ConfigurationError("manager runtime-config is not JSON") from exc
        if not isinstance(raw, dict):
            raise ConfigurationError("manager runtime-config must be an object")
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", encoding="utf-8") as handle:
            json.dump(raw, handle, ensure_ascii=False)
            handle.flush()
            return load_snapshot(Path(handle.name))

    async def _activate(self, snapshot: RuntimeSnapshot) -> bool:
        async with self._lock:
            try:
                registry = ProviderRegistry(snapshot, secret_file=self.secret_file, secret_resolver=self.secret_resolver)
                await registry.prepare()
                view = RuntimeView(snapshot=snapshot, registry=registry)
            except (ConfigurationError, ProviderError) as exc:
                self.activation_failures += 1
                self.last_activation_error_type = type(exc).__name__
                LOG.warning("runtime activation failed error_type=%s", self.last_activation_error_type)
                return False
            old = self._view
            self._view = view
            self.last_activation_error_type = None
            if old is not None:
                for listener in self._listeners:
                    await listener(view)
            return True
