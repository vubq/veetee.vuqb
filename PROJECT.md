# Veetee — bản đồ dự án cho AI coding workflow

Đây là file định hướng đọc nhanh trước khi AI coding model(s) bắt đầu làm việc
trong workspace. Nó không thay thế các specification/ADR chi tiết. Khi có mâu
thuẫn, yêu cầu mới nhất của chủ dự án và tài liệu source-of-truth trong
[`AGENTS.md`](AGENTS.md) thắng file này.

## 1. Trạng thái hiện tại

### Ranh giới workspace

Đây là checkout mới và độc lập tại `/home/vubq/Project/EmYeuKhoaHoc2/veetee`.
Checkout cũ tại `/home/vubq/Project/EmYeuKhoaHoc/veetee` nằm ngoài phạm vi của
dự án này: không sửa file, không flash firmware, không đổi secret/Wi-Fi/process
hay dùng database/port của checkout cũ. Runtime và evidence của dự án này phải
dùng namespace riêng (ví dụ database `veetee_vubq`, PostgreSQL loopback `55432`
và các service port `18xxx`).

- Bộ planning `docs/00` → `docs/11`, các ADR và roadmap vẫn là source of truth;
  chủ dự án đã explicit mở product code scope. M0/M1/M2 slices đang được triển
  khai theo note trong `docs/implementation-notes/`.
- `veetee-manager-web/` giữ visual foundation đã duyệt, đồng thời có HTTP gateway
  và provider registry schema-driven khi chạy cùng Manager API.
- Preview đã có code Vue/Vite/Tailwind, Reka-backed `Vt*` primitives, mock gateway
  và năm surface; nó không gọi API/database/Voice Server/firmware, không có auth
  hoặc secret production và **không** được tính là hoàn thành M2/full product.
- Visual approval không thay cho full primitive-state inventory, keyboard-only
  core flows, demo/catalog cleanup hoặc snapshot matrix mọi surface/viewport;
  các gate này vẫn cần evidence riêng trước production promotion.
- Evidence hiện tại của riêng preview: `npm test` pass typecheck, lint, 15 unit
  tests và production build; 8 Chromium E2E pass, gồm history keyboard,
  responsive overflow check
  và axe scan không có violation `serious`/`critical` trên năm surface.
- Hai thư mục dưới `references/` là snapshot bằng chứng **read-only**. Chỉ đọc
  để kiểm tra protocol/behavior và trích dẫn `path/to/file:line-line`; không fork,
  extend, vendor, copy nguyên khối hoặc sửa chúng. Commit pin, remote và quy trình
  fetch/compare được lưu trong [`references.lock.json`](references.lock.json).
- Khi chủ dự án yêu cầu implementation, AI phải làm theo vertical slice và DoD
  trong [`docs/10-roadmap.md`](docs/10-roadmap.md). Không biến các milestone thành
  lịch ngày cố định.

## 2. Sản phẩm cần xây

| Thành phần | Trách nhiệm chính | Công nghệ/runtime baseline |
|---|---|---|
| `veetee-firmware/` | ESP32-S3 N16R8, audio I/O, AFE/AEC/noise suppression, wake, Opus, state machine, hardware MCP | ESP-IDF + FreeRTOS, device-side real-time tasks |
| `veetee-server/` | WebSocket session, VAD → ASR → Groq LLM/tools → VieNeu TTS, streaming và TTFA | Python realtime data plane, host CUDA/ONNX khi provider cần |
| `veetee-manager-api/` | Assistant/device/provider/config/history/auth/assets control plane | Node.js + TypeScript + Fastify, PostgreSQL |
| `veetee-manager-web/` | Dashboard cấu hình và vận hành; hiện chỉ có mock UI preview được duyệt | Vue 3 + Vite + Tailwind CSS; typed OpenAPI client vẫn thuộc implementation M2 sau này |

Local baseline chạy **host-native trên Ubuntu 24.04**, không Docker, Compose,
Podman hay workflow bắt buộc container. Reverse proxy, PostgreSQL, Python,
Node.js và model runtime đều là host services/processes theo
[`docs/09-deployment.md`](docs/09-deployment.md).

## 3. Thứ tự đọc bắt buộc

Trước một task mới, đọc theo thứ tự sau:

