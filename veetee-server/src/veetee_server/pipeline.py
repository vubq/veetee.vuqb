"""Bounded, cancellable conversation turn pipeline."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import time
from typing import Any, Awaitable, Callable

from .config import RuntimeSnapshot
from .protocol import AudioFrame, Profile, control_message, encode_audio
from .providers import AudioChunk, IntentMatch, MemorySession, OpusCodec, ProviderError, ProviderRegistry


@dataclass(slots=True)
class Turn:
    turn_id: str
    generation: int
    mode: str
    pcm_bytes: int = 0
    task: asyncio.Task[None] | None = None
    cancelled: asyncio.Event | None = None
    speech_confirmed: asyncio.Event | None = None
    listen_stopped_at: float | None = None
    asr_finished_at: float | None = None
    llm_first_at: float | None = None
    tts_started_at: float | None = None
    first_audio_at: float | None = None
    sequence: int = 1
    started_at: str = ""
    conversation_started_at: str = ""
    started_monotonic: float = field(default_factory=time.perf_counter)
    ended_at: str | None = None
    state: str = "completed"
    finish_reason: str = "completed"
    conversation_status: str = "active"
    reported: bool = False
    transcript: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    timings: dict[str, int] = field(default_factory=dict)


class SemanticSegmenter:
    def __init__(self, config: dict[str, Any]) -> None:
        self._minimum = max(1, int(config.get("minimumCharacters", 1)))
        self._maximum = max(self._minimum, int(config.get("maximumCharacters", 180)))
        self._punctuation = tuple(config.get("strongPunctuation", [".", "!", "?", "。", "！", "？"]))
        self._buffer = ""

    def push(self, text: str, *, final: bool = False) -> list[str]:
        self._buffer += text
        emitted: list[str] = []
        while self._buffer:
            boundary = self._find_boundary()
            if boundary is None and len(self._buffer) < self._maximum and not final:
                break
            if boundary is None:
                boundary = min(len(self._buffer), self._maximum)
            if boundary < self._minimum and not final:
                break
            segment = self._buffer[:boundary].strip()
            self._buffer = self._buffer[boundary:]
            if segment:
                emitted.append(segment)
        return emitted

    def _find_boundary(self) -> int | None:
        for index, char in enumerate(self._buffer, start=1):
            if char in self._punctuation and index >= self._minimum:
                return index
        return None


class TurnPipeline:
    def __init__(
        self,
        *,
        snapshot: RuntimeSnapshot,
        registry: ProviderRegistry,
        codec: OpusCodec,
        profile: Profile,
        session_id: str,
        turn: Turn,
        send_text: Callable[[dict[str, Any]], Awaitable[None]],
        send_binary: Callable[[bytes], Awaitable[None]],
        execute_tool: Callable[[str, dict[str, Any], int], Awaitable[dict[str, Any]]] | None = None,
        memory: MemorySession | None = None,
        on_intent: Callable[[IntentMatch], Awaitable[None]] | None = None,
        metrics: dict[str, int],
    ) -> None:
        self.snapshot = snapshot
        self.registry = registry
        self.codec = codec
        self.profile = profile
        self.session_id = session_id
        self.turn = turn
        self._send_text = send_text
        self._send_binary = send_binary
        self._execute_tool = execute_tool
        self._memory = memory
        self._on_intent = on_intent
        self.metrics = metrics
        wire = snapshot.raw.get("wire") or {}
        self._uplink_rate = int(wire.get("uplinkSampleRate", 16000))
        self._downlink_rate = int(wire.get("downlinkSampleRate", 24000))
        self._frame_duration_ms = int(wire.get("frameDurationMs", 60))
        self._frame_samples = self._downlink_rate * self._frame_duration_ms // 1000
        self._egress_pcm = bytearray()
        self._tts_started = False
        self._tts_stop_sent = False

    async def ingest(self, pcm: bytes) -> None:
        if self.turn.cancelled and self.turn.cancelled.is_set():
            return
        self.turn.pcm_bytes += len(pcm)
        await self.registry.asr.accept(pcm, self._uplink_rate)

    async def finish(self) -> None:
        if self.turn.cancelled and self.turn.cancelled.is_set():
            return
        started = time.perf_counter()
        try:
            transcript = await self.registry.asr.finish(self.snapshot.locale)
            self.turn.asr_finished_at = time.perf_counter()
            self._append_transcript("user", transcript, 0, self._elapsed_ms(self.turn.asr_finished_at))
            await self._send_text(control_message("stt", session_id=self.session_id, text=transcript, turn_id=self.turn.turn_id))
            if not transcript.strip():
                self.turn.finish_reason = "no_speech"
                self.metrics["no_speech_turns"] = self.metrics.get("no_speech_turns", 0) + 1
                status, message, emotion = self._no_speech_alert()
                await self._send_text(
                    control_message(
                        "alert",
                        session_id=self.session_id,
                        status=status,
                        message=message,
                        emotion=emotion,
                        code="NO_SPEECH",
                    )
                )
                return
            intent = self.registry.intent.classify(transcript, locale=self.snapshot.locale) if self.registry.intent else None
            if intent is not None:
                await self._send_text(control_message(
                    "intent",
                    session_id=self.session_id,
                    turn_id=self.turn.turn_id,
                    intent_id=intent.intent_id,
                    action=intent.action,
                    confidence=intent.confidence,
                ))
                if intent.action in {"conversation.exit", "turn.cancel"}:
                    if self._on_intent is not None:
                        await self._on_intent(intent)
                    return
            prompt = self._prompt(transcript)
            answer = await self._stream_answer(prompt)
            if self._memory is not None:
                self._memory.add_turn(transcript, answer)
        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            self.turn.state = "error"
            self.turn.finish_reason = exc.code
            self.metrics[f"provider_error_{exc.code}"] = self.metrics.get(f"provider_error_{exc.code}", 0) + 1
            await self._send_text(control_message("alert", session_id=self.session_id, status="error", code=exc.code))
            await self._emit_tts_stop(exc.code)
        finally:
            self.turn.ended_at = self.turn.ended_at or self._utc_now()
            self.metrics["turn_count"] = self.metrics.get("turn_count", 0) + 1
            self.metrics["last_turn_ms"] = round((time.perf_counter() - started) * 1000)
            self._record_timings()

    def cancel(self) -> None:
        if self.turn.cancelled:
            self.turn.cancelled.set()
        if self.turn.task and not self.turn.task.done():
            self.turn.task.cancel()
        self._egress_pcm.clear()

    def _append_transcript(self, speaker: str, text: str, started_ms: int, ended_ms: int) -> None:
        value = text.strip()
        if not value:
            return
        if len(self.turn.transcript) >= 128:
            return
        self.turn.transcript.append({
            "speaker": speaker,
            "text": value,
            "locale": self.snapshot.locale,
            "confidence": None,
            "startedAtMs": max(0, started_ms),
            "endedAtMs": max(max(0, started_ms), ended_ms),
            "isFinal": True,
        })

    def _elapsed_ms(self, timestamp: float | None = None) -> int:
        return max(0, round(((timestamp or time.perf_counter()) - self.turn.started_monotonic) * 1000))

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _safe_object_shape(value: Any) -> dict[str, Any]:
        """Keep tool history useful without persisting argument values."""

        if not isinstance(value, dict):
            return {"type": type(value).__name__}
        keys = sorted(str(key) for key in value.keys())[:64]
        return {"keys": keys, "fieldCount": len(value)}

    def _cancelled(self) -> bool:
        return self.turn.cancelled is not None and self.turn.cancelled.is_set()

    async def _stream_answer(self, prompt: str) -> str:
        tools = self.snapshot.raw.get("tools") or []
        max_rounds = max(1, int((self.snapshot.raw.get("toolPolicy") or {}).get("maxRounds", 3)))
        answer_started = False
        answer_parts: list[str] = []
        answer_length = 0
        answer_limit = self._memory_answer_limit()

        def remember_answer(segment: str) -> None:
            """Keep only the bounded excerpt needed by the Memory provider."""

            nonlocal answer_length
            if answer_limit <= 0:
                return
            if len(segment) >= answer_limit:
                answer_parts.clear()
                answer_parts.append(segment[-answer_limit:])
                answer_length = answer_limit
                return
            answer_parts.append(segment)
            answer_length += len(segment)
            while answer_length > answer_limit and answer_parts:
                answer_length -= len(answer_parts.pop(0))

        current_prompt = prompt
        for _round in range(max_rounds):
            segmenter = SemanticSegmenter(self.snapshot.raw.get("segmentation") or {})
            tool_name: str | None = None
            tool_arguments = ""
            async def handle_delta(delta: Any) -> None:
                nonlocal answer_started, tool_name, tool_arguments
                if self._cancelled():
                    return
                if self.turn.llm_first_at is None and (delta.text or delta.tool_name or delta.tool_arguments is not None):
                    self.turn.llm_first_at = time.perf_counter()
                if delta.tool_name or delta.tool_arguments is not None:
                    if delta.tool_name:
                        if tool_name is not None and tool_name != delta.tool_name:
                            raise ProviderError("MULTIPLE_TOOL_CALLS_UNSUPPORTED", "one turn emitted multiple tool names")
                        tool_name = delta.tool_name
                        await self._send_text(control_message("llm", session_id=self.session_id, turn_id=self.turn.turn_id, tool_name=delta.tool_name))
                    tool_arguments += delta.tool_arguments or ""
                    return
                for segment in segmenter.push(delta.text, final=delta.final):
                    if self._cancelled():
                        return
                    remember_answer(segment)
                    if not answer_started:
                        if not self._tts_started:
                            self.turn.tts_started_at = time.perf_counter()
                            start_message = control_message("tts", session_id=self.session_id, state="start", turn_id=self.turn.turn_id)
                            barge_policy = self.snapshot.barge_in_policy()
                            if barge_policy.enabled and barge_policy.device_duplex and self.turn.mode in {"auto", "realtime"}:
                                start_message["barge_in"] = {"enabled": True, "mode": "acoustic"}
                            await self._send_text(start_message)
                            self._tts_started = True
                        answer_started = True
                    await self._speak_segment(segment)

            stream = self.registry.llm.stream(prompt=current_prompt, locale=self.snapshot.locale, tools=tools).__aiter__()
            next_delta = asyncio.create_task(stream.__anext__(), name=f"llm-first-{self.turn.turn_id}")
            progress_timer, progress_text = self._progress_ack()
            timer = asyncio.create_task(asyncio.sleep(progress_timer / 1000), name=f"progress-{self.turn.turn_id}") if progress_timer and progress_text else None
            try:
                if timer is None:
                    try:
                        await handle_delta(await next_delta)
                    except StopAsyncIteration:
                        pass
                else:
                    done, _ = await asyncio.wait({next_delta, timer}, return_when=asyncio.FIRST_COMPLETED)
                    if timer in done and next_delta not in done:
                        if not self._tts_started:
                            self.turn.tts_started_at = time.perf_counter()
                            await self._send_text(control_message("tts", session_id=self.session_id, state="start", turn_id=self.turn.turn_id))
                            self._tts_started = True
                        await self._speak_segment(progress_text, speaker="system")
                    try:
                        await handle_delta(await next_delta)
                    except StopAsyncIteration:
                        pass
                async for delta in stream:
                    await handle_delta(delta)
            finally:
                if timer and not timer.done():
                    timer.cancel()
                if not next_delta.done():
                    next_delta.cancel()
                await asyncio.gather(*(task for task in (timer, next_delta) if task is not None), return_exceptions=True)
                await self._close_stream(stream)
            if tool_arguments and not tool_name:
                raise ProviderError("TOOL_NAME_MISSING", "tool arguments arrived without a tool name")
            if tool_name and self._execute_tool is not None:
                if self._cancelled():
                    return " ".join(answer_parts).strip()
                try:
                    arguments = json.loads(tool_arguments or "{}")
                except json.JSONDecodeError as exc:
                    raise ProviderError("TOOL_ARGUMENTS_INVALID", "tool arguments are not valid JSON") from exc
                if not isinstance(arguments, dict):
                    raise ProviderError("TOOL_ARGUMENTS_INVALID", "tool arguments must be an object")
                tool_started = time.perf_counter()
                tool_record: dict[str, Any] = {
                    "toolName": tool_name,
                    "source": "llm",
                    "status": "completed",
                    "startedAt": self._utc_now(),
                    "endedAt": None,
                    "latencyMs": None,
                    "input": self._safe_object_shape(arguments),
                    "output": None,
                    "errorCode": None,
                }
                try:
                    result = await self._execute_tool(tool_name, arguments, self.turn.generation)
                    tool_record["output"] = self._safe_object_shape(result)
                except asyncio.CancelledError:
                    tool_record["status"] = "cancelled"
                    raise
                except ProviderError as exc:
                    tool_record["status"] = "error"
                    tool_record["errorCode"] = exc.code
                    raise
                except Exception:
                    tool_record["status"] = "error"
                    tool_record["errorCode"] = "TOOL_EXECUTION_FAILED"
                    raise ProviderError("TOOL_EXECUTION_FAILED", "tool execution failed")
                finally:
                    tool_record["endedAt"] = self._utc_now()
                    tool_record["latencyMs"] = self._elapsed_ms(tool_started)
                    if len(self.turn.tool_calls) < 64:
                        self.turn.tool_calls.append(tool_record)
                current_prompt = f"{current_prompt}\n\nTool result for {tool_name}: {json.dumps(result, ensure_ascii=False)}"
                continue
            break
        if self._tts_started and not self._cancelled():
            await self._flush_packetizer()
            await self._emit_tts_stop("complete")
        return " ".join(answer_parts).strip()

    @staticmethod
    async def _close_stream(stream: Any) -> None:
        """Close an async provider stream after its reader task has joined."""

        close = getattr(stream, "aclose", None)
        if close is None:
            return
        for _ in range(8):
            try:
                await close()
                return
            except RuntimeError as exc:
                if "already running" not in str(exc):
                    raise
                await asyncio.sleep(0)
        raise ProviderError("LLM_STREAM_CLOSE_FAILED", "LLM stream did not close after cancellation")

    async def _emit_tts_stop(self, reason: str) -> None:
        """Close the speaking phase once, including terminal provider errors."""

        if not self._tts_started or self._tts_stop_sent:
            return
        self._tts_stop_sent = True
        await self._send_text(control_message("tts", session_id=self.session_id, state="stop", reason=reason, turn_id=self.turn.turn_id))

    def _memory_answer_limit(self) -> int:
        providers = self.snapshot.raw.get("providers")
        if not isinstance(providers, dict):
            return 0
        memory = providers.get("memory")
        if not isinstance(memory, dict) or memory.get("mode") == "disabled":
            return 0
        config = memory.get("config")
        if not isinstance(config, dict):
            return 0
        try:
            return max(0, int(config.get("maxCharacters", 12000)))
        except (TypeError, ValueError):
            return 0

    def _no_speech_alert(self) -> tuple[str, str, str]:
        """Read the optional localized no-speech alert without adding literals to core."""

        raw_policy = self.snapshot.raw.get("autoTurn")
        alert = raw_policy.get("noSpeechAlert") if isinstance(raw_policy, dict) else None
        if not isinstance(alert, dict):
            return "warning", "", "neutral"
        status = alert.get("status")
        message = alert.get("message")
        emotion = alert.get("emotion")
        if not all(isinstance(value, str) for value in (status, message, emotion)):
            return "warning", "", "neutral"
        return status, message, emotion

    def _progress_ack(self) -> tuple[int, str]:
        policy = self.snapshot.raw.get("progress")
        if not isinstance(policy, dict) or policy.get("enabled") is not True:
            return 0, ""
        try:
            deadline = int(policy.get("deadlineMs", 0))
        except (TypeError, ValueError):
            return 0, ""
        acknowledgement_id = policy.get("acknowledgementId")
        acknowledgements = policy.get("acknowledgements")
        if deadline <= 0 or not isinstance(acknowledgement_id, str) or not isinstance(acknowledgements, dict):
            return 0, ""
        text = acknowledgements.get(acknowledgement_id)
        return (deadline, text.strip()) if isinstance(text, str) and text.strip() else (0, "")

    async def _speak_segment(self, segment: str, *, speaker: str = "assistant") -> None:
        if self._cancelled():
            return
        segment_started = time.perf_counter()
        await self._send_text(
            control_message("tts", session_id=self.session_id, state="sentence_start", text=segment, turn_id=self.turn.turn_id)
        )
        voice = self.snapshot.raw.get("speech")
        if not isinstance(voice, dict):
            voice = {}
        async for chunk in self.registry.tts.stream(segment, locale=self.snapshot.locale, voice=voice):
            if self._cancelled():
                return
            await self._write_pcm(chunk)
            if self._cancelled():
                return
        await self._flush_packetizer(final=True)
        self._append_transcript(speaker, segment, self._elapsed_ms(segment_started), self._elapsed_ms())

    async def _write_pcm(self, chunk: AudioChunk) -> None:
        if chunk.sample_rate != self._downlink_rate:
            raise ProviderError("TTS_SAMPLE_RATE_UNSUPPORTED", "selected TTS must yield negotiated sample rate")
        self._egress_pcm.extend(chunk.pcm)
        frame_bytes = self._frame_samples * 2
        while len(self._egress_pcm) >= frame_bytes:
            pcm = bytes(self._egress_pcm[:frame_bytes])
            del self._egress_pcm[:frame_bytes]
            await self._send_packet(pcm)

    async def _flush_packetizer(self, *, final: bool = False) -> None:
        if final and self._egress_pcm:
            frame_bytes = self._frame_samples * 2
            self._egress_pcm.extend(b"\0" * (frame_bytes - len(self._egress_pcm)))
            pcm = bytes(self._egress_pcm[:frame_bytes])
            del self._egress_pcm[:frame_bytes]
            await self._send_packet(pcm)

    async def _send_packet(self, pcm: bytes) -> None:
        if self._cancelled():
            return
        if self.turn.first_audio_at is None:
            self.turn.first_audio_at = time.perf_counter()
        packet = self.codec.encode_downlink(pcm, self._frame_samples)
        await self._send_binary(encode_audio(AudioFrame(profile=self.profile, payload=packet)))
        self.metrics["audio_frames_out"] = self.metrics.get("audio_frames_out", 0) + 1

    def _record_timings(self) -> None:
        origin = self.turn.listen_stopped_at
        if origin is None:
            return
        fields = (
            ("last_asr_finalize_ms", self.turn.asr_finished_at),
            ("last_llm_first_token_ms", self.turn.llm_first_at),
            ("last_tts_start_ms", self.turn.tts_started_at),
            ("last_ttfa_ms", self.turn.first_audio_at),
        )
        for name, timestamp in fields:
            if timestamp is not None:
                value = max(0, round((timestamp - origin) * 1000))
                self.metrics[name] = value
                self.turn.timings[name.removeprefix("last_")] = value
        self.turn.timings["turn_duration_ms"] = self._elapsed_ms()

    def _prompt(self, transcript: str) -> str:
        raw_personality = self.snapshot.raw.get("personality")
        personality = raw_personality.get("prompt", "") if isinstance(raw_personality, dict) else ""
        base = str(self.snapshot.raw.get("basePrompt", ""))
        memory = self._memory.context() if self._memory is not None else ""
        return "\n\n".join(value for value in (base, personality, memory, transcript) if value)
