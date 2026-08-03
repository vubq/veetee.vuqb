import asyncio
import json
from pathlib import Path
import time

import pytest

from veetee_server.config import load_snapshot
from veetee_server.pipeline import Turn, TurnPipeline
from veetee_server.providers import LLMDelta, OpusCodec, ProviderRegistry


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


async def _append(target, value):
    target.append(value)
