# AEC reference alignment và echo-only diagnostics

## Context

Firmware đã có ESP-SR AEC opt-in và một ring PCM 16 kHz. Playback PCM được
đưa vào ring ngay sau Opus decode, còn mic frame được xử lý trong capture task.
Hai clock/task không cùng thời điểm; vì vậy ring hiện chưa biểu diễn được
độ trễ từ lúc playback được decode tới lúc mẫu thực sự đi qua I2S/DMA và quay
về microphone. Probe acoustic đã cho thấy residual echo có thể tạo retrigger.

Slice này chỉ làm cho reference timing đo được và cấu hình được. Nó không tự
bật `deviceDuplex`, không thay WakeNet model/threshold và không lưu raw audio.

## Goals

1. Có `referenceDelayMs` bounded trong firmware board/Kconfig để AEC không phải
   dùng timing literal trong code.
2. Reference ring chỉ được cấp cho AEC khi đạt minimum delay; trước đó AEC nhận
   zero reference thay vì mẫu playback quá sớm.
3. Đếm được ring underrun/overrun, processed frame, depth cao nhất và delay đã
   áp dụng; log chỉ chứa số liệu, không chứa PCM/transcript.
4. Có host tests cho resample, delay gate, ring overflow/underflow và reset.
5. Có evidence physical echo-only tách biệt với voice-onset barge-in.

## Non-goals

- Không triển khai adaptive echo cancellation mới hoặc thay ESP-SR AEC.
- Không thay đổi wire protocol, server provider, database, Wi-Fi, NVS hay Tailscale.
- Không tuyên bố acoustic promotion chỉ vì reference metrics hoặc host tests pass.

## Options

### A — fixed delay literal trong `vt_aec.c`

Ít thay đổi nhất nhưng timing bị ẩn trong source, không A/B được theo board và
vi phạm config-driven.

### B — bounded delay gate + counters (chọn)

Đưa delay vào Kconfig/board profile; một reference ring thuần timing giữ
`delaySamples`, producer/consumer depth và counters. ESP-SR AEC vẫn là model
owner. Đây là thay đổi nhỏ, test được host và đủ để đo trước khi tune.

### C — adaptive calibration hoàn toàn tự động

Có thể theo dõi impulse/latency theo runtime nhưng cần corpus, DSP calibration
và thêm rủi ro CPU/PSRAM. Để sau khi B đã có baseline.

## Chosen design

### Configuration

Thêm `CONFIG_VEETEE_AEC_REFERENCE_DELAY_MS`, bounded `0..500`, default `80` ở
board profile. Giá trị này là minimum number of 16 kHz samples that must remain
in the ring before a reference sample is consumed. `0` giữ behavior hiện tại.
Kconfig help ghi rõ đây là board-tuned I2S/DMA delay, không phải acoustic
quality guarantee.

`vt_aec_config_t` nhận `reference_delay_ms`; `vt_aec_t` lưu `delay_samples`.
Delay được chuyển đổi sau validation, tránh overflow và reject config không hợp
lệ trước khi tạo ESP-SR handle.

### Reference flow

```text
Opus decode → 24k PCM → bounded resample → reference ring producer
                                              │
                    ring depth > delaySamples ─┘
                                              ↓
mic PCM → pop delayed 16k reference → ESP-SR AEC → WakeNet/VAD/Opus
```

Nếu depth chưa vượt delay, `pop` trả zero frame nhưng không tiêu thụ mẫu
reference. Khi ring đầy, drop oldest và tăng `overrun`. Khi AEC cần reference
nhưng ring không đủ sau delay, trả zero phần thiếu và tăng `underrun`.
Reset xóa read/write/count, counters giữ nguyên trong cùng boot để operator
đọc được tổng evidence; một `generation`/reset count tăng mỗi reset.

### Diagnostics API

Thêm struct read-only `vt_aec_stats_t`:

```c
typedef struct {
    uint32_t delay_samples;
    uint32_t depth_samples;
    uint32_t peak_depth_samples;
    uint32_t producer_samples;
    uint32_t consumer_samples;
    uint32_t underrun_count;
    uint32_t overrun_count;
    uint32_t processed_frames;
    uint32_t reset_count;
} vt_aec_stats_t;
```

Getter copy ra snapshot dưới mutex. Capture task log một dòng mỗi khoảng thời
gian diagnostics đã có, chỉ khi AEC ready và chỉ các counter/depth. Production
build không bật log diagnostics nếu Kconfig tắt.

### Testing

- Host-only reference timing module test: 24k→16k output count/order, delay
  gate trước/sau ngưỡng, bounded overflow, zero-fill underrun, reset.
- Firmware build/host CTest với `-Wall -Wextra -Werror -Wconversion`.
- Physical echo-only scenario: server phát bounded fixture response, không phát
  clip giọng người; yêu cầu `barge_in_count=0`, `active_turns=0`, không marker
  panic/queue/Opus. Scenario chỉ là diagnostic, không thay acceptance corpus.
- Voice-onset scenario chạy riêng sau echo-only, đo `time-to-silence` và
  `barge_in_suppressed_cooldown` để tránh trộn hai verdict.

## Rollout and rollback

1. Host tests và ESP-IDF build trước; không flash nếu build không đổi image.
2. Flash một image có delay mặc định chỉ khi operator cho phép; không erase NVS.
3. Chạy echo-only rồi mới voice-onset; ghi report redacted vào `/tmp`.
4. Rollback bằng board config delay `0` hoặc image trước đó; server snapshot
   vẫn half-duplex.

## Acceptance evidence

Slice chỉ được coi là đạt khi counters không overflow ngoài policy, host tests
pass, physical echo-only không tự barge và docs ghi rõ các gate còn mở. Không
được dùng TTFA fixture tone hoặc serial marker đơn lẻ để kết luận AEC quality.
