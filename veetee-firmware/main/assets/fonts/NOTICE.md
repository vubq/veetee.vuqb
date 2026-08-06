# Font asset notice

`veetee_font_vietnamese_16.c` và `veetee_font_vietnamese_26.c` được tạo từ
**Noto Sans Regular** (subset Latin/Vietnamese, anti-aliased 4 bpp) bằng
`lv_font_conv` với `--no-compress`. Noto Sans được phát hành theo SIL Open Font
License 1.1.

- Nguồn: <https://fonts.google.com/noto/specimen/Noto+Sans>
- Giấy phép: <https://scripts.sil.org/OFL>

Các file C là asset đã biên dịch để firmware không cần đọc TTF lúc chạy. Dùng
`--no-compress` là có chủ ý: dữ liệu glyph phải khớp với
`.bitmap_format = 0` của LVGL, không phụ thuộc decoder RLE hoặc cấp phát heap
trong lúc vẽ text.

Lệnh tái tạo (đã pin `lv_font_conv@1.5.3`):

```text
npx --yes lv_font_conv@1.5.3 --size 16 --bpp 4 --format lvgl \
  --font /usr/share/fonts/truetype/noto/NotoSans-Regular.ttf \
  -r 0x20-0x7E -r 0xA0-0xFF -r 0x100-0x17F -r 0x1EA0-0x1EF9 \
  --no-compress --lv-font-name veetee_font_vietnamese_16 \
  -o veetee-firmware/main/assets/fonts/veetee_font_vietnamese_16.c

npx --yes lv_font_conv@1.5.3 --size 26 --bpp 4 --format lvgl \
  --font /usr/share/fonts/truetype/noto/NotoSans-Regular.ttf \
  -r 0x20-0x7E -r 0xA0-0xFF -r 0x100-0x17F -r 0x1EA0-0x1EF9 \
  --no-compress --lv-font-name veetee_font_vietnamese_26 \
  -o veetee-firmware/main/assets/fonts/veetee_font_vietnamese_26.c
```
