import asyncio
import json
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from veetee_server.app import VoiceApplication
from veetee_server.config import ServerConfig
from veetee_server.runtime import RuntimeConfigManager
from veetee_server.providers import AudioChunk, LLMDelta


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


@pytest.mark.asyncio
async def test_auto_endpoint_ingests_last_frame_and_ignores_late_audio(monkeypatch):
    """Auto endpointing must not finalize before the frame that triggered VAD."""

    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    events: list[str] = []

    class EndpointVAD:
        def reset(self) -> None:
            pass

        def accept(self, pcm: bytes, sample_rate: int) -> bool:
            del pcm, sample_rate
            events.append("vad")
            return True

        def endpoint(self) -> bool:
            return True

    class RecordingASR:
        def reset(self) -> None:
            pass

        async def accept(self, pcm: bytes, sample_rate: int) -> None:
            del pcm, sample_rate
            events.append("asr_accept")

        async def finish(self, locale: str) -> str:
            del locale
            events.append("asr_finish")
            return "xin chao"

    class FastLLM:
        async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, object]]):
            del prompt, locale, tools
            events.append("llm")
            yield LLMDelta(text="Đã nghe.", final=True)

    class FastTTS:
        async def stream(self, text: str, *, locale: str, voice: dict[str, object]):
            del text, locale, voice
            events.append("tts")
            yield AudioChunk(b"\0" * (24000 * 60 // 1000 * 2), 24000)

    registry = runtime.view.registry
    registry.vad = EndpointVAD()
    registry.asr = RecordingASR()
    registry.llm = FastLLM()
    registry.tts = FastTTS()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "auto-endpoint-test", "Protocol-Version": "3"},
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
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        frame = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960)))
        await ws.send_json({"type": "listen", "state": "start", "mode": "auto", "session_id": hello["session_id"]})
        await ws.send_bytes(frame)

        received: list[dict[str, object]] = []
        for _ in range(12):
            message = await ws.receive(timeout=2)
            if message.type == 1:
                event = json.loads(message.data)
                received.append(event)
                if event.get("type") == "tts" and event.get("state") == "stop":
                    break
        await ws.send_bytes(frame)
        await asyncio.sleep(0)

        assert events.index("asr_accept") < events.index("asr_finish")
        assert events.count("asr_accept") == 1
        assert any(event.get("type") == "stt" for event in received)
        assert any(event.get("type") == "tts" and event.get("state") == "stop" for event in received)
        await asyncio.sleep(0.05)
        assert service.metrics["audio_frames_in"] == 1
        assert service.metrics["audio_frames_ignored"] >= 1
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_realtime_barge_in_cancels_old_turn_before_new_audio(monkeypatch):
    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()

    class SlowTTS:
        async def stream(self, text, *, locale, voice):
            del text, locale, voice
            await asyncio.sleep(0.2)
            yield AudioChunk(b"\0" * (24000 * 60 // 1000 * 2), 24000)

    runtime.view.registry.tts = SlowTTS()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "barge-test", "Protocol-Version": "3"},
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
        session_id = hello["session_id"]
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        silent = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960)))
        loud_pcm = b"\x00\x20" * 960
        loud = encode_audio(AudioFrame("ws-v3", encoder.encode(loud_pcm, 960)))
        await ws.send_json({"type": "listen", "state": "start", "mode": "realtime", "session_id": session_id})
        await ws.send_bytes(silent)
        await ws.send_json({"type": "listen", "state": "stop", "session_id": session_id})

        while True:
            event = await ws.receive_json(timeout=2)
            if event.get("type") == "tts" and event.get("state") == "start":
                break
        await ws.send_bytes(loud)
        await ws.send_bytes(loud)
        await ws.send_bytes(loud)
        await ws.send_bytes(loud)

        barge_event = None
        stale_binary = 0
        while barge_event is None:
            message = await ws.receive(timeout=2)
            if message.type == 2:
                stale_binary += 1
            elif message.type == 1:
                event = json.loads(message.data)
                if event.get("type") == "tts" and event.get("state") == "stop" and event.get("reason") == "barge_in":
                    barge_event = event
        await asyncio.sleep(0.25)
        assert stale_binary == 0
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [1, 2])
async def test_compatibility_profile_handshake_and_turn(monkeypatch, version):
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
        profile = {1: "ws-v1-compat", 2: "ws-v2"}[version]
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": f"compat-{version}", "Protocol-Version": str(version)},
        )
        await ws.send_json(
            {
                "type": "hello",
                "version": version,
                "transport": "websocket",
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
            }
        )
        hello = await ws.receive_json()
        assert hello["version"] == version
        await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": hello["session_id"]})
        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        from veetee_server.protocol import AudioFrame, encode_audio

        await ws.send_bytes(encode_audio(AudioFrame(profile, encoder.encode(b"\0" * 1920, 960))))
        await ws.send_json({"type": "listen", "state": "stop", "session_id": hello["session_id"]})
        events = []
        binary = 0
        for _ in range(24):
            message = await ws.receive()
            if message.type == 1:
                events.append(json.loads(message.data))
                if events[-1].get("type") == "tts" and events[-1].get("state") == "stop":
                    break
            elif message.type == 2:
                binary += 1
        assert any(event.get("type") == "stt" for event in events)
        assert binary > 0
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()
