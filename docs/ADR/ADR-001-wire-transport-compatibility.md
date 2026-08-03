# ADR-001: Direct WebSocket v3 làm transport mặc định

## Status

Accepted — 2026-08-03.

## Context

Veetee cần một transport realtime cho ESP32-S3 trên LAN, đồng thời phải chạy được
với các peer tham chiếu đã cung cấp. Source firmware có ba binary layouts direct
WebSocket: v1 raw Opus, v2 header 16 byte có timestamp và v3 header 4 byte
(`references/xiaozhi-esp32/main/protocols/protocol.h:10-31`,
`references/xiaozhi-esp32/main/protocols/websocket_protocol.cc:24-53`). Firmware
chọn version từ settings và gửi nó trong cả header HTTP lẫn client hello
(`references/xiaozhi-esp32/main/protocols/websocket_protocol.cc:79-106`,
`references/xiaozhi-esp32/main/protocols/websocket_protocol.cc:198-216`).

Backend tham chiếu direct WebSocket lại đưa nguyên binary message vào Opus decoder
và gửi raw Opus, không unwrap/wrap v2/v3
(`references/xiaozhi-esp32-server/main/xiaozhi-server/core/connection.py:365-380`,
`references/xiaozhi-esp32-server/main/xiaozhi-server/core/handle/sendAudioHandle.py:258-272`).
Vì vậy v1 là profile giao nhau với backend đó, nhưng không phải lựa chọn tốt nhất
cho hai component Veetee mới.

MQTT + UDP v3 có control/audio tách riêng và header timestamp/sequence, nhưng
backend snapshot không terminate transport này; integration yêu cầu gateway ngoài
repo (`references/xiaozhi-esp32-server/docs/mqtt-gateway-integration.md:3-10`,
`references/xiaozhi-esp32-server/docs/mqtt-gateway-integration.md:50-80`). Đưa
gateway vào critical path M0 sẽ tăng số process, broker, credential và failure mode.

## Decision drivers

- Wire-compatible với ba framing version đã quan sát.
- M0 phải là vertical slice nhỏ nhất, có DoD rõ và dễ trace end-to-end.
- Ít moving parts, ít lỗi cấu hình và reconnect trên một LAN tin cậy.
- Binary frame có explicit length để fuzz/validate, không sniff payload.
- Có đường nâng cấp MQTT/UDP mà không đổi semantics JSON, Opus hoặc MCP.
- Không tự downgrade/fallback làm che lỗi cấu hình hay tạo hành vi khó tái hiện.

## Options considered

### Option A — Direct WebSocket v3 mặc định, adapter v1/v2, MQTT/UDP staged

Ưu điểm:

- Một persistent connection giữ ordering giữa `tts/start`, audio và `tts/stop`.
- Header v3 chỉ 4 byte nhưng vẫn có explicit type/length.
- Ít service hơn broker + gateway + UDP trong M0/M1.
- v1/v2 vẫn là parser/serializer riêng, kiểm thử bằng golden fixtures.

Nhược điểm:

- v3 không nối trực tiếp backend tham chiếu nếu không đổi backend; test với backend
  đó phải chọn explicit v1.
- v3 không có timestamp như v2; server-side AEC cần v2 hoặc device-side AEC.
- TCP head-of-line blocking có thể xuất hiện khi LAN xấu.

### Option B — MQTT control + UDP v3 làm mặc định ngay

Ưu điểm:

- UDP tránh TCP head-of-line cho audio.
- Sequence/timestamp rõ và control connection có keepalive.

Nhược điểm:

- Thêm broker, gateway, topic provisioning, per-session AES key và hai reconnect
  lifecycle.
- Gateway đầy đủ không có trong source được giao, nên không thể dùng snapshot như
  một oracle hoàn chỉnh.
- Tăng failure surface trước khi pipeline audio/LLM/TTS được chứng minh.

### Option C — Direct WebSocket v1 mặc định

Ưu điểm:

- Nối trực tiếp backend tham chiếu.
- Framing nhỏ nhất.

Nhược điểm:

