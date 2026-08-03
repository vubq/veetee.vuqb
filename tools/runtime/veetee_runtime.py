#!/usr/bin/env python3
"""Small host-native process supervisor driven entirely by a JSON manifest."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


class ManifestError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ServiceSpec:
    name: str
    command: tuple[str, ...]
    cwd: Path
    dependencies: tuple[str, ...]
    health_url: str | None
    health_tcp: tuple[str, int] | None
    ready_timeout_s: float
    wait_for_exit: bool
    environment: dict[str, str]


class RuntimeSupervisor:
    def __init__(self, manifest_path: Path) -> None:
        self.manifest_path = manifest_path
        self.root = manifest_path.resolve().parents[3]
        self.specs = self._load()
        self.processes: dict[str, subprocess.Popen[bytes]] = {}

    def _load(self) -> list[ServiceSpec]:
        try:
            raw = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError("cannot read runtime manifest") from exc
        if not isinstance(raw, dict) or raw.get("schemaVersion") != 1:
            raise ManifestError("manifest schemaVersion must be 1")
        values = raw.get("services")
        if not isinstance(values, list) or not values:
            raise ManifestError("manifest.services must be non-empty")
        specs: list[ServiceSpec] = []
        names: set[str] = set()
        for value in values:
            if not isinstance(value, dict):
                raise ManifestError("service entry must be an object")
            name = value.get("name")
            command = value.get("command")
            if not isinstance(name, str) or not name or name in names:
                raise ManifestError("service names must be unique non-empty strings")
            if not isinstance(command, list) or not command or not all(isinstance(part, str) for part in command):
                raise ManifestError(f"{name}: command must be argv array")
            if any(";" in part or "&&" in part or "|" in part for part in command):
                raise ManifestError(f"{name}: shell operators are not allowed")
            cwd = Path(_expand(str(value.get("cwd", ".")), self.root)).resolve()
            health_url = value.get("healthUrl")
            if health_url is not None and not isinstance(health_url, str):
                raise ManifestError(f"{name}: healthUrl must be string or null")
            health_tcp_raw = value.get("healthTcp")
            health_tcp: tuple[str, int] | None = None
            if health_tcp_raw is not None:
                if not isinstance(health_tcp_raw, dict) or not isinstance(health_tcp_raw.get("host"), str) or not isinstance(health_tcp_raw.get("port"), int) or not 1 <= health_tcp_raw["port"] <= 65535:
                    raise ManifestError(f"{name}: healthTcp must contain host and integer port")
                if health_url is not None:
                    raise ManifestError(f"{name}: healthUrl and healthTcp are mutually exclusive")
                health_tcp = (health_tcp_raw["host"], health_tcp_raw["port"])
            env = value.get("environment", {})
            if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
                raise ManifestError(f"{name}: environment must be string map")
            deps = value.get("dependencies", [])
            if not isinstance(deps, list) or not all(isinstance(dep, str) for dep in deps):
                raise ManifestError(f"{name}: dependencies must be string array")
            wait_for_exit = value.get("waitForExit", False)
            if not isinstance(wait_for_exit, bool):
                raise ManifestError(f"{name}: waitForExit must be boolean")
            specs.append(ServiceSpec(name, tuple(_expand(part, self.root) for part in command), cwd, tuple(deps), health_url, health_tcp, float(value.get("readyTimeoutSeconds", 20)), wait_for_exit, {k: _expand(v, self.root) for k, v in env.items()}))
            names.add(name)
        by_name = {spec.name for spec in specs}
        for spec in specs:
            missing = set(spec.dependencies) - by_name
            if missing:
                raise ManifestError(f"{spec.name}: missing dependencies {sorted(missing)}")
        return specs

    def start(self) -> None:
        for spec in self._order():
            env = os.environ.copy()
            env.update(spec.environment)
            env = _with_node_path(env)
            env.setdefault("PYTHONUNBUFFERED", "1")
            process = subprocess.Popen(
                list(spec.command),
                cwd=spec.cwd,
                env=env,
                start_new_session=True,
                stdout=None,
                stderr=None,
            )
            self.processes[spec.name] = process
            if spec.health_url or spec.health_tcp:
                self._wait_ready(spec, process)
            if spec.wait_for_exit:
                try:
                    result = process.wait(timeout=spec.ready_timeout_s)
                except subprocess.TimeoutExpired as exc:
                    raise TimeoutError(f"one-shot service timeout: {spec.name}") from exc
                if result != 0:
                    raise RuntimeError(f"one-shot service failed: {spec.name} ({result})")

    def stop(self) -> None:
        for name, process in reversed(list(self.processes.items())):
            if process.poll() is not None:
                continue
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                continue
        deadline = time.monotonic() + 10
        for process in self.processes.values():
            remaining = max(0, deadline - time.monotonic())
            try:
                process.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def status(self) -> dict[str, object]:
        return {"services": [{"name": spec.name, "pid": self.processes.get(spec.name).pid if spec.name in self.processes else None, "running": self.processes.get(spec.name) is not None and self.processes[spec.name].poll() is None} for spec in self.specs]}

    def _wait_ready(self, spec: ServiceSpec, process: subprocess.Popen[bytes]) -> None:
        if spec.health_url is None and spec.health_tcp is None:
            return
        deadline = time.monotonic() + spec.ready_timeout_s
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"service exited before readiness: {spec.name}")
            if spec.health_url:
                try:
                    with urlopen(Request(spec.health_url, headers={"Accept": "*/*"}), timeout=1) as response:
                        if 200 <= response.status < 300:
                            return
                except (URLError, TimeoutError, OSError):
                    pass
            elif spec.health_tcp:
                try:
                    with socket.create_connection(spec.health_tcp, timeout=1):
                        return
                except OSError:
                    pass
            time.sleep(0.1)
        raise TimeoutError(f"service readiness timeout: {spec.name} {spec.health_url}")

    def _order(self) -> list[ServiceSpec]:
        by_name = {spec.name: spec for spec in self.specs}
        visiting: set[str] = set()
        visited: set[str] = set()
        ordered: list[ServiceSpec] = []

        def visit(name: str) -> None:
            if name in visited:
                return
            if name in visiting:
                raise ManifestError("dependency cycle detected")
            visiting.add(name)
            for dep in by_name[name].dependencies:
                visit(dep)
            visiting.remove(name)
            visited.add(name)
            ordered.append(by_name[name])

        for spec in self.specs:
            visit(spec.name)
        return ordered


def _expand(value: str, root: Path) -> str:
    return value.replace("${VEETEE_ROOT}", str(root)).replace("${PYTHON}", sys.executable)


def _with_node_path(environment: dict[str, str]) -> dict[str, str]:
    """Make host-installed Node tools available to non-interactive services.

    User systemd services commonly receive a minimal PATH and therefore do not
    inherit an interactive nvm activation.  Prefer the explicit deployment
    override, then the current PATH, then the user's nvm installation.  The
    returned mapping is a copy so a service-specific environment cannot mutate
    the supervisor process environment.
    """

    result = dict(environment)
    path = result.get("PATH", os.defpath)
    node_bin = _configured_node_bin(result)
    if node_bin is None:
        npm_path = shutil.which("npm", path=path)
        if npm_path:
            node_bin = str(Path(npm_path).resolve().parent)
    if node_bin is None:
        node_bin = _discover_nvm_node_bin(result)
    if node_bin and node_bin not in path.split(os.pathsep):
        result["PATH"] = f"{node_bin}{os.pathsep}{path}"
    return result


def _configured_node_bin(environment: dict[str, str]) -> str | None:
    configured = environment.get("VEETEE_NODE_BIN")
    if not configured:
        return None
    candidate = Path(configured).expanduser()
    if candidate.is_file():
        candidate = candidate.parent
    if (candidate / "npm").is_file():
        return str(candidate.resolve())
    return None


def _discover_nvm_node_bin(environment: dict[str, str]) -> str | None:
    home = Path(environment.get("HOME", str(Path.home()))).expanduser()
    nvm_root = Path(environment.get("NVM_DIR", str(home / ".nvm"))).expanduser()
    versions_root = nvm_root / "versions" / "node"
    if not versions_root.is_dir():
        return None
    for version_dir in sorted(versions_root.iterdir(), key=_node_version_key, reverse=True):
        candidate = version_dir / "bin"
        if (candidate / "npm").is_file():
            return str(candidate.resolve())
    return None


def _node_version_key(path: Path) -> tuple[int, int, int, str]:
    match = re.match(r"^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", path.name)
    if match is None:
        return (-1, -1, -1, path.name)
    major, minor, patch = (int(part or 0) for part in match.groups())
    return (major, minor, patch, path.name)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    supervisor = RuntimeSupervisor(args.manifest)
    try:
        supervisor.start()
        print(json.dumps(supervisor.status(), ensure_ascii=False), flush=True)
        if args.once:
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        return 0
    finally:
        supervisor.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
