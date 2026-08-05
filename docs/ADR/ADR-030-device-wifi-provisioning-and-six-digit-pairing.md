# ADR-030: SoftAP provisioning và pairing code sáu chữ số do firmware sở hữu

## Status

Accepted

## Context

Thiết bị mới chưa có Wi‑Fi không thể gửi mã ghép nối lên server. Cách cũ để
Manager API tự tạo `VT-xxxx` challenge không phản ánh mã thật đang hiện trên
robot và cho phép online device tồn tại mà không có đường Owner bind rõ ràng.

## Options

### A — Chỉ cấu hình SSID/password ở build time

Đơn giản nhưng cần rebuild/flash cho mỗi mạng, không phù hợp robot mới và dễ làm
lộ secret trong build artifact.

### B — Captive portal SoftAP, code persist trên firmware (chọn)

Firmware fallback sang SoftAP, nhận form SSID/password, lưu vào NVS và tạo mã
6 số ổn định theo device. Hello/presence gửi hash; Web chọn device discoverable
và gửi plaintext code qua HTTPS tới API để hash/so sánh.

### C — Bluetooth provisioning hoặc cloud claim

Có thể UX tốt hơn nhưng cần thêm stack/ứng dụng mobile hoặc cloud identity, ngoài
phạm vi self-host hiện tại.

## Decision

Chọn B. Station profile hiện có luôn được ưu tiên; timeout chỉ mở SoftAP fallback,
không erase NVS. DNS captive chỉ chuyển request trong AP; HTTP form được giới hạn
độ dài, URL-decoding an toàn và chỉ chấp nhận POST từ AP. Mã lưu NVS dạng 6 ASCII
số, hash SHA‑256 64 hex; không log hoặc gửi plaintext. Manager giữ challenge pending
theo device, gia hạn bởi presence và đánh dấu used sau bind.

Endpoint internal tạo challenge cũ được giữ cho fixture/operator compatibility,
nhưng không được dùng để auto-bind thiết bị production.

## Consequences

### Tích cực

- Người dùng tự cấu hình robot trên mạng mới mà không flash lại.
- Mã trên LCD là bằng chứng cùng device mà Web đang chọn.
- Không đổi Wi‑Fi máy dev, không xóa NVS, không cần cloud.

### Tiêu cực

- SoftAP/captive HTTP phải được harden và test trên nhiều điện thoại.
- Sáu chữ số có entropy thấp; cần device selection, HTTPS/session auth và retry
  limit để giảm brute-force.
- Firmware phải có vùng NVS và renderer code.

## Security invariants

- Không lưu plaintext code ở server/log/browser storage.
- Pair request mới phải chỉ rõ `deviceId` khi UI ở API mode; request cũ không có
  deviceId chỉ được hỗ trợ cho challenge test tương thích.
- Device chưa bind không xuất hiện trong assistant device list.

