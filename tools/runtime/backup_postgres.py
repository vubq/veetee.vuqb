#!/usr/bin/env python3
"""Create and optionally rehearse a PostgreSQL custom-format backup.

The command never prints the DSN or backup contents. Rehearsal restores into a
random temporary database and drops only that explicitly-created database.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit


def _read_secret(path: Path) -> str:
    value = path.expanduser().read_text(encoding="utf-8").strip()
    if not value:
        raise RuntimeError("database URL file is empty")
    return value


def _run(argv: list[str], *, capture: bool = False, environment: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(argv, check=True, text=True, env=environment, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.PIPE if capture else subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError) as error:
        name = Path(argv[0]).name if argv else "command"
        code = getattr(error, "returncode", "unavailable")
        raise RuntimeError(f"{name} failed with exit status {code}") from error


def _tool(bin_dir: Path, name: str) -> Path:
    path = bin_dir / name
    if not path.is_file():
        raise RuntimeError(f"PostgreSQL tool is missing: {name}")
    return path


def _environment(bin_dir: Path) -> dict[str, str]:
    environment = os.environ.copy()
    lib_dir = bin_dir.parents[2] / "x86_64-linux-gnu"
    if lib_dir.is_dir():
        environment["LD_LIBRARY_PATH"] = f"{lib_dir}:{environment.get('LD_LIBRARY_PATH', '')}".rstrip(":")
    return environment


def _temporary_database_url(database_url: str, database: str) -> str:
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.netloc:
        raise RuntimeError("database URL must be a PostgreSQL URI for restore rehearsal")
    return urlunsplit((parsed.scheme, parsed.netloc, f"/{database}", parsed.query, parsed.fragment))


def create_backup(database_url_file: Path, output: Path, *, bin_dir: Path, rehearse: bool) -> dict[str, object]:
    database_url = _read_secret(database_url_file)
    output = output.expanduser().resolve()
    if output.exists():
        raise RuntimeError(f"backup output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    pg_dump = _tool(bin_dir, "pg_dump")
    pg_restore = _tool(bin_dir, "pg_restore")
    psql = _tool(bin_dir, "psql")
    environment = _environment(bin_dir)
    _run([str(pg_dump), "--format=custom", "--no-owner", "--file", str(output), database_url], environment=environment)
    output.chmod(stat.S_IRUSR | stat.S_IWUSR)
    if output.stat().st_size == 0:
        raise RuntimeError("backup output is empty")
    _run([str(pg_restore), "--list", str(output)], environment=environment)
    restored = False
    if rehearse:
        temp_database = f"veetee_restore_{secrets.token_hex(5)}"
        maintenance_url = _temporary_database_url(database_url, "postgres")
        restore_url = _temporary_database_url(database_url, temp_database)
        try:
            _run([str(psql), maintenance_url, "-v", "ON_ERROR_STOP=1", "-Atqc", f'CREATE DATABASE "{temp_database}"'], environment=environment)
            _run([str(pg_restore), "--no-owner", "--dbname", restore_url, str(output)], environment=environment)
            check = _run([str(psql), restore_url, "-Atqc", "select to_regnamespace('veetee_manager') is not null"], capture=True, environment=environment)
            if check.stdout.strip() != "t":
                raise RuntimeError("restore rehearsal did not recreate veetee_manager schema")
            restored = True
        finally:
            _run([str(psql), maintenance_url, "-v", "ON_ERROR_STOP=1", "-Atqc", f'DROP DATABASE IF EXISTS "{temp_database}"'], environment=environment)
    return {"backup": str(output), "bytes": output.stat().st_size, "restored": restored}


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url-file", type=Path, default=root / "secrets/manager.database-url")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--pg-bin-dir", type=Path, default=Path(os.environ.get("VEETEE_POSTGRES_BIN_DIR", str(root / ".runtime/postgres-tools/usr/lib/postgresql/16/bin"))))
    parser.add_argument("--rehearse", action="store_true")
    args = parser.parse_args()
    output = args.output or root / ".runtime/backups" / f"veetee_vubq-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.dump"
    try:
        result = create_backup(args.database_url_file, output, bin_dir=args.pg_bin_dir, rehearse=args.rehearse)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError) as error:
        print(f"backup: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
