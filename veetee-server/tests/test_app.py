import json
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from veetee_server.app import VoiceApplication
from veetee_server.config import ServerConfig
from veetee_server.runtime import RuntimeConfigManager


@pytest.mark.asyncio
async def test_websocket_v3_handshake_and_turn(monkeypatch):
    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    monkeypatch.setenv("VEETEE_CONFIG_POLL_MS", "5000")
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "device-test", "Protocol-Version": "3"},
        )
        await ws.send_json(
            {
                "type": "hello",
                "version": 3,
                "transport": "websocket",
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
            }
        )
        hello = await ws.receive_json()
        assert hello["type"] == "hello"
        assert hello["audio_params"]["sample_rate"] == 24000
        await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": hello["session_id"]})
        from veetee_server.providers import OpusCodec
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        await ws.send_bytes(encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960))))
        await ws.send_json({"type": "listen", "state": "stop", "session_id": hello["session_id"]})
        messages = []
        for _ in range(12):
            message = await ws.receive()
            if message.type == 1:
                messages.append(json.loads(message.data))
                if messages[-1].get("type") == "tts" and messages[-1].get("state") == "stop":
                    break
        assert any(message.get("type") == "stt" for message in messages)
        assert any(message.get("type") == "tts" and message.get("state") == "start" for message in messages)
    finally:
        await client.close()
        await runtime.stop()
