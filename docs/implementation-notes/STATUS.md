# Trạng thái thực thi hiện tại

> Đây là snapshot evidence, không phải lịch hoàn thành. Phần trăm (nếu có trong
> chat) chỉ là ước lượng định hướng; DoD và evidence trong roadmap mới quyết định
> milestone đã đạt hay chưa.

## Snapshot

- Branch: `master`
- Commit source gần nhất: xem `git log -1 --oneline`; working tree có thể chứa
  các vertical slice chưa commit nên `git status --short` là bằng chứng hiện tại.
  Secret, build output, raw audio và report `/tmp` vẫn bị ignore.
- Runtime production checkout này: Voice Server `18100`, Manager API `18101`,
  Manager Web `18181`; preview host-native tách riêng có thể dùng `18000/18001/
  18081`. Không dùng process/port của checkout cũ.

## Bảng tiến độ theo evidence

| Vùng | Trạng thái | Đã chứng minh | Còn mở |
|---|---|---|---|
| Planning/design | Hoàn tất | `docs/00` → `docs/11`, ADR và Mermaid đã có; `PROJECT.md`/`AGENTS.md` là bản đồ cho AI coding workflow. | Chỉ cập nhật khi có quyết định hoặc evidence mới. |
| M0 — một lượt ESP32 qua server | Đang hoàn thiện, **chưa đóng DoD** | Firmware/host protocol, WS v3, provider path, runtime manager snapshot, unattended wake và fixture physical flow đã chạy. | Người dùng xác nhận thực tế loa/LCD/PTT và acceptance audio path; 30-turn DoD phải giữ đủ evidence. Xem [`M0.md`](M0.md) và [`10-roadmap.md`](../10-roadmap.md). |
| M1 — realtime conversation | Đang làm, **chưa đóng DoD** | Streaming/cancellation/tool loop, v1/v2/v3 fixture, WakeNet, noise suppression, multi-key fixture 10/10, AEC lifecycle/resource 10/10; stale `tts/stop` barrier đã sửa; normal wake 2 lượt, barge-in lifecycle physical, corpus smoke 1 negative/1 positive và host TTFA warm p95 `1481,4 ms` pass. | Acoustic echo-only, false accept/reject corpus đủ lớn, voice-onset barge-in/time-to-silence, 100 repetition, provider promotion và cross-peer physical conformance. Các lần timeout AEC/bypass trước guard vẫn là diagnostic history, không coi là acoustic verdict. Xem [`M1.md`](M1.md). |
| Groq multi-key | Hoàn tất cho **test harness** | `VEETEE_TEST_GROQ_KEYS_FILE` chỉ với fixture; round-robin; chỉ retry `429` trước delta đầu; không replay partial stream; firmware không chứa key. | Không phải production fallback/key rotation; nhiều key vẫn có thể cùng dính quota account/org/model/IP. |
| M2 — control plane | Đang làm, **chưa đóng DoD** | Fastify/OpenAPI, PostgreSQL `veetee_vubq`, auth/session, pairing/unlink, provider schema-driven UI, ETag/publish, history/presence, derived dashboard summary, TTL freshness và host regression. | Promotion provider/model/VRAM, mọi route/error/a11y/loading state và physical device/presence acceptance. Xem [`M2.md`](M2.md). |
| M3 — transport/hardware/OTA | Chưa mở | Chỉ có design/ADR và implementation notes placeholder. | MQTT/UDP, MCP phần cứng, assets/OTA cần mở milestone và input board/BOM. |
| M4 — hardening/multilingual | Chưa mở | Chỉ có design/ADR và implementation notes placeholder. | Capacity, backup/restore, security, locale thứ hai và soak dài. |

## Nơi xem trực tiếp

1. [`docs/10-roadmap.md`](../10-roadmap.md): bảng DoD và điều kiện đóng từng mốc.
2. [`docs/implementation-notes/M0.md`](M0.md), [`M1.md`](M1.md), [`M2.md`](M2.md): nhật ký evidence, lệnh test, giới hạn và rollback.
3. [`docs/11-open-questions.md`](../11-open-questions.md): câu hỏi đã chốt và
   blocker còn mở.
