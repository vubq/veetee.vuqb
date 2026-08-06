# Audio và LCD validation — 2026-08-06

## Phạm vi và an toàn

- Chủ dự án đã mở quyền phát audio để kiểm tra ESP32. Không đổi Wi‑Fi của máy,
  NetworkManager, route, firewall hoặc Tailscale; không erase NVS.
- Flash lần này chỉ ghi bootloader, partition table, OTA metadata, model và app
  bằng `idf.py flash`; log cho thấy Wi‑Fi profile vẫn được đọc từ NVS.
- Không ghi raw audio, transcript, API key hoặc pairing code vào repository.
  Report harness chỉ là event/timing đã redact và nằm ngoài Git trong `/tmp`.

## LCD/UI firmware

Sửa `veetee-firmware/main/veetee_display.c` để dùng `lv_display_set_offset()`
cho vùng hiển thị 240×280, đồng bộ với đường LVGL của board; không cộng offset
đồng thời ở panel gap. Thêm log chẩn đoán one-shot cho glyph resources.

Boot sau flash xác nhận:

- `App version: 5567e48`, ESP32-S3 rev 0.2, flash 16 MB, PSRAM 8 MB.
- `text resources ready ascii=1 vi=1 adv=10/12 line16=22 line26=35`.
- `ST7789 LVGL ready 240x280 offset=0,20 spi=2`.
- `startup chime played`, Wi‑Fi profile từ NVS, `server hello accepted`,
  `WebSocket v3 ready`, `state=listening`, `MCP owner task ready`.

Log chứng minh renderer và font đã được tạo/nhận glyph; việc nhìn trực tiếp chữ,
backlight và orientation trên LCD vẫn là physical acceptance, không thể suy ra
chỉ từ serial.

Manager Web public URL cũng đã được mở bằng Chromium: snapshot có `Veetee
Manager`, `Không gian quản trị`, `Đăng nhập`, `Email`, `Mật khẩu` và nút
`Đăng nhập`; screenshot là `output/playwright/ui-public-current.png`. Vì chưa có
plaintext owner password trong scope, dashboard sau auth không được giả nhận là
đã kiểm tra bằng browser authenticated.

## Audio acceptance

Các scenario dùng `idf.py monitor --no-reset`, `pw-play` và explicit
`--allow-audio`:

| Flow | Kết quả |
|---|---|
| Wake → capture → Groq → streaming VieNeu → speaker | 2/2 pass sau flash; cả hai có `state=speaking`, graceful drain và wake re-arm |
| Wake-word interrupt khi AI đang nói | Pass; `wake detected → state=listening → wake interrupt → wake start` |
| Câu thoát bằng giọng nói | Pass; `server alert code=conversation_exit`, không phát câu trả lời dư |
| Wake nhưng không có lời nói | Pass; `NO_SPEECH_TIMEOUT` và wake detector re-arm |
| Continuous conversation | Pass; lượt thứ hai được nhận transcript, speaking và drain về listening |
| Wake corpus | Pass; negative không false-detect, positive `Computer` detect và đi hết flow |

Report redacted tương ứng (ngoài Git):
`/tmp/veetee-wake-groq-audio-post-display.json`,
`/tmp/veetee-barge-in-rerun.json`, `/tmp/veetee-exit-audio-rerun.json`,
`/tmp/veetee-no-speech-audio-rerun.json`, `/tmp/veetee-wake-corpus-rerun.json`,
`/tmp/veetee-continuous-audio.json`.

Metrics Voice Server sau lượt cuối: `active_connections=1`,
`active_turns=0`, `turn_admissions=38`, `turn_releases=38`,
`protocol_errors=0`, `turn_disconnect_aborts=0`, `last_ttfa_ms=1357`.

Sau playback, serial AEC snapshot có `overrun=0` nhưng `underrun=16000`
(`produced=764160`, `consumed=759680`, `resets=4`). Không có panic, decode lỗi
hoặc reboot; chưa tự đổi tuning vì cần phép đo echo-only/voice-onset thực tế để
phân biệt startup/reference drain với underrun gây méo tiếng.

## Regression host

- Voice Server: **192 passed**.
- Manager API InMemory: **39 passed**, **13 skipped** có chủ đích.
- Manager API PostgreSQL database test riêng `veetee_vubq_test`: **52/52 passed**.
- Manager Web: **103 unit passed**, typecheck/lint/build pass, Chromium E2E
  **16/16 passed** (bao gồm a11y serious/critical gate).
- Firmware host CTest: **9/9 passed**; ESP-IDF 6.0.2 build pass, app binary
  `0x1bd6d0`, còn 56% partition.

## Giới hạn còn mở

- PTT bằng tay chưa được giả lập: harness chỉ quan sát GPIO0, không tự gửi
  serial/GPIO input. Cần người dùng giữ/nhả nút để đóng physical PTT gate.
- Serial không thay thế việc người dùng nhìn chữ LCD, nghe chất lượng loa,
  kiểm tra echo-only/time-to-silence hoặc kiểm tra captive portal trên điện thoại.
- `barge_in_count` server không tăng trong wake-word interrupt vì interrupt này
  được firmware xử lý local; đây là hành vi đúng, không phải test fail.
