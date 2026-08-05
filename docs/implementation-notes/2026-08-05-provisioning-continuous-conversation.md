# Provisioning, pairing và hội thoại liên tục — 2026-08-05

## Phạm vi

Slice này nối contract đã thiết kế vào firmware ESP32-S3, Voice Server, Manager
API và Manager Web. Không sửa `references/`, không dùng Docker, không xoá NVS,
không thay Wi-Fi của máy phát triển.

## Luồng đã nối

```text
Wi-Fi thiếu
  → SoftAP/captive portal 192.168.4.1
  → lưu SSID/password vào NVS
  → station online + hello.device_info.pairingCodeHash
  → presence tạo discoverable device
  → Web chọn robot + nhập mã sáu chữ số
  → bind vào assistant
```

Mã plaintext chỉ ở LCD/portal và ô nhập Web. Server/Manager chỉ xử lý SHA-256
64-hex; pairing challenge dùng một lần và có expiry. Compatibility endpoint
challenge `VT-xxxx` vẫn được giữ cho fixture/test cũ.

Luồng hội thoại:

```text
PTT/wake → turn → TTS stream → tts.stop(continue_listening=true)
  → listen.ready → audio đầu tiên mở turn auto mới
  → lặp không giới hạn → idleTimeout (mặc định 180000 ms) → alert + re-arm wake
```

Policy nằm trong snapshot `conversation`; không có fallback provider hoặc xoay
Groq key trong production. `continue_listening` và `listen.ready` đều additive,
peer cũ vẫn xử lý graceful stop.

## Kiểm tra đã chạy

- Voice Server: `uv run pytest -q tests/test_app.py tests/test_config.py tests/test_pipeline.py`
  — pass; có regression hai turn trên cùng WebSocket và idle timeout.
- Manager API: `npm test` — pass; gồm presence hash → discoverable → numeric code
  pairing, OpenAPI route/schema check.
- Manager Web: unit tests, typecheck, lint và production build — pass; Pair dialog
  dùng typed discoverable endpoint, Role editor có policy hội thoại liên tục.
- Firmware host: `ctest --test-dir veetee-firmware/host-tests/build
  --output-on-failure` — 9/9 pass sau pairing module.

## Chưa phải physical acceptance

Chưa dùng các kết quả host để khẳng định LCD, loa, mic, PTT hoặc wake word trên
board thật. Sau khi toàn bộ server/API/Web contract ổn định mới flash không erase
NVS và kiểm tra serial; nghe/nhìn/chạm trên board vẫn là gate riêng.

