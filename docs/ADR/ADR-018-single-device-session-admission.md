# ADR-018: Một active WebSocket session cho mỗi device

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-04
- Người quyết định: chủ dự án Veetee

## Context

Một ESP32 chỉ có một loa, microphone và state machine điều khiển audio. Nếu
reconnect, browser test hoặc process cũ mở thêm WebSocket mà session trước vẫn
còn sống, hai pipeline có thể cùng gửi `tts`, cạnh tranh model lease và phát
audio stale tới cùng phần cứng. Tài liệu server đã yêu cầu một active session
lease cho mỗi device và không dùng nhiều connection để giải quyết capacity.

Admission phải xảy ra sau khi client hello đã qua validation, để một socket gửi
hello sai không thể thay thế phiên hợp lệ. Handover cũng phải kết thúc task tree
của phiên cũ trước khi phiên mới hoàn tất server hello.

## Decision drivers

- Must không để hai session cùng điều khiển một device/speaker.
- Must gửi `tts/stop` khi phiên cũ đang nói để firmware về boundary an toàn.
- Must không làm stale cleanup của phiên cũ xóa lease của phiên mới.
- Should giữ reconnect tự động của firmware và không thêm provider fallback.
- Should không yêu cầu Redis hoặc thay đổi wire framing v1/v2/v3.

## Các phương án

### A. Từ chối connection mới bằng `server_busy`

- Ưu điểm: không cần đóng phiên đang chạy.
- Nhược điểm: reconnect hợp lệ có thể bị kẹt khi socket cũ half-open; firmware
  phải tự retry theo policy ngoài session.

### B. Handover phiên cũ cho connection mới

- Ưu điểm: reconnect deterministic, luôn có một owner mới; có thể abort turn cũ
  trước khi cấp model/session lease mới.
- Nhược điểm: một lượt đang nói bị ngắt khi có connection mới; cần close/cleanup
  idempotent và guard object identity.

### C. Cho phép nhiều session cùng device

- Ưu điểm: ít logic admission nhất.
- Nhược điểm: vi phạm ownership phần cứng, tăng stale audio và resource/OOM risk;
  không phù hợp baseline một active conversation.

## Quyết định

Chọn **B — handover newest connection**.

Sau client hello hợp lệ, server giữ một lease map theo `Device-Id` đã qua lớp
identity/authentication của deployment (fixture local có thể tắt auth). Connection
mới atomically thay lease cũ, abort turn cũ với
`reason=session_replaced`, gửi đúng một `tts/stop` nếu session còn sống, rồi đóng
WebSocket cũ bằng close code `4001` và reason ASCII `session_replaced`. Server
chờ cleanup của session cũ hoàn tất trước khi trả server `hello` cho connection
mới. Cleanup chỉ xóa lease nếu map vẫn trỏ đúng object session cũ.

`4001`/close reason là additive ở transport layer: peer cũ không hiểu code vẫn
thấy socket đóng và có thể reconnect; không sniff, downgrade hoặc đổi profile.
Admission theo resource tổng host (ví dụ `server_busy`) vẫn là gate riêng và
không được giả vờ đã giải quyết bởi per-device lease.

## Consequences

### Tích cực

- Một device có một owner rõ ràng, không phát song song vào cùng speaker.
- Wake/auto reconnect có thể thay socket cũ mà không cần thao tác người dùng.
- Runtime generation lease, cancellation và history cleanup được kết thúc trước
  khi socket mới nhận work.

### Tiêu cực

- Mở socket thứ hai cố ý sẽ ngắt socket thứ nhất.
- Close code custom cần được ghi nhận trong telemetry và test contract.
- Handover cleanup có thể làm handshake mới chậm trong bounded thời gian của task
  cũ; provider không được retry sang implementation khác.

### Mitigations và guardrails

- Chỉ admission sau hello validation; socket malformed không thay owner.
- `turn_id`/generation guard và `tts.stop` giữ không có stale binary sau handover.
- Map object identity và cleanup idempotent; log chỉ error type, không log identity
  raw hay credential.
- Physical acceptance vẫn phải xác nhận firmware reconnect, loa và wake re-arm.

## Verification

- [x] `veetee-server/tests/test_app.py::test_duplicate_device_hello_handover_closes_old_session`
      chứng minh old session nhận `tts.stop(reason=session_replaced)`, close
      `4001`, new session nhận `hello`, active connection còn một.
- [x] `cd veetee-server && .venv/bin/pytest -q tests/test_app.py -k duplicate_device`.
- [x] `cd veetee-server && uv run ruff check src tests`.
- [ ] Firmware thật reconnect và WakeNet re-arm sau close; cần physical gate,
      không được suy ra từ test WebSocket.

## Liên quan

- `docs/03-protocol-spec.md` — session identity, close và cancellation.
- `docs/07-server-design.md` — SessionScope/admission lease.
- `docs/11-open-questions.md` — Q-007, một active conversation baseline.
- ADR-006 — streaming turn cancellation.
- ADR-007 — provider generation/resource lease.
