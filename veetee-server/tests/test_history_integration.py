from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from aiohttp.test_utils import TestClient, TestServer

from veetee_server.app import VoiceApplication
from veetee_server.config import ServerConfig
from veetee_server.runtime import RuntimeConfigManager


class RecordingReporter:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def enqueue(self, event: dict[str, Any]) -> bool:
        self.events.append(event)
        return True

    def metrics(self) -> dict[str, int]:
        return {"enqueued": len(self.events), "sent": 0, "dropped": 0, "failed": 0, "retries": 0, "queued": 0}


class PresenceRecordingReporter:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def enqueue(self, event: dict[str, Any]) -> bool:
        self.events.append(event)
        return True

    def metrics(self) -> dict[str, int]:
        return {"enqueued": len(self.events), "sent": 0, "dropped": 0, "failed": 0, "retries": 0, "queued": 0}


@pytest.mark.asyncio
async def test_completed_turn_is_reported_outside_websocket_send_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = Path(__file__).parents[1] / "config/fixtures/m0.json"
    snapshot = json.loads(source.read_text(encoding="utf-8"))
    snapshot["assistantId"] = "11111111-1111-4111-8111-111111111111"
    fixture = tmp_path / "history.json"
    fixture.write_text(json.dumps(snapshot), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    monkeypatch.setenv("VEETEE_CONFIG_POLL_MS", "5000")
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    reporter = RecordingReporter()
    service = VoiceApplication(config, runtime, history_reporter=reporter)  # type: ignore[arg-type]
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "history-device", "Client-Id": "history-client", "Protocol-Version": "3"},
        )
        await ws.send_json({
            "type": "hello",
            "version": 3,
            "transport": "websocket",
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        })
        hello = await ws.receive_json()
        await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": hello["session_id"]})
        import opuslib
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = opuslib.Encoder(16000, 1, opuslib.APPLICATION_AUDIO)
        await ws.send_bytes(encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960))))
        await ws.send_json({"type": "listen", "state": "stop", "session_id": hello["session_id"]})
        while True:
            message = await ws.receive(timeout=2)
            if message.type == 1:
                event = json.loads(message.data)
                if event.get("type") == "tts" and event.get("state") == "stop":
                    break
        await asyncio.sleep(0)
        assert len(reporter.events) == 1
        event = reporter.events[0]
        assert event["assistantId"] == snapshot["assistantId"]
        assert event["deviceKey"] == hashlib.sha256(b"history-device").hexdigest()
        assert event["deviceKey"] != "history-device"
        assert event["state"] == "completed"
        assert event["sequence"] == 1
        assert event["timings"]["turn_duration_ms"] >= 0
        assert {segment["speaker"] for segment in event["transcript"]} == {"user", "assistant"}
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_device_info_reports_online_and_offline_presence_without_raw_identity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    source = Path(__file__).parents[1] / "config/fixtures/m0.json"
    snapshot = json.loads(source.read_text(encoding="utf-8"))
    snapshot["assistantId"] = "11111111-1111-4111-8111-111111111111"
    fixture = tmp_path / "presence.json"
    fixture.write_text(json.dumps(snapshot), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    monkeypatch.setenv("VEETEE_CONFIG_POLL_MS", "5000")
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    reporter = PresenceRecordingReporter()
    service = VoiceApplication(config, runtime, presence_reporter=reporter)  # type: ignore[arg-type]
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "AA:BB:CC:DD:EE:FF", "Client-Id": "veetee-AA:BB:CC:DD:EE:FF", "Protocol-Version": "3"},
        )
        await ws.send_json({
            "type": "hello",
            "version": 3,
            "transport": "websocket",
            "device_info": {"board": "ESP32-S3 N16R8", "firmwareVersion": "test-build"},
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        })
        await ws.receive_json()
        await ws.close()
        assert [event["onlineState"] for event in reporter.events] == ["online", "offline"]
        assert not any("object bool can't be used in 'await' expression" in record.getMessage() for record in caplog.records)
        assert reporter.events[0]["maskedMac"] == "AA:BB:CC:••:••:FF"
        assert reporter.events[0]["identityHash"] != "AA:BB:CC:DD:EE:FF"
        assert reporter.events[0]["clientIdHash"] != "veetee-AA:BB:CC:DD:EE:FF"
    finally:
        await client.close()
        await runtime.stop()
