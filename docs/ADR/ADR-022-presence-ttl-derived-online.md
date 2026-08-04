# ADR-022: Suy ra trạng thái online bằng presence TTL

## Status

Accepted

## Context

Manager API nhận presence `online`/`offline` từ Voice Server. Nếu board mất điện,
mất Wi-Fi hoặc process bị kill trước khi gửi `offline`, row PostgreSQL có thể giữ
`online` vô hạn. Khi đó dashboard và device list hiển thị một thiết bị không còn
khả dụng là trực tuyến.

## Decision drivers

- Trạng thái online phải tự hết hạn khi không có heartbeat/presence mới.
- `deviceCount` vẫn phải đếm mọi device đang bind, kể cả device stale.
- Cùng một semantics cho InMemory fixture và PostgreSQL production adapter.
- TTL phải cấu hình được khi bootstrap, không rải literal trong UI hoặc query.
- Không được ghi thêm identity, audio hoặc transcript để giải quyết presence.

## Considered options

### Option A — Tin `onlineState` cuối cùng

Ít code và không cần thêm config, nhưng giữ trạng thái ma sau mất điện hoặc
disconnect không sạch.

### Option B — Background job đổi row stale thành `offline`

Có thể làm dữ liệu vật lý phản ánh TTL, nhưng cần scheduler/transaction riêng và
mọi đọc vẫn có race giữa job và request.

### Option C — Suy ra lúc đọc từ `onlineState + lastSeenAt + TTL`

Không cần mutation nền; `deviceCount` và `onlineDeviceCount` có thể tách rõ,
query aggregate vẫn batch và mọi adapter dùng cùng hàm predicate.

## Decision

Chọn **Option C**. `VEETEE_DEVICE_ONLINE_TTL_SECONDS` có miền 10–86.400 giây và
giá trị mặc định 120 giây ở bootstrap. Một device chỉ được coi là online khi
`onlineState == "online"` và `lastSeenAt >= now - ttl`. `deviceCount` không áp
dụng TTL; `onlineDeviceCount` và `Device.onlineState` có áp dụng TTL.

Presence row không bị rewrite chỉ vì hết TTL. Presence `offline` vẫn là trạng
thái tường minh và luôn thắng predicate.

## Consequences

### Positive

- Dashboard không còn hiển thị online vô hạn khi board biến mất đột ngột.
- Không cần timer/job mutate database; đọc lặp lại tự cho kết quả đúng theo thời
  gian hiện tại.
- Unit predicate, InMemory summary và PostgreSQL aggregate có thể kiểm thử chéo.

### Negative

- UI có thể đổi từ online sang offline khi đang mở trang mà không có event push;
  route cần reload/poll để cập nhật.
- TTL quá ngắn có thể tạo false offline khi mạng LAN chập chờn; owner phải chọn
  TTL phù hợp với chu kỳ presence thực tế.
- Database vẫn giữ `onlineState=online` cho mục đích forensic/last-seen; serializer
  không được trả raw identity.

## Implementation notes

- Environment schema validate TTL và truyền vào cả store adapter.
- PostgreSQL aggregate dùng `FILTER` trên `last_seen_at`; device count không bị
  giảm khi thiết bị stale.
- Device list serializer cũng áp dụng cùng predicate để card và chi tiết không
  lệch nhau.
- Dedicated PostgreSQL test database `veetee_vubq_test` có regression stale
  `last_seen_at`; runtime database `veetee_vubq` không dùng cho test.

## Related decisions

- [ADR-014 — Isolated PostgreSQL immutable control plane](ADR-014-isolated-postgres-immutable-control-plane.md)
- [ADR-013 — Web-published runtime configuration](ADR-013-web-published-runtime-config.md)
