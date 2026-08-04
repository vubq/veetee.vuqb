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
            headers={"Device-Id": "device-test", "Client-Id": "client-test", "Protocol-Version": "3"},
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
async def test_disconnect_aborts_active_turn_and_releases_lease(monkeypatch):
    """A transport drop must cancel the provider task before the next session."""

    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(fixture))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    llm_started = asyncio.Event()

    class FastASR:
        def reset(self) -> None:
            pass

        async def accept(self, pcm: bytes, sample_rate: int) -> None:
            del pcm, sample_rate

        async def finish(self, locale: str) -> str:
            del locale
            return "xin chao"

    class SlowLLM:
        async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, object]]):
            del prompt, locale, tools
            llm_started.set()
            await asyncio.sleep(30)
            yield LLMDelta(text="khong nen phat", final=True)

    registry = runtime.view.registry
    registry.asr = FastASR()
    registry.llm = SlowLLM()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    websocket = None
    try:
        websocket = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "disconnect-test", "Client-Id": "disconnect-client", "Protocol-Version": "3"},
        )
        await websocket.send_json({
            "type": "hello",
            "version": 3,
            "transport": "websocket",
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        })
        hello = await websocket.receive_json()
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        frame = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960)))
        await websocket.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": hello["session_id"]})
        await websocket.send_bytes(frame)
        await websocket.send_json({"type": "listen", "state": "stop", "session_id": hello["session_id"]})
        await asyncio.wait_for(llm_started.wait(), timeout=2)
        await websocket.close()
        for _ in range(100):
            if service.metrics["session_releases"] == 1:
                break
            await asyncio.sleep(0.01)
        assert service.metrics["active_turns"] == 0
        assert service.metrics["session_releases"] == 1
        assert service.metrics["turn_disconnect_aborts"] == 1
        assert service.metrics["turn_releases"] == 1
    finally:
        if websocket is not None:
            await websocket.close()
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_health_reports_last_activation_error_type_without_detail(monkeypatch):
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
        response = await client.get("/health/ready")
        payload = await response.json()
        assert response.status == 200
        assert payload["lastActivationErrorType"] is None
        assert "lastActivationError" not in payload
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
            headers={"Device-Id": "auto-endpoint-test", "Client-Id": "client-auto", "Protocol-Version": "3"},
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
        await asyncio.sleep(0.05)

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
async def test_auto_no_speech_timeout_releases_turn_without_running_pipeline(monkeypatch, tmp_path):
    """A wake turn with no confirmed speech must release capacity via alert."""

    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    snapshot = json.loads(fixture.read_text(encoding="utf-8"))
    snapshot["autoTurn"] = {
        "enabled": True,
        "noSpeechTimeoutMs": 1000,
        "noSpeechAlert": {"status": "warning", "message": "Chưa nghe thấy lời nói.", "emotion": "neutral"},
    }
    configured = tmp_path / "no-speech.json"
    configured.write_text(json.dumps(snapshot), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(configured))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    ws = None
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "no-speech-test", "Client-Id": "client-no-speech", "Protocol-Version": "3"},
        )
        await ws.send_json({
            "type": "hello", "version": 3, "transport": "websocket",
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        })
        hello = await ws.receive_json()
        await ws.send_json({"type": "listen", "state": "start", "mode": "auto", "session_id": hello["session_id"]})
        alert = await ws.receive_json(timeout=2)
        assert alert["type"] == "alert"
        assert alert["code"] == "NO_SPEECH_TIMEOUT"
        assert alert["message"] == "Chưa nghe thấy lời nói."
        assert service.metrics["auto_no_speech_timeouts"] == 1
        assert service.metrics["active_turns"] == 0
        assert service.metrics.get("audio_frames_in", 0) == 0

        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        late_frame = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960)))
        await ws.send_bytes(late_frame)
        await asyncio.sleep(0.05)
        assert service.metrics["protocol_errors"] == 0
        assert service.metrics["audio_frames_ignored"] >= 1

        await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": hello["session_id"]})
        for _ in range(100):
            if service.metrics["active_turns"] == 1:
                break
            await asyncio.sleep(0.01)
        assert service.metrics["active_turns"] == 1
        await ws.send_json({"type": "abort", "reason": "test", "session_id": hello["session_id"]})
        stop = await ws.receive_json(timeout=2)
        assert stop["type"] == "tts"
        assert service.metrics["active_turns"] == 0
    finally:
        if ws is not None:
            await ws.close()
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_auto_no_speech_watchdog_cancels_after_confirmed_speech(monkeypatch, tmp_path):
    """Confirmed speech cancels only the first-speech watchdog."""

    fixture = Path(__file__).parents[1] / "config/fixtures/m0.json"
    snapshot = json.loads(fixture.read_text(encoding="utf-8"))
    snapshot["autoTurn"] = {
        "enabled": True,
        "noSpeechTimeoutMs": 1000,
        "noSpeechAlert": {"status": "warning", "message": "Chưa nghe thấy lời nói.", "emotion": "neutral"},
    }
    configured = tmp_path / "no-speech-speech.json"
    configured.write_text(json.dumps(snapshot), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(configured))
    config = ServerConfig.from_env()
    runtime = RuntimeConfigManager(config)
    await runtime.start()

    class SpeechVAD:
        def reset(self) -> None:
            pass

        def accept(self, pcm: bytes, sample_rate: int) -> bool:
            del pcm, sample_rate
            return True

        def endpoint(self) -> bool:
            return False

    class RecordingASR:
        def reset(self) -> None:
            pass

        async def accept(self, pcm: bytes, sample_rate: int) -> None:
            del pcm, sample_rate

        async def finish(self, locale: str) -> str:
            del locale
            return ""

    runtime.view.registry.vad = SpeechVAD()
    runtime.view.registry.asr = RecordingASR()
    service = VoiceApplication(config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    ws = None
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "speech-before-timeout", "Client-Id": "client-speech", "Protocol-Version": "3"},
        )
        await ws.send_json({
            "type": "hello", "version": 3, "transport": "websocket",
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        })
        hello = await ws.receive_json()
        from veetee_server.protocol import AudioFrame, encode_audio

        encoder = __import__("opuslib").Encoder(16000, 1, __import__("opuslib").APPLICATION_AUDIO)
        frame = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1920, 960)))
        await ws.send_json({"type": "listen", "state": "start", "mode": "auto", "session_id": hello["session_id"]})
        await ws.send_bytes(frame)
        await asyncio.sleep(1.2)
        assert service.metrics["auto_no_speech_timeouts"] == 0
        assert service.metrics["active_turns"] == 1
        await ws.send_json({"type": "abort", "reason": "test", "session_id": hello["session_id"]})
        await ws.receive_json(timeout=2)
        assert service.metrics["active_turns"] == 0
    finally:
        if ws is not None:
            await ws.close()
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
            headers={"Device-Id": "barge-test", "Client-Id": "client-barge", "Protocol-Version": "3"},
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
        assert service.metrics["barge_in_count"] == 1
        assert 0 <= service.metrics["last_barge_in_control_ms"] < 250
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
            headers={"Device-Id": f"compat-{version}", "Client-Id": f"client-compat-{version}", "Protocol-Version": str(version)},
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


