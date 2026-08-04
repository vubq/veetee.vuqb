# Open questions, resolved decisions và input còn thiếu

> Mục đích: không để AI coding workflow tự điền khoảng trống bằng suy đoán.  
> `Resolved` là quyết định đã được chủ dự án trả lời hoặc ủy quyền chốt. `Provisional` là default kiến trúc có promotion gate. `Open` cần input trước milestone ghi trong bảng.

## 1. Ba câu hỏi bắt buộc từ brief

### Q-001 — ASR + TTS + wake có vừa 4 GB VRAM không?

**Trạng thái: Provisional, đã có câu trả lời thiết kế; cần benchmark M0 để xác nhận số đo.**

Đề xuất cụ thể:

| Thành phần | Lựa chọn | Placement | Budget |
|---|---|---|---:|
| Wake/AEC/NS | ESP-SR/WakeNet/AFE | ESP32-S3 | 0 host VRAM |
| VAD | Silero VAD 6.2.1 ONNX | CPU | 0 VRAM, model ~2,3 MB |
| ASR | PhoWhisper-small pinned + self-converted CTranslate2 FP16 | GTX 1650Ti | ~2 GiB proxy, gate ≤ 2,5 GiB |
| TTS | VieNeu v3 Turbo 3.2.4 ONNX INT8 streaming | CPU | 0 VRAM, estimate 0,5–0,9 GiB RAM |

Kết luận: **có khả năng vừa với biên tốt**, vì chỉ ASR dùng GPU; target toàn stack ≤ 3,5 GiB/4 GiB. `~2 GiB` là proxy upstream Whisper, chưa phải measurement PhoWhisper trên Acer.

Nếu benchmark không đạt, đây là các **deployment selection** theo thứ tự, không phải runtime fallback:

1. Quantize cùng PhoWhisper-small thành `int8_float16` nếu WER tăng ≤ 0,5 điểm tuyệt đối.
2. Chọn thủ công Zipformer chỉ khi license, provenance, Vietnamese WER và latency đều pass.
3. Chọn một ASR API free-tier bằng config revision nếu chủ dự án chấp nhận audio rời máy.

Không load PhoWhisper và Zipformer đồng thời; không tự đổi provider trong turn.

Chủ dự án đã ủy quyền chọn hướng cập nhật và phù hợp streaming nhất. Vì vậy
**VieNeu v3 Turbo là provisional baseline đã chọn**, chỉ được promote sau
benchmark/soak trên đúng máy đích. VieNeu v2 là manual challenger khi benchmark
v3 không đạt; không phải runtime fallback và không được load song song.

### Q-002 — Wake word on-device hay server-side?

**Trạng thái: Resolved — on-device.**

Đã chọn ESP-SR/WakeNet trong AFE:

- Idle audio không stream liên tục, tiết kiệm băng thông và riêng tư hơn.
- Wake latency không cộng network RTT/server availability.
- AEC/noise/wake dùng cùng device audio reference.
- Đổi wake model cần firmware/assets release thay vì chỉ server deploy.

Server-side wake chỉ được xem lại cho digital client hoặc model không thể chạy trên board; cần ADR mới. Reference đã chứng minh device-side WakeNet/AFE và wake pre-roll (`references/xiaozhi-esp32/main/audio/README.md:6-30`, `references/xiaozhi-esp32/main/application.cc:869-903`).

Implementation note: standalone ESP-SR `afe_aec` adapter đã init được trên board
và lifecycle wake-during-playback đã qua smoke/10-repetition fixture gate. Điều
còn mở là acoustic echo-only corpus, exact reference delay và voice-onset
realtime barge-in; không tự coi đây là full AFE promotion.

### Q-003 — Manager Web framework nào nhẹ và dễ deploy?

**Trạng thái: Resolved — Vue 3 + Vite + Tailwind CSS.**

