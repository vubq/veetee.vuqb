"""Best-effort device presence delivery to the Manager API.

Presence is control-plane metadata. It is queued outside the WebSocket/audio
critical path and is safe to lose while the Manager is restarting. The payload
contains hashes of the two wire identities, never their raw values.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import dataclass
import logging
from typing import Any, Awaitable, Callable

import httpx


LOG = logging.getLogger("veetee.voice.presence")


@dataclass(frozen=True, slots=True)
class PresenceReporterSettings:
    endpoint: str
    token: str | None = None
    queue_capacity: int = 32
    request_timeout_ms: int = 1000
    max_retries: int = 1
    retry_backoff_ms: int = 100
    shutdown_drain_ms: int = 500


class DevicePresenceReporter:
    """Deliver online/offline events without awaiting the session task."""

    def __init__(
        self,
        settings: PresenceReporterSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not settings.endpoint.strip():
            raise ValueError("presence endpoint must not be empty")
        if settings.queue_capacity < 1:
            raise ValueError("presence queue capacity must be positive")
        if settings.request_timeout_ms < 1:
            raise ValueError("presence request timeout must be positive")
        if settings.max_retries < 0 or settings.retry_backoff_ms < 0 or settings.shutdown_drain_ms < 0:
            raise ValueError("presence timing settings cannot be negative")
        self.settings = settings
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=settings.queue_capacity)
        self._transport = transport
        self._sleep = sleep
        self._client: httpx.AsyncClient | None = None
        self._worker: asyncio.Task[None] | None = None
        self._closed = True
        self._metrics: dict[str, int] = {"enqueued": 0, "sent": 0, "dropped": 0, "failed": 0, "retries": 0}

    async def start(self) -> None:
        if self._worker is not None:
            return
        self._closed = False
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.request_timeout_ms / 1000),
            transport=self._transport,
        )
        self._worker = asyncio.create_task(self._run(), name="device-presence-reporter")

    def enqueue(self, event: dict[str, Any]) -> bool:
        if self._closed or self._worker is None:
            self._metrics["dropped"] += 1
            return False
        try:
            self._queue.put_nowait(deepcopy(event))
        except asyncio.QueueFull:
            self._metrics["dropped"] += 1
            return False
        self._metrics["enqueued"] += 1
        return True

    def metrics(self) -> dict[str, int]:
        return {**self._metrics, "queued": self._queue.qsize()}

    async def wait_idle(self, timeout_seconds: float = 5.0) -> None:
        await asyncio.wait_for(self._queue.join(), timeout=timeout_seconds)

    async def report_now(self, event: dict[str, Any]) -> bool | None:
        """Send one presence event synchronously and return its bind state.

        The normal presence path is intentionally queued so reconnects never
        block the voice loop. Pairing is the one exception: the WebSocket
        hello must tell firmware whether it should keep showing its six-digit
        code, and the live session needs to notice a web bind without a
        reconnect. The Manager API already returns ``paired`` for this exact
        presence event, so reuse that response instead of exposing plaintext
        pairing material or adding a second control-plane endpoint.
        """

        if self._closed or self._client is None:
            self._metrics["failed"] += 1
            return None
        response = await self._send(event)
        if response is None:
            return None
        try:
            payload = response.json()
        except (ValueError, TypeError):
            return None
        paired = payload.get("paired") if isinstance(payload, dict) else None
        return paired if isinstance(paired, bool) else None

    async def stop(self) -> None:
        worker = self._worker
        if worker is None:
            self._closed = True
            return
        self._closed = True
        try:
            await asyncio.wait_for(self._queue.join(), timeout=self.settings.shutdown_drain_ms / 1000)
        except asyncio.TimeoutError:
            LOG.warning("presence queue drain timed out queued=%d", self._queue.qsize())
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        self._worker = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _run(self) -> None:
        while True:
            event = await self._queue.get()
            try:
                await self._send(event)
            finally:
                self._queue.task_done()

    async def _send(self, event: dict[str, Any]) -> httpx.Response | None:
        client = self._client
        if client is None:
            self._metrics["failed"] += 1
            return None
        headers = {"Accept": "application/json"}
        if self.settings.token:
            headers["Authorization"] = f"Bearer {self.settings.token}"
        attempts = self.settings.max_retries + 1
        for attempt in range(attempts):
            try:
                response = await client.post(self.settings.endpoint, headers=headers, json=event)
            except (httpx.HTTPError, OSError) as exc:
                if attempt + 1 < attempts:
                    await self._retry_delay(attempt)
                    continue
                self._metrics["failed"] += 1
                LOG.warning("presence delivery failed error_type=%s", type(exc).__name__)
                return None
            if 200 <= response.status_code < 300:
                self._metrics["sent"] += 1
                return response
            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 < attempts:
                    await self._retry_delay(attempt)
                    continue
            self._metrics["failed"] += 1
            LOG.warning("presence delivery rejected status=%d", response.status_code)
            return None

    async def _retry_delay(self, attempt: int) -> None:
        self._metrics["retries"] += 1
        delay_ms = self.settings.retry_backoff_ms * (2**attempt)
        if delay_ms:
            await self._sleep(delay_ms / 1000)
