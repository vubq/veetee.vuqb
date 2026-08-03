# ADR-003 — Manager API bằng Node.js, TypeScript và Fastify

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owner:** Chủ dự án Veetee
- **Scope:** `veetee-manager-api`

## Context

Veetee cần một control plane độc lập để quản lý assistant, device, provider,
configuration revision, conversation metadata và firmware assets. Realtime voice
data plane là tiến trình riêng; Manager API không được nằm trên critical path của
audio frame hay LLM/TTS streaming. Dự án chủ yếu được triển khai bởi một AI
coding model theo thứ tự milestone, vì vậy boundary module, schema và test oracle
phải rõ hơn convention ngầm của team người.

Các decision drivers:

- Chạy nhẹ trên một máy self-host 16 GB RAM và triển khai đơn giản.
- Chia sẻ TypeScript contract với Manager Web nhưng không ghép hai deployment.
- Validation và response serialization phải schema-first.
- Mỗi domain có boundary nhỏ, test độc lập và ownership rõ.
- OpenAPI 3.1 phải được tạo từ cùng schema chạy ở runtime.
- Credential của provider không xuất hiện trong response hoặc structured log.
- Realtime server chỉ đọc immutable published configuration; thao tác quản trị
  không làm block conversation loop.

## Options considered

### Option A — Fastify modular monolith bằng TypeScript

Một process, một REST API versioned, các feature được đăng ký dưới dạng Fastify
plugin có encapsulation. Shared infrastructure chỉ được expose qua explicit
decorator/plugin dependency.

- Ưu: footprint nhỏ, startup nhanh, JSON Schema là khả năng native, test HTTP
  bằng `inject()` không cần mở port, dễ sinh typed client cho Vue.
- Nhược: kỷ luật boundary phải do project conventions và tests cưỡng chế; ít
  opinionated hơn framework full-stack.

### Option B — NestJS modular monolith

- Ưu: module/DI/controller convention mạnh, ecosystem enterprise quen thuộc.
- Nhược: decorator/metadata và abstraction stack dày hơn; dễ tạo service graph
  lớn, schema runtime và TypeScript type có thể bị tách thành hai nguồn chân lý.

### Option C — Java với Spring Boot

- Ưu: ecosystem mature, validation/security/data tooling đầy đủ, phù hợp team đã
  chuẩn hóa JVM.
- Nhược: footprint và thời gian khởi động cao hơn; thêm toolchain thứ ba bên cạnh
  firmware C++ và realtime server; không chia sẻ trực tiếp type với Vue.

### Option D — Nhiều microservice Node.js ngay từ đầu

- Ưu: deploy và scale từng domain độc lập.
- Nhược: tăng network failure modes, distributed transaction, tracing và release
  coordination trước khi có tải thực tế chứng minh nhu cầu.

## Decision

Chọn **Option A: Node.js + TypeScript + Fastify modular monolith**.

Quy tắc bắt buộc:

1. Public API đặt dưới `/api/v1`; machine API tách dưới `/internal/v1` và dùng
   credential/audience riêng.
2. Mỗi domain là một Fastify plugin: route schema, application service,
   repository port và tests thuộc cùng feature folder. Route handler không chứa
   business transaction.
3. Shared plugins đăng ký theo thứ tự `config → logging/error → database → auth
   → OpenAPI → domains`; dependency được khai báo rõ, không dựa vào import side
   effect.
4. Request, query, params và mọi response status có JSON Schema. TypeScript type
   được derive từ schema; không duy trì DTO type thủ công song song.
5. OpenAPI 3.1 là artifact build được lint; Manager Web dùng generated client từ
   artifact này. Spec và runtime validation phải xuất phát từ cùng schema.
6. Write operation dùng transaction boundary ở application service. Update cấu
   hình dùng optimistic concurrency với `If-Match`; create/action không an toàn
   khi retry dùng `Idempotency-Key`.
7. Provider credential chỉ được tham chiếu bằng `secretRef`. Giá trị secret là
   write-only, bị redact khỏi log và không bao giờ được serialize trong response,
   configuration snapshot hoặc audit payload.
