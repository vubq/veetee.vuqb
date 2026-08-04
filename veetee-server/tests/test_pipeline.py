import asyncio
import json
from pathlib import Path
import time

import pytest

from veetee_server.config import load_snapshot
from veetee_server.pipeline import Turn, TurnPipeline
from veetee_server.providers import AudioChunk, LLMDelta, OpusCodec, ProviderError, ProviderRegistry


@pytest.mark.asyncio
async def test_fixture_pipeline_streams_start_sentence_audio_stop():
    snapshot = load_snapshot(Path(__file__).parents[1] / "config/fixtures/m0.json")
    registry = ProviderRegistry(snapshot)
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="turn", generation=1, mode="manual", cancelled=asyncio.Event())
    text = []
    binary = []
    metrics = {}
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="session",
        turn=turn,
        send_text=lambda value: _append(text, value),
        send_binary=lambda value: _append(binary, value),
        metrics=metrics,
    )
    turn.listen_stopped_at = time.perf_counter()
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()
    types = [event["type"] for event in text]
    assert types[0] == "stt"
    assert "tts" in types
    assert any(event.get("state") == "start" for event in text)
    assert any(event.get("state") == "stop" for event in text)
    assert binary
    assert metrics["last_asr_finalize_ms"] >= 0
    assert metrics["last_llm_first_token_ms"] >= 0
    assert metrics["last_tts_start_ms"] >= 0
    assert metrics["last_ttfa_ms"] >= 0


