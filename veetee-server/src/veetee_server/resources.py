"""Measured resource gates for provider-generation promotion.

The voice process must reject a model generation before its provider factory is
constructed when the published resource record cannot fit the host budget.  A
resource record is an evidence artifact, not a provider hint: all values are
measured for the exact artifact/runtime/hardware combination and are carried in
the immutable runtime snapshot.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Mapping

from .config import ConfigurationError, RuntimeSnapshot


DEFAULT_PHYSICAL_VRAM_MIB = 4096
DEFAULT_PROMOTION_LIMIT_MIB = 3500


class ResourceBudgetError(ConfigurationError):
    """A resource record is invalid or cannot be promoted safely."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ActivationMode(StrEnum):
    """How a candidate generation may be made active."""

    INITIAL = "INITIAL"
    BLUE_GREEN = "BLUE_GREEN"
    QUIESCE_SWAP = "QUIESCE_SWAP"


@dataclass(frozen=True, slots=True)
class ResourceBudget:
    physical_vram_mib: int
    promotion_limit_mib: int
    measured_warm_baseline_mib: int
    candidate_peak_delta_mib: int
    candidate_warm_peak_mib: int
    session_workspace_reserve_mib: int
    activation_margin_mib: int

    @property
    def allocatable_headroom_mib(self) -> int:
        return (
            self.promotion_limit_mib
            - self.measured_warm_baseline_mib
            - self.session_workspace_reserve_mib
            - self.activation_margin_mib
        )

    @property
    def projected_blue_green_total_mib(self) -> int:
        return (
            self.measured_warm_baseline_mib
            + self.candidate_peak_delta_mib
            + self.session_workspace_reserve_mib
            + self.activation_margin_mib
        )

    @property
    def projected_quiesce_total_mib(self) -> int:
        return self.candidate_warm_peak_mib + self.session_workspace_reserve_mib + self.activation_margin_mib


@dataclass(frozen=True, slots=True)
class ActivationPlan:
    mode: ActivationMode
    allocatable_headroom_mib: int
    projected_total_mib: int
    candidate_warm_peak_mib: int


def parse_resource_budget(snapshot: RuntimeSnapshot) -> ResourceBudget | None:
    """Parse an optional, strict resource record from a runtime snapshot.

    Absence preserves old snapshot compatibility.  Presence is fail-closed:
    partial, non-integer, or physically impossible records are rejected before
    any provider factory/model allocation takes place.
    """

    raw = snapshot.raw.get("resourceBudget")
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "snapshot.resourceBudget must be an object")

    values = {
        key: _required_mib(raw, key)
        for key in (
            "physicalVramMiB",
            "promotionLimitMiB",
            "measuredWarmBaselineMiB",
            "candidatePeakDeltaMiB",
            "candidateWarmPeakMiB",
            "sessionWorkspaceReserveMiB",
            "activationMarginMiB",
        )
    }
    physical = values["physicalVramMiB"]
    promotion = values["promotionLimitMiB"]
    baseline = values["measuredWarmBaselineMiB"]
    candidate_delta = values["candidatePeakDeltaMiB"]
    candidate_peak = values["candidateWarmPeakMiB"]
    session_reserve = values["sessionWorkspaceReserveMiB"]
    activation_margin = values["activationMarginMiB"]

    if physical != DEFAULT_PHYSICAL_VRAM_MIB:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "physicalVramMiB must describe the 4 GiB target device")
    if promotion <= 0 or promotion > DEFAULT_PROMOTION_LIMIT_MIB or promotion > physical:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "promotionLimitMiB exceeds the safe device budget")
    if baseline > promotion:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "measuredWarmBaselineMiB exceeds promotionLimitMiB")
    if candidate_delta > promotion:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "candidatePeakDeltaMiB is unreasonably large")
    if candidate_peak <= 0 or candidate_peak > promotion:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "candidateWarmPeakMiB must fit within promotionLimitMiB")
    if baseline + session_reserve + activation_margin > promotion:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", "baseline reserves leave no promotion budget")
    return ResourceBudget(
        physical_vram_mib=physical,
        promotion_limit_mib=promotion,
        measured_warm_baseline_mib=baseline,
        candidate_peak_delta_mib=candidate_delta,
        candidate_warm_peak_mib=candidate_peak,
        session_workspace_reserve_mib=session_reserve,
        activation_margin_mib=activation_margin,
    )


def plan_activation(snapshot: RuntimeSnapshot, *, has_active_generation: bool) -> ActivationPlan | None:
    """Return a measured promotion plan or ``None`` for legacy snapshots."""

    budget = parse_resource_budget(snapshot)
    if budget is None:
        return None
    if not has_active_generation:
        if budget.projected_quiesce_total_mib > budget.promotion_limit_mib:
            raise ResourceBudgetError(
                "RESOURCE_BUDGET_EXCEEDED",
                "initial generation exceeds the standalone promotion budget",
            )
        return ActivationPlan(
            mode=ActivationMode.INITIAL,
            allocatable_headroom_mib=budget.allocatable_headroom_mib,
            projected_total_mib=budget.projected_quiesce_total_mib,
            candidate_warm_peak_mib=budget.candidate_warm_peak_mib,
        )
    if budget.candidate_peak_delta_mib <= budget.allocatable_headroom_mib:
        return ActivationPlan(
            mode=ActivationMode.BLUE_GREEN,
            allocatable_headroom_mib=budget.allocatable_headroom_mib,
            projected_total_mib=budget.projected_blue_green_total_mib,
            candidate_warm_peak_mib=budget.candidate_warm_peak_mib,
        )
    if budget.projected_quiesce_total_mib <= budget.promotion_limit_mib:
        return ActivationPlan(
            mode=ActivationMode.QUIESCE_SWAP,
            allocatable_headroom_mib=budget.allocatable_headroom_mib,
            projected_total_mib=budget.projected_quiesce_total_mib,
            candidate_warm_peak_mib=budget.candidate_warm_peak_mib,
        )
    raise ResourceBudgetError(
        "RESOURCE_BUDGET_EXCEEDED",
        "candidate generation exceeds both blue-green headroom and quiesce budget",
    )


def _required_mib(raw: Mapping[str, Any], key: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ResourceBudgetError("RESOURCE_BUDGET_INVALID", f"resourceBudget.{key} must be a non-negative integer")
    return value
