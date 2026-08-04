from __future__ import annotations

import asyncio
import json
from pathlib import Path

import httpx
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


def budgeted_snapshot(fixture: Path, target: Path, **overrides):
    source = json.loads(fixture.read_text(encoding="utf-8"))
    source["revision"] = max(2, int(source["revision"]))
    source["resourceBudget"] = {
        "physicalVramMiB": 4096,
        "promotionLimitMiB": 3500,
        "measuredWarmBaselineMiB": 1200,
        "candidatePeakDeltaMiB": 900,
        "candidateWarmPeakMiB": 1800,
        "sessionWorkspaceReserveMiB": 256,
        "activationMarginMiB": 128,
        **overrides,
    }
    target.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    return load_snapshot(target)


@pytest.mark.asyncio
async def test_initial_resource_plan_is_recorded_without_dual_residency(monkeypatch, tmp_path):
    candidate_file = tmp_path / "candidate.json"
    candidate = budgeted_snapshot(FIXTURE, candidate_file)
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(candidate_file))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    try:
        assert runtime.last_activation_mode == "INITIAL"
        assert runtime.last_resource_projection_mib == 2184
        assert runtime.view.snapshot is candidate or runtime.view.snapshot.revision == candidate.revision
    finally:
        await runtime.stop()


@pytest.mark.asyncio
async def test_over_budget_candidate_is_rejected_before_registry_instantiation(monkeypatch, tmp_path):
    candidate_file = tmp_path / "candidate.json"
    candidate = budgeted_snapshot(FIXTURE, candidate_file, candidatePeakDeltaMiB=2200, candidateWarmPeakMiB=3200)
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    try:
        old_view = runtime.view
        assert await runtime._activate(candidate) is False
        assert runtime.view is old_view
        assert len(TrackingRegistry.instances) == 1
        assert runtime.last_activation_error_type == "ResourceBudgetError"
    finally:
        await runtime.stop()


@pytest.mark.asyncio
async def test_quiesce_candidate_waits_for_session_leases(monkeypatch, tmp_path):
    candidate_file = tmp_path / "candidate.json"
    candidate = budgeted_snapshot(FIXTURE, candidate_file, candidatePeakDeltaMiB=2200)
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = await runtime.acquire_view()
    try:
        assert await runtime._activate(candidate) is False
        assert runtime.view is old_view
        assert len(TrackingRegistry.instances) == 1
        assert runtime.last_activation_error_type == "ResourceBudgetError"
    finally:
        await runtime.release_view(old_view)
        await runtime.stop()


@pytest.mark.asyncio
async def test_quiesce_candidate_unloads_old_and_promotes_when_no_lease(monkeypatch, tmp_path):
    candidate_file = tmp_path / "candidate.json"
    candidate = budgeted_snapshot(FIXTURE, candidate_file, candidatePeakDeltaMiB=2200)
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = runtime.view
    assert await runtime._activate(candidate) is True
    assert runtime.view.snapshot.revision == candidate.revision
    assert runtime.last_activation_mode == "QUIESCE_SWAP"
    assert old_view.registry.close_calls == 1
    await runtime.stop()


