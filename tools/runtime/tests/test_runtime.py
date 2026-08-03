import json
from pathlib import Path

import pytest

from veetee_runtime import ManifestError, RuntimeSupervisor


def write_manifest(tmp_path: Path, services):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"schemaVersion": 1, "services": services}), encoding="utf-8")
    return path


def test_manifest_orders_dependencies(tmp_path):
    path = write_manifest(
        tmp_path,
        [
            {"name": "web", "command": ["python3", "-c", "pass"], "dependencies": ["api"]},
            {"name": "api", "command": ["python3", "-c", "pass"], "dependencies": []},
        ],
    )
    supervisor = RuntimeSupervisor(path)
    assert [spec.name for spec in supervisor._order()] == ["api", "web"]


def test_manifest_rejects_shell_command(tmp_path):
    path = write_manifest(tmp_path, [{"name": "bad", "command": ["sh", "-c", "echo ok; rm -rf /"]}])
    with pytest.raises(ManifestError):
        RuntimeSupervisor(path)


def test_manifest_rejects_cycle(tmp_path):
    path = write_manifest(
        tmp_path,
        [
            {"name": "a", "command": ["python3"], "dependencies": ["b"]},
            {"name": "b", "command": ["python3"], "dependencies": ["a"]},
        ],
    )
    with pytest.raises(ManifestError, match="cycle"):
        RuntimeSupervisor(path)._order()


def test_manifest_accepts_tcp_readiness_probe(tmp_path):
    path = write_manifest(tmp_path, [{"name": "db", "command": ["python3"], "healthTcp": {"host": "127.0.0.1", "port": 55432}}])
    spec = RuntimeSupervisor(path).specs[0]
    assert spec.health_url is None
    assert spec.health_tcp == ("127.0.0.1", 55432)


def test_manifest_accepts_one_shot_service(tmp_path):
    path = write_manifest(tmp_path, [{"name": "migration", "command": ["python3"], "waitForExit": True}])
    assert RuntimeSupervisor(path).specs[0].wait_for_exit is True
