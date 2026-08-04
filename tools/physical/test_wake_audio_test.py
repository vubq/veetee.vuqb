from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

import wake_audio_test


class WakeAudioHarnessTest(unittest.TestCase):
    def test_example_scenario_resolves_no_reset_monitor_command(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        monitor = wake_audio_test.Monitor(scenario, verbose=False)
        self.assertIn("--no-reset", monitor.command)
        self.assertNotIn("flash", monitor.command)
        self.assertEqual(scenario.monitor_baud, 115200)

    def test_player_placeholder_is_argv_based(self) -> None:
        command = wake_audio_test._render_player(("pw-play", "{file}"), Path("/tmp/a clip.wav"))
        self.assertEqual(command, ["pw-play", "/tmp/a clip.wav"])

    def test_player_exit_captures_bounded_stderr_without_audio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "fixture.wav"
            clip.write_bytes(b"RIFF")
            process = wake_audio_test._start_player(
                (
                    sys.executable,
                    "-c",
                    "import sys; sys.stderr.write('player-ok\\n')",
                    "{file}",
                ),
                clip,
                allow_audio=True,
            )
            result = wake_audio_test._wait_player(process, clip, timeout_seconds=2)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stderr, "player-ok")
            self.assertGreaterEqual(result.duration_ms, 0)

    def test_player_exit_truncates_chatty_stderr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "fixture.wav"
            clip.write_bytes(b"RIFF")
            process = wake_audio_test._start_player(
                (
                    sys.executable,
                    "-c",
                    "import sys; sys.stderr.write('x' * 2048)",
                    "{file}",
                ),
                clip,
                allow_audio=True,
            )
            result = wake_audio_test._wait_player(process, clip, timeout_seconds=2)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(len(result.stderr), 515)
            self.assertTrue(result.stderr.endswith("..."))

    def test_repetitions_are_bounded_and_configured(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        self.assertEqual(scenario.repetitions, 1)
        self.assertAlmostEqual(scenario.inter_repetition_delay_seconds, 0.25)

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            scenario_file = base / "scenario.json"
            scenario_file.write_text(json.dumps({
                "monitor": {"command": ["never-run"], "projectDir": str(base), "serialPort": "/dev/null", "baud": 115200},
                "player": {"command": ["never-run", "{file}"]},
                "clips": {"wake": str(base / "wake.wav"), "utterance": str(base / "utterance.wav")},
                "repetitions": 4,
                "interRepetitionDelaySeconds": 0.75,
                "events": [{"name": "wake", "marker": "wake detected", "timeoutSeconds": 1}],
            }), encoding="utf-8")
            parsed = wake_audio_test.load_scenario(scenario_file)
            self.assertEqual(parsed.repetitions, 4)
            self.assertAlmostEqual(parsed.inter_repetition_delay_seconds, 0.75)

            document = json.loads(scenario_file.read_text(encoding="utf-8"))
            document["repetitions"] = 101
            scenario_file.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(wake_audio_test.HarnessError, "repetitions"):
                wake_audio_test.load_scenario(scenario_file)

    def test_barge_in_phase_is_optional_and_must_follow_final_stage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            scenario_file = base / "scenario.json"
            document = {
                "monitor": {"command": ["never-run"], "projectDir": str(base), "serialPort": "/dev/null", "baud": 115200},
                "player": {"command": ["never-run", "{file}"]},
                "clips": {"wake": str(base / "wake.wav"), "utterance": str(base / "utterance.wav")},
                "events": [
                    {"name": "wake", "marker": "wake detected", "timeoutSeconds": 1},
                    {"name": "speaking", "marker": "state=speaking", "timeoutSeconds": 1},
                ],
                "bargeIn": {
                    "clip": str(base / "interrupt.wav"),
                    "afterStage": "speaking",
                    "events": [{"name": "aborted", "marker": "wake interrupt", "timeoutSeconds": 1}],
                },
            }
            scenario_file.write_text(json.dumps(document), encoding="utf-8")
            parsed = wake_audio_test.load_scenario(scenario_file)
            self.assertIsNotNone(parsed.barge_in)
            assert parsed.barge_in is not None
            self.assertEqual(parsed.barge_in.after_stage, "speaking")
            self.assertEqual(parsed.barge_in.stages[0].marker, "wake interrupt")

            document["bargeIn"]["afterStage"] = "wake"
            scenario_file.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(wake_audio_test.HarnessError, "final events stage"):
                wake_audio_test.load_scenario(scenario_file)

    def test_barge_in_preflight_rejects_half_duplex_sdkconfig(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            firmware_config = base / "sdkconfig"
            firmware_config.write_text(
                'CONFIG_VEETEE_WS_URI="ws://127.0.0.1:18100/veetee/v3/"\n'
                'CONFIG_VEETEE_PROTOCOL_PROFILE=3\n'
                'CONFIG_VEETEE_WAKE_ENABLED=y\n'
                'CONFIG_VEETEE_WAKE_MODEL_NAME="wn9_computer_tts"\n'
                '# CONFIG_VEETEE_WAKE_DURING_PLAYBACK is not set\n',
                encoding="utf-8",
            )
            scenario_file = base / "scenario.json"
            scenario_file.write_text(json.dumps({
                "monitor": {"command": ["never-run"], "projectDir": str(base), "serialPort": "/dev/null", "baud": 115200},
                "player": {"command": ["never-run", "{file}"]},
                "clips": {"wake": str(base / "wake.wav"), "utterance": str(base / "utterance.wav")},
                "firmware": {"configFile": str(firmware_config), "requiredProtocolProfile": 3},
                "events": [
                    {"name": "speaking", "marker": "state=speaking", "timeoutSeconds": 1},
                ],
                "bargeIn": {
                    "clip": str(base / "interrupt.wav"),
                    "afterStage": "speaking",
                    "events": [{"name": "wake", "marker": "wake detected", "timeoutSeconds": 1}],
                },
            }), encoding="utf-8")
            scenario = wake_audio_test.load_scenario(scenario_file)
            with self.assertRaisesRegex(wake_audio_test.HarnessError, "WAKE_DURING_PLAYBACK"):
                wake_audio_test.preflight_firmware_config(scenario)

    def test_forbidden_serial_markers_are_configured_and_fail_fast(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            scenario_file = base / "scenario.json"
            scenario_file.write_text(json.dumps({
                "monitor": {"command": ["never-run"], "projectDir": str(base), "serialPort": "/dev/null", "baud": 115200},
                "player": {"command": ["never-run", "{file}"]},
                "clips": {"wake": str(base / "wake.wav"), "utterance": str(base / "utterance.wav")},
                "forbiddenMarkers": ["panic", "stack overflow", "panic"],
                "events": [{"name": "wake", "marker": "wake detected", "timeoutSeconds": 1}],
            }), encoding="utf-8")
            parsed = wake_audio_test.load_scenario(scenario_file)
            self.assertEqual(parsed.forbidden_markers, ("panic", "stack overflow"))
            monitor = wake_audio_test.Monitor(parsed, verbose=False)
            with monitor._condition:
                monitor._forbidden_hits.append((0.0, "panic", "panic: test"))
            with self.assertRaisesRegex(wake_audio_test.HarnessError, "forbidden serial marker"):
                monitor.wait_for("wake detected", 0.01)

    def test_wait_for_ignores_marker_before_stage_boundary(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        monitor = wake_audio_test.Monitor(scenario, verbose=False)
        boundary = time.monotonic()
        with monitor._condition:
            monitor._queue.append((boundary - 1, "wake detected stale"))
            monitor._queue.append((boundary + 0.01, "wake detected current"))
        timestamp, line = monitor.wait_for("wake detected", 0.1, not_before=boundary)
        self.assertGreaterEqual(timestamp, boundary)
        self.assertEqual(line, "wake detected current")

    def test_assert_absent_ignores_stale_marker_and_rejects_current_marker(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        monitor = wake_audio_test.Monitor(scenario, verbose=False)
        boundary = time.monotonic()
        with monitor._condition:
            monitor._queue.append((boundary - 1, "wake detected stale"))
        monitor.assert_absent("wake detected", 0.01, not_before=boundary)

        with monitor._condition:
            monitor._queue.append((boundary + 0.01, "wake detected current"))
        with self.assertRaisesRegex(wake_audio_test.HarnessError, "unexpected serial marker"):
            monitor.assert_absent("wake detected", 0.1, not_before=boundary)

    def test_wait_for_any_returns_the_matching_configured_marker(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        monitor = wake_audio_test.Monitor(scenario, verbose=False)
        boundary = time.monotonic()
        with monitor._condition:
            monitor._queue.append((boundary + 0.01, "server alert code=LLM_RATE_LIMITED"))
        timestamp, line, marker = monitor.wait_for_any(
            ("state=speaking", "server alert code="),
            0.1,
            not_before=boundary,
        )
        self.assertGreaterEqual(timestamp, boundary)
        self.assertEqual(line, "server alert code=LLM_RATE_LIMITED")
        self.assertEqual(marker, "server alert code=")

    def test_run_refuses_audio_without_allow_flag_before_monitor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            wake = base / "wake.wav"
            utterance = base / "utterance.wav"
            wake.write_bytes(b"RIFF")
            utterance.write_bytes(b"RIFF")
            scenario_file = base / "scenario.json"
            scenario_file.write_text(json.dumps({
                "monitor": {"command": ["never-run"], "projectDir": str(base), "serialPort": "/dev/null", "baud": 115200},
                "player": {"command": ["never-run", "{file}"]},
                "clips": {"wake": str(wake), "utterance": str(utterance)},
                "utteranceAfter": "wake",
                "events": [{"name": "wake", "marker": "wake detected", "timeoutSeconds": 1}],
            }), encoding="utf-8")
            scenario = wake_audio_test.load_scenario(scenario_file)
            with self.assertRaisesRegex(wake_audio_test.HarnessError, "--allow-audio"):
                wake_audio_test.run(scenario, allow_audio=False, dry_run=False, verbose=False)

    def test_report_preserves_status_and_redacted_event_shape(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = wake_audio_test.load_scenario(root / "wake-test.example.json")
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "partial.json"
            wake_audio_test._write_report(
                report,
                scenario,
                [{"event": "wake_detected", "repetition": 1}],
                status="interrupted",
                error="keyboard_interrupt",
            )
            document = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(document["status"], "interrupted")
            self.assertEqual(document["error"], "keyboard_interrupt")
            self.assertEqual(document["events"][0]["event"], "wake_detected")
            self.assertNotIn("audio", document)
            self.assertNotIn("secret", document)


if __name__ == "__main__":
    unittest.main()
