#!/usr/bin/env python3
"""Create an owner-only random secret file without printing its value."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import secrets
import stat


def ensure_secret(path: Path, *, byte_count: int = 32) -> None:
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"secret path is not a non-empty file: {path}")
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o077:
            raise RuntimeError(f"secret file permissions are too broad: {path}")
        return
    value = secrets.token_urlsafe(byte_count)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            descriptor = -1
            handle.write(value)
            handle.write("\n")
    finally:
        if descriptor != -1:
            os.close(descriptor)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=Path, required=True)
    args = parser.parse_args()
    ensure_secret(args.path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
