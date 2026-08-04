# ADR-021: Watchdog cho auto turn chưa có speech

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-04
- Người quyết định: chủ dự án Veetee

## Context

On-device wake word tạo `listen/start mode=auto` và giữ một turn admission lease.
VAD hiện chỉ endpoint sau khi đã thấy đủ speech; vì vậy một lần wake nhưng người
dùng không nói sẽ giữ `activeTurns=1` vô hạn, không gọi ASR/LLM/TTS và chặn lượt
kế tiếp. Điều này đã được tái hiện bằng health/metrics và trace
`veetee-server/src/veetee_server/app.py`.

Không được biến timeout này thành giới hạn hội thoại: câu trả lời dài 5–10 phút
vẫn phải chạy khi speech đầu tiên đã được xác nhận. Wire peer cũ cũng phải tiếp
tục hoạt động; firmware hiện hữu đã xử lý `alert` bằng cách dừng capture, flush
audio/reference và re-arm wake.

## Decision drivers

- Must release the turn lease khi auto wake không có speech.
- Must không gọi ASR final, LLM hoặc TTS cho empty/no-speech turn.
- Must gắn timer với `turn_id` và `generation`, hủy ở mọi ownership boundary.
- Must để owner cấu hình timeout và thông báo qua Manager draft/publish.
- Must giữ compatibility khi snapshot không có policy: watchdog disabled.

## Các phương án

### A. Timeout ở firmware sau khi wake

- Ưu điểm: giảm uplink silence sớm.
- Nhược điểm: server vẫn phải có lease cleanup khi firmware không gửi abort;
  policy phải được đồng bộ thêm vào firmware/NVS và dễ lệch server.

### B. Dùng `minSilenceMs` của VAD để endpoint mọi lượt

- Ưu điểm: ít code mới.
- Nhược điểm: VAD chưa xác nhận speech thì `minSilenceMs` không đủ điều kiện;
  nếu ép endpoint sẽ gọi ASR/LLM với transcript rỗng, trái contract `no_speech`.

### C. Server watchdog sau `listen/start mode=auto`

- Ưu điểm: sở hữu lease và pipeline ở cùng một nơi; không allocation provider,
  không cần firmware update; timeout/config có revision và test được bằng WS.
- Nhược điểm: vài giây silence vẫn được uplink trước khi server alert; firmware
  phải nhận `alert` để dừng capture.

## Quyết định

Chọn **C**.

Role snapshot có policy additive:

```json
{
  "autoTurn": {
    "enabled": true,
    "noSpeechTimeoutMs": 5000,
    "noSpeechAlert": {
      "status": "warning",
      "message": "<localized config text>",
      "emotion": "neutral"
    }
  }
}
```

`enabled=false` hoặc thiếu `autoTurn` giữ compatibility và không tạo timer.
Timeout hợp lệ nằm trong `1.000..60.000 ms`; đây là khoảng chờ speech đầu tiên,
không phải max turn duration. Khi hết hạn, server kiểm tra đúng session/turn/
generation, release lease, set phase idle và gửi additive `alert` với
`code:"NO_SPEECH_TIMEOUT"`. Firmware cũ bỏ qua field `code` nhưng vẫn xử lý ba
field alert bắt buộc; Veetee firmware dùng code cho telemetry.

Watchdog bị hủy khi có speech được VAD xác nhận, `listen/stop`, abort, endpoint,
intent exit, turn mới, disconnect hoặc runtime cleanup. Timer không chạy trong
ISR và không có task global dùng chung giữa session.

## Consequences

### Tích cực

- Wake rỗng không làm cạn admission capacity.
- Không phát câu trả lời giả từ transcript rỗng.
- Message/localization vẫn do Manager config quyết định.
- Không cần flash firmware để bật policy; wire-compatible peer cũ vẫn nhận alert.

### Tiêu cực

- Silence vẫn đi qua Opus/WS trong khoảng timeout.
- Nếu owner cấu hình timeout quá ngắn, người dùng chậm nói sẽ bị kết thúc lượt.
- Alert text/status/emotion phải được cung cấp đầy đủ khi bật policy.

### Mitigations và guardrails

- Snapshot validation fail closed về last-known-good revision.
- UI hiển thị giới hạn 1–60 giây và không cho publish alert rỗng.
- Metrics chỉ lưu counter `auto_no_speech_timeouts`, không lưu audio/transcript.
- Không áp watchdog cho `manual` hoặc `realtime`, và không timeout khi đã có speech.

## Verification

- [x] Auto silence test: alert đúng code/message, không audio/ASR/LLM/TTS, lease về 0.
- [x] Speech-before-deadline test: watchdog bị hủy, lease còn sống để endpoint bình thường.
- [x] Empty-ASR gate: transcript rỗng sau endpoint gửi `stt` rỗng và
  `alert.code="NO_SPEECH"`, không gọi Intent/LLM/TTS; host Voice Server suite
  hiện **64 passed**.
- [ ] Physical wake → silence → firmware alert/re-arm trên board đã flash image có
  policy publish.
- [ ] 30-turn/long-session regression sau khi promotion policy vào runtime thật.

## Liên quan

- `docs/07-server-design.md` — state machine và no-speech contract.
- `docs/03-protocol-spec.md` — additive `alert.code`.
- `docs/08-manager-design.md` — role snapshot/publish.
- ADR-006 — cancellation ownership.
- ADR-019 — turn resource admission.
