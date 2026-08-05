import asyncio
import json
from pathlib import Path
import sys
import types

import httpx
import numpy as np
import pytest

from veetee_server.config import ConfigurationError, load_snapshot
from veetee_server.providers import AudioChunk, EnergyVAD, GroqLLM, GroqTestKeyPool, PatternIntent, PhoWhisperASR, ProviderError, ProviderRegistry, SessionWindowMemory, SileroVAD, VieNeuTTS, discover_provider_factories, provider_factory


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
async def test_vieneu_prepare_prewarm_is_configured(monkeypatch):
    calls = []
    closed = []

    class FakeEngine:
        sample_rate = 48_000

        def close(self):
            closed.append(True)

    def factory(**kwargs):
        calls.append(kwargs)
        return FakeEngine()

    monkeypatch.setitem(sys.modules, "vieneu", types.SimpleNamespace(Vieneu=factory))
    adapter = VieNeuTTS({"backboneRepo": "test/backbone", "prewarm": True})
    assert calls == []
    await adapter.prepare()
    assert calls == [{"mode": "v3turbo", "backbone_repo": "test/backbone"}]
    await adapter.close()
    await adapter.close()
    assert closed == [True]


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


def test_silero_vad_streams_recurrent_state_and_endpoints(monkeypatch):
    calls = []

    class FakeSession:
        def run(self, _outputs, inputs):
            calls.append(inputs)
            probability = 0.9 if len(calls) == 1 else 0.05
            return np.asarray([[probability]], dtype=np.float32), np.zeros((2, 1, 128), dtype=np.float32)

    monkeypatch.setitem(sys.modules, "onnxruntime", types.SimpleNamespace(InferenceSession=lambda path, providers: FakeSession()))
    provider = SileroVAD({
        "modelPath": "fixture-silero.onnx",
        "sampleRate": 16_000,
        "windowSamples": 512,
        "contextSamples": 64,
        "speechThreshold": 0.6,
        "releaseThreshold": 0.2,
        "minSpeechMs": 32,
        "minSilenceMs": 32,
    })
    speech = np.full(512, 12_000, dtype="<i2").tobytes()
    silence = np.zeros(512, dtype="<i2").tobytes()
    assert provider.accept(speech, 16_000) is True
    assert provider.accept(silence, 16_000) is True
    assert provider.endpoint() is True
    assert calls[0]["input"].shape == (1, 576)
    assert calls[0]["state"].shape == (2, 1, 128)
    assert int(calls[0]["sr"]) == 16_000


def test_silero_vad_supports_split_h_c_onnx_state(monkeypatch):
    calls = []

    class FakeSession:
        def get_inputs(self):
            return [types.SimpleNamespace(name=name) for name in ("input", "h", "c")]

        def get_outputs(self):
            return [types.SimpleNamespace(name=name) for name in ("speech_probs", "hn", "cn")]

        def run(self, _outputs, inputs):
            calls.append(inputs)
            return (
                np.asarray([[0.9 if len(calls) == 1 else 0.05]], dtype=np.float32),
                np.zeros((1, 1, 128), dtype=np.float32),
                np.zeros((1, 1, 128), dtype=np.float32),
            )

    monkeypatch.setitem(sys.modules, "onnxruntime", types.SimpleNamespace(InferenceSession=lambda path, providers: FakeSession()))
    provider = SileroVAD({
        "modelPath": "fixture-silero-v6.onnx",
        "sampleRate": 16_000,
        "windowSamples": 512,
        "contextSamples": 64,
        "speechThreshold": 0.6,
        "releaseThreshold": 0.2,
        "minSpeechMs": 32,
        "minSilenceMs": 32,
    })
    speech = np.full(512, 12_000, dtype="<i2").tobytes()
    silence = np.zeros(512, dtype="<i2").tobytes()
    assert provider.accept(speech, 16_000) is True
    assert provider.accept(silence, 16_000) is True
    assert provider.endpoint() is True
    assert set(calls[0]) == {"input", "h", "c"}


def test_energy_vad_endpoints_when_noise_is_between_hysteresis_levels():
    provider = EnergyVAD({
        "speechThreshold": 0.006,
        "releaseThreshold": 0.003,
        "minSpeechMs": 60,
        "minSilenceMs": 120,
    })
    speech = np.full(960, 500, dtype="<i2").tobytes()
    steady_noise = np.full(960, 128, dtype="<i2").tobytes()

    assert provider.accept(speech, 16_000) is True
    assert provider.accept(steady_noise, 16_000) is True
    assert provider.endpoint() is False
    assert provider.accept(steady_noise, 16_000) is True
    assert provider.endpoint() is True


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


