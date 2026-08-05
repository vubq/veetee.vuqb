# Design: capability-first providers and firmware OS display

## Mục tiêu

Làm cho phần quản trị provider phản ánh đúng các capability độc lập của server
(VAD, ASR, LLM, TTS, Intent, Memory), cho phép một capability có nhiều
installation và nhiều cấu hình có tên riêng. Người dùng không phải hiểu JSON
để cấu hình các provider thông dụng, nhưng provider mới vẫn có thể đăng ký
bằng manifest/schema mà không sửa domain core. TTS có thư viện voice riêng,
gắn với từng TTS config; voice do manifest cung cấp chỉ là mặc định, còn voice
do người dùng thêm có vòng đời độc lập.

Firmware hiển thị theo screen registry và state/overlay event, tạo cảm giác như
một hệ điều hành nhỏ: pairing, home, connecting, listening, thinking/tool,
speaking, interrupted, notice và error. Renderer chỉ nhận resource text/status
và không chứa provider, model hay wake phrase business logic.

## Quyết định thiết kế

Chọn hybrid capability-first:

1. Mỗi capability có route/page riêng và chỉ hiển thị installation/config thuộc
   capability đó. Trang tổng quan chỉ dùng để điều hướng và hiển thị số lượng.
2. `ProviderConfigList` là component danh sách dùng chung (tìm kiếm, chọn,
   probe, archive/delete), nhưng editor được tạo từ `ProviderEditorShell` với
   adapter typed theo provider family.
3. Family `openai-compatible` dùng các field chuẩn `baseUrl`, `apiKey` (secret
   reference), `model`, sampling/limits, headers/options. Groq là preset của
   family này; adapter đọc `endpoint` cũ một lần và ghi canonical `baseUrl`.
4. VieNeu có editor TTS riêng cho model/backend/precision/sample-rate và link
   trực tiếp tới voice catalog. Các provider khác dùng schema-driven fields;
   schema không có primitive field vẫn có vùng advanced rõ ràng.
5. API giữ CRUD/ETag/archive hiện có, thêm metadata chuẩn hóa trong catalog;
   không thêm production fallback. Việc chọn provider cho assistant vẫn là
   thao tác riêng ở màn hình Model.
6. Firmware dùng enum screen + `vt_display_transition()` và overlay state;
   mọi transition hợp lệ được kiểm thử host. Các text/icon mặc định nằm trong
   resource bundle để có thể thay locale/config sau này.

## Luồng người dùng

`Dịch vụ AI → capability → installation → config list → config editor`.

Tại TTS, nút “Thư viện giọng đọc” mở `/providers/tts/voices`; người dùng chọn
TTS config, thêm/sửa/ẩn/xóa voice profile và sau đó chọn voice ở assistant.
Nút “Tạo cấu hình” luôn tạo bản ghi độc lập, không thay đổi config đang được
assistant sử dụng. Xóa là archive có ETag và bị từ chối nếu còn được tham
chiếu.

## Adapter contract (pseudo-interface)

```ts
interface ProviderEditorAdapter {
  matches(installation: ProviderInstallationView): boolean
  normalizeDraft(config: Record<string, unknown>): Record<string, unknown>
  toPayload(config: Record<string, unknown>): Record<string, unknown>
  sections(installation: ProviderInstallationView): EditorSection[]
}
```

`SchemaConfigForm` vẫn là renderer cuối cho section schema; adapter chỉ đổi
label, thứ tự, preset và migration, không nhúng logic vendor vào API route.

## Firmware screen model

Mỗi screen có `screen_id`, `title`, `hint`, `accent`, `connection`, và tùy chọn
overlay timeout. `vt_display_show_state()` chọn screen theo device state;
`vt_display_show_notice/interrupted/error()` đẩy overlay và
`vt_display_tick()` khôi phục state trước đó. Thinking có subtitle “đang xử
lý/công cụ” thay vì giả lập nội dung LLM. Pairing là flow riêng và luôn ưu tiên
khi thiết bị chưa provision.

## Xử lý lỗi và kiểm thử

- Catalog/config/secret lỗi hiển thị trạng thái retryable, không để editor cũ
  trông như dữ liệu hiện tại.
- Provider config dùng ETag; lỗi conflict giữ draft trên màn hình.
- Unknown secret reference vẫn được bảo toàn khi sửa config.
- Test Web: từng capability route, adapter Groq canonicalization, TTS voice
  CRUD, archive và retry/offline.
- Test firmware host: mapping state→screen, overlay timeout, wrap-around timer,
  invalid transition; chỉ chạy build/CTest, không phát audio hoặc flash.

## Các phương án đã cân nhắc

- **A — Một editor generic duy nhất:** ít file nhưng UX quá bao quát và không
  thể diễn đạt khác biệt TTS/LLM.
- **B — Mỗi provider một màn hình hoàn toàn riêng:** UX rõ nhưng lặp code,
  provider mới cần sửa nhiều nơi.
- **C — Hybrid (đã chọn):** capability page riêng + schema base + adapter typed;
  cân bằng khả năng mở rộng và trải nghiệm cấu hình.
