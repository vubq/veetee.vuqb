# ADR-031: Hội thoại liên tục với idle timeout theo policy

## Status

Accepted

## Context

Thiết bị hiện kết thúc capture sau mỗi lượt TTS và chỉ re-arm wake word. Người dùng
muốn nói nhiều câu tự nhiên trên cùng phiên, không giới hạn số lượt/thời lượng,
nhưng vẫn cần trở về trạng thái chờ khi im lặng lâu để tránh giữ microphone/session
vĩnh viễn.

## Options

### A — Wake word trước mọi lượt

Ít state server hơn nhưng phá nhịp hội thoại, tăng latency và bắt người dùng gọi
robot lặp lại.

### B — Firmware tự đo 3 phút và tự đóng (chọn một phần)

Giảm tải server nhưng policy khó đồng bộ, không biết speech/turn đã được nhận và
dễ lệch khi mất packet.

### C — Server sở hữu session policy, firmware thực thi ready/timeout (chọn)

Server theo dõi turn/speech và gửi `listen.ready`/`CONVERSATION_IDLE_TIMEOUT`;
firmware chỉ điều khiển capture/playback/wake. Field/message là additive để peer cũ
bỏ qua và vẫn half-duplex.

## Decision

Chọn C. `conversation.continuous=true` mở auto listening sau TTS drain. Mỗi audio
đầu tiên khi session đã armed tạo turn mới trên cùng WebSocket; `turn_id` và
generation guard vẫn bắt buộc. `idleTimeoutMs` mặc định 180000, bounded trong
snapshot và có thể override ở fixture/test. Exit intent, PTT interrupt, disconnect
và provider error đều huỷ policy. Timeout gửi alert localized từ config rồi device
re-arm wake/PTT.

## Consequences

### Tích cực

- Hội thoại nhiều lượt liền mạch, không giới hạn câu hỏi/độ dài hữu dụng.
- Không cần mở microphone server-side khi idle; wake vẫn on-device.
- Có một owner policy server và một executor firmware, dễ đo/test.

### Tiêu cực

- Session có thêm state `continuous_armed` và timer cancellation.
- Firmware/server cũ không hiểu ready/continue sẽ vẫn dừng sau một lượt; tương
  thích wire vẫn giữ được.
- Cần soak test để chứng minh queue/history/memory bounded.

## Invariants

- Không audio từ turn cũ được xử lý sau release/cancel.
- TTS drain xong mới bật capture (trừ AEC acoustic duplex đã được bật rõ).
- Timeout không tự đổi provider hoặc transport.
- Không giới hạn nghiệp vụ câu trả lời; chỉ bounded queue/retention.