1. `PROJECT.md` (file này) và [`AGENTS.md`](AGENTS.md).
2. [`docs/01-vision-scope.md`](docs/01-vision-scope.md) để biết mục tiêu và
   non-goals.
3. [`docs/10-roadmap.md`](docs/10-roadmap.md) để xác định milestone/DoD của task;
   milestone là gate chấp nhận, không phải lịch thời gian.
4. [`docs/11-open-questions.md`](docs/11-open-questions.md); nếu câu hỏi được
   đánh dấu blocking thì dừng và hỏi chủ dự án.
5. Đọc tài liệu component liên quan trong bảng dưới.
6. Đọc ADR liên quan trước khi thay đổi một quyết định đã ghi.

| Task | Tài liệu tối thiểu |
|---|---|
| Wire, handshake, audio frame, conformance | [`00-reference-analysis.md`](docs/00-reference-analysis.md), [`03-protocol-spec.md`](docs/03-protocol-spec.md), ADR-001 |
| Latency, VAD, ASR/LLM/TTS streaming, barge-in | [`04-audio-pipeline.md`](docs/04-audio-pipeline.md), [`07-server-design.md`](docs/07-server-design.md), ADR-002/006/007 |
| Firmware task/state/MCP | [`06-firmware-design.md`](docs/06-firmware-design.md), `03-protocol-spec.md`, ADR-001/005/006 |
| Provider manifest/lifecycle/config | [`05-provider-registry.md`](docs/05-provider-registry.md), ADR-007, [`11-open-questions.md`](docs/11-open-questions.md) |
| Manager API/data/auth | [`08-manager-design.md`](docs/08-manager-design.md), ADR-003/008/009 |
| Manager Web/UI | [`08-manager-design.md`](docs/08-manager-design.md), [`UI preview design`](docs/superpowers/specs/2026-08-03-manager-web-ui-preview-design.md), ADR-004; dùng skill Vue/UI/accessibility khi cần |
| Local run, LAN, model/resource budget | [`09-deployment.md`](docs/09-deployment.md), ADR-002/010/014 |
| Kiến trúc mới | [`docs/ADR/ADR-000-template.md`](docs/ADR/ADR-000-template.md) và các ADR liên quan |

## 4. Nơi được thao tác và ownership

Khi các thư mục product được tạo, chỉ sửa đúng vùng sở hữu:

- `veetee-firmware/`: C/C++ firmware, board HAL, FreeRTOS task, protocol adapter
  và MCP phần cứng. Không đặt provider ASR/LLM/TTS hay business prompt ở đây.
- `veetee-server/`: transport/session/turn và pipeline audio/provider. Không đặt
  CRUD Manager, UI, GPIO/pin map hoặc cơ chế đổi provider/key tự động ở đây.
- `veetee-manager-api/`: Fastify routes/plugins, schema/OpenAPI, PostgreSQL,
  auth, config revisions, jobs và audit. Không proxy audio realtime.
- `veetee-manager-web/`: Vue views/components/composables, generated API client,
  i18n và accessible design tokens. Không truy cập DB hoặc giữ secret trong
  browser storage.
- `docs/`: cập nhật specification/ADR/test oracle khi contract thay đổi.
- `references/`: tuyệt đối không sửa.

Shared contract giữa deployable chỉ đi qua wire fixture, OpenAPI artifact hoặc
schema artifact versioned; không import source nội bộ của deployable khác.

## 5. Các bất biến phải giữ

- Product naming, package, API, DB, UI và telemetry dùng `Veetee` hoặc thuật ngữ
  trung tính. Tên của repo tham chiếu chỉ được xuất hiện trong Phase 0 citation/
  compatibility fixture, không xuất hiện trong product namespace/brand.
- Direct WebSocket v3 là product default từ M0. v1/v2 là compatibility profile
  explicit; không sniff, silent downgrade hoặc transport fallback.
- Mọi protocol extension phải additive và peer cũ phải bỏ qua field/message
  optional. `03-protocol-spec.md` là hợp đồng byte/message duy nhất.
- Audio baseline: uplink Opus mono 16 kHz/60 ms; downlink Opus mono 24 kHz/60 ms.
  TTFA acceptance dùng mốc đã chuẩn hóa trong `04-audio-pipeline.md`.
