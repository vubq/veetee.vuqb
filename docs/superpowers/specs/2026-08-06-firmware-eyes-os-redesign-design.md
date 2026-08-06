# Veetee Eyes OS — thiết kế lại UI firmware

## Trạng thái

Được chọn để triển khai sau khi rà lại demo `firmware-ui-pure-face-demo.html`
trên canvas 240×280. Wire protocol, state machine, audio task và pairing flow
không đổi.

## Vấn đề của bản cũ

- Header dùng cả brand text, state chip và connection label nên bị chật ở 240 px.
- Title 26 px có line-height lớn hơn slot; hint dài có thể wrap ra ngoài card.
- State chip dùng nhãn tiếng Anh và cạnh tranh chiều cao với activity bar.
- Notice lặp lại cùng một message ở card và footer.
- Không có điểm nhận diện hình ảnh ổn định cho thương hiệu.

## Quyết định thiết kế

Chọn hướng **Pure Face OS** với mark chỉ gồm hai mắt được tách từ favicon do
chủ dự án cung cấp:

1. Header cố định cao 48 px: mark mắt-only và chữ brand ở bên trái, trạng thái
   kết nối ngắn bên phải. Không dùng state chip tiếng Anh.
2. Activity line mảnh ở y=54, rộng theo toàn màn hình; màu lấy từ state.
3. Vùng visual full-bleed ở giữa: chỉ có mark hai mắt, aura mềm và wave bars
   nhỏ khi listening/speaking. Không dùng card hoặc vòng border lớn.
4. Mỗi state có một title một dòng và một hint tối đa hai dòng trong slot cố
   định. Title/hint động dùng mode clip/dots khi vượt slot để không lấn vùng khác.
5. Footer là một dòng action hint nhẹ, không có pill/border. Pairing có layout
   riêng ưu tiên mã 6 số; notice/error không lặp message ở footer.
6. Logo dùng đúng ảnh `public/favicon.svg`, rasterize thành LVGL image
   `main/assets/veetee_logo.c` 64×36 ARGB8888 và chỉ giữ dải hai mắt; vùng miệng
   bị loại khỏi crop. Không copy component, CSS hay logic từ repo tham chiếu;
   checksum nguồn và tọa độ crop được ghi trong asset.
7. Resource text vẫn đi qua `vt_display_texts_t`; fallback mặc định được rút gọn
   để vừa slot, không đưa business/provider/wake phrase vào renderer.

## Bố cục chuẩn

```text
0..47    header: eye-only mark + brand + connection status
48..53   khoảng thở
54..55   activity line
61..158  visual region: aura + eye-only mark + wave
166..200 title (one line)
207..241 hint (maximum two lines)
252..273 footer action hint
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
