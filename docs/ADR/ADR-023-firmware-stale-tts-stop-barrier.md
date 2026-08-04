# ADR-023: Firmware bỏ qua `tts/stop` stale sau barge-in

## Status

Accepted

## Context

Một lượt auto đang phát TTS có thể bị wake word interrupt. `tts/stop` của lượt
cũ vẫn có thể đến sau `listen/start` của lượt mới vì WebSocket và playback queue
là hai luồng có thứ tự khác nhau. Firmware trước đây hạ `capture_active` trước
khi kiểm tra state speaking; vì vậy một stop stale có thể tắt microphone của
lượt mới và re-arm WakeNet giữa lúc đang capture.

## Decision drivers

- Cancellation barrier phải giữ capture của turn mới.
- Peer cũ vẫn có thể không gửi `turn_id`, nên guard phải additive và giữ wire
  compatibility.
- Không reset Opus encoder, NVS, Wi-Fi hoặc playback bằng workaround timing.
- Guard phải nằm ở ownership boundary của firmware, không phụ thuộc server retry.

## Considered options

### Option A — Delay mọi `tts/stop`

Tăng cửa sổ để queue tự ổn định nhưng chỉ che timing race, làm chậm TTFA/interrupt
và không có invariant ownership.

### Option B — Firmware chỉ kiểm tra state

Không tắt capture nếu state không phải speaking. Cách này sửa race observed khi
lượt mới đã vào listening, nhưng vẫn không phân biệt stop cũ và stop mới nếu cả
hai cùng lúc ở speaking.

### Option C — State gate + optional `turn_id` guard

Chỉ schedule graceful stop khi state đang speaking; nếu cả hai message có
`turn_id`, firmware yêu cầu ID trùng với TTS turn đang sở hữu. Stop không có ID
tiếp tục dùng state gate cho compatibility.

## Decision

Chọn **Option C**. Firmware lưu `turn_id` từ additive `tts/start`, bỏ qua stop có
ID khác, và chỉ hạ `capture_active` sau khi `schedule_graceful_tts_stop()` xác nhận
state speaking. `clear_pending_tts_stop()` xóa ownership ID khi abort/new turn.

## Consequences

### Positive

- Stop stale không thể tắt capture hoặc re-arm detector của turn mới.
- Barge-in physical pass được xác nhận với lifecycle
  `wake detected → listening → wake interrupt → wake start`.
- Profile cũ không có `turn_id` vẫn chạy theo state gate.

### Negative

- Firmware giữ một chuỗi ID ngắn trong RAM và phải xử lý message malformed.
- Acoustic echo-only/false reject vẫn là gate riêng; lifecycle pass không chứng
  minh time-to-silence p95.

## Verification

- ESP-IDF build + flash `115200`, không `erase-flash`; esptool hash verify pass.
- Host CTest `1/1` pass.
- Normal wake 2 repetition với khoảng nghỉ 10 giây: `passed`.
- Physical barge-in report: `passed`, lifecycle control markers pass; report
  redacted tại `/tmp/veetee-wake-barge-in-guarded-20260804.json`.
- 10-repetition scenario cũ vẫn có một false reject/no-speech ở repetition 2;
  không gán đó là pass acoustic corpus và vẫn giữ M1 gate mở.

## Related decisions

- [ADR-006 — Streaming turn cancellation](ADR-006-streaming-turn-cancellation.md)
- [ADR-020 — Device AEC adapter](ADR-020-device-aec-adapter.md)
- [ADR-021 — Auto-turn no-speech watchdog](ADR-021-auto-turn-no-speech-watchdog.md)
