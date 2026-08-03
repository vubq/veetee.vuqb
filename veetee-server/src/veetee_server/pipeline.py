"""Bounded, cancellable conversation turn pipeline."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import time
from typing import Any, Awaitable, Callable

from .config import RuntimeSnapshot
from .protocol import AudioFrame, Profile, control_message, encode_audio
from .providers import AudioChunk, OpusCodec, ProviderError, ProviderRegistry


@dataclass(slots=True)
class Turn:
    turn_id: str
    generation: int
    mode: str
    pcm_bytes: int = 0
    task: asyncio.Task[None] | None = None
    cancelled: asyncio.Event | None = None


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
        self.metrics = metrics
        wire = snapshot.raw.get("wire") or {}
        self._uplink_rate = int(wire.get("uplinkSampleRate", 16000))
        self._downlink_rate = int(wire.get("downlinkSampleRate", 24000))
        self._frame_duration_ms = int(wire.get("frameDurationMs", 60))
        self._frame_samples = self._downlink_rate * self._frame_duration_ms // 1000
        self._egress_pcm = bytearray()

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
            await self._send_text(control_message("stt", session_id=self.session_id, text=transcript, turn_id=self.turn.turn_id))
            prompt = self._prompt(transcript)
            await self._stream_answer(prompt)
        except asyncio.CancelledError:
            raise
        except ProviderError as exc:
            self.metrics[f"provider_error_{exc.code}"] = self.metrics.get(f"provider_error_{exc.code}", 0) + 1
            await self._send_text(control_message("alert", session_id=self.session_id, status="error", code=exc.code))
        finally:
            self.metrics["turn_count"] = self.metrics.get("turn_count", 0) + 1
            self.metrics["last_turn_ms"] = round((time.perf_counter() - started) * 1000)

    def cancel(self) -> None:
        if self.turn.cancelled:
            self.turn.cancelled.set()
        if self.turn.task and not self.turn.task.done():
            self.turn.task.cancel()
        self._egress_pcm.clear()

    async def _stream_answer(self, prompt: str) -> None:
        segmenter = SemanticSegmenter(self.snapshot.raw.get("segmentation") or {})
        tools = self.snapshot.raw.get("tools") or []
        answer_started = False
        async for delta in self.registry.llm.stream(prompt=prompt, locale=self.snapshot.locale, tools=tools):
            if self.turn.cancelled and self.turn.cancelled.is_set():
                return
            if delta.tool_name:
                await self._send_text(control_message("llm", session_id=self.session_id, turn_id=self.turn.turn_id, tool_name=delta.tool_name))
                continue
            for segment in segmenter.push(delta.text, final=delta.final):
                if not answer_started:
                    await self._send_text(control_message("tts", session_id=self.session_id, state="start", turn_id=self.turn.turn_id))
                    answer_started = True
                await self._speak_segment(segment)
        if answer_started:
            await self._flush_packetizer()
            await self._send_text(control_message("tts", session_id=self.session_id, state="stop", turn_id=self.turn.turn_id))

    async def _speak_segment(self, segment: str) -> None:
        await self._send_text(
            control_message("tts", session_id=self.session_id, state="sentence_start", text=segment, turn_id=self.turn.turn_id)
        )
        voice = self.snapshot.raw.get("speech")
        if not isinstance(voice, dict):
            voice = {}
        async for chunk in self.registry.tts.stream(segment, locale=self.snapshot.locale, voice=voice):
            if self.turn.cancelled and self.turn.cancelled.is_set():
                return
            await self._write_pcm(chunk)
        await self._flush_packetizer(final=True)

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
        packet = self.codec.encode_downlink(pcm, self._frame_samples)
        await self._send_binary(encode_audio(AudioFrame(profile=self.profile, payload=packet)))
        self.metrics["audio_frames_out"] = self.metrics.get("audio_frames_out", 0) + 1

    def _prompt(self, transcript: str) -> str:
        raw_personality = self.snapshot.raw.get("personality")
        personality = raw_personality.get("prompt", "") if isinstance(raw_personality, dict) else ""
        base = str(self.snapshot.raw.get("basePrompt", ""))
        return "\n\n".join(value for value in (base, personality, transcript) if value)
