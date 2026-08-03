"""Best-effort, bounded conversation history delivery.

History is control-plane telemetry. It must never hold up microphone ingest,
endpointing, provider streaming or speaker playback. A full queue rejects the
new event so the ordering of accepted events remains deterministic and the
caller can count the loss.
"""

from __future__ import annotations

import asyncio
from copy import deepcopy
from dataclasses import dataclass
import logging
from typing import Any, Awaitable, Callable

import httpx


LOG = logging.getLogger("veetee.voice.history")


@dataclass(frozen=True, slots=True)
class HistoryReporterSettings:
    endpoint: str
    token: str | None = None
    queue_capacity: int = 64
    request_timeout_ms: int = 2000
    max_retries: int = 2
    retry_backoff_ms: int = 100
    shutdown_drain_ms: int = 500


class ConversationHistoryReporter:
    """Deliver history events without awaiting the audio/session task."""

    def __init__(
        self,
        settings: HistoryReporterSettings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not settings.endpoint.strip():
            raise ValueError("history endpoint must not be empty")
        if settings.queue_capacity < 1:
            raise ValueError("history queue capacity must be positive")
        if settings.request_timeout_ms < 1:
            raise ValueError("history request timeout must be positive")
        if settings.max_retries < 0:
            raise ValueError("history max retries cannot be negative")
        if settings.retry_backoff_ms < 0 or settings.shutdown_drain_ms < 0:
            raise ValueError("history timing settings cannot be negative")
        self.settings = settings
        self._queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=settings.queue_capacity)
        self._transport = transport
        self._sleep = sleep
        self._client: httpx.AsyncClient | None = None
        self._worker: asyncio.Task[None] | None = None
        self._closed = False
        self._metrics: dict[str, int] = {
            "enqueued": 0,
            "sent": 0,
            "dropped": 0,
            "failed": 0,
            "retries": 0,
        }

    @property
    def enabled(self) -> bool:
        return not self._closed

    @property
    def queue_size(self) -> int:
        return self._queue.qsize()

    def metrics(self) -> dict[str, int]:
        return {**self._metrics, "queued": self._queue.qsize()}

    async def start(self) -> None:
        if self._worker is not None:
            return
        self._closed = False
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.settings.request_timeout_ms / 1000),
            transport=self._transport,
        )
        self._worker = asyncio.create_task(self._run(), name="history-reporter")

    def enqueue(self, event: dict[str, Any]) -> bool:
        """Queue an event synchronously; never waits for network or disk."""

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

    async def wait_idle(self, timeout_seconds: float = 5.0) -> None:
        await asyncio.wait_for(self._queue.join(), timeout=timeout_seconds)

    async def stop(self) -> None:
        worker = self._worker
        if worker is None:
            self._closed = True
            return
        self._closed = True
        try:
            await asyncio.wait_for(
                self._queue.join(),
                timeout=self.settings.shutdown_drain_ms / 1000,
            )
        except asyncio.TimeoutError:
            LOG.warning("history queue drain timed out queued=%d", self._queue.qsize())
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

    async def _send(self, event: dict[str, Any]) -> None:
        client = self._client
        if client is None:
            self._metrics["failed"] += 1
            return
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
                LOG.warning("history delivery failed error_type=%s", type(exc).__name__)
                return
            if 200 <= response.status_code < 300:
                self._metrics["sent"] += 1
                return
            if response.status_code == 429 or response.status_code >= 500:
                if attempt + 1 < attempts:
                    await self._retry_delay(attempt)
                    continue
            self._metrics["failed"] += 1
            LOG.warning("history delivery rejected status=%d", response.status_code)
            return

    async def _retry_delay(self, attempt: int) -> None:
        self._metrics["retries"] += 1
        delay_ms = self.settings.retry_backoff_ms * (2**attempt)
        if delay_ms:
            await self._sleep(delay_ms / 1000)
