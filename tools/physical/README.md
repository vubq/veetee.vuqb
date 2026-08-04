# Unattended wake-word test

`wake_audio_test.py` is a physical-test harness, not a product runtime. It is
deliberately opt-in: it never starts an audio player without `--allow-audio`,
starts the ESP-IDF monitor with `--no-reset`, and sends no commands to the
board. The local WAV files are not tracked.

## Manual M0 PTT acceptance

`ptt_acceptance.py` is the physical acceptance harness for the M0 button path.
It only observes an externally operated button: it does **not** inject GPIO,
send serial commands, flash firmware, change Wi-Fi/NVS, or reset the board. The
serial monitor is always started with `idf.py monitor --no-reset`.

Create an ignored local scenario, then put the Vietnamese utterance WAV at the
configured local path. The clip is deliberately not included in Git.

```bash
cp tools/physical/ptt-acceptance.example.json \
  tools/physical/ptt-acceptance.local.json

python3 tools/physical/ptt_acceptance.py \
  --scenario tools/physical/ptt-acceptance.local.json \
  --dry-run
```

The dry run does not open serial, call HTTP, start an audio player, or create a
report. It verifies the scenario shape and prints the planned no-reset monitor
command. The shipped example intentionally reports that its local WAV does not
exist.

For a real operator-run turn, activate ESP-IDF first. Keep GPIO0 pressed until
the harness reports `PTT start`; it will either play the configured Vietnamese
clip or ask the operator to speak, then asks for GPIO0 to be released. It waits
for the source-log order `thinking → PTT stop → speaking → idle` and stops on a
configured panic/codec/queue marker.

```bash
source /home/vubq/.espressif/v6.0.2/esp-idf/export.sh

# Manual speech only: no host audio process is allowed to start.
python3 tools/physical/ptt_acceptance.py \
  --scenario tools/physical/ptt-acceptance.local.json

# Only after the owner has explicitly approved host playback of the local clip.
python3 tools/physical/ptt_acceptance.py \
  --scenario tools/physical/ptt-acceptance.local.json \
  --allow-audio
```

The current firmware logs `state=thinking` before its `PTT stop` log. For a
manual turn it drains already queued TTS audio, then emits
`graceful tts drain complete state=idle`; the scenario requires that exact
post-drain marker for semantic `idle`. `PTT start` is the listening/capture
marker. This makes the report prove the real M0 transition without asking the
firmware to reboot merely to re-emit its boot-time idle/connect markers.

By default the tool writes one redacted JSON report under the ignored
`tools/physical/reports/` directory. It contains stage timing, numeric metrics
before/after and their deltas, plus player exit/duration if audio was explicitly
enabled. It never persists raw serial lines, raw microphone/clip data, player
stderr, cookies, HTTP authorization data, provider secrets, or transcript text.
Pass `--report /tmp/…json` to place the same redacted report elsewhere.

### Optional Manager history phrase hash

To verify the accepted Vietnamese phrase without putting a transcript in a
report, add a `history` object only to the ignored local scenario. The harness
performs GET requests only: it snapshots the conversation list before GPIO0 is
pressed, waits for a changed conversation after the final ready marker, and
hashes the final configured-speaker segments in memory. It records only SHA-256
values and a match boolean.

```json
{
  "history": {
    "apiBaseUrl": "http://127.0.0.1:18101",
    "assistantId": "replace-with-local-assistant-id",
    "speaker": "user",
    "expectedPhraseFile": "/private/path/veetee-m0-expected-phrase.txt",
    "sessionCookieFile": "/private/path/veetee-manager-session-cookie",
    "timeoutSeconds": 15,
    "pollIntervalSeconds": 0.5
  }
}
```

`expectedPhraseFile` and `sessionCookieFile` must be owner-only (`0600` or
stricter), are never copied into a report, and are optional when the Manager API
is running with local auth disabled. Instead of an expected phrase file, an
operator may supply `expectedPhraseSha256`; the normalisation is NFC + casefold
+ collapsed whitespace. The harness does not create sessions, modify history,
or expose a Manager secret.

## Prepare a local scenario

Copy `wake-test.example.json` to an ignored local file and replace the two WAV
paths. The current firmware preset is the ESP-SR phrase `Computer`; the
utterance clip should be a normal Vietnamese request. Keep the marker strings
aligned with the flashed firmware build instead of changing product code for a
test.

```bash
cp tools/physical/wake-test.example.json tools/physical/wake-test.local.json
```

Add this entry to `tools/physical/.gitignore` or keep the local scenario outside
the repository:

