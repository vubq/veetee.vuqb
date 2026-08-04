# ADR-024: Allow-list export cho một conversation

## Trạng thái

Accepted — 2026-08-05

## Context

Q-009 yêu cầu Owner có thể export transcript đã retention. Read endpoint hiện
trả conversation detail để render UI, nhưng dùng nguyên response làm file tải
về sẽ khiến mọi field mới trong read schema có nguy cơ lọt vào export. Dữ liệu
export cũng không được chứa device identity hash, secret/provider credential hay
audio artifact.

## Decision drivers

- Must: owner-scope và retention-scope giống read endpoint.
- Must: schema export ổn định, explicit allow-list, không serialize ORM row.
- Should: bounded trên host local, không thêm worker/object store ở M2.
- Could: nâng cấp thành bulk archive sau khi có job/storage contract.

## Các phương án

### A. Một conversation JSON attachment

- Ưu điểm: bounded, retry đơn giản, dễ kiểm tra privacy, dùng được cho memory và
  PostgreSQL.
- Nhược điểm: bulk export phải tải từng conversation.

### B. Async archive toàn assistant

- Ưu điểm: thuận tiện cho nhiều conversation và file lớn.
- Nhược điểm: cần job persistence, progress/retry/tombstone và object storage;
  vượt baseline M2.

### C. Browser download từ read response

- Ưu điểm: không thêm route.
- Nhược điểm: export format bị coupling với read schema và dễ leak field nội bộ.

## Quyết định

Chọn A. `GET /api/v1/conversations/{id}/export` trả JSON có
`exportVersion=1`, `exportedAt` và `conversation`. Summary export bỏ
`deviceKey`; turns/retention chỉ chứa dữ liệu đã được Store giữ theo policy.
Response có `Content-Disposition: attachment`, còn Web tạo file tạm qua
`VtButton` và revoke object URL ngay sau click.

Delete conversation không nằm trong ADR này; khi cần sẽ có ADR riêng cho
retention-delete job và tombstone semantics.

## Consequences

### Tích cực

- Export không tự động mở đường cho raw identity/secret/audio leak khi read
  schema được mở rộng.
- Không thêm Redis, worker, migration hoặc thay đổi wire/firmware.
- Preview và API mode dùng cùng gateway contract.

### Tiêu cực

- Không có bulk archive trong M2.
- Conversation rất lớn vẫn phải bounded bởi giới hạn ingest hiện tại và trình
  duyệt; archive job tương lai sẽ cần streaming.

### Mitigations và guardrails

- Explicit response schema + mapper, không dùng spread nguyên summary.
- Owner/retention check trước export.
- Unit API InMemory/PostgreSQL, HTTP gateway và Chromium download regression.
- Không ghi export content vào log, Pinia, localStorage hoặc report.

## Verification

- `veetee-manager-api`: API tests, PostgreSQL dedicated `veetee_vubq_test`,
  OpenAPI export/check.
- `veetee-manager-web`: typed gateway, short-lived download utility, History
  button/unit/E2E.
- Audio/firmware/network untouched.

## Liên quan

- [ADR-017 — Retention purge và backup rehearsal](./ADR-017-retention-and-backup-maintenance.md)
- [`docs/superpowers/specs/2026-08-05-conversation-export-design.md`](../superpowers/specs/2026-08-05-conversation-export-design.md)
