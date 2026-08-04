#!/usr/bin/env python3
"""Run a redacted WebSocket profile realtime lab against a Voice Server.

This is a host-only probe. It sends a configured WAV as Opus to the server and
never opens a sound device, serial port, or firmware connection.
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import sys
import time
import wave


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "veetee-server" / "src"))


class LabError(RuntimeError):
    """Invalid fixture or failed lab acceptance."""


def profile_name(version: int) -> str:
    """Map the explicit wire version to the protocol encoder profile."""

    profiles = {1: "ws-v1-compat", 2: "ws-v2", 3: "ws-v3"}
    try:
        return profiles[version]
    except KeyError as error:
        raise LabError("profile must be one of 1, 2 or 3") from error


@dataclass(frozen=True, slots=True)
class TurnResult:
    index: int
    ttfa_ms: float | None
    packets: int
    tts_started: bool
    tts_stopped: bool
    protocol_error: bool
    alert_codes: tuple[str, ...]


def percentile(values: list[float], percentile_value: float) -> float | None:
    if not values:
        return None
    if not 0 <= percentile_value <= 100:
        raise ValueError("percentile must be between 0 and 100")
    ordered = sorted(values)
    rank = max(1, round((percentile_value / 100) * len(ordered)))
    return ordered[min(len(ordered), rank) - 1]


def read_wav(path: Path, *, max_seconds: float = 60.0) -> tuple[int, bytes]:
    path = path.expanduser().resolve()
    try:
        with wave.open(str(path), "rb") as source:
            channels = source.getnchannels()
            sample_width = source.getsampwidth()
            sample_rate = source.getframerate()
            frame_count = source.getnframes()
            raw = source.readframes(frame_count)
    except (OSError, wave.Error) as error:
        raise LabError(f"cannot read WAV fixture: {path}") from error
    if channels != 1 or sample_width != 2 or sample_rate <= 0:
        raise LabError("WAV fixture must be mono signed-16 PCM")
    if frame_count / sample_rate > max_seconds:
        raise LabError(f"WAV fixture exceeds {max_seconds:g}s limit")
    return sample_rate, raw


def resample_pcm(raw: bytes, source_rate: int, target_rate: int = 16_000) -> bytes:
    if source_rate == target_rate:
        return raw
    try:
        import numpy as np
    except ImportError as error:
        raise LabError("numpy is required by the Voice Server virtualenv") from error
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32)
    if samples.size == 0:
        raise LabError("WAV fixture is empty")
    target_count = max(1, round(samples.size * target_rate / source_rate))
    positions = np.linspace(0, samples.size - 1, target_count)
    converted = np.interp(positions, np.arange(samples.size), samples)
    return np.clip(converted, -32768, 32767).astype("<i2").tobytes()


async def run_lab(
    url: str,
    pcm: bytes,
    *,
    turns: int,
    timeout_seconds: float,
    device_prefix: str,
    profile: int = 3,
) -> list[TurnResult]:
    try:
        import aiohttp
        import opuslib
        from veetee_server.protocol import AudioFrame, encode_audio
    except ImportError as error:
        raise LabError("run this tool with veetee-server/.venv/bin/python") from error
    if turns < 1:
        raise LabError("turns must be positive")
    wire_profile = profile_name(profile)
    frame_bytes = 960 * 2
    results: list[TurnResult] = []
    timeout = aiohttp.ClientTimeout(total=timeout_seconds)
    async with aiohttp.ClientSession(timeout=timeout) as client:
        for index in range(1, turns + 1):
            identity = f"{device_prefix}-{index}-{time.time_ns()}"
            headers = {"Device-Id": identity, "Client-Id": identity, "Protocol-Version": str(profile)}
            async with client.ws_connect(url, headers=headers, heartbeat=30) as ws:
                # Opus keeps predictor state. A lab turn is an independent
                # session, so never carry encoder history across connections.
                encoder = opuslib.Encoder(16_000, 1, opuslib.APPLICATION_AUDIO)
                await ws.send_json({
                    "type": "hello", "version": profile, "transport": "websocket",
                    "features": {"mcp": False},
                    "audio_params": {"format": "opus", "sample_rate": 16_000, "channels": 1, "frame_duration": 60},
                })
                hello = await ws.receive_json(timeout=10)
                session_id = hello.get("session_id") if isinstance(hello, dict) else None
                if not isinstance(session_id, str) or not session_id:
                    raise LabError("server hello did not contain session_id")
                await ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": session_id})
                for offset in range(0, len(pcm), frame_bytes):
                    frame = pcm[offset:offset + frame_bytes]
                    if len(frame) < frame_bytes:
                        frame += b"\0" * (frame_bytes - len(frame))
                    packet = encoder.encode(frame, 960)
                    await ws.send_bytes(encode_audio(AudioFrame(wire_profile, packet)))
                stop_sent = time.perf_counter()
                await ws.send_json({"type": "listen", "state": "stop", "session_id": session_id})
                first_audio: float | None = None
                packets = 0
                tts_started = False
                tts_stopped = False
                protocol_error = False
                alert_codes: list[str] = []
                deadline = time.perf_counter() + timeout_seconds
                while time.perf_counter() < deadline:
                    try:
                        message = await ws.receive(timeout=min(10, max(1, deadline - time.perf_counter())))
                    except asyncio.TimeoutError:
                        # Keep the turn result (and its failed stop check)
                        # redacted instead of aborting the whole report with a
                        # traceback when a long answer exceeds the gate.
                        break
                    if message.type == aiohttp.WSMsgType.TEXT:
                        value = json.loads(message.data)
                        if value.get("type") == "protocol.error":
                            protocol_error = True
                        if value.get("type") == "alert" and isinstance(value.get("code"), str):
                            alert_codes.append(value["code"])
                        if value.get("type") == "tts" and value.get("state") == "start":
                            tts_started = True
                        if value.get("type") == "tts" and value.get("state") == "stop":
                            tts_stopped = True
                            break
                    elif message.type == aiohttp.WSMsgType.BINARY:
                        packets += 1
                        if first_audio is None:
                            first_audio = (time.perf_counter() - stop_sent) * 1000
                    elif message.type in {aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR}:
                        break
                results.append(TurnResult(index, first_audio, packets, tts_started, tts_stopped, protocol_error, tuple(alert_codes)))
    return results


def report(
    results: list[TurnResult],
    *,
    warmup_turns: int,
    max_ttfa_ms: float,
    profile: int = 3,
) -> dict[str, object]:
    profile_name(profile)
    accepted = results[warmup_turns:]
    ttfa = [item.ttfa_ms for item in accepted if item.ttfa_ms is not None]
    checks = all(item.packets > 0 and item.tts_started and item.tts_stopped and not item.protocol_error for item in accepted)
    p95 = percentile([float(item) for item in ttfa], 95)
    return {
        "turns": [asdict(item) for item in results],
        "warmupTurns": warmup_turns,
        "profile": profile,
        "warmP50Ms": percentile([float(item) for item in ttfa], 50),
        "warmP95Ms": p95,
        "maxTtfaMs": max_ttfa_ms,
        "pass": bool(checks and p95 is not None and p95 <= max_ttfa_ms),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="ws://127.0.0.1:18100/veetee/v1/")
    parser.add_argument("--wav", type=Path, default=ROOT / "tools/physical/local-utterance-vi.wav")
    parser.add_argument("--turns", type=int, default=3)
    parser.add_argument("--warmup-turns", type=int, default=1)
    parser.add_argument("--max-ttfa-ms", type=float, default=1500)
    parser.add_argument("--timeout-seconds", type=float, default=60)
    parser.add_argument("--device-prefix", default="veetee-lab")
    parser.add_argument("--profile", type=int, choices=(1, 2, 3), default=3,
                        help="explicit WebSocket wire profile (1 raw, 2 header16, 3 header4)")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    try:
        source_rate, raw = read_wav(args.wav)
        pcm = resample_pcm(raw, source_rate)
        if not 0 <= args.warmup_turns < args.turns:
            raise LabError("warmup-turns must be less than turns")
        results = asyncio.run(run_lab(
            args.url,
            pcm,
            turns=args.turns,
            timeout_seconds=args.timeout_seconds,
            device_prefix=args.device_prefix,
            profile=args.profile,
        ))
        value = report(
            results,
            warmup_turns=args.warmup_turns,
            max_ttfa_ms=args.max_ttfa_ms,
            profile=args.profile,
        )
        rendered = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
        print(rendered, end="")
        if args.report:
            args.report.expanduser().resolve().write_text(rendered, encoding="utf-8")
        return 0 if value["pass"] else 2
    except (LabError, OSError, ValueError) as error:
        print(f"realtime-lab: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
