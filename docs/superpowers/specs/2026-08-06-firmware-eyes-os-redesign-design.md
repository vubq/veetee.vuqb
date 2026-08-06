# Veetee Eyes OS — thiết kế lại UI firmware

## Trạng thái

Được chọn để triển khai sau khi rà lại mockup `eyes-os-v2.html` trên canvas
240×280. Wire protocol, state machine, audio task và pairing flow không đổi.

## Vấn đề của bản cũ

- Header dùng cả brand text, state chip và connection label nên bị chật ở 240 px.
- Title 26 px có line-height lớn hơn slot; hint dài có thể wrap ra ngoài card.
- State chip dùng nhãn tiếng Anh và cạnh tranh chiều cao với activity bar.
- Notice lặp lại cùng một message ở card và footer.
- Không có điểm nhận diện hình ảnh ổn định cho thương hiệu.

## Quyết định thiết kế

Chọn hướng **Conversation OS** với favicon/logo hai mắt do chủ dự án cung cấp:

1. Header cố định cao 42 px: logo hai mắt bên trái, trạng thái kết nối ngắn bên
   phải. Không render brand text cạnh logo.
2. Activity bar cố định bên dưới header, rộng theo toàn màn hình; màu lấy từ
   state, không thêm state chip tiếng Anh.
3. Vùng visual cố định ở giữa: vòng tròn + lõi màu; listening/speaking có wave
   bars nhỏ. Không để visual đẩy text theo nội dung.
4. Mỗi state có một title một dòng và một hint tối đa hai dòng trong slot cố
   định. Title/hint động dùng mode clip/dots khi vượt slot để không lấn vùng khác.
5. Footer là một action pill cố định, không chứa câu dài. Pairing có layout riêng
   ưu tiên mã 6 số; notice/error không lặp message ở footer.
6. Logo dùng đúng ảnh `public/favicon.svg` được rasterize thành LVGL image
   `main/assets/veetee_logo.c` ở 32×32 ARGB8888. Không copy component, CSS hay
   logic từ repo tham chiếu; checksum nguồn được ghi trong asset để kiểm tra
   nguồn. Kích thước nhỏ giúp alpha ở góc bo vẫn rõ trên ST7789.
7. Resource text vẫn đi qua `vt_display_texts_t`; fallback mặc định được rút gọn
   để vừa slot, không đưa business/provider/wake phrase vào renderer.

## Bố cục chuẩn

```text
0..41    header: eye mark + connection status
42..45   activity bar
46..153  visual region: ring/core/wave
154..184 title (one line)
185..226 hint (maximum two lines)
238..267 footer action pill
```

Pairing dùng cùng header/footer nhưng thay visual bằng title → instruction → mã
ghép nối → hint. Notice/error dùng title → message và không tái sử dụng message
ở footer.

## State mapping

| State | Title mặc định | Hint mặc định | Accent |
|---|---|---|---|
| idle | Sẵn sàng | Nhấn nút hoặc gọi từ khóa | xanh dương |
| connecting | Đang kết nối | Đang mở kết nối | vàng |
| listening | Đang nghe | Bạn cứ nói | xanh ngọc |
| thinking | Đang xử lý | Đang tìm câu trả lời | cam |
| speaking | Đang nói | Nhấn để ngắt | tím |

Các nhãn này chỉ là fallback resource; locale/config khác vẫn cung cấp bundle
khác mà không sửa layout.

## Validation gate

- Host test kiểm tra screen model không đổi và build `-Wall -Werror` pass.
- Static layout review bảo đảm mọi label có slot cố định, không dùng chiều cao
  tự động để đẩy sibling.
- ESP-IDF build/flash không erase NVS.
- Serial xác nhận logo/UI init và không panic; physical acceptance cần nhìn trực
  tiếp pairing, idle, listening, speaking, notice/error trên LCD.
