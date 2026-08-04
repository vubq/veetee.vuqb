from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))
from realtime_lab import LabError, TurnResult, percentile, profile_name, read_wav, report  # noqa: E402


@pytest.mark.parametrize(
    ("version", "profile"),
    [(1, "ws-v1-compat"), (2, "ws-v2"), (3, "ws-v3")],
)
def test_profile_name_is_explicit_and_wire_compatible(version: int, profile: str) -> None:
    assert profile_name(version) == profile


def test_profile_name_rejects_implicit_downgrade() -> None:
    with pytest.raises(LabError, match="profile must be one of"):
        profile_name(4)


def test_percentile_uses_nearest_rank() -> None:
    assert percentile([1, 3, 2, 4], 50) == 2
    assert percentile([], 95) is None


def test_report_ignores_warmup_and_requires_complete_tts() -> None:
    results = [
        TurnResult(1, 1800, 2, True, True, False, ()),
        TurnResult(2, 1100, 3, True, True, False, ()),
        TurnResult(3, 1200, 3, True, True, False, ()),
    ]
    value = report(results, warmup_turns=1, max_ttfa_ms=1500, profile=3)
    assert value["pass"] is True
    assert value["warmP50Ms"] == 1100
    assert value["profile"] == 3


def test_report_rejects_missing_binary_or_stop() -> None:
    value = report([TurnResult(1, 800, 0, True, False, False, ())], warmup_turns=0, max_ttfa_ms=1500)
    assert value["pass"] is False


def test_read_wav_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(LabError, match="cannot read WAV"):
        read_wav(tmp_path / "missing.wav")
