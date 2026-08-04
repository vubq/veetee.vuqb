#!/usr/bin/env python3
"""Bounded, operator-driven M0 PTT physical acceptance harness.

This is intentionally a test tool rather than product runtime.  It starts an
ESP-IDF serial monitor with ``--no-reset`` and only observes serial output; it
never flashes firmware, writes NVS, changes Wi-Fi, sends serial input, or
simulates GPIO.  The operator presses and releases GPIO0 on the board.

An optional Vietnamese utterance clip is played only after an explicit
``--allow-audio`` acknowledgement.  Reports retain stage/timing/metric hashes
only: no raw serial lines, microphone audio, transcript text, cookie, header,
or provider secret is written to disk.
"""

from __future__ import annotations

import argparse
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import pty
import re
import signal
import subprocess
import sys
import threading
import time
from typing import Any
from unicodedata import normalize
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen


REPORT_SCHEMA_VERSION = 1
MAX_HTTP_BYTES = 512 * 1024
MAX_PLAYER_SECONDS = 300.0
MAX_SERIAL_LINE_CHARS = 2048
EXPECTED_STAGE_NAMES = ("ptt_start", "thinking", "ptt_stop", "speaking", "idle")
EXPECTED_STAGE_STATES = ("listening", "thinking", "thinking", "speaking", "idle")
SAFE_METRIC_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
SHA256_HEX = re.compile(r"^[0-9a-fA-F]{64}$")
FORBIDDEN_MONITOR_ARGUMENTS = frozenset({"flash", "erase_flash", "erase-flash", "fullclean"})


