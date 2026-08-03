"""Deterministic host-only session and long-answer soak coverage."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
import opuslib
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from veetee_server.app import VoiceApplication
from veetee_server.config import ServerConfig, load_snapshot
from veetee_server.pipeline import Turn, TurnPipeline
from veetee_server.protocol import AudioFrame, encode_audio
from veetee_server.providers import AudioChunk, LLMDelta, OpusCodec, ProviderRegistry
from veetee_server.runtime import RuntimeConfigManager


FIXTURE = Path(__file__).parents[1] / "config/fixtures/m0.json"


class StableASR:
    def reset(self) -> None:
        pass

    async def accept(self, pcm: bytes, sample_rate: int) -> None:
        del pcm, sample_rate

    async def finish(self, locale: str) -> str:
        del locale
        return "xin chao"


class StableLLM:
    async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, object]]):
        del prompt, locale, tools
        yield LLMDelta(text="Đã nhận.", final=True)


class StableTTS:
    async def stream(self, text: str, *, locale: str, voice: dict[str, object]):
        del text, locale, voice
        yield AudioChunk(b"\0" * (24_000 * 60 // 1_000 * 2), 24_000, final=True)


async def _receive_turn(ws, session_id: str, frame: bytes) -> int:
    await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": session_id})
    await ws.send_bytes(frame)
    await ws.send_json({"type": "listen", "state": "stop", "session_id": session_id})
    packets = 0
    while True:
        message = await ws.receive(timeout=2)
        if message.type == WSMsgType.BINARY:
            packets += 1
        elif message.type == WSMsgType.TEXT:
            event = json.loads(message.data)
            if event.get("type") == "alert":
                raise AssertionError(f"unexpected provider alert: {event.get('code')}")
            if event.get("type") == "tts" and event.get("state") == "stop":
                return packets
        else:
            raise AssertionError(f"session closed before tts.stop: {message.type}")


@pytest.mark.asyncio
async def test_60_turn_session_soak_has_no_stale_session_or_missing_audio(monkeypatch):
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    registry = runtime.view.registry
    registry.asr = StableASR()
    registry.llm = StableLLM()
    registry.tts = StableTTS()
    service = VoiceApplication(runtime.config, runtime)
    server = TestServer(service.make_app())
    client = TestClient(server)
    await client.start_server()
    try:
        ws = await client.ws_connect(
            "/veetee/v1/",
            headers={"Device-Id": "session-soak", "Client-Id": "session-soak", "Protocol-Version": "3"},
        )
        await ws.send_json(
            {
                "type": "hello",
                "version": 3,
                "transport": "websocket",
                "audio_params": {"format": "opus", "sample_rate": 16_000, "channels": 1, "frame_duration": 60},
            }
        )
        hello = await ws.receive_json()
        encoder = opuslib.Encoder(16_000, 1, opuslib.APPLICATION_AUDIO)
        frame = encode_audio(AudioFrame("ws-v3", encoder.encode(b"\0" * 1_920, 960)))
        packets = [await _receive_turn(ws, hello["session_id"], frame) for _ in range(60)]
        assert min(packets) > 0
        assert service.metrics["audio_frames_in"] == 60
        await ws.close()
        await client.close()
        await asyncio.sleep(0)
        assert service.metrics["turn_count"] >= 60
        assert service.metrics["active_connections"] == 0
        assert not service._sessions
    finally:
        await client.close()
        await runtime.stop()


@pytest.mark.asyncio
async def test_long_answer_streams_bounded_memory_and_ordered_audio(tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    paragraph = "Veetee giữ thứ tự câu và phát từng đoạn theo dòng. "
    answer = paragraph * 800
    expected_answer = answer.strip()
    digest = hashlib.sha256(expected_answer.encode("utf-8")).hexdigest()
    source["providers"]["memory"] = {
        "providerId": "veetee.memory.session-window",
        "version": "1.0.0",
        "config": {"maxTurns": 4, "maxCharacters": 128},
    }
    source["providers"]["llm"] = {
        "providerId": "veetee.llm.fixture",
        "version": "1.0.0",
        "config": {"segments": [answer], "chunkSize": 17},
    }
    fixture = tmp_path / "long-answer-soak.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)
    emitted = 0
    reconstructed_digest = hashlib.sha256()
    reconstructed_chars = 0
    sentence_count = 0

    class RecordingMemory:
        assistant_text = ""

        def add_turn(self, user_text: str, assistant_text: str) -> None:
            del user_text
            self.assistant_text = assistant_text

        def context(self) -> str:
            return ""

    async def send_binary(value: bytes) -> None:
        nonlocal emitted
        emitted += 1

    async def send_text(value: dict[str, object]) -> None:
        nonlocal reconstructed_chars, sentence_count
        if value.get("type") == "tts" and value.get("state") == "sentence_start":
            text = value.get("text")
            if isinstance(text, str):
                if sentence_count:
                    reconstructed_digest.update(b" ")
                    reconstructed_chars += 1
                reconstructed_digest.update(text.encode("utf-8"))
                reconstructed_chars += len(text)
                sentence_count += 1

    registry.tts = StableTTS()
    memory = RecordingMemory()
    turn = Turn(turn_id="long-answer-soak", generation=1, mode="manual", cancelled=asyncio.Event())
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=OpusCodec(16_000, 24_000),
        profile="ws-v3",
        session_id="long-answer-soak",
        turn=turn,
        send_text=send_text,
        send_binary=send_binary,
        memory=memory,
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1_920)
    await pipeline.finish()

    assert sentence_count > 100
    assert reconstructed_chars == len(expected_answer)
    assert reconstructed_digest.hexdigest() == digest
    assert 0 < len(memory.assistant_text) <= 128
    assert emitted > 100
