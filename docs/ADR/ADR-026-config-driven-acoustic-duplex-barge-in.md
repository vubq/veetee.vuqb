# ADR-026: Config-driven acoustic duplex barge-in

## Status

Accepted — 2026-08-05.

## Context

Wake-word interrupt trên firmware đã chạy được khi loa đang phát, nhưng đường
acoustic voice-onset còn bị dừng uplink ngay khi nhận `tts/start`. Vì vậy server
không thể dùng VAD để xác nhận người dùng nói chen, dù pipeline đã có generation
barrier cho `realtime` mode. Bật duplex mặc định sẽ làm tăng CPU/AEC load và có
nguy cơ echo false-positive trên board chưa được calibrate.

## Decision drivers

- Barge-in phải do policy trong published snapshot bật được, không sửa firmware
  mỗi lần thay threshold/enable.
- Peer cũ phải bỏ qua field mới và vẫn chạy half-duplex như trước.
- Chỉ giữ mic uplink khi device-side AEC đã init thành công; AEC fail phải
  fail-closed về PTT/wake-word.
- Abort phải flush playback ngay và tạo turn mới mà không để audio cũ lọt qua.
- Không tự chuyển provider, transport hoặc mode khi policy không hợp lệ.

## Options

### Option A — Chỉ wake-word interrupt

Giữ uplink half-duplex và dùng WakeNet trong playback.

- Ưu: ít CPU/băng thông, đã có lifecycle evidence.
- Nhược: người dùng phải nói đúng wake phrase; không đáp ứng voice-onset
  barge-in tự nhiên.

### Option B — Luôn bật server-side acoustic duplex

Firmware luôn upload mic khi speaker phát và server luôn chạy barge-in VAD.

- Ưu: behavior đơn giản ở config.
- Nhược: tăng privacy/băng thông/CPU, không an toàn khi AEC hoặc board profile
  chưa được promotion; không phù hợp fail-closed.

### Option C — Published policy bật duplex theo session

Role snapshot có `bargeIn.deviceDuplex=true`. Server đưa capability additive
`barge_in:{enabled:true,mode:"acoustic"}` vào `tts/start`; firmware chỉ giữ
uplink trong `speaking` khi field này có và AEC ready. Server nhận speech frame,
abort generation cũ và tạo capture turn mới cùng mode `auto`/`realtime`.

## Decision

Chọn **Option C**.

- Snapshot thiếu `bargeIn` hoặc `deviceDuplex` giữ behavior cũ.
- `minSpeechFrames` được validate bounded và dùng chung cho server gate; firmware
  không tự diễn giải threshold đó.
- `tts/stop` có `reason:"barge_in"` là cancellation barrier: firmware flush
  playback/decoder/reference ngay, chuyển sang listening và giữ capture cho turn
  mới; `tts/stop` bình thường vẫn graceful drain.
- Server acoustic gate chỉ cho phép audio trong `speaking` khi turn là `realtime`
  hoặc policy `deviceDuplex=true`; mode `auto` tạo turn `auto` mới để VAD vẫn
  endpoint câu nói chen.

## Consequences

### Positive

- Có đường voice-onset barge-in thật mà không phá compatibility wire.
- Mặc định production hiện tại không đổi; promotion có thể A/B theo snapshot
  revision và rollback về half-duplex.
- Local AEC ownership, server VAD và cancellation generation giữ ranh giới rõ.

### Negative / open gate

- Duplex làm tăng uplink bandwidth, AEC/NS CPU và nguy cơ echo; phải đo RSS,
  queue, packet drops, false accept/reject và time-to-silence trên board.
- Nếu tts stop cũ không có `reason`/turn metadata, firmware chỉ áp state gate
  compatibility, không thể chứng minh ownership tuyệt đối.
- Chưa được promote vào production snapshot cho tới khi acoustic corpus đạt gate.

## Verification

- Server unit/integration: policy absent giữ half-duplex; policy bật tạo
  `barge_in` metadata, nhận speech khi speaking, gửi `tts/stop(reason=barge_in)`
  và không phát stale binary.
- Firmware host/build: state/queue/cancellation invariants, warning-free ESP-IDF
  build, không thay wire profile.
- Physical: AEC-on echo-only + voice-onset corpus, time-to-silence p95 ≤250 ms,
  không panic/Opus/queue error; chỉ sau đó publish policy cho production.

## Related

- [ADR-005 — On-device wake word](ADR-005-on-device-wake-word.md)
- [ADR-006 — Streaming turn cancellation](ADR-006-streaming-turn-cancellation.md)
- [ADR-020 — Device AEC adapter](ADR-020-device-aec-adapter.md)
- [ADR-023 — Firmware stale `tts/stop` barrier](ADR-023-firmware-stale-tts-stop-barrier.md)
