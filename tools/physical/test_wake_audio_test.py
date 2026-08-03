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


if __name__ == "__main__":
    unittest.main()
