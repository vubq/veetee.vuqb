# ADR-016: Machine bearer cho internal Manager API

## Status

Accepted — 2026-08-04

## Context

Voice Server cần đọc runtime snapshot và gửi history/device presence vào
Manager API. Đây là machine-to-machine traffic, khác owner session/cookie của
Manager Web. Baseline local trước đây cho phép internal route không bearer khi
token không được cấu hình; điều đó dễ bị kéo nhầm sang profile PostgreSQL/LAN.

## Options

### A — Không bearer trên loopback

- Ít cấu hình, phù hợp fixture bring-up.
- Nếu bind nhầm `0.0.0.0` hoặc proxy sai, internal route trở thành điểm ghi/đọc
  control plane không xác thực.

### B — Một machine bearer trong file owner-only

- API và Voice Server đọc cùng file `VEETEE_MACHINE_TOKEN_FILE`.
- Token không nằm trong env literal, source, DB, browser hoặc log; supervisor
  tạo idempotent file `0600` khi chưa có.
- Fixture/memory chỉ được dùng A khi ghi rõ `VEETEE_ALLOW_INSECURE_LOCAL_CONFIG`.

## Decision

Chọn **B** cho mọi PostgreSQL runtime. `tools/runtime/ensure_secret.py` tạo token
ngẫu nhiên, giữ file hiện có nếu permission owner-only và không in giá trị. Manager
API từ chối startup khi PostgreSQL không có token, trừ khi operator bật explicit
insecure local config. Internal routes (`runtime-config`, conversation ingest,
pairing challenge và device presence) đều so sánh bearer constant-time.

## Consequences

- Host-native restart có thêm one-shot secret provisioning trước migration/API.
- Runtime recovery phải kiểm tra mode file và bearer probe; thiếu token làm API
  non-ready thay vì mở anonymous internal access.
- Unit/memory fixtures cần khai báo insecure mode hoặc token test rõ ràng.
- Token hiện là shared secret giữa hai process; rotation cần restart có kiểm soát
  và sẽ được mở rộng thành key-generation/dual-token protocol ở hardening sau.

## Verification

- Internal request thiếu/sai bearer trả `401`; bearer đúng trả `200/202`.
- Token file mode `0600`, không xuất hiện trong `git status`, response hoặc logs.
- Runtime manifest tạo token trước migration và Voice/API/Web readiness đều pass.

## Related

- [ADR-009 — Local Manager authentication](./ADR-009-local-manager-authentication.md)
- [ADR-010 — Host-native local deployment](./ADR-010-host-native-local-deployment.md)
- [ADR-011 — Host runtime supervisor](./ADR-011-host-runtime-supervisor.md)
