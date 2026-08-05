# ADR-033: Tách màn hình catalog, cấu hình provider và voice catalog

## Trạng thái

Accepted

## Context

Màn hình dịch vụ ban đầu đặt sáu nhóm capability, catalog installation, nhiều
provider config, secret reference và TTS voice profile trong một surface. Cách
này đúng về API nhưng khó hiểu với người dùng phổ thông và làm lẫn ba vòng đời
khác nhau. Provider manifest đã có `kind`, capability, locale, protocol và
schema; Manager Web cần giữ metadata đó ở boundary thay vì suy ra từ tên hiển
thị.

## Các phương án

### A — Một trang registry duy nhất

Giữ tabs và toàn bộ editor/list/voice ở cùng route. Ít route hơn nhưng context
dài, khó deep-link và dễ trộn thao tác cấu hình với thao tác quản lý voice.

### B — Overview + route theo capability + route voice riêng

`/providers` chỉ là điểm vào tổng quan. `/providers/:kind` quản lý nhiều config
của đúng một capability; `/providers/tts/voices` quản lý voice profile. Catalog
vẫn schema-driven, còn CRUD vẫn gọi cùng API typed hiện có.

### C — Một route cho từng vendor

Dễ tối ưu copy cho từng vendor nhưng làm UI hardcode provider và phá mục tiêu
thêm provider không sửa web.

## Quyết định

Chọn **B**. Provider installation response được map thành metadata chuẩn gồm
`providerFamily`, `protocol`, `supportedLocales`, `capabilities` và cờ voice
catalog. Metadata chỉ dùng để trình bày/capability gating; schema của manifest
vẫn là nguồn sinh form. Provider config vẫn CRUD độc lập theo `installationId`,
TTS voice profile vẫn CRUD độc lập theo `providerConfigId`.

Groq tiếp tục là preset dùng protocol OpenAI-compatible. Field endpoint của
snapshot cũ được trình bày là `Base URL` và server adapter tiếp tục nhận cả
`baseUrl` lẫn `endpoint` để không làm hỏng revision đã lưu; không đổi provider
identity hoặc thêm fallback.

## Hệ quả

- Người dùng đi từ overview tới đúng nhóm cần thao tác, có deep-link và back link.
- Voice catalog không còn lẫn vào editor provider; built-in voice và custom voice
  vẫn hiển thị cùng read model nhưng chỉ custom voice cho phép sửa/xóa.
- Tăng số route/lazy chunk và cần kiểm thử a11y cho từng route.
- Provider mới vẫn chỉ cần manifest/schema; nếu không khai báo voice catalog,
  UI không tự tạo form voice.

## Kiểm chứng

- Manager Web typecheck, lint, 97 unit tests và Chromium E2E đều pass.
- Route overview, capability route và voice route được đưa vào E2E/a11y matrix.
- Không lưu secret, provider ID nội bộ hoặc raw config bí mật trong UI state ngoài
  phiên thao tác.
