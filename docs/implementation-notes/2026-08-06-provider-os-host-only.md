# Host-only follow-up — capability provider screens and firmware OS model

## Phạm vi

Đợt này chỉ sửa và kiểm thử host-side. Theo khóa do chủ dự án đặt, không phát
audio, không mở microphone/loa, không flash/reset/erase ESP32 và không đổi Wi-Fi,
route, firewall hoặc Tailscale. Việc chấp nhận vật lý LCD/nút/wake/audio để sau
khi chủ dự án cấp quyền.

## Provider control plane

- `/providers` chỉ điều hướng theo sáu capability.
- `/providers/:kind` có catalog installation riêng, danh sách nhiều config riêng
  và editor theo provider family.
- `openai-compatible` dùng `baseUrl` canonical; `groq.chat` là preset cùng
  family. Store vẫn đọc payload/revision cũ có `endpoint` và ghi lại canonical.
- VieNeu giữ editor/schema TTS riêng về mặt family metadata; voice catalog vẫn
  ở `/providers/tts/voices`, CRUD voice profile theo `providerConfigId`, ETag và
  archive.
- Không thêm production fallback.

## Firmware display

Thêm `veetee_screen_model.[ch]` làm pure state/screen contract, được dùng bởi
LVGL renderer và host test. Màn hình có pairing, home, connecting, listening,
thinking, speaking cùng overlay interrupted/notice/error; state chip và activity
track giúp phân biệt trạng thái trên LCD 240×280 mà không đưa business/provider
logic vào renderer.

## Bằng chứng kiểm thử

- Manager API memory: 39 passed, 13 skipped có chủ đích.
- Manager Web unit: 103 passed (bao gồm adapter canonicalization).
- Manager Web typecheck/lint/build: pass.
- Manager Web Chromium E2E: 16/16 pass.
- Firmware host CTest: 9/9 pass.
- ESP-IDF 6.0.2 build-only: pass, app `0x1bd6a0`, partition còn 56%.

Các kết quả trên không thay thế physical acceptance. Không có counter audio mới
được tạo trong đợt này.
