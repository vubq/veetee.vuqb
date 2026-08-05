import json
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from veetee_server.app import VoiceApplication
from veetee_server.config import ServerConfig
from veetee_server.protocol import AudioFrame, encode_audio
from veetee_server.runtime import RuntimeConfigManager


FIXTURE = Path(__file__).parents[2] / "tests/fixtures/ws_cross_conformance.json"


def load_fixture() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _reference_server_hello(client_hello: dict, session_id: str) -> dict:
    """Source-derived simulator, not a reference process or conformance claim."""

    return {
        "type": "hello",
        "version": 1,
        "transport": "websocket",
        "audio_params": dict(client_hello["audio_params"]),
        "session_id": session_id,
    }


@pytest.mark.asyncio
async def test_source_derived_reference_shape_is_explicit():
    fixture = load_fixture()
    hello = fixture["referenceClient"]["hello"]
    echoed = _reference_server_hello(hello, "fixture-session")
    assert echoed["version"] == 1
    assert echoed["transport"] == "websocket"
    assert echoed["audio_params"] == hello["audio_params"]
    assert echoed["session_id"] == "fixture-session"
    assert fixture["profiles"] == [
        {"name": "ws-v1-compat", "version": 1, "headerBytes": 0, "hasTimestamp": False},
        {"name": "ws-v2", "version": 2, "headerBytes": 16, "hasTimestamp": True},
        {"name": "ws-v3", "version": 3, "headerBytes": 4, "hasTimestamp": False},
    ]


@pytest.mark.asyncio
async def test_reference_client_shape_and_all_wire_profiles_run_on_veetee_server(monkeypatch):
    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        reference = load_fixture()["referenceClient"]
        for profile in load_fixture()["profiles"]:
            version = profile["version"]
            headers = dict(reference["headers"])
            headers["Device-Id"] = f"{headers['Device-Id']}-{version}"
            headers["Client-Id"] = f"{headers['Client-Id']}-{version}"
            headers["Protocol-Version"] = str(version)
            ws = await client.ws_connect("/veetee/v1/", headers=headers)
            hello = dict(reference["hello"])
            hello["version"] = version
            await ws.send_json(hello)
            server_hello = await ws.receive_json()
            assert server_hello["type"] == "hello"
            assert server_hello["version"] == version
            assert server_hello["transport"] == "websocket"
            assert isinstance(server_hello["session_id"], str) and server_hello["session_id"]
            assert server_hello["audio_params"] == {
                "format": "opus",
                "sample_rate": 24000,
                "channels": 1,
                "frame_duration": 60,
            }
            await ws.send_json({"type": "listen", "state": "start", "mode": "manual"})
            encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
            frame = encoder.encode(b"\0" * 1920, 960)
            wire = encode_audio(AudioFrame(profile["name"], frame, timestamp_ms=1234))
            assert len(wire) == len(frame) + profile["headerBytes"]
            await ws.send_bytes(wire)
            await ws.send_json({"type": "listen", "state": "stop"})
            events: list[dict] = []
            for _ in range(32):
                message = await ws.receive(timeout=2)
                if message.type == 1:
                    event = json.loads(message.data)
                    events.append(event)
                    if event.get("type") == "tts" and event.get("state") == "stop":
                        break
            assert any(event.get("type") == "stt" for event in events)
            assert any(event.get("type") == "tts" and event.get("state") == "start" for event in events)
            await ws.close()
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_legacy_control_without_session_stays_bound_to_current_connection(monkeypatch):
    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        data = load_fixture()
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={
                "Device-Id": "legacy-control-device",
                "Client-Id": "legacy-control-client",
                "Protocol-Version": "1",
            },
        )
        hello = dict(data["referenceClient"]["hello"])
        await ws.send_json(hello)
        server_hello = await ws.receive_json()
        for control in data["legacyControlWithoutSession"][:1]:
            await ws.send_json(control)
        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        await ws.send_bytes(encode_audio(AudioFrame("ws-v1-compat", encoder.encode(b"\0" * 1920, 960))))
        await ws.send_json(data["legacyControlWithoutSession"][1])
        events: list[dict] = []
        for _ in range(24):
            message = await ws.receive(timeout=2)
            if message.type == 1:
                event = json.loads(message.data)
                events.append(event)
                if event.get("type") == "tts" and event.get("state") == "stop":
                    break
        assert server_hello["session_id"]
        assert any(event.get("type") == "stt" for event in events)
        assert service.metrics["protocol_errors"] == 0
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()
