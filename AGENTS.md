# Veetee — hướng dẫn bắt buộc cho AI coding workflow

File này áp dụng cho toàn bộ repository. Đọc nó trước khi lập plan, sửa file,
chạy service hoặc tạo component mới.

## 1. Trạng thái repository

### Ranh giới repo bắt buộc

Đang làm trong repo mới `/home/vubq/Project/EmYeuKhoaHoc2/veetee`. Repo cũ
`/home/vubq/Project/EmYeuKhoaHoc/veetee` là dự án độc lập ngoài phạm vi; agent
không được sửa, flash, restart, đổi cấu hình mạng/secret hoặc dùng database và
port của repo đó. Mọi service, test artifact và evidence phải được định danh
theo checkout mới; nếu phát hiện process/port thuộc repo cũ thì chỉ quan sát và
bỏ qua.

- Chủ dự án đã mở scope implementation. Repository hiện có M0/M1 vertical slices:
  `veetee-server/` direct WS/config pipeline, `veetee-firmware/` protocol/state
  scaffold, `veetee-manager-api/` Fastify control plane fixture và
  `veetee-manager-web/` preview + HTTP/provider config surface. Physical firmware,
  PostgreSQL persistence và model promotion vẫn chưa được coi là accepted DoD.
- UI không có `VITE_MANAGER_API_URL` vẫn là mock preview để review; khi có URL nó
  gọi Manager API qua typed HTTP gateway và publish config revision. Preview
  evidence không thay thế API/DB/firmware DoD.
- Visual foundation hiện tại của preview đã được chủ dự án duyệt. Layout,
  semantic tokens và primitive regression rules trong UI preview spec là baseline;
  không redesign hoặc auto-update visual baseline nếu không có yêu cầu explicit.
- Approval trên không đánh dấu pass cho full primitive-state inventory,
  keyboard-only core flows, demo/catalog cleanup hoặc complete snapshot matrix;
  các gate này vẫn cần evidence riêng.
- Chỉ bắt đầu implementation khi chủ dự án yêu cầu rõ milestone hoặc feature.
- Khi bắt đầu code, đi theo M0 → M4 để giới hạn scope của từng vertical slice;
  không yêu cầu PR hoặc một cấu trúc Git đặc biệt cho việc này.
- Số lượng AI coding model là lựa chọn theo tình huống: có thể một model làm tuần
  tự hoặc nhiều model phối hợp khi task thật sự độc lập. Không tạo branch/worktree
  chỉ để chia việc và không coi PR/Git là deliverable bắt buộc. Có thể báo phần
  trăm tiến độ nếu hữu ích, nhưng không gắn lịch/ngày hoàn thành cho từng phần;
  milestone và DoD mới là acceptance gate.
- Hai repository dưới `references/` là bằng chứng **read-only**, không phải source
  để fork, extend, vendor hoặc copy nguyên khối. Mốc commit/remote và quy trình
  fetch/compare nằm trong [`references.lock.json`](references.lock.json); sau khi
  cập nhật phải rà lại citations và `docs/00-reference-analysis.md`.
- Local runtime là host-native Ubuntu. Không tạo hoặc dùng Docker, Compose,
  Podman hay container-only workflow; xem
  [ADR-010](docs/ADR/ADR-010-host-native-local-deployment.md).

## 2. Source of truth và thứ tự ưu tiên

Nếu hai nguồn mâu thuẫn, dùng thứ tự sau:

1. Yêu cầu mới nhất, explicit của chủ dự án.
2. ADR có trạng thái `Accepted` mới nhất; ADR superseding thắng ADR cũ.
3. [03-protocol-spec.md](docs/03-protocol-spec.md) cho mọi byte/message/wire state.
4. Tài liệu thiết kế component tương ứng.
5. [02-architecture.md](docs/02-architecture.md) và
   [04-audio-pipeline.md](docs/04-audio-pipeline.md).
6. [10-roadmap.md](docs/10-roadmap.md) cho scope/milestone.
7. [00-reference-analysis.md](docs/00-reference-analysis.md) cho evidence lịch sử,
   không phải product architecture hiện hành.

