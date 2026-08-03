# Unattended wake-word test

`wake_audio_test.py` is a physical-test harness, not a product runtime. It is
deliberately opt-in: it never starts an audio player without `--allow-audio`,
starts the ESP-IDF monitor with `--no-reset`, and sends no commands to the
board. The local WAV files are not tracked.

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
utterance. It waits for firmware speaking/re-arm markers before finishing. Use
`--verbose` only when raw serial output is needed; do not commit its output or
any credential-bearing log.
