import asyncio
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


async def _append(target, value):
    target.append(value)