Không tự hòa giải một contradiction trong code. Ghi rõ conflict, đề xuất options
và tạo/cập nhật ADR trước nếu quyết định có nhiều lựa chọn hợp lý.

## 3. Bộ tài liệu phải đọc

### Trước mọi implementation task

Đọc theo thứ tự:

1. [`PROJECT.md`](PROJECT.md) (bản đồ nhanh) rồi file này.
2. [01-vision-scope.md](docs/01-vision-scope.md).
3. Milestone hiện tại trong [10-roadmap.md](docs/10-roadmap.md).
4. [11-open-questions.md](docs/11-open-questions.md); không code qua blocking
   question bằng assumption.
5. ADR và component docs trong bảng dưới.

### Theo vùng thay đổi

| Vùng | Đọc bắt buộc trước khi sửa |
|---|---|
| `veetee-firmware/` | `03-protocol-spec.md`, `04-audio-pipeline.md`, `06-firmware-design.md`, ADR-001, ADR-005, ADR-006, ADR-010 |
| `veetee-server/` | `02-architecture.md`, `03-protocol-spec.md`, `04-audio-pipeline.md`, `05-provider-registry.md`, `07-server-design.md`, `09-deployment.md`, ADR-001/002/006/007/010 |
| `veetee-manager-api/` | `05-provider-registry.md`, `08-manager-design.md`, `09-deployment.md`, ADR-003/007/008/009/010/014 |
| `veetee-manager-web/` | `01-vision-scope.md`, `08-manager-design.md`, `superpowers/specs/2026-08-03-manager-web-ui-preview-design.md`, ADR-004/009/010 |
| Wire fixture/conformance | `00-reference-analysis.md`, `03-protocol-spec.md`, ADR-001; kiểm tra source cited trong `references/` |
| Model/provider | `04-audio-pipeline.md`, `05-provider-registry.md`, `09-deployment.md`, `11-open-questions.md`, ADR-002/007 |
| Schema/API/data | `05-provider-registry.md`, `08-manager-design.md`, ADR-003/007/008/009 |
| Deployment/runtime | `09-deployment.md`, ADR-002/008/009/010/014 |
| Architecture change | ADR template + mọi ADR liên quan; update cross-document links sau khi accepted |

Chỉ đọc sâu `references/` khi cần verify compatibility claim hoặc test fixture.
Mọi claim mới về reference phải có citation `path:line-line`.

## 4. Ranh giới component và nơi thao tác

Khi các thư mục product được tạo, ownership là:

| Directory | Owner | Không được chứa |
|---|---|---|
| `veetee-firmware/` | ESP32-S3, FreeRTOS, AFE/AEC/wake, Opus, wire adapter, device MCP, board HAL | ASR/LLM/TTS provider, prompt/personality, localized exit literals |
| `veetee-server/` | Realtime transport/session/turn, VAD→ASR→LLM/tools→TTS, provider host, metrics | Manager CRUD/UI, GPIO/pin map, product key rotation/fallback |
| `veetee-manager-api/` | Fastify control plane, PostgreSQL, config revisions, auth, device/provider/history/assets | Realtime device audio loop, browser components |
| `veetee-manager-web/` | Vue SPA, typed API client, accessible dashboard | Database access, secret persistence, audio transport server |
| `docs/` | Specification, ADR, roadmap, open questions | Generated build output hoặc secret |
| `references/` | Read-only evidence snapshots | Bất kỳ project edit, patch hoặc vendored dependency |
| `.agents/skills/` | Agent workflow guidance | Product runtime dependency hoặc copied product source |

Không import source trực tiếp giữa hai deployable. Shared contract phải đi qua
versioned wire fixture, OpenAPI artifact hoặc schema artifact được công bố; vị trí
artifact cụ thể phải được chốt trong implementation plan trước khi tạo.

## 5. Bất biến không được phá

- Product naming, package, API, DB, UI và telemetry chỉ dùng `Veetee` hoặc thuật
  ngữ trung tính. Tên reference chỉ được xuất hiện trong citation/isolated
  compatibility fixture.
- Veetee-to-Veetee dùng direct WebSocket v3 ngay từ M0. v1 chỉ compatibility;
  không sniff, silent downgrade hoặc transport fallback.
