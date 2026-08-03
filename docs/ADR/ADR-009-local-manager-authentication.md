# ADR-009: Local credentials và opaque server-side session cho Manager

## Trạng thái

Accepted — 2026-08-03.

## Context

Manager Web và Manager API chạy cùng một reverse-proxy origin trên một host local.
Baseline chỉ có một owner; multi-user, public Internet và external identity provider
chưa phải requirement. Hệ thống vẫn cần login, CSRF protection, session revoke và
machine authentication tách biệt. PostgreSQL đã là source of truth, còn Redis chủ
động không nằm trong M0/M1 baseline.

## Decision drivers

- Ít token lifecycle và failure mode cho một SPA cùng origin.
- Session có thể revoke ngay và audit được.
- Credential không xuất hiện trong browser storage hoặc URL.
- Không thêm Redis/IdP trước khi có nhu cầu multi-user/public access.
- Machine bearer của Voice Server không được dùng chung user session.
- Có đường thay bằng OIDC mà không đổi domain/API authorization semantics.

## Các phương án

### A. Local password + opaque server-side session cookie

- Ưu: đơn giản, revoke tức thì, không có access/refresh-token rotation ở browser;
  phù hợp single-host và PostgreSQL hiện có.
- Nhược: API phải đọc session store; chưa có SSO/federation.

### B. JWT access token trong memory + rotating refresh cookie

- Ưu: quen thuộc cho API đa client và có thể giảm session lookup.
- Nhược: thêm hai token, rotation/reuse detection, key/version/revocation semantics
  và nhiều race hơn nhu cầu hiện tại.

### C. OIDC qua external IdP/reverse proxy

- Ưu: SSO/MFA/account lifecycle chuyên nghiệp.
- Nhược: thêm service, redirect/callback/certificate configuration và dependency
  ngoài cho một owner local.

## Quyết định

Chọn **A** cho M2 baseline:

1. Owner được provision bằng operator command/seed có audit; không có public
   self-registration hoặc email password reset.
2. Password hash bằng Argon2id với parameter benchmark/pin; plaintext chỉ tồn tại
   trong request memory và không log/persist.
3. Login tạo random opaque session token tối thiểu 256 bit. Browser chỉ nhận cookie
   `HttpOnly`, `SameSite=Lax`, path `/`; `Secure` bắt buộc ngoài explicit isolated
   HTTP dev mode. Database chỉ lưu keyed hash của token.
4. `UserSession` có owner, credential version, issued/last-seen/idle-expiry/
   absolute-expiry/revoked timestamps và bounded metadata; login/password change
   rotate hoặc revoke session theo policy.
5. Unsafe request phải pass exact Origin allowlist và per-session CSRF token trong
   custom header. CSRF token được trả qua authenticated `/me`, giữ trong memory,
   không localStorage.
6. Login được rate-limit theo IP + keyed normalized identity và có bounded lockout;
   response không tiết lộ account tồn tại.
7. Manager Web không giữ bearer/access/refresh token. Pinia chỉ giữ redacted user,
   expiry và CSRF token; session authority luôn là cookie.
8. Voice Server/worker dùng machine bearer/audience riêng, không chấp nhận cookie.
9. Mọi session lookup/revoke/cleanup dùng PostgreSQL ở M2 single instance. Redis
   chỉ được thêm theo ADR-008 promotion gate.

## Consequences

### Tích cực

- Bỏ access/refresh-token refresh race và browser token persistence.
- Logout/password reset revoke được ngay ở server.
- Cùng-origin reverse proxy đơn giản hóa CORS/cookie policy.
- Session model có audit và phù hợp single-owner local.

### Tiêu cực

- Mỗi authenticated request cần bounded session lookup/cache policy.
- API client không dùng cookie cần auth scheme khác; baseline không hỗ trợ.
- Local owner recovery cần operator flow, không có email reset.

### Guardrails

- Session token, cookie, password, hash/pepper và CSRF secret đều bị redact.
- Cookie dev không secure chỉ được bật bằng explicit flag khi bind trusted LAN;
  readiness phải báo degraded và public exposure bị cấm.
- Session cleanup idempotent; database outage fail closed cho Manager API nhưng
  không ảnh hưởng Voice turn đang dùng cached config.
- Argon2id parameter và login concurrency phải benchmark để không làm host DoS.

## Verification

- [ ] Cookie không đọc được từ JavaScript và không xuất hiện local/session storage.
- [ ] Missing/wrong Origin hoặc CSRF header trên unsafe route trả `403` trước mutation.
- [ ] Logout, password change và credential-version bump vô hiệu session cũ ngay.
- [ ] Concurrent replay cùng session không tạo duplicate write nhờ API idempotency.
- [ ] Login throttle không tiết lộ email tồn tại và sống qua API restart.
- [ ] Secret canary không xuất hiện trong response/log/audit/error/OpenAPI example.
- [ ] Machine bearer không gọi user route và user cookie không gọi machine route.

## Liên quan

- [08-manager-design.md](../08-manager-design.md)
- [09-deployment.md](../09-deployment.md)
- [ADR-003](./ADR-003-fastify-manager-api.md)
- [ADR-008](./ADR-008-postgresql-without-redis-baseline.md)