Composition API + `<script setup lang="ts">`, typed API client, route/feature boundaries và locale catalogs. Static build được phục vụ sau reverse proxy; không cần SSR trong baseline.

## 2. Quyết định khác đã resolved

| ID | Quyết định | Kết quả |
|---|---|---|
| D-001 | Overall execution | Hybrid local-first. |
| D-002 | Manager API | Node.js + TypeScript + Fastify. |
| D-003 | LLM | Groq streaming/tool calling; model ID qua config/capability probe. |
| D-004 | TTS family | VieNeu; v3 Turbo pinned là provisional baseline. |
| D-005 | Provider fallback | Không có; một selection/kind, explicit error. |
| D-006 | Groq free keys | Test harness only; không phải feature/domain config. |
| D-007 | Local transport | Direct WS v3 là default từ M0; v1 chỉ compatibility/conformance; MQTT/UDP v3 staged. |
| D-008 | Persistence baseline | PostgreSQL + local object directory từ M2; Redis không thuộc baseline và chỉ thêm qua promotion ADR. |
| D-009 | Deferred features | Voice cloning, knowledge base, external MCP endpoint chờ tài liệu. |
| D-010 | Excluded UI | Emoji collection và conversation background không thiết kế. |
| D-011 | Manager user auth | Local Argon2id credential + opaque PostgreSQL-backed session cookie; machine bearer tách riêng. |
| D-012 | Local deployment | Host-native Ubuntu services; không Docker/Compose. |
| D-013 | Manager Web primitives | Reka UI stable major chỉ trong Veetee wrappers; không browser-default visual. |
| D-014 | UI preview foundation | Owner-approved current foundation: hybrid top-nav/context workspace, screenshot-aligned tokens và Be Vietnam Pro self-host. |
| D-015 | Runtime configuration | Manager Web/API publish immutable snapshot; Voice Server poll ETag và atomic apply, không restart turn/process. |
| D-016 | HTTPS inspection | Private Tailscale Serve; domain lấy từ `tailscale serve status`, không Funnel cho route Veetee. |
| D-017 | Device presence freshness | `onlineState=online` chỉ được coi là online trong `VEETEE_DEVICE_ONLINE_TTL_SECONDS` (mặc định 120 giây); `deviceCount` vẫn đếm mọi device đã bind. |

## 3. Blocking trước khi implement M0

### Q-004 — Exact hardware BOM và pin map là gì?

**Trạng thái: Partially resolved — pin map/runtime board đã được xác nhận; BOM
và các peripheral chưa dùng vẫn mở.**

Board profile đang chạy trên thiết bị thật là `bread-compact-wifi-lcd`,
ESP32-S3 N16R8, flash 16 MB, PSRAM 8 MB. Pin/rate đã được flash và serial
verify ở `veetee-firmware/sdkconfig.defaults:17-58`:

- PTT GPIO0, active-low.
- Mic I2S: BCLK GPIO5, WS GPIO4, DIN GPIO6, mono 16 kHz.
- Speaker I2S: BCLK GPIO15, WS GPIO16, DOUT GPIO7, mono 24 kHz.
- ST7789 SPI2: MOSI GPIO47, SCLK GPIO21, DC GPIO40, RESET GPIO45, CS GPIO41,
  backlight GPIO42 active-high, 240×280, offset `(0,20)`.
- Audio frame 60 ms, Opus uplink/downlink theo negotiated profile.

Các phần vẫn cần schematic/BOM exact trước khi bật production hardware MCP:

- Module/dev board exact name/revision và schematic.
- RGB LED type/pin/count.
- IR TX/RX hardware, mmWave model/bus/pins và power constraints.
- Flash partition/OTA/assets size expectation.

Phương án A: cung cấp schematic/BOM hiện có.  
Phương án B: kiến trúc đề xuất một reference board/BOM riêng và chờ duyệt trước firmware code.  
**Default hiện tại:** giữ board profile/pin map đã verify cho audio/LCD/PTT; không
quảng bá peripheral chưa có manifest và không bật MCP/OTA production khi BOM
chưa chốt.

