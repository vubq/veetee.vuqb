#!/usr/bin/env python3
"""Event-driven, opt-in physical wake-word test harness.

The harness deliberately does not open a microphone, flash the board, toggle
RTS/DTR, or send serial commands.  It starts an IDF monitor with --no-reset,
plays a configured wake clip, waits for configured serial markers, and only
then plays the utterance clip.  A separate explicit --allow-audio flag is
required before any player process is started.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import pty
import signal
import subprocess
import sys
import threading
import time
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen
from urllib.parse import urlparse


class HarnessError(RuntimeError):
    """A user-actionable scenario or runtime error."""


@dataclass(frozen=True)
class Stage:
    name: str
    marker: str
    timeout_seconds: float


@dataclass(frozen=True)
class PlayerResult:
    """Bounded, non-audio result from one playback process."""

    returncode: int
    duration_ms: float
    stderr: str


@dataclass(frozen=True)
class Scenario:
    source: Path
    monitor_command: tuple[str, ...]
    project_dir: Path
    serial_port: str
    monitor_baud: int
    player_command: tuple[str, ...]
    health_url: str | None
    wake_clip: Path
    utterance_clip: Path
    stages: tuple[Stage, ...]
    forbidden_markers: tuple[str, ...]
    utterance_after: str
    startup_wait_seconds: float
    inter_repetition_delay_seconds: float
    repetitions: int
    firmware_config: Path
    required_protocol_profile: int
    require_wake_enabled: bool


def _string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise HarnessError(f"{field} must be a non-empty string")
    return value.strip()


def _command(value: Any, field: str, *, require_file_placeholder: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item for item in value):
        raise HarnessError(f"{field} must be a non-empty argv array")
    command = tuple(value)
    if require_file_placeholder and "{file}" not in command:
        raise HarnessError(f"{field} must contain the literal {{file}} placeholder")
    return command


def _number(value: Any, field: str, *, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= float(value) <= maximum:
        raise HarnessError(f"{field} must be between {minimum} and {maximum}")
    return float(value)


def _boolean(value: Any, field: str, *, default: bool) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise HarnessError(f"{field} must be a boolean")
    return value


def _string_list(value: Any, field: str, *, maximum: int = 64) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > maximum:
        raise HarnessError(f"{field} must be a list with at most {maximum} items")
    values: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise HarnessError(f"{field}[{index}] must be a non-empty string")
        marker = item.strip()
        if marker not in values:
            values.append(marker)
    return tuple(values)


def _path(value: Any, *, base: Path, field: str) -> Path:
    raw = os.path.expandvars(os.path.expanduser(_string(value, field)))
    path = Path(raw)
    return (path if path.is_absolute() else base / path).resolve()


def load_scenario(path: Path) -> Scenario:
    source = path.expanduser().resolve()
    try:
        document = json.loads(source.read_text(encoding="utf-8"))
    except OSError as error:
        raise HarnessError(f"cannot read scenario {source}: {error}") from error
    except json.JSONDecodeError as error:
        raise HarnessError(f"invalid JSON in {source}: {error}") from error
    if not isinstance(document, dict):
        raise HarnessError("scenario root must be an object")

    monitor = document.get("monitor")
    player = document.get("player")
    clips = document.get("clips")
    events = document.get("events")
    firmware = document.get("firmware", {})
    if not isinstance(monitor, dict) or not isinstance(player, dict) or not isinstance(clips, dict) or not isinstance(events, list) or not isinstance(firmware, dict):
        raise HarnessError("scenario requires monitor, player, clips and events")

    stages: list[Stage] = []
    for index, item in enumerate(events):
        if not isinstance(item, dict):
            raise HarnessError(f"events[{index}] must be an object")
        stages.append(Stage(
            name=_string(item.get("name"), f"events[{index}].name"),
            marker=_string(item.get("marker"), f"events[{index}].marker"),
            timeout_seconds=_number(item.get("timeoutSeconds", 30), f"events[{index}].timeoutSeconds", minimum=0.1, maximum=3600),
        ))
    if not stages:
        raise HarnessError("events must contain at least one stage")
    names = [stage.name for stage in stages]
    if len(set(names)) != len(names):
        raise HarnessError("events names must be unique")

    base = source.parent
    project_dir = _path(monitor.get("projectDir", "../../veetee-firmware"), base=base, field="monitor.projectDir")
    firmware_config = _path(firmware.get("configFile", str(project_dir / "sdkconfig")), base=base, field="firmware.configFile")
    required_protocol_profile = int(_number(
        firmware.get("requiredProtocolProfile", 3),
        "firmware.requiredProtocolProfile",
        minimum=1,
        maximum=3,
    ))
    return Scenario(
        source=source,
        monitor_command=_command(monitor.get("command", ["idf.py"]), "monitor.command"),
        project_dir=project_dir,
        serial_port=_string(monitor.get("serialPort", "/dev/ttyACM0"), "monitor.serialPort"),
        monitor_baud=int(_number(monitor.get("baud", 115200), "monitor.baud", minimum=1200, maximum=4_000_000)),
        player_command=_command(player.get("command", ["pw-play", "{file}"]), "player.command", require_file_placeholder=True),
        health_url=_string(monitor["healthUrl"], "monitor.healthUrl") if monitor.get("healthUrl") is not None else None,
        wake_clip=_path(clips.get("wake"), base=base, field="clips.wake"),
        utterance_clip=_path(clips.get("utterance"), base=base, field="clips.utterance"),
        stages=tuple(stages),
        forbidden_markers=_string_list(document.get("forbiddenMarkers", []), "forbiddenMarkers"),
        utterance_after=_string(document.get("utteranceAfter", stages[0].name), "utteranceAfter"),
        startup_wait_seconds=_number(monitor.get("startupWaitSeconds", 1), "monitor.startupWaitSeconds", minimum=0, maximum=30),
        inter_repetition_delay_seconds=_number(document.get("interRepetitionDelaySeconds", 0.25), "interRepetitionDelaySeconds", minimum=0, maximum=10),
        repetitions=int(_number(document.get("repetitions", 1), "repetitions", minimum=1, maximum=100)),
        firmware_config=firmware_config,
        required_protocol_profile=required_protocol_profile,
        require_wake_enabled=_boolean(firmware.get("requireWakeEnabled"), "firmware.requireWakeEnabled", default=True),
    )


def _render_player(command: tuple[str, ...], clip: Path) -> list[str]:
    return [item.replace("{file}", str(clip)) for item in command]


def _check_clip(path: Path, field: str, *, required: bool) -> str | None:
    if path.is_file() and path.stat().st_size > 0:
        return None
    message = f"{field} does not point to a non-empty file: {path}"
    if required:
        raise HarnessError(message)
    return message


def _health(url: str) -> dict[str, Any]:
    request = Request(url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, json.JSONDecodeError) as error:
        raise HarnessError(f"health check failed for {url}: {error}") from error
    if not isinstance(payload, dict) or payload.get("status") != "ready":
        raise HarnessError(f"health check is not ready: {payload!r}")
    return payload


def _sdkconfig_value(lines: list[str], key: str) -> str | None:
    prefix = f"CONFIG_{key}="
    disabled = f"# CONFIG_{key} is not set"
    for raw in lines:
        line = raw.strip()
        if line == disabled:
            return None
        if not line.startswith(prefix):
            continue
        value = line[len(prefix):].strip()
        if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as error:
                raise HarnessError(f"invalid {key} value in firmware config {value!r}") from error
            if not isinstance(parsed, str):
                raise HarnessError(f"{key} must be a string in firmware config")
            return parsed
        return value
    return None


def preflight_firmware_config(scenario: Scenario) -> dict[str, Any]:
    """Validate build-time gates before any monitor or audio process starts."""

    try:
        lines = scenario.firmware_config.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise HarnessError(f"cannot read firmware config {scenario.firmware_config}: {error}") from error

    uri = _sdkconfig_value(lines, "VEETEE_WS_URI")
    if not uri or urlparse(uri).scheme not in {"ws", "wss"}:
        raise HarnessError(
            f"firmware config {scenario.firmware_config} has no valid WebSocket URI; "
            "provision CONFIG_VEETEE_WS_URI before physical audio"
        )

    profile = _sdkconfig_value(lines, "VEETEE_PROTOCOL_PROFILE")
    if profile != str(scenario.required_protocol_profile):
        raise HarnessError(
            f"firmware protocol profile is {profile!r}; expected "
            f"{scenario.required_protocol_profile} for this scenario"
        )

    wake_enabled = _sdkconfig_value(lines, "VEETEE_WAKE_ENABLED") == "y"
    model_name = _sdkconfig_value(lines, "VEETEE_WAKE_MODEL_NAME") or ""
    if scenario.require_wake_enabled and (not wake_enabled or not model_name):
        raise HarnessError(
            "firmware WakeNet is not enabled/configured; set "
            "CONFIG_VEETEE_WAKE_ENABLED=y and a model name before physical audio"
        )

    return {
        "path": str(scenario.firmware_config),
        "websocketScheme": urlparse(uri).scheme,
        "protocolProfile": int(profile),
        "wakeEnabled": wake_enabled,
        "wakeModelConfigured": bool(model_name),
    }


class Monitor:
    def __init__(self, scenario: Scenario, *, verbose: bool) -> None:
        self.scenario = scenario
        command = [
            *scenario.monitor_command,
            "-C", str(scenario.project_dir),
            "-p", scenario.serial_port,
            "monitor",
            "--no-reset",
            "--monitor-baud", str(scenario.monitor_baud),
        ]
        self.command = command
        self.project_dir = scenario.project_dir
        self.verbose = verbose
        self.process: subprocess.Popen[str] | None = None
        self._pty_master: int | None = None
        self.lines: deque[tuple[float, str]] = deque(maxlen=120)
        self._queue: deque[tuple[float, str]] = deque()
        self._forbidden_hits: deque[tuple[float, str, str]] = deque(maxlen=32)
        self._condition = threading.Condition()
        self._reader: threading.Thread | None = None

    def start(self) -> None:
        master, slave = pty.openpty()
        self._pty_master = master
        try:
            self.process = subprocess.Popen(
                self.command,
                cwd=str(self.project_dir),
                stdin=slave,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
        except OSError as error:
            os.close(slave)
            os.close(master)
            self._pty_master = None
            raise HarnessError(f"could not start monitor {' '.join(self.command)}: {error}") from error
        os.close(slave)
        assert self.process.stdout is not None
        self._reader = threading.Thread(target=self._read, args=(self.process.stdout,), name="veetee-serial-reader", daemon=True)
        self._reader.start()

    def _read(self, stream: Any) -> None:
        for raw in stream:
            line = raw.rstrip("\r\n")
            timestamp = time.monotonic()
            with self._condition:
                self.lines.append((timestamp, line))
                self._queue.append((timestamp, line))
                for marker in self.scenario.forbidden_markers:
                    if marker in line:
                        self._forbidden_hits.append((timestamp, marker, line))
                self._condition.notify_all()
            if self.verbose:
                print(f"serial: {line}", flush=True)

    def wait_for(self, marker: str, timeout_seconds: float, *, not_before: float | None = None) -> tuple[float, str]:
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            while True:
                if self._forbidden_hits:
                    _, forbidden, line = self._forbidden_hits[0]
                    raise HarnessError(f"forbidden serial marker observed: {forbidden!r}: {line}")
                if not_before is not None:
                    self._queue = deque(item for item in self._queue if item[0] >= not_before)
                for index, (timestamp, line) in enumerate(self._queue):
                    if marker in line:
                        del self._queue[index]
                        return timestamp, line
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    tail = len(self.lines)
                    raise HarnessError(f"serial marker timed out: {marker!r} ({tail} lines observed)")
                if self.process is not None and self.process.poll() is not None and not self._queue:
                    raise HarnessError(f"serial monitor exited with status {self.process.returncode} before marker {marker!r}")
                self._condition.wait(timeout=remaining)

    def forbidden_hits(self) -> tuple[tuple[float, str, str], ...]:
        with self._condition:
            return tuple(self._forbidden_hits)

    def stop(self) -> None:
        process = self.process
        try:
            if process is not None and process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except OSError:
                        pass
                    process.wait(timeout=2)
        finally:
            if self._pty_master is not None:
                try:
                    os.close(self._pty_master)
                except OSError:
                    pass
                self._pty_master = None


def _start_player(command: tuple[str, ...], clip: Path, *, allow_audio: bool) -> subprocess.Popen[bytes]:
    if not allow_audio:
        raise HarnessError("audio playback is disabled; pass --allow-audio only after owner approval")
    rendered = _render_player(command, clip)
    try:
        return subprocess.Popen(rendered, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
    except OSError as error:
        raise HarnessError(f"could not start audio player {' '.join(rendered)}: {error}") from error


def _wait_player(process: subprocess.Popen[bytes], clip: Path, timeout_seconds: float = 300) -> PlayerResult:
    started = time.monotonic()
    try:
        _, raw_stderr = process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as error:
        _terminate_process(process)
        raise HarnessError(f"audio player did not finish within {timeout_seconds:g}s: {clip}") from error
    stderr = raw_stderr.decode("utf-8", errors="replace").strip() if raw_stderr else ""
    # Keep diagnostics useful without allowing an unexpectedly chatty player to
    # turn a redacted report into an unbounded artifact. Raw audio is never
    # captured here; only the player's textual stderr is retained.
    if len(stderr) > 512:
        stderr = f"{stderr[:512]}..."
    return PlayerResult(
        returncode=process.returncode if process.returncode is not None else -1,
        duration_ms=round((time.monotonic() - started) * 1000, 1),
        stderr=stderr,
    )


def _terminate_process(process: subprocess.Popen[Any] | None) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass


def _event(name: str, started: float, **fields: Any) -> dict[str, Any]:
    return {
        "event": name,
        "at": datetime.now(timezone.utc).isoformat(),
        "elapsedMs": round((time.monotonic() - started) * 1000, 1),
        **fields,
    }


def run(
    scenario: Scenario,
    *,
    allow_audio: bool,
    dry_run: bool,
    verbose: bool,
    result_sink: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    missing = [message for message in (
        _check_clip(scenario.wake_clip, "clips.wake", required=not dry_run),
        _check_clip(scenario.utterance_clip, "clips.utterance", required=not dry_run),
    ) if message]
    monitor_command = [
        *scenario.monitor_command,
        "-C", str(scenario.project_dir), "-p", scenario.serial_port,
        "monitor", "--no-reset", "--monitor-baud", str(scenario.monitor_baud),
    ]
    player_wake = _render_player(scenario.player_command, scenario.wake_clip)
    player_utterance = _render_player(scenario.player_command, scenario.utterance_clip)
    if not dry_run and not allow_audio:
        raise HarnessError("refusing to play audio without explicit --allow-audio")
    firmware_config: dict[str, Any] | None = None
    if scenario.firmware_config.is_file():
        try:
            firmware_config = preflight_firmware_config(scenario)
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
            "monitor": monitor_command,
            "playerWake": player_wake,
            "playerUtterance": player_utterance,
            "missingClips": missing,
            "firmwareConfig": firmware_config or {"path": str(scenario.firmware_config), "exists": False},
            "events": [stage.__dict__ for stage in scenario.stages],
            "forbiddenMarkers": list(scenario.forbidden_markers),
            "utteranceAfter": scenario.utterance_after,
            "interRepetitionDelaySeconds": scenario.inter_repetition_delay_seconds,
            "repetitions": scenario.repetitions,
        }, ensure_ascii=False, indent=2))
        return []

    assert firmware_config is not None
    if not scenario.project_dir.is_dir():
        raise HarnessError(f"monitor project directory does not exist: {scenario.project_dir}")
    if scenario.utterance_after not in {stage.name for stage in scenario.stages}:
        raise HarnessError(f"utteranceAfter does not name an events stage: {scenario.utterance_after}")
    if scenario.health_url:
        health = _health(scenario.health_url)
        print(json.dumps({"event": "health_ready", "health": health}, ensure_ascii=False), flush=True)

    started = time.monotonic()
    monitor = Monitor(scenario, verbose=verbose)
    results = result_sink if result_sink is not None else []
    wake_player: subprocess.Popen[bytes] | None = None
    utterance_player: subprocess.Popen[bytes] | None = None
    try:
        monitor.start()
        if scenario.startup_wait_seconds:
            time.sleep(scenario.startup_wait_seconds)

        def wait_and_record_player(
            process: subprocess.Popen[bytes],
            clip: Path,
            *,
            clip_role: str,
            repetition: int,
        ) -> PlayerResult:
            result = _wait_player(process, clip)
            event = _event(
                "audio_player_exit",
                started,
                repetition=repetition,
                clipRole=clip_role,
                exitCode=result.returncode,
                playerDurationMs=result.duration_ms,
                stderr=result.stderr,
            )
            results.append(event)
            print(json.dumps(event, ensure_ascii=False), flush=True)
            if result.returncode != 0:
                detail = f": {result.stderr}" if result.stderr else ""
                raise HarnessError(
                    f"audio player exited with status {result.returncode} for {clip}{detail}"
                )
            return result

        for repetition in range(1, scenario.repetitions + 1):
            stage_not_before = time.monotonic()
            wake_player = _start_player(scenario.player_command, scenario.wake_clip, allow_audio=True)
            utterance_played = False
            for stage in scenario.stages:
                try:
                    timestamp, line = monitor.wait_for(stage.marker, stage.timeout_seconds, not_before=stage_not_before)
                except HarnessError as error:
                    raise HarnessError(f"repetition {repetition} stage {stage.name}: {error}") from error
                result = _event(stage.name, started, repetition=repetition, marker=stage.marker,
                                serialElapsedMs=round((timestamp - started) * 1000, 1))
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
                stage_not_before = timestamp
                if stage.name == scenario.utterance_after and not utterance_played:
                    assert wake_player is not None
                    wait_and_record_player(
                        wake_player,
                        scenario.wake_clip,
                        clip_role="wake",
                        repetition=repetition,
                    )
                    wake_player = None
                    utterance_player = _start_player(scenario.player_command, scenario.utterance_clip, allow_audio=True)
                    wait_and_record_player(
                        utterance_player,
                        scenario.utterance_clip,
                        clip_role="utterance",
                        repetition=repetition,
                    )
                    utterance_player = None
                    utterance_played = True
                del line
            if wake_player is not None:
                wait_and_record_player(
                    wake_player,
                    scenario.wake_clip,
                    clip_role="wake",
                    repetition=repetition,
                )
                wake_player = None
            if not utterance_played:
                utterance_player = _start_player(scenario.player_command, scenario.utterance_clip, allow_audio=True)
                wait_and_record_player(
                    utterance_player,
                    scenario.utterance_clip,
                    clip_role="utterance",
                    repetition=repetition,
                )
                utterance_player = None
            if repetition < scenario.repetitions and scenario.inter_repetition_delay_seconds > 0:
                time.sleep(scenario.inter_repetition_delay_seconds)
        return results
    except subprocess.TimeoutExpired as error:
        raise HarnessError(f"audio player did not finish: {error}") from error
    finally:
        _terminate_process(utterance_player)
        _terminate_process(wake_player)
        monitor.stop()


def _write_report(
    path: Path,
    scenario: Scenario,
    events: list[dict[str, Any]],
    *,
    status: str,
    error: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "scenario": str(scenario.source),
        "status": status,
        "forbiddenMarkers": list(scenario.forbidden_markers),
        "events": events,
    }
    if error:
        payload["error"] = error
    path.expanduser().resolve().write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", type=Path, required=True, help="JSON scenario; keep local audio paths outside Git")
    parser.add_argument("--allow-audio", action="store_true", help="required safety acknowledgement before starting any player")
    parser.add_argument("--dry-run", action="store_true", help="validate and print commands without starting monitor or player")
    parser.add_argument("--verbose", action="store_true", help="print raw serial monitor lines")
    parser.add_argument("--report", type=Path, help="write matched event JSON to this path")
    args = parser.parse_args(argv)

    scenario: Scenario | None = None
    results: list[dict[str, Any]] = []
    try:
        scenario = load_scenario(args.scenario)
        results = run(
            scenario,
            allow_audio=args.allow_audio,
            dry_run=args.dry_run,
            verbose=args.verbose,
            result_sink=results,
        )
        if args.report and not args.dry_run:
            _write_report(args.report, scenario, results, status="passed")
        return 0
    except KeyboardInterrupt:
        if scenario is not None and args.report and not args.dry_run:
            _write_report(args.report, scenario, results, status="interrupted", error="keyboard_interrupt")
        print("interrupted; monitor/player cleanup requested", file=sys.stderr)
        return 130
    except HarnessError as error:
        if scenario is not None and args.report and not args.dry_run:
            _write_report(args.report, scenario, results, status="failed", error=str(error))
        print(f"wake-test: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
