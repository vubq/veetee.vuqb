"""Provider interfaces and config-driven implementations.

The core only knows capability ports. Provider IDs and all tuning values arrive
from the published snapshot; selecting another implementation is a config
operation, not a code branch or runtime fallback.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import importlib
import json
import math
import os
from pathlib import Path
import struct
from typing import Any, AsyncIterator, Protocol

import httpx
import opuslib

from .config import ConfigurationError, RuntimeSnapshot


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class AudioChunk:
    pcm: bytes
    sample_rate: int
    final: bool = False


@dataclass(frozen=True, slots=True)
class LLMDelta:
    text: str = ""
    tool_name: str | None = None
    tool_arguments: str | None = None
    final: bool = False


class VADProvider(Protocol):
    def reset(self) -> None: ...
    def accept(self, pcm: bytes, sample_rate: int) -> bool: ...
    def endpoint(self) -> bool: ...


class ASRProvider(Protocol):
    def reset(self) -> None: ...
    async def accept(self, pcm: bytes, sample_rate: int) -> None: ...
    async def finish(self, locale: str) -> str: ...


class LLMProvider(Protocol):
    async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, Any]]) -> AsyncIterator[LLMDelta]: ...


class TTSProvider(Protocol):
    async def stream(self, text: str, *, locale: str, voice: dict[str, Any]) -> AsyncIterator[AudioChunk]: ...


class EnergyVAD:
    def __init__(self, config: dict[str, Any]) -> None:
        self._speech_threshold = _float(config, "speechThreshold")
        self._release_threshold = _float(config, "releaseThreshold")
        self._min_speech_ms = _positive_int(config, "minSpeechMs")
        self._min_silence_ms = _positive_int(config, "minSilenceMs")
        self._speech_ms = 0
        self._silence_ms = 0
        self._active = False

    def reset(self) -> None:
        self._speech_ms = 0
        self._silence_ms = 0
        self._active = False

    def accept(self, pcm: bytes, sample_rate: int) -> bool:
        if len(pcm) % 2:
            raise ProviderError("VAD_PCM_ALIGNMENT", "VAD input must be signed 16-bit PCM")
        samples = struct.unpack(f"<{len(pcm) // 2}h", pcm) if pcm else ()
        rms = math.sqrt(sum((sample / 32768.0) ** 2 for sample in samples) / max(1, len(samples)))
        duration_ms = round(len(samples) * 1000 / sample_rate) if sample_rate else 0
        if rms >= self._speech_threshold:
            self._speech_ms += duration_ms
            self._silence_ms = 0
        elif rms <= self._release_threshold:
            self._silence_ms += duration_ms
        return self._active or self._speech_ms >= self._min_speech_ms

    def endpoint(self) -> bool:
        if self._speech_ms < self._min_speech_ms:
            return False
        self._active = True
        return self._silence_ms >= self._min_silence_ms


class FixtureASR:
    def __init__(self, config: dict[str, Any]) -> None:
        text = config.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ConfigurationError("fixture ASR requires config.text")
        self._text = text
        self._bytes = 0

    def reset(self) -> None:
        self._bytes = 0

    async def accept(self, pcm: bytes, sample_rate: int) -> None:
        self._bytes += len(pcm)

    async def finish(self, locale: str) -> str:
        return self._text


class PhoWhisperASR:
    """Optional adapter; model artifact and compute mode are config-only."""

    def __init__(self, config: dict[str, Any]) -> None:
        model_path = config.get("modelPath")
        if not isinstance(model_path, str) or not model_path:
            raise ConfigurationError("PhoWhisper provider requires modelPath")
        try:
            module = importlib.import_module("faster_whisper")
        except ImportError as exc:
            raise ProviderError("ASR_DEPENDENCY_MISSING", "faster-whisper is not installed") from exc
        self._model = module.WhisperModel(
            model_path,
            device=config.get("device", "cuda"),
            compute_type=config.get("computeType", "float16"),
        )
        self._chunks: list[bytes] = []
        self._sample_rate = _positive_int(config, "sampleRate", fallback=16000)

    def reset(self) -> None:
        self._chunks.clear()

    async def accept(self, pcm: bytes, sample_rate: int) -> None:
        self._sample_rate = sample_rate
        self._chunks.append(bytes(pcm))

    async def finish(self, locale: str) -> str:
        import numpy as np

        pcm = b"".join(self._chunks)
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = await asyncio.to_thread(
            self._model.transcribe,
            samples,
            language=locale.split("-")[0],
            vad_filter=False,
            beam_size=1,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


class FixtureLLM:
    def __init__(self, config: dict[str, Any]) -> None:
        segments = config.get("segments")
        if not isinstance(segments, list) or not segments or not all(isinstance(item, str) for item in segments):
            raise ConfigurationError("fixture LLM requires config.segments string array")
        self._segments = list(segments)
        self._delay_ms = max(0, int(config.get("segmentDelayMs", 0)))

    async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, Any]]) -> AsyncIterator[LLMDelta]:
        for segment in self._segments:
            if self._delay_ms:
                await asyncio.sleep(self._delay_ms / 1000)
            yield LLMDelta(text=segment)
        yield LLMDelta(final=True)


class GroqLLM:
    def __init__(self, config: dict[str, Any], secret_file: Path | None) -> None:
        if secret_file is None:
            raise ProviderError("LLM_SECRET_MISSING", "Groq provider requires one secret file")
        self._model = _required_string(config, "model")
        self._endpoint = _required_string(config, "endpoint")
        self._temperature = float(config.get("temperature", 0.3))
        self._max_tokens = int(config.get("maxTokens", 512))
        self._secret_file = secret_file

    def _key(self) -> str:
        try:
            lines = self._secret_file.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise ProviderError("LLM_SECRET_READ_FAILED", "cannot read Groq secret file") from exc
        values = [line.split("=", 1)[1] if "=" in line else line for line in lines]
        values = [value.strip() for value in values if value.strip() and not value.lstrip().startswith("#")]
        if len(values) != 1:
            raise ProviderError("LLM_SINGLE_SECRET_REQUIRED", "production Groq config requires exactly one key")
        return values[0]

    async def stream(self, *, prompt: str, locale: str, tools: list[dict[str, Any]]) -> AsyncIterator[LLMDelta]:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
        headers = {"Authorization": f"Bearer {self._key()}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(float(os.getenv("VEETEE_LLM_TIMEOUT_SECONDS", "30")))
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", self._endpoint, headers=headers, json=payload) as response:
                    if response.status_code == 429:
                        raise ProviderError("LLM_RATE_LIMITED", "Groq rate limit", retryable=True)
                    if response.status_code >= 400:
                        raise ProviderError("LLM_HTTP_ERROR", f"Groq HTTP {response.status_code}")
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            yield LLMDelta(final=True)
                            return
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        delta = event.get("choices", [{}])[0].get("delta", {})
                        text = delta.get("content") or ""
                        tool_calls = delta.get("tool_calls") or []
                        if text:
                            yield LLMDelta(text=text)
                        for call in tool_calls:
                            function = call.get("function") or {}
                            yield LLMDelta(
                                tool_name=function.get("name"),
                                tool_arguments=function.get("arguments", ""),
                            )
        except httpx.TimeoutException as exc:
            raise ProviderError("LLM_TIMEOUT", "Groq request timed out", retryable=True) from exc


class FixtureToneTTS:
    def __init__(self, config: dict[str, Any]) -> None:
        self._sample_rate = _positive_int(config, "sampleRate")
        self._tone_hz = float(config.get("toneHz", 440))
        self._chunk_ms = _positive_int(config, "chunkMs")
        self._amplitude = float(config.get("amplitude", 0.08))

    async def stream(self, text: str, *, locale: str, voice: dict[str, Any]) -> AsyncIterator[AudioChunk]:
        duration_ms = max(self._chunk_ms, min(6000, len(text) * self._chunk_ms))
        total = round(self._sample_rate * duration_ms / 1000)
        chunk_samples = round(self._sample_rate * self._chunk_ms / 1000)
        for offset in range(0, total, chunk_samples):
            count = min(chunk_samples, total - offset)
            pcm = bytearray()
            for index in range(count):
                sample = self._amplitude * math.sin(2 * math.pi * self._tone_hz * (offset + index) / self._sample_rate)
                pcm.extend(struct.pack("<h", round(sample * 32767)))
            yield AudioChunk(bytes(pcm), self._sample_rate, final=offset + count >= total)


class VieNeuTTS:
    """Optional VieNeu adapter loaded only when its package is installed."""

    def __init__(self, config: dict[str, Any]) -> None:
        try:
            self._module = importlib.import_module("vieneu")
        except ImportError as exc:
            raise ProviderError("TTS_DEPENDENCY_MISSING", "VieNeu package is not installed") from exc
        self._model = _required_string(config, "modelPath")
        self._sample_rate = _positive_int(config, "sampleRate", fallback=24000)

    async def stream(self, text: str, *, locale: str, voice: dict[str, Any]) -> AsyncIterator[AudioChunk]:
        engine = getattr(self._module, "load", None)
        if engine is None:
            raise ProviderError("TTS_CAPABILITY_MISSING", "VieNeu package has no configured streaming loader")
        generator = await asyncio.to_thread(engine, self._model)
        result = generator.infer_stream(text=text, voice=voice.get("voiceId"), language=locale)
        for chunk in result:
            if isinstance(chunk, tuple):
                rate, pcm = chunk
            else:
                rate, pcm = self._sample_rate, chunk
            yield AudioChunk(bytes(pcm), int(rate), final=False)
        yield AudioChunk(b"", self._sample_rate, final=True)


class OpusCodec:
    def __init__(self, uplink_rate: int, downlink_rate: int) -> None:
        self.uplink_rate = uplink_rate
        self.downlink_rate = downlink_rate
        self._encoder = opuslib.Encoder(downlink_rate, 1, opuslib.APPLICATION_AUDIO)
        self._decoder = opuslib.Decoder(uplink_rate, 1)
        self._playback_encoder = opuslib.Encoder(downlink_rate, 1, opuslib.APPLICATION_AUDIO)

    def decode_uplink(self, packet: bytes, frame_samples: int) -> bytes:
        try:
            return self._decoder.decode(packet, frame_samples)
        except opuslib.OpusError as exc:
            raise ProviderError("OPUS_DECODE_FAILED", "invalid Opus packet") from exc

    def encode_downlink(self, pcm: bytes, frame_samples: int) -> bytes:
        try:
            return self._playback_encoder.encode(pcm, frame_samples)
        except opuslib.OpusError as exc:
            raise ProviderError("OPUS_ENCODE_FAILED", "cannot encode PCM") from exc


class ProviderRegistry:
    def __init__(self, snapshot: RuntimeSnapshot, *, secret_file: Path | None = None) -> None:
        self.snapshot = snapshot
        self.secret_file = secret_file
        self.vad = self._vad(snapshot.provider("vad"))
        self.asr = self._asr(snapshot.provider("asr"))
        self.llm = self._llm(snapshot.provider("llm"))
        self.tts = self._tts(snapshot.provider("tts"))

    def _selection(self, item: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        provider_id = item["providerId"]
        config = item.get("config")
        if not isinstance(config, dict):
            raise ConfigurationError(f"provider config must be object: {provider_id}")
        return provider_id, config

    def _vad(self, item: dict[str, Any]) -> VADProvider:
        provider_id, config = self._selection(item)
        if provider_id == "veetee.vad.energy":
            return EnergyVAD(config)
        raise ProviderError("VAD_PROVIDER_UNAVAILABLE", f"selected VAD provider unavailable: {provider_id}")

    def _asr(self, item: dict[str, Any]) -> ASRProvider:
        provider_id, config = self._selection(item)
        if provider_id == "veetee.asr.fixture":
            return FixtureASR(config)
        if provider_id == "veetee.asr.phowhisper":
            return PhoWhisperASR(config)
        raise ProviderError("ASR_PROVIDER_UNAVAILABLE", f"selected ASR provider unavailable: {provider_id}")

    def _llm(self, item: dict[str, Any]) -> LLMProvider:
        provider_id, config = self._selection(item)
        if provider_id == "veetee.llm.fixture":
            return FixtureLLM(config)
        if provider_id == "groq.chat":
            return GroqLLM(config, self.secret_file)
        raise ProviderError("LLM_PROVIDER_UNAVAILABLE", f"selected LLM provider unavailable: {provider_id}")

    def _tts(self, item: dict[str, Any]) -> TTSProvider:
        provider_id, config = self._selection(item)
        if provider_id == "veetee.tts.fixture-tone":
            return FixtureToneTTS(config)
        if provider_id == "vieneu.v3-turbo":
            return VieNeuTTS(config)
        raise ProviderError("TTS_PROVIDER_UNAVAILABLE", f"selected TTS provider unavailable: {provider_id}")


def _required_string(config: dict[str, Any], key: str) -> str:
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"provider config requires {key}")
    return value


def _positive_int(config: dict[str, Any], key: str, fallback: int | None = None) -> int:
    value = config.get(key, fallback)
    if not isinstance(value, (int, float)) or int(value) <= 0:
        raise ConfigurationError(f"provider config {key} must be positive")
    return int(value)


def _float(config: dict[str, Any], key: str) -> float:
    value = config.get(key)
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ConfigurationError(f"provider config {key} must be finite number")
    return float(value)