8. Một assistant có tối đa một selected provider cho mỗi kind. Runtime
   error được trả nguyên nhân rõ; không có provider fallback hoặc key rotation
   trong product path.
9. Manager API không proxy audio realtime. Audio artifact download là HTTP
   stream có authorization và range support; ingest chạy ngoài conversation
   critical path.
10. Ban đầu deploy một instance. Domain boundary phải cho phép tách process sau
    này nhưng không thêm message broker cho đến khi metric chứng minh cần thiết.

## Consequences

### Positive

- Một toolchain TypeScript cho control plane và web contract.
- Schema validation, serialization, documentation và generated client có thể
  kiểm tra chéo tự động.
- Modular monolith giảm lỗi vận hành so với microservices sớm.
- Fastify plugin encapsulation tạo seam rõ để AI coding workflow triển khai từng
  feature mà không làm phình route; việc phối hợp model là tuỳ tình huống.
- `inject()` cho phép contract test nhanh, deterministic và không phụ thuộc port.

### Negative

- Team phải duy trì lint rule và architecture test để tránh import xuyên domain.
- CPU-heavy asset compilation không được chạy trong request handler; cần worker
  process/job boundary dù deployment ban đầu vẫn cùng repository.
- Type sharing có thể tạo coupling nếu web import source nội bộ; chỉ generated
  OpenAPI client được phép vượt boundary.
- Một process là một failure domain cho control plane, dù voice session đang chạy
  không được phụ thuộc liên tục vào nó.

### Risks and mitigations

| Risk | Mitigation bắt buộc |
|---|---|
| Route phình thành business layer | Architecture test cấm route import database adapter trực tiếp; service có unit test. |
| Schema và implementation drift | CI export/lint OpenAPI, contract test mọi status và snapshot-diff artifact. |
| Secret lọt qua error/log | Pino redact paths, response allow-list schema, secret-canary test trên log/response/config snapshot. |
| Long-running job giữ event loop | Asset build và provider probe chạy worker có timeout/cancellation; API chỉ tạo/đọc job. |
| Config thay đổi giữa conversation | Voice server pin `publishedRevision` suốt `SessionScope`; revision mới chỉ áp dụng cho session mở sau activation. |
| Một instance không đủ tải | Đo event-loop lag, p95 API latency và job queue depth; chỉ tách module khi vượt SLO liên tục. |

## Verification gates

- Mỗi public operation có `operationId`, auth, request/response schema và error
  contract trong OpenAPI 3.1.
- Contract tests chứng minh `400/401/403/404/409/422/429/500` dùng cùng problem
  envelope và không lộ stack/secret.
- Hai update cùng `If-Match` chỉ một update thành công; update còn lại nhận
  `409 REVISION_CONFLICT` cùng current revision.
- Provider failure trả `PROVIDER_UNAVAILABLE` cho provider đã chọn; test spy xác
  nhận không lookup/call provider thứ hai.
- Test create/action gửi lại cùng `Idempotency-Key` nhận cùng resource/result,
  không tạo bản ghi hoặc job thứ hai.
- Voice server có thể tiếp tục session đang chạy khi Manager API restart.

## Revisit triggers

Viết ADR thay thế nếu một trong các điều sau xảy ra:

- Cần scale độc lập một domain và metric chứng minh modular monolith là bottleneck.
- Nhiều process writer khiến optimistic concurrency hiện tại không đủ.
- Organization chuẩn hóa JVM hoặc một managed control-plane framework khác.
- OpenAPI không còn là boundary phù hợp cho ít nhất hai consumer độc lập.

## Related documents

- [Manager design](../08-manager-design.md)
- [ADR-004 — Manager Web bằng Vue 3, Vite và Tailwind CSS](ADR-004-vue-manager-web.md)
- [ADR-007 — Provider registry lifecycle](ADR-007-provider-registry-lifecycle.md)
- [ADR-008 — PostgreSQL baseline](ADR-008-postgresql-without-redis-baseline.md)
