import json
import os
from pathlib import Path

import pytest

from ensure_secret import ensure_secret
from veetee_runtime import ManifestError, RuntimeSupervisor, _with_node_path


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


def test_runtime_discovers_nvm_node_for_minimal_service_path(tmp_path):
    node_bin = tmp_path / ".nvm" / "versions" / "node" / "v24.18.0" / "bin"
    node_bin.mkdir(parents=True)
    npm = node_bin / "npm"
    npm.write_text("#!/bin/sh\n", encoding="utf-8")
    npm.chmod(0o755)
    legacy_bin = tmp_path / ".nvm" / "versions" / "node" / "v9.9.9" / "bin"
    legacy_bin.mkdir(parents=True)
    (legacy_bin / "npm").write_text("#!/bin/sh\n", encoding="utf-8")
    (legacy_bin / "npm").chmod(0o755)

    result = _with_node_path({"HOME": str(tmp_path), "PATH": "/usr/bin"})

    assert result["PATH"].split(os.pathsep)[0] == str(node_bin)


def test_runtime_node_bin_override_wins_over_nvm(tmp_path):
    explicit_bin = tmp_path / "node-bin"
    explicit_bin.mkdir()
    (explicit_bin / "npm").write_text("#!/bin/sh\n", encoding="utf-8")
    (explicit_bin / "npm").chmod(0o755)
    nvm_bin = tmp_path / ".nvm" / "versions" / "node" / "v24.18.0" / "bin"
    nvm_bin.mkdir(parents=True)
    (nvm_bin / "npm").write_text("#!/bin/sh\n", encoding="utf-8")
    (nvm_bin / "npm").chmod(0o755)

    result = _with_node_path(
        {"HOME": str(tmp_path), "PATH": "/usr/bin", "VEETEE_NODE_BIN": str(explicit_bin)}
    )

    assert result["PATH"].split(os.pathsep)[0] == str(explicit_bin)


def test_runtime_preserves_bin_parent_for_symlinked_npm(tmp_path):
    node_bin = tmp_path / "node" / "bin"
    npm_target = tmp_path / "node" / "lib" / "node_modules" / "npm" / "bin"
    node_bin.mkdir(parents=True)
    npm_target.mkdir(parents=True)
    (npm_target / "npm-cli.js").write_text("#!/usr/bin/env node\n", encoding="utf-8")
    (npm_target / "npm-cli.js").chmod(0o755)
    (node_bin / "npm").symlink_to("../lib/node_modules/npm/bin/npm-cli.js")

    result = _with_node_path({"HOME": str(tmp_path), "PATH": str(node_bin)})

    assert result["PATH"].split(os.pathsep)[0] == str(node_bin)


def test_ensure_secret_is_owner_only_and_idempotent(tmp_path):
    path = tmp_path / "manager.machine-token"
    ensure_secret(path)
    first = path.read_text(encoding="utf-8")
    assert first.strip()
    assert path.stat().st_mode & 0o077 == 0
    ensure_secret(path)
    assert path.read_text(encoding="utf-8") == first


def test_ensure_secret_rejects_broad_existing_permissions(tmp_path):
    path = tmp_path / "manager.machine-token"
    path.write_text("existing\n", encoding="utf-8")
    path.chmod(0o640)
    with pytest.raises(RuntimeError, match="permissions"):
        ensure_secret(path)
