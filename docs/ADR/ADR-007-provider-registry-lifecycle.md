# ADR-007: Package-discovered provider registry, một selection và không fallback

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-03
- Người quyết định: chủ dự án Veetee
- Cập nhật: 2026-08-03 — làm rõ activation theo measured GPU headroom và
  transactional rollback khi không thể dual-resident.

## Context

Veetee cần nhiều implementation có thể cắm/rút cho VAD, ASR, LLM, TTS, Intent và Memory nhưng core/UI không được hardcode vendor. Reference dùng config `type` và dynamic import factory (`references/xiaozhi-esp32-server/main/xiaozhi-server/core/utils/modules_initialize.py:30-98`), đồng thời tách provider metadata khỏi model config (`references/xiaozhi-esp32-server/main/manager-api/src/main/java/xiaozhi/modules/model/entity/ModelProviderEntity.java:12-46`, `references/xiaozhi-esp32-server/main/manager-api/src/main/java/xiaozhi/modules/model/entity/ModelConfigEntity.java:14-64`). Veetee cần schema/version/lifecycle chặt hơn để AI coding workflow không tạo convention ngầm khác nhau giữa các feature.

Chủ dự án đã quyết định phiên bản hiện tại **không có provider fallback**. Danh
sách Groq free keys chỉ dành cho test harness quota/capability, không thuộc registry
runtime.

## Decision drivers

- Must thêm provider package mà không sửa conversation core hoặc manager form.
- Must validate config và capability trước activation.
- Must biết lifecycle/resource ownership để giữ VRAM 4 GB.
- Must trả lỗi rõ, không silently đổi quality/cost/vendor.
- Should pin artifact/version và reproducible benchmark.

## Các phương án

### A. `if/switch` built-in trong core

- Ưu điểm: dễ bắt đầu và debug.
- Nhược điểm: mỗi provider buộc sửa core/UI; schema drift; khó isolate dependency.

### B. Package entry point + manifest + JSON Schema

- Ưu điểm: boundary rõ, discoverable, form có thể sinh từ schema, test contract dùng chung.
- Nhược điểm: cần packaging discipline và trust policy khi cài plugin.

### C. Mỗi provider là network microservice

- Ưu điểm: dependency/process isolation mạnh.
- Nhược điểm: nhiều deployment, RTT, observability và failure mode không cần thiết trên một máy.

## Quyết định

Chọn **B** trong cùng `veetee-server` process hoặc supervised worker khi SDK blocking:

- Python distribution đăng ký entry point theo kind và xuất `ProviderManifest` versioned.
- Manifest chứa ID ổn định, kind, implementation version, capabilities, lifecycle scope, JSON Schema, secret fields, supported locales/formats và resource hints.
- Manager lưu `ProviderInstallation`, nhiều `ProviderConfig`, nhưng một `ProviderSelection` active cho mỗi `(assistant, kind)`.
- Config publish validate package tồn tại, schema, secretRefs, capability và resource plan.
- Server chọn activation mode bằng exact measured resource record, không bằng
  manifest hint:
  - `BLUE_GREEN` khi measured new-generation load/warm peak delta không vượt
    allocatable headroom; headroom đã trừ old warm baseline, session reserve và
    activation margin. Old giữ readiness, new warm/probe rồi atomic activate và
    old drain/unload.
  - `QUIESCE_SWAP` khi không đủ dual residency nhưng từng generation riêng lẻ vẫn
    dưới promotion limit; đóng admission/readiness, drain/cancel lease, unload old,
    warm/probe new rồi atomic activate.
- New generation fail trong blue-green thì unload new và giữ old. New fail sau
  quiesce-swap thì unload new, reload/warm/probe **exact pinned old generation**;
  chỉ mở readiness khi probe pass. Old reload fail giữ non-ready, không chọn provider khác.
- Runtime lỗi kết thúc stage/turn bằng typed error; không chọn config/provider kế tiếp.
- Retry chỉ được phép là bounded retry **cùng provider** cho operation được chứng minh idempotent; policy phải được provider khai báo và không đổi provider identity.

## Consequences

### Tích cực

- Core, API và UI dùng một schema/capability vocabulary.
- Có thể lazy-load/unload theo declared lifecycle.
- Không có hidden cost/quality change khi provider lỗi.
- Provider contract tests có thể chạy độc lập với conversation server.

### Tiêu cực

- Cài package vẫn là deployment action; “cắm/rút bằng config” không có nghĩa chạy code chưa được cài.
- Manifest sai có thể phá resource budget nếu không đo lại.
- Một provider lỗi làm turn lỗi vì không fallback.
- `QUIESCE_SWAP` có degraded/downtime interval và có thể phải kết thúc lease cũ
  tại bounded quiesce deadline; đây là trade-off để tránh CUDA OOM trên GPU 4 GB.
- Rollback low-headroom phải reload model cũ nên chậm hơn pointer rollback của
  blue-green và có thể thất bại độc lập.

### Mitigations và guardrails

- Allowlist package/signature và pin exact version/hash.
- Resource hints chỉ dùng để preflight; measured peak mới quyết định promotion.
- Resource vocabulary tách physical VRAM, driver/runtime reserved, measured warm
  baseline, allocatable headroom và promotion/admission limit; warm baseline đã
  gồm driver/runtime nên không double-count.
- Secrets dùng `secretRef`, schema response luôn redact.
- Config activation transaction và rollback revision, không partial apply.
- Failed candidate phải unload/release hoàn tất trước rollback reload; activation
  record giữ readiness transitions, degraded interval, resource peak và rollback result.
- Contract suite bắt buộc cho stream, cancellation, timeout, locale và cleanup.

## Verification

- [ ] Cài provider test package và hiện form từ schema mà không sửa core/web source.
- [ ] Invalid schema/capability/secretRef bị reject trước publish.
- [ ] Tại mọi thời điểm chỉ một selection active mỗi assistant/kind.
- [ ] Fault injection chứng minh không có call sang provider thứ hai.
- [ ] Unload trả resource về ngưỡng baseline và không còn background task.
- [ ] Blue-green candidate fail vẫn giữ old readiness và trả resource candidate.
- [ ] Quiesce-swap candidate fail unload new, reload exact old generation, báo
  measured degraded interval; old reload fail giữ service non-ready.
- [ ] Mode selection dùng measured headroom/promotion limit và reject trước CUDA
  allocation khi candidate riêng lẻ không vừa.

## Liên quan

- [05-provider-registry.md](../05-provider-registry.md)
- [ADR-002](./ADR-002-hybrid-local-first.md)
- [ADR-006](./ADR-006-streaming-turn-cancellation.md)