4. `git log --oneline --decorate` và `git status --short`: source/commit hiện tại.
5. Health runtime khi stack đang chạy:

   ```text
   http://127.0.0.1:18100/health/ready
   http://127.0.0.1:18101/health/ready
   http://127.0.0.1:18100/metrics
   ```

   Tailscale hostname/Serve mapping phải xem bằng `tailscale serve status`; không
   suy đoán hoặc ghi cứng hostname vào source.

   Read-only status hiện tại (binary local Tailscale 1.98.9):
   `https://veetee-dev.tail52a635.ts.net:18443` là **tailnet-only**, proxy vào
   Manager Web `18181`; Vite proxy cùng origin chuyển `/api` tới `18101` và
   `/veetee` tới Voice `18100`. Root `:443` và các cổng `:8443`/`:10000` đang là
   Funnel mapping cũ tới checkout khác, không dùng để kiểm tra Veetee hiện tại
   và chưa bị thay đổi trong lượt này.

## Quy ước cập nhật

- Mỗi mốc thay đổi phải thêm note evidence, kết quả test và commit/push.
- Không ghi API key, Wi-Fi password, bearer token, raw audio hoặc transcript nhạy
  cảm vào file này.
- Không đánh dấu `M0`/`M1`/`M2` đạt chỉ vì build hoặc unit test xanh; physical-only
  acceptance phải được tách rõ.

## Cập nhật gần nhất (2026-08-04)

### Regression revalidation hiện tại

- Readiness read-only vẫn ổn định: Voice `18100` revision `87`, Manager API
  `18101` revision `87`, Manager Web `18181` đều trả HTTP `200`; source tree
  sạch tại commit `e33ea94`.
- Voice Server regression: **61 passed**. Manager API với dedicated
  PostgreSQL `veetee_vubq_test`: **31/31 passed**. Manager Web typecheck,
  ESLint, Vitest **63/63** và production build pass. Firmware host CTest
  **1/1** pass. Không restart service và không mutate database runtime
  `veetee_vubq`.
- Metrics live sau regression: `active_turns=0`, `turn_releases=15`,
  `protocol_errors=0`, `history_failed=0`, `presence_failed=0`,
  `last_ttfa_ms=1292`. Các counter tích lũy như `activationFailures=14` và
  `audio_frames_ignored=114` là history quan sát được, không phải lỗi readiness
  mới; cần phân tích riêng trước khi dùng làm promotion evidence.
- Realtime Lab đã được parameterize theo profile 1/2/3; fixture smoke cả ba
  profile đều pass. Reference-server handshake smoke cũng pass trong venv/copy
  tạm, nhưng chưa có full provider turn hoặc firmware↔server cross-peer pass.
- Firmware session-mismatch barrier đã build/flash: peer cũ không có
  `session_id` vẫn tương thích, còn message có session sai/rỗng/không hợp lệ bị
  bỏ qua. Host CTest `1/1`, ESP-IDF build/flash hash pass; serial thấy
  `wake_ready=1`, capture idle, không panic và board reconnect lại runtime.
- Voice Server có integration regression cho stale `listen/start`/`abort`: session
  cũ không được cấp hoặc giải phóng turn hiện tại; control đúng session vẫn hoạt
  động. Suite hiện **62 passed**.
- URL kiểm tra chắc chắn trên máy này: `http://127.0.0.1:18181` (UI),
  `http://127.0.0.1:18101/health/ready` (Manager API),
  `http://127.0.0.1:18100/health/ready` và `/metrics` (Voice). Endpoint private
  Tailscale `:18443` vẫn được ghi theo mapping đã kiểm tra trước đó; nếu không
  truy cập được từ thiết bị đang xem, dùng local UI hoặc kiểm tra tailnet/Serve
  status trên chính máy host.
- Kiểm tra read-only hostname được đề xuất `https://veetee.tail52a635.ts.net/`
  trong lượt hiện tại: DNS không phân giải (`Could not resolve host`). Host
  `veetee-dev.tail52a635.ts.net` có phân giải nhưng root/legacy ports trả `502`
  và port `:18443` timeout từ shell này. Vì vậy chưa được coi là URL truy cập
  Veetee hợp lệ; không tự đổi hostname, Funnel hay DNS của máy.

