from __future__ import annotations

import asyncio

import httpx
import pytest

from veetee_server.history import ConversationHistoryReporter, HistoryReporterSettings


@pytest.mark.asyncio
async def test_history_queue_is_bounded_and_delivery_is_non_blocking() -> None:
    request_started = asyncio.Event()
    release = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/conversations/turns"
        request_started.set()
        await release.wait()
        return httpx.Response(202, request=request)

    reporter = ConversationHistoryReporter(
        HistoryReporterSettings("http://manager.test/internal/v1/conversations/turns", queue_capacity=1, shutdown_drain_ms=1000),
        transport=httpx.MockTransport(handler),
    )
    await reporter.start()
    try:
        assert reporter.enqueue({"turnId": "one"})
        await asyncio.wait_for(request_started.wait(), timeout=1)
        assert reporter.enqueue({"turnId": "two"})
        assert not reporter.enqueue({"turnId": "three"})
        assert reporter.metrics()["dropped"] == 1
        release.set()
        await reporter.wait_idle(timeout_seconds=1)
        assert reporter.metrics()["sent"] == 2
    finally:
        release.set()
        await reporter.stop()


@pytest.mark.asyncio
async def test_history_retries_same_endpoint_for_transient_failure() -> None:
    statuses = [503, 202]
    calls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.headers.get("authorization", ""))
        return httpx.Response(statuses.pop(0), request=request)

    reporter = ConversationHistoryReporter(
        HistoryReporterSettings(
            "http://manager.test/internal/v1/conversations/turns",
            token="machine-test-token",
            max_retries=2,
            retry_backoff_ms=0,
        ),
        transport=httpx.MockTransport(handler),
    )
    await reporter.start()
    try:
        assert reporter.enqueue({"turnId": "retry"})
        await reporter.wait_idle(timeout_seconds=1)
        assert calls == ["Bearer machine-test-token", "Bearer machine-test-token"]
        assert reporter.metrics()["retries"] == 1
        assert reporter.metrics()["sent"] == 1
        assert reporter.metrics()["failed"] == 0
    finally:
        await reporter.stop()
