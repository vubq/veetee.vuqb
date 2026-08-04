from __future__ import annotations

from contextlib import redirect_stdout
from hashlib import sha256
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parent))
import ptt_acceptance


class PttAcceptanceHarnessTest(unittest.TestCase):
    def test_example_dry_run_has_no_monitor_http_or_audio_side_effects(self) -> None:
        root = Path(__file__).resolve().parent
        output = io.StringIO()
        with (
            patch.object(ptt_acceptance.SerialMonitor, "start", side_effect=AssertionError("monitor must not start")),
            patch.object(ptt_acceptance, "_safe_json_get", side_effect=AssertionError("HTTP must not run")),
            patch.object(ptt_acceptance, "_play_clip", side_effect=AssertionError("audio must not play")),
            redirect_stdout(output),
        ):
            exit_code = ptt_acceptance.main([
                "--scenario", str(root / "ptt-acceptance.example.json"),
                "--allow-audio",
                "--dry-run",
            ])
        self.assertEqual(exit_code, 0)
        plan = json.loads(output.getvalue())
        self.assertTrue(plan["monitorNoReset"])
        self.assertIn("--no-reset", plan["monitor"])
        self.assertTrue(plan["audio"]["requested"])
        self.assertFalse(plan["audio"]["playerWillStart"])
        self.assertEqual(plan["operatorPttGpio"], 0)
        self.assertEqual([stage["name"] for stage in plan["stages"]], list(ptt_acceptance.EXPECTED_STAGE_NAMES))
        scenario = ptt_acceptance.load_scenario(root / "ptt-acceptance.example.json")
        self.assertEqual(scenario.stages[-1].marker, "graceful tts drain complete state=idle")

    def test_monitor_command_is_no_reset_and_has_no_flash_action(self) -> None:
        root = Path(__file__).resolve().parent
        scenario = ptt_acceptance.load_scenario(root / "ptt-acceptance.example.json")
        command = ptt_acceptance.monitor_command(scenario)
        self.assertIn("monitor", command)
        self.assertIn("--no-reset", command)
        self.assertFalse(any(item in ptt_acceptance.FORBIDDEN_MONITOR_ARGUMENTS for item in command))

    def test_stage_order_and_gpio_are_rejected_when_not_m0_ptt_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "scenario.json"
            source = json.loads((Path(__file__).resolve().parent / "ptt-acceptance.example.json").read_text(encoding="utf-8"))
            source["operator"]["pttGpio"] = 1
            path.write_text(json.dumps(source), encoding="utf-8")
            with self.assertRaisesRegex(ptt_acceptance.HarnessError, "GPIO0"):
                ptt_acceptance.load_scenario(path)

            source["operator"]["pttGpio"] = 0
            source["stages"][1], source["stages"][2] = source["stages"][2], source["stages"][1]
            path.write_text(json.dumps(source), encoding="utf-8")
            with self.assertRaisesRegex(ptt_acceptance.HarnessError, "serial order"):
                ptt_acceptance.load_scenario(path)

    def test_history_hash_and_report_do_not_retain_phrase_text(self) -> None:
        phrase = "Xin chào Veetee"
        detail = {
            "turns": [{
                "turnId": "turn-1",
                "sequence": 2,
                "transcript": [
                    {"speaker": "user", "isFinal": True, "text": phrase},
                    {"speaker": "assistant", "isFinal": True, "text": "Không được đưa vào report"},
                ],
            }],
        }
        turn_id, observed = ptt_acceptance._latest_phrase_hash(detail, "user")
        self.assertEqual(turn_id, "turn-1")
        self.assertEqual(observed, ptt_acceptance.normalized_phrase_sha256(phrase))
        record = ptt_acceptance.RunRecord(
            scenario_hash="a" * 64,
            started_at="2026-08-04T00:00:00Z",
            serial_port="/dev/ttyACM0",
            audio_requested=False,
            events=[],
            history={"checked": True, "observedPhraseSha256": observed},
        )
        rendered = json.dumps(record.report("passed"), ensure_ascii=False)
        self.assertNotIn(phrase, rendered)
        self.assertNotIn("Không được đưa vào report", rendered)
        self.assertEqual(observed, sha256("xin chào veetee".encode("utf-8")).hexdigest())


if __name__ == "__main__":
    unittest.main()
