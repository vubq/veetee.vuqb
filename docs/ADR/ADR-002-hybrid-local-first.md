# ADR-002: Chọn Hybrid local-first cho conversation runtime

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-03
- Người quyết định: chủ dự án Veetee

## Context

Veetee phải ưu tiên miễn phí, nhẹ, nhanh, tiếng Việt tốt và chạy trên Ubuntu 24.04 với GTX 1650Ti 4 GB VRAM, RAM 16 GB. Conversation cần streaming, tool calling và warm Lab E2E TTFA p95 dưới 1,5 giây, bao gồm endpointing. Một LLM local đủ mạnh để reasoning/tool use cạnh tranh tài nguyên trực tiếp với ASR/TTS; API-heavy lại làm audio phụ thuộc Internet và free-tier.

Wake word/AFE chạy cùng audio task trên ESP32-S3 là ranh giới đã được reference chứng minh (`references/xiaozhi-esp32/main/audio/README.md:6-30`, `references/xiaozhi-esp32/main/audio/engines/afe_audio_engine.cc:110-163`). Reference server cũng cho thấy LLM token có thể được đưa dần sang TTS queue (`references/xiaozhi-esp32-server/main/xiaozhi-server/core/connection.py:1128-1200`).

## Decision drivers

- Must giữ microphone/audio inference local khi có thể.
- Must có LLM streaming và tool calling đủ mạnh.
- Must không vượt 4 GB VRAM trong steady state.
- Should tiếp tục hội thoại khi một stage local được warm.
- Should giảm dịch vụ và model cạnh tranh GPU.

## Các phương án

### A. Hybrid local-first

On-device wake/AFE/AEC; VAD, ASR và TTS local; Groq cho LLM/tool calling.

- Ưu điểm: audio riêng tư hơn, chi phí thấp, LLM mạnh, phân bổ tài nguyên rõ.
- Nhược điểm: Internet vẫn nằm trên LLM critical path; cần quản lý model local.
- Rủi ro: Groq free-tier `429`; sản phẩm trả lỗi/progress rõ ràng, không tự đổi key/provider.

### B. API-heavy

ASR, LLM và TTS đều gọi API.

- Ưu điểm: máy local nhẹ và cập nhật model nhanh.
- Nhược điểm: nhiều RTT, quota/cost, audio rời máy và nhiều điểm lỗi ngoài kiểm soát.

### C. Fully local

ASR, LLM và TTS đều chạy trên máy dev.

- Ưu điểm: hoạt động offline và không phụ thuộc quota.
- Nhược điểm: LLM đủ tốt cho tool/reasoning không vừa hợp lý cùng audio models trong 4 GB VRAM; TTFA và vận hành xấu hơn.

## Quyết định

Chọn **A — Hybrid local-first**:

- ESP32: WakeNet + AFE/AEC/noise suppression.
- Máy local: Silero VAD, ASR local và VieNeu TTS.
- Groq: LLM streaming/tool calling, model ID cấu hình động nhưng pin trong config revision.
- Không chạy server-side wake word hoặc local LLM trong baseline.

## Consequences

### Tích cực

- GPU/RAM dành cho audio path có thể đo và giới hạn.
- Không upload continuous idle audio.
- Có thể đổi ASR/TTS package qua provider manifest mà không đổi conversation core.

### Tiêu cực

- Mất Internet hoặc Groq quota làm LLM turn thất bại.
- Cần test driver/CUDA/ONNX và warm-up trên đúng GTX 1650Ti.
- Không thể tuyên bố offline assistant hoàn chỉnh.

### Mitigations và guardrails

- Progress/error phrase đến từ i18n config, không hardcode.
- Provider failure là explicit terminal event của turn; không automatic fallback.
- Model pin + benchmark record + resource arbiter; không load model không rõ budget.
- Test-only Groq key sequence nằm ngoài production config/domain model.

## Verification

- [ ] `nvidia-smi` peak VRAM ≤ 3.500 MiB trong 60 phút soak.
- [ ] System available RAM không xuống dưới 2 GiB trong acceptance run.
- [ ] Warm Lab E2E TTFA p95 < 1.500 ms trên LAN.
- [ ] Groq `429` tạo error event đã chuẩn hóa và không đổi credential trong production.
- [ ] Network-off test không làm firmware/server treo; session quay về idle có lý do rõ.

## Liên quan

- [ADR-006](./ADR-006-streaming-turn-cancellation.md)
- [ADR-007](./ADR-007-provider-registry-lifecycle.md)
- [04-audio-pipeline.md](../04-audio-pipeline.md)
- [09-deployment.md](../09-deployment.md)
