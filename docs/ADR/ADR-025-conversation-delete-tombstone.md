# ADR-025: Async conversation delete với tombstone

## Trạng thái

Accepted — 2026-08-05

## Context

Manager đã có retention purge và export từng conversation, nhưng Owner chưa có
đường xóa chủ động. Xóa đồng bộ trong HTTP request sẽ giữ connection trong lúc
dọn transcript/turn và không tạo được trạng thái retry rõ ràng. Xóa ngay rồi trả
`404` cũng làm client cũ khó phân biệt dữ liệu vừa bị xóa với ID sai.

## Các phương án

### A — DELETE đồng bộ, trả 204

Đơn giản nhưng request phụ thuộc thời gian dọn dữ liệu, thiếu progress/retry và
không có semantics nhất quán khi worker gặp lỗi.

### B — Job bất đồng bộ + tombstone (chọn)

DELETE trả job có trạng thái; worker xóa trong transaction; tombstone tối giản
giữ 410 trong TTL cấu hình. Job unique theo owner/conversation giúp retry và
double-click không tạo hai lần xóa.

### C — Event queue/object storage riêng

Mở rộng tốt cho bulk archive/audio nhưng cần broker/worker/object-store, vượt
baseline host-native M2 và chưa có yêu cầu bulk.

## Decision

Chọn B. Manager API giữ job/tombstone trong PostgreSQL (InMemory adapter có cùng
semantics cho preview/test). Tombstone không chứa identity hay nội dung hội thoại;
retention sweep dọn tombstone hết hạn. Không thêm Redis/Docker hay thay wire
protocol.

## Consequences

### Tích cực

- HTTP nhanh, có trạng thái pollable và idempotent.
- FK cascade bảo đảm turns biến mất cùng conversation.
- `410 RETENTION_EXPIRED` giúp UI và client xử lý rõ ràng trong tombstone window.
- Không mở rộng phạm vi lưu audio/secret/raw identity.

### Tiêu cực

- Thêm hai bảng và worker lifecycle trong Manager API.
- Client phải xử lý `202` và có thể poll job.
- Tombstone cần sweep; job record tăng theo số lần xóa.

## Guardrails

- Owner scope ở mọi query; foreign owner không được phân biệt bằng response.
- Retry hữu hạn và status `failed`; không tự fallback provider hay retry vô hạn.
- Test luôn dùng `veetee_vubq_test`, không dùng database runtime `veetee_vubq`.
- Không chạy physical/audio test trong slice này.

## Liên quan

- [ADR-017 — Retention purge và backup rehearsal](./ADR-017-retention-and-backup-maintenance.md)
- [ADR-024 — Conversation export allow-list](./ADR-024-conversation-export-allow-list.md)
- [`conversation-delete-design.md`](../superpowers/specs/2026-08-05-conversation-delete-design.md)