### Q-005 — Groq model nào được free account hiện thấy?

**Trạng thái: Resolved cho baseline, promotion vẫn cần benchmark lặp lại.**

Khi chủ dự án cung cấp key qua secret channel, test read-only phải lấy model list và probe:

- Streaming text delta.
- Parallel/sequential tool calls và fragmented arguments.
- Context/output limits.
- First-token p50/p95 và rate-limit headers.
- Vietnamese instruction/tool-following corpus.

Phương án A: chọn model nhanh nhất pass intelligence/tool suite.  
Phương án B: chọn model thông minh nhất vẫn giữ end-to-end TTFA budget.  
**Baseline đã chọn:** `llama-3.3-70b-versatile` vì probe ngày 2026-08-03 cho
streaming first text khoảng 300 ms và có tool-call delta. `llama-3.1-8b-instant`
là challenger nhanh/nhẹ. Đây là giá trị config được publish từ Web, không phải
literal trong server và không tự rotate qua key/provider khác.

**Promotion gate:** chạy lại corpus tiếng Việt + tool suite, p50/p95 first
meaningful token, context/output limit và 429 behavior. Nếu không đạt TTFA,
owner chọn challenger bằng revision mới; runtime không tự chuyển.

### Q-006 — Wake phrase và asset source?

**Trạng thái: Resolved policy, asset cụ thể vẫn chờ board/corpus.**

Cần exact phrase(s), accent coverage và custom WakeNet asset/training path nếu không dùng preset.

Phương án A: preset WakeNet phrase để bring-up nhanh.  
Phương án B: custom Vietnamese wake phrase sau khi có corpus.  
Chọn preset WakeNet ở M1; custom Vietnamese phrase là asset revision sau khi có
corpus và đo false-accept/false-reject. Phrase không nằm trong state-machine code.

## 4. Capacity và product policy

### Q-007 — Bao nhiêu device/session đồng thời?

**Trạng thái: Resolved baseline — một active conversation.**

Phương án A: một active conversation, nhiều device paired nhưng queue/admission chỉ cho một turn dùng model.  
Phương án B: từ hai active conversations trở lên, cần ASR/TTS concurrency/resource scheduling benchmark.  
Chọn một active conversation dùng model lease; nhiều device paired vẫn được,
nhưng admission từ chối turn thứ hai bằng lỗi typed thay vì OOM/thrash. Mở rộng
concurrency chỉ sau benchmark và ADR superseding.

### Q-008 — Single-owner hay multi-user/RBAC?

**Trạng thái: Resolved — một local Owner cho M2 baseline.**

Đã chọn phương án A: một owner account local; device/assistant đều thuộc owner.
Schema giữ owner IDs để có đường nâng cấp nhưng M2 không có invitation, sharing,
`operator` hoặc `viewer` runtime. Multi-user/RBAC chỉ được mở lại bằng ADR
superseding [ADR-009](ADR/ADR-009-local-manager-authentication.md).

### Q-009 — Retention cho transcript/audio là bao lâu?

**Trạng thái: Resolved baseline.**

Phương án A: transcript 30 ngày, audio off mặc định; local Owner có thể xóa/export.  
Phương án B: không lưu transcript/audio, chỉ latency/error metadata.  
Phương án C: retention khác do chủ dự án chỉ định.  
Chọn transcript 30 ngày, audio capture off mặc định; Owner có thể export/delete
và UI luôn hiển thị retention notice. Thay đổi policy tạo revision.

### Q-010 — Chỉ LAN hay cần remote/public access?

**Trạng thái: Resolved cho baseline — trusted LAN/private overlay; public exposure deferred.**

Đã chọn phương án A cho baseline: trusted LAN hoặc private overlay; không
port-forward public. Phương án B chỉ được xem lại ở M4 khi chủ dự án yêu cầu
public Internet và có threat model, TLS/rate-limit policy cùng ADR tương ứng.

