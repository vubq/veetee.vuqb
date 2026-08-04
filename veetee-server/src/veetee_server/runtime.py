"""Dynamic snapshot polling and atomic provider generation activation."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import tempfile
from typing import Awaitable, Callable

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
        test_groq_keys_file: Path | None = None,
    ) -> None:
        self.config = config
        self.secret_file = secret_file
        self.secret_resolver = secret_resolver
        self.test_groq_keys_file = test_groq_keys_file
        self._view: RuntimeView | None = None
        self._etag: str | None = None
        self._lock = asyncio.Lock()
        # Provider/model preparation can take seconds. Keep it outside the
        # view/lease lock so an active session can still acquire or release
        # its generation while a candidate is warming.
        self._activation_lock = asyncio.Lock()
        self._http_lock = asyncio.Lock()
        self._http_client: httpx.AsyncClient | None = None
        self._task: asyncio.Task[None] | None = None
        self._listeners: list[Callable[[RuntimeView], Awaitable[None]]] = []
        self._retired: dict[int, RuntimeView] = {}
        self._leases: dict[int, int] = {}
        self.activation_failures = 0
        self.last_activation_error_type: str | None = None

    @property
    def view(self) -> RuntimeView:
        if self._view is None:
            raise RuntimeError("runtime configuration is not ready")
        return self._view

    def add_listener(self, listener: Callable[[RuntimeView], Awaitable[None]]) -> None:
        self._listeners.append(listener)

    async def acquire_view(self) -> RuntimeView:
        """Pin the current provider generation for one WebSocket session."""

        async with self._lock:
            if self._view is None:
                raise RuntimeError("runtime configuration is not ready")
            key = id(self._view)
            self._leases[key] = self._leases.get(key, 0) + 1
            return self._view

    async def release_view(self, view: RuntimeView) -> None:
        """Release a session lease and close a retired generation when drained."""

        retired: RuntimeView | None = None
        key = id(view)
        async with self._lock:
            count = self._leases.get(key, 0)
            if count <= 1:
                self._leases.pop(key, None)
                retired = self._retired.pop(key, None)
            else:
                self._leases[key] = count - 1
        if retired is not None:
            await self._close_registry(retired.registry)

    async def start(self) -> None:
        source = await self._read_source()
        await self._activate(source)
        self._task = asyncio.create_task(self._poll_loop(), name="runtime-config-poll")

    async def stop(self) -> None:
        task = self._task
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self._task = None
        # Do not let a stop race an in-flight candidate activation and publish
        # a new view after all existing views have been closed.
        async with self._activation_lock:
            async with self._lock:
                views = [view for view in (self._view, *self._retired.values()) if view is not None]
                self._view = None
                self._retired.clear()
                self._leases.clear()
            for view in views:
                await self._close_registry(view.registry)
        await self._close_http_client()

    async def refresh_now(self) -> bool:
        source = await self._read_source()
        if source.checksum == self.view.snapshot.checksum:
            # A successful 304/unchanged read proves that the last-known-good
            # generation is still reachable. Keep the cumulative failure count
            # for diagnostics, but do not expose a stale transient error as the
            # current health condition.
            self.last_activation_error_type = None
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
        client = await self._get_http_client()
        response: httpx.Response | None = None
        for attempt in range(2):
            try:
                response = await client.get(path, headers=headers)
                break
            except httpx.ConnectError:
                if attempt == 1:
                    await self._close_http_client(client)
                    raise
                await asyncio.sleep(0.05)
        assert response is not None
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
        async with self._activation_lock:
            candidate: ProviderRegistry | None = None
            try:
                # Validate additive interaction policy before allocating a
                # provider generation. A malformed watchdog config must keep
                # the last-known-good snapshot instead of failing mid-turn.
                snapshot.auto_turn_policy()
                candidate = ProviderRegistry(
                    snapshot,
                    secret_file=self.secret_file,
                    secret_resolver=self.secret_resolver,
                    test_groq_keys_file=self.test_groq_keys_file,
                )
                # Never hold the view/lease lock while loading model weights or
                # opening provider pools. Existing sessions stay responsive and
                # can release their old generation during a slow warm-up.
                await candidate.prepare()
                view = RuntimeView(snapshot=snapshot, registry=candidate)
            except asyncio.CancelledError:
                # Shutdown can cancel a slow model warm-up. Dispose the
                # partially-created candidate before propagating cancellation
                # so CUDA/HTTP/file resources do not survive the task.
                if candidate is not None:
                    await self._close_registry(candidate)
                raise
            except (ConfigurationError, ProviderError) as exc:
                if candidate is not None:
                    await self._close_registry(candidate)
                self.activation_failures += 1
                self.last_activation_error_type = type(exc).__name__
                LOG.warning("runtime activation failed error_type=%s", self.last_activation_error_type)
                return False
            except Exception as exc:  # noqa: BLE001 - preserve last-known-good generation
                # Native model/driver failures do not always arrive wrapped in
                # ProviderError. Treat every candidate failure transactionally:
                # close partial resources, keep the old generation and expose
                # only the exception type in readiness diagnostics.
                if candidate is not None:
                    await self._close_registry(candidate)
                self.activation_failures += 1
                self.last_activation_error_type = type(exc).__name__
                LOG.warning("runtime activation failed error_type=%s", self.last_activation_error_type)
                return False
            async with self._lock:
                old = self._view
                self._view = view
                self.last_activation_error_type = None
                retired = None
                if old is not None:
                    old_key = id(old)
                    if self._leases.get(old_key, 0) > 0:
                        self._retired[old_key] = old
                    else:
                        retired = old
                listeners = tuple(self._listeners)
        if retired is not None:
            await self._close_registry(retired.registry)
        for listener in listeners:
            await listener(view)
        return True

    @staticmethod
    async def _close_registry(registry: ProviderRegistry) -> None:
        try:
            await registry.close()
        except Exception as exc:  # noqa: BLE001
            LOG.warning("provider generation close failed error_type=%s", type(exc).__name__)

    async def _get_http_client(self) -> httpx.AsyncClient:
        client = self._http_client
        if client is not None:
            return client
        async with self._http_lock:
            if self._http_client is None:
                self._http_client = httpx.AsyncClient(
                    timeout=5,
                    limits=httpx.Limits(max_connections=2, max_keepalive_connections=1, keepalive_expiry=30),
                )
            return self._http_client

    async def _close_http_client(self, expected: httpx.AsyncClient | None = None) -> None:
        async with self._http_lock:
            client = self._http_client
            if client is None or (expected is not None and client is not expected):
                return
            self._http_client = None
        await client.aclose()
