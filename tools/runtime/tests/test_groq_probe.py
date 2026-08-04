import importlib.util
from pathlib import Path


def _module():
    path = Path(__file__).parents[2] / "groq_probe.py"
    spec = importlib.util.spec_from_file_location("veetee_groq_probe", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_stream_text_delta_accepts_text_and_ignores_non_text_events():
    probe = _module()
    assert probe.stream_text_delta('data: {"choices":[{"delta":{"content":"Xin"}}]}') == "Xin"
    assert probe.stream_text_delta('data: {"choices":[{"delta":{"tool_calls":[{}]}}]}') is None
    assert probe.stream_text_delta("data: [DONE]") is None
    assert probe.stream_text_delta("event: ping") is None


def test_stream_text_delta_fails_closed_on_malformed_or_unexpected_payload():
    probe = _module()
    assert probe.stream_text_delta("data: not-json") is None
    assert probe.stream_text_delta('data: {"choices": []}') is None
    assert probe.stream_text_delta('data: {"choices":[{"delta":{"content":""}}]}') is None


def test_load_keys_ignores_comments_and_empty_lines(tmp_path):
    probe = _module()
    path = tmp_path / "keys"
    path.write_text("# comment\nKEY=one\n\n two \n", encoding="utf-8")
    assert probe.load_keys(path) == ["one", "two"]
