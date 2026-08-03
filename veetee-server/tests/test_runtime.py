from __future__ import annotations

import json
from pathlib import Path

import pytest

from veetee_server.config import ServerConfig, load_snapshot
from veetee_server.providers import ProviderError, ProviderRegistry
from veetee_server.runtime import RuntimeConfigManager


FIXTURE = Path(__file__).parents[1] / "config/fixtures/m0.json"


@pytest.mark.asyncio
async def test_provider_registry_close_is_idempotent():
    registry = ProviderRegistry(load_snapshot(FIXTURE))
    calls = 0

    class Closable:
        async def close(self) -> None:
            nonlocal calls
            calls += 1

    registry.tts = Closable()
    await registry.close()
    await registry.close()
    assert calls == 1


class TrackingRegistry:
    instances: list["TrackingRegistry"] = []
    fail_revisions: set[int] = set()

    def __init__(self, snapshot, **kwargs):
        del kwargs
        self.snapshot = snapshot
        self.close_calls = 0
        self.__class__.instances.append(self)

    async def prepare(self) -> None:
        if self.snapshot.revision in self.fail_revisions:
            raise ProviderError("TTS_MODEL_LOAD_FAILED", "candidate failed to warm")

    async def close(self) -> None:
        self.close_calls += 1


@pytest.mark.asyncio
async def test_retired_generation_closes_only_after_last_session_lease(monkeypatch, tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source["revision"] = 2
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = await runtime.acquire_view()
    assert await runtime._activate(load_snapshot(replacement)) is True
    assert old_view.registry.close_calls == 0
    assert runtime.view.snapshot.revision == 2

    await runtime.release_view(old_view)
    assert old_view.registry.close_calls == 1
    await runtime.stop()
    assert TrackingRegistry.instances[-1].close_calls == 1


@pytest.mark.asyncio
async def test_failed_candidate_is_closed_and_old_generation_stays_active(monkeypatch, tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source["revision"] = 3
    candidate = tmp_path / "candidate.json"
    candidate.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()
    TrackingRegistry.fail_revisions.add(3)

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = runtime.view
    assert await runtime._activate(load_snapshot(candidate)) is False
    assert runtime.view is old_view
    assert runtime.activation_failures == 1
    assert TrackingRegistry.instances[-1].close_calls == 1
    await runtime.stop()