- `autoTurn` first-speech watchdog đã publish ở runtime revision `87`; physical
  wake + 6 giây silence pass `NO_SPEECH_TIMEOUT` và `wake detector armed`.
  Sau late-frame drop fix, metrics physical là `activeTurns=0`,
  `auto_no_speech_timeouts=1`, `protocol_errors=0`, `audio_frames_ignored=1`.
- Đây chỉ đóng empty-wake recovery gate; M1 acoustic barge-in/AEC, false
  accept/reject corpus, TTFA p95 và cross-peer conformance vẫn mở.
- Firmware stale `tts/stop` barrier đã flash và physical barge-in lifecycle pass:
  `wake detected → listening → wake interrupt → wake start`; normal wake 2 lượt
  với nghỉ 10 giây cũng pass. 10-lượt scenario còn false reject/no-speech ở lượt
  2 khi wake trong playback, nên chưa đóng acoustic/false-reject gate.
- Host-only Realtime Lab 4 turn (1 warm-up) hiện có warm TTFA p50 `1293,6 ms`,
  p95 `1481,4 ms`, đủ `tts.start`/binary/`tts.stop`, không protocol error; report
  redacted ở `/tmp/veetee-realtime-lab-4-20260804.json`.
- Dashboard Assistant đã có contract derived `deviceCount`,
  `onlineDeviceCount`, `lastConversationAt` từ Manager API thay vì Web hiển thị
  số `0` cố định. Chi tiết, tests và giới hạn TTL nằm ở
  [`M2.md`](M2.md#derived-assistant-dashboard-summary-contract-2026-08-04).
- Presence freshness đã được harden theo ADR-022: `onlineDeviceCount` và
  `Device.onlineState` suy ra từ `lastSeenAt + VEETEE_DEVICE_ONLINE_TTL_SECONDS`
  (mặc định 120 giây); `deviceCount` không bị giảm khi device stale.
- Source regression cho slice này: Manager API InMemory **21 passed** và
  PostgreSQL dedicated `veetee_vubq_test` **31/31 passed** (runtime
  `veetee_vubq` không dùng cho test), Web **63/63** unit và Chromium **9/9**
  E2E; API/Voice/Web production readiness `18101/18100/18181` đều `200` bằng
  probe read-only. Không restart runtime hoặc mutate database runtime.
- Đã flash lại firmware AEC-on sau A/B diagnostic, không erase NVS; serial
  xác nhận `wake_ready=1` và không có panic/Opus/queue error trong cửa sổ kiểm tra.
- Fixture Voice Server test-only đã dừng. Production Voice Server được khởi
  động lại bằng user-systemd transient unit `veetee-voice-18100`, dùng một
  `VEETEE_GROQ_SECRET_FILE` và không có `VEETEE_TEST_GROQ_KEYS_FILE`.
- Readiness hiện tại: Voice `18100` revision `86`, API `18101` revision `86`,
  `activeConnections=1`, `activeTurns=0`, `protocol_errors=0`.
- Barge-in acoustic vẫn là blocker mở; AEC-off control không được coi là A/B
  evidence vì build đó không chạy WakeNet trong playback theo Kconfig.
- Diagnostic bypass giữ AEC instance + duplex gate nhưng bỏ transform cũng
  timeout; chưa kết luận threshold, echo masking, reference alignment hay timing.

### Manager Web semantics và Tailscale hostname audit (2026-08-04)

- Đã thêm `name`, `autocomplete` và các thuộc tính spellcheck phù hợp cho
  login, assistant/device/provider/role forms; schema-generated text inputs
  cũng có field name và `autocomplete="off"`. Placeholder tiếng Việt dùng `…`
  nhất quán. Đây là hardening UI, không đổi API/protocol/runtime behavior.
- Verification sau thay đổi: typecheck pass, ESLint pass, Vitest **63/63**,
  production build pass, Chromium E2E **9/9** (a11y serious/critical gate pass).
- Read-only Tailscale status cho biết node là
  `veetee-dev.tail52a635.ts.net`; `veetee.tail52a635.ts.net` không có DNS
  record trong môi trường kiểm tra. Manager Web private mapping là
  `https://veetee-dev.tail52a635.ts.net:18443` → `127.0.0.1:18181`; root
  `https://veetee-dev.tail52a635.ts.net/` đi qua Funnel cũ tới `127.0.0.1:8081`
  và trả `502`. Không tự rename node, đổi Serve/Funnel, DNS, route hay mạng.
