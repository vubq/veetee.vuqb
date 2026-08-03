# ADR-015: Cho phép provider draft chưa bind secret, nhưng publish phải đủ secret

## Status

Accepted — 2026-08-03.

## Context

Manager cần hỗ trợ tạo, đổi và rotate credential qua Web mà không làm mất lịch
sử immutable. Một provider như Groq yêu cầu đúng một `secretRef` khi Voice Server
được activate, nhưng trong lúc thay secret chủ sở hữu phải có thể tháo binding
cũ, tạo revision mới và bind secret mới. Nếu bắt draft luôn đủ secret, thao tác
unbinding không thể thực hiện; nếu publish draft thiếu secret, runtime sẽ nhận
snapshot không thể khởi tạo provider.

## Options

### A — Bắt mọi draft luôn đủ secret

Đơn giản để validate, nhưng không thể unbind/rotate một binding đang dùng; phải
thực hiện thao tác đặc biệt ngoài revision model.

### B — Cho draft thiếu secret, strict ở publish

Draft có thể ở trạng thái unavailable khi `secretRefs` rỗng hoặc chưa đủ. Publish
validate theo `manifest.secretFields` và từ chối thiếu/thừa/duplicate binding;
snapshot đã publish luôn có binding hoàn chỉnh.

### C — Cho publish thiếu secret rồi để Voice Server tự báo lỗi

UI thao tác dễ hơn nhưng biến lỗi cấu hình thành runtime outage, không phù hợp với
immutable snapshot và readiness gate.

## Decision

Chọn **B**.

- Create/PATCH `ProviderConfig` chỉ kiểm tra không vượt số secret field khai báo,
  không duplicate và không bind secret cho provider không khai báo field.
- `secretRefs: []` là draft hợp lệ nhưng provider được xem là unavailable cho đến
  khi đủ binding.
- `POST /assistants/{id}/publish` validate strict số lượng binding cho mọi
  provider selected; thiếu/thừa/duplicate trả lỗi typed `SECRET_INVALID` hoặc
  `CONFIG_NOT_PUBLISHABLE` trước transaction publication.
- Provider config revision cũ giữ nguyên `secretRefs`; secret reference bị chặn
  xóa nếu còn xuất hiện trong bất kỳ revision immutable nào.
- Không có runtime fallback, key rotation tự động hoặc plaintext trong snapshot.

## Consequences

### Tích cực

- Rotation/unbind là thao tác revision bình thường, không cần chỉnh DB thủ công.
- Runtime snapshot luôn đủ điều kiện credential trước khi Voice Server apply.
- InMemory và PostgreSQL có cùng semantics; test có thể bao phủ cả hai.

### Đánh đổi

- UI phải hiển thị trạng thái `unavailable` cho draft chưa bind đủ secret.
- Publish validation cần biết provider manifest và có thể từ chối một draft đang
  lưu hợp lệ.
- Secret reference lịch sử tiếp tục tồn tại cho tới khi toàn bộ revision dùng nó
  được archive theo retention policy tương lai.

## Evidence

- `veetee-manager-api/src/store.ts`: validation draft và strict publish cho
  InMemory store.
- `veetee-manager-api/src/postgres-store.ts`: cùng validation trong transaction
  PostgreSQL.
- `veetee-manager-api/src/auth-secret.test.ts` và
  `veetee-manager-api/src/postgres-store.test.ts`: unbind draft thành công,
  publish thiếu secret bị từ chối, immutable history vẫn chặn delete.

## Related decisions

- [ADR-007 — Provider registry](ADR-007-provider-registry.md)
- [ADR-008 — PostgreSQL baseline](ADR-008-postgresql-without-redis-baseline.md)
- [ADR-009 — Local Manager authentication](ADR-009-local-manager-authentication.md)