class HarnessError(RuntimeError):
    """A bounded error that is safe to show and place in a redacted report."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Stage:
    name: str
    semantic_state: str
    marker: str
    timeout_seconds: float


@dataclass(frozen=True)
class MonitorConfig:
    command: tuple[str, ...]
    project_dir: Path
    serial_port: str
    baud: int
    startup_wait_seconds: float
    health_url: str | None


@dataclass(frozen=True)
class AudioConfig:
    command: tuple[str, ...]
    clip: Path
    timeout_seconds: float


@dataclass(frozen=True)
class MetricsConfig:
    url: str
    timeout_seconds: float
    required_zero_after: tuple[str, ...]


@dataclass(frozen=True)
class OperatorConfig:
    ptt_gpio: int


@dataclass(frozen=True)
class HistoryConfig:
    api_base_url: str
    assistant_id: str
    speaker: str
    list_limit: int
    timeout_seconds: float
    poll_interval_seconds: float
    expected_phrase_sha256: str | None
    expected_phrase_file: Path | None
    session_cookie_file: Path | None


@dataclass(frozen=True)
class Scenario:
    source: Path
    monitor: MonitorConfig
    audio: AudioConfig | None
    metrics: MetricsConfig
    operator: OperatorConfig
    stages: tuple[Stage, ...]
    forbidden_markers: tuple[str, ...]
    history: HistoryConfig | None


@dataclass
class RunRecord:
    scenario_hash: str
    started_at: str
    serial_port: str
    audio_requested: bool
    events: list[dict[str, Any]]
    metrics_before: dict[str, float | int] | None = None
    metrics_after: dict[str, float | int] | None = None
    history: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    error_code: str | None = None
    completed_at: str | None = None

    def report(self, status: str) -> dict[str, Any]:
        before = self.metrics_before or {}
        after = self.metrics_after or {}
        delta = {
            key: _number_delta(before.get(key), after.get(key))
            for key in sorted(set(before) | set(after))
            if _number_delta(before.get(key), after.get(key)) is not None
        }
        return {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "status": status,
            "startedAt": self.started_at,
            "completedAt": self.completed_at or _utc_now(),
            "scenarioSha256": self.scenario_hash,
            "safety": {
                "serialMonitorNoReset": True,
                "firmwareFlashAttempted": False,
                "wifiConfigurationChanged": False,
                "serialInputSent": False,
                "audioRequested": self.audio_requested,
            },
            "serial": {"port": self.serial_port, "rawLinesPersisted": False},
            "events": self.events,
            "audio": self.audio,
            "metrics": {
                "before": before,
                "after": after,
                "delta": delta,
            },
            "history": self.history,
            "errorCode": self.error_code,
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _number_delta(before: Any, after: Any) -> float | int | None:
    if isinstance(before, bool) or isinstance(after, bool):
        return None
    if not isinstance(before, (int, float)) or not isinstance(after, (int, float)):
        return None
    return after - before


def _string(value: Any, field: str, *, maximum: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise HarnessError("scenario_invalid", f"{field} must be a non-empty string")
    return value.strip()


def _integer(value: Any, field: str, *, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise HarnessError("scenario_invalid", f"{field} must be an integer between {minimum} and {maximum}")
    return value


def _number(value: Any, field: str, *, minimum: float, maximum: float, default: float | None = None) -> float:
    if value is None and default is not None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= float(value) <= maximum:
        raise HarnessError("scenario_invalid", f"{field} must be between {minimum:g} and {maximum:g}")
    return float(value)


def _command(value: Any, field: str, *, require_file_placeholder: bool = False) -> tuple[str, ...]:
    if not isinstance(value, list) or not value or len(value) > 32:
        raise HarnessError("scenario_invalid", f"{field} must be a non-empty argv array")
    command: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item or len(item) > 4096:
            raise HarnessError("scenario_invalid", f"{field}[{index}] must be a non-empty string")
        if "\x00" in item:
            raise HarnessError("scenario_invalid", f"{field}[{index}] must not contain a NUL")
        command.append(item)
    if require_file_placeholder and "{file}" not in command:
        raise HarnessError("scenario_invalid", f"{field} must contain literal {{file}}")
    return tuple(command)


def _path(value: Any, *, base: Path, field: str) -> Path:
    raw = os.path.expandvars(os.path.expanduser(_string(value, field)))
    path = Path(raw)
    return (path if path.is_absolute() else base / path).resolve()


def _url(value: Any, field: str) -> str:
    raw = _string(value, field)
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise HarnessError("scenario_invalid", f"{field} must be an http(s) URL without embedded credentials")
    return raw.rstrip("/")


def _string_list(value: Any, field: str, *, maximum: int = 64) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > maximum:
        raise HarnessError("scenario_invalid", f"{field} must be a list with at most {maximum} values")
    unique: list[str] = []
    for index, item in enumerate(value):
        marker = _string(item, f"{field}[{index}]", maximum=256)
        if marker not in unique:
            unique.append(marker)
    return tuple(unique)


def _parse_stages(value: Any) -> tuple[Stage, ...]:
    if not isinstance(value, list) or len(value) != len(EXPECTED_STAGE_NAMES):
        raise HarnessError(
            "scenario_invalid",
            "stages must contain ptt_start, thinking, ptt_stop, speaking and idle exactly once",
        )
    stages: list[Stage] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise HarnessError("scenario_invalid", f"stages[{index}] must be an object")
        stages.append(Stage(
            name=_string(raw.get("name"), f"stages[{index}].name", maximum=64),
            semantic_state=_string(raw.get("semanticState"), f"stages[{index}].semanticState", maximum=64),
            marker=_string(raw.get("marker"), f"stages[{index}].marker", maximum=256),
            timeout_seconds=_number(raw.get("timeoutSeconds", 30), f"stages[{index}].timeoutSeconds", minimum=0.1, maximum=600),
        ))
    if tuple(stage.name for stage in stages) != EXPECTED_STAGE_NAMES:
        raise HarnessError("scenario_invalid", "stages names must preserve the required serial order")
    if tuple(stage.semantic_state for stage in stages) != EXPECTED_STAGE_STATES:
        raise HarnessError("scenario_invalid", "stages semanticState must preserve listening/thinking/speaking/idle flow")
    return tuple(stages)


def _parse_history(value: Any, *, base: Path) -> HistoryConfig | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise HarnessError("scenario_invalid", "history must be an object")
    expected_hash = value.get("expectedPhraseSha256")
    expected_file = value.get("expectedPhraseFile")
    if expected_hash is not None and expected_file is not None:
        raise HarnessError("scenario_invalid", "history accepts expectedPhraseSha256 or expectedPhraseFile, not both")
    parsed_hash: str | None = None
    if expected_hash is not None:
        parsed_hash = _string(expected_hash, "history.expectedPhraseSha256", maximum=64).lower()
        if not SHA256_HEX.fullmatch(parsed_hash):
            raise HarnessError("scenario_invalid", "history.expectedPhraseSha256 must be 64 hexadecimal characters")
    phrase_file = _path(expected_file, base=base, field="history.expectedPhraseFile") if expected_file is not None else None
    cookie_file = _path(value.get("sessionCookieFile"), base=base, field="history.sessionCookieFile") if value.get("sessionCookieFile") is not None else None
    return HistoryConfig(
        api_base_url=_url(value.get("apiBaseUrl"), "history.apiBaseUrl"),
        assistant_id=_string(value.get("assistantId"), "history.assistantId", maximum=160),
        speaker=_string(value.get("speaker", "user"), "history.speaker", maximum=32),
        list_limit=_integer(value.get("listLimit", 20), "history.listLimit", minimum=1, maximum=100),
        timeout_seconds=_number(value.get("timeoutSeconds", 15), "history.timeoutSeconds", minimum=0.1, maximum=120),
        poll_interval_seconds=_number(value.get("pollIntervalSeconds", 0.5), "history.pollIntervalSeconds", minimum=0.1, maximum=10),
        expected_phrase_sha256=parsed_hash,
        expected_phrase_file=phrase_file,
        session_cookie_file=cookie_file,
    )


def load_scenario(path: Path) -> Scenario:
    source = path.expanduser().resolve()
    try:
        document = json.loads(source.read_text(encoding="utf-8"))
    except OSError as error:
        raise HarnessError("scenario_unreadable", "cannot read scenario") from error
    except json.JSONDecodeError as error:
        raise HarnessError("scenario_invalid", "scenario is not valid JSON") from error
    if not isinstance(document, dict):
        raise HarnessError("scenario_invalid", "scenario root must be an object")
    monitor_raw = document.get("monitor")
    metrics_raw = document.get("metrics")
    operator_raw = document.get("operator")
    if not isinstance(monitor_raw, dict) or not isinstance(metrics_raw, dict) or not isinstance(operator_raw, dict):
        raise HarnessError("scenario_invalid", "scenario requires monitor, metrics and operator objects")
    base = source.parent
    command = _command(monitor_raw.get("command", ["idf.py"]), "monitor.command")
    if any(item in FORBIDDEN_MONITOR_ARGUMENTS for item in command):
        raise HarnessError("scenario_invalid", "monitor.command must not contain a flashing or erase action")
    project_dir = _path(monitor_raw.get("projectDir", "../../veetee-firmware"), base=base, field="monitor.projectDir")
    monitor = MonitorConfig(
        command=command,
        project_dir=project_dir,
        serial_port=_string(monitor_raw.get("serialPort", "/dev/ttyACM0"), "monitor.serialPort", maximum=512),
        baud=_integer(monitor_raw.get("baud", 115200), "monitor.baud", minimum=1200, maximum=4_000_000),
        startup_wait_seconds=_number(monitor_raw.get("startupWaitSeconds", 1), "monitor.startupWaitSeconds", minimum=0, maximum=30),
        health_url=_url(monitor_raw.get("healthUrl"), "monitor.healthUrl") if monitor_raw.get("healthUrl") is not None else None,
    )
    metrics = MetricsConfig(
        url=_url(metrics_raw.get("url"), "metrics.url"),
        timeout_seconds=_number(metrics_raw.get("timeoutSeconds", 5), "metrics.timeoutSeconds", minimum=0.1, maximum=30),
        required_zero_after=_string_list(metrics_raw.get("requiredZeroAfter", ["active_turns"]), "metrics.requiredZeroAfter", maximum=32),
    )
    ptt_gpio = _integer(operator_raw.get("pttGpio"), "operator.pttGpio", minimum=0, maximum=48)
    if ptt_gpio != 0:
        raise HarnessError("scenario_invalid", "this M0 PTT acceptance harness requires operator.pttGpio to be GPIO0")
    audio: AudioConfig | None = None
    audio_raw = document.get("audio")
    if audio_raw is not None:
        if not isinstance(audio_raw, dict):
            raise HarnessError("scenario_invalid", "audio must be an object")
        audio = AudioConfig(
            command=_command(audio_raw.get("command"), "audio.command", require_file_placeholder=True),
            clip=_path(audio_raw.get("clip"), base=base, field="audio.clip"),
            timeout_seconds=_number(audio_raw.get("timeoutSeconds", 60), "audio.timeoutSeconds", minimum=0.1, maximum=MAX_PLAYER_SECONDS),
        )
    return Scenario(
        source=source,
        monitor=monitor,
        audio=audio,
        metrics=metrics,
        operator=OperatorConfig(ptt_gpio=ptt_gpio),
        stages=_parse_stages(document.get("stages")),
        forbidden_markers=_string_list(document.get("forbiddenMarkers", []), "forbiddenMarkers"),
        history=_parse_history(document.get("history"), base=base),
    )


def monitor_command(scenario: Scenario) -> list[str]:
    return [
        *scenario.monitor.command,
        "-C", str(scenario.monitor.project_dir),
        "-p", scenario.monitor.serial_port,
        "monitor", "--no-reset", "--monitor-baud", str(scenario.monitor.baud),
    ]


class SerialMonitor:
    """Read-only serial monitor that preserves only bounded in-memory lines."""

    def __init__(self, scenario: Scenario) -> None:
        self.command = monitor_command(scenario)
        self.project_dir = scenario.monitor.project_dir
        self.forbidden_markers = scenario.forbidden_markers
        self.process: subprocess.Popen[str] | None = None
        self._pty_master: int | None = None
        self._reader: threading.Thread | None = None
        self._lines: deque[tuple[float, str]] = deque(maxlen=256)
        self._forbidden: str | None = None
        self._condition = threading.Condition()

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
            raise HarnessError("monitor_start_failed", "could not start read-only serial monitor") from error
        os.close(slave)
        assert self.process.stdout is not None
        self._reader = threading.Thread(target=self._read, args=(self.process.stdout,), name="veetee-ptt-serial", daemon=True)
        self._reader.start()

    def _read(self, stream: Any) -> None:
        for raw in stream:
            line = raw.rstrip("\r\n")[:MAX_SERIAL_LINE_CHARS]
            timestamp = time.monotonic()
            with self._condition:
                self._lines.append((timestamp, line))
                if self._forbidden is None:
                    self._forbidden = next((marker for marker in self.forbidden_markers if marker in line), None)
                self._condition.notify_all()

    def wait_for(self, marker: str, timeout_seconds: float, *, not_before: float) -> float:
        deadline = time.monotonic() + timeout_seconds
        with self._condition:
            while True:
                if self._forbidden is not None:
                    raise HarnessError("forbidden_serial_marker", "a configured forbidden serial marker was observed")
                while self._lines and self._lines[0][0] < not_before:
                    self._lines.popleft()
                for index, (timestamp, line) in enumerate(self._lines):
                    if marker in line:
                        del self._lines[index]
                        return timestamp
                if self.process is not None and self.process.poll() is not None:
                    raise HarnessError("monitor_exited", "serial monitor exited before the expected marker")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise HarnessError("marker_timeout", "timed out waiting for an expected serial marker")
                self._condition.wait(timeout=remaining)

    def assert_clean(self) -> None:
        with self._condition:
            if self._forbidden is not None:
                raise HarnessError("forbidden_serial_marker", "a configured forbidden serial marker was observed")

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
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass
        finally:
            if self._pty_master is not None:
                try:
                    os.close(self._pty_master)
                except OSError:
                    pass
                self._pty_master = None


def _safe_json_get(url: str, *, timeout_seconds: float, headers: dict[str, str] | None = None, purpose: str) -> Any:
    request = Request(url, headers={"Accept": "application/json", **(headers or {})}, method="GET")
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            if not 200 <= response.status < 300:
                raise HarnessError(f"{purpose}_http_status", f"{purpose} returned a non-success status")
            raw = response.read(MAX_HTTP_BYTES + 1)
    except HarnessError:
        raise
    except HTTPError as error:
        raise HarnessError(f"{purpose}_http_status", f"{purpose} returned HTTP {error.code}") from error
    except (URLError, OSError) as error:
        raise HarnessError(f"{purpose}_unavailable", f"{purpose} could not be reached") from error
    if len(raw) > MAX_HTTP_BYTES:
        raise HarnessError(f"{purpose}_oversized", f"{purpose} response exceeded its bounded size")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HarnessError(f"{purpose}_invalid_json", f"{purpose} did not return JSON") from error


def _check_health(url: str, *, timeout_seconds: float) -> None:
    payload = _safe_json_get(url, timeout_seconds=timeout_seconds, purpose="health")
    if not isinstance(payload, dict) or payload.get("status") != "ready":
        raise HarnessError("health_not_ready", "voice health endpoint is not ready")


def _read_metrics(config: MetricsConfig) -> dict[str, float | int]:
    payload = _safe_json_get(config.url, timeout_seconds=config.timeout_seconds, purpose="metrics")
    if not isinstance(payload, dict):
        raise HarnessError("metrics_invalid", "metrics endpoint did not return an object")
    result: dict[str, float | int] = {}
    for key, value in payload.items():
        if len(result) >= 256:
            break
        if not isinstance(key, str) or not SAFE_METRIC_KEY.fullmatch(key):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        result[key] = value
    if not result:
        raise HarnessError("metrics_invalid", "metrics endpoint did not contain numeric counters")
    return result


def _validate_metrics_after(config: MetricsConfig, metrics: dict[str, float | int]) -> None:
    for key in config.required_zero_after:
        value = metrics.get(key)
        if value != 0:
            raise HarnessError("metrics_not_idle", "post-turn metrics did not return to the configured idle value")


def _private_file(path: Path, *, role: str) -> str:
    try:
        stat = path.stat()
        if not path.is_file():
            raise HarnessError(f"{role}_missing", f"{role} file is not a regular file")
        if stat.st_mode & 0o077:
            raise HarnessError(f"{role}_permissions", f"{role} file must not be group/world accessible")
        value = path.read_text(encoding="utf-8").strip()
    except HarnessError:
        raise
    except OSError as error:
        raise HarnessError(f"{role}_unreadable", f"{role} file could not be read") from error
    if not value or len(value) > 4096:
        raise HarnessError(f"{role}_invalid", f"{role} file must contain one bounded value")
    return value


def normalized_phrase_sha256(value: str) -> str:
    """Hash an NFC/casefold/whitespace-normalized phrase without retaining it."""

    normalized = " ".join(normalize("NFC", value).casefold().split())
    return sha256(normalized.encode("utf-8")).hexdigest()


def _history_headers(config: HistoryConfig) -> dict[str, str]:
    if config.session_cookie_file is None:
        return {}
    cookie = _private_file(config.session_cookie_file, role="history_cookie")
    return {"Cookie": f"veetee_session={cookie}"}


def _history_list(config: HistoryConfig, headers: dict[str, str]) -> dict[str, dict[str, Any]]:
    assistant = quote(config.assistant_id, safe="")
    url = f"{config.api_base_url}/api/v1/assistants/{assistant}/conversations?limit={config.list_limit}"
    payload = _safe_json_get(url, timeout_seconds=config.timeout_seconds, headers=headers, purpose="history_list")
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise HarnessError("history_invalid", "history list response did not contain conversation items")
    result: dict[str, dict[str, Any]] = {}
    for item in payload["items"]:
        if not isinstance(item, dict):
            continue
        identifier = item.get("id")
        if not isinstance(identifier, str) or not identifier:
            continue
        result[identifier] = {
            "turnCount": item.get("turnCount"),
            "lastTurnAt": item.get("lastTurnAt"),
        }
    return result


def _changed_conversation(before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]) -> str | None:
    candidates: list[tuple[str, str]] = []
    for identifier, value in after.items():
        prior = before.get(identifier)
        if prior is None or prior != value:
            last_turn = value.get("lastTurnAt")
            candidates.append((last_turn if isinstance(last_turn, str) else "", identifier))
    return max(candidates)[1] if candidates else None


def _history_detail(config: HistoryConfig, headers: dict[str, str], conversation_id: str) -> dict[str, Any]:
    url = f"{config.api_base_url}/api/v1/conversations/{quote(conversation_id, safe='')}"
    payload = _safe_json_get(url, timeout_seconds=config.timeout_seconds, headers=headers, purpose="history_detail")
    if not isinstance(payload, dict) or not isinstance(payload.get("turns"), list):
        raise HarnessError("history_invalid", "history detail response did not contain turns")
    return payload


def _latest_phrase_hash(detail: dict[str, Any], speaker: str) -> tuple[str, str]:
    turns = [turn for turn in detail.get("turns", []) if isinstance(turn, dict)]
    if not turns:
        raise HarnessError("history_turn_missing", "history has no turn to verify")
    latest = max(turns, key=lambda turn: turn.get("sequence") if isinstance(turn.get("sequence"), int) else -1)
    turn_id = latest.get("turnId")
    if not isinstance(turn_id, str) or not turn_id:
        raise HarnessError("history_turn_invalid", "history turn did not contain a valid ID")
    transcript = latest.get("transcript")
    if not isinstance(transcript, list):
        raise HarnessError("history_transcript_missing", "history turn did not contain transcript segments")
    phrases: list[str] = []
    for segment in transcript:
        if not isinstance(segment, dict) or segment.get("speaker") != speaker or segment.get("isFinal") is not True:
            continue
        text = segment.get("text")
        if isinstance(text, str) and text.strip():
            phrases.append(text)
    if not phrases:
        raise HarnessError("history_phrase_missing", "history did not contain a final phrase for the configured speaker")
    return turn_id, normalized_phrase_sha256(" ".join(phrases))


def _expected_phrase_hash(config: HistoryConfig) -> str | None:
    if config.expected_phrase_sha256 is not None:
        return config.expected_phrase_sha256
    if config.expected_phrase_file is None:
        return None
    return normalized_phrase_sha256(_private_file(config.expected_phrase_file, role="expected_phrase"))


def _verify_history_after(config: HistoryConfig, before: dict[str, dict[str, Any]]) -> dict[str, Any]:
    headers = _history_headers(config)
    started = time.monotonic()
    deadline = started + config.timeout_seconds
    conversation_id: str | None = None
    while time.monotonic() < deadline:
        after = _history_list(config, headers)
        conversation_id = _changed_conversation(before, after)
        if conversation_id is not None:
            break
        time.sleep(min(config.poll_interval_seconds, max(0.0, deadline - time.monotonic())))
    if conversation_id is None:
        raise HarnessError("history_timeout", "manager history did not record a changed conversation in time")
    detail = _history_detail(config, headers, conversation_id)
    turn_id, observed = _latest_phrase_hash(detail, config.speaker)
    expected = _expected_phrase_hash(config)
    matched: bool | None = None
    if expected is not None:
        matched = observed == expected
    return {
        "checked": True,
        "speaker": config.speaker,
        "conversationIdSha256": sha256(conversation_id.encode("utf-8")).hexdigest(),
        "turnIdSha256": sha256(turn_id.encode("utf-8")).hexdigest(),
        "observedPhraseSha256": observed,
        "expectedPhraseSha256": expected,
        "matchesExpected": matched,
        "waitedMs": round((time.monotonic() - started) * 1000, 1),
    }


def _render_player(command: tuple[str, ...], clip: Path) -> list[str]:
    return [item.replace("{file}", str(clip)) for item in command]


def _play_clip(config: AudioConfig) -> dict[str, Any]:
    if not config.clip.is_file() or config.clip.stat().st_size == 0:
        raise HarnessError("audio_clip_missing", "configured audio clip is not a non-empty file")
    command = _render_player(config.command, config.clip)
    started = time.monotonic()
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as error:
        raise HarnessError("audio_player_start_failed", "could not start configured audio player") from error
    try:
        returncode = process.wait(timeout=config.timeout_seconds)
    except subprocess.TimeoutExpired as error:
        _stop_process(process)
        raise HarnessError("audio_player_timeout", "audio player did not finish within its configured bound") from error
    result = {
        "played": True,
        "exitCode": returncode,
        "durationMs": round((time.monotonic() - started) * 1000, 1),
        "stderrPersisted": False,
    }
    return result


def _stop_process(process: subprocess.Popen[Any] | None) -> None:
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


def _event(stage: Stage, timestamp: float, started: float) -> dict[str, Any]:
    return {
        "stage": stage.name,
        "semanticState": stage.semantic_state,
        "elapsedMs": round((timestamp - started) * 1000, 1),
        "serialLinePersisted": False,
    }


def dry_run_plan(scenario: Scenario, *, allow_audio: bool) -> dict[str, Any]:
    return {
        "dryRun": True,
        "monitor": monitor_command(scenario),
        "monitorNoReset": "--no-reset" in monitor_command(scenario),
        "audio": {
            "requested": allow_audio,
            "configured": scenario.audio is not None,
            "clipExists": scenario.audio.clip.is_file() if scenario.audio is not None else False,
            "playerWillStart": False,
        },
        "metricsConfigured": True,
        "history": {
            "configured": scenario.history is not None,
            "cookieFileConfigured": bool(scenario.history and scenario.history.session_cookie_file),
            "expectedPhraseCheckConfigured": bool(scenario.history and (scenario.history.expected_phrase_file or scenario.history.expected_phrase_sha256)),
        },
        "stages": [
            {"name": stage.name, "semanticState": stage.semantic_state, "timeoutSeconds": stage.timeout_seconds}
            for stage in scenario.stages
        ],
        "operatorPttGpio": scenario.operator.ptt_gpio,
        "forbiddenMarkerCount": len(scenario.forbidden_markers),
    }


def run(scenario: Scenario, *, allow_audio: bool, dry_run: bool, record: RunRecord) -> dict[str, Any] | None:
    if dry_run:
        return dry_run_plan(scenario, allow_audio=allow_audio)
    if allow_audio and scenario.audio is None:
        raise HarnessError("audio_config_missing", "--allow-audio requires an audio object in the scenario")
    if scenario.monitor.health_url:
        _check_health(scenario.monitor.health_url, timeout_seconds=scenario.metrics.timeout_seconds)
    record.metrics_before = _read_metrics(scenario.metrics)
    history_before: dict[str, dict[str, Any]] | None = None
    history_headers: dict[str, str] | None = None
    if scenario.history is not None:
        history_headers = _history_headers(scenario.history)
        history_before = _history_list(scenario.history, history_headers)
        del history_headers

    monitor = SerialMonitor(scenario)
    started = time.monotonic()
    try:
        monitor.start()
        if scenario.monitor.startup_wait_seconds:
            time.sleep(scenario.monitor.startup_wait_seconds)
        print(
            f"PTT acceptance: giữ GPIO{scenario.operator.ptt_gpio} để bắt đầu; "
            "harness chỉ quan sát serial, không mô phỏng nút.",
            flush=True,
        )
        boundary = time.monotonic()
        first = scenario.stages[0]
        marker_time = monitor.wait_for(first.marker, first.timeout_seconds, not_before=boundary)
        record.events.append(_event(first, marker_time, started))

        if allow_audio:
            assert scenario.audio is not None
            print(
                f"PTT đã nhận. Giữ GPIO{scenario.operator.ptt_gpio} trong lúc phát clip tiếng Việt cấu hình.",
                flush=True,
            )
            record.audio = {"played": False, "attempted": True, "stderrPersisted": False}
            record.audio = _play_clip(scenario.audio)
            if record.audio["exitCode"] != 0:
                raise HarnessError("audio_player_failed", "configured audio player exited unsuccessfully")
        else:
            record.audio = {"played": False, "reason": "allow_audio_not_set", "stderrPersisted": False}
            print("PTT đã nhận. Hãy nói câu acceptance bằng miệng khi vẫn giữ GPIO0.", flush=True)

        print(
            f"Sau khi nói/phát xong, nhả GPIO{scenario.operator.ptt_gpio}. "
            "Harness sẽ chờ flow thinking → speaking → idle.",
            flush=True,
        )
        boundary = marker_time
        for stage in scenario.stages[1:]:
            marker_time = monitor.wait_for(stage.marker, stage.timeout_seconds, not_before=boundary)
            record.events.append(_event(stage, marker_time, started))
            boundary = marker_time
        monitor.assert_clean()
    except BaseException:
        # A failure still gets a best-effort post-run counter snapshot. It is
        # intentionally GET-only and never masks the original physical gate.
        try:
            record.metrics_after = _read_metrics(scenario.metrics)
        except HarnessError:
            pass
        raise
    finally:
        monitor.stop()

    record.metrics_after = _read_metrics(scenario.metrics)
    _validate_metrics_after(scenario.metrics, record.metrics_after)
    if scenario.history is not None:
        assert history_before is not None
        record.history = _verify_history_after(scenario.history, history_before)
        if record.history["matchesExpected"] is False:
            raise HarnessError("history_phrase_mismatch", "history phrase hash did not match the configured expectation")
    return None


def _default_report_path(scenario: Scenario) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return scenario.source.parent / "reports" / f"ptt-acceptance-{timestamp}.json"


def write_report(path: Path, record: RunRecord, *, status: str) -> Path:
    target = path.expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(record.report(status), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", type=Path, required=True, help="JSON scenario; keep local clip/cookie/phrase paths out of Git")
    parser.add_argument("--allow-audio", action="store_true", help="explicitly allow the configured Vietnamese clip to be played")
    parser.add_argument("--dry-run", action="store_true", help="validate scenario and print plan without monitor, HTTP or audio")
    parser.add_argument("--report", type=Path, help="redacted JSON report path; default is ignored tools/physical/reports/")
    args = parser.parse_args(argv)

    scenario: Scenario | None = None
    record: RunRecord | None = None
    try:
        scenario = load_scenario(args.scenario)
        scenario_bytes = scenario.source.read_bytes()
        record = RunRecord(
            scenario_hash=sha256(scenario_bytes).hexdigest(),
            started_at=_utc_now(),
            serial_port=scenario.monitor.serial_port,
            audio_requested=args.allow_audio,
            events=[],
        )
        plan = run(scenario, allow_audio=args.allow_audio, dry_run=args.dry_run, record=record)
        if args.dry_run:
            assert plan is not None
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            return 0
        record.completed_at = _utc_now()
        report = write_report(args.report or _default_report_path(scenario), record, status="passed")
        print(f"PTT acceptance passed; redacted report: {report}", flush=True)
        return 0
    except KeyboardInterrupt:
        if scenario is not None and record is not None and not args.dry_run:
            record.error_code = "interrupted"
            record.completed_at = _utc_now()
            report = write_report(args.report or _default_report_path(scenario), record, status="interrupted")
            print(f"interrupted; redacted report: {report}", file=sys.stderr)
        return 130
    except HarnessError as error:
        if scenario is not None and record is not None and not args.dry_run:
            record.error_code = error.code
            record.completed_at = _utc_now()
            report = write_report(args.report or _default_report_path(scenario), record, status="failed")
            print(f"PTT acceptance failed [{error.code}]; redacted report: {report}", file=sys.stderr)
        else:
            print(f"PTT acceptance failed [{error.code}]", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