@pytest.mark.asyncio
async def test_duplicate_device_hello_handover_closes_old_session(monkeypatch):
    """A device lease must never leave two connections controlling one speaker."""

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

    async def open_session(client_id: str):
        websocket = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "single-device", "Client-Id": client_id, "Protocol-Version": "3"},
        )
        await websocket.send_json(
            {
                "type": "hello",
                "version": 3,
                "transport": "websocket",
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
            }
        )
        return websocket, await websocket.receive_json()

    old = None
    replacement = None
    try:
        old, old_hello = await open_session("old-client")
        replacement, replacement_hello = await open_session("new-client")

        old_events = []
        while not old.closed:
            old_events.append(await old.receive(timeout=2))
        assert old.close_code == 4001
        assert any(message.type == 1 and '"reason":"session_replaced"' in message.data for message in old_events)
        assert replacement_hello["type"] == "hello"
        assert replacement_hello["session_id"] != old_hello["session_id"]
        assert service.metrics["session_handovers"] == 1
        assert service.metrics["active_connections"] == 1
        assert service.metrics["session_admissions"] == 2
        assert service.metrics["session_releases"] == 1
    finally:
        if old is not None:
            await old.close()
        if replacement is not None:
            await replacement.close()
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_turn_admission_rejects_second_device_then_releases_after_abort(monkeypatch):
    """A second device stays connected but cannot allocate a model turn."""

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

    async def open_session(device_id: str):
        websocket = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": device_id, "Client-Id": f"client-{device_id}", "Protocol-Version": "3"},
        )
        await websocket.send_json(
            {
                "type": "hello",
                "version": 3,
                "transport": "websocket",
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
            }
        )
        return websocket, await websocket.receive_json()

    first = None
    second = None
    try:
        assert service.turn_capacity() == (1, 250)
        first, first_hello = await open_session("turn-owner")
        second, second_hello = await open_session("turn-waiter")
        await first.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": first_hello["session_id"]})
        await second.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": second_hello["session_id"]})

        busy = await second.receive_json(timeout=2)
        assert busy["type"] == "alert"
        assert busy["code"] == "SERVER_BUSY"
        assert busy["retry_after_ms"] == 250
        assert service.metrics["active_turns"] == 1
        assert service.metrics["turn_rejections"] == 1

        await first.send_json({"type": "abort", "reason": "test", "session_id": first_hello["session_id"]})
        stop = await first.receive_json(timeout=2)
        assert stop["type"] == "tts"
        assert stop["state"] == "stop"
        assert service.metrics["active_turns"] == 0

        await second.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": second_hello["session_id"]})
        await asyncio.sleep(0.05)
        assert service.metrics["active_turns"] == 1
        await second.send_json({"type": "abort", "reason": "test", "session_id": second_hello["session_id"]})
        await second.receive_json(timeout=2)
        assert service.metrics["active_turns"] == 0
        assert service.metrics["turn_releases"] >= 2
    finally:
        if first is not None:
            await first.close()
        if second is not None:
            await second.close()
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_reference_mcp_peer_gets_ordered_initialize_then_tools_list(monkeypatch):
    """A reference-style MCP device must be able to answer discovery in order."""

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
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "reference-mcp-device", "Client-Id": "reference-mcp-client", "Protocol-Version": "3"},
        )
        await ws.send_json(
            {
                "type": "hello",
                "version": 3,
                "transport": "websocket",
                "features": {"mcp": True},
                "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
            }
        )
        hello = await ws.receive_json()
        assert hello["type"] == "hello"
        session_id = hello["session_id"]

        initialize = await ws.receive_json()
        assert initialize["type"] == "mcp"
        assert initialize["session_id"] == session_id
        initialize_payload = initialize["payload"]
        assert initialize_payload["method"] == "initialize"
        await ws.send_json(
            {
                "type": "mcp",
                "session_id": session_id,
                "payload": {"jsonrpc": "2.0", "id": initialize_payload["id"], "result": {"protocolVersion": "2024-11-05"}},
            }
        )

        tools_list = await ws.receive_json()
        assert tools_list["type"] == "mcp"
        assert tools_list["payload"]["method"] == "tools/list"
        assert tools_list["payload"]["params"] == {}
        await ws.send_json(
            {
                "type": "mcp",
                "payload": {"jsonrpc": "2.0", "id": tools_list["payload"]["id"], "result": {"tools": []}},
            }
        )
        await asyncio.sleep(0)
        assert service.metrics.get("mcp_discovery_failures", 0) == 0
        await ws.close()
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mutator",
    [
        lambda hello: hello.update(transport="mqtt"),
        lambda hello: hello["audio_params"].update(sample_rate="16000"),
        lambda hello: hello.update(version=True),
    ],
)
async def test_malformed_handshake_closes_with_protocol_error(monkeypatch, mutator):
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
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "malformed-handshake", "Client-Id": "client-malformed", "Protocol-Version": "3"},
        )
        hello = {
            "type": "hello",
            "version": 3,
            "transport": "websocket",
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
        }
        mutator(hello)
        await ws.send_json(hello)
        await ws.receive(timeout=2)
        assert ws.close_code == 1002
        assert service.metrics["protocol_errors"] == 1
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_v3_upgrade_requires_client_id(monkeypatch):
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
        response = await client.get(
            "/veetee/v1/",
            headers={"Device-Id": "missing-client", "Protocol-Version": "3"},
        )
        assert response.status == 400
        assert await response.text() == "invalid Client-Id"
    finally:
        await client.close()
        await runtime.stop()
