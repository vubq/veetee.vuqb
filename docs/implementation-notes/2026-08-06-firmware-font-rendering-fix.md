# Sửa lỗi chữ nhiễu trên LCD firmware — 2026-08-06

## Chẩn đoán

Ảnh LCD cho thấy panel, màu nền và các hình học đã được vẽ đúng nhưng mọi glyph
đều bị nhiễu. Kiểm tra asset cho thấy font được tạo bằng `lv_font_conv` ở chế độ
RLE mặc định, trong khi descriptor lại khai báo `.bitmap_format = 0` (plain).
Ví dụ glyph `A` rộng 11, cao 12 cần 66 byte plain nhưng span bitmap chỉ dài 54
byte; LVGL đọc tiếp vào dữ liệu glyph kế tiếp. Decoder nén lại đang tắt trong
`sdkconfig`, nên không thể sửa bằng metadata runtime.

## Thay đổi

- Tái sinh `veetee_font_vietnamese_16.c` và `veetee_font_vietnamese_26.c` bằng
  `lv_font_conv --no-compress`; cả hai giữ subset Latin/Vietnamese, 4 bpp và
  `.bitmap_format = 0` tương ứng dữ liệu plain.
- Giữ `LV_USE_FONT_COMPRESSED` tắt để không thêm cấp phát heap theo glyph trong
  lúc render.
- Ghi lệnh tái tạo và lý do lựa chọn vào
  `veetee-firmware/main/assets/fonts/NOTICE.md`.

## Verification

- Static asset audit: mỗi file có 409 glyph; mọi bitmap span khớp
  `ceil(box_w * box_h / 2)`, không có span sai.
- `git diff --check`: pass.
- ESP-IDF 6.0.2 build: pass; app `0x1c3910`, partition còn 55%.
- Flash `/dev/ttyACM0` ở 115200: hash verify pass cho bootloader, partition,
  OTA metadata, model và app; không chạy `erase-flash`, NVS/Wi-Fi được giữ lại.
- Serial sau reset: `text resources ready ascii=1 vi=1`, `ST7789 LVGL ready
  240x280 offset=0,20`, WakeNet ready, Wi-Fi profile từ NVS, WebSocket v3 ready;
  không có panic hoặc lỗi font.

## Giới hạn acceptance

Serial chứng minh image mới và font descriptor đã khởi tạo, nhưng không thay thế
việc nhìn trực tiếp glyph trên LCD. Cần chủ dự án xác nhận ảnh mới không còn nhiễu
và các chuỗi tiếng Việt (ví dụ `Kết nối thiết bị`, `Đang nghe`, `Sẵn sàng`) đọc
được ở khoảng cách sử dụng thực tế.

Rollback an toàn là flash lại commit trước khi thay đổi asset; không cần xóa NVS.
