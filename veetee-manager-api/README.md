# Veetee Manager API

Fastify control plane cho cấu hình published bằng web. `.env` chỉ bootstrap bind,
auth secret, database/provider catalog path và machine auth; provider/model/prompt
và device settings được gửi qua API theo JSON Schema rồi tạo revision immutable.

## Chạy local

```bash
npm install
VEETEE_API_HOST=127.0.0.1 VEETEE_API_PORT=8001 \
VEETEE_DATABASE_MODE=memory \
npm run dev
```

`memory` phù hợp fixture/dev test. M2 production dùng `VEETEE_DATABASE_MODE=postgres`
và `VEETEE_DATABASE_URL_FILE`; migration SQL nằm trong `migrations/`.

Health: `/health/live`, `/health/ready`. User API có prefix `/api/v1`, machine
runtime snapshot là `/internal/v1/runtime-config`. OpenAPI JSON ở `/openapi.json`.