## 5. UX và data inputs chưa có

### Q-011 — Visual identity của Manager Web

**Trạng thái: Resolved cho UI preview foundation; production brand assets deferred.**

Chủ dự án đã xác nhận UI preview hiện tại đạt yêu cầu. Baseline được chốt gồm
hybrid top-nav/context workspace, border/radius/control proportion, Be Vietnam
Pro, light theme, component styling và responsive direction. Ảnh tham khảo chỉ
là evidence về information architecture/component rhythm, không cấp quyền sao
chép brand/assets.

Logo, brand asset riêng hoặc dark theme là input additive tương lai, không block
planning baseline và không được âm thầm restyle UI đã duyệt. Xem
[UI preview design](superpowers/specs/2026-08-03-manager-web-ui-preview-design.md).

### Q-012 — Speaker enrollment consent và use case

**Trạng thái: Resolved policy; implementation M3.**

UI reference có speaker recognition, nhưng cần quyết định:

- Chỉ nhận diện người nói để personalize hay dùng authorization?
- Ai được enroll/delete và retention của voiceprint?
- Có yêu cầu liveness/anti-spoof không?

Chọn personalization-only, không dùng voiceprint làm authentication; enrollment,
download và delete cần explicit consent/audit. Liveness/anti-spoof không thuộc
baseline.

M2 chỉ được render speaker tab ở deferred/empty state. Enrollment thật vẫn thuộc
M3 và bị khóa cho đến khi câu hỏi consent/use case này được chốt.

### Q-013 — Firmware asset wizard exact outputs

**Trạng thái: Resolved policy; exact board input vẫn blocking.**

Cần source format/font license, supported display list, subtitle layout và `assets.bin` partition contract sau khi Q-004 có board/partition map.

Chọn wizard schema-first; generation bị block nếu board/display/partition không
khớp, không tạo binary “best effort”.

### Q-017 — PostgreSQL query/migration layer nào?

**Trạng thái: Resolved; implementation slice đã có, promotion gate còn mở.**

Phương án A: Drizzle + generated SQL migration được review và chạy one-shot.  
Phương án B: Kysely + migration tool SQL-first riêng.  
Phương án C: Prisma nếu ưu tiên migration/admin ecosystem hơn footprint.

Chọn A (Drizzle + SQL migration được review) vì typed schema, footprint nhỏ và SQL
inspect được. Implementation hiện dùng database riêng `veetee_vubq` trên
instance loopback `127.0.0.1:55432`, schema `veetee_manager`, migration one-shot
và immutable revision tables. M2 vẫn cần benchmark cold start, transaction
rollback, session/CSRF và PostgreSQL runtime soak trước khi promotion; memory
store hiện chỉ là dev adapter.

### Q-018 — Secret store local cụ thể là gì?

**Trạng thái: Resolved baseline; implementation gate M2.**

Phương án A: encrypted local secret store sau một `SecretStore` port; master key
đến từ systemd credential/root-owned file, ciphertext tách khỏi config/audit.  
Phương án B: external Vault/Infisical-compatible service.

Chọn A cho single-host: encrypted local secret store qua `SecretStore` port,
master key từ systemd credential/root-owned file, ciphertext tách config/audit.
M2 phải ghi ADR threat model, rotation, backup và recovery; không đưa secret vào
browser hoặc PostgreSQL plaintext.

### Q-019 — Headless UI primitives nào?

**Trạng thái: Resolved — Reka UI stable major bên trong Veetee wrappers.**

Phương án A: Reka UI stable major, chỉ import bên trong Veetee base wrappers.  
Phương án B: tự viết primitives tối thiểu.  
Phương án C: một component suite đầy đủ.

