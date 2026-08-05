# Kiểm tra follow-up provisioning, hội thoại và UX — 2026-08-05

## Phạm vi

Kiểm tra trên checkout mới của Veetee, runtime host-native đang chạy bằng
database `veetee_vubq`, và ESP32-S3 đã cắm tại `/dev/ttyACM0`. Không thay Wi-Fi
của máy dev, không xoá NVS, không thay đổi `references/`, không ghi raw audio,
transcript hoặc secret vào repository.

## Regression host

- Voice Server: `uv run pytest -q` — **177 passed**.
- Manager API InMemory: **36 passed**, 12 PostgreSQL test bị skip khi không có DSN.
- Manager API PostgreSQL: tạo database test riêng `veetee_vubq_test`, chạy đủ
  **48 passed / 0 skipped**, rồi drop đúng database test; database runtime
  `veetee_vubq` không bị dùng cho test destructive.
- Manager Web: typecheck, ESLint, Vitest **96/96**, production build pass.
- Firmware host: CTest **9/9 passed**.

## Kiểm tra physical đã được chủ dự án cho phép

### Firmware provisioning portal

- Thêm các captive-probe route additive: Android `generate_204`, Apple
  `hotspot-detect.html`, Windows `connecttest.txt`/`ncsi.txt` và các probe tương
  đương trả `302` về `http://192.168.4.1/?_=<tick>`, kèm `Cache-Control: no-store`.
- `/favicon.ico` trả `204`; đường dẫn không biết không còn bị wildcard trả HTML,
  để captive WebView không diễn giải nhầm một resource lạ là trang thành công.
- ESP-IDF build pass, image `0x1650e0`, app partition còn 65%; flash vào
  `/dev/ttyACM0` không erase NVS. Sau reboot serial ổn định với `wake_ready=1`,
  `capture=0`, AEC không underrun/overrun mới và Voice Server còn
  `activeConnections=1`.
- Chưa có client điện thoại kết nối SoftAP trong lượt này, nên redirect/DHCP/DNS
  vẫn cần physical acceptance riêng trên Android/iOS/Windows.

### Wake → nói → trả lời

Harness `tools/physical/wake_audio_test.py` với `wake-test.example.json` và
`--allow-audio` đã chạy một repetition thành công:

```text
wake detected → wake start → state=speaking → wake detector armed
```

Audio player trả exit code 0 cho cả clip wake và clip utterance. Sau khi chờ
TTS drain, Voice Server về `active_turns=0`, `protocol_errors=0`; lượt được
enqueue/send vào history reporter. Harness chỉ lưu timing/marker đã redact trong
`/tmp/veetee-wake-20260805-followup.json`.

### Wake-word interrupt khi đang nói

Harness `wake-barge-in.example.json` đã chạy thành công:

```text
state=speaking → interrupt wake detected → state=listening
→ wake interrupt → wake start
```

Đây là bằng chứng lifecycle interrupt ở firmware. Counter
`barge_in_count` của Voice Server không tăng vì đây là wake-word abort do firmware
gửi, không phải acoustic-duplex barge-in do server VAD xác nhận. Acoustic AEC,
time-to-silence và false accept/reject vẫn là gate đo riêng.

## Kiểm tra Web/UI

- Preview mode tại `http://127.0.0.1:18081/providers` render đủ provider schema,
  secret reference, probe, archive và trạng thái rỗng/lỗi.
- Sửa dialog đổi khóa để input password nằm trong native `<form>`; Enter submit
  cùng đường với nút lưu và không còn cảnh báo “Password field is not contained in
  a form”. Visual baseline không đổi.
- API mode production vẫn yêu cầu cookie auth; chưa dùng credential owner trong
  kiểm tra browser nên không tuyên bố login/API mutation physical pass.

## Giới hạn còn mở

- Chưa có bằng chứng người dùng nhìn trực tiếp LCD/backlight/orientation, nghe
  chất lượng loa, kiểm tra âm lượng/echo và thao tác PTT bằng tay.
- Chưa đóng 100-repetition wake corpus, acoustic-only barge-in và TTFA p95 theo
  định nghĩa E2E đầy đủ; các số đo runtime chỉ là evidence của lượt vừa chạy.
- Pairing thực tế vẫn cần người dùng đọc mã sáu chữ số trên LCD rồi nhập ở Web;
  không trích plaintext pairing code từ NVS.
