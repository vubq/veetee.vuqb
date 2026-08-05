# ADR-028: Tách TX lock cho WebSocket client trên firmware

## Status

Accepted (2026-08-05) — áp dụng cho firmware board profile; acoustic duplex
vẫn bị gate bởi AEC/cooldown, không tự promote production.

## Context

Echo-only duplex probe sau AEC alignment không có wake retrigger, nhưng serial
ghi 6 lần `Could not lock ws-client within 500 timeout` trong lúc firmware vừa
gửi uplink audio vừa nhận/phát TTS. ESP-IDF `esp_websocket_client` cung cấp tùy
chọn `CONFIG_ESP_WS_CLIENT_SEPARATE_TX_LOCK`; mặc định hiện tại dùng chung lock
cho RX/TX. Đây là contention ở client library, không phải wire-protocol change.

## Options

### A — Giữ shared lock (hiện trạng)

- Ưu: ít cấu hình, giữ đúng mặc định component.
- Nhược: duplex audio có thể chờ tới 500 ms; nếu timeout xảy ra, frame/control
  có thể bị trễ hoặc bị bỏ qua và khó tách khỏi network jitter.

### B — Bật separate TX lock

- Ưu: RX callback/keepalive không giữ TX path; phù hợp với uplink audio và
  downlink TTS đồng thời; tùy chọn được ESP-IDF component hỗ trợ.
- Nhược: thêm một mutex và cần regression quanh disconnect/close; TX vẫn có thể
  tranh chấp với TX nếu mạng chậm, nên không biến thành guarantee latency.

## Decision

Chọn **B** cho board profile hiện tại qua `sdkconfig.defaults`:
`CONFIG_ESP_WS_CLIENT_SEPARATE_TX_LOCK=y`. Không đổi framing, timeout ứng dụng,
WebSocket URI hay protocol version. Separate lock được giữ vì A/B physical không
có lock timeout và không có disconnect/deadlock; acoustic quality vẫn là gate
riêng. Nếu soak sau này cho thấy regression, viết ADR superseding để quay lại A.

## Consequences

- Firmware cần reconfigure/build/flash; NVS/Wi-Fi không bị erase.
- Bounded duplex report phải ghi số lock-timeout, protocol error, audio frame
  counters và active turn sau drain.
- Với fixture `cooldownMs=0`, separate lock làm lộ một acoustic retrigger
  (`barge_in_count=1`, drain timeout); đây là lý do không được coi lock fix là
  AEC fix. Cùng firmware với policy `cooldownMs=2000` đạt 2/2 echo-only, 0 lock
  timeout, 0 barge-in và `active_turns=0`.
- Đây không mở `deviceDuplex` production; voice-onset, AEC quality và
  time-to-silence vẫn là các gate độc lập.

## Verification

1. Host CTest và ESP-IDF build không warning/error.
2. Flash không `erase_flash`, xác nhận serial `WebSocket v3 ready` và health
   `activeConnections=1`.
3. Chạy cùng echo-only scenario; so sánh lock-timeout và lifecycle với các
   report `/tmp/veetee-ws-lock-echo-only-20260805.json` (cooldown 0, fail
   acoustic) và `/tmp/veetee-ws-lock-cooldown-echo-only-20260805.json`
   (cooldown 2000, bounded pass).
