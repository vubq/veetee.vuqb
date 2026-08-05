# ADR-034: Firmware LCD dùng screen model nhiều trạng thái và notice layer

## Trạng thái

Accepted

## Context

LCD ST7789 240×280 trước đây có pairing screen và một status screen đổi màu/nhãn
theo state. Điều đó đủ để chứng minh renderer nhưng chưa tạo ranh giới rõ cho
home, connecting, listening, thinking, speaking và thông báo lỗi/interrupt. UI
firmware cần sắc nét như một OS hiện đại mà không đưa provider, wake phrase hay
locale literal vào state machine.

## Các phương án

### A — Một screen, đổi toàn bộ widget theo state

Ít object hơn nhưng dễ tạo nhánh cập nhật không đồng nhất và khó thêm notice,
transition hoặc screen mới.

### B — Screen model riêng cho từng state, helper layout dùng chung

Mỗi state có một LVGL screen/view với cùng layout component (top status, orb,
subtitle, action hint). Renderer map state machine → view; notice screen có
deadline do display task tick xử lý.

### C — Đưa toàn bộ UI vào bitmap/animation asset

Cho hình ảnh đẹp nhưng tốn flash/RAM, khó thay locale/config và không phù hợp
với màn hình nhỏ cần text rõ.

## Quyết định

Chọn **B**. `vt_display_screen_t` tách pairing/home/connecting/listening/
thinking/speaking/interrupted/error/notice; `vt_display_view_t` gom widget dùng chung. Text vẫn
đến từ `vt_display_texts_t`; alert message có thể đến từ config snapshot qua
wire, không hardcode nghiệp vụ trong renderer. `vt_display_tick()` hết hạn
notice trong display task owner, không dùng LVGL timer callback cạnh tranh với
FreeRTOS/network task.

## Hệ quả

- Có screen boundary rõ để thêm interrupted/error/asset animation sau mà không
  sửa protocol hay business logic.
- Tốn thêm một bộ widget LVGL cho mỗi state, nhưng các object đều nhỏ và build
  vẫn còn 56% app partition trống trên board profile hiện tại.
- Mọi physical acceptance về backlight, orientation, font và transition vẫn cần
  nhìn trực tiếp trên board; ESP-IDF build/CTest không thay thế được.
- Notice timeout là UI-only; state machine và audio cancellation vẫn là owner
  của main/network task.

## Kiểm chứng

- ESP-IDF 6.0.2 build pass, app binary còn 56% app partition.
- Firmware host CTest 9/9 pass.
- Lượt hiện tại không flash, không reset, không phát/thu audio.
