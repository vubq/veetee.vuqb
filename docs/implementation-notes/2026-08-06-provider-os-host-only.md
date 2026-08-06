# Host-only follow-up — capability provider screens and firmware OS model

## Phạm vi

Đợt này chỉ sửa và kiểm thử host-side. Theo khóa do chủ dự án đặt, không phát
audio, không mở microphone/loa, không flash/reset/erase ESP32 và không đổi Wi-Fi,
route, firewall hoặc Tailscale. Việc chấp nhận vật lý LCD/nút/wake/audio để sau
khi chủ dự án cấp quyền.

## Provider control plane

- Màn hình cũ overview/capability đã được thay bằng hai workflow source-shaped:
  `/model-config` (alias `/providers`) cho model và `/provider-management` cho
  provider schema.
- Model Configuration có sidebar chín nhóm, search, pagination, selection,
  add/edit/duplicate/delete, enable/default và link voice riêng cho TTS.
- Provider Management có search/category filter, selection, field inspector,
  add/edit/delete và batch delete. Field list được lưu trong registry JSON/JSONB;
  component chỉ render schema, không hard-code vendor/model.
- Seed mới bám data model/source catalog (63 providers, 67 model configs) và có
  thêm đúng các model đã dùng để test realtime: PhoWhisper-small (ASR), Groq
  `llama-3.3-70b-versatile` (LLM), VieNeu v3 Turbo (TTS). Ba lựa chọn này là
  `is_default=1` tương ứng từng loại; Silero VAD, session memory và intent
  mặc định source vẫn được giữ. Seed cũng có 3 built-in voice rows, trong đó
  `Minh Đức` liên kết `TTS_VieNeu`.
- Migration `011_replace_model_control_plane_with_source_schema.sql` xóa bảng
  catalog Veetee-specific cũ và tạo lại đúng cột source; API seed lại từ
  `config/model-registry.json` khi hai bảng rỗng. Các model runtime đã publish
  trong `assistant/provider_config` không bị xóa.
- `ai_model_provider`/`ai_model_config` giữ đúng cột nghiệp vụ source trong
  PostgreSQL; owner/revision/etag chỉ là metadata ảo do API tính để giữ ETag và
  client contract, không làm lệch schema/data source trong DB.
- Preview mock không giữ một catalog rút gọn riêng nữa: `model-registry.seed.json`
  có cùng SHA-256 với `veetee-manager-api/config/model-registry.json`, mapper chỉ
  bổ sung metadata transport. Vì vậy preview cũng có đủ 63 provider, 67 model
  và vẫn giữ các default PhoWhisper/Groq/VieNeu đã kiểm thử.
- `provider_config` revision tables, secret store, voice runtime và
  WebSocket/audio pipeline giữ nguyên để không ảnh hưởng luồng hội thoại đã
  test. Không thêm production fallback.

## Firmware display

Thêm `veetee_screen_model.[ch]` làm pure state/screen contract, được dùng bởi
LVGL renderer và host test. Màn hình có pairing, home, connecting, listening,
thinking, speaking cùng overlay interrupted/notice/error; state chip và activity
track giúp phân biệt trạng thái trên LCD 240×280 mà không đưa business/provider
logic vào renderer.

## Bằng chứng kiểm thử

- Manager API: 41 passed, 14 skipped có chủ đích.
- Manager Web unit: 111 passed (bao gồm fixture source-alignment).
- Manager Web typecheck/lint/build: pass.
- Manager Web Chromium E2E: 16/16 pass.
- Firmware host CTest: 9/9 pass.
- ESP-IDF 6.0.2 build-only: pass, app `0x1bd6a0`, partition còn 56%.

Các kết quả trên không thay thế physical acceptance. Không có counter audio mới
được tạo trong đợt này.

## Provider management alignment — host-only follow-up

Các hành vi được đối chiếu trực tiếp từ source read-only:

- Màn hình quản lý có tìm kiếm, lọc theo category, bảng có selection, xem field,
  sửa/xóa và nút thêm/batch action tại
  `references/xiaozhi-esp32-server/main/manager-web/src/views/ProviderManagement.vue:11-77`.
- Provider form cho phép chọn category/provider, đặt tên và hiển thị field động
  (key/label/type/default) tại
  `references/xiaozhi-esp32-server/main/manager-web/src/components/ProviderDialog.vue:12-119`.
- Model configuration có điều hướng theo từng capability, bảng model/provider,
  enable/default, duplicate/delete và quản lý voice riêng cho TTS tại
  `references/xiaozhi-esp32-server/main/manager-web/src/views/ModelConfig.vue:25-57` và
  `references/xiaozhi-esp32-server/main/manager-web/src/views/ModelConfig.vue:63-237`.

Veetee áp dụng cùng mental model bằng component Vue hiện có:

- `/model-config` dùng data từ `ai_model_config` và `ai_model_provider`, còn
  `/provider-management` chỉ quản lý provider schema; `/providers` được giữ làm
  alias để bookmark cũ không hỏng.
- Provider/model được seed từ JSON registry và thao tác qua Fastify API; không
  có vendor/model branch trong component. Secret chỉ là reference/metadata,
  không trả raw value.
- `enabled` và `default` là mutation độc lập, có ETag ở API; model mặc định
  đang bật không thể bị tắt trực tiếp.
- Các alias API `/models/provider`, `/models/list`, `/models/enable/...` và
  `/models/default/...` chỉ là additive compatibility, không đổi wire/audio.