@pytest.mark.asyncio
async def test_groq_provider_reuses_generation_scoped_http_pool_and_closes_it(monkeypatch):
    created = []
    requests = []

    class Response:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"Xin chào"}}]}'
            yield 'data: [DONE]'

    class Client:
        def __init__(self, **kwargs):
            created.append(kwargs)
            self.closed = False

        def stream(self, method, endpoint, *, headers, json):
            requests.append((method, endpoint, headers, json))
            return Response()

        async def aclose(self):
            self.closed = True

    monkeypatch.setattr("veetee_server.providers.httpx.AsyncClient", Client)
    provider = GroqLLM(
        {
            "endpoint": "https://example.invalid/v1/chat/completions",
            "model": "configured-model",
            "maxConnections": 3,
            "maxKeepaliveConnections": 2,
            "keepaliveExpirySeconds": 12,
        },
        None,
        types.SimpleNamespace(resolve=lambda reference_id: "key-from-manager"),
        ["secret-1"],
    )

    first = [delta async for delta in provider.stream(prompt="một", locale="vi-VN", tools=[])]
    second = [delta async for delta in provider.stream(prompt="hai", locale="vi-VN", tools=[])]

    assert len(created) == 1
    assert len(requests) == 2
    assert first[-1].final is True
    assert second[0].text == "Xin chào"
    await provider.close()
    assert created[0]["limits"].max_connections == 3
    assert created[0]["limits"].max_keepalive_connections == 2
    assert created[0]["limits"].keepalive_expiry == 12
    assert provider._client is None


@pytest.mark.asyncio
async def test_groq_provider_preserves_fragmented_tool_arguments_and_ignores_malformed_events(monkeypatch):
    class Response:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"get_weather","arguments":""}}]}}]}'
            yield 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"city\\":"}}]}}]}'
            yield 'data: {"choices":[]}'
            yield 'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"Hà Nội\\"}"}}]}}]}'
            yield "data: [DONE]"

    class Client:
        def __init__(self, **kwargs):
            del kwargs

        def stream(self, method, endpoint, *, headers, json):
            del method, endpoint, headers, json
            return Response()

        async def aclose(self):
            pass

    monkeypatch.setattr("veetee_server.providers.httpx.AsyncClient", Client)
    provider = GroqLLM(
        {"endpoint": "https://example.invalid/v1/chat/completions", "model": "configured-model"},
        None,
        types.SimpleNamespace(resolve=lambda reference_id: "key-from-manager"),
        ["secret-1"],
    )

    deltas = [delta async for delta in provider.stream(prompt="weather", locale="vi-VN", tools=[{"name": "get_weather"}])]

    assert [(delta.tool_name, delta.tool_arguments) for delta in deltas[:-1]] == [
        ("get_weather", ""),
        (None, '{"city":'),
        (None, '"Hà Nội"}'),
    ]
    assert deltas[-1].final is True
    await provider.close()


@pytest.mark.asyncio
async def test_test_only_groq_key_pool_rotates_after_pre_stream_rate_limit(tmp_path, monkeypatch):
    key_file = tmp_path / "groq.keys"
    key_file.write_text("FIRST=test-key-one\nSECOND=test-key-two\n", encoding="utf-8")
    assert GroqTestKeyPool(key_file).count == 2
    calls: list[str] = []

    class Response:
        def __init__(self, status_code: int):
            self.status_code = status_code

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"Xin chào"}}]}'
            yield "data: [DONE]"

    responses = [Response(429), Response(200), Response(200)]

    class Client:
        def __init__(self, **kwargs):
            del kwargs

        def stream(self, method, endpoint, *, headers, json):
            del method, endpoint, json
            calls.append(headers["Authorization"])
            return responses.pop(0)

        async def aclose(self):
            pass

    monkeypatch.setattr("veetee_server.providers.httpx.AsyncClient", Client)
    provider = GroqLLM(
        {"endpoint": "https://example.invalid/v1/chat/completions", "model": "configured-model"},
        None,
        None,
        [],
        test_key_file=key_file,
    )

    first = [delta async for delta in provider.stream(prompt="một", locale="vi-VN", tools=[])]
    second = [delta async for delta in provider.stream(prompt="hai", locale="vi-VN", tools=[])]

    assert first[0].text == "Xin chào"
    assert second[0].text == "Xin chào"
    assert calls == ["Bearer test-key-one", "Bearer test-key-two", "Bearer test-key-one"]
    await provider.close()


