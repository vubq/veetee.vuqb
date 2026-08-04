# ADR-019: Admission một active turn theo runtime snapshot

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-04
- Người quyết định: chủ dự án Veetee

## Context

Một device lease chỉ ngăn duplicate connection của cùng device. Nhiều device
khác nhau vẫn có thể đồng thời mở ASR/LLM/TTS turn, trong khi host Acer Nitro 5
chỉ có 4 GB VRAM và baseline chưa có measured concurrency/resource schedule.
Cho phép chạy song song trước benchmark có thể gây CUDA OOM, swap-thrash hoặc
audio queue growth; xếp hàng không giới hạn lại làm TTFA và cancellation không
đoán được.

`Q-007` đã chốt một active conversation dùng model lease. Policy cần nằm trong
immutable assistant snapshot để Manager Web/API thay đổi có revision, không phải
constant rải trong request handler.

## Decision drivers

- Must reject work trước provider allocation khi capacity đầy.
- Must giữ WebSocket/session idle để reconnect, wake và retry không mất ownership.
- Must trả typed/additive signal, không chèn câu localized hoặc đổi provider.
- Must release lease ở normal completion, provider error, abort, intent exit và disconnect.
- Should cho phép tăng capacity sau benchmark bằng config revision/ADR superseding.

## Các phương án

### A. Cho phép mọi session chạy song song

- Ưu điểm: throughput lý thuyết cao, ít admission code.
- Nhược điểm: không có bằng chứng VRAM/RAM, dễ OOM và không phù hợp baseline
  một active conversation.

### B. Queue turn FIFO không giới hạn

- Ưu điểm: caller không nhận lỗi ngay.
- Nhược điểm: giữ audio/session state quá lâu, phá TTFA/cancellation và tạo
  memory growth không bị chặn.

### C. Bounded admission, reject khi đầy

- Ưu điểm: resource safety deterministic; session vẫn sống và client có thể retry.
- Nhược điểm: caller phải xử lý `SERVER_BUSY`; throughput chỉ tăng sau benchmark.

## Quyết định

Chọn **C**.

Snapshot có policy additive:

```json
{"admission":{"maxActiveTurns":1,"retryAfterMs":250}}
```

Server giữ bounded turn lease map. `listen/start` chỉ tạo `TurnPipeline` sau khi
reserve được slot. Nếu đầy, server gửi `alert` với `code:"SERVER_BUSY"` và
`retry_after_ms`, không gọi ASR/LLM/TTS và không đóng WebSocket. `maxActiveTurns`
được giới hạn 1–8; snapshot thiếu field dùng default tương thích an toàn `1`.
Lease release là idempotent theo `(session, turn_id)`.

`retryAfterMs` là hint, không phải đảm bảo server queue. Không có runtime provider
fallback hay automatic key rotation. Tăng capacity chỉ sau measured VRAM/RAM,
TTFA, queue và soak evidence bằng revision/ADR mới.

## Consequences

### Tích cực

- Không thử allocation model khi host đã đầy; giảm OOM và swap-thrash risk.
- Hai device vẫn có thể giữ WebSocket/hello; chỉ lượt vượt capacity bị từ chối rõ.
- Manager snapshot là source of truth, nên policy có thể publish/configure mà không
  sửa conversation core.

### Tiêu cực

- Với baseline `1`, device thứ hai phải retry thay vì được xử lý ngay.
- Capacity field sai có thể làm giảm throughput hoặc tăng resource pressure; schema
  và clamp giới hạn 1–8 giảm rủi ro nhưng không thay benchmark.
- Đây chưa phải measured GPU arbiter; provider generation promotion vẫn có gate riêng.

### Mitigations và guardrails

- `SERVER_BUSY` là typed alert, không hardcode câu tiếng Việt.
- Lease release ở mọi terminal path và metrics `active_turns`/admission counters.
- Snapshot activation giữ optional field qua Manager draft/publish và ETag.
- Không ghi raw device ID, prompt, secret hoặc transcript vào metrics/error.

## Verification

- [x] `test_turn_admission_rejects_second_device_then_releases_after_abort`:
  second device nhận `SERVER_BUSY`, slot được release sau abort và retry thành công.
- [x] Manager API role publish giữ `admission.maxActiveTurns/retryAfterMs` trong
  runtime snapshot.
- [ ] Measured multi-turn VRAM/RAM capacity và 60 phút soak; chưa tuyên bố M1/M4
  resource promotion.

## Liên quan

- `docs/11-open-questions.md` — Q-001, Q-007.
- `docs/07-server-design.md` — liveness, resource arbiter và session lease.
- `docs/08-manager-design.md` — additive runtime snapshot policy.
- ADR-002 — hybrid local-first/resource budget.
- ADR-006 — turn cancellation.
- ADR-018 — per-device session handover.
