# ADR-027: Config-driven acoustic barge-in rearm cooldown

## Trạng thái

Accepted — 2026-08-05 (guard implementation; acoustic promotion remains open)

## Ngày và người quyết định

- Ngày: 2026-08-05
- Người quyết định: Veetee architecture workflow

## Context

Probe vật lý với snapshot fixture bật `bargeIn.deviceDuplex=true` đã chứng minh
đường voice-onset chạy, nhưng sau commit đầu residual echo/đuôi interrupt tạo
chuỗi `barge_in_count=10`, `turn_admissions=11` và còn `active_turns=1` dù clip
đã kết thúc. Production hiện không bật duplex; đây là gate phải đóng trước khi
promotion.

Guard cần nằm ở server/session vì server sở hữu VAD, turn admission và
cancellation barrier. Nó phải là policy trong snapshot để owner cấu hình qua
Manager Web, không hardcode vào firmware hoặc `.env`.

## Decision drivers

- Must: không để một interrupt tạo vòng lặp vô hạn do residual echo.
- Must: field additive; snapshot/peer cũ thiếu field vẫn chạy như trước.
- Must: bounded, validate fail-closed và observable bằng metric.
- Should: không làm thay đổi PTT, wake-word hoặc half-duplex mặc định.
- Could: cho firmware dùng giá trị cooldown trong metadata cho AEC/rearm tương lai.

## Các phương án

### A. Chỉ tăng `minSpeechFrames`

- Ưu điểm: không thêm field.
- Nhược điểm: không xử lý echo kéo dài hoặc đuôi clip; làm tăng latency và có
  thể bỏ lỡ câu nói ngắn.
- Rủi ro/điều kiện: không đủ trước evidence loop.

### B. Cooldown cố định trong server

- Ưu điểm: thay đổi nhỏ, chặn được residual ngắn.
- Nhược điểm: hardcode timing, không phù hợp nhiều board/AEC profile; vi phạm
  yêu cầu config-driven.
- Rủi ro/điều kiện: khó A/B và khó rollback theo role.

### C. `bargeIn.cooldownMs` trong published snapshot (được chọn)

- Ưu điểm: bounded, owner-configured, rollback bằng revision; server có thể bỏ
  uplink trong cửa sổ sau commit và gửi giá trị additive trong `tts/start`.
- Nhược điểm: người dùng nói ngay trong cửa sổ sẽ bị bỏ qua; AEC kém vẫn cần
  corpus/guard bổ sung sau cooldown.
- Rủi ro/điều kiện: không coi cooldown là bằng chứng time-to-silence; phải đo
  suppressed frames và false reject.

## Quyết định

Chọn **Option C**. `bargeIn.cooldownMs` là số nguyên `0..5000`, mặc định `0`
khi policy không bật duplex và mặc định `2000` khi `deviceDuplex=true` nhưng
field vắng. Sau mỗi server acoustic commit, session bỏ qua uplink khi vẫn đang
`speaking` và cooldown chưa hết; các frame này chỉ tăng metric ignored/suppressed,
không đi vào VAD/ASR/pipeline. Khi cooldown hết, behavior barge-in hiện hành
tiếp tục.

`tts/start.barge_in.cooldown_ms` là field optional để firmware mới có thể dùng;
firmware cũ bỏ qua field và vẫn wire-compatible. Production snapshot không tự
được bật policy; owner phải publish revision đã kiểm thử.

## Consequences

### Tích cực

- Chặn lớp retrigger ngắn đã quan sát mà không đổi protocol bắt buộc hay provider.
- Có thể A/B theo assistant/role và rollback bằng ETag/revision.
- Metric cho biết bao nhiêu frame bị bỏ trong guard, giúp phân biệt echo với
  user false-reject.

### Tiêu cực

- Cooldown quá lớn làm mất onset câu nói; giá trị phải được đo theo board/AEC.
- Không thay thế AEC reference alignment, echo-only corpus, voice-onset và
  time-to-silence p95.

### Mitigations và guardrails

- UI giới hạn `0..5000 ms`, server validate cùng boundary.
- Chỉ áp dụng khi `bargeIn.enabled && deviceDuplex` (hoặc realtime mode có
  policy tương ứng); missing policy giữ half-duplex.
- Không rotate provider/fallback hoặc thay đổi Wi-Fi/NVS.
- Không promote policy cho production trước khi probe bounded không còn active
  turn leak và đạt time-to-silence gate.

## Verification

- [ ] `veetee-server` config tests: default, valid boundary, invalid boundary.
- [ ] Web/API tests preserve and edit `cooldownMs` qua role config.
- [ ] Server integration: cooldown suppresses audio while speaking and increments
  `barge_in_suppressed_cooldown`; first barge still emits stop/new turn.
- [ ] Physical fixture: bounded acoustic clip has no unbounded retrigger,
  `active_turns=0`, no panic/queue/Opus marker; measure time-to-silence separately.
- [ ] Rollback: remove field or set `deviceDuplex=false`; old peer ignores
  `cooldown_ms`.

## Liên quan

- [ADR-026 — Config-driven acoustic duplex barge-in](ADR-026-config-driven-acoustic-duplex-barge-in.md)
- [ADR-020 — Device AEC adapter](ADR-020-device-aec-adapter.md)
- [`docs/04-audio-pipeline.md`](../04-audio-pipeline.md)
- [`docs/08-manager-design.md`](../08-manager-design.md)
