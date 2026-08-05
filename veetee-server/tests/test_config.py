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


def test_barge_in_policy_defaults_to_legacy_realtime_only(monkeypatch):
    _set_fixture_env(monkeypatch)
    from veetee_server.config import load_snapshot

    policy = load_snapshot(FIXTURE).barge_in_policy()

    assert policy.enabled is True
    assert policy.device_duplex is False
    assert policy.min_speech_frames == 2
    assert policy.cooldown_ms == 0


def test_barge_in_policy_defaults_cooldown_for_device_duplex(tmp_path):
    import json
    from veetee_server.config import load_snapshot

    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["bargeIn"] = {"deviceDuplex": True}
    path = tmp_path / "device-duplex-barge.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    policy = load_snapshot(path).barge_in_policy()

    assert policy.cooldown_ms == 2_000


def test_conversation_policy_is_bounded_and_configurable(tmp_path):
    import json
    from veetee_server.config import load_snapshot

    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["conversation"] = {
        "continuous": True,
        "idleTimeoutMs": 180000,
        "idleAlert": {"status": "ok", "message": "Mình sẽ chờ bạn gọi lại.", "emotion": "neutral"},
    }
    path = tmp_path / "conversation.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    policy = load_snapshot(path).conversation_policy()

    assert policy.continuous is True
    assert policy.idle_timeout_ms == 180000


def test_conversation_policy_rejects_empty_idle_message_when_enabled(tmp_path):
    import json
    from veetee_server.config import ConfigurationError, load_snapshot

    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["conversation"] = {"continuous": True, "idleAlert": {"message": ""}}
    path = tmp_path / "conversation-invalid.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(ConfigurationError, match="conversation.idleAlert.message"):
        load_snapshot(path).conversation_policy()


@pytest.mark.parametrize("field,value", [("enabled", "bad"), ("deviceDuplex", 1), ("minSpeechFrames", 0), ("minSpeechFrames", 33), ("cooldownMs", -1), ("cooldownMs", 5001)])
def test_barge_in_policy_rejects_invalid_values(tmp_path, field, value):
    import json
    from veetee_server.config import load_snapshot

    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["bargeIn"] = {field: value}
    path = tmp_path / "invalid-barge.json"
    path.write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(ConfigurationError, match="snapshot.bargeIn"):
        load_snapshot(path).barge_in_policy()
