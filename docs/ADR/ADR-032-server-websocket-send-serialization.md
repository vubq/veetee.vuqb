# ADR-032: Serialize outbound WebSocket frames và fail-closed khi peer stalled

## Status

Accepted

## Context

Voice Server có nhiều producer outbound trong cùng một session: control (`stt`,
`tts`, `alert`, MCP) và binary Opus từ pipeline TTS. Nếu các producer gọi
`send_str`/`send_bytes` đồng thời, thứ tự wire phụ thuộc scheduler; nếu peer
không đọc, một await send có thể giữ provider task và turn lease không giới hạn.
Điều này ảnh hưởng trực tiếp tới cancellation, TTFA và khả năng reconnect của
ESP32.

## Options

### A — Không khóa, tin vào thứ tự task

Ít code hơn nhưng không có guarantee giữa text và binary; stalled peer có thể
giữ tài nguyên và làm session cũ che khuất session reconnect.

### B — Một queue writer background cho mỗi session

Thứ tự và backpressure rõ hơn, nhưng cần lifecycle riêng, bounded queue policy,
drain semantics và thêm một task phải đồng bộ với cleanup.

### C — Một send lock + deadline cho từng write (chọn)

Giữ đúng thứ tự mà không thêm queue copy; timeout tại boundary gần socket giúp
fail nhanh và vẫn để receive-loop/cleanup sở hữu việc release lease.

## Decision

Chọn **C**. `VoiceSession` dùng một `asyncio.Lock` chung cho text và binary. Mỗi
write được bọc bởi `VEETEE_WS_SEND_TIMEOUT_MS`, mặc định 5.000 ms và giới hạn
100..60.000 ms. Timeout hoặc connection reset:

1. tăng counter tổng và subtype đã redact;
2. đánh dấu session transport failed/closed;
3. set cancellation cho turn và cancel task khác task đang quan sát lỗi;
4. gửi close `1011` best-effort;
5. để receive-loop/final cleanup cancel provider và release turn/session lease.

Không retry payload, không replay partial TTS và không tự chuyển sang transport
hoặc provider khác.

## Consequences

### Tích cực

- Control/audio giữ thứ tự trên một WebSocket ordered connection.
- Peer stalled không giữ turn lease vô hạn; metrics cho phép chẩn đoán mà không
  ghi payload/audio.
- Không thay đổi wire framing hay compatibility profile v1/v2/v3.

### Đánh đổi

- Một write chậm chặn write kế tiếp trong cùng session trong tối đa deadline.
- Close best-effort có thể không tới được peer đã mất mạng; server vẫn cleanup
  local state.
- Lock không giải quyết acoustic echo hoặc chất lượng provider; các gate đó vẫn
  cần test riêng khi được cấp quyền audio.

## Verification

- Voice Server regression transport-only kiểm tra text/binary không overlap và
  stalled send đóng session: `tests/test_app.py`.
- Config validation kiểm tra default/range/non-integer của
  `VEETEE_WS_SEND_TIMEOUT_MS` tại `tests/test_config.py`.
- Full Voice Server, Ruff và compileall phải pass trước mỗi promotion.

## Related

- [ADR-018](ADR-018-single-device-session-admission.md) — session ownership.
- [ADR-019](ADR-019-turn-resource-admission.md) — turn lease.
- [ADR-023](ADR-023-firmware-stale-tts-stop-barrier.md) — stale playback barrier.
- [ADR-028](ADR-028-websocket-separate-tx-lock.md) — firmware TX lock, một boundary
  khác với lock outbound ở server này.