@pytest.mark.asyncio
async def test_quiesce_failure_reloads_exact_old_snapshot(monkeypatch, tmp_path):
    candidate_file = tmp_path / "candidate.json"
    candidate = budgeted_snapshot(FIXTURE, candidate_file, candidatePeakDeltaMiB=2200)
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", TrackingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()
    TrackingRegistry.fail_revisions.add(candidate.revision)

    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    try:
        old_snapshot = runtime.view.snapshot
        assert await runtime._activate(candidate) is False
        assert runtime.view.snapshot is old_snapshot
        assert runtime.view.snapshot.revision == 1
        assert len(TrackingRegistry.instances) == 3  # initial, failed candidate, exact old reload
        assert runtime.last_activation_error_type == "ProviderError"
    finally:
        await runtime.stop()


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
async def test_candidate_prepare_does_not_block_existing_view_leases(monkeypatch, tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source["revision"] = 2
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    started = asyncio.Event()
    release = asyncio.Event()

    class BlockingRegistry(TrackingRegistry):
        async def prepare(self) -> None:
            if self.snapshot.revision == 2:
                started.set()
                await release.wait()
            await super().prepare()

    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", BlockingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = await runtime.acquire_view()
    activation = asyncio.create_task(runtime._activate(load_snapshot(replacement)))
    await asyncio.wait_for(started.wait(), timeout=1)

    probe = await asyncio.wait_for(runtime.acquire_view(), timeout=0.1)
    assert probe is old_view
    await runtime.release_view(probe)
    release.set()
    assert await activation is True
    assert runtime.view.snapshot.revision == 2
    await runtime.release_view(old_view)
    await runtime.stop()


@pytest.mark.asyncio
async def test_cancelled_candidate_prepare_closes_partial_registry(monkeypatch, tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source["revision"] = 2
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    started = asyncio.Event()

    class BlockingRegistry(TrackingRegistry):
        async def prepare(self) -> None:
            if self.snapshot.revision == 2:
                started.set()
                await asyncio.Future()
            await super().prepare()

    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", BlockingRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    activation = asyncio.create_task(runtime._activate(load_snapshot(replacement)))
    await asyncio.wait_for(started.wait(), timeout=1)
    activation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await activation
    assert TrackingRegistry.instances[-1].close_calls == 1
    assert runtime.view.snapshot.revision == 1
    await runtime.stop()


@pytest.mark.asyncio
async def test_untyped_candidate_failure_is_closed_and_keeps_last_good_view(monkeypatch, tmp_path):
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    source["revision"] = 2
    replacement = tmp_path / "replacement.json"
    replacement.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))

    class UnexpectedRegistry(TrackingRegistry):
        async def prepare(self) -> None:
            if self.snapshot.revision == 2:
                raise RuntimeError("native model loader failed")
            await super().prepare()

    monkeypatch.setattr("veetee_server.runtime.ProviderRegistry", UnexpectedRegistry)
    TrackingRegistry.instances.clear()
    TrackingRegistry.fail_revisions.clear()
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    old_view = runtime.view
    assert await runtime._activate(load_snapshot(replacement)) is False
    assert runtime.view is old_view
    assert runtime.last_activation_error_type == "RuntimeError"
    assert TrackingRegistry.instances[-1].close_calls == 1
    await runtime.stop()


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


@pytest.mark.asyncio
async def test_successful_unchanged_poll_clears_transient_error_without_resetting_counter(monkeypatch):
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    await runtime.start()
    try:
        runtime.activation_failures = 3
        runtime.last_activation_error_type = "ConnectError"
        assert await runtime.refresh_now() is False
        assert runtime.activation_failures == 3
        assert runtime.last_activation_error_type is None
    finally:
        await runtime.stop()


@pytest.mark.asyncio
async def test_manager_snapshot_client_reuses_pool_and_retries_transient_connect(monkeypatch):
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "manager")
    monkeypatch.setenv("VEETEE_MANAGER_API_URL", "http://manager.test")
    monkeypatch.setenv("VEETEE_ALLOW_INSECURE_LOCAL_CONFIG", "true")
    source = json.loads(FIXTURE.read_text(encoding="utf-8"))
    created: list[dict[str, object]] = []
    calls = 0
    closed = 0

    class Response:
        status_code = 200
        headers = {"etag": '"fixture-etag"'}

        def json(self):
            return source

    class Client:
        def __init__(self, **kwargs):
            created.append(kwargs)

        async def get(self, url, *, headers):
            nonlocal calls
            del url, headers
            calls += 1
            if calls == 1:
                raise httpx.ConnectError("temporary manager disconnect")
            return Response()

        async def aclose(self):
            nonlocal closed
            closed += 1

    monkeypatch.setattr("veetee_server.runtime.httpx.AsyncClient", Client)
    runtime = RuntimeConfigManager(ServerConfig.from_env())
    first = await runtime._read_source()
    second = await runtime._read_source()

    assert first.checksum == second.checksum
    assert calls == 3  # one bounded retry, then one pooled request
    assert len(created) == 1
    await runtime.stop()
    assert closed == 1
