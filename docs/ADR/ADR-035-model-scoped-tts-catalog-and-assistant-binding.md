# ADR-035: Catalog TTS theo model và liên kết metadata trong trợ lý

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-06
- Người quyết định: Veetee architecture workflow

## Context

Màn hình quản trị trước đây đọc `voice_profile` runtime aliases cho cả trang
thư viện giọng, trong khi catalog model đã có `ai_model_config` và
`ai_tts_voice`. Vì vậy nút quản lý voice từ một model TTS không lọc theo model;
trợ lý chỉ hiển thị tên runtime provider config và người vận hành không biết
model catalog/default nào đang được dùng.

Behavior cần giữ từ web tham chiếu gồm: voice table có mã/tên/ngôn ngữ,
preview audio, sửa/xóa từng dòng và chọn/xóa nhiều dòng
(`references/xiaozhi-esp32-server/main/manager-web/src/components/TtsModel.vue:7-102`),
search theo tên và tải theo `ttsModelId`
(`references/xiaozhi-esp32-server/main/manager-web/src/components/TtsModel.vue:171-208`),
và model route dành riêng cho voice list
(`references/xiaozhi-esp32-server/main/manager-web/src/apis/module/model.js:183-218`).
Voice cloning/reference audio vẫn deferred theo scope Veetee.

## Decision drivers

- Phải quản lý voice đúng theo model TTS, không lẫn alias runtime.
- Phải giữ provider config runtime độc lập để publication không bị phá.
- Model disabled phải không hiển thị trạng thái “Sẵn sàng” giả.
- Không bắt người dùng sửa code hoặc `.env` khi thêm/sửa voice.
- API phải dùng được cho InMemory và PostgreSQL, có ETag conflict.

## Các phương án

### A. Dùng `voice_profile` cho mọi mục đích

- Ưu điểm: ít route và ít thay đổi UI.
- Nhược điểm: không có `ttsModelId`, không thể tái hiện model-scoped catalog;
  voice preset của hai model có thể trộn lẫn.

### B. Binding trực tiếp trợ lý vào `ai_model_config`

- Ưu điểm: một ID model duy nhất cho cả runtime và catalog.
- Nhược điểm: thay đổi domain publication/provider selection, migration lớn và
  có rủi ro làm hỏng các provider config runtime hiện có.

### C. Catalog model-scoped + metadata link từ runtime config (chọn)

- Ưu điểm: giữ boundary runtime `providerConfig` hiện tại; catalog CRUD dùng
  `ai_tts_voice` với `ttsModelId`; trợ lý vẫn chọn provider config nhưng hiển
  thị model code/name/default và link tới catalog.
- Nhược điểm: cần resolver metadata giữa installation/config và model catalog;
  một provider runtime chưa map được model sẽ hiển thị fallback tên config.

## Quyết định

Chọn C.

- Thêm API `/api/v1/models/{id}/voices` cho GET/POST/PATCH/DELETE theo model TTS.
- Giữ `/api/v1/voices` cho runtime/user-created aliases; endpoint này không được
  dùng làm nguồn catalog model-scoped.
- `ModelMemoryView.availableConfigs[].model` là metadata tùy chọn gồm
  `id/code/name/providerCode/isDefault/isEnabled`. Resolver ưu tiên model code
  trong provider config, sau đó provider family/installation token, rồi default
  catalog. Đây là metadata hiển thị, không tự đổi selection.
- Trợ lý dùng model voice `ttsVoice` làm giá trị gửi vào role speech khi có
  catalog; voice hiện tại không còn trong catalog được giữ dưới dạng lựa chọn
  cảnh báo để không làm mất draft.
- Nới cột catalog voice trong migration 012 để khớp validation API/UI và tránh
  lỗi 500 do schema cũ giới hạn `name` 20 ký tự.

## Consequences

### Tích cực

- Nút từ model TTS mở đúng model, có search, preview, select-all, batch delete,
  add/edit/delete và ETag conflict.
- Trợ lý hiển thị model/provider thật, trạng thái model disabled được phản ánh
  thành unavailable.
- Voice cloning/reference audio không bị mở sớm; fields reference được giữ ở
  DB/catalog để tương thích nhưng chưa lộ UI.

### Tiêu cực và guardrails

- Runtime/provider catalog vẫn là hai entity; mọi route/API cần ghi rõ boundary.
- Nếu resolver không tìm thấy model, UI phải hiển thị provider config name và
  không tự chọn model khác.
- Không runtime fallback provider; lỗi catalog là trạng thái rõ ràng.

## Verification

- [x] Manager API InMemory model voice CRUD + ETag test.
- [x] Manager API PostgreSQL model voice CRUD + migration 012 test trên
      `veetee_vubq_test`.
- [x] Web typecheck/lint/build và 119 unit pass.
- [x] Chromium E2E có flow model metadata và TTS voice CRUD/search.
- [ ] Provider model mapping benchmark với mọi installation mới; khi thêm
      installation cần catalog token/manifest metadata tương ứng.

## Liên quan

- ADR-007 — Provider registry lifecycle.
- ADR-013 — Web-published runtime config.
- ADR-033 — Provider control-plane screens.
- `docs/08-manager-design.md`.