@pytest.mark.asyncio
async def test_progress_ack_is_configured_and_precedes_slow_llm_answer(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["progress"] = {
        "enabled": True,
        "deadlineMs": 1,
        "acknowledgementId": "processing",
        "acknowledgements": {"processing": "Đợi một chút, tôi đang xử lý."},
    }
    source["providers"]["llm"]["config"]["segmentDelayMs"] = 20
    fixture = tmp_path / "progress.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="progress-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    text = []
    binary = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="progress-session",
        turn=turn,
        send_text=lambda value: _append(text, value),
        send_binary=lambda value: _append(binary, value),
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()
    sentences = [event["text"] for event in text if event.get("type") == "tts" and event.get("state") == "sentence_start"]
    assert sentences[0] == "Đợi một chút, tôi đang xử lý."
    assert any("Chào bạn" in value for value in sentences)
    assert binary


@pytest.mark.asyncio
async def test_configured_exit_intent_stops_before_llm(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["asr"]["config"]["text"] = "bye"
    source["providers"]["intent"] = {
        "providerId": "veetee.intent.patterns",
        "version": "1.0.0",
        "config": {"rules": [{"id": "exit", "action": "conversation.exit", "locales": ["*"], "patterns": ["bye"]}]},
    }
    fixture = tmp_path / "intent.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="intent-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    text = []
    binary = []
    matches = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="intent-session",
        turn=turn,
        send_text=lambda value: _append(text, value),
        send_binary=lambda value: _append(binary, value),
        on_intent=lambda value: _append(matches, value),
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()
    assert matches[0].action == "conversation.exit"
    assert any(event.get("type") == "intent" for event in text)
    assert not any(event.get("type") == "tts" and event.get("state") == "start" for event in text)
    assert binary == []


@pytest.mark.asyncio
async def test_cancelled_turn_drops_queued_audio_packet():
    snapshot = load_snapshot(Path(__file__).parents[1] / "config/fixtures/m0.json")
    registry = ProviderRegistry(snapshot)
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="cancelled-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    binary = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="cancelled-session",
        turn=turn,
        send_text=lambda value: _append([], value),
        send_binary=lambda value: _append(binary, value),
        metrics={},
    )
    turn.cancelled.set()
    await pipeline._send_packet(b"\0" * (24000 * 60 // 1000 * 2))
    assert binary == []


@pytest.mark.asyncio
async def test_tool_call_round_trip_streams_answer_after_device_result(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["tools"] = [{"name": "device.led.set", "description": "Set RGB LED", "inputSchema": {"type": "object"}}]
    source["toolPolicy"] = {"maxRounds": 2}
    fixture = tmp_path / "tool.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)
    calls = 0

    class ToolLLM:
        async def stream(self, *, prompt, locale, tools):
            nonlocal calls
            calls += 1
            if calls == 1:
                yield LLMDelta(tool_name="device.led.set", tool_arguments='{"red":')
                yield LLMDelta(tool_name="device.led.set", tool_arguments="255}")
                yield LLMDelta(final=True)
                return
            yield LLMDelta(text="Đèn đã bật. ")
            yield LLMDelta(text="")
            yield LLMDelta(final=True)

    registry.llm = ToolLLM()
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="tool-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    text = []
    binary = []
    executed = []

    async def execute_tool(name, arguments, generation):
        executed.append((name, arguments, generation))
        return {"ok": True, "applied": arguments}

    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="tool-session",
        turn=turn,
        send_text=lambda value: _append(text, value),
        send_binary=lambda value: _append(binary, value),
        execute_tool=execute_tool,
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()

    assert calls == 2
    assert executed == [("device.led.set", {"red": 255}, 1)]
    assert any(event.get("type") == "llm" for event in text)
    assert any(event.get("type") == "tts" and event.get("state") == "start" for event in text)
    assert binary


@pytest.mark.asyncio
async def test_long_answer_keeps_memory_excerpt_bounded(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["memory"] = {
        "providerId": "veetee.memory.session-window",
        "version": "1.0.0",
        "config": {"maxTurns": 4, "maxCharacters": 120},
    }
    source["providers"]["llm"]["config"] = {
        "segments": ["đoạn trả lời rất dài. " * 80],
        "chunkSize": 11,
    }
    fixture = tmp_path / "long-answer.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)

    class RecordingMemory:
        assistant_text = ""

        def add_turn(self, user_text: str, assistant_text: str) -> None:
            del user_text
            self.assistant_text = assistant_text

        def context(self) -> str:
            return ""

    memory = RecordingMemory()
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="long-answer-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    binary = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="long-answer-session",
        turn=turn,
        send_text=lambda value: _append([], value),
        send_binary=lambda value: _append(binary, value),
        memory=memory,
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()
    assert 0 < len(memory.assistant_text) <= 120
    assert binary


@pytest.mark.asyncio
async def test_long_text_streams_thirty_minutes_without_collecting_audio(tmp_path):
    """A long streamed answer must stay segment/frame bounded.

    This is a deterministic pipeline gate: provider output is streamed one
    semantic segment at a time and the codec is replaced with a tiny test
    double so the test measures queue/ownership behavior rather than model
    throughput.  The physical VieNeu/Opus promotion gate remains separate.
    """

    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["memory"] = {
        "providerId": "veetee.memory.session-window",
        "version": "1.0.0",
        "config": {"maxTurns": 4, "maxCharacters": 120},
    }
    source["segmentation"] = {
        "minimumCharacters": 1,
        "maximumCharacters": 180,
        "strongPunctuation": ["."],
    }
    fixture = tmp_path / "long-stream.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    snapshot = load_snapshot(fixture)
    registry = ProviderRegistry(snapshot)

    frame_duration_ms = int(snapshot.raw["wire"]["frameDurationMs"])
    expected_frames = (30 * 60 * 1000) // frame_duration_ms
    segment_text = "a" * 179 + "."

    class LongLLM:
        async def stream(self, *, prompt, locale, tools):
            del prompt, locale, tools
            for _ in range(expected_frames):
                yield LLMDelta(text=segment_text)
            yield LLMDelta(final=True)

    class OneFrameTTS:
        async def stream(self, text, *, locale, voice):
            del text, locale, voice
            yield AudioChunk(b"\0" * (24_000 * frame_duration_ms // 1000 * 2), 24_000)

    class TinyCodec:
        def encode_downlink(self, pcm, frame_samples):
            assert len(pcm) == frame_samples * 2
            return b"x"

    class RecordingMemory:
        assistant_text = ""

        def add_turn(self, user_text, assistant_text):
            del user_text
            self.assistant_text = assistant_text

        def context(self):
            return ""

    registry.llm = LongLLM()
    registry.tts = OneFrameTTS()
    memory = RecordingMemory()
    turn = Turn(turn_id="long-stream-turn", generation=1, mode="manual", cancelled=asyncio.Event())
    counters = {"binary": 0, "segments": 0}

    async def send_text(value):
        if value.get("type") == "tts" and value.get("state") == "sentence_start":
            counters["segments"] += 1

    async def send_binary(value):
        assert value
        counters["binary"] += 1

    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=TinyCodec(),
        profile="ws-v3",
        session_id="long-stream-session",
        turn=turn,
        send_text=send_text,
        send_binary=send_binary,
        memory=memory,
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()

    assert counters == {"binary": expected_frames, "segments": expected_frames}
    assert len(turn.transcript) <= 128
    assert 0 < len(memory.assistant_text) <= 120


@pytest.mark.asyncio
async def test_active_provider_fault_is_terminal_without_secondary_call():
    snapshot = load_snapshot(Path(__file__).parents[1] / "config/fixtures/m0.json")
    registry = ProviderRegistry(snapshot)
    secondary_calls = 0

    class ActiveFailingTTS:
        async def stream(self, text, *, locale, voice):
            del text, locale, voice
            raise ProviderError("TTS_SYNTHESIS_FAILED", "active provider failure")
            yield AudioChunk(b"", 24_000, final=True)

    class SecondaryTTS:
        async def stream(self, text, *, locale, voice):
            nonlocal secondary_calls
            del text, locale, voice
            secondary_calls += 1
            yield AudioChunk(b"\0\0", 24_000, final=True)

    active_provider = ActiveFailingTTS()
    secondary_provider = SecondaryTTS()
    registry.tts = active_provider
    # Even if a caller accidentally attaches a secondary object, the registry
    # contract has no fallback path and the pipeline must never invoke it.
    registry.fallback_tts = secondary_provider
    assert secondary_provider is not active_provider

    turn = Turn(turn_id="provider-fault", generation=1, mode="manual", cancelled=asyncio.Event())
    events = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=OpusCodec(16_000, 24_000),
        profile="ws-v3",
        session_id="provider-fault-session",
        turn=turn,
        send_text=lambda value: _append(events, value),
        send_binary=lambda value: _append(events, value),
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()

    assert turn.state == "error"
    assert turn.finish_reason == "TTS_SYNTHESIS_FAILED"
    assert any(event.get("type") == "alert" and event.get("code") == "TTS_SYNTHESIS_FAILED" for event in events)
    assert secondary_calls == 0


@pytest.mark.asyncio
async def test_tts_fault_after_first_segment_emits_one_stop_without_fallback():
    snapshot = load_snapshot(Path(__file__).parents[1] / "config/fixtures/m0.json")
    registry = ProviderRegistry(snapshot)
    calls = 0

    class FailingAfterFirstTTS:
        async def stream(self, text, *, locale, voice):
            nonlocal calls
            del text, locale, voice
            calls += 1
            if calls == 1:
                yield AudioChunk(b"\0\0" * 2400, 24_000, final=True)
                return
            raise ProviderError("TTS_SYNTHESIS_FAILED", "active provider failure")

    registry.tts = FailingAfterFirstTTS()
    turn = Turn(turn_id="provider-fault-after-start", generation=1, mode="manual", cancelled=asyncio.Event())
    events = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=OpusCodec(16_000, 24_000),
        profile="ws-v3",
        session_id="provider-fault-after-start-session",
        turn=turn,
        send_text=lambda value: _append(events, value),
        send_binary=lambda value: _append(events, value),
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()

    controls = [event for event in events if isinstance(event, dict)]
    stops = [event for event in controls if event.get("type") == "tts" and event.get("state") == "stop"]
    assert turn.state == "error"
    assert any(event.get("type") == "tts" and event.get("state") == "start" for event in controls)
    assert any(event.get("type") == "alert" and event.get("code") == "TTS_SYNTHESIS_FAILED" for event in controls)
    assert len(stops) == 1
    assert stops[0]["reason"] == "TTS_SYNTHESIS_FAILED"
    assert calls == 2


async def _append(target, value):
    target.append(value)
