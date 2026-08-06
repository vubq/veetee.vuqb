# ADR-033: Dùng hai màn hình control-plane theo model/provider

## Trạng thái

Accepted — supersedes the previous overview/capability mental model.

## Context

Khu vực `/providers` trước đây trộn provider installation, provider config,
secret reference, voice catalog và các capability riêng vào một màn hình. Người
dùng phải hiểu một vocabulary nội bộ trước khi cấu hình được model. Source tham
khảo tách rõ hai công việc:

- `ModelConfig.vue` có sidebar theo model type, bảng model, enable/default,
  duplicate/delete và voice management cho TTS (`references/xiaozhi-esp32-server/main/manager-web/src/views/ModelConfig.vue:25-57`,
  `:63-237`).
- `ProviderManagement.vue` quản lý schema provider độc lập với search, category,
  selection, field inspector và batch action
  (`references/xiaozhi-esp32-server/main/manager-web/src/views/ProviderManagement.vue:11-77`).

Người dùng yêu cầu giữ đúng mental model, data seed và database table naming của
source, nhưng Veetee vẫn cần owner scope, ETag và secret-reference để không làm
hỏng control-plane hiện có.

## Options

### A — Giữ overview hiện tại

Ít thay đổi nhưng tiếp tục trộn khái niệm, không tương thích với thao tác quen
thuộc của người dùng source.

### B — Tách `Model Configuration` và `Provider Management`

Hai route độc lập, schema-driven, cùng dùng `ai_model_provider` và
`ai_model_config`; provider/model CRUD không hard-code trong component.

### C — Clone nguyên frontend/API source

Khớp giao diện nhanh nhưng kéo theo framework, database assumptions và code
không thuộc Veetee; cũng làm mất boundary bảo mật của Manager API.

## Decision

Chọn **B**.

- `/model-config` (giữ alias `/providers`) là màn hình Model Configuration;
  `/provider-management` là màn hình Provider Management.
- `ai_model_provider` và `ai_model_config` giữ đúng tên/bộ field nghiệp vụ
  source: `model_type`, `provider_code`, `model_code`, `model_name`,
  `is_default`, `is_enabled`, `config_json`, `fields`, `doc_link`, `remark`,
  `sort` cùng creator/updater/date. DB không thêm `owner_id`, `revision`,
  `etag`, `updated_at`; API chỉ tính metadata virtual để giữ ETag/client
  contract của Veetee.
- Migration `011_replace_model_control_plane_with_source_schema.sql` xóa
  catalog cũ và tạo lại bảng theo source; lần khởi động tiếp theo seed lại từ
  `config/model-registry.json`. Seed giữ data source (VAD, ASR, LLM, TTS,
  Memory, Intent và category mở rộng) đồng thời giữ các lựa chọn đã kiểm thử
  của Veetee: PhoWhisper-small, Groq `llama-3.3-70b-versatile` và VieNeu v3
  Turbo đều là default tương ứng; credential vẫn chỉ là secret reference.
- Secret trong seed luôn rỗng; field nhạy cảm chỉ có metadata `sensitive`, không
  lưu API key thật.
- `provider_config` revision tables, WebSocket/audio/session và firmware wire
  contract không bị thay đổi; đó là runtime compatibility boundary, không phải
  màn hình catalog mà quyết định này thay thế.

## Consequences

### Positive

- Người dùng thấy đúng hai workflow quen thuộc: khai báo schema provider rồi
  tạo model từ schema.
- Provider mới/model mới chỉ thêm registry data; component không chứa vendor
  switch hay model-specific branch.
- API có thêm alias `/models/provider`, `/models/list`, `/models/enable/...` và
  `/models/default/...` để client source-shaped có thể tích hợp.

### Negative

- Một số metadata Veetee (owner/ETag) không xuất hiện trong source UI nhưng vẫn
  xuất hiện trong API response.
- Runtime provider config cũ còn tồn tại để bảo toàn hội thoại; cần tài liệu
  hóa rõ đây không phải catalog UI.
- Data migration reset catalog model/provider; người dùng phải nhập lại các
  model custom sau khi nâng cấp nếu chúng không có trong registry seed.

## Verification

- `veetee-manager-api`: `npm test`, `npm run lint`, `npm run openapi:check`.
- `veetee-manager-web`: `npm run typecheck`, `npm run lint`, `npm run test:unit`,
  `npm run build`.
- Browser smoke: `/model-config`, `/provider-management`, add/edit/duplicate,
  field inspector, enable/default, delete và TTS voice link.
