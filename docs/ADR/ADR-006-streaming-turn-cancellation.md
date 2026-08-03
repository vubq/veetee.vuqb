# ADR-006: Semantic streaming với structured turn cancellation

## Trạng thái

Accepted

## Ngày và người quyết định

- Ngày: 2026-08-03
- Người quyết định: chủ dự án Veetee

## Context

Veetee phải bắt đầu nói trước khi LLM hoàn tất, ngắt được ngay khi người dùng chen và vẫn xử lý câu trả lời dài. Reference đã stream LLM delta vào TTS text queue (`references/xiaozhi-esp32-server/main/xiaozhi-server/core/connection.py:1128-1200`), tách câu theo punctuation (`references/xiaozhi-esp32-server/main/xiaozhi-server/core/providers/tts/base.py:366-400`) và dùng `sentence_id` để bỏ stale work (`references/xiaozhi-esp32-server/main/xiaozhi-server/core/providers/tts/base.py:375-400`). Guard chỉ ở TTS là chưa đủ cho tool, ASR partial và concurrent provider tasks.

## Decision drivers

- Must warm Lab E2E TTFA p95 dưới 1,5 giây, bao gồm endpointing.
- Must không phát audio từ turn cũ sau interrupt.
- Must giữ ngữ điệu/ngắt nghỉ hợp lý, không đọc từng token.
- Must hỗ trợ answer dài không cần buffer toàn bộ.
- Should làm cancellation có thể kiểm thử deterministically.

## Các phương án

### A. Đợi full LLM response rồi TTS

- Ưu điểm: text ổn định, segment đơn giản.
- Nhược điểm: TTFA tăng theo độ dài answer và không đáp ứng realtime.

### B. TTS từng token

- Ưu điểm: latency lý thuyết thấp.
- Nhược điểm: prosody kém, pronunciation context thiếu, queue overhead lớn và khó sửa tool delta.

### C. Semantic chunk streaming + structured cancellation

- Ưu điểm: cân bằng latency/prosody; memory bounded; cancellation thống nhất.
- Nhược điểm: cần language-aware boundary detector và turn generation guard ở mọi queue.

## Quyết định

Chọn **C**.

- Mỗi user utterance tạo `turn_id` tăng đơn điệu trong một `session_id`.
- LLM delta được segment theo punctuation, clause boundary, minimum context và configurable maximum wait; localized rules đến từ provider/config.
- TTS bắt đầu từ semantic chunk đầu và yield PCM/audio frame; không chờ LLM complete.
- Mọi async task, queue item, tool call và audio frame mang `turn_id`.
- `abort(turn_id)` đặt cancellation barrier idempotent, đóng producer, flush queue và từ chối mọi result cũ.
- Button interrupt dừng playback local trước; network abort hoàn tất cleanup server.
- Progress acknowledgment là một speech segment cấu hình riêng, chỉ emit khi latency predictor/deadline policy kích hoạt; không hardcode câu chữ.

## Consequences

### Tích cực

- First audio không phụ thuộc tổng answer length.
- Answer dài dùng bounded streaming queues.
- Một invariant duy nhất loại stale ASR/tool/TTS/audio.
- Có thể đo riêng time-to-first-token, first-segment và first-audio.

### Tiêu cực

- Chunk quá ngắn làm giọng gãy; chunk quá dài làm tăng TTFA.
- Text đã phát không thể sửa nếu LLM đổi ý về sau.
- Provider SDK không hỗ trợ cancellation cần worker/process isolation.

### Mitigations và guardrails

- Không phát text chưa hoàn chỉnh nằm trong tool-call arguments.
- Segmenter có golden tests cho dấu câu, abbreviation, số, URL và code-switch Vi/En.
- Queue capacity tính theo milliseconds/characters; không dùng unbounded queue.
- Cancellation deadline; worker không dừng đúng hạn bị terminate/recycle ngoài event loop.

## Verification

- [ ] Warm Lab E2E TTFA p95 < 1.500 ms và p50 ≤ 900 ms trên LAN corpus; Operational TTFA báo riêng.
- [ ] Barge-in time-to-silence p95 ≤ 250 ms.
- [ ] Race test abort ở mọi await point cho kết quả 0 stale audio frame.
- [ ] Sinh/phát answer ≥ 30 phút với RSS/queue bounded.
- [ ] Tool arguments fragmented qua nhiều delta không bao giờ đi vào TTS.

## Liên quan

- [04-audio-pipeline.md](../04-audio-pipeline.md)
- [07-server-design.md](../07-server-design.md)
- [ADR-002](./ADR-002-hybrid-local-first.md)
