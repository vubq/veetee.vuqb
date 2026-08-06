# TTS catalog và đồng bộ model trong trợ lý — 2026-08-06

## Vấn đề đã xác nhận

- Trang thư viện giọng trước đây chỉ gọi `/api/v1/voices` theo locale/provider
  config, không đọc `modelId` từ URL nên voice của nhiều model có thể bị trộn.
- Trợ lý chỉ hiển thị tên runtime provider config, không hiển thị model code/name
  hoặc default model từ catalog.
- Web tham chiếu có model-scoped voice table với search, audio preview,
  select-all, batch delete và CRUD (`references/xiaozhi-esp32-server/main/manager-web/src/components/TtsModel.vue:7-102`,
  `references/xiaozhi-esp32-server/main/manager-web/src/components/TtsModel.vue:171-208`,
  `references/xiaozhi-esp32-server/main/manager-web/src/components/TtsModel.vue:439-509`).

## Thay đổi đã thực hiện

- Thêm `ModelTtsVoice` domain/store và CRUD model-scoped trong InMemory +
  PostgreSQL.
- Thêm routes:
  - `GET/POST /api/v1/models/{id}/voices`;
  - `PATCH/DELETE /api/v1/models/{id}/voices/{voiceId}`;
  - OpenAPI artifact và typed client được generate lại.
- Thêm migration `012_expand_tts_voice_catalog_fields.sql`: nới các cột voice
  cũ để không 500 khi tên/metadata hợp lệ từ API vượt giới hạn source 20 ký tự.
- `ModelMemoryView.availableConfigs` có metadata model (`id`, code, name,
  providerCode, default/enabled); UI trợ lý hiển thị model thật và link TTS tới
  đúng model catalog.
- `ProviderVoiceCatalogView` chọn model TTS theo query/default; panel mới có:
  search, clear filter, select all, batch delete, add/edit/delete, ETag conflict,
  model/provider context và custom audio preview button.
- Role config ưu tiên voice catalog của model TTS đang chọn và lưu `ttsVoice` code;
  voice hiện tại không còn trong catalog được giữ dưới dạng cảnh báo để không
  mất draft. Voice cloning/reference audio vẫn deferred.
- Provider registry không còn nhúng panel voice alias không gắn model; có CTA tới
  thư viện model-scoped.

### Chuẩn hóa ngôn ngữ và dữ liệu

- Catalog nguồn tại `veetee-manager-api/config/model-registry.json` và fixture
  Web đã được chuyển sang tiếng Việt bằng boundary localization, không đổi
  identifier hoặc giá trị wire.
- Migration `013_localize_model_catalog_to_vietnamese.sql` được làm sạch để
  không chứa literal CJK nhưng vẫn loại bỏ dữ liệu legacy khi import; migration
  `014_polish_vietnamese_model_catalog_names.sql` giữ các tên hiển thị chuẩn.
- Đã backup database trước khi cập nhật checksum migration; database
  `veetee_vubq` được quét toàn bộ cột text/json trong schema quản lý và hiện có
  **0 giá trị chứa ký tự Trung**. Source project (trừ `references/`, dependency,
  artifact build) cũng có **0 ký tự Trung**.

## Kiểm thử

- Manager API InMemory: **58 tests, 43 pass, 15 PostgreSQL tests skip khi không
  truyền DSN**.
- Manager API với `VEETEE_TEST_DATABASE_URL_FILE=../secrets/manager-test.database-url`:
  **58/58 pass**, gồm PostgreSQL model TTS voice CRUD.
- Manager Web: **119/119 unit pass**, typecheck/lint/build pass.
- Chromium E2E: **21/21 pass**, gồm model metadata link và TTS voice CRUD/search.
- Voice Server regression: **194 passed**, Ruff và compileall pass; runtime
  readiness đang ở revision 13 và publication xác nhận `speech.voiceId =
  "minh_duc"`.
- OpenAPI: export/check pass.

## Giới hạn còn lại

- Voice preview chỉ phát URL demo đã cấu hình; chưa sinh audio preview từ TTS
  provider vì voice cloning/reference audio chưa nằm trong scope.
- Resolver model metadata dùng provider family/installation token; provider
  installation mới cần khai báo token/family rõ trong manifest hoặc model config.
- Chưa thực hiện audio/ESP32 physical test trong lát cắt này; thay đổi chỉ ở
  Manager API/Web/catalog DB.
