from __future__ import annotations

import json
from pathlib import Path

import pytest

from veetee_server.resources import ActivationMode, ResourceBudgetError, plan_activation, parse_resource_budget
from veetee_server.config import load_snapshot


FIXTURE = Path(__file__).parents[1] / "config/fixtures/m0.json"


def snapshot_with_budget(tmp_path: Path, **budget: int):
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["resourceBudget"] = {
        "physicalVramMiB": 4096,
        "promotionLimitMiB": 3500,
        "measuredWarmBaselineMiB": 1200,
        "candidatePeakDeltaMiB": 900,
        "candidateWarmPeakMiB": 1800,
        "sessionWorkspaceReserveMiB": 256,
        "activationMarginMiB": 128,
        **budget,
    }
    path = tmp_path / "snapshot.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return load_snapshot(path)


def test_absent_resource_record_keeps_legacy_snapshot_compatible(tmp_path: Path):
    snapshot = load_snapshot(FIXTURE)
    assert parse_resource_budget(snapshot) is None
    assert plan_activation(snapshot, has_active_generation=True) is None


def test_blue_green_plan_uses_measured_headroom(tmp_path: Path):
    snapshot = snapshot_with_budget(tmp_path, candidatePeakDeltaMiB=900)
    plan = plan_activation(snapshot, has_active_generation=True)
    assert plan is not None
    assert plan.mode is ActivationMode.BLUE_GREEN
    assert plan.allocatable_headroom_mib == 1916
    assert plan.projected_total_mib == 2484


def test_candidate_without_dual_residency_uses_quiesce_plan(tmp_path: Path):
    snapshot = snapshot_with_budget(tmp_path, candidatePeakDeltaMiB=2200, candidateWarmPeakMiB=1800)
    plan = plan_activation(snapshot, has_active_generation=True)
    assert plan is not None
    assert plan.mode is ActivationMode.QUIESCE_SWAP
    assert plan.projected_total_mib == 2184


def test_candidate_that_does_not_fit_either_mode_is_rejected(tmp_path: Path):
    snapshot = snapshot_with_budget(tmp_path, candidatePeakDeltaMiB=2200, candidateWarmPeakMiB=3200)
    with pytest.raises(ResourceBudgetError) as error:
        plan_activation(snapshot, has_active_generation=True)
    assert error.value.code == "RESOURCE_BUDGET_EXCEEDED"


def test_initial_generation_must_fit_standalone_budget(tmp_path: Path):
    snapshot = snapshot_with_budget(tmp_path, candidateWarmPeakMiB=3200)
    with pytest.raises(ResourceBudgetError) as error:
        plan_activation(snapshot, has_active_generation=False)
    assert error.value.code == "RESOURCE_BUDGET_EXCEEDED"


def test_malformed_record_fails_closed(tmp_path: Path):
    snapshot = snapshot_with_budget(tmp_path, candidatePeakDeltaMiB="900")  # type: ignore[arg-type]
    with pytest.raises(ResourceBudgetError) as error:
        parse_resource_budget(snapshot)
    assert error.value.code == "RESOURCE_BUDGET_INVALID"