- Protocol change chỉ additive: optional field/message mới phải để peer cũ bỏ qua.
- Audio baseline: uplink Opus mono 16 kHz/60 ms; downlink Opus mono 24 kHz/60 ms.
- `turn_id`/generation guard, bounded queue, cancellation ownership và stale-output
  rejection áp dụng xuyên pipeline.
- Một active provider selection cho mỗi kind; không runtime provider fallback.
- Groq production chỉ có một `secretRef`; danh sách free keys chỉ là test harness.
- Vietnamese là locale đầu tiên, không phải literal branch trong core. Prompt,
  personality, progress/exit text, locale và voice đều là versioned config.
- Không hardcode GPIO, pin map, board revision, model ID, provider credential,
  broker/topic, wake phrase hoặc UI brand color vào domain logic.
- Voice cloning, knowledge base và external MCP endpoint chưa được implement trước
  tài liệu riêng. Emoji collection và conversation background không thuộc scope.
- Không Docker/Compose trong local baseline.

## 6. Quy trình làm một task

1. Xác định component, milestone, acceptance criterion và blocking question.
2. Đọc đúng tài liệu/ADR theo §3; kiểm tra repository state và giữ mọi user work.
3. Ghi phạm vi thực hiện ngắn trong task hiện tại, nêu file ownership, contract và
   test oracle; không đặt lịch/ngày hoàn thành cho từng phần.
4. Nếu cần quyết định mới có từ hai option hợp lý, tạo ADR; không chốt im lặng.
5. Implement vertical slice nhỏ nhất, không refactor ngoài phạm vi.
6. Chạy unit/contract/integration test liên quan; protocol change phải chạy golden
   và cross-conformance fixture.
7. Đo resource/latency khi chạm audio/model/runtime; không thay số đo bằng estimate.
8. Cập nhật docs/fixture/OpenAPI/ADR trong cùng change nếu contract thay đổi.
9. Handoff ghi: outcome/DoD đạt được, đã chạy gì, evidence gì, phần nào cần người
   dùng nghe/nhìn/chạm, limitation và rollback path. Phần trăm tiến độ là optional,
   không thay DoD/evidence và không cần tạo nhánh Git để bàn giao.

Không báo “done” chỉ vì build pass nếu acceptance yêu cầu board, speaker, button,
wake, OLED/LED, IR hoặc mmWave thực tế.

## 7. Milestone gate

### M0 — scope/DoD gate

Mục tiêu nguyên văn: **ESP32 nói được 1 câu qua server tự viết**.

- PTT → mic → Opus → direct WS v3 → VAD/ASR → Groq stream → VieNeu stream →
  Opus → speaker.
- Dùng immutable local config fixture; không Manager, DB, wake acoustic, MQTT hay
  UI trong critical slice.
- Đạt đúng M0 DoD ở `10-roadmap.md` trước khi mở M1.

### M1

Conversation tự nhiên: wake on-device, interrupt/barge-in, tool loop, personality,
Lab E2E TTFA gate và long-session soak.

### M2

Host-native Fastify/Vue/PostgreSQL control plane, provider config, history, pairing,
opaque session auth và config publication.

Manager Web mock preview hiện có không có API/PostgreSQL/auth/publication nên không
được tính là đạt hoặc bắt đầu M2.

### M3

MQTT/UDP sau conformance/loss/soak; hardware MCP tools, firmware assets và OTA.

### M4

Hardening, backup/restore, capacity, remote-security decision và locale thứ hai.

Không kéo feature M3/M4 vào M0 chỉ vì interface đã được mô tả.

## 8. Local runtime rule

- Chạy trực tiếp trên Ubuntu bằng versioned Python environment, Node release,
  host PostgreSQL và host reverse proxy/service supervisor.
- Không tạo Dockerfile, Compose file hoặc lệnh container. Nếu một dependency guide
  chỉ có container example, chuyển thành host-native plan hoặc dừng xin quyết định.
- Manager Web mock/API modes dùng command contract trong
  `veetee-manager-web/README.md`/`package.json`; Voice Server, Manager API và
  firmware commands nằm trong README từng component. Host-native stack có manifest
  tại `tools/runtime/manifests/host-native-dev.json` và readiness supervisor.
