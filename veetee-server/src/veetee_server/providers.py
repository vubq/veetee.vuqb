"""Provider interfaces and config-driven implementations.

The core only knows capability ports. Provider IDs and all tuning values arrive
from the published snapshot; selecting another implementation is a config
operation, not a code branch or runtime fallback.
"""

from __future__ import annotations

import asyncio
import ctypes
from dataclasses import dataclass
import importlib
from importlib import metadata as importlib_metadata
import inspect
import json
import logging
import math
import os
from pathlib import Path
import queue as thread_queue
import re
import struct
import sys
import threading
import tempfile
from collections import deque
from typing import Any, AsyncIterator, Callable, Protocol

import httpx
import opuslib

from .config import ConfigurationError, RuntimeSnapshot
from .secrets import EncryptedFileSecretResolver, SecretResolutionError


LOG = logging.getLogger("veetee.voice.providers")


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class ProviderFactoryContext:
    """Runtime-only dependencies passed to an installed provider factory."""

    secret_file: Path | None = None
    secret_resolver: EncryptedFileSecretResolver | None = None
    test_groq_keys_file: Path | None = None
    secret_refs: tuple[str, ...] = ()


ProviderFactory = Callable[[dict[str, Any], ProviderFactoryContext], Any]


def provider_factory(kind: str, provider_id: str) -> Callable[[ProviderFactory], ProviderFactory]:
    """Declare the stable identity carried by a package entry point."""

    def decorate(factory: ProviderFactory) -> ProviderFactory:
        setattr(factory, "provider_kind", kind)
        setattr(factory, "provider_id", provider_id)
        return factory

    return decorate


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


@dataclass(frozen=True, slots=True)
class IntentMatch:
    intent_id: str
    action: str
    confidence: float


class IntentProvider(Protocol):
    def classify(self, text: str, *, locale: str) -> IntentMatch | None: ...


class MemorySession(Protocol):
    def add_turn(self, user_text: str, assistant_text: str) -> None: ...
    def context(self) -> str: ...


class MemoryProvider(Protocol):
    def create_session(self) -> MemorySession: ...


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
        elif self._speech_ms >= self._min_speech_ms or rms <= self._release_threshold:
            # Once speech is confirmed, every frame below the start threshold
            # contributes to endpointing. Holding the silence counter only for
            # the lower hysteresis threshold can wedge a turn forever when
            # steady microphone noise sits between release and speech levels.
            self._silence_ms += duration_ms
        return self._active or self._speech_ms >= self._min_speech_ms

    def endpoint(self) -> bool:
        if self._speech_ms < self._min_speech_ms:
            return False
        self._active = True
        return self._silence_ms >= self._min_silence_ms