- Một provider selection active cho mỗi kind (`vad`, `asr`, `llm`, `tts`, `intent`,
  `memory`); phiên bản hiện tại không có cross-provider fallback. Groq free-key
  list chỉ được dùng trong test harness, không phải production key rotation.
- Vietnamese là locale đầu tiên, nhưng prompt, personality, exit intent, progress
  acknowledgment, language và voice phải là versioned config/i18n; không hardcode
  literal nghiệp vụ trong core.
- Không hardcode GPIO, pin map, board revision, model ID, credentials,
  broker/topic, wake phrase hoặc UI brand color vào domain logic.
- Wake word/AEC/AFE ở device; VAD/ASR/LLM/TTS ở server theo provider registry.
- Voice cloning, knowledge base và external MCP endpoint chờ tài liệu riêng.
  Emoji collection và conversation background không thuộc scope hiện tại.

## 6. Cách một AI thực hiện task

Số lượng AI coding model là lựa chọn theo tình huống: một model có thể làm tuần
tự, hoặc nhiều model có thể phối hợp khi các phần độc lập và contract đã khóa.
Không chia branch/worktree chỉ để chia việc; không coi Git/PR là deliverable bắt
buộc. Có thể báo phần trăm tiến độ nếu hữu ích, nhưng không gắn lịch/ngày hoàn
thành cho từng phần. Milestone là acceptance gate và evidence bundle, không phải
cơ chế báo cáo tiến độ bắt buộc.

Quy trình tối thiểu:

1. Đọc đúng tài liệu/ADR và kiểm tra working tree trước khi sửa.
2. Xác định acceptance criterion, blocking question, file ownership và test
   oracle; thiếu input phần cứng/secret thì dừng hỏi, không đoán.
3. Thực hiện thay đổi nhỏ nhất trong component sở hữu; không refactor lan rộng.
4. Chạy test/fixture/benchmark phù hợp. Protocol change phải chạy golden và
   cross-conformance; audio/model change phải đo TTFA, RTF và peak resource.
5. Cập nhật docs/schema/OpenAPI/ADR cùng thay đổi nếu contract bị ảnh hưởng.
6. Handoff nêu outcome, file/contract, lệnh và kết quả kiểm tra, giới hạn,
   physical checks cần chủ dự án thực hiện và rollback an toàn.

Manager Web mock preview và API mode đã có command contract host-native trong
`veetee-manager-web/README.md` và `package.json`. Voice Server, Manager API và
firmware hiện có README/command/test contract tương ứng; riêng PostgreSQL control
plane dùng manifest `tools/runtime/manifests/host-native-postgres-dev.json`,
database `veetee_vubq` trên instance loopback riêng. Không coi preview hoặc
fixture memory là bằng chứng cho physical firmware hay M2 production gate.

## 7. Skill routing

Chỉ đọc skill khi task tương ứng cần nó, và để tài liệu dự án thắng hướng dẫn
generic:

- Firmware/FreeRTOS: `embedded-systems`.
- ADR/spec: `architecture-decision-records`, `openapi-spec-generation`.
- Fastify API: `fastify-best-practices`.
- Vue/Tailwind UI: `vue`, `ui-skills-root`, `frontend-design`; kiểm tra
  `fixing-accessibility` và `web-design-guidelines` khi có UI tương tác.
- Browser/E2E sau khi có UI chạy: `playwright` hoặc `qa`.

Skill không cấp quyền sửa `references/`, dùng Docker, bỏ qua blocking question,
thêm feature deferred hoặc thay đổi wire contract không có ADR.

## 8. Các file cần cập nhật khi bàn giao

- Contract/wire: `docs/03-protocol-spec.md` và golden fixtures.
- Pipeline/latency: `docs/04-audio-pipeline.md`.
- Provider: `docs/05-provider-registry.md`.
- Firmware/server/manager/deployment: tài liệu component tương ứng.
- Quyết định có nhiều option: thêm ADR từ template.
- Câu hỏi chưa chốt: cập nhật `docs/11-open-questions.md`, không tự điền bằng
  assumption.

Không coi build pass, log serial hay compatibility fixture là physical acceptance.
Board thật vẫn cần được người dùng nghe/nhìn/chạm kiểm tra ở các DoD tương ứng.