@pytest.mark.asyncio
async def test_test_only_groq_key_pool_never_replays_partial_stream(tmp_path, monkeypatch):
    key_file = tmp_path / "groq.keys"
    key_file.write_text("one\ntwo\n", encoding="utf-8")
    calls: list[str] = []

    class Response:
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"một phần"}}]}'
            raise httpx.ReadError("stream interrupted", request=httpx.Request("POST", "https://example.invalid"))

    class Client:
        def __init__(self, **kwargs):
            del kwargs

        def stream(self, method, endpoint, *, headers, json):
            del method, endpoint, json
            calls.append(headers["Authorization"])
            return Response()

        async def aclose(self):
            pass

    monkeypatch.setattr("veetee_server.providers.httpx.AsyncClient", Client)
    provider = GroqLLM(
        {"endpoint": "https://example.invalid/v1/chat/completions", "model": "configured-model"},
        None,
        None,
        [],
        test_key_file=key_file,
    )

    with pytest.raises(ProviderError, match="Groq request failed"):
        _ = [delta async for delta in provider.stream(prompt="một", locale="vi-VN", tools=[])]
    assert calls == ["Bearer one"]
    await provider.close()


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


def test_provider_snapshot_rejects_fallback_shape_before_activation(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["tts"]["config"]["fallbackProviderId"] = "veetee.tts.fixture-tone"
    fixture = tmp_path / "fallback.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")

    with pytest.raises(ConfigurationError, match="provider fallback is unsupported"):
        ProviderRegistry(load_snapshot(fixture))


def test_optional_provider_selection_reports_typed_shape_errors(tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["intent"] = {"config": {"rules": []}}
    missing_id = tmp_path / "missing-provider-id.json"
    missing_id.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ConfigurationError, match="providerId missing or empty"):
        ProviderRegistry(load_snapshot(missing_id))

    source["providers"]["intent"] = {"providerId": "veetee.intent.patterns", "config": {"rules": []}, "secretRefs": [3]}
    malformed_refs = tmp_path / "malformed-secret-refs.json"
    malformed_refs.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(ConfigurationError, match="secretRefs must be a non-empty string array"):
        ProviderRegistry(load_snapshot(malformed_refs))


def test_provider_entry_point_contract_rejects_invalid_metadata(monkeypatch):
    class EntryPoint:
        group = "veetee.providers"
        name = "broken.provider"

        def load(self):
            return lambda config, context: (config, context)

    monkeypatch.setattr("veetee_server.providers.importlib_metadata.entry_points", lambda: [EntryPoint()])
    with pytest.raises(ConfigurationError, match="metadata is invalid"):
        discover_provider_factories()


def test_provider_entry_point_contract_rejects_duplicate_identity(monkeypatch):
    @provider_factory("vad", "duplicate.provider")
    def first(config, context):
        del config, context
        return object()

    @provider_factory("vad", "duplicate.provider")
    def second(config, context):
        del config, context
        return object()

    class EntryPoint:
        group = "veetee.providers"
        name = "duplicate.provider"

        def __init__(self, factory):
            self.factory = factory

        def load(self):
            return self.factory

    monkeypatch.setattr("veetee_server.providers.importlib_metadata.entry_points", lambda: [EntryPoint(first), EntryPoint(second)])
    with pytest.raises(ConfigurationError, match="duplicate provider entry point"):
        discover_provider_factories()


def test_external_provider_entry_point_is_selected_without_registry_branch(monkeypatch, tmp_path):
    source = json.loads((Path(__file__).parents[1] / "config/fixtures/m0.json").read_text(encoding="utf-8"))
    source["providers"]["vad"] = {"providerId": "test.vad.external", "config": {"threshold": 0.5}}
    fixture = tmp_path / "external-provider.json"
    fixture.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")

    class ExternalVAD:
        def reset(self):
            pass

        def accept(self, pcm, sample_rate):
            del pcm, sample_rate
            return False

        def endpoint(self):
            return False

    @provider_factory("vad", "test.vad.external")
    def external_factory(config, context):
        assert config == {"threshold": 0.5}
        assert context.secret_refs == ()
        return ExternalVAD()

    original = discover_provider_factories()
    monkeypatch.setattr("veetee_server.providers.discover_provider_factories", lambda: {**original, ("vad", "test.vad.external"): external_factory})
    registry = ProviderRegistry(load_snapshot(fixture))
    try:
        assert isinstance(registry.vad, ExternalVAD)
    finally:
        import asyncio

        asyncio.run(registry.close())