class SileroVAD:
    """Config-driven Silero ONNX VAD with bounded streaming state."""

    def __init__(self, config: dict[str, Any]) -> None:
        model_path = config.get("modelPath")
        if not isinstance(model_path, str) or not model_path.strip():
            raise ConfigurationError("Silero VAD provider requires modelPath")
        try:
            import numpy as np
            import onnxruntime as ort
        except ImportError as exc:
            raise ProviderError("VAD_DEPENDENCY_MISSING", "onnxruntime and numpy are required for Silero VAD") from exc
        self._np = np
        try:
            self._session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        except Exception as exc:  # noqa: BLE001
            raise ProviderError("VAD_MODEL_LOAD_FAILED", "Silero VAD model could not be loaded") from exc
        self._input_names = self._io_names("get_inputs")
        self._output_names = self._io_names("get_outputs")
        self._split_state = {"h", "c"}.issubset(self._input_names)
        self._state_h = np.zeros((1, 1, 128), dtype=np.float32)
        self._state_c = np.zeros((1, 1, 128), dtype=np.float32)
        self._sample_rate = _positive_int(config, "sampleRate", fallback=16_000)
        self._window_samples = _positive_int(config, "windowSamples", fallback=512)
        self._context_samples = _positive_int(config, "contextSamples", fallback=max(1, self._window_samples // 8))
        self._speech_threshold = _float(config, "speechThreshold")
        self._release_threshold = _float(config, "releaseThreshold")
        if not 0 <= self._release_threshold <= self._speech_threshold <= 1:
            raise ConfigurationError("Silero VAD thresholds must satisfy 0 <= release <= speech <= 1")
        self._min_speech_ms = _positive_int(config, "minSpeechMs")
        self._min_silence_ms = _positive_int(config, "minSilenceMs")
        self._state = np.zeros((2, 1, 128), dtype=np.float32)
        self._context = np.zeros((1, self._context_samples), dtype=np.float32)
        self._carry = bytearray()
        self._speech_ms = 0
        self._silence_ms = 0
        self._active = False

    def reset(self) -> None:
        self._state = self._np.zeros((2, 1, 128), dtype=self._np.float32)
        self._state_h = self._np.zeros((1, 1, 128), dtype=self._np.float32)
        self._state_c = self._np.zeros((1, 1, 128), dtype=self._np.float32)
        self._context = self._np.zeros((1, self._context_samples), dtype=self._np.float32)
        self._carry.clear()
        self._speech_ms = 0
        self._silence_ms = 0
        self._active = False

    def close(self) -> None:
        """Drop the ONNX session after all sessions using this generation drain."""

        self._carry.clear()
        self._session = None

    def _io_names(self, method_name: str) -> set[str]:
        method = getattr(self._session, method_name, None)
        if not callable(method):
            return set()
        try:
            return {str(item.name) for item in method() if getattr(item, "name", None)}
        except Exception:  # noqa: BLE001
            # Keep compatibility with the small fake sessions used by host
            # tests and with older ONNX wrappers that expose only ``run``.
            return set()

    def accept(self, pcm: bytes, sample_rate: int) -> bool:
        if sample_rate != self._sample_rate:
            raise ProviderError("VAD_SAMPLE_RATE_UNSUPPORTED", "Silero VAD requires its configured sample rate")
        if len(pcm) % 2:
            raise ProviderError("VAD_PCM_ALIGNMENT", "VAD input must be signed 16-bit PCM")
        self._carry.extend(pcm)
        window_bytes = self._window_samples * 2
        while len(self._carry) >= window_bytes:
            window = bytes(self._carry[:window_bytes])
            del self._carry[:window_bytes]
            self._accept_window(window)
        return self._active or self._speech_ms >= self._min_speech_ms

    def endpoint(self) -> bool:
        if self._speech_ms < self._min_speech_ms:
            return False
        self._active = True
        return self._silence_ms >= self._min_silence_ms

    def _accept_window(self, pcm: bytes) -> None:
        samples = self._np.frombuffer(pcm, dtype="<i2").astype(self._np.float32) / 32768.0
        model_input = self._np.concatenate(
            (self._context.reshape(-1), samples),
            axis=0,
        ).reshape(1, -1)
        feed: dict[str, Any] = {"input": model_input}
        if self._split_state:
            feed.update({"h": self._state_h, "c": self._state_c})
        else:
            feed["state"] = self._state
        if "sr" in self._input_names or not self._input_names:
            feed["sr"] = self._np.asarray(self._sample_rate, dtype=self._np.int64)
        try:
            results = self._session.run(None, feed)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError("VAD_INFERENCE_FAILED", "Silero VAD inference failed") from exc
        if self._split_state:
            if len(results) < 3:
                raise ProviderError("VAD_STATE_INVALID", "Silero VAD returned incomplete recurrent state")
            output, next_h, next_c = results[0], results[1], results[2]
            next_h = self._np.asarray(next_h, dtype=self._np.float32)
            next_c = self._np.asarray(next_c, dtype=self._np.float32)
            if next_h.shape != self._state_h.shape or next_c.shape != self._state_c.shape:
                raise ProviderError("VAD_STATE_INVALID", "Silero VAD returned an invalid recurrent state")
            self._state_h = next_h
            self._state_c = next_c
        else:
            if len(results) < 2:
                raise ProviderError("VAD_STATE_INVALID", "Silero VAD returned incomplete recurrent state")
            output, state = results[0], results[1]
            next_state = self._np.asarray(state, dtype=self._np.float32)
            if next_state.shape != self._state.shape:
                raise ProviderError("VAD_STATE_INVALID", "Silero VAD returned an invalid recurrent state")
            self._state = next_state
        probability = float(self._np.asarray(output).reshape(-1)[0])
        self._context = model_input[:, -self._context_samples:]
        duration_ms = round(self._window_samples * 1000 / self._sample_rate)
        if probability >= self._speech_threshold:
            self._speech_ms += duration_ms
            self._silence_ms = 0
        elif probability <= self._release_threshold:
            self._silence_ms += duration_ms


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


class PatternIntent:
    """Config-only low-latency matcher for system intents.

    Rules, locale gates and actions are data. Business intent remains with the
    configured LLM/tool loop; this provider is deliberately deterministic.
    """

    def __init__(self, config: dict[str, Any]) -> None:
        raw_rules = config.get("rules")
        if not isinstance(raw_rules, list):
            raise ConfigurationError("pattern intent requires config.rules")
        self._rules: list[dict[str, Any]] = []
        for rule in raw_rules:
            if not isinstance(rule, dict):
                raise ConfigurationError("intent rules must be objects")
            intent_id = rule.get("id")
            action = rule.get("action")
            patterns = rule.get("patterns")
            if not isinstance(intent_id, str) or not intent_id.strip() or not isinstance(action, str) or not action.strip():
                raise ConfigurationError("intent rule requires id and action")
            if not isinstance(patterns, list) or not patterns or not all(isinstance(item, str) and item.strip() for item in patterns):
                raise ConfigurationError("intent rule patterns must be a non-empty string array")
            mode = rule.get("mode", "contains")
            if mode not in {"contains", "regex"}:
                raise ConfigurationError("intent rule mode must be contains or regex")
            locales = rule.get("locales", ["*"])
            if not isinstance(locales, list) or not all(isinstance(item, str) and item for item in locales):
                raise ConfigurationError("intent rule locales must be a string array")
            confidence = float(rule.get("confidence", 1.0))
            if not 0 <= confidence <= 1:
                raise ConfigurationError("intent rule confidence must be between 0 and 1")
            self._rules.append({"id": intent_id, "action": action, "patterns": patterns, "mode": mode, "locales": locales, "confidence": confidence})

    def classify(self, text: str, *, locale: str) -> IntentMatch | None:
        normalized = " ".join(text.casefold().split())
        if not normalized:
            return None
        for rule in self._rules:
            locales = rule["locales"]
            if "*" not in locales and locale not in locales and locale.split("-")[0] not in locales:
                continue
            for pattern in rule["patterns"]:
                matched = re.search(pattern, normalized) is not None if rule["mode"] == "regex" else pattern.casefold() in normalized
                if matched:
                    return IntentMatch(rule["id"], rule["action"], rule["confidence"])
        return None


class SessionWindowMemory:
    def __init__(self, config: dict[str, Any]) -> None:
        self._max_turns = _positive_int(config, "maxTurns", fallback=8)
        self._max_characters = _positive_int(config, "maxCharacters", fallback=12000)

    def create_session(self) -> MemorySession:
        return _SessionWindow(self._max_turns, self._max_characters)


class _SessionWindow:
    def __init__(self, max_turns: int, max_characters: int) -> None:
        self._max_turns = max_turns
        self._max_characters = max_characters
        self._turns: deque[dict[str, str]] = deque(maxlen=max_turns)

    def add_turn(self, user_text: str, assistant_text: str) -> None:
        self._turns.append({"user": user_text, "assistant": assistant_text})
        while len(json.dumps(list(self._turns), ensure_ascii=False)) > self._max_characters and self._turns:
            self._turns.popleft()

    def context(self) -> str:
        return json.dumps(list(self._turns), ensure_ascii=False, separators=(",", ":"))


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
        device = str(config.get("device", "cuda"))
        if device.lower().startswith("cuda"):
            _preload_cuda_runtime()
        try:
            self._model = module.WhisperModel(
                model_path,
                device=device,
                compute_type=config.get("computeType", "float16"),
                cpu_threads=_positive_int(config, "cpuThreads", fallback=4),
                num_workers=_positive_int(config, "numWorkers", fallback=1),
            )
        except Exception as exc:  # noqa: BLE001
            raise ProviderError("ASR_MODEL_LOAD_FAILED", "PhoWhisper model could not be loaded") from exc
        self._audio_path: Path | None = None
        self._audio_file: Any | None = None
        self._sample_count = 0
        self._sample_rate = _positive_int(config, "sampleRate", fallback=16000)
        self._beam_size = _positive_int(config, "beamSize", fallback=1)
        self._condition_on_previous_text = bool(config.get("conditionOnPreviousText", False))
        self._without_timestamps = bool(config.get("withoutTimestamps", True))
        self._vad_filter = bool(config.get("vadFilter", False))

    def reset(self) -> None:
        self._close_audio(remove=True)
        self._sample_count = 0

    def close(self) -> None:
        """Release the model reference after the generation lease reaches zero."""

        self.reset()
        self._model = None

    async def accept(self, pcm: bytes, sample_rate: int) -> None:
        import numpy as np

        self._sample_rate = sample_rate
        if len(pcm) % 2:
            raise ProviderError("ASR_PCM_ALIGNMENT", "ASR input must be signed 16-bit PCM")
        if self._audio_file is None:
            temporary = tempfile.NamedTemporaryFile(prefix="veetee-asr-", suffix=".f32", delete=False)
            self._audio_file = temporary
            self._audio_path = Path(temporary.name)
        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        self._audio_file.write(samples.tobytes())
        self._audio_file.flush()
        self._sample_count += int(samples.size)

    async def finish(self, locale: str) -> str:
        import numpy as np

        path = self._audio_path
        sample_count = self._sample_count
        self._close_audio(remove=False)
        if path is None or sample_count <= 0:
            if path is not None:
                path.unlink(missing_ok=True)
            self._audio_path = None
            self._sample_count = 0
            return ""
        samples = np.memmap(path, dtype="<f4", mode="r", shape=(sample_count,))
        try:
            segments, _ = await asyncio.to_thread(
                self._model.transcribe,
                samples,
                language=locale.split("-")[0],
                vad_filter=self._vad_filter,
                beam_size=self._beam_size,
                condition_on_previous_text=self._condition_on_previous_text,
                without_timestamps=self._without_timestamps,
            )
            return " ".join(segment.text.strip() for segment in segments).strip()
        finally:
            del samples
            path.unlink(missing_ok=True)
            self._audio_path = None
            self._sample_count = 0

    def _close_audio(self, *, remove: bool) -> None:
        if self._audio_file is not None:
            self._audio_file.close()
            self._audio_file = None
        if remove and self._audio_path is not None:
            self._audio_path.unlink(missing_ok=True)
            self._audio_path = None


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


class GroqTestKeyPool:
    """Opt-in key cursor used only by fixture/test server processes.

    This is deliberately outside the production secretRef path.  The pool
    exposes only ordinals to diagnostics and rotates after a request starts;
    it never belongs in a published Manager snapshot.
    """

    def __init__(self, path: Path) -> None:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise ConfigurationError("test Groq key pool cannot be read") from exc
        values: list[str] = []
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            value = line.split("=", 1)[1] if "=" in line else line
            value = value.strip()
            if value:
                values.append(value)
        if not values:
            raise ConfigurationError("test Groq key pool is empty")
        self._keys = tuple(values)
        self._cursor = 0
        self._lock = asyncio.Lock()

    @property
    def count(self) -> int:
        return len(self._keys)

    async def attempts(self) -> tuple[tuple[int, str], ...]:
        """Reserve a round-robin starting point without exposing key values."""

        async with self._lock:
            start = self._cursor
            self._cursor = (start + 1) % len(self._keys)
        return tuple(
            (ordinal, self._keys[ordinal])
            for offset in range(len(self._keys))
            for ordinal in ((start + offset) % len(self._keys),)
        )

    async def mark_success(self, ordinal: int) -> None:
        """Start the next turn after the key that actually succeeded."""

        async with self._lock:
            self._cursor = (ordinal + 1) % len(self._keys)


class GroqLLM:
    def __init__(
        self,
        config: dict[str, Any],
        secret_file: Path | None,
        secret_resolver: EncryptedFileSecretResolver | None,
        secret_refs: list[str],
        *,
        test_key_file: Path | None = None,
    ) -> None:
        if secret_file is None and secret_resolver is None and test_key_file is None:
            raise ProviderError("LLM_SECRET_MISSING", "Groq provider requires one secret reference")
        if len(secret_refs) > 1:
            raise ConfigurationError("Groq provider accepts exactly one secretRef")
        if test_key_file is not None and secret_refs:
            raise ConfigurationError("test Groq key pool requires empty secretRefs")
        self._model = _required_string(config, "model")
        self._endpoint = _required_string(config, "endpoint")
        self._temperature = float(config.get("temperature", 0.3))
        self._max_tokens = int(config.get("maxTokens", 512))
        self._timeout_seconds = _bounded_float(
            config,
            "timeoutSeconds",
            fallback=float(os.getenv("VEETEE_LLM_TIMEOUT_SECONDS", "30")),
            minimum=1,
            maximum=300,
        )
        self._max_connections = _bounded_int(config, "maxConnections", fallback=8, minimum=1, maximum=64)
        self._max_keepalive_connections = _bounded_int(
            config,
            "maxKeepaliveConnections",
            fallback=min(4, self._max_connections),
            minimum=0,
            maximum=self._max_connections,
        )
        self._keepalive_expiry_seconds = _bounded_float(
            config,
            "keepaliveExpirySeconds",
            fallback=30,
            minimum=0,
            maximum=300,
        )
        self._secret_file = secret_file
        self._secret_resolver = secret_resolver
        self._secret_ref = secret_refs[0] if secret_refs else None
        self._test_key_pool = GroqTestKeyPool(test_key_file) if test_key_file is not None else None
        self._client: httpx.AsyncClient | None = None
        self._client_lock = asyncio.Lock()
        self._closed = False

    def _key(self) -> str:
        if self._secret_ref and self._secret_resolver:
            try:
                return self._secret_resolver.resolve(self._secret_ref)
            except SecretResolutionError as exc:
                raise ProviderError("LLM_SECRET_RESOLVE_FAILED", "Groq secretRef could not be resolved") from exc
        if self._secret_ref and not self._secret_resolver:
            raise ProviderError("LLM_SECRET_RESOLVER_MISSING", "Groq secretRef resolver is not configured")
        if self._secret_file is None:
            raise ProviderError("LLM_SECRET_MISSING", "Groq provider requires one secret reference")
        try:
            lines = self._secret_file.read_text(encoding="utf-8").splitlines()
        except OSError as exc:
            raise ProviderError("LLM_SECRET_READ_FAILED", "cannot read Groq secret file") from exc
        values = [line.split("=", 1)[1] if "=" in line else line for line in lines]
        values = [value.strip() for value in values if value.strip() and not value.lstrip().startswith("#")]
        if len(values) != 1:
            raise ProviderError("LLM_SINGLE_SECRET_REQUIRED", "production Groq config requires exactly one key")
        return values[0]

    async def _get_client(self) -> httpx.AsyncClient:
        if self._closed:
            raise ProviderError("LLM_PROVIDER_CLOSED", "Groq provider is closed")
        client = self._client
        if client is not None:
            return client
        async with self._client_lock:
            if self._closed:
                raise ProviderError("LLM_PROVIDER_CLOSED", "Groq provider is closed")
            if self._client is None:
                self._client = httpx.AsyncClient(
                    timeout=httpx.Timeout(self._timeout_seconds),
                    limits=httpx.Limits(
                        max_connections=self._max_connections,
                        max_keepalive_connections=self._max_keepalive_connections,
                        keepalive_expiry=self._keepalive_expiry_seconds,
                    ),
                )
            return self._client

    async def close(self) -> None:
        """Close the generation-scoped HTTP pool after all session leases drain."""

        async with self._client_lock:
            self._closed = True
            client = self._client
            self._client = None
        if client is not None:
            await client.aclose()

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
        client = await self._get_client()
        pool = self._test_key_pool
        if pool is None:
            async for delta in self._stream_once(client, payload, self._key()):
                yield delta
            return

        last_error: ProviderError | None = None
        for ordinal, key in await pool.attempts():
            emitted = False
            try:
                async for delta in self._stream_once(client, payload, key):
                    emitted = True
                    yield delta
                await pool.mark_success(ordinal)
                LOG.info("test-only Groq key ordinal=%d succeeded", ordinal + 1)
                return
            except ProviderError as exc:
                # A partial stream cannot be replayed safely: retrying would
                # duplicate text/tool deltas in the TTS pipeline.
                if exc.code != "LLM_RATE_LIMITED" or emitted:
                    raise
                last_error = exc
                LOG.info("test-only Groq key ordinal=%d rate_limited", ordinal + 1)
                continue
        assert last_error is not None
        raise last_error

    async def _stream_once(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, Any],
        key: str,
    ) -> AsyncIterator[LLMDelta]:
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        try:
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
                    choices = event.get("choices")
                    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                        continue
                    delta = choices[0].get("delta")
                    if not isinstance(delta, dict):
                        continue
                    text = delta.get("content") if isinstance(delta.get("content"), str) else ""
                    tool_calls = delta.get("tool_calls")
                    if not isinstance(tool_calls, list):
                        tool_calls = []
                    if text:
                        yield LLMDelta(text=text)
                    for call in tool_calls:
                        if not isinstance(call, dict):
                            continue
                        function = call.get("function")
                        if not isinstance(function, dict):
                            continue
                        name = function.get("name") if isinstance(function.get("name"), str) else None
                        arguments = function.get("arguments") if isinstance(function.get("arguments"), str) else ""
                        if not name and not arguments:
                            continue
                        yield LLMDelta(
                            tool_name=name,
                            tool_arguments=arguments,
                        )
        except httpx.TimeoutException as exc:
            raise ProviderError("LLM_TIMEOUT", "Groq request timed out", retryable=True) from exc
        except httpx.RequestError as exc:
            raise ProviderError("LLM_NETWORK_ERROR", "Groq request failed", retryable=True) from exc


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
    """Config-driven VieNeu v3 Turbo adapter with bounded streaming."""

    def __init__(self, config: dict[str, Any]) -> None:
        try:
            self._module = importlib.import_module("vieneu")
        except ImportError as exc:
            raise ProviderError("TTS_DEPENDENCY_MISSING", "VieNeu package is not installed") from exc
        model = config.get("backboneRepo", config.get("modelPath"))
        if not isinstance(model, str) or not model.strip():
            raise ConfigurationError("VieNeu provider requires config.backboneRepo")
        self._model = model.strip()
        self._mode = str(config.get("mode", "v3turbo"))
        self._sample_rate = _positive_int(config, "sampleRate", fallback=24000)
        self._source_sample_rate = _positive_int(config, "sourceSampleRate", fallback=48000)
        self._prewarm = bool(config.get("prewarm", False))
        self._factory_config = self._factory_kwargs(config)
        self._engine: Any | None = None
        self._engine_lock = asyncio.Lock()

    @staticmethod
    def _factory_kwargs(config: dict[str, Any]) -> dict[str, Any]:
        names = {
            "modelSubfolder": "model_subfolder",
            "mossTokenizer": "moss_tokenizer",
            "device": "device",
            "dtype": "dtype",
            "backend": "backend",
            "onnxRepo": "onnx_repo",
            "onnxDir": "onnx_dir",
            "codecRepo": "codec_repo",
            "codecDir": "codec_dir",
            "precision": "precision",
            "onnxSubfolder": "onnx_subfolder",
            "threads": "threads",
            "maxBatchSize": "max_batch_size",
        }
        result = {target: config[key] for key, target in names.items() if key in config}
        return result

    async def _get_engine(self) -> Any:
        if self._engine is not None:
            return self._engine
        async with self._engine_lock:
            if self._engine is None:
                kwargs = {"mode": self._mode, "backbone_repo": self._model, **self._factory_config}
                try:
                    self._engine = await asyncio.to_thread(self._module.Vieneu, **kwargs)
                except Exception as exc:  # noqa: BLE001
                    raise ProviderError("TTS_MODEL_LOAD_FAILED", "VieNeu model could not be loaded") from exc
        return self._engine

    async def prepare(self) -> None:
        """Load an opted-in local model before the runtime snapshot is ready."""
        if self._prewarm:
            await self._get_engine()

    async def close(self) -> None:
        """Close an engine when supported, then drop the generation reference."""

        async with self._engine_lock:
            engine = self._engine
            self._engine = None
        if engine is None:
            return
        for method_name in ("close", "shutdown", "unload"):
            method = getattr(engine, method_name, None)
            if not callable(method):
                continue
            result = method()
            if inspect.isawaitable(result):
                await result
            break

    async def stream(self, text: str, *, locale: str, voice: dict[str, Any]) -> AsyncIterator[AudioChunk]:
        del locale  # VieNeu's Vietnamese model infers language from configured text/voice.
        engine = await self._get_engine()
        voice_id = voice.get("voiceId")
        if voice_id is not None and not isinstance(voice_id, (str, dict)):
            raise ProviderError("TTS_VOICE_INVALID", "voiceId must be a string or object")
        options: dict[str, Any] = {}
        for key in ("style", "temperature", "topK", "topP", "maxNewFrames", "maxChars", "repetitionPenalty"):
            if key in voice:
                options[{"topK": "top_k", "topP": "top_p", "maxNewFrames": "max_new_frames", "maxChars": "max_chars", "repetitionPenalty": "repetition_penalty"}.get(key, key)] = voice[key]
        events: thread_queue.Queue[tuple[str, Any]] = thread_queue.Queue(maxsize=4)
        cancelled = threading.Event()

        def worker() -> None:
            def put_event(kind: str, value: Any) -> None:
                while not cancelled.is_set():
                    try:
                        events.put((kind, value), timeout=0.2)
                        return
                    except thread_queue.Full:
                        continue

            try:
                result = engine.infer_stream(text, voice=voice_id, **options)
                for chunk in result:
                    if cancelled.is_set():
                        break
                    put_event("chunk", chunk)
                put_event("done", None)
            except Exception as exc:  # noqa: BLE001
                put_event("error", exc)

        worker_task = asyncio.create_task(asyncio.to_thread(worker), name="vieneu-stream-worker")
        try:
            while True:
                try:
                    kind, value = await asyncio.to_thread(events.get, True, 0.2)
                except thread_queue.Empty:
                    continue
                if kind == "done":
                    break
                if kind == "error":
                    raise ProviderError("TTS_SYNTHESIS_FAILED", "VieNeu synthesis failed") from value
                import numpy as np

                if isinstance(value, tuple) and len(value) == 2:
                    rate, value = value
                else:
                    rate = getattr(engine, "sample_rate", self._source_sample_rate)
                samples = np.asarray(value, dtype=np.float32).reshape(-1)
                if samples.size == 0:
                    continue
                if int(rate) != self._sample_rate:
                    try:
                        import soxr

                        samples = soxr.resample(samples, int(rate), self._sample_rate)
                    except Exception as exc:  # noqa: BLE001
                        raise ProviderError("TTS_RESAMPLE_FAILED", "cannot resample VieNeu audio") from exc
                pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()
                yield AudioChunk(pcm, self._sample_rate, final=False)
        finally:
            cancelled.set()
            if not worker_task.done():
                worker_task.cancel()
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


@provider_factory("vad", "veetee.vad.energy")
def energy_vad_factory(config: dict[str, Any], context: ProviderFactoryContext) -> VADProvider:
    del context
    return EnergyVAD(config)


@provider_factory("vad", "veetee.vad.silero")
def silero_vad_factory(config: dict[str, Any], context: ProviderFactoryContext) -> VADProvider:
    del context
    return SileroVAD(config)


@provider_factory("asr", "veetee.asr.fixture")
def fixture_asr_factory(config: dict[str, Any], context: ProviderFactoryContext) -> ASRProvider:
    del context
    return FixtureASR(config)


@provider_factory("asr", "veetee.asr.phowhisper")
def phowhisper_asr_factory(config: dict[str, Any], context: ProviderFactoryContext) -> ASRProvider:
    del context
    return PhoWhisperASR(config)


@provider_factory("llm", "veetee.llm.fixture")
def fixture_llm_factory(config: dict[str, Any], context: ProviderFactoryContext) -> LLMProvider:
    del context
    return FixtureLLM(config)


@provider_factory("llm", "groq.chat")
def groq_llm_factory(config: dict[str, Any], context: ProviderFactoryContext) -> LLMProvider:
    raw_refs = context.secret_refs
    if not all(isinstance(value, str) and value for value in raw_refs) or (not raw_refs and context.test_groq_keys_file is None):
        raise ConfigurationError("Groq provider secretRefs must be a non-empty string array")
    return GroqLLM(
        config,
        context.secret_file,
        context.secret_resolver,
        list(raw_refs),
        test_key_file=context.test_groq_keys_file,
    )


@provider_factory("tts", "veetee.tts.fixture-tone")
def fixture_tone_tts_factory(config: dict[str, Any], context: ProviderFactoryContext) -> TTSProvider:
    del context
    return FixtureToneTTS(config)


@provider_factory("tts", "vieneu.v3-turbo")
def vieneu_tts_factory(config: dict[str, Any], context: ProviderFactoryContext) -> TTSProvider:
    del context
    return VieNeuTTS(config)


@provider_factory("intent", "veetee.intent.patterns")
def pattern_intent_factory(config: dict[str, Any], context: ProviderFactoryContext) -> IntentProvider:
    del context
    return PatternIntent(config)


@provider_factory("memory", "veetee.memory.session-window")
def session_window_memory_factory(config: dict[str, Any], context: ProviderFactoryContext) -> MemoryProvider:
    del context
    return SessionWindowMemory(config)


def discover_provider_factories() -> dict[tuple[str, str], ProviderFactory]:
    """Load provider factories from installed package entry points.

    The entry-point name is the stable provider ID. The loaded callable must be
    decorated with ``provider_factory`` (or expose the same attributes), so a
    package cannot accidentally register an implementation under the wrong
    capability. Duplicate `(kind, id)` registrations fail closed.
    """

    available = importlib_metadata.entry_points()
    if hasattr(available, "select"):
        selected = available.select(group="veetee.providers")
    else:  # pragma: no cover - compatibility with pre-3.10 metadata APIs
        selected = [item for item in available if getattr(item, "group", None) == "veetee.providers"]
    result: dict[tuple[str, str], ProviderFactory] = {}
    for entry_point in selected:
        factory = entry_point.load()
        if not callable(factory):
            raise ConfigurationError(f"provider entry point is not callable: {entry_point.name}")
        provider_id = getattr(factory, "provider_id", entry_point.name)
        kind = getattr(factory, "provider_kind", None)
        if provider_id != entry_point.name or kind not in {"vad", "asr", "llm", "tts", "intent", "memory"}:
            raise ConfigurationError(f"provider entry point metadata is invalid: {entry_point.name}")
        key = (kind, provider_id)
        if key in result:
            raise ConfigurationError(f"duplicate provider entry point: {kind}/{provider_id}")
        result[key] = factory
    return result


class ProviderRegistry:
    def __init__(
        self,
        snapshot: RuntimeSnapshot,
        *,
        secret_file: Path | None = None,
        secret_resolver: EncryptedFileSecretResolver | None = None,
        test_groq_keys_file: Path | None = None,
    ) -> None:
        self.snapshot = snapshot
        self.secret_file = secret_file
        self.secret_resolver = secret_resolver
        self.test_groq_keys_file = test_groq_keys_file
        self._factories = discover_provider_factories()
        self._closed = False
        self.vad = self._build("vad", snapshot.provider("vad"))
        self.asr = self._build("asr", snapshot.provider("asr"))
        self.llm = self._build("llm", snapshot.provider("llm"))
        self.tts = self._build("tts", snapshot.provider("tts"))
        self.intent = self._optional("intent")
        self.memory = self._optional("memory")

    async def prepare(self) -> None:
        preparer = getattr(self.tts, "prepare", None)
        if callable(preparer):
            await preparer()

    async def close(self) -> None:
        """Release provider-owned models, workers and temporary state once."""

        if self._closed:
            return
        self._closed = True
        seen: set[int] = set()
        providers = (self.vad, self.asr, self.llm, self.tts, self.intent, self.memory)
        for provider in providers:
            if provider is None or id(provider) in seen:
                continue
            seen.add(id(provider))
            closer = getattr(provider, "close", None)
            if not callable(closer):
                continue
            result = closer()
            if inspect.isawaitable(result):
                await result

    def _selection(self, item: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        provider_id = item.get("providerId")
        if not isinstance(provider_id, str) or not provider_id.strip():
            raise ConfigurationError("providerId missing or empty")
        config = item.get("config")
        if not isinstance(config, dict):
            raise ConfigurationError(f"provider config must be object: {provider_id}")
        # A runtime snapshot has exactly one selected provider per kind. Reject
        # fallback-shaped fields explicitly instead of silently accepting a
        # config that could make an operator believe a secondary provider runs.
        if any(key in config for key in ("fallback", "fallbackProviderId", "fallbackProviderIds")):
            raise ConfigurationError(f"provider fallback is unsupported: {provider_id}")
        return provider_id, config

    def _build(self, kind: str, item: dict[str, Any]) -> Any:
        provider_id, config = self._selection(item)
        factory = self._factories.get((kind, provider_id))
        if factory is None:
            raise ProviderError(f"{kind.upper()}_PROVIDER_UNAVAILABLE", f"selected {kind} provider unavailable: {provider_id}")
        raw_refs = item.get("secretRefs", [])
        if not isinstance(raw_refs, list) or not all(isinstance(value, str) and value.strip() for value in raw_refs):
            raise ConfigurationError(f"provider secretRefs must be a non-empty string array when present: {provider_id}")
        context = ProviderFactoryContext(
            secret_file=self.secret_file,
            secret_resolver=self.secret_resolver,
            test_groq_keys_file=self.test_groq_keys_file,
            secret_refs=tuple(raw_refs),
        )
        return factory(dict(config), context)

    def _optional(self, kind: str) -> Any | None:
        item = self.snapshot.raw.get("providers", {}).get(kind)
        if not isinstance(item, dict) or item.get("mode") == "disabled":
            return None
        return self._build(kind, item)


def _required_string(config: dict[str, Any], key: str) -> str:
    value = config.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"provider config requires {key}")
    return value


def _preload_cuda_runtime() -> None:
    """Make pip-installed CUDA 12 libraries visible to CTranslate2.

    CTranslate2 resolves CUDA libraries with ``dlopen`` and does not inspect
    Python's site-packages tree. Loading the optional wheels globally keeps the
    runtime self-contained without requiring the operator to mutate the host's
    shell profile. Missing wheels are intentionally ignored so a later provider
    error remains typed and actionable.
    """

    site_roots = [Path(path) for path in sys.path if path]
    library_specs = (
        ("nvidia/cublas/lib", "libcublas.so"),
        ("nvidia/cuda_nvrtc/lib", "libnvrtc.so"),
        ("nvidia/cudnn/lib", "libcudnn.so"),
    )
    for relative_dir, prefix in library_specs:
        candidates: list[Path] = []
        for root in site_roots:
            candidates.extend(sorted((root / relative_dir).glob(f"{prefix}.*")))
        for candidate in candidates:
            try:
                ctypes.CDLL(str(candidate), mode=ctypes.RTLD_GLOBAL)
                break
            except OSError:
                continue


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


def _bounded_int(
    config: dict[str, Any],
    key: str,
    *,
    fallback: int,
    minimum: int,
    maximum: int,
) -> int:
    value = config.get(key, fallback)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
        raise ConfigurationError(f"provider config {key} must be an integer")
    result = int(value)
    if not minimum <= result <= maximum:
        raise ConfigurationError(f"provider config {key} must be between {minimum} and {maximum}")
    return result


def _bounded_float(
    config: dict[str, Any],
    key: str,
    *,
    fallback: float,
    minimum: float,
    maximum: float,
) -> float:
    value = config.get(key, fallback)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ConfigurationError(f"provider config {key} must be a finite number")
    result = float(value)
    if not minimum <= result <= maximum:
        raise ConfigurationError(f"provider config {key} must be between {minimum} and {maximum}")
    return result
