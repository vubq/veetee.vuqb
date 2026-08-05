# Veetee Manager API

Fastify control plane cho cấu hình published bằng web. `.env` chỉ bootstrap bind,
auth secret, database/provider catalog path và machine auth; provider/model/prompt
và device settings được gửi qua API theo JSON Schema rồi tạo revision immutable.

## Chạy local

```bash
npm install
VEETEE_API_HOST=127.0.0.1 VEETEE_API_PORT=8001 \
VEETEE_PUBLIC_BASE_URL=http://127.0.0.1:8001 \
VEETEE_DATABASE_MODE=memory \
npm run dev
```

`memory` phù hợp fixture/dev test. M2 dùng `VEETEE_DATABASE_MODE=postgres` và
`VEETEE_DATABASE_URL_FILE`; migration SQL nằm trong `migrations/`. Runtime
bootstrap của project dùng database riêng `veetee_vubq` trên `127.0.0.1:55432`,
không dùng database hoặc data directory của project khác.

Migration chạy one-shot trước khi API khởi động:

```bash
VEETEE_DATABASE_URL_FILE=../secrets/manager.database-url npm run db:migrate
```

`VEETEE_DEVICE_ONLINE_TTL_SECONDS` (10–86.400, mặc định 120) quyết định khi
presence `online` hết hạn. Đây là bootstrap policy; `deviceCount` vẫn gồm mọi
device đã bind, còn `onlineDeviceCount` và `Device.onlineState` được suy ra từ
`lastSeenAt` trong TTL.

PostgreSQL adapter dùng immutable `assistant_revision` và
`provider_config_revision`; các row current chỉ giữ pointer/ETag. Secret chỉ là
reference metadata, không lưu plaintext trong PostgreSQL.

Khi bật `VEETEE_AUTH_MODE=local`, cung cấp `VEETEE_AUTH_SECRET_FILE`, owner
email và password hash qua `VEETEE_OWNER_PASSWORD_HASH_FILE` (ưu tiên file; biến
`VEETEE_OWNER_PASSWORD_HASH` chỉ phù hợp test) cùng `VEETEE_ALLOWED_ORIGINS`.
Login trả cookie opaque
`HttpOnly` cùng CSRF token chỉ trong response/ memory; request unsafe phải gửi
exact `Origin` và `X-Veetee-CSRF`. Login failures được throttle theo IP +
normalized identity bằng các `VEETEE_LOGIN_*` limits; khi đạt ngưỡng API trả
`429 LOGIN_THROTTLED` và `Retry-After`. Encrypted local secret store dùng thêm
`VEETEE_SECRET_MASTER_KEY_FILE` và `VEETEE_SECRET_STORE_FILE`; UI không bao giờ
nhận lại secret value.

Health: `/health/live`, `/health/ready`. User API có prefix `/api/v1`, machine
runtime snapshot là `/internal/v1/runtime-config`. OpenAPI JSON ở `/openapi.json`.

Runtime canonical của project dùng API loopback `127.0.0.1:18101` và đặt
`VEETEE_PUBLIC_BASE_URL=https://veetee.tail52a635.ts.net`. Giá trị này chỉ dùng
cho trường `servers` trong OpenAPI; API không suy hostname từ header `Host`.
