# ADR-020: Tách playback-reference AEC thành adapter firmware riêng

## Status

Accepted — implementation gate đang được đo trên ESP32-S3.

## Context

ADR-005 yêu cầu wake word chạy on-device và giữ speaker reference khi AI đang
nói. Firmware hiện có I2S microphone mono 16 kHz, speaker mono 24 kHz, NS và
WakeNet độc lập. Wire contract đã khóa uplink/downlink Opus 60 ms nên không thể
đổi framing chỉ để khớp kích thước chunk nội bộ của AEC.

## Options

### Option A — Full ESP-SR AFE hợp nhất

Đưa mic/reference, AEC, NS, VAD và WakeNet vào một AFE instance và để AFE quản lý
feed/fetch task. Ưu điểm là pipeline chuẩn và đồng bộ chunk; nhược điểm là thay
đổi lớn task ownership hiện tại, tăng rủi ro race/PSRAM và phải migrate toàn bộ
WakeNet/NS lifecycle cùng lúc.

### Option B — Standalone `afe_aec` adapter trước WakeNet

Giữ `vt_audio`/WakeNet hiện tại, dùng ESP-SR `afe_aec` với input format `MR`,
downsample playback 24 kHz về 16 kHz, lưu reference trong bounded ring và xử lý
block cuối có padding. Chỉ gọi đường này cho WakeNet khi speaker đang phát;
uplink Opus vẫn đi qua framing 60 ms và NS như trước.

## Decision

Chọn **Option B** cho promotion slice hiện tại.

- `veetee_aec.c` là module sở hữu ESP-SR handle, reference ring, lock và
  resampling; application/state machine không biết chi tiết vendor API.
- AEC init failure là optional degradation: firmware log lỗi, giữ PTT và
  half-duplex; không tự bật wake-during-playback nếu `vt_audio_aec_ready()` false.
- `tts/start`, abort và button/wake interrupt flush reference ring trước khi
  nhận audio của generation mới. Downlink reference được thêm ngay trước I2S
  write để bám timeline playback; ring có giới hạn và bỏ mẫu cũ khi đầy.
- Không thay đổi message, binary Opus header, sample rate hoặc frame duration.

## Consequences

### Positive

- Phạm vi thay đổi nhỏ, giữ wire compatibility và PTT fallback.
- WakeNet có thể tiếp tục chạy trong lúc speaker phát mà không upload mic idle.
- Reference allocation có giới hạn; AEC không làm tăng RAM theo độ dài hội thoại.

### Negative / open gate

- ESP-SR AEC chunk (đo hiện tại 512 samples) không chia hết frame Opus 60 ms;
  block cuối được pad để giữ API in-place. Chất lượng acoustic phải được đo
  bằng echo-only/positive corpus, không suy ra từ build pass.
- Adapter chưa phải full acoustic voice-onset barge-in: uplink vẫn dừng khi
  `tts/start`; M1 time-to-silence cần physical test riêng.
- Delay giữa I2S DMA, speaker và mic cần tune theo board revision nếu echo test
  cho thấy residual vượt gate.
- `CONFIG_VEETEE_AEC_PROCESS_WAKE` là diagnostic-only switch để so sánh đường
  WakeNet có/không qua AEC trong khi vẫn giữ duplex gate; product profile phải
  giữ `y`.

## Verification

- ESP-IDF 6.0.2 build và flash không erase NVS pass; serial báo AEC ready,
  WakeNet ready, LCD/Wi-Fi/WebSocket v3 ready, không panic.
- Physical fixture flow với AEC + wake-during-playback đạt 2/2 smoke và 10/10
  repetition khi dùng test-only Groq key pool. Đây là lifecycle/resource
  evidence; acoustic echo cancellation và false accept/reject vẫn chưa được
  đánh dấu pass.
- Acoustic barge-in report AEC-on và diagnostic bypass đều timeout ở wake lần
  hai; bypass vẫn có `WAKE_DURING_PLAYBACK=y` và mức mic hữu hạn, nên AEC transform
  không được coi là nguyên nhân duy nhất. Delay/reference alignment và echo-only
  corpus vẫn mở.

## Related

- ADR-005: Wake word on-device.
- ADR-006: Streaming turn cancellation.
- `docs/04-audio-pipeline.md` và `docs/06-firmware-design.md`.
