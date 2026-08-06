# Manager Web function audit — 2026-08-06

## Phạm vi

- Kiểm tra host-only Manager Web mock preview và các boundary model/provider.
- Không phát audio, không mở microphone/loa, không flash/reset ESP32, không đổi
  Wi‑Fi, Tailscale, protocol hoặc database production.
- Đối chiếu khu vực catalog model/provider với lựa chọn dịch vụ trong từng trợ
  lý; giữ nguyên boundary hiện hành: catalog model là danh mục/default toàn cục,
  còn trợ lý chọn một `providerConfig` runtime cho từng loại.

## Lỗi đã sửa

1. Dialog sửa/nhân bản model không render. `ModelConfigDialog` gọi
   `structuredClone` trực tiếp trên `ModelConfigRecord.configJson`, vốn là Vue
   reactive Proxy khi lấy từ bảng. Trình duyệt ném `Failed to execute
   'structuredClone' on 'Window': #<Object> could not be cloned.`. Dialog nay
   dùng `toRaw` trước khi clone cả payload model và default field động.
2. Nhãn `Tên model` bị trùng giữa tên hiển thị của catalog và field
   `model_name` gửi tới provider. Field schema nay hiển thị `Model gửi tới
   provider`; model catalog vẫn dùng `Tên model`.
3. Nút model mặc định trước đây hiển thị hành vi không rõ ràng và không thể bỏ
   default dù API hỗ trợ `isDefault=false`. Nút nay toggle hai chiều, có copy
   `Mặc định`/`Đặt làm mặc định`/`Bỏ model mặc định`; model đang bật vẫn không
   thể tắt theo invariant hiện hành.

## Regression coverage

- Model catalog: create → search sau phân trang → edit → duplicate → delete;
  default toggle và dialog schema dynamic field.
- Provider schema: create → search → field inspector → edit → delete.
- Các test mới nằm trong `veetee-manager-web/tests/e2e/ui-preview.spec.ts` và
  label regression trong `src/features/providers/model-registry-labels.spec.ts`.

## Kết quả kiểm thử

| Phạm vi | Kết quả |
|---|---:|
| Manager Web unit | 119 pass |
| Manager Web Chromium E2E | 19 pass |
| Manager Web typecheck/lint/build | pass |
| Manager API InMemory + PostgreSQL test DB `veetee_vubq_test` | 55 pass |
| Voice Server pytest | 194 pass |
| Voice Server compileall/Ruff | pass |

Các test trên không tạo mutation trong `veetee_vubq`; PostgreSQL integration
dùng database riêng có hậu tố `_test` và isolation hook tự dọn sau mỗi test.

## Giới hạn còn lại

- QA cloud Browser Use không chạy vì môi trường không có credential/browser
  cloud đang mở; Chromium local E2E là bằng chứng UI hiện tại.
- Chưa thực hiện physical acceptance nghe/nhìn/chạm với ESP32 ở lượt này.
