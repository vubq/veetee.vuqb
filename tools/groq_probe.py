#!/usr/bin/env python3
"""Test-only Groq probe; never used by the production provider registry."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from typing import Any

import httpx


def load_keys(path: Path) -> list[str]:
    values: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        value = line.split("=", 1)[1] if "=" in line else line
        if value.strip():
            values.append(value.strip())
    return values


def _stream_event(line: str) -> dict[str, Any] | None:
    if not line.startswith("data: "):
        return None
    payload = line[6:].strip()
    if not payload or payload == "[DONE]":
        return None
    try:
        value: Any = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def stream_text_delta(line: str) -> str | None:
    """Return meaningful text from one OpenAI-compatible SSE line.

    Tool-call deltas and the terminal ``[DONE]`` marker are intentionally not
    counted as first meaningful text.  The probe never returns provider text;
    it only uses this helper for timing/boolean fields.
    """

    value = _stream_event(line)
    if value is None:
        return None
    choices = value.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return None
    delta = choices[0].get("delta")
    if not isinstance(delta, dict):
        return None
    content = delta.get("content")
    return content if isinstance(content, str) and content else None


def stream_tool_delta(line: str) -> tuple[str | None, str | None]:
    """Return one streamed function name/argument fragment, if present."""

    value = _stream_event(line)
    if value is None:
        return None, None
    choices = value.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return None, None
    delta = choices[0].get("delta")
    if not isinstance(delta, dict):
        return None, None
    calls = delta.get("tool_calls")
    if not isinstance(calls, list) or not calls or not isinstance(calls[0], dict):
        return None, None
    function = calls[0].get("function")
    if not isinstance(function, dict):
        return None, None
    name = function.get("name")
    arguments = function.get("arguments")
    return (
        name if isinstance(name, str) and name else None,
        arguments if isinstance(arguments, str) and arguments else None,
    )


def probe_stream(key: str, model: str) -> dict[str, object]:
    started = time.perf_counter()
    first_token_ms: int | None = None
    chunks = 0
    status = 0
    try:
        with httpx.stream(
            "POST",
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Reply with one short Vietnamese greeting."}],
                "max_tokens": 24,
                "temperature": 0,
                "stream": True,
            },
            timeout=30,
        ) as response:
            status = response.status_code
            for line in response.iter_lines():
                delta = stream_text_delta(line)
                if delta is None:
                    continue
                chunks += 1
                if first_token_ms is None:
                    first_token_ms = round((time.perf_counter() - started) * 1000)
    except Exception as error:  # sanitized type only
        return {"status": status, "error": type(error).__name__}
    return {
        "status": status,
        "firstTokenMs": first_token_ms,
        "chunks": chunks,
        "hasResponse": first_token_ms is not None,
        "rateLimited": status == 429,
    }


def probe_tool_call(key: str, model: str) -> dict[str, object]:
    started = time.perf_counter()
    first_tool_ms: int | None = None
    function_name: str | None = None
    arguments = ""
    chunks = 0
    status = 0
    try:
        with httpx.stream(
            "POST",
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": "Gọi công cụ get_weather cho Hà Nội."}],
                "tools": [{
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Return weather for one city.",
                        "parameters": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                            "required": ["city"],
                        },
                    },
                }],
                "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
                "max_tokens": 64,
                "temperature": 0,
                "stream": True,
            },
            timeout=30,
        ) as response:
            status = response.status_code
            for line in response.iter_lines():
                name, fragment = stream_tool_delta(line)
                if name is None and fragment is None:
                    continue
                chunks += 1
                if first_tool_ms is None:
                    first_tool_ms = round((time.perf_counter() - started) * 1000)
                if name is not None:
                    function_name = name
                if fragment is not None:
                    arguments += fragment
    except Exception as error:  # sanitized type only
        return {"status": status, "error": type(error).__name__}
    try:
        parsed_arguments = json.loads(arguments) if arguments else None
    except json.JSONDecodeError:
        parsed_arguments = None
    return {
        "status": status,
        "firstToolMs": first_tool_ms,
        "toolChunks": chunks,
        "functionName": function_name,
        "argumentsBytes": len(arguments.encode("utf-8")),
        "argumentsValid": isinstance(parsed_arguments, dict),
        "rateLimited": status == 429,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keys-file", type=Path, default=Path("secrets/groq.keys"))
    parser.add_argument("--model", required=True, help="Model ID returned by the provider capability probe")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--stream", action="store_true", help="Measure first meaningful text in SSE stream")
    mode.add_argument("--tool-call", action="store_true", help="Measure streamed tool-call delta assembly")
    args = parser.parse_args()
    keys = load_keys(args.keys_file)
    print(json.dumps({"keysLoaded": len(keys), "mode": "test-only", "stream": args.stream, "toolCall": args.tool_call}))
    if args.tool_call:
        for index, key in enumerate(keys, start=1):
            result = probe_tool_call(key, args.model)
            print(json.dumps({"keyOrdinal": index, **result}))
        return 0
    if args.stream:
        for index, key in enumerate(keys, start=1):
            result = probe_stream(key, args.model)
            print(json.dumps({"keyOrdinal": index, **result}))
        return 0
    for index, key in enumerate(keys, start=1):
        try:
            started = time.perf_counter()
            response = httpx.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": args.model, "messages": [{"role": "user", "content": "Reply with one short Vietnamese greeting."}], "max_tokens": 24, "temperature": 0, "stream": False},
                timeout=30,
            )
            body = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            message = (((body.get("choices") or [{}])[0].get("message") or {}).get("content") or "") if isinstance(body, dict) else ""
            print(json.dumps({"keyOrdinal": index, "status": response.status_code, "latencyMs": round((time.perf_counter() - started) * 1000), "hasResponse": bool(message), "rateLimited": response.status_code == 429}))
        except Exception as error:  # sanitized type only
            print(json.dumps({"keyOrdinal": index, "error": type(error).__name__}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
