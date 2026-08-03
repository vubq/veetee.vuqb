#!/usr/bin/env python3
"""Test-only Groq probe; never used by the production provider registry."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keys-file", type=Path, default=Path("secrets/groq.keys"))
    parser.add_argument("--model", required=True, help="Model ID returned by the provider capability probe")
    args = parser.parse_args()
    keys = load_keys(args.keys_file)
    print(json.dumps({"keysLoaded": len(keys), "mode": "test-only"}))
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
