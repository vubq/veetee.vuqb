# Firmware Eyes OS và logo thương hiệu — 2026-08-06

> Ghi chú lịch sử của bản card Eyes OS. Bản firmware hiện tại đã chuyển sang
> Pure Face OS; xem [`2026-08-06-firmware-pure-face-os.md`](2026-08-06-firmware-pure-face-os.md).

## Phạm vi

Lát cắt này chỉ chỉnh renderer LCD của `veetee-firmware`: bố cục cố định cho
ST7789 240×280, xử lý text tiếng Việt không tràn slot và đưa favicon/logo do
chủ dự án cung cấp vào header. Không đổi GPIO, Wi-Fi/NVS, protocol, audio,
state machine hay pairing contract.

## Nguyên nhân UI cũ

- Header có nhiều thành phần cạnh tranh cùng một hàng; state chip tiếng Anh
  làm giảm chỗ cho tiếng Việt.
- Label động có thể wrap theo chiều cao tự nhiên, khiến title/hint lấn vùng
  sibling trên màn hình nhỏ.
- Notice dùng lại message ở footer nên hierarchy khó đọc.

## Thay đổi

- Dùng fixed-slot layout: header, activity bar, card visual/title/hint và
  footer pill có tọa độ/kích thước cố định; label một dòng dùng
  `LV_LABEL_LONG_DOT`.
- Fallback resource được rút gọn bằng tiếng Việt; resource bundle vẫn là
  boundary để locale khác thay text mà không sửa renderer.
- Xóa helper vẽ mắt bằng primitive LVGL. Asset
  `veetee-firmware/main/assets/veetee_logo.c` là raster 32×32 ARGB8888 từ
  đúng `veetee-server/apps/manager-web/public/favicon.svg` của repo được chỉ
  định. SHA-256 nguồn:
  `7f5af039680e9853e0f8f3fc581b9c490fad36c25392a61185787d01b5a0d7b8`.
  Không sử dụng component, CSS hay logic khác của repo đó.

## Verification

- `git diff --check`: pass.
- ESP-IDF 6.0.2: `idf.py -C veetee-firmware build` pass; app 0x1c48b0,
  còn 55% partition.
- Firmware host tests: `ctest --test-dir veetee-firmware/host-tests/build
  --output-on-failure`: **9/9 pass**.
- Đã flash `/dev/ttyACM0` bằng `idf.py ... flash`, không erase NVS/Wi-Fi.
- Serial sau flash xác nhận `text resources ready ascii=1 vi=1`,
  `ST7789 LVGL ready 240x280`, startup chime, WakeNet, Wi-Fi NVS và
  WebSocket v3; không thấy panic/reboot trong log capture.

## Giới hạn nghiệm thu

Log chứng minh firmware khởi tạo thành công nhưng không thay thế việc nhìn
trực tiếp LCD. Cần nghiệm thu vật lý các màn pairing, idle, listening,
thinking, speaking và notice/error để xác nhận màu/độ tương phản và hướng
panel. Lát cắt này không phát audio.
