from pathlib import Path

import pytest

from veetee_server.config import ConfigurationError, ServerConfig


FIXTURE = Path(__file__).parents[1] / "config/fixtures/m0.json"


def _set_fixture_env(monkeypatch) -> None:
    monkeypatch.setenv("VEETEE_CONFIG_SOURCE", "fixture")
    monkeypatch.setenv("VEETEE_CONFIG_FIXTURE_FILE", str(FIXTURE))


def test_hello_timeout_defaults_to_ten_seconds(monkeypatch):
    _set_fixture_env(monkeypatch)
    monkeypatch.delenv("VEETEE_HELLO_TIMEOUT_MS", raising=False)

    config = ServerConfig.from_env()

    assert config.hello_timeout_ms == 10_000


@pytest.mark.parametrize("value", ["999", "60001", "not-an-int"])
def test_hello_timeout_is_bounded(monkeypatch, value):
    _set_fixture_env(monkeypatch)
    monkeypatch.setenv("VEETEE_HELLO_TIMEOUT_MS", value)

    with pytest.raises(ConfigurationError, match="VEETEE_HELLO_TIMEOUT_MS"):
        ServerConfig.from_env()
