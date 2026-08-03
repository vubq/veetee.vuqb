#!/usr/bin/env python3
"""Run Veetee's project-local PostgreSQL instance without a system service."""

from __future__ import annotations

import os
from pathlib import Path
import signal
import socket
import subprocess
import time


def main() -> int:
    bin_dir = Path(required("VEETEE_POSTGRES_BIN_DIR"))
    lib_dir = Path(required("VEETEE_POSTGRES_LIB_DIR"))
    data_dir = Path(required("VEETEE_POSTGRES_DATA_DIR"))
    socket_dir = Path(required("VEETEE_POSTGRES_SOCKET_DIR"))
    host = os.environ.get("VEETEE_POSTGRES_HOST", "127.0.0.1")
    port = int(os.environ.get("VEETEE_POSTGRES_PORT", "55432"))
    user = identifier(os.environ.get("VEETEE_POSTGRES_USER", "veetee"))
    database = identifier(os.environ.get("VEETEE_POSTGRES_DATABASE", "veetee_vubq"))
    data_dir.parent.mkdir(parents=True, exist_ok=True)
    socket_dir.mkdir(parents=True, exist_ok=True)

    initdb = bin_dir / "initdb"
    postgres = bin_dir / "postgres"
    psql = bin_dir / "psql"
    createdb = bin_dir / "createdb"
    for executable in (initdb, postgres, psql, createdb):
        if not executable.is_file():
            raise RuntimeError(f"PostgreSQL executable is missing: {executable}")

    environment = os.environ.copy()
    environment["LD_LIBRARY_PATH"] = f"{lib_dir}:{environment.get('LD_LIBRARY_PATH', '')}".rstrip(":")
    if not (data_dir / "PG_VERSION").exists():
        subprocess.run([str(initdb), "-D", str(data_dir), "--username", user, "--auth-host", "trust", "--auth-local", "trust", "--no-locale", "--encoding", "UTF8"], check=True, env=environment, stdout=subprocess.DEVNULL)

    child = subprocess.Popen([str(postgres), "-D", str(data_dir), "-p", str(port), "-h", host, "-k", str(socket_dir)], env=environment)
    stopped = False

    def stop(_signum: int, _frame: object) -> None:
        nonlocal stopped
        stopped = True
        if child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        wait_for_tcp(host, port, child)
        ensure_database(psql, createdb, environment, host, port, user, database)
        print(f"{{\"status\":\"ready\",\"database\":\"{database}\",\"host\":\"{host}\",\"port\":{port}}}", flush=True)
        while not stopped:
            result = child.poll()
            if result is not None:
                return result
            time.sleep(0.5)
        child.wait(timeout=10)
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
    return 0


def wait_for_tcp(host: str, port: int, child: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("PostgreSQL exited before becoming ready")
        try:
            with socket.create_connection((host, port), timeout=1):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError("timed out waiting for project-local PostgreSQL")


def ensure_database(psql: Path, createdb: Path, environment: dict[str, str], host: str, port: int, user: str, database: str) -> None:
    check = subprocess.run([str(psql), "-h", host, "-p", str(port), "-U", user, "-d", "postgres", "-Atqc", f"select 1 from pg_database where datname = '{database}'"], check=True, env=environment, capture_output=True, text=True)
    if check.stdout.strip() == "1":
        return
    subprocess.run([str(createdb), "-h", host, "-p", str(port), "-U", user, database], check=True, env=environment, stdout=subprocess.DEVNULL)


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing environment variable: {name}")
    return value


def identifier(value: str) -> str:
    if not value or not value.replace("_", "a").isalnum() or not (value[0].isalpha() or value[0] == "_"):
        raise ValueError(f"invalid PostgreSQL identifier: {value!r}")
    return value


if __name__ == "__main__":
    raise SystemExit(main())
