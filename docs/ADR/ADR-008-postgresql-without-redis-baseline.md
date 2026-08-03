# ADR-008: PostgreSQL là system of record, chưa yêu cầu Redis ở baseline

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-03
- Người quyết định: kiến trúc Phase 1 theo ủy quyền của chủ dự án

## Context

Bốn deployable cần chia sẻ configuration, device binding và history metadata trên một máy có 16 GB RAM. Realtime queue phải ở trong session memory; manager không nằm trên critical path. Thêm Redis ngay từ M0 tạo thêm service, memory và consistency mode trong khi chưa có multi-instance requirement.

Reference dùng relational entities cho agent/device/provider (`references/xiaozhi-esp32-server/main/manager-api/src/main/java/xiaozhi/modules/agent/entity/AgentEntity.java:18-85`, `references/xiaozhi-esp32-server/main/manager-api/src/main/java/xiaozhi/modules/device/entity/DeviceEntity.java:21-66`) và cache global config qua Redis (`references/xiaozhi-esp32-server/main/manager-api/src/main/java/xiaozhi/modules/config/service/impl/ConfigServiceImpl.java:268-330`). Veetee giữ relational source of truth nhưng chỉ thêm cache khi có số đo chứng minh.

## Decision drivers

- Must atomic config revision và referential integrity.
- Must dễ backup/restore trên một host.
- Must không đưa database round trip vào audio frame path.
- Should giảm service/memory/operational failure ở M0/M1.
- Could scale thêm cache/pub-sub sau mà không đổi domain contract.

## Các phương án

### A. SQLite + local files

- Ưu điểm: nhẹ nhất, không có DB daemon.
- Nhược điểm: concurrent writer/migration/backup và hai process Node/Python kém thuận tiện hơn.

### B. PostgreSQL + Redis từ đầu

- Ưu điểm: cache/pub-sub/session primitives sẵn.
- Nhược điểm: thêm vận hành và consistency invalidation khi chưa cần.

### C. PostgreSQL + in-process cache, Redis theo promotion gate

- Ưu điểm: transaction/relation mạnh, chỉ một stateful service; server dùng immutable cached snapshot.
- Nhược điểm: config invalidation baseline dùng ETag polling hoặc PostgreSQL notification; chưa scale multi-host tốt.

## Quyết định

Chọn **C**:

- Từ M2, PostgreSQL là source of truth cho manager domain, config revisions và
  history index. M0/M1 chỉ dùng immutable bootstrap fixture cùng snapshot schema,
  không giả fixture là persistent system of record.
- Audio/assets lớn nằm trong local object directory; DB chỉ giữ metadata/checksum/path key.
- Voice server cache immutable config snapshot trong process, refresh theo ETag/revision ngoài critical path.
- Session, turn và audio queues chỉ ở memory của voice server.
- Không deploy Redis trước M2 và cũng không yêu cầu Redis ở M2 baseline. Redis chỉ
  được thêm bằng ADR superseding khi multi-instance, measured DB load hoặc
  cross-process event latency yêu cầu.

## Consequences

### Tích cực

- Ít service và ít lỗi vận hành hơn trên laptop 16 GB.
- Config publication atomic và backup nhất quán.
- Realtime data không bị serialize qua Redis.

### Tiêu cực

- Poll interval tạo config propagation delay hữu hạn.
- Multi-instance coordination chưa được giải quyết.
- File object store cần backup cùng DB manifest.

### Mitigations và guardrails

- Publish response trả revision/checksum; server báo active revision.
- Optional PostgreSQL `LISTEN/NOTIFY` chỉ là invalidation hint; luôn re-read/checksum.
- Backup tạo DB dump + object manifest cùng generation.
- Không lưu secret plaintext trong row cấu hình hoặc audit diff.

## Verification

- [ ] Publish concurrent bằng stale `If-Match` trả `409`/`412`, không overwrite.
- [ ] Manager down không làm turn đang chạy lỗi.
- [ ] Config propagation đạt mục tiêu ≤ 5 giây baseline mà không polling trên audio loop.
- [ ] Backup/restore test giữ đúng foreign keys và object checksums.
- [ ] 60 phút soak không cho config cache tăng không giới hạn.

## Liên quan

- [08-manager-design.md](../08-manager-design.md)
- [09-deployment.md](../09-deployment.md)
- [ADR-003](./ADR-003-fastify-manager-api.md)
