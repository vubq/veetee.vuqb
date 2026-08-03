from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from veetee_server.presence import DevicePresenceReporter, PresenceReporterSettings


@pytest.mark.asyncio
async def test_presence_queue_delivers_hash_only_payload_and_is_bounded() -> None:
    request_started = asyncio.Event()
    release = asyncio.Event()
    received: list[dict[str, object]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/internal/v1/devices/presence"
        received.append(json.loads(request.content.decode("utf-8")))
        request_started.set()
        await release.wait()
        return httpx.Response(202, request=request)

    reporter = DevicePresenceReporter(
        PresenceReporterSettings("http://manager.test/internal/v1/devices/presence", queue_capacity=1, shutdown_drain_ms=1000),
        transport=httpx.MockTransport(handler),
    )
    await reporter.start()
    try:
        assert reporter.enqueue({"identityHash": "a" * 64, "clientIdHash": "b" * 64, "maskedMac": "AA:BB:CC:••:••:FF", "board": "ESP32-S3", "firmwareVersion": "0.1.0", "onlineState": "online"})
        await asyncio.wait_for(request_started.wait(), timeout=1)
        assert reporter.enqueue({"identityHash": "c" * 64, "clientIdHash": "d" * 64, "maskedMac": "CC:DD:EE:••:••:11", "board": "ESP32-S3", "firmwareVersion": "0.1.0", "onlineState": "offline"})
        assert not reporter.enqueue({"identityHash": "e" * 64, "clientIdHash": "f" * 64, "maskedMac": "EE:FF:00:••:••:22", "board": "ESP32-S3", "firmwareVersion": "0.1.0", "onlineState": "online"})
        assert reporter.metrics()["dropped"] == 1
        release.set()
        await reporter.wait_idle(timeout_seconds=1)
        assert reporter.metrics()["sent"] == 2
        assert received[0]["identityHash"] == "a" * 64
        assert "deviceId" not in received[0]
    finally:
        release.set()
        await reporter.stop()
