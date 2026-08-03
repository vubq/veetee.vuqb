#!/usr/bin/env python3
"""Stage PostgreSQL binaries in .runtime without installing a system service."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="16")
    args = parser.parse_args()
    if args.version != "16":
        raise SystemExit("Veetee currently pins the Ubuntu 24.04 PostgreSQL 16 runtime")
    root = Path(__file__).resolve().parents[2]
    package_dir = root / ".runtime" / "postgres-pkg"
    tools_dir = root / ".runtime" / "postgres-tools"
    package_dir.mkdir(parents=True, exist_ok=True)
    tools_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["apt-get", "download", "postgresql-16", "postgresql-client-16", "libpq5"], cwd=package_dir, check=True)
    for package in sorted(package_dir.glob("*.deb")):
        subprocess.run(["dpkg-deb", "-x", str(package), str(tools_dir)], check=True)
    print(f"staged PostgreSQL 16 binaries under {tools_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
