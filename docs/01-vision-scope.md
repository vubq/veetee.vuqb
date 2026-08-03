# Veetee — tầm nhìn và phạm vi

> Trạng thái: thiết kế Phase 1.  
> Ngày: 2026-08-03.  
> Nguồn hợp đồng wire: [00-reference-analysis.md](./00-reference-analysis.md).  
> Nguyên tắc: tài liệu là executable specification cho AI coding workflow; phiên này không tạo product code. Việc dùng một hay nhiều model tuỳ task, không làm thay đổi source of truth.

## 1. Tầm nhìn

Veetee là robot AI hội thoại ưu tiên tiếng Việt, phản hồi tự nhiên theo nhịp nói hằng ngày và tự host trên một máy phát triển phổ thông. Hệ thống được viết mới hoàn toàn thành bốn sản phẩm độc lập:

| Thành phần | Trách nhiệm duy nhất |
|---|---|
| `veetee-firmware` | Thu/phát audio, tương tác vật lý, state machine và MCP hardware tools trên ESP32-S3 N16R8. |
| `veetee-server` | Realtime data plane: transport, VAD → ASR → LLM/tools → TTS và streaming audio. |
| `veetee-manager-api` | Control plane cho assistant, device, provider configuration, secret references, lịch sử và firmware assets. |
| `veetee-manager-web` | Dashboard Vue để vận hành control plane; không tham gia critical path của hội thoại. |

Tên package, API, database, UI copy và telemetry của dự án chỉ dùng **Veetee** hoặc thuật ngữ trung tính. Tên của repo khảo sát chỉ được phép xuất hiện trong Phase 0, citation và compatibility fixture được cô lập.

## 2. Kết quả người dùng phải cảm nhận được

1. Giữ nút để nói, thả nút để chốt câu; không bị VAD cắt giữa câu trong chế độ PTT.
2. Nói wake word để bắt đầu mà không phải stream microphone liên tục qua mạng khi idle.
3. Bấm hoặc nói chen khi AI đang phát; loa im nhanh và không phát lại audio của turn cũ.
4. Nói “bye”, “chào” hoặc intent tương đương theo locale để kết thúc. Các literal nằm trong config/intent data, không nằm trong firmware logic.
5. Câu trả lời ngắn bắt đầu phát gần như ngay; acceptance chính là **Lab E2E
   TTFA p95 < 1,5 giây** trên LAN, đo từ annotated last voiced sample đến first
   playable speaker PCM và vì vậy có tính cả endpointing.
6. LLM và TTS stream đồng thời: đủ một semantic chunk là có thể phát, không đợi toàn bộ câu trả lời.
7. Với tool/reasoning lâu, robot phát một progress acknowledgment lấy từ personality/i18n config, tiếp tục xử lý rồi đọc kết quả thật.
8. Hội thoại và câu trả lời có thể kéo dài trên 10 phút; không có timeout nghiệp vụ tùy tiện. Giới hạn kỹ thuật chỉ bảo vệ queue, memory, liveness và cancellation.

## 3. Mục tiêu bắt buộc

### 3.1 Realtime conversation

- Streaming end-to-end và timestamp ở mọi stage để tính latency.
- `turn_id` đơn điệu, cancellation idempotent và stale-work guard xuyên ASR, LLM, tool, TTS, network và playback.
- On-device AFE/AEC/noise suppression + wake word; server-side VAD/endpointing có profile theo device/locale.
- Audio uplink Opus mono 16 kHz/60 ms; downlink Opus mono 24 kHz/60 ms theo compatibility contract.
- Direct WebSocket v3 là profile Veetee-to-Veetee mặc định; v1/v2 và MQTT/UDP v3 vẫn là conformance capabilities, không phải runtime fallback chain.

### 3.2 AI/provider

- Tiếng Việt là locale đầu tiên, không phải nhánh `if language == "vi"` trong core.
- Provider kinds: `vad`, `asr`, `llm`, `tts`, `intent`, `memory`.
- Provider package tự khai báo capability và JSON Schema; manager không hardcode form theo vendor.
- Mỗi kind có tối đa một selection đang active trong một config revision. Không có cross-provider fallback ở phiên bản này.
- Groq dùng streaming và tool calling. Model ID được chọn qua config sau capability probe, không gắn cứng vào source.
- VieNeu là TTS family đã chọn; artifact/runtime chính xác phải được pin và qua benchmark trước khi promote.
- Base prompt, personality, progress message, exit intent, language và voice đều là versioned configuration.

### 3.3 Device và MCP

- Firmware cung cấp MCP tools theo capability thật của board: RGB LED, OLED, IR blaster, mmWave và MQTT/Home Assistant bridge.
- Descriptor được discover; server không chứa bảng GPIO/board command hardcode.
- Hardware mutation chạy ở owner task, có timeout, permission, audit và safety class.
- Button PTT/interrupt và wake word phải hoạt động khi network chập chờn mà không làm audio task deadlock.

### 3.4 Manager

- Assistant, device pairing, personality/prompt, provider configuration, conversation history, speaker enrollment, extension catalog và firmware asset wizard.
- UI theo chức năng đã quan sát từ 31 ảnh tham khảo nhưng không sao chép brand, source hoặc visual assets.
- Voice cloning, knowledge base và external MCP endpoint giữ placeholder boundary, chưa implement cho đến khi chủ dự án cung cấp tài liệu.
- Emoji collection và conversation background không nằm trong scope; firmware UI sẽ có thiết kế riêng.

## 4. Chỉ số thành công và cách đo