- M0 fixture vẫn là test oracle; runtime bring-up có thể chọn `config_source=manager`
  bằng manifest với local-only explicit flag. Không auto-switch khi source lỗi.
- Secret chỉ qua owner-read file/OS credential; không đặt trong command line,
  committed `.env`, logs, screenshot hoặc test artifact.

## 9. Test gates tối thiểu

### Firmware/protocol

- Golden bytes WS v1/v2/v3 và MQTT/UDP fixtures theo `03-protocol-spec.md`.
- Cross-conformance cả hai chiều với supplied peers.
- Fuzz malformed length/type/JSON/MCP; không OOB, reboot hoặc hardware mutation.
- PTT/interrupt/wake/state property tests, queue/pool ownership và watchdog evidence.

### Server/audio/provider

- Deterministic cancellation tại mọi await/stage; zero stale output.
- Warm Lab E2E TTFA p95 <1.500 ms ở M1; Operational TTFA báo riêng.
- Provider fault không gọi secondary provider; Groq `429` không rotate key product.
- 60 phút soak M1; answer dài không buffer full WAV/text/audio.
- Resource gate: toàn stack ≤3,5 GiB VRAM target, không CUDA OOM retry loop.

### Manager API/Web

- OpenAPI 3.1 schema/runtime/generated-client drift test.
- Fastify request/response/error schemas, ETag conflict và idempotency tests.
- Secret canary không xuất hiện trong response/log/audit/browser storage.
- Opaque cookie session, CSRF/Origin, ownership và machine/user auth separation.
- Keyboard/WCAG, loading/empty/error/conflict/offline states và visual regression.

### Deployment

- Host reboot/start order/readiness, no container dependency.
- Backup restore rehearsal và permission/port exposure checks.
- Runtime/model/driver versions và benchmark nằm trong evidence manifest.

## 10. Skill routing cho AI coding workflow

Chỉ dùng skill nhỏ nhất phù hợp và luôn để user/docs thắng skill. Model đang chạm
vùng nào thì đọc skill của vùng đó; skill không tự tạo branch/worktree hay biến
functional progress thành bảng theo dõi tiến độ:

- Architecture decision: `architecture-decision-records`.
- Firmware/FreeRTOS: `embedded-systems`.
- Manager API: `fastify-best-practices`; API contract: `openapi-spec-generation`.
- Manager Web: `vue`, `ui-skills-root`, `frontend-design`; audit bằng
  `fixing-accessibility` và `web-design-guidelines`.
- Browser/E2E khi UI đã chạy: `playwright` hoặc `qa`.
- Skill mới phải được audit nguồn/version/risk; không dùng beta-oriented skill cho
  baseline stable chỉ vì nó mới hơn.

Skill không cấp quyền sửa `references/`, thêm feature deferred, dùng Docker hoặc
bỏ qua phase/ADR gate.

## 11. Dừng và hỏi chủ dự án khi nào

Dừng trước mutation khi thiếu một trong các input sau và task phụ thuộc nó:

- schematic/BOM/pin map/board revision;
- Groq capability probe cần secret thật;
- wake phrase/custom asset/corpus;
- retention, backup hoặc public exposure policy;
- production secret-store decision;
- một decision trong `11-open-questions.md` được đánh dấu blocking cho milestone.

Không gửi secret vào chat/document/log. Không tự chọn pin, xóa NVS/data, migrate
breaking schema, expose Internet hoặc chạy destructive rollback.

## 12. Handoff bắt buộc

Mỗi AI coding turn kết thúc bằng:

1. Outcome chạy được gì, gắn milestone/DoD.
2. File/component đã thay đổi và contract bị ảnh hưởng.
3. Command/test/benchmark đã chạy cùng kết quả.
4. Phần chưa verify và lý do.
5. Physical check người dùng cần thực hiện.
6. Open question/ADR mới, nếu có.
7. Cách chạy host-native và cách rollback an toàn.

Không gọi estimate là benchmark, serial log là physical acceptance, hoặc
compatibility fixture là product default.
