#!/usr/bin/env python3
"""Small host-native process supervisor driven entirely by a JSON manifest."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import signal
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
    ready_timeout_s: float
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
            env = value.get("environment", {})
            if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
                raise ManifestError(f"{name}: environment must be string map")
            deps = value.get("dependencies", [])
            if not isinstance(deps, list) or not all(isinstance(dep, str) for dep in deps):
                raise ManifestError(f"{name}: dependencies must be string array")
            specs.append(ServiceSpec(name, tuple(_expand(part, self.root) for part in command), cwd, tuple(deps), health_url, float(value.get("readyTimeoutSeconds", 20)), {k: _expand(v, self.root) for k, v in env.items()}))
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
            if spec.health_url:
                self._wait_ready(spec, process)

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
        assert spec.health_url is not None
        deadline = time.monotonic() + spec.ready_timeout_s
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f"service exited before readiness: {spec.name}")
            try:
                with urlopen(Request(spec.health_url, headers={"Accept": "*/*"}), timeout=1) as response:
                    if 200 <= response.status < 300:
                        return
            except (URLError, TimeoutError, OSError):
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
