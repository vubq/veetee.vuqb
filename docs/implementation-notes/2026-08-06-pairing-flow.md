# Pairing flow: Wi-Fi → hello → code → assistant binding — 2026-08-06

## Vấn đề đã xác nhận

Manager Web trước đây gọi endpoint discoverable và bắt người dùng chọn một mục
“Robot đang chờ” trước khi nhập mã. Flow này khác màn hình bind-by-code của
sản phẩm tham khảo và làm người dùng tưởng phải nhận diện robot thủ công. Trong
DB, ESP32 online nhưng `assistant_id` vẫn `NULL` là trạng thái đúng trước khi
claim; đó không phải lỗi của assistant.

## Thay đổi

- Pair dialog chỉ còn assistant (ẩn khi đã mở từ một assistant), mã sáu chữ số
  và tên hiển thị tùy chọn. `deviceId` không còn nằm trong request UI.
- API vẫn giữ `deviceId` optional để tương thích caller cũ; pairing lookup thực
  hiện bằng hash của mã trong pending challenge và tự suy ra device.
- Challenge mới do Manager API sinh ở dạng sáu chữ số; parser cũ vẫn nhận
  `VT-####` cho dữ liệu compatibility đã phát hành.
- Voice Server gửi presence online đồng bộ một lần trong hello để biết
  `pairing_required`, sau đó poll bind state có bounded interval. Không plaintext
  code nào rời firmware.
- Server hello thêm `pairing_required` additive. Khi web bind commit, server gửi
  `device.state="paired"`; firmware lúc đó mới rời pairing screen.

## Flow kiểm chứng

```text
ESP32 Wi-Fi
  → WebSocket hello + device_info.pairingCodeHash
  → Manager presence trả paired=false
  → server hello pairing_required=true
  → LCD giữ mã 6 số
  → Web POST /api/v1/devices/pair {assistantId, verificationCode}
  → Manager transaction bind device + consume challenge
  → presence poll trả paired=true
  → server device.state=paired
  → firmware hiển thị home/status và assistant list có device
```

## Bằng chứng host

- Manager API test: 39 pass, 13 PostgreSQL integration skip theo điều kiện test DB.
- Voice Server presence/app test: 28 pass; handshake unpaired có
  `pairing_required=true`.
- Firmware host compile/flash và physical LCD/audio acceptance vẫn là bước riêng;
  không lấy log để suy ra plaintext pairing code.

## Live acceptance trên ESP32 thật — 2026-08-06

- Để kiểm tra đúng flow mà không đưa mã vào product log, đã flash một image debug
  tạm thời (không `erase_flash`, NVS/Wi-Fi giữ nguyên), đọc mã qua serial trong
  bộ nhớ tạm owner-only, rồi xóa debug line và flash lại image production.
- Web automation dùng phiên owner đã xác thực, nhập mã qua dialog
  `PairDeviceDialog`, không ghi password hoặc mã vào repository/log. UI sau đó hiển
  thị `Veetee ESP32`, trạng thái `Trực tuyến`, dưới assistant `Veetee`.
- Sau reset mềm bằng RTS, serial production xác nhận `WiFi ready`, `WebSocket v3
  ready`, `server hello accepted; session ready pairing_required=0`; không có marker
  debug/plaintext, panic hoặc watchdog. Đây là host/serial evidence; không thay cho
  việc người dùng nhìn LCD và nghe loa.
- Kiểm thử phát hiện presence stale sau TTL khi session idle; đã thêm heartbeat
  server cấu hình qua `VEETEE_PRESENCE_HEARTBEAT_MS` (mặc định 30 giây), chỉ gửi
  identity hash và tuyệt đối không gửi lại pairing hash. Sau restart Voice Server,
  `activeConnections=1`, DB giữ `online_state=online`, `age_seconds=14` sau một
  chu kỳ heartbeat.
- File tạm chứa password và mã ghép nối đã được xóa sau kiểm thử. Source hiện
  không còn `PAIRING_DEBUG_LOCAL_ONLY`.