Chủ dự án đã duyệt A. Reka UI `2.10.1` đã được registry/license/browser probe,
install và pin trong lockfile; chỉ `ui/primitives` được import Reka, feature dùng
`Vt*` components. Mọi upgrade production phải lặp lại compatibility/accessibility
probe trước promotion. Quyết định nằm trong [ADR-004](ADR/ADR-004-vue-manager-web.md).

### Q-020 — Backup RPO/RTO và đích lưu nào?

**Trạng thái: Resolved baseline; rehearsal gate M2/M4.**

Phương án A: encrypted backup hằng ngày sang filesystem/ổ đĩa khác host volume,
giữ 7 bản ngày + 4 bản tuần, target RPO 24 giờ/RTO 4 giờ.  
Phương án B: backup thủ công trước upgrade lớn, phù hợp dữ liệu thử nghiệm nhưng
không đủ cho lịch sử sử dụng hằng ngày.  
Phương án C: encrypted remote object storage khi cho phép egress/chi phí.

Chọn A: encrypted filesystem/ổ khác host, giữ 7 bản ngày + 4 bản tuần, target RPO
24h/RTO 4h; audio off theo Q-009. Một bản cùng volume không được tính là backup.

### Q-021 — Wake word nhưng người dùng không nói thì giải phóng turn thế nào?

**Trạng thái: Resolved — server-owned first-speech watchdog.**

Không dùng `minSilenceMs` để ép endpoint vì VAD chưa có speech evidence và sẽ làm
pipeline gọi ASR/LLM với transcript rỗng. `autoTurn.enabled` cùng
`noSpeechTimeoutMs` nằm trong assistant snapshot; hết hạn thì server release lease,
không chạy ASR/LLM/TTS và gửi additive `alert.code="NO_SPEECH_TIMEOUT"` với text
status/emotion từ config. Snapshot thiếu policy giữ compatibility và không timeout;
đây không phải giới hạn độ dài conversation. Chi tiết ở [ADR-021](ADR/ADR-021-auto-turn-no-speech-watchdog.md).

## 6. Tài liệu chủ dự án đã hẹn cung cấp

| ID | Tài liệu | Boundary đang giữ | Không được làm trước |
|---|---|---|---|
| Q-014 | Voice cloning | Provider/voice asset IDs và deferred route slot | Không thiết kế enrollment/training API chi tiết. |
| Q-015 | Knowledge base | Extension/provider boundary | Không tự chọn vector DB/chunking/embedding. |
| Q-016 | External MCP endpoint | Tool source namespace boundary | Không tự quyết auth/transport/tenant semantics. |

## 7. Research backlog không blocking baseline

| ID | Câu hỏi | Trigger để mở lại |
|---|---|---|
| R-001 | Zipformer nào đủ license/provenance/Vi WER và true streaming? | PhoWhisper fail latency hoặc artifact mới đáng tin cậy. |
| R-002 | MQTT/UDP v3 có đáng làm default hơn WS v3? | M3 conformance + loss/latency/24h soak data. |
| R-003 | Redis có cần thiết? | Multi-instance hoặc config/event latency/DB load vượt gate. |
| R-004 | Local LLM có khả thi? | Hardware nâng cấp hoặc offline requirement mới. |
| R-005 | VieNeu full v3 thay v3 Turbo preview? | Stable release/model card + regression benchmark. |
| R-006 | Speculative LLM từ partial ASR? | True-stream ASR đủ ổn định + ADR chứng minh wrong-answer risk. |

## 8. Những câu trả lời cần ưu tiên từ chủ dự án

Điểm còn thực sự blocking hoặc cần chủ dự án cung cấp:

1. **Q-004:** schematic/BOM/pin map exact của robot.
2. **Q-005:** chỉ cần benchmark lặp lại exact model/config trước production promotion; không gửi key trong chat/log/document.
3. **Q-004 phụ thuộc:** exact wake asset/corpus nếu muốn custom (preset policy đã chọn).
4. Q-017/Q-018/Q-020 đã chọn phương án; cần rehearsal/implementation evidence,
   không cần chủ dự án chọn lại.
