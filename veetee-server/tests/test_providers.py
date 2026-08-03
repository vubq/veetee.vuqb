import asyncio
import sys
import types

import numpy as np
import pytest

from veetee_server.providers import AudioChunk, GroqLLM, PatternIntent, PhoWhisperASR, SessionWindowMemory, VieNeuTTS


@pytest.mark.asyncio
async def test_vieneu_adapter_is_lazy_and_resamples_stream(monkeypatch):
    calls = []

    class FakeEngine:
        sample_rate = 48_000

        def infer_stream(self, text, *, voice, **options):
            calls.append((text, voice, options))
            yield np.linspace(-0.25, 0.25, 480, dtype=np.float32)
            yield np.zeros(960, dtype=np.float32)

    def factory(**kwargs):
        calls.append(("factory", kwargs))
        return FakeEngine()

    monkeypatch.setitem(sys.modules, "vieneu", types.SimpleNamespace(Vieneu=factory))
    adapter = VieNeuTTS(
        {
            "backboneRepo": "test/backbone",
            "mode": "v3turbo",
            "backend": "onnx",
            "precision": "int8",
            "onnxDir": "/models/vieneu/onnx_int8",
            "codecDir": "/models/moss-onnx",
            "sampleRate": 24_000,
            "sourceSampleRate": 48_000,
        }
    )
    assert calls == []

    chunks = [chunk async for chunk in adapter.stream("Xin chào", locale="vi-VN", voice={"voiceId": "Thanh Bình"})]

    assert calls[0][0] == "factory"
    assert calls[0][1]["backbone_repo"] == "test/backbone"
    assert calls[0][1]["onnx_dir"] == "/models/vieneu/onnx_int8"
    assert calls[0][1]["codec_dir"] == "/models/moss-onnx"
    assert calls[1][1] == "Thanh Bình"
    assert all(isinstance(chunk, AudioChunk) for chunk in chunks)
    assert all(chunk.sample_rate == 24_000 for chunk in chunks)
    assert chunks[-1].final is True
    assert chunks[-1].pcm == b""
    assert sum(len(chunk.pcm) for chunk in chunks[:-1]) > 0


@pytest.mark.asyncio
async def test_vieneu_adapter_propagates_synthesis_error(monkeypatch):
    class FakeEngine:
        sample_rate = 48_000

        def infer_stream(self, text, *, voice, **options):
            del text, voice, options
            raise RuntimeError("synthetic failure")
            yield np.zeros(1, dtype=np.float32)

    monkeypatch.setitem(sys.modules, "vieneu", types.SimpleNamespace(Vieneu=lambda **kwargs: FakeEngine()))
    adapter = VieNeuTTS({"backboneRepo": "test/backbone", "backend": "onnx"})

    with pytest.raises(Exception, match="VieNeu synthesis failed"):
        async for _ in adapter.stream("Xin chào", locale="vi-VN", voice={}):
            pass


@pytest.mark.asyncio
async def test_vieneu_adapter_cancellation_stops_worker(monkeypatch):
    stopped = asyncio.Event()

    class FakeEngine:
        sample_rate = 48_000

        def infer_stream(self, text, *, voice, **options):
            del text, voice, options
            while not stopped.is_set():
                yield np.zeros(480, dtype=np.float32)

    monkeypatch.setitem(sys.modules, "vieneu", types.SimpleNamespace(Vieneu=lambda **kwargs: FakeEngine()))
    adapter = VieNeuTTS({"backboneRepo": "test/backbone", "backend": "onnx"})
    stream = adapter.stream("Xin chào", locale="vi-VN", voice={})
    first = await anext(stream)
    assert first.sample_rate == 24_000
    await stream.aclose()
    stopped.set()


@pytest.mark.asyncio
async def test_phowhisper_adapter_uses_configured_runtime(monkeypatch):
    calls = []

    class FakeModel:
        def transcribe(self, samples, **kwargs):
            calls.append((samples, kwargs))
            return iter([types.SimpleNamespace(text=" xin chào ")]), types.SimpleNamespace()

    class FakeModule:
        def WhisperModel(self, model_path, **kwargs):
            calls.append((model_path, kwargs))
            return FakeModel()

    monkeypatch.setitem(sys.modules, "faster_whisper", FakeModule())
    monkeypatch.setattr("veetee_server.providers._preload_cuda_runtime", lambda: calls.append("cuda-preload"))
    provider = PhoWhisperASR(
        {
            "modelPath": "/models/phowhisper",
            "device": "cuda",
            "computeType": "float16",
            "cpuThreads": 2,
            "numWorkers": 1,
        }
    )
    await provider.accept(b"\0\0" * 160, 16_000)
    assert await provider.finish("vi-VN") == "xin chào"
    assert calls[0] == "cuda-preload"
    assert calls[1] == ("/models/phowhisper", {"device": "cuda", "compute_type": "float16", "cpu_threads": 2, "num_workers": 1})
    assert calls[2][1]["language"] == "vi"
    assert calls[2][1]["condition_on_previous_text"] is False
    assert calls[2][1]["without_timestamps"] is True


def test_groq_provider_resolves_one_secret_ref_without_file(tmp_path):
    class Resolver:
        def resolve(self, reference_id):
            assert reference_id == "secret-1"
            return "key-from-manager"

    provider = GroqLLM(
        {"endpoint": "https://example.invalid", "model": "configured-model"},
        None,
        Resolver(),
        ["secret-1"],
    )
    assert provider._key() == "key-from-manager"


def test_pattern_intent_and_session_memory_are_config_driven():
    intent = PatternIntent({
        "rules": [
            {"id": "exit.vi", "action": "conversation.exit", "locales": ["vi"], "patterns": ["tạm biệt", "bye"]},
        ],
    })
    match = intent.classify("  BYE nhé ", locale="vi-VN")
    assert match is not None
    assert match.intent_id == "exit.vi"
    assert match.action == "conversation.exit"
    assert intent.classify("xin chào", locale="en-US") is None

    memory = SessionWindowMemory({"maxTurns": 2, "maxCharacters": 1000}).create_session()
    memory.add_turn("một", "hai")
    memory.add_turn("ba", "bốn")
    memory.add_turn("năm", "sáu")
    context = memory.context()
    assert '"user":"một"' not in context
    assert '"user":"năm"' in context
