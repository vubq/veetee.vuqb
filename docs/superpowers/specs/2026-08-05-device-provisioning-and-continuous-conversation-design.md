# Device provisioning và hội thoại liên tục

## Trạng thái

Accepted theo yêu cầu mới nhất của chủ dự án.

## Mục tiêu

Thiết bị mới tự tạo mạng Wi‑Fi cấu hình, nhận thông tin mạng mà không xoá NVS,
sau khi vào LAN hiển thị mã ghép nối sáu chữ số để Owner bind trên Manager Web.
Sau khi được đánh thức bằng PTT hoặc wake word, thiết bị giữ phiên hội thoại mở
qua nhiều lượt; chỉ kết thúc khi không có speech liên tục trong khoảng ba phút.

## Luồng provisioning

```text
NVS có SSID và kết nối được
  └─> station → WebSocket → hello/presence

NVS trống hoặc station timeout
  └─> SoftAP + DNS captive portal
      └─> Owner nhập SSID/password
          └─> lưu station profile vào NVS → station reconnect
              └─> tạo/persist pairing code 6 số → LCD
                  └─> hello gửi pairingCodeHash
                      └─> Manager lưu challenge pending
                          └─> Web chọn thiết bị discoverable + nhập code
                              └─> bind device → assistant
```

Mã plaintext chỉ xuất hiện trên LCD/portal cục bộ và trong input của Owner. Wire
và database chỉ giữ SHA‑256 canonical của chuỗi sáu chữ số. Challenge pending
được gia hạn khi presence online lặp lại; sau khi bind, challenge được đánh dấu
used. Endpoint challenge cũ vẫn được giữ để test/operator, nhưng sản phẩm không
tự sinh mã thay firmware.

## Luồng hội thoại

1. PTT hoặc WakeNet tạo `listen.start` (`mode=manual|auto`).
2. Firmware gửi Opus khi đang capture; server tạo một `Turn` và chạy VAD → ASR
   → LLM/tool → TTS streaming.
3. TTS stop mang field additive `continue_listening=true` khi policy phiên bật.
   Sau khi đã drain audio, server gửi `listen.ready` (`mode=auto`).
4. Firmware bật capture liên tục, không re-arm wake detector trong khoảng này.
   Audio đầu tiên sau lượt trước tự tạo turn mới trên cùng WebSocket/session.
5. Mọi lượt dùng generation/turn guard; PTT/wake/abort vẫn flush stale audio.
6. Timer idle cấp phiên (mặc định 180000 ms) bắt đầu sau `listen.ready`, reset khi
   bắt đầu lượt mới hoặc nhận speech. Timeout gửi `alert.code=
   CONVERSATION_IDLE_TIMEOUT`; firmware dừng capture, về idle và re-arm WakeNet.
7. Intent exit hoặc abort chủ động đóng phiên liên tục ngay, không chờ timer.

Không giới hạn số lượt hoặc độ dài text/audio trong phiên ngoài queue/memory bound.
History lưu từng turn bounded theo retention policy; đây không phải timeout nghiệp
vụ.

## Cấu hình runtime

```json
{
  "conversation": {
    "continuous": true,
    "idleTimeoutMs": 180000,
    "idleAlert": {
      "status": "ok",
      "message": "Mình sẽ chờ bạn gọi lại.",
      "emotion": "neutral"
    }
  }
}
```

Giá trị được validate trong snapshot và chỉnh qua Manager Web; fixture test có thể
dùng timeout nhỏ. Không hardcode câu thông báo vào firmware/server core.

## Lỗi và an toàn

- Không có SSID hợp lệ hoặc portal không nhận form: giữ SoftAP, không xoá profile
  NVS hiện có.
- Station timeout sau khi đã có profile: chuyển SoftAP fallback, không lặp reconnect
  vô hạn và không tự erase flash.
- Pairing code không đúng/hết hạn: trả lỗi có cấu trúc; rate-limit theo device,
  không tiết lộ challenge khác.
- Presence thiếu hash: thiết bị vẫn online nhưng không discoverable/pairable.
- Disconnect/replace/abort: cancel mọi provider task, flush audio và huỷ idle timer.
- Wake detector lỗi vẫn giữ PTT; timeout phiên không bật server-side wake.

## Kiểm thử chấp nhận

- Firmware host test: mã luôn đúng 6 chữ số, persist/read/hash ổn định; parser
  portal URL-encoded bounded; state transitions không đổi khi form lỗi.
- Firmware ESP-IDF build/serial: NVS Wi‑Fi hiện có không bị đổi; boot có SoftAP
  fallback marker, LCD code marker, WebSocket hello chứa hash 64 hex.
- API InMemory/PostgreSQL: presence hash tạo discoverable challenge, list chỉ
  unbound+online, pair đúng device/code một lần, code cũ không bind thiết bị khác.
- Web: dialog tải discoverable list, chọn board, nhập đúng sáu số, loading/empty/
  expired/error/a11y; preview giữ mã fixture cũ để không phá catalog test.
- Voice: ba lượt liên tiếp cùng WebSocket không wake lần hai; TTS drain → ready →
  capture; 100 lượt không làm queue/memory tăng đơn điệu; timeout fixture đóng
  capture và wake/PTT mở phiên mới.

