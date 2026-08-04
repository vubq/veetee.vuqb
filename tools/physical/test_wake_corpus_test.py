from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

import wake_corpus_test


class WakeCorpusTest(unittest.TestCase):
    def _write(self, document: dict[str, object]) -> Path:
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        path = directory / "corpus.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return path

    def test_loads_configured_positive_and_negative_cases(self) -> None:
        path = self._write({
            "markers": {
                "wakeDetected": "wake detected",
                "captureStarted": "wake start",
                "assistantSpeaking": "state=speaking",
                "rearmed": "wake capture complete",
            },
            "completionClip": "reply.wav",
            "cases": [
                {"name": "negative", "clip": "no.wav", "expected": "not_detected"},
                {"name": "positive", "clip": "yes.wav", "expected": "detected"},
            ],
        })
        corpus = wake_corpus_test.load_corpus(path)
        self.assertEqual([case.name for case in corpus.cases], ["negative", "positive"])
        self.assertFalse(corpus.cases[0].expected_detection)
        self.assertTrue(corpus.cases[1].expected_detection)
        self.assertIsNone(corpus.completion_failed_marker)
        self.assertEqual(corpus.completion_clip, (path.parent / "reply.wav").resolve())

    def test_loads_optional_completion_failure_marker(self) -> None:
        path = self._write({
            "markers": {
                "wakeDetected": "wake detected",
                "captureStarted": "wake start",
                "assistantSpeaking": "state=speaking",
                "completionFailed": "server alert code=",
                "rearmed": "wake capture complete",
            },
            "completionClip": "reply.wav",
            "cases": [{"name": "positive", "clip": "yes.wav", "expected": "detected"}],
        })
        corpus = wake_corpus_test.load_corpus(path)
        self.assertEqual(corpus.completion_failed_marker, "server alert code=")

    def test_rejects_duplicate_case_names_and_unknown_expectation(self) -> None:
        base = {
            "markers": {
                "wakeDetected": "wake detected",
                "captureStarted": "wake start",
                "assistantSpeaking": "state=speaking",
                "rearmed": "wake capture complete",
            },
            "completionClip": "reply.wav",
            "cases": [
                {"name": "same", "clip": "one.wav", "expected": "detected"},
                {"name": "same", "clip": "two.wav", "expected": "not_detected"},
            ],
        }
        with self.assertRaisesRegex(wake_corpus_test.HarnessError, "duplicate"):
            wake_corpus_test.load_corpus(self._write(base))
        base["cases"] = [{"name": "bad", "clip": "one.wav", "expected": "maybe"}]
        with self.assertRaisesRegex(wake_corpus_test.HarnessError, "detected or not_detected"):
            wake_corpus_test.load_corpus(self._write(base))


if __name__ == "__main__":
    unittest.main()