```text
wake-test.local.json
*.wav
*.ogg
*.mp3
*.json.report
```

## Dry-run (safe, no monitor and no audio)

```bash
python3 tools/physical/wake_audio_test.py \
  --scenario tools/physical/wake-test.example.json \
  --dry-run
```

The example intentionally reports missing clip files; that is expected.

Scenarios may also define `forbiddenMarkers`. The serial monitor fails fast when
one of these configured strings appears, so a soak report cannot silently pass
after a panic, stack overflow, queue/capture failure, or codec error. Keep this
list board/build-specific and do not put secrets or raw audio in it.

## Physical run (only after explicit owner permission)

Activate ESP-IDF first so `idf.py` is on `PATH`, then run:

```bash
source /home/vubq/.espressif/v6.0.2/esp-idf/export.sh
python3 tools/physical/wake_audio_test.py \
  --scenario tools/physical/wake-test.local.json \
  --allow-audio \
  --report /tmp/veetee-wake-test.json
```

The harness checks Voice Server readiness, starts a no-reset serial monitor,
plays the wake clip, waits for `wake detected` and `wake start`, then plays the
utterance. It waits for the post-recreation `wake detector armed` marker before
starting the next repetition. Use
`--verbose` only when raw serial output is needed; do not commit its output or
any credential-bearing log.

Every completed playback now emits a redacted `audio_player_exit` event in the
optional report. It contains only `clipRole`, process `exitCode`, bounded player
duration and at most 512 characters of player `stderr`; it never captures raw
audio or microphone data. A wake timeout with `exitCode: 0` therefore separates a
successful host playback process from a WakeNet/AFE recognition miss. A non-zero
exit code fails the repetition immediately and preserves the diagnostic text.

### Positive/negative wake corpus

Use `wake_corpus_test.py` with a JSON corpus when the question is “did the
detector recognize only the configured wake clip?” rather than “did one complete
conversation work?” Each case declares `expected: "detected"` or
`expected: "not_detected"`; markers, timeout and completion clip are config data.
Run negative cases before positive cases so an intentionally detected positive
turn cannot leave the board in capture state if its server completion path fails:

```bash
source /home/vubq/.espressif/v6.0.2/esp-idf/export.sh
python3 tools/physical/wake_corpus_test.py \
  --scenario tools/physical/wake-test.local.json \
  --corpus tools/physical/wake-corpus.example.json \
  --allow-audio \
  --report /tmp/veetee-wake-corpus.json
```

The corpus report is redacted and records `wake_not_detected` for a negative
window or the complete positive lifecycle (`wake_detected`, `capture_started`,
`assistant_speaking`, `wake_rearmed`). A negative case that emits the detection
marker fails immediately; stale serial markers before the case boundary are
discarded. `markers.completionFailed` is optional; when configured, an upstream
alert is recorded explicitly, the harness waits for re-arm, then fails the run
so a provider/quota failure cannot be mistaken for a detector result.

For a test-only Groq multi-key run, start Voice Server separately from a fixture
snapshot with `VEETEE_TEST_GROQ_KEYS_FILE=...` (see
`veetee-server/README.md`). The physical harness itself never reads or prints
keys; Manager-source production runtime remains single-secret/no-rotation.

## Physical wake barge-in lifecycle

`wake_audio_test.py` also accepts an optional `bargeIn` block. It starts the
configured interrupt clip after the final normal stage (usually
`state=speaking`) and waits for configured serial markers such as `wake
detected`, `state=listening`, `wake interrupt` and a new `wake start`. Set
`startDelaySeconds` when testing a different point inside the speaking window;
the delay is bounded and recorded in the report:

```bash
python3 tools/physical/wake_audio_test.py \
  --scenario tools/physical/wake-barge-in.example.json \
  --allow-audio \
  --report /tmp/veetee-wake-barge-in.json
```

The phase is opt-in and configuration-driven. It records control/lifecycle
timings only; it does **not** claim that the physical speaker reached silence
within the M1 time-to-silence target. That requires a separate acoustic capture
measurement. The harness still uses `idf.py monitor --no-reset`, never flashes,
does not toggle RTS/DTR, and never stores raw audio, transcript or credentials.

## Repeated physical soak

Set the ignored local scenario field `"repetitions": 30` to reuse one monitor
and WebSocket session for a bounded board turn soak. Each repetition waits for
all configured markers before starting the next wake clip; the report stores
only repetition/timing events. Keep the explicit `--allow-audio` gate and stop
the run if the serial stream shows panic, stack, queue, capture or Opus errors.
