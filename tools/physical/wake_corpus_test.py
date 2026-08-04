#!/usr/bin/env python3
"""Config-driven positive/negative WakeNet corpus runner.

This tool intentionally exercises only the physical wake boundary. A positive
case completes one normal turn with the configured utterance clip so the board
returns to an armed detector before the next case. A negative case must remain
quiet for its configured observation window. Audio playback is opt-in and the
report contains event metadata only; it never stores audio or credentials.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
from typing import Any

try:
    import wake_audio_test
except ModuleNotFoundError:  # pragma: no cover - useful when imported by tooling
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import wake_audio_test


HarnessError = wake_audio_test.HarnessError
Monitor = wake_audio_test.Monitor
Scenario = wake_audio_test.Scenario


@dataclass(frozen=True)
class CorpusCase:
    name: str
    clip: Path
    expected_detection: bool
    detection_timeout_seconds: float
    settle_seconds: float


@dataclass(frozen=True)
class Corpus:
    source: Path
    cases: tuple[CorpusCase, ...]
    completion_clip: Path
    wake_detected_marker: str
    capture_started_marker: str
    assistant_speaking_marker: str
    completion_failed_marker: str | None
    rearmed_marker: str
    capture_timeout_seconds: float
    speaking_timeout_seconds: float
    rearmed_timeout_seconds: float


def _string(value: Any, field: str) -> str:
    return wake_audio_test._string(value, field)


def _number(value: Any, field: str, *, minimum: float, maximum: float) -> float:
    return wake_audio_test._number(value, field, minimum=minimum, maximum=maximum)


def _path(value: Any, *, base: Path, field: str) -> Path:
    return wake_audio_test._path(value, base=base, field=field)


def load_corpus(path: Path) -> Corpus:
    source = path.expanduser().resolve()
    try:
        document = json.loads(source.read_text(encoding="utf-8"))
    except OSError as error:
        raise HarnessError(f"cannot read corpus {source}: {error}") from error
    except json.JSONDecodeError as error:
        raise HarnessError(f"invalid JSON in {source}: {error}") from error
    if not isinstance(document, dict):
        raise HarnessError("corpus root must be an object")

    markers = document.get("markers")
    raw_cases = document.get("cases")
    if not isinstance(markers, dict) or not isinstance(raw_cases, list) or not raw_cases:
        raise HarnessError("corpus requires markers and a non-empty cases list")
    if len(raw_cases) > 100:
        raise HarnessError("corpus cases must not exceed 100 entries")

    base = source.parent
    cases: list[CorpusCase] = []
    names: set[str] = set()
    for index, raw in enumerate(raw_cases):
        if not isinstance(raw, dict):
            raise HarnessError(f"cases[{index}] must be an object")
        name = _string(raw.get("name"), f"cases[{index}].name")
        if name in names:
            raise HarnessError(f"duplicate corpus case name: {name}")
        names.add(name)
        expected = _string(raw.get("expected"), f"cases[{index}].expected")
        if expected not in {"detected", "not_detected"}:
            raise HarnessError(f"cases[{index}].expected must be detected or not_detected")
        cases.append(CorpusCase(
            name=name,
            clip=_path(raw.get("clip"), base=base, field=f"cases[{index}].clip"),
            expected_detection=expected == "detected",
            detection_timeout_seconds=_number(
                raw.get("detectionTimeoutSeconds", 15),
                f"cases[{index}].detectionTimeoutSeconds",
                minimum=0.1,
                maximum=300,
            ),
            settle_seconds=_number(
                raw.get("settleSeconds", 0.25),
                f"cases[{index}].settleSeconds",
                minimum=0,
                maximum=10,
            ),
        ))

    return Corpus(
        source=source,
        cases=tuple(cases),
        completion_clip=_path(document.get("completionClip"), base=base, field="completionClip"),
        wake_detected_marker=_string(markers.get("wakeDetected"), "markers.wakeDetected"),
        capture_started_marker=_string(markers.get("captureStarted"), "markers.captureStarted"),
        assistant_speaking_marker=_string(markers.get("assistantSpeaking"), "markers.assistantSpeaking"),
        completion_failed_marker=(
            _string(markers.get("completionFailed"), "markers.completionFailed")
            if markers.get("completionFailed") is not None
            else None
        ),
        rearmed_marker=_string(markers.get("rearmed"), "markers.rearmed"),
        capture_timeout_seconds=_number(document.get("captureTimeoutSeconds", 10), "captureTimeoutSeconds", minimum=0.1, maximum=300),
        speaking_timeout_seconds=_number(document.get("speakingTimeoutSeconds", 60), "speakingTimeoutSeconds", minimum=0.1, maximum=600),
        rearmed_timeout_seconds=_number(document.get("rearmedTimeoutSeconds", 120), "rearmedTimeoutSeconds", minimum=0.1, maximum=900),
    )


def _event(name: str, started: float, **fields: Any) -> dict[str, Any]:
    return {
        "event": name,
        "at": datetime.now(timezone.utc).isoformat(),
        "elapsedMs": round((time.monotonic() - started) * 1000, 1),
        **fields,
    }


def _check_clip(path: Path, field: str) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise HarnessError(f"{field} does not point to a non-empty file: {path}")


def _record(results: list[dict[str, Any]], started: float, name: str, **fields: Any) -> dict[str, Any]:
    result = _event(name, started, **fields)
    results.append(result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def _wait_and_record_player(
    process: Any,
    clip: Path,
    *,
    started: float,
    results: list[dict[str, Any]],
    case_name: str,
    clip_role: str,
    playback_outcome: str = "completed",
    fail_on_nonzero: bool = True,
) -> None:
    player = wake_audio_test._wait_player(process, clip)
    _record(
        results,
        started,
        "audio_player_exit",
        case=case_name,
        clipRole=clip_role,
        playbackOutcome=playback_outcome,
        exitCode=player.returncode,
        playerDurationMs=player.duration_ms,
        stderr=player.stderr,
    )
    if fail_on_nonzero and player.returncode != 0:
        detail = f": {player.stderr}" if player.stderr else ""
        raise HarnessError(f"audio player exited with status {player.returncode} for {clip}{detail}")


def run(
    scenario: Scenario,
    corpus: Corpus,
    *,
    allow_audio: bool,
    dry_run: bool,
    verbose: bool,
    result_sink: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not dry_run and not allow_audio:
        raise HarnessError("refusing to play corpus audio without explicit --allow-audio")
    for index, case in enumerate(corpus.cases):
        _check_clip(case.clip, f"cases[{index}].clip") if not dry_run else None
    if not dry_run:
        _check_clip(corpus.completion_clip, "completionClip")

    firmware_config: dict[str, Any] | None = None
    if scenario.firmware_config.is_file():
        try:
            firmware_config = wake_audio_test.preflight_firmware_config(scenario)
        except HarnessError as error:
            if not dry_run:
                raise
            firmware_config = {"path": str(scenario.firmware_config), "error": str(error)}
    elif not dry_run:
        raise HarnessError(f"firmware config does not exist: {scenario.firmware_config}")

    if dry_run:
        print(json.dumps({
            "dryRun": True,
            "scenario": str(scenario.source),
            "corpus": str(corpus.source),
            "cases": [
                {"name": case.name, "clip": str(case.clip), "expected": "detected" if case.expected_detection else "not_detected"}
                for case in corpus.cases
            ],
            "completionClip": str(corpus.completion_clip),
            "firmwareConfig": firmware_config or {"path": str(scenario.firmware_config), "exists": False},
        }, ensure_ascii=False, indent=2))
        return []

    if not scenario.project_dir.is_dir():
        raise HarnessError(f"monitor project directory does not exist: {scenario.project_dir}")
    if scenario.health_url:
        health = wake_audio_test._health(scenario.health_url)
        print(json.dumps({"event": "health_ready", "health": health}, ensure_ascii=False), flush=True)

    started = time.monotonic()
    results = result_sink if result_sink is not None else []
    monitor = Monitor(scenario, verbose=verbose)
    player: Any = None
    try:
        monitor.start()
        if scenario.startup_wait_seconds:
            time.sleep(scenario.startup_wait_seconds)
        for case in corpus.cases:
            boundary = time.monotonic()
            _record(
                results,
                started,
                "corpus_case_start",
                case=case.name,
                expected="detected" if case.expected_detection else "not_detected",
            )
            player = wake_audio_test._start_player(scenario.player_command, case.clip, allow_audio=True)
            if case.expected_detection:
                try:
                    timestamp, _ = monitor.wait_for(
                        corpus.wake_detected_marker,
                        case.detection_timeout_seconds,
                        not_before=boundary,
                    )
                except HarnessError:
                    wake_audio_test._terminate_process(player)
                    _wait_and_record_player(
                        player,
                        case.clip,
                        started=started,
                        results=results,
                        case_name=case.name,
                        clip_role="wake",
                        playback_outcome="aborted_after_detection_failure",
                        fail_on_nonzero=False,
                    )
                    player = None
                    raise
                _record(
                    results,
                    started,
                    "wake_detected",
                    case=case.name,
                    marker=corpus.wake_detected_marker,
                    serialElapsedMs=round((timestamp - started) * 1000, 1),
                )
                _wait_and_record_player(
                    player,
                    case.clip,
                    started=started,
                    results=results,
                    case_name=case.name,
                    clip_role="wake",
                )
                player = None
                boundary = timestamp
                capture_timestamp, _ = monitor.wait_for(
                    corpus.capture_started_marker,
                    corpus.capture_timeout_seconds,
                    not_before=boundary,
                )
                _record(
                    results,
                    started,
                    "capture_started",
                    case=case.name,
                    marker=corpus.capture_started_marker,
                    serialElapsedMs=round((capture_timestamp - started) * 1000, 1),
                )
                player = wake_audio_test._start_player(scenario.player_command, corpus.completion_clip, allow_audio=True)
                _wait_and_record_player(
                    player,
                    corpus.completion_clip,
                    started=started,
                    results=results,
                    case_name=case.name,
                    clip_role="completion",
                )
                player = None
                outcome_markers = (corpus.assistant_speaking_marker,)
                if corpus.completion_failed_marker is not None:
                    outcome_markers += (corpus.completion_failed_marker,)
                speaking_timestamp, _, outcome_marker = monitor.wait_for_any(
                    outcome_markers,
                    corpus.speaking_timeout_seconds,
                    not_before=capture_timestamp,
                )
                completion_failed = outcome_marker == corpus.completion_failed_marker
                _record(
                    results,
                    started,
                    "turn_completion_failed" if completion_failed else "assistant_speaking",
                    case=case.name,
                    marker=outcome_marker,
                    serialElapsedMs=round((speaking_timestamp - started) * 1000, 1),
                )
                rearmed_timestamp, _ = monitor.wait_for(
                    corpus.rearmed_marker,
                    corpus.rearmed_timeout_seconds,
                    not_before=speaking_timestamp,
                )
                _record(
                    results,
                    started,
                    "wake_rearmed",
                    case=case.name,
                    marker=corpus.rearmed_marker,
                    serialElapsedMs=round((rearmed_timestamp - started) * 1000, 1),
                )
                if completion_failed:
                    raise HarnessError(
                        f"corpus case {case.name} detected wake but turn completion failed at marker {outcome_marker!r}"
                    )
            else:
                try:
                    monitor.assert_absent(
                        corpus.wake_detected_marker,
                        case.detection_timeout_seconds,
                        not_before=boundary,
                    )
                except HarnessError:
                    wake_audio_test._terminate_process(player)
                    _wait_and_record_player(
                        player,
                        case.clip,
                        started=started,
                        results=results,
                        case_name=case.name,
                        clip_role="negative",
                        playback_outcome="aborted_after_negative_failure",
                        fail_on_nonzero=False,
                    )
                    player = None
                    raise
                _wait_and_record_player(
                    player,
                    case.clip,
                    started=started,
                    results=results,
                    case_name=case.name,
                    clip_role="negative",
                )
                player = None
                _record(
                    results,
                    started,
                    "wake_not_detected",
                    case=case.name,
                    marker=corpus.wake_detected_marker,
                    observationMs=round(case.detection_timeout_seconds * 1000, 1),
                )
            if case.settle_seconds:
                time.sleep(case.settle_seconds)
        return results
    finally:
        wake_audio_test._terminate_process(player)
        monitor.stop()


def _write_report(path: Path, corpus: Corpus, events: list[dict[str, Any]], *, status: str, error: str | None = None) -> None:
    payload: dict[str, Any] = {
        "corpus": str(corpus.source),
        "status": status,
        "events": events,
    }
    if error:
        payload["error"] = error
    path.expanduser().resolve().write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", type=Path, required=True, help="base physical scenario")
    parser.add_argument("--corpus", type=Path, required=True, help="positive/negative corpus JSON")
    parser.add_argument("--allow-audio", action="store_true", help="required before starting any player")
    parser.add_argument("--dry-run", action="store_true", help="validate and print without monitor/player")
    parser.add_argument("--verbose", action="store_true", help="print raw serial monitor lines")
    parser.add_argument("--report", type=Path, help="write redacted report")
    args = parser.parse_args(argv)

    corpus: Corpus | None = None
    events: list[dict[str, Any]] = []
    try:
        scenario = wake_audio_test.load_scenario(args.scenario)
        corpus = load_corpus(args.corpus)
        events = run(
            scenario,
            corpus,
            allow_audio=args.allow_audio,
            dry_run=args.dry_run,
            verbose=args.verbose,
            result_sink=events,
        )
        if args.report and not args.dry_run:
            _write_report(args.report, corpus, events, status="passed")
        return 0
    except KeyboardInterrupt:
        if corpus is not None and args.report and not args.dry_run:
            _write_report(args.report, corpus, events, status="interrupted", error="keyboard_interrupt")
        print("wake-corpus: interrupted; cleanup requested", file=sys.stderr)
        return 130
    except HarnessError as error:
        if corpus is not None and args.report and not args.dry_run:
            _write_report(args.report, corpus, events, status="failed", error=str(error))
        print(f"wake-corpus: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