- Không có explicit type/length/timestamp trong binary payload.
- Giữ profile compatibility làm product default dù cả hai đầu Veetee đều mới.

## Decision

Chọn **Option A**:

1. `ws-v3` là default duy nhất cho Veetee firmware ↔ Veetee server.
2. Server implement explicit adapter `ws-v1`, `ws-v2`, `ws-v3`; firmware chọn
   version bằng config đã activate.
3. `ws-v1-compat` chỉ dùng cho conformance với backend tham chiếu.
4. `ws-v2` dùng khi deployment chủ động chọn server-side AEC cần timestamp.
5. `mqtt-udp-v3` được đặc tả ngay nhưng chỉ implement/activate sau khi WebSocket
   đạt soak, interrupt và latency gates.
6. Không sniff framing và không automatic fallback. Header `Protocol-Version`,
   client hello và parser version phải thống nhất; mismatch fail fast.
7. JSON semantics, Opus parameters và device MCP dùng chung qua mọi adapter.
8. MQTT/UDP chỉ được promote khi additive `audio_stream_id` + start/end sequence
   barrier và bounded reorder buffer pass; không dựa vào cross-carrier arrival order.
   Receiver dùng window 4 packet, gap timeout 120 ms, forward-jump ceiling 256 và
   chỉ advance `remote_sequence` khi packet đã release hoặc được tuyên bố lost.
9. Direct WebSocket giới hạn một Opus payload ở 1.500 byte cho cả v1/v2/v3; parser
   reject oversized frame trước allocation lớn/decoder. UDP giữ ceiling 1.400 byte.

Chi tiết normative nằm trong [03-protocol-spec.md](../03-protocol-spec.md).

## Consequences

### Positive

- M0/M1 có ít dependency và trace một connection duy nhất.
- Default mới có length-delimited frame nhưng overhead chỉ 4 byte/packet.
- Compatibility không trộn vào domain model; nó là profile test/deployment rõ ràng.
- MQTT/UDP có thể thêm sau bằng adapter, không viết lại conversation pipeline.

### Negative

- Test matrix phải bao phủ ba serializer/parser, dù production default chỉ v3.
- Operator muốn nối backend tham chiếu phải biết chọn v1; không có cơ chế “thử cho
  đến khi chạy”.
- Device-side AEC là đường mặc định cho barge-in; nếu cần server-side AEC phải chọn
  v2 có chủ đích.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Config version lệch hai đầu | validate header + hello; close 1002; log profile không log secret |
| Parser v2/v3 out-of-bounds | length-first parser, fuzz truncated/oversized frames |
| TCP jitter làm audio backlog | server pacing, bounded queue, queue-age telemetry và soak test |
| UDP reorder phát sai thứ tự hoặc chờ vô hạn | window/gap timer cố định, duplicate/late drop, excessive jump buộc session mới |
| Compatibility drift | golden wire fixtures và test chéo hai chiều trong protocol spec |
| MQTT staging bị trì hoãn vô hạn | milestone riêng chỉ bắt đầu sau WebSocket acceptance gates |

## Revisit criteria

Viết ADR mới để supersede quyết định này nếu đo trên LAN mục tiêu cho thấy một
trong các điều sau:

- WebSocket p95 packet jitter hoặc head-of-line làm TTFA/time-to-silence không đạt
  budget dù pacing và queue đã đúng;
- deployment cần broker fan-out/device fleet routing như một requirement bắt buộc;
- gateway implementation đầy đủ đã được vendor/audit và conformance UDP chạy ổn
  định hơn WebSocket trong soak test;
- cần authenticated audio datagram, dẫn đến protocol version mới thay AES-CTR v3.

## Verification

- `WIRE-BIN-001/002/003`: golden, malformed length và boundary 1.500/1.501 byte.
- `WIRE-UDP-002/003/004`: in-window reorder, control/audio barrier, gap timeout và
  excessive sequence jump.
- `WIRE-CROSS-001/002`: conformance chéo hai chiều.
- Default clean-install config chỉ chọn `ws-v3`.
- Network/auth/version failure không tạo connection attempt bằng profile khác.