| SLI | Mục tiêu ban đầu | Điểm đo bắt buộc |
|---|---:|---|
| Lab E2E TTFA p50 | ≤ 900 ms | Annotated last voiced sample → first playable speaker PCM. |
| Lab E2E TTFA p95 | < 1.500 ms | Cùng định nghĩa, LAN ổn định, provider đã warm; bao gồm endpointing. |
| Operational TTFA | Báo riêng, không thay acceptance | `speech_endpointed_at` → first playable speaker PCM. |
| Cold Lab E2E TTFA | Ghi riêng, không trộn warm p95 | Cùng mốc E2E nhưng bao gồm model load/warm-up. |
| Barge-in time-to-silence p95 | ≤ 250 ms | Button/VAD interrupt accepted → codec output dừng. |
| Stale audio sau abort | 0 frame | Không frame có `turn_id` cũ được enqueue sau cancellation barrier. |
| Audio queue age | p99 ≤ 240 ms | Tuổi frame ở mỗi bounded queue. |
| Hội thoại dài | ≥ 60 phút soak | Không tăng RSS/VRAM đơn điệu, không mất keepalive, vẫn interrupt được. |
| Protocol | 100% golden fixtures | WS v1/v2/v3, MQTT JSON và UDP bytes. |
| Locale leakage | 0 literal nghiệp vụ | Static scan core modules; localized text chỉ đến từ catalog/config. |

TTFA không được mô tả là “bằng không”. Dashboard phải tách `warm`, `cold`, `PTT`, `wake`, `tool turn`, p50/p95 và provider revision để số liệu có thể so sánh.

## 5. Personas

| Persona | Nhu cầu chính | Không được bắt họ làm |
|---|---|---|
| Người trò chuyện | Phản hồi nhanh, nói chen được, giọng tự nhiên, không lộ thuật ngữ kỹ thuật. | Chờ LLM sinh hết hoặc reset thiết bị khi một turn lỗi. |
| Chủ thiết bị | Pair/unlink, chọn assistant/voice/personality, xem lịch sử và trạng thái. | Sửa file cấu hình hoặc biết provider credential format. |
| Người vận hành local | Chạy toàn bộ stack, xem health/latency/resource, rotate secret và rollback config. | Đọc log chứa token hay đo VRAM thủ công cho mỗi phiên. |
| Người tích hợp board | Khai báo peripheral/tool capability và build variant. | Sửa conversation core cho mỗi GPIO/display. |
| AI coding workflow | Boundary, schema, test oracle và DoD đủ rõ để triển khai theo milestone, dù một hay nhiều model thực hiện. | Suy đoán wire bytes, state owner hoặc behavior khi cancel. |

## 6. Use-case ưu tiên

### P0 — M0/M1

- Pair một ESP32-S3 và hoàn thành một turn PTT qua server tự viết.
- Wake → nghe → ASR → Groq → VieNeu streaming → phát loa.
- Button interrupt và acoustic barge-in hủy toàn bộ turn.
- Tool call tới một MCP hardware tool an toàn.
- Cấu hình base prompt/personality/language/voice không cần rebuild.

### P1 — M2/M3

- Dashboard đầy đủ cho assistant/device/provider/history.
- Speaker enrollment từ recent clean sample.
- Firmware asset wizard và OTA policy.
- MQTT/UDP v3 transport sau conformance, loss và soak gates.
- LED/OLED/IR/mmWave/MQTT/Home Assistant MCP tools.

### P2 — M4 hoặc sau đó

- Multi-user/RBAC nâng cao, HA deployment và remote public exposure.
- Locale thứ hai sau khi Vietnamese acceptance suite đạt chuẩn.
- Voice cloning, knowledge base và external MCP endpoint sau tài liệu riêng.

## 7. Non-goals

- Không fork hoặc extend source tham chiếu.
- Không chạy LLM local trên GTX 1650Ti trong baseline; 4 GB VRAM dành cho audio inference/headroom.
- Không microservice hóa từng provider ở M0/M1.
- Không speculative LLM dựa trên partial ASR ở baseline vì nguy cơ trả lời sai câu chưa chốt.
- Không automatic provider fallback, automatic Groq key rotation trong sản phẩm hoặc silent protocol downgrade.
- Không đảm bảo Internet/public-cloud deployment trong M0; LAN self-host là môi trường chuẩn.
- Không thiết kế chi tiết các tính năng đã được hoãn ở §6.

## 8. Nguyên tắc cho implementation bằng AI

1. Một quyết định có nhiều lựa chọn hợp lý phải trỏ tới ADR; không “chốt trong code”.
2. Schema, wire fixture, state transition và error code là source of truth, không phải prose rời rạc.
3. Mọi queue có capacity, unit, overflow policy và metric; mọi I/O có deadline/cancellation.
4. Mọi model/provider pin artifact revision, checksum, license và benchmark record.
5. Không log raw secret, bearer token, Groq key, audio mặc định hoặc full prompt chứa dữ liệu nhạy cảm.
6. Thay đổi protocol chỉ additive; peer không biết field optional phải bỏ qua được.
7. Mỗi milestone chỉ nhận tính năng khi có command/test oracle và evidence artifact.

## 9. Giả định đã được duyệt

- Kiến trúc Hybrid local-first.
- Manager API: Node.js + TypeScript + Fastify.
- Manager Web: Vue 3 + Vite + Tailwind CSS.
- Manager user auth: local owner + opaque server-side session cookie; machine auth tách riêng.
- Local runtime: host-native trên Ubuntu, không Docker/Compose.
- Wake word mặc định on-device.
- Groq LLM và VieNeu TTS.
- Một provider active mỗi kind, không fallback.
- Danh sách Groq free-tier keys chỉ được phép tồn tại trong test harness secret input để tiếp tục test sau `429`; không phải domain feature.
