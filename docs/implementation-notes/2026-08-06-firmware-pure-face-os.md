# Firmware Pure Face OS — 2026-08-06

## Phạm vi

Đây là mốc triển khai bản demo Pure Face OS đã được duyệt vào firmware. Chỉ
thay renderer LCD và asset logo; không đổi GPIO, Wi-Fi/NVS, protocol, audio,
state machine, pairing contract hay task FreeRTOS.

## Thay đổi giao diện

- Bỏ card giữa, vòng border lớn và footer pill; màn hình dùng nền full-bleed
  với một activity line mảnh ở y=54.
- Header có mark mắt-only, chữ `VEETEE` và trạng thái kết nối; mọi label đều
  có slot cố định, title một dòng dùng `LV_LABEL_LONG_DOT`.
- Visual trung tâm chỉ gồm aura mềm, mark hai mắt và waveform nhỏ ở
  listening/speaking; idle/thinking không hiển thị waveform.
- Pairing/notice/error dùng cùng trục dọc nhưng không đặt nội dung trong card;
  mã 6 số và message có vùng riêng, không chồng nhau.

## Asset logo

`veetee-firmware/main/assets/veetee_logo.c` là ảnh LVGL ARGB8888 64×36 được
derivative từ đúng `veetee-server/apps/manager-web/public/favicon.svg` mà chủ
dự án chỉ định. Crop source view render 64×64 tại `x=8..55, y=13..39`, chỉ
giữ dải hai mắt và loại vùng miệng; không dùng code/CSS/component khác của repo
đó. SHA-256 nguồn:
`7f5af039680e9853e0f8f3fc581b9c490fad36c25392a61185787d01b5a0d7b8`.

## Verification

- `git diff --check`: pass.
- ESP-IDF 6.0.2: `idf.py -C veetee-firmware build` pass; app `0x1c5f70`,
  còn 55% partition.
- Firmware host tests: `ctest --test-dir veetee-firmware/host-tests/build
  --output-on-failure`: **9/9 pass**.
- Đã flash `/dev/ttyACM0` bằng `idf.py ... flash`, không erase NVS/Wi-Fi.
- Serial sau flash xác nhận `text resources ready ascii=1 vi=1`,
  `ST7789 LVGL ready 240x280`, startup chime, WakeNet, Wi-Fi NVS và
  WebSocket v3; không thấy panic/reboot trong log capture.

## Giới hạn nghiệm thu

Serial không thể xác nhận màu/pixel thực tế. Cần nhìn trực tiếp LCD để nghiệm
thu pairing, idle, listening, thinking, speaking và notice/error; mốc này
không phát audio.
