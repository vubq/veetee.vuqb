# ADR-014: PostgreSQL instance riêng và immutable control-plane revisions

## Trạng thái

Accepted

## Context

Veetee là project độc lập, không được dùng chung database, data directory hoặc
listener của bất kỳ project khác trên cùng máy. Manager API cần lưu assistant,
provider config và publication theo revision để Web có thể dùng `ETag`, rollback
và Voice Server chỉ nhận snapshot đã validate. Provider config thay đổi theo
schema, nhưng secret không được lưu plaintext trong database.

Persistence slice ban đầu với các bảng mutable `assistant`, `provider_config` và
`runtime_publication` không đủ cho immutable history, nhiều assistant hoặc
referential integrity của secret binding.

## Decision drivers

- Tách tuyệt đối khỏi database/data directory/listener bên ngoài project.
- Atomic draft/publish và optimistic concurrency bằng revision + ETag.
- Giữ lịch sử config, không overwrite dữ liệu đã publish.
- Provider-specific JSONB vẫn mở rộng được, nhưng identity/ownership/revision
  phải là relational columns.
- Backup/restore đơn giản trên một host 16 GB RAM; không thêm Redis.
- Secret value chỉ nằm trong encrypted local secret store, PostgreSQL giữ
  metadata/reference.

## Options considered

### A — PostgreSQL instance riêng + normalized identity/revision tables (chọn)

Database `veetee_vubq`, instance host-native chỉ bind `127.0.0.1:55432`, data
directory `.runtime/veetee-postgres-data`. `assistant` và `provider_config` chỉ
giữ current pointer; nội dung immutable nằm trong `assistant_revision` và
`provider_config_revision`. `runtime_publication` khóa theo `assistant_id`.

Ưu điểm: isolation rõ, rollback/audit thuận tiện, migration/ownership dễ kiểm
tra. Nhược điểm: nhiều row và transaction hơn CRUD mutable.

### B — Dùng cluster/database sẵn có nhưng schema prefix riêng

Ít binary/runtime setup hơn, nhưng vẫn chia sẻ failure domain, backup, port và
quyền với project khác; trái với ranh giới độc lập của Veetee.

### C — Một JSON document mutable cho mỗi assistant

Đơn giản lúc đầu nhưng mất revision history, rollback, referential checks và
khó audit; không đáp ứng contract Manager API.

## Decision

Chọn A.

Schema baseline trong `veetee_manager` gồm:

- `assistant` + `assistant_revision`;
- `provider_config` + `provider_config_revision`;
- `runtime_publication` theo assistant/revision;
- `secret_reference` + `provider_secret_binding` (chỉ metadata/reference);
- `manager_session` cho opaque session và `audit_event` cho redacted audit.

Các domain device/pairing/conversation/turn/audio/tool sẽ thêm migration riêng
khi API slice tương ứng được implement; không nhét placeholder mutable vào
baseline.

Migration là one-shot (`npm run db:migrate`) trước khi API chạy. API không tự
đổi schema. Runtime manifest riêng `host-native-postgres-dev.json` khởi động
database, migration, Manager API, Voice Server và Web theo dependency graph.

## Consequences

### Positive

- Không có đường đọc/ghi tới database cũ; database và data directory được nhận
  diện bằng DSN/manifest riêng.
- Draft edit tạo revision mới; publish chỉ đổi pointer và publication snapshot.
- Provider config revision được pin vào runtime snapshot bằng
  `providerConfigId/configRevision`.
- Concurrent stale write bị từ chối; snapshot cũ vẫn có thể audit/rollback.

### Negative

- Query phải resolve current revision thay vì đọc một row mutable.
- Cần job retention/cleanup cho revision, audit và session hết hạn.
- PostgreSQL binary staging là một bước bootstrap host-native.

## Verification

- [x] Database target là `veetee_vubq`, port `55432`, data directory riêng.
- [x] Migration tạo composite revision keys và foreign keys.
- [x] Restart test giữ role/published snapshot sau process restart.
- [ ] Session PostgreSQL-backed + CSRF/Origin gate đầy đủ.
- [ ] Backup/restore rehearsal và revision retention.

## Related

- [ADR-008 — PostgreSQL baseline](./ADR-008-postgresql-without-redis-baseline.md)
- [ADR-009 — Local manager authentication](./ADR-009-local-manager-authentication.md)
- [ADR-010 — Host-native local deployment](./ADR-010-host-native-local-deployment.md)
- [ADR-013 — Web-published runtime configuration](./ADR-013-web-published-runtime-config.md)
