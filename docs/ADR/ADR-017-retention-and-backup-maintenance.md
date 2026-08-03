# ADR-017: Retention purge và backup rehearsal host-native

## Status

Accepted — 2026-08-04

## Context

Conversation transcript/tool metadata có retention policy theo owner. Việc chỉ
lọc record khi UI đọc khiến dữ liệu hết hạn vẫn tồn tại trong PostgreSQL; backup
cũng cần được kiểm tra restore chứ không chỉ tạo file dump. Local deployment
không dùng container và có một PostgreSQL instance riêng `veetee_vubq`.

## Options

### A — Chỉ purge khi có request đọc

Đơn giản nhưng retention phụ thuộc traffic, không có maintenance evidence và có
thể giữ dữ liệu hết hạn vô thời hạn.

### B — Job trong Manager API + manual machine endpoint

Một bounded timer gọi Store purge, cộng endpoint authenticated để operator/test
chạy ngay. Memory và PostgreSQL dùng cùng Store contract; PostgreSQL cascade xóa
turn data.

### C — Worker/queue riêng

Tách tải khỏi API nhưng thêm process/lifecycle/coordination cho một máy local;
không cần thiết trước khi có multi-instance.

## Decision

Chọn **B**. `VEETEE_RETENTION_INTERVAL_SECONDS` điều khiển timer; mọi lần chạy
đều bounded, không chặn audio server vì nằm ngoài process đó. `POST
/internal/v1/retention/purge` yêu cầu machine bearer. Backup dùng
`tools/runtime/backup_postgres.py` với custom format; `--rehearse` restore vào
database tạm random, kiểm tra schema rồi drop đúng database tạm.

## Consequences

- Không thêm Redis/worker ở M2.
- API process chịu trách nhiệm timer; multi-instance sau này phải chuyển job sang
  singleton/lease trước khi bật horizontal scale.
- Backup file owner-only và nằm ngoài Git; restore rehearsal cần PostgreSQL client
  binaries đã staged.
- Audio retention vẫn bị từ chối cho tới khi có object-store/privacy contract.

## Verification

- Unit/API purge expired conversation pass memory và PostgreSQL persistence suite.
- Backup `pg_restore --list` pass; rehearsal restore schema `veetee_manager` pass,
  temp database cleanup pass.

## Related

- [ADR-008 — PostgreSQL without Redis baseline](./ADR-008-postgresql-without-redis-baseline.md)
- [ADR-010 — Host-native local deployment](./ADR-010-host-native-local-deployment.md)
- [ADR-016 — Machine bearer provisioning](./ADR-016-machine-bearer-provisioning.md)
