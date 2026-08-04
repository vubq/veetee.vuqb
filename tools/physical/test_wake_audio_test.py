from __future__ import annotations

import json
from pathlib import Path
import tempfile
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
