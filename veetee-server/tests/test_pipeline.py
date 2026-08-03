import asyncio
import json
from pathlib import Path

import pytest

from veetee_server.config import ServerConfig, load_snapshot
from veetee_server.pipeline import Turn, TurnPipeline
from veetee_server.providers import OpusCodec, ProviderRegistry


@pytest.mark.asyncio
async def test_fixture_pipeline_streams_start_sentence_audio_stop():
    snapshot = load_snapshot(Path(__file__).parents[1] / "config/fixtures/m0.json")
    registry = ProviderRegistry(snapshot)
    codec = OpusCodec(16000, 24000)
    turn = Turn(turn_id="turn", generation=1, mode="manual", cancelled=asyncio.Event())
    text = []
    binary = []
    pipeline = TurnPipeline(
        snapshot=snapshot,
        registry=registry,
        codec=codec,
        profile="ws-v3",
        session_id="session",
        turn=turn,
        send_text=lambda value: _append(text, value),
        send_binary=lambda value: _append(binary, value),
        metrics={},
    )
    await pipeline.ingest(b"\0" * 1920)
    await pipeline.finish()
    types = [event["type"] for event in text]
    assert types[0] == "stt"
    assert "tts" in types
    assert any(event.get("state") == "start" for event in text)
    assert any(event.get("state") == "stop" for event in text)
    assert binary


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


async def _append(target, value):
    target.append(value)
