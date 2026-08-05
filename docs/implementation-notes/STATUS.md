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

## Operator lock — audio/physical test reopened (2026-08-05)

- Chủ dự án đã cấp lại quyền kiểm thử bằng audio/microphone. Có thể chạy scenario
  vật lý bounded và đọc serial để thu evidence, nhưng phải note rõ phạm vi và
  không suy diễn host evidence thành acceptance nghe/nhìn/chạm.
- Vẫn không flash, reset hoặc erase ESP32 nếu chưa cần thiết; không đổi Wi-Fi/NVS,
  NetworkManager, route, firewall hay Tailscale. Audio test không ghi raw audio,
  microphone capture, transcript hoặc credential vào repository.
- Host evidence không thay thế acceptance nghe/nhìn/chạm trên board; mọi gate
  physical của M0/M1/M2/M3 vẫn được giữ ở trạng thái mở.

### Audio test evidence mới (2026-08-05)

- Normal wake → utterance → TTS chạy lại thành công với Voice revision `87`;
  player exit `0`, server `activeTurns=0`, `protocol_errors=0` sau drain.
- Barge-in clip phát ngay sau `state=speaking` chưa bắt được wake lần hai vì
  cửa sổ re-arm chưa sẵn sàng; cùng scenario với delay cấu hình 2 giây đã đi đủ
  `wake detected → state=listening → wake interrupt → wake start`.
- Đây là timing/lifecycle evidence, không đóng acoustic AEC/echo-only,
  voice-onset hoặc time-to-silence gate. Báo cáo redacted nằm ngoài Git trong
  `/tmp/veetee-wake-audio-20260805-1.json`,
  `/tmp/veetee-wake-barge-audio-20260805-1.json` và
  `/tmp/veetee-wake-barge-delay-20260805.json.report`.

### Acoustic duplex policy probe (2026-08-05)

- Source slice đã build/flash image `0x159a20` (ESP-IDF 6.0.2, app còn 66%),
  không erase NVS. Voice regression **169 passed**, Ruff/compileall pass, CTest
  firmware **8/8**.
- Production revision `87` chạy normal wake **2/2**; sau drain
  `active_turns=0`, `protocol_errors=0`, `last_ttfa_ms=1448`, player exit `0`.
- Acoustic fixture chỉ ở `/tmp` (revision `900`, `bargeIn.deviceDuplex=true`,
  test key pool), không sửa Manager snapshot/database. Serial đã xác nhận
  `acoustic duplex capture enabled while server is speaking` và
  `acoustic barge-in committed; capture kept for new auto turn`; metrics fixture
  `barge_in_count=3`, `turn_admissions=4`, `turn_releases=4`,
  `active_turns=0`, `protocol_errors=0`. Clip còn phát sau interrupt đầu nên có
  thêm hai commit; không dùng để kết luận false accept hoặc time-to-silence.
- Fixture đã dừng và production Manager-source revision `87` khởi động lại;
  board reconnect `activeConnections=1`. Report redact ngoài Git:
  `/tmp/veetee-acoustic-barge-20260805.json`.
- Đây là control/lifecycle evidence cho policy mới, chưa đóng acoustic
  echo-only, voice-onset quality, time-to-silence p95, false accept/reject,
  100-repetition hoặc M1 promotion gate.

### Manager Web barge-in controls (2026-08-05)

- Role form đã expose `bargeIn.enabled`, `bargeIn.deviceDuplex` và
  `minSpeechFrames` bằng primitive UI chung; policy vắng mặt được normalize ở
  draft nhưng không tự publish. Các policy additive khác vẫn được preserve.
- Manager Web unit **96/96**, Chromium E2E **11/11**, typecheck/lint/build pass;
  production database/runtime không bị mutate.

### Firmware wake pre-arm slice (2026-08-05)

- Wake detector được arm sớm qua capture-owner queue sau wake event; lệnh trùng
  không recreate model, còn interrupt trong `speaking` giữ playback-drain path.
- Build/flash image `0x1596b0` pass, host CTest 8/8 pass, serial `wake_ready=1`
  và board reconnect production sau khi fixture dừng.
- Fixture 4-key immediate lifecycle pass, nhưng chưa chứng minh acoustic speaker
  đang phát đủ lớn; AEC/echo-only, voice-onset/time-to-silence và false-reject
  gate vẫn mở. Production normal probe bị `LLM_RATE_LIMITED` nên không dùng làm
  firmware verdict.

## Bảng tiến độ theo evidence

| Vùng | Trạng thái | Đã chứng minh | Còn mở |
|---|---|---|---|
| Planning/design | Hoàn tất | `docs/00` → `docs/11`, ADR và Mermaid đã có; `PROJECT.md`/`AGENTS.md` là bản đồ cho AI coding workflow. | Chỉ cập nhật khi có quyết định hoặc evidence mới. |
| M0 — một lượt ESP32 qua server | Đang hoàn thiện, **chưa đóng DoD** | Firmware/host protocol, WS v3, provider path, runtime manager snapshot, unattended wake và fixture physical flow đã chạy. | Người dùng xác nhận thực tế loa/LCD/PTT và acceptance audio path; 30-turn DoD phải giữ đủ evidence. Xem [`M0.md`](M0.md) và [`10-roadmap.md`](../10-roadmap.md). |
| M1 — realtime conversation | Đang làm, **chưa đóng DoD** | Streaming/cancellation/tool loop, v1/v2/v3 fixture, WakeNet, noise suppression, multi-key fixture 10/10, AEC lifecycle/resource 10/10; stale `tts/stop` barrier đã sửa; normal wake 2 lượt, wake-word interrupt lifecycle physical, policy acoustic-duplex control lifecycle và corpus smoke 1 negative/1 positive; host TTFA warm p95 `1481,4 ms` pass. | Acoustic echo-only, false accept/reject corpus đủ lớn, voice-onset quality/time-to-silence p95, 100 repetition, provider promotion và cross-peer physical conformance. Các lần timeout AEC/bypass trước guard vẫn là diagnostic history, không coi là acoustic verdict. Xem [`M1.md`](M1.md). |
| Groq multi-key | Hoàn tất cho **test harness** | `VEETEE_TEST_GROQ_KEYS_FILE` chỉ với fixture; round-robin; chỉ retry `429` trước delta đầu; không replay partial stream; firmware không chứa key. | Không phải production fallback/key rotation; nhiều key vẫn có thể cùng dính quota account/org/model/IP. |
| M2 — control plane | Đang làm, **chưa đóng DoD** | Fastify/OpenAPI, PostgreSQL `veetee_vubq`, auth/session, pairing/unlink, provider schema-driven UI, ETag/publish, history/presence, derived dashboard summary, TTL freshness, privacy export, async conversation delete/tombstone và host regression. | Promotion provider/model/VRAM, mọi route/error/a11y/loading state và physical device/presence acceptance. Xem [`M2.md`](M2.md). |
| M3 — transport/hardware/OTA | Đang mở ở host-only slice | MQTT control/bridge/session, firmware UDP header/crypto codec, UDP v3 AES/reorder/barrier, deterministic loss/soak, firmware MCP registry/wire/JSON-RPC dispatcher, shared MCP cross-conformance fixture, feature-gated owner-task queue và BoardHal capability manifest validation đã có host/ESP-IDF build-only golden/test evidence; MCP flag vẫn tắt mặc định, chưa nối carrier/hardware. | MQTT client/gateway/socket, firmware encrypted carrier, BoardHal descriptor thật + peripheral owner tools, real-peer/real-network comparison, assets/OTA và transport-promotion cần mở sau. |
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

   Read-only status hiện tại (binary local Tailscale 1.98.9): node là
   `veetee.tail52a635.ts.net` và private Serve chỉ có một origin:
   `https://veetee.tail52a635.ts.net/` → Manager Web `18181`. Cùng origin phân
   bổ route như sau: `/api/v1/...` → Manager API `18101`, `/openapi.json` →
   Manager API, và `/veetee/v1/` (WebSocket; `Protocol-Version: 3`) → Voice
   Server `18100`. Không còn dùng legacy hostname, port `18443` hay Funnel.
   ESP32 vẫn dùng LAN WS, vì dashboard hostname không thay thế Tailscale client
   trên firmware.

## Quy ước cập nhật

- Mỗi mốc thay đổi phải thêm note evidence, kết quả test và commit/push.
- Không ghi API key, Wi-Fi password, bearer token, raw audio hoặc transcript nhạy
  cảm vào file này.
- Không đánh dấu `M0`/`M1`/`M2` đạt chỉ vì build hoặc unit test xanh; physical-only
  acceptance phải được tách rõ.

## Firmware MCP dispatcher boundary (2026-08-05)

- `veetee_mcp_dispatch.[ch]` nhận cJSON envelope đã framing-guard, validate
  session/jsonrpc/request ID/params/cursor, gọi registry cho `tools/call` và
  serialize `initialize`/`tools/list`/result/error. Notification được ignore;
  input lỗi không tạo hardware side effect.
- Host CTest **6/6** pass; ESP-IDF 6.0.2 build pass cho ESP32-S3 N16R8, binary
  `0x159410`, app partition còn 66%. Voice Server **146 passed**, Ruff và
  compileall pass.
- Lát cắt chưa nối `wire_dispatch`/owner-task/BoardHal, chưa quảng bá MCP tool,
  chưa flash/reset/đọc serial audio và không đóng physical MCP/audio gate. M3
  vẫn mở; direct WebSocket v3 vẫn là default.

### MCP cross-conformance fixture (2026-08-05)

- `tests/fixtures/mcp_conformance.json` là oracle dùng chung cho C dispatcher và
  Python `DeviceMcpBridge`: initialize, list, call và unknown method đều khớp
  envelope/session/ID/result shape.
- Firmware CTest **7/7**, Voice Server **147 passed**, Ruff/compileall pass.
  Đây là host-only cross-conformance evidence; không thay thế hai chiều với peer
  thật hoặc physical MCP. Không mở socket/carrier, không phát/thu audio,
  không flash/reset board và không đổi Wi-Fi/Tailscale.

### MCP owner-task queue (2026-08-05)

- `veetee_mcp_task.[ch]` chuyển parse/dispatch ra owner task qua queue bounded;
  session guard + registry reset chống stale reconnect. `CONFIG_VEETEE_MCP_ENABLED`
  vẫn tắt mặc định và chưa có BoardHal tool descriptor.
- ESP-IDF default build **pass** (`0x159430`, 66% free); build test-only bật
  feature **1263/1263 pass** (`0x15ad80`, 66% free). Không flash/reset, không
  audio/serial/network mutation. M3 chưa đóng.

### Python protocol profile fail-closed (2026-08-05, host-only)

- `veetee_server.protocol.encode_audio()` và `decode_audio()` reject profile
  không thuộc `ws-v1-compat`, `ws-v2`, `ws-v3` trước khi đọc/ghi audio bytes;
  profile lạ không còn bị diễn giải ngầm như v3.
- Regression riêng **8 passed**; full Voice Server suite sau hardening
  **150 passed**, Ruff và compileall pass. Firmware C codec vốn đã fail-closed
  với profile ngoài range nên invariant giữa hai peer được giữ đồng nhất.
- Đây là wire-safety evidence host-only, không đổi default WebSocket v3, không
  mở compatibility downgrade/fallback và không thay thế M0 physical PTT/mic/
  speaker acceptance. Không audio device, flash/reset ESP32 hoặc đổi mạng.

### BoardHal capability manifest boundary (2026-08-05, host/build-only)

- Firmware `veetee_board_hal.[ch]` đã có manifest revision + logical capability/
  owner IDs, safety class và timeout; activation fail-closed và swap snapshot
  nguyên tử sau validation. Chỉ capability bật mới được đưa vào MCP tool view;
  owner task có API khởi tạo từ snapshot nhưng chưa được runtime bật.
- Firmware host CTest hiện **8/8 pass**; chưa nối descriptor phần cứng, callback
  owner task hay hardware mutation. M3 vẫn mở; không flash/reset, audio, serial,
  Wi‑Fi/Tailscale hoặc production database.

### Host supervisor bounded restart policy (host-only)

- `tools/runtime/veetee_runtime.py` đã parse `restartPolicy` bounded và monitor
  process khi chạy `--once`; mặc định `maxAttempts=0` nên behavior cũ không đổi.
- One-shot migration/seed (`waitForExit=true`) bị reject nếu có restart attempt;
  status report thêm `restartCount`/`lastExitCode`, không ghi command/secret.
- Runtime tests **27 passed**, compileall pass. Không restart stack đang chạy,
  không mutate PostgreSQL, không đổi port/Wi‑Fi/Tailscale và không audio.

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
  `http://127.0.0.1:18100/health/ready` và `/metrics` (Voice). URL kiểm tra
  qua tailnet là `https://veetee.tail52a635.ts.net/`; nếu thiết bị đang xem
  không ở cùng tailnet, dùng local UI hoặc kiểm tra tailnet/Serve status trên
  chính máy host.
- Kiểm tra read-only hostname được đề xuất trong snapshot đó chưa phân giải;
  **legacy hostname** còn trả `502` ở root/legacy ports và `:18443` timeout từ
  shell này. Vì vậy snapshot đó chưa được coi là URL truy cập Veetee hợp lệ;
  không tự đổi hostname, Funnel hay DNS của máy.

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

> Historical pre-reallocation snapshot. See **Tailscale canonical origin
> reallocation** below for the current URL contract.

- Đã thêm `name`, `autocomplete` và các thuộc tính spellcheck phù hợp cho
  login, assistant/device/provider/role forms; schema-generated text inputs
  cũng có field name và `autocomplete="off"`. Placeholder tiếng Việt dùng `…`
  nhất quán. Đây là hardening UI, không đổi API/protocol/runtime behavior.
- Verification sau thay đổi: typecheck pass, ESLint pass, Vitest **63/63**,
  production build pass, Chromium E2E **9/9** (a11y serious/critical gate pass).
- Read-only Tailscale status ở snapshot đó cho biết node còn mang **legacy
  hostname**; canonical origin chưa có DNS record trong môi trường kiểm tra.
  Manager Web private mapping là `:18443` → `127.0.0.1:18181`; root đi qua
  Funnel cũ tới `127.0.0.1:8081` và trả `502`. Không tự rename node, đổi
  Serve/Funnel, DNS, route hay mạng trong snapshot đó.

### Tailscale canonical origin reallocation (2026-08-04)

- Theo yêu cầu operator, đã reset toàn bộ Serve/Funnel mapping cũ, đổi node
  thành `veetee`, rồi tạo private Serve duy nhất:
  `https://veetee.tail52a635.ts.net/` → `127.0.0.1:18181`.
- Contract truy cập cùng origin: `/api/v1/...` → Manager API `18101` và
  `/veetee/v1/` (WebSocket) → Voice Server `18100`, do Vite proxy đã cấu hình
  target bằng env. Không mở public Funnel và không đổi NetworkManager/Wi-Fi.
- Local route verification: UI `200`, `/api/v1/auth/me` qua proxy `200`,
  `/openapi.json` qua proxy `200`, Voice proxy trả handshake `400` khi không có
  hello (đúng là route đã tới WebSocket handler). TLS/HTML/WebSocket từ hostname
  mới cần xác nhận trên peer khác trong tailnet vì userspace Tailscale không
  self-route từ shell này.

### Controlled provider benchmark (2026-08-04)

- Test-only A/B cùng profile v3/ASR/VAD/TTS và 5 warm turns: Groq 70B
  `1257/1325 ms` (p50/p95), Groq 8B `1273/1323 ms`; cả hai có đủ `tts.start`/
  `tts.stop`, không protocol error. GPU peak **881 MiB**, dưới promotion limit
  `3500 MiB`; không có OOM.
- Benchmark 70B với long-response config trước đó có outlier TTFA tới `3720 ms`,
  nên M1 TTFA/promotion chưa được đánh dấu đạt. Không đổi model production;
  production Voice revision `87` đã được giữ nguyên sau khi dừng fixture.

### Canonical URL runtime cleanup (2026-08-04)

- Đã dừng riêng các preview process cũ của checkout này đang giữ `5173` và
  `18000/18001/18081`; không dừng PostgreSQL, Redis, Wi‑Fi hoặc stack canonical.
- Listener canonical hiện còn: Voice `0.0.0.0:18100`, Manager API
  `127.0.0.1:18101`, Manager Web `127.0.0.1:18181`. Readiness cả ba trả HTTP
  `200` sau cleanup.
- `tailscale status --json` hiện trả node `veetee.tail52a635.ts.net` và
  `tailscale serve status --json` chỉ có `443 / → http://127.0.0.1:18181`;
  không còn legacy hostname, `18443` hoặc Funnel mapping.
- URL sử dụng thống nhất: Web `https://veetee.tail52a635.ts.net/`, API
  `https://veetee.tail52a635.ts.net/api/v1/...`, OpenAPI
  `https://veetee.tail52a635.ts.net/openapi.json`, Voice WebSocket
  `wss://veetee.tail52a635.ts.net/veetee/v1/` (wire v3). ESP32 dùng LAN
  `ws://<host-lan-ip>:18100/veetee/v1/`; database/health không public.
- TLS/HTML/WebSocket từ hostname cần được xác nhận trên một peer khác trong
  tailnet; userspace Tailscale trên chính host không được coi là self-route
  evidence.
- Runtime manifest đã cho phép exact origin `https://veetee.tail52a635.ts.net`
  cùng với local UI origins `http://127.0.0.1:18181` và
  `http://localhost:18181`; vì vậy các thao tác ghi trên Manager Web không bị
  CORS/CSRF chặn khi truy cập qua URL canonical. Không thêm hostname cũ.
- Manager API đã được khởi động lại trên `127.0.0.1:18101` với đúng allow-list
  này; preflight canonical trả `204` và `Access-Control-Allow-Origin` đúng
  origin. Web root, API proxy, OpenAPI proxy và Voice route lần lượt kiểm tra
  `200`, `200`, `200`, `400` (400 là probe thiếu hello và chứng minh đã tới
  WebSocket handler). Runtime test harness `18 passed`; Voice vẫn ready,
  `activeConnections=1`, không có lỗi refresh hiện tại.
- Manager API hiện nhận `VEETEE_PUBLIC_BASE_URL` từ manifest và OpenAPI runtime
  quảng cáo `https://veetee.tail52a635.ts.net` (không còn default loopback
  `8001` khi chạy canonical); preflight exact origin trả `204` với CORS origin
  đúng. Đây là metadata contract, không mở thêm listener hoặc public port.
- Sau commit `68243d6`, Voice unit `veetee-voice-18100` đã được restart đúng
  source mới; VieNeu prewarm hoàn tất, health revision `87` ready và board đã
  reconnect (`activeConnections=1`, `activeTurns=0`). Server regression là
  **62 passed**; probe Web root/API/OpenAPI đều `200`, WebSocket route trả `400`
  khi thiếu hello như contract, không phải lỗi proxy.

### Physical wake soak / test-key isolation (2026-08-04)

- Production single-key physical run đạt 15 lượt rồi dừng ở lượt 16 do
  `provider_error_LLM_RATE_LIMITED=1`; không có firmware panic, queue, codec
  hoặc server protocol error. Đây là quota evidence, không phải M1 wake verdict.
- Test-only snapshot revision `87` với `VEETEE_TEST_GROQ_KEYS_FILE` đã chạy cùng
  cổng `18100`; đạt 14 lượt, dừng ở lượt 15 vì không có `wake detected` trước
  khi gọi LLM. Verbose re-run độc lập đạt 3/3. Reports đã redact và nằm ngoài
  Git tại `/tmp/veetee-wake-100-delay10-rerun-20260804.json`,
  `/tmp/veetee-wake-100-testkeys-delay10-20260804.json` và
  `/tmp/veetee-wake-3-verbose.json`.
- Production Voice đã được khôi phục bằng Manager source, history/presence bật,
  test-key pool bị loại khỏi environment; health `200`, `activeConnections=1`,
  `activeTurns=0`. M1 vẫn mở false-reject/AEC/acoustic gate và chưa đạt 100
  repetition.

### Wake threshold A/B re-check (2026-08-04)

- Threshold `60%` và `65%` đã được chạy đối chứng cùng fixture TTS VieNeu,
  profile 3, clip và delay 10 giây: mỗi threshold **20/20** lifecycle pass,
  không forbidden marker; threshold 60 thêm corpus `1 negative + 1 positive`
  pass. Một run delay 0,75 giây fail lượt 2, được giữ là diagnostic playback
  tail chứ không phải threshold verdict.
- Không có bằng chứng đủ để hạ mặc định; `sdkconfig.defaults`/production image
  giữ `CONFIG_VEETEE_WAKE_THRESHOLD_PERCENT=65`. Firmware 65 đã build/flash
  hash verify không erase NVS. Fixture đã dừng và production Voice revision 87
  đã khôi phục (`activeConnections=1`, `activeTurns=0`, `protocol_errors=0`).
- Đây chưa phải 100-repetition hoặc acoustic barge-in acceptance; M0/M1 vẫn
  chưa đóng DoD physical.
- Regression sau khi khôi phục production: Voice Server **62 passed**, firmware
  host CTest **1/1**, physical/runtime tooling **38 passed**, Manager API
  **21 passed/10 skipped** (PostgreSQL test suite không được bật trong env này),
  Manager Web typecheck/lint/Vitest **63 passed** và production build pass.

### 100-repetition fixture re-check (2026-08-04)

- Soak threshold 65% với fixture LLM/TTS, profile 3, delay 10 giây và scenario
  100 đã dừng ở lượt 3 vì timeout `wake_detected`; hai lượt đầu pass đủ
  lifecycle. Không có forbidden firmware marker, fixture metrics
  `protocol_errors=0`, `turn_rejections=0`, nên đây là false-reject acoustic/
  WakeNet path chứ không phải Groq quota.
- Report redact: `/tmp/veetee-wake-100-fixture-threshold65-20260804.json`.
  Production Voice revision 87 đã khôi phục với test-key env bị loại,
  `activeConnections=1`, `activeTurns=0`. Không hạ threshold và không thêm
  provider fallback để che lỗi detector.
- M1 vẫn chưa đóng: cần instrument AEC/playback-reference/WakeNet timing,
  acoustic echo-only và voice-onset barge-in/time-to-silence; 20/20 A/B trước
  đó không thay thế 100-repetition gate.

### AEC-transform bypass diagnostic and audio-test pause (2026-08-04)

- Diagnostic image giữ AEC handle/full-duplex wake policy nhưng tắt riêng
  `CONFIG_VEETEE_AEC_PROCESS_WAKE`; scenario 20 lượt, threshold 65%, delay 10
  giây và fixture LLM/TTS đạt **20/20** lifecycle. Không có forbidden marker,
  protocol error hoặc turn rejection. Report redact ở
  `/tmp/veetee-wake-aec-bypass-20-delay10-20260804.json`; đây chỉ là evidence
  thu hẹp nghi vấn AEC transform, chưa phải kết luận nguyên nhân.
- Đã trả scenario local về 100 lượt, bật lại `CONFIG_VEETEE_AEC_PROCESS_WAKE`,
  build/flash production ESP32-S3 không erase NVS; Voice production Manager
  revision 87 chạy lại trên `18100`, history/presence bật, không có
  `VEETEE_TEST_GROQ_KEYS_FILE`, health `200`, board reconnect
  `activeConnections=1`, `activeTurns=0`.
- Theo yêu cầu operator, **đã dừng mọi test phát audio** sau diagnostic này.
  Không chạy lại `pw-play`, wake harness hoặc bài acoustic cho tới khi operator
  cấp quyền mới; thời gian còn lại chỉ được làm host/serial-read-only/docs/runtime
  checks không phát âm thanh.

### MCP wire serializer host/build slice (2026-08-05)

- Hoàn tất serializer response JSON-RPC bounded trong firmware với outer
  `session_id/type/payload` envelope, `initialize`, `tools/list`, generic
  `result` và sibling `error`; fixed literal lengths không còn hand-counted.
- `tools/list` dùng opaque `nextCursor` là tên tool kế tiếp để tương thích peer
  tham chiếu; serializer không nhúng tên tool/GPIO/provider vào code.
- Host CTest firmware: **4/4 passed**; ESP-IDF 6.0.2 build-only pass, binary
  `0x1593e0`, app partition còn **66%**.
- Đây chỉ là serializer; inbound cJSON parser, main transport callback,
  BoardHal/MCP hardware tools và physical conformance vẫn mở. Không flash/reset,
  không phát audio, không truy cập mic/loa/serial audio, không đổi Wi‑Fi/Tailscale
  và không mutate production database `veetee_vubq`.

### Full non-audio regression after serializer (2026-08-05)

- Voice Server: **138 passed**, Ruff và `compileall` pass.
- Manager API: **31 passed / 12 skipped** (các PostgreSQL test cần dedicated DSN),
  TypeScript lint/build và OpenAPI artifact check pass.
- Manager Web: **93 unit passed**, Chromium E2E **11/11**, typecheck/lint/build
  pass; a11y E2E không có serious/critical violation.
- Firmware host CTest thường và ASan/UBSan đều **4/4**; ESP-IDF 6.0.2 build
  pass sau commit `d5cee47`.
- Đây là bằng chứng host/build/UI; không restart runtime, không phát audio,
  không truy cập mic/loa/serial audio, không flash/reset ESP32, không đổi
  Wi‑Fi/Tailscale và không dùng database production.

### Runtime tooling non-audio check (2026-08-05)

- `tools/runtime/tests`: **20 passed** bằng `uv run pytest -q`.
- `tools/runtime` và `tools/physical` compileall pass; chỉ kiểm tra parser,
  fixture/schema và harness guard, không mở audio device hay chạy bài phát âm.
- Workspace sau kiểm tra vẫn sạch tại `master`/`origin/master`; không restart
  service hoặc thay đổi network/database/firmware.

### Readiness snapshot after host-only work (2026-08-05)

- Read-only probes: Voice `18100`, Manager API `18101`, Manager Web `18181` đều
  HTTP **200**.
- Voice metrics tại thời điểm probe: `active_turns=0`, `protocol_errors=0`,
  `audio_frames_in=0`, `audio_frames_out=0`; một connection idle đang giữ.
- Tailscale Serve vẫn chỉ map private origin
  `https://veetee.tail52a635.ts.net/` → `http://127.0.0.1:18181`; không Funnel,
  không đổi route/listener. Host tự không được coi là bằng chứng TLS/WebSocket
  từ peer khác trong tailnet.

### Groq text capability smoke (test-only, 2026-08-05)

- `tools/groq_probe.py` nạp **4 key test** và không in secret.
- `llama-3.3-70b-versatile`: 4/4 HTTP 200, request latency 285–507 ms.
- `llama-3.1-8b-instant`: 4/4 HTTP 200, request latency 306–416 ms.
- Đây chỉ là synchronous text smoke; chưa đủ để promote model theo streaming
  TTFA, WER, tool-following hoặc VRAM. Production không dùng key pool fallback.

### Groq SSE first-text probe (test-only, 2026-08-05)

- `tools/groq_probe.py --stream` parse SSE fail-closed và chỉ đo first
  meaningful text; tool-call delta/`[DONE]` không được tính là token đầu.
- `llama-3.3-70b-versatile`: 4/4 HTTP 200, first text **269–339 ms**, 5 chunks.
- `llama-3.1-8b-instant`: 4/4 HTTP 200, first text **260–359 ms**, 5 chunks.
- Regression parser mới **3 passed**; probe chỉ là Internet text smoke, chưa
  phải E2E TTFA/WER/tool-following/VRAM promotion và không đổi production config.

### Groq streamed tool-call smoke (test-only, 2026-08-05)

- `llama-3.3-70b-versatile`: 4/4 HTTP 200; streamed function `get_weather`,
  arguments JSON hợp lệ; first tool delta **306–512 ms**.
- `llama-3.1-8b-instant`: 4/4 HTTP 200 nhưng không phát tool-call delta trong
  prompt forced-call này; không coi là tool-following pass.
- Probe chỉ đo capability Internet và không gửi call xuống thiết bị; fragmented
  arguments, authorization và MCP end-to-end vẫn cần test riêng.

### Production Groq fragmented tool-call hardening (2026-08-05)

- Provider SSE parser fail-closed với malformed event/`choices`/`delta` shape.
- Pipeline giữ argument fragments không lặp `function.name`, fail-closed khi
  thiếu tool name và không trộn hai tool name trong cùng round.
- Targeted provider/pipeline: **28 passed**; full Voice Server sau thay đổi:
  **139 passed**, Ruff/compileall pass.
- Không mở audio/network carrier, không gọi hardware tool thật, không đổi
  provider fallback/production key policy.

### PostgreSQL test isolation and acoustic-test pause (2026-08-04)

- Test harness Manager API nay fail-closed nếu `VEETEE_TEST_DATABASE_URL_FILE`
  trỏ tới database không có tên kết thúc `_test`; tên production
  `veetee_vubq` bị từ chối trước khi mở connection. Test database hiện dùng là
  `veetee_vubq_test`, tách khỏi runtime production.
- Trước mỗi PostgreSQL test, harness giữ một PostgreSQL advisory lock chung,
  reset toàn bộ bảng dữ liệu trong schema `veetee_manager` rồi mới chạy test;
  `schema_migrations` không bị xóa. Các file test chạy song song vẫn không
  truncate lẫn nhau, và test không để lại assistant/device/session/history
  giữa các lần chạy.
- Verification host-only: Manager API `lint` pass; suite với DSN dedicated
  `veetee_vubq_test` **33/33 passed**, gồm regression từ chối DSN production.
  Không restart runtime, không mutate `veetee_vubq`, không flash firmware và
  không phát audio.
- Quyền phát audio trực tiếp qua ESP32 vẫn đang **tạm dừng theo yêu cầu**; mọi
  acoustic/wake/PTT acceptance còn lại chỉ được chạy sau khi operator cấp quyền
  lại. Host unit, protocol, DB, UI và serial read-only có thể tiếp tục.

### Auto-turn watchdog race regression (2026-08-04)

- Host-only Voice Server test xác nhận khi `mode=auto` bị thay bằng turn mới
  trước `noSpeechTimeoutMs`, watchdog generation cũ bị hủy và không abort turn
  mới. Nhóm no-speech **3 passed**; toàn bộ suite Voice Server **63 passed**.
- Không phát audio ra ESP32, không mở serial, không đổi firmware/config/runtime
  production. Acoustic wake, barge-in và false-reject gates vẫn giữ nguyên trạng
  thái mở.

### URL metadata hardening and non-audio regression (2026-08-04)

- `VEETEE_PUBLIC_BASE_URL` đã được thêm vào Manager API environment schema;
  OpenAPI `servers` lấy origin đã cấu hình, không suy từ `Host`. Manifest
  canonical đặt `https://veetee.tail52a635.ts.net`; runtime probe live trả đúng
  URL này, CORS preflight exact origin `204`, không mở listener/public port mới.
- Sau khi dọn các API watcher trùng của chính checkout (không đụng process,
  database hoặc mạng của checkout khác), canonical listeners là Voice
  `0.0.0.0:18100`, API `127.0.0.1:18101`, Web `127.0.0.1:18181`; cả ba ready,
  Voice revision 87 `activeConnections=1`, Tailscale Serve duy nhất vẫn `/` →
  Web `18181`.
- Regression không phát audio: Manager API **32/32** (gồm PostgreSQL test DB
  riêng), Voice Server **62 passed**, Manager Web **63/63** + typecheck/lint/
  build, firmware host CTest **1/1**, runtime tests **20 passed**. Không chạy
  wake harness hoặc `pw-play` trong lượt này.

### Firmware display HAL hardening (2026-08-05)

- Display init đã guard backlight GPIO âm trước khi gọi `gpio_set_level`, giữ
  nguyên profile hiện tại (ST7789 backlight GPIO42) nhưng an toàn cho board
  descriptor không có backlight.
- ESP-IDF 6.0.2 build pass, binary còn 66% app partition; firmware host CTest
  1/1 pass. Không flash, không phát audio, không đổi NVS/Wi-Fi/network.

### Runtime database test-data audit (2026-08-05)

- Read-only API audit trên database riêng `veetee_vubq` cho thấy dữ liệu device
  mẫu từ các test lịch sử vẫn còn (nhiều record tên `Postgres robot`, cùng
  assistant); đây là data pollution đã tồn tại trước lượt này, không phải
  runtime tự nhân bản khi board reconnect. Device thật hiện vẫn được presence
  gửi với `activeConnections=1`, nhưng chưa bind vào assistant nên
  `onlineDeviceCount=0` là hợp lý.
- Không xoá hoặc sửa trực tiếp các record vì đó là thao tác destructive và chưa
  có chỉ định record nào cần giữ. Các PostgreSQL test hiện dùng riêng
  `veetee_vubq_test`; backup dump runtime đang nằm ngoài Git để operator quyết
  định cleanup/restore sau.
- Đây là blocker dữ liệu của M2 dashboard, không đóng M2; cleanup tiếp theo phải
  có allowlist record hoặc restore snapshot được operator duyệt, không được
  dùng `DELETE` mù.

### Assistant summary read-state hardening (2026-08-04)

- Manager Web giờ phân biệt `loading`, `error`, `offline`, `not-found` và
  `ready` khi tải assistant theo route; lỗi gateway không còn rơi vào empty
  state giả. Retry dùng component `AssistantSummaryState` chung và focus vào
  heading để screen reader nhận biết thay đổi.
- Bốn workspace view không render form/controls từ assistant stale khi API lỗi;
  route param đổi sẽ hủy kết quả cũ bằng generation guard và tải assistant mới.
- Verification không audio: Web typecheck/lint/build, **66/66 unit tests**;
  Chromium E2E **9/9** (gồm core a11y serious/critical gate). Không đổi
  API/database/firmware, Wi-Fi hoặc Tailscale.

### Empty-ASR gate (2026-08-04, host-only)

- Pipeline đã chặn transcript rỗng/whitespace ngay sau `ASR.finish()`: gửi
  `stt` rỗng và `alert.code="NO_SPEECH"`, không gọi Intent/LLM/TTS, tăng metric
  `no_speech_turns` và kết thúc turn với `finishReason=no_speech`. Alert text,
  status và emotion chỉ đọc từ localized `autoTurn.noSpeechAlert` trong snapshot;
  fallback kỹ thuật không chứa câu nghiệp vụ.
- Regression targeted **2 passed**; Voice Server full suite **64 passed**.
  ADR-021 và protocol spec đã ghi rõ khác biệt giữa `NO_SPEECH` (ASR rỗng) và
  `NO_SPEECH_TIMEOUT` (watchdog hết hạn trước speech).
- Mốc này hoàn toàn host-only: không phát `pw-play`, không chạy wake harness,
  không mở serial để phát test, không flash board, không đổi Wi-Fi/network và
  không mutate database production. Physical wake/PTT/mic/speaker acceptance
  vẫn chờ operator cấp quyền lại.

### Non-blocking provider generation warm-up (2026-08-05, host-only)

- Runtime config manager dùng activation lock riêng: provider/model candidate
  được prepare ngoài view/lease lock, còn swap generation vẫn atomic. Vì vậy
  session cũ không bị chặn acquire/release khi PhoWhisper/VieNeu hoặc provider
  pool đang warm; `stop()` chờ activation để tránh publish sau shutdown.
- Regression mới chứng minh lease cũ vẫn acquire được trong lúc candidate bị giữ
  ở `prepare()`; regression cancellation cũng chứng minh candidate dở dang được
  close khi shutdown/hủy task. Native/untyped activation exception cũng được
  close fail-closed và giữ last-known-good view. Voice Server full suite **67
  passed**, Ruff pass.
- Không phát audio, không chạy wake harness, không flash/đổi firmware, không
  restart runtime production, không đổi Wi-Fi/network và không mutate
  `veetee_vubq`.

### History identity redaction (2026-08-05, host-only)

- History event không còn ghi raw wire `Device-Id`; `deviceKey` dùng SHA-256
  identity hash giống presence, nên MAC/device identity không đi vào Manager
  history payload. Wire message và API field name vẫn tương thích.
- Regression history kiểm tra hash đúng và raw identity vắng mặt. Không phát
  audio, không restart runtime, không flash firmware và không mutate production
  database.

### PTT debounce module extraction (2026-08-05, host-only)

- Firmware debounce GPIO0 được tách thành module pure fixed-state
  `veetee_ptt.c/.h`; `ptt_task` chỉ xử lý edge và giữ nguyên pending/retry,
  interrupt, listen-start/stop behavior. Không allocation hoặc blocking trong
  vòng poll.
- Host firmware CMake/CTest với warning-as-error pass **1/1**, gồm regression
  bounce/press/release/threshold. Chưa flash image, chưa mô phỏng GPIO vật lý
  và không phát audio; PTT/mic/speaker vẫn là physical gate mở.

### Provider selection validation (2026-08-05, host-only)

- Provider selection PATCH không còn ghi draft tham chiếu config unknown/foreign
  owner hoặc sai provider `kind`. `disabled` kèm `providerConfigId` cũng bị từ
  chối. Domain error ổn định là `CONFIG_INVALID`/422; invalid write giữ nguyên
  assistant ETag/revision. Semantics được áp dụng đồng nhất cho InMemory và
  PostgreSQL.
- Dedicated PostgreSQL test DB `veetee_vubq_test`: **36/36 passed**; Manager API
  lint/build/OpenAPI check pass. Manager Web generated client đã regenerate;
  typecheck/lint/Vitest **66/66** và production build pass.
- Không mutate database production `veetee_vubq`, không restart runtime, không
  flash/đổi firmware, không đổi Wi-Fi/Tailscale.
- Operator audio pause vẫn có hiệu lực: không phát audio, không chạy wake/PTT
  acoustic harness, không mở microphone/speaker; physical acceptance chờ cấp
  quyền lại.

### Device last-conversation binding (2026-08-05, host-only)

- History ingest cập nhật `Device.lastConversationAt` chỉ khi `deviceKey` là
  SHA-256 identity hash khớp device đang bind đúng owner/assistant. Duplicate
  turn và event cũ không làm lùi timestamp; raw MAC/device ID không được dùng
  làm join key.
- InMemory/PostgreSQL regression pass, gồm restart/unlink history; dedicated
  `veetee_vubq_test` vẫn tách production. Không migration vì cột đã có sẵn,
  OpenAPI không đổi.
- Không mutate `veetee_vubq`, không restart runtime, không flash board, không
  đổi Wi-Fi/Tailscale và không phát audio; acoustic acceptance vẫn pause.

### Package entry-point provider registry (2026-08-05, host-only)

- Provider runtime đã chuyển sang discover `veetee.providers`; built-in và
  external provider dùng cùng factory contract, không còn nhánh dispatch theo
  vendor ID trong `ProviderRegistry`. Config/snapshot chọn stable ID; package mới
  không cần sửa conversation core. Duplicate/malformed entry point fail-closed,
  không fallback.
- `.venv` metadata xác nhận đủ **10 entry points**; Voice Server **70 tests
  passed**, Ruff/compileall pass. Chưa load model provider thật và chưa coi đây là
  artifact/VRAM promotion evidence.
- Không phát audio, không mở microphone/speaker, không flash/reset ESP32, không
  restart runtime production, không đổi Wi-Fi/Tailscale hoặc secret.

### Measured resource promotion gate (2026-08-05, host-only)

- Voice Server bổ sung `veetee_server.resources`: snapshot có `resourceBudget`
  được validate fail-closed trước khi tạo provider/model candidate. Công thức
  tách `measuredWarmBaselineMiB`, `candidatePeakDeltaMiB`,
  `candidateWarmPeakMiB`, session reserve và activation margin; promotion limit
  của profile 4 GiB là 3.500 MiB.
- Candidate nằm trong dual-residency headroom dùng `BLUE_GREEN`. Candidate chỉ
  vừa khi đứng riêng dùng `QUIESCE_SWAP` và chỉ unload generation cũ khi không
  còn session lease; candidate không vừa cả hai mode bị từ chối trước factory/
  CUDA allocation. Quiesce failure reload đúng snapshot cũ; không có provider
  fallback.
- Regression resource/runtime: **24 tests passed** (initial plan, blue-green,
  reject trước instantiate, lease gate, quiesce promotion và rollback exact old
  snapshot). Snapshot cũ không có `resourceBudget` vẫn tương thích; field này
  hiện là deployment benchmark artifact, chưa hiển thị như form owner-facing.
- Đây hoàn toàn là host-only. Không phát audio, không mở microphone/speaker,
  không flash/reset firmware, không restart runtime production, không đổi
  Wi-Fi/Tailscale, không mutate `veetee_vubq`.

### Additive role-policy preservation (2026-08-05, host-only)

- Manager API PATCH schema và OpenAPI giờ giữ rõ các object additive
  `progress`/`segmentation`/`bargeIn`/`toolPolicy`; Web generated client đã
  regenerate. RoleConfig gateway/feature cũng round-trip các policy và `tools`
  thay vì làm mất chúng khi operator chỉnh một field khác.
- Vue policy clone dùng JSON detach để tránh `DataCloneError` từ reactive proxy;
  regression Web **68/68**, HTTP gateway round-trip pass, E2E **9/9**. Manager
  API test DB riêng `veetee_vubq_test` **36/36**, lint/build/OpenAPI pass.
- Đây là host/control-plane hardening, không phát audio, không flash/reset,
  không mutate `veetee_vubq`, Wi-Fi hoặc Tailscale.

### Overnight audio-test pause and host regression (2026-08-05, non-audio)

- Theo yêu cầu operator, từ mốc này **không** chạy `pw-play`, wake/audio
  harness, microphone/speaker acceptance, serial audio check, flash/reset/erase
  firmware hoặc thay đổi Wi-Fi/Tailscale. Các cổng physical M0/M1 vẫn giữ trạng
  thái pending cho đến khi operator cấp quyền lại.
- Regression sau commit `0ac28a7`: Voice Server **81/81**; Manager API với
  dedicated PostgreSQL `veetee_vubq_test` **36/36**; Manager Web typecheck,
  lint, build và unit **68/68**; Chromium E2E **9/9** (bao gồm provider
  revision/conflict, history keyboard, mobile overflow và serious/critical a11y);
  firmware host CTest **1/1**; runtime tools **20/20**.
- Readiness read-only không restart service: Voice `18100`, API `18101`, Web
  `18181` đều trả `200`; Voice `activeConnections=1`, `activeTurns=0`,
  `protocol_errors=0`. Không gọi Groq, không load provider generation mới và
  không mutate production DB `veetee_vubq`.

### Profile conformance host recheck (2026-08-05, non-audio)

- Re-run các test handshake/control cho profile WebSocket `ws-v1-compat`, `ws-v2`
  và `ws-v3`: **8 passed**, gồm compatibility turn, MCP ordering, malformed
  handshake và session ownership. Runtime lab/runtime helper tests: **18 passed**.
- `ptt_acceptance.py --help` và wake harness dry-run/help chỉ kiểm tra CLI; không
  mở serial, microphone, speaker hoặc audio player. Không gửi frame tới ESP32,
  không gọi provider production và không đổi config/network.
- Đây chỉ là host protocol evidence. Cross-peer provider turn, M0 manual PTT,
  speaker/LCD/mic và M1 acoustic gates vẫn pending operator permission.

### Voice runtime source sync after resource gate (2026-08-05, non-audio)

- Sau khi push `86e2041`, chỉ Voice service `veetee-voice-18100.service` được
  restart để nạp source mới; Manager API/Web, PostgreSQL, Redis và Tailscale
  không restart. ESP32 tự reconnect sau restart, không cần flash/reset.
- Readiness sau reconnect: Voice/API/Web lần lượt `200`, Voice revision `87`,
  `activeConnections=1`, `activeTurns=0`, `activationFailures=0`,
  `protocol_errors=0`, `audio_frames_in=0`, `audio_frames_out=0`. Không chạy
  `pw-play`, wake harness hoặc bất kỳ test phát audio nào.

### Full host regression recheck (2026-08-05, non-audio)

- Voice Server: **81/81**; Ruff và compileall pass.
- Manager API với dedicated PostgreSQL `veetee_vubq_test`:
  **36/36** pass; `lint`, `build`, `openapi:check` pass. Production database
  `veetee_vubq` không được dùng cho test.
- Manager Web: typecheck, lint, production build và **66/66** unit tests pass;
  Chromium E2E **9/9** pass, gồm provider schema flow, conflict/offline states,
  keyboard history và serious/critical a11y gate.
- Firmware host CTest: **1/1** pass. Không flash, không reset và không mở serial
  để phát audio.
- Runtime tools: **20/20** pass. Đây là host/network evidence; M0/M1 physical
  speaker/LCD/PTT/wake/AEC acceptance vẫn chờ quyền audio của operator.

### Idle resource observation (2026-08-05, non-audio)

- Runtime snapshot revision `87` đang chọn PhoWhisper CUDA `int8_float16`, Silero
  VAD CPU và VieNeu ONNX INT8. Đo read-only trên đúng Voice process trong 10 mẫu
  cách nhau 1 giây: RSS ổn định khoảng **1086 MiB**, CUDA process memory ổn định
  **344 MiB** trên GTX 1650Ti 4 GiB.
- Đây chỉ là measured warm/idle observation của generation đang chạy; chưa đo
  candidate peak delta, standalone candidate peak hoặc BLUE_GREEN activation.
  Vì vậy chưa publish `resourceBudget` và chưa coi provider/VRAM promotion gate
  đạt. Không phát audio, không gọi Groq, không load generation thứ hai và không
  mutate runtime/database/network.

### Write-only secret management (2026-08-05, non-audio)

- Manager Web Provider Registry đã có panel tạo/rotate/xóa secret reference.
  Web chỉ giữ metadata (`name`, masked locator, version, status, ETag); plaintext
  chỉ đi trong request write-only tới Manager API và không xuất hiện trong
  response, mock state hoặc domain entity.
- Secret rotation dùng pre-check owner + ETag, ghi encrypted-local value rồi
  cập nhật metadata version/status/lastRotatedAt. Nếu bước metadata thất bại,
  encrypted store có thể đã có version mới nhưng runtime vẫn fail-closed; cần
  retry/reconcile thay vì tự suy đoán trạng thái.
- Provider config giữ unknown secret IDs khi load và dùng `VtCheckbox` custom
  thay cho native checkbox, đồng bộ hover/focus/disabled tokens của Manager Web.
- Host regression sau slice: Manager API dedicated `veetee_vubq_test` **37/37**,
  lint/build/OpenAPI check pass; Manager Web typecheck/lint/build, full unit
  **73/73**, Chromium E2E **9/9**. Không gọi Groq, không phát audio, không mở
  microphone/speaker, không flash/reset ESP32, không đổi Wi-Fi/Tailscale hoặc
  mutate production DB `veetee_vubq`.

### Retention policy editor (2026-08-05, non-audio)

- History workspace đã có `RetentionPolicyPanel` component để chỉnh transcript
  retention bằng typed ETag mutation; thời hạn dùng `VtInput` số theo miền
  1–3.650 ngày, không khóa vào danh sách option cố định. Tắt transcript tự gửi
  `transcriptDays=null`;
  audio recording luôn disabled và payload bị khóa ở `captureAudio=false`,
  `audioDays=null` cho tới khi artifact audio được hỗ trợ/promote.
- Offline, stale revision và validation không làm mất draft; lỗi được focus,
  announce bằng `role=alert` và toast. Preview `MockGateway` lưu policy/revision
  riêng, không chạm API/database thật.
- History cũng hiển thị banner khi một trong hai read (`conversations` hoặc
  `retention-policy`) là snapshot stale/offline có dữ liệu, nên operator không
  nhầm dữ liệu cũ với trạng thái live.
- Web verification: typecheck, lint, production build, unit **81/81** và
  Chromium E2E **9/9**; axe serious/critical gate pass. Không gọi Groq, không
  phát audio, không mở microphone/speaker, không flash/reset firmware, không đổi
  Wi-Fi/Tailscale hoặc mutate `veetee_vubq`.

### Full host regression after retention hardening (2026-08-05, non-audio)

- Voice Server **81 passed**; Manager API dedicated `veetee_vubq_test`
  **37/37**, `openapi:check`, lint/build pass; firmware host CTest **1/1**;
  runtime tools **20/20**.
- Manager Web typecheck/lint/build, unit **81/81**, Chromium E2E **9/9** và
  axe serious/critical gate pass. Đây là host/control-plane evidence.
- Audio lock vẫn giữ nguyên: không `pw-play`, wake/audio harness,
  microphone/speaker/serial audio, flash/reset/erase firmware hoặc thay đổi
  Wi-Fi/Tailscale; không mutate production DB `veetee_vubq`.

### Read-only readiness after host regression (2026-08-05, non-audio)

- Không restart process: Voice `18100/health/ready`, Manager API
  `18101/health/ready` và Manager Web `18181/` đều HTTP **200**.
- Voice hiện báo `revision=87`, `activeConnections=1`, `activeTurns=0`,
  `maxActiveTurns=1`; các counter/resource lịch sử không được diễn giải là
  physical acceptance. Không gửi frame, không gọi Groq, không mở serial/audio.

### Conversation privacy export (2026-08-05, non-audio)

- History API/Web đã có export từng conversation JSON theo ADR-024. Endpoint
  owner/retention-scoped dùng response allow-list, loại `deviceKey`, secret,
  raw identity và audio; Web download object URL ngắn hạn rồi revoke.
- API PostgreSQL test `veetee_vubq_test` **37/37**, OpenAPI check/lint/build pass;
  Web unit **84/84**, Chromium E2E **10/10**, gồm export download và a11y gate.
- Bulk archive vẫn deferred; delete async/tombstone đã có qua ADR-025;
  không ghi export content vào log/browser storage. Không gọi Groq, không phát
  audio, không flash/reset ESP32, không đổi Wi-Fi/Tailscale hoặc production DB.

### Conversation delete job và tombstone (2026-08-05, non-audio)

- Manager API thêm `DELETE /api/v1/conversations/{id}` và
  `GET /api/v1/retention-delete-jobs/{jobId}`. Job unique theo owner/conversation,
  trả `202`, worker bounded và retry tối đa 3 lần; không giữ request trong lúc
  cascade xóa turns.
- PostgreSQL migration `005_conversation_delete_jobs.sql` thêm job và
  `conversation_tombstone`; InMemory adapter giữ cùng semantics. Delete transaction
  xóa conversation/turns, không lưu transcript/device identity/audio vào tombstone.
- GET detail/export cùng owner trả `410 RETENTION_EXPIRED` trong TTL tombstone;
  retention purge cũng tạo tombstone rồi dọn tombstone hết hạn. TTL lấy từ
  `VEETEE_RETENTION_TOMBSTONE_SECONDS` (mặc định 7 ngày), không hard-code UI.
- Manager Web có `ConversationDeleteDialog` component, confirm/loading/offline/
  failure state và loại item sau job completed; MockGateway không mutate fixture
  dùng chung.
- Verification: Manager API dedicated PostgreSQL `veetee_vubq_test` **39/39**,
  OpenAPI export/check, lint/build pass; Manager Web typecheck/lint/build/unit
  **87/87**, Chromium E2E **11/11** (a11y serious/critical gate). Không gọi Groq,
  không phát audio, không mở microphone/speaker,
  không flash/reset ESP32, không đổi Wi-Fi/Tailscale hoặc mutate production DB.

### Runtime readiness after conversation delete slice (2026-08-05, non-audio)

- Read-only probe trên runtime hiện tại: Manager API `18101/health/ready`, Voice
  `18100/health/ready` và Web `18181/` đều HTTP **200**; API OpenAPI đã expose
  `/api/v1/conversations/{id}` DELETE, `/api/v1/retention-delete-jobs/{id}` GET
  và response `410` cho conversation detail.
- Production database migration was applied additively after an explicit DSN
  guard for `veetee_vubq`; `schema_migrations` reports version **5**
  (`005_conversation_delete_jobs.sql`). A read-only unknown-job probe returns
  `404 application/problem+json`, not a missing-table/500 error.
- Không restart Voice, không load provider generation mới và không tạo/xóa data
  trên production `veetee_vubq`; endpoint chỉ được xác nhận qua OpenAPI.
- Audio lock vẫn giữ nguyên: không `pw-play`, wake/audio harness,
  microphone/speaker/serial audio, flash/reset/erase firmware hoặc đổi
  Wi-Fi/Tailscale.

### Unknown-route problem contract hardening (2026-08-05, host-only)

- Manager API đã thêm `setNotFoundHandler`: route không tồn tại trả cùng
  `application/problem+json` contract, `code=NOT_FOUND`, detail ổn định
  `Route not found`; query string không được echo để tránh lộ credential/canary.
- Regression mới kiểm tra media type, code, detail và không-echo query; không
  thay đổi wire protocol, provider fallback, runtime config, firmware hoặc DB.
- Verification: Manager API dedicated `veetee_vubq_test` **39/39**, lint/build/
  `openapi:check` pass; Voice Server `.venv` **81/81**; Manager Web typecheck,
  lint, build, unit **87/87**, Chromium E2E **11/11** (axe serious/critical
  pass); firmware host CTest **1/1**; runtime tools **20/20**.
- Đây là host/control-plane evidence. Theo yêu cầu operator, audio lock vẫn
  bật: không `pw-play`, wake/audio harness, microphone/speaker/serial audio,
  flash/reset/erase ESP32, đổi Wi-Fi/Tailscale hoặc mutate production
  `veetee_vubq`; không restart các service đang chạy.

### Secret log-redaction hardening (2026-08-05, host-only)

- Manager API logger redaction đã bao phủ explicit request paths cho bearer,
  cookie/CSRF, `password`, `secretValue`, `apiKey`, access/refresh token và
  pairing code; wildcard tương ứng vẫn giữ cho nested error metadata.
- Secret canary regression vẫn pass và response/storage không chứa plaintext;
  thay đổi chỉ ở logging policy, không đưa key/token vào source hoặc note.
- Verification: Manager API dedicated `veetee_vubq_test` **39/39**, lint/build/
  `openapi:check` pass. Không restart service, không mutate production DB,
  không gọi Groq, không đụng firmware/audio/Wi-Fi/Tailscale.

### Dependency and static-quality recheck (2026-08-05, non-audio)

- Manager API và Manager Web `npm audit --omit=dev --audit-level=high` đều báo
  **0 vulnerabilities**; không đổi lockfile hay cài thêm dependency.
- Voice Server `compileall` và Ruff trên `src`/`tests` đều pass. Đây là kiểm tra
  tĩnh bổ sung sau hai hardening slice, không phải provider/physical acceptance.
- Audio lock, production DB isolation, service/process ownership và network
  boundaries vẫn giữ nguyên.

### Manager Web router guard hardening (2026-08-05, host-only)

- Router được tách thành `createVeeteeRouter(session, history)` để auth guard
  có thể kiểm thử độc lập bằng memory history; singleton browser router vẫn giữ
  `authSession` + `createWebHistory` như trước.
- Regression mới bao phủ redirect unauthenticated với `redirect` path, preview
  mode, authenticated login redirect chỉ nhận path nội bộ an toàn và document
  title theo route. Không đổi API/auth contract hoặc UI layout.
- Verification: Manager Web typecheck/lint/build, unit **90/90**, Chromium E2E
  **11/11** (axe serious/critical pass). Không restart service, không phát
  audio, không flash/reset ESP32, không đổi Wi-Fi/Tailscale hoặc production DB.

### Locale-filtered voice catalog contract (2026-08-05, host-only)

- `GET /api/v1/voices?locale=...` giờ tính `total` từ chính danh sách đã lọc,
  thay vì đếm toàn bộ TTS installation. Điều này giữ pagination/empty-state của
  Manager Web nhất quán khi provider hỗ trợ locale khác nhau.
- Regression kiểm tra `vi-VN` và `en-US`, đảm bảo `total === items.length` và
  locale không phù hợp bị loại; không đổi provider selection/fallback policy.
- Verification: Manager API dedicated `veetee_vubq_test` **40/40**, lint/build/
  `openapi:check` pass. Không restart service, không phát audio, không mutate
  production DB, không đổi Wi-Fi/Tailscale/firmware.

### Provider catalog fail-closed validation (2026-08-05, host-only)

- `parseCatalog()` giờ kiểm tra từng installation trước khi đưa manifest vào
  runtime: id/displayNameKey/version phải là chuỗi không rỗng, kind phải thuộc
  registry `vad|asr|llm|tts|intent|memory`, id không được trùng, manifest và
  configSchema phải là object; `null` được chuẩn hóa thành object rỗng.
- Dữ liệu catalog sai bị từ chối ngay (fail-closed), tránh provider giả hoặc
  schema không hợp lệ lọt vào control plane. Không tự thêm fallback provider,
  không đổi wire protocol, không đổi production DB và không trim/ghi đè catalog
  nguồn ngoài phần parse boundary.
- Regression Manager API PostgreSQL dedicated `veetee_vubq_test`: **41/41**;
  `npm run lint`, `npm run build`, `npm run openapi:check` đều pass.
- Audio lock vẫn bật: không `pw-play`, wake/audio harness, microphone/speaker/
  serial audio, flash/reset/erase ESP32 hoặc đổi Wi-Fi/Tailscale.

### Schema-driven provider value validation (2026-08-05, host-only)

- Provider config boundary giờ diễn giải các keyword JSON Schema mà catalog dùng:
  type/integer, enum, minimum/maximum, min/max length, min/max items, nested
  properties/items, required, additionalProperties và format `uri`.
- Validation generic theo schema, không có branch theo provider ID hoặc tên field;
  config sai bị trả `422 CONFIG_INVALID` trước khi tạo revision. Schema rỗng
  được coi là object đóng để tránh chấp nhận key ngoài ý muốn.
- Manager API PostgreSQL dedicated `veetee_vubq_test`: **42/42**; lint, build và
  `openapi:check` pass. Không đổi provider fallback, wire protocol, production
  DB hay runtime process.
- Audio lock vẫn bật; không phát audio, mở microphone/speaker/serial audio,
  flash/reset/erase ESP32 hoặc đổi Wi-Fi/Tailscale.

### Manager Web advanced provider validation (2026-08-05, host-only)

- `SchemaConfigForm` dùng cùng subset JSON Schema ở phía UI cho phần Advanced
  JSON: nested object/array, type, enum, range, length/item count, required,
  additionalProperties và URI được kiểm tra trước khi emit draft.
- Draft sai được giữ nguyên, hiển thị lỗi theo path (ví dụ `advanced.rules`)
  và không gửi mutation; API vẫn là boundary authoritative nên không có bypass
  bằng cách gọi HTTP trực tiếp. Không branch theo provider hoặc field name.
- Verification: Manager Web typecheck/lint/build, unit **91/91**; Manager API
  schema tests **42/42** vẫn pass. Không đổi wire/provider fallback, không
  restart service, không mutate production DB và audio lock vẫn bật.

### Manager Web URI field validation (2026-08-05, host-only)

- Primitive schema field có `format: "uri"` giờ được kiểm tra thật bằng URL
  parser trước khi emit provider draft; `type=url` chỉ là UX hint, không còn là
  validation duy nhất. Input sai giữ draft và báo lỗi inline.
- Regression Manager Web full unit **92/92**, typecheck/lint/build pass. API
  schema suite **42/42** vẫn xanh; không đổi protocol/provider fallback, không
  restart runtime, không đụng production DB/network và audio lock vẫn bật.

### Host regression after provider-schema UI slices (2026-08-05, non-audio)

- Voice Server scoped suite `veetee-server/tests`: **81 passed**; runtime tools
  `tools/runtime/tests`: **20 passed**; firmware host CTest `protocol_state`:
  **1/1 passed** (không flash/reset board).
- Manager Web: unit **92/92**, Chromium E2E **11/11**, typecheck/lint/build pass;
  Manager API PostgreSQL dedicated `veetee_vubq_test`: **42/42**, lint/build/
  `openapi:check` pass. Readiness read-only: Voice `18100`, API `18101`, Web
  `18181` đều HTTP 200.
- Không restart các service đang chạy, không gọi Groq, không phát audio/mở
  microphone/speaker/serial audio, không flash/reset/erase ESP32, không đổi
  Wi-Fi/Tailscale và không mutate production DB `veetee_vubq`.

### InMemory/PostgreSQL publication parity (2026-08-05, host-only)

- InMemory publish snapshot giờ giữ cùng metadata như PostgreSQL cho provider
  selection từ config revision: `providerConfigId`, `configRevision`, version,
  config clone và secretRefs. Điều này tránh Voice Server nhận snapshot khác
  shape tùy adapter.
- Regression Manager API dedicated PostgreSQL `veetee_vubq_test`: **43/43**,
  lint/build/`openapi:check` pass; test mới kiểm tra publish InMemory parity.
- Không đổi wire protocol, provider fallback, runtime process hay production DB;
  không phát audio/mở microphone/speaker/serial audio, không flash/reset ESP32,
  không đổi Wi-Fi/Tailscale.

### Provider manifest locale/secret binding validation (2026-08-05, host-only)

- Catalog parser normalize `manifest.locales` và `manifest.secretFields` thành
  chuỗi đã trim, đồng thời reject fail-closed nếu field không phải array hoặc
  có phần tử rỗng/sai kiểu. Capability manifest additive khác vẫn được giữ
  nguyên, không hard-code provider.
- Voice locale filter và secret binding vì vậy nhận input có shape rõ ngay từ
  parse boundary, không chờ fail muộn trong route/store.
- Manager API dedicated PostgreSQL `veetee_vubq_test`: **43/43**, lint/build/
  `openapi:check` pass. Không đổi wire/provider fallback/runtime/production DB;
  audio lock vẫn bật.

### Voice provider snapshot shape hardening (2026-08-05, host-only)

- `ProviderRegistry` không còn để `KeyError` hoặc âm thầm biến secretRefs sai
  kiểu thành `[]`: providerId thiếu/rỗng và secretRefs malformed giờ trả
  `ConfigurationError` typed trước khi factory/model allocation.
- Không có fallback hoặc retry provider; snapshot lỗi bị từ chối fail-closed,
  optional intent/memory cũng dùng cùng contract với provider bắt buộc.
- Voice Server tests **82 passed**, `compileall` và Ruff `src/tests` pass. Không
  load model thật, không phát audio/mở microphone/speaker, không restart runtime,
  không flash/reset ESP32, không đổi Wi-Fi/Tailscale/production DB.

### Config-driven locale/voice selector (2026-08-05, host-only)

- `RoleConfigFeature` không còn hard-code danh sách locale; select lấy locale
  explicit từ manifest của các TTS installation (giữ locale hiện tại nếu chưa
  có catalog) và reload `GET /voices?locale=...` khi owner đổi locale.
- Provider catalog/read lỗi làm form fail-closed; voice request chuyển locale
  có loading/error handling, không giữ danh sách voice stale như trạng thái live.
  Locale wildcard không bị biến thành giá trị `*` để publish.
- Manager Web unit **93/93**, E2E **11/11**, typecheck/lint/build pass. Không
  đổi API/wire/provider fallback, không restart runtime, không phát audio/mở
  microphone/speaker, không flash/reset ESP32, không đổi Wi-Fi/Tailscale.

### Final host regression while audio testing paused (2026-08-05, non-audio)

- Voice Server: **82/82** tests, `python3 -m compileall -q src` và Ruff pass;
  Manager API dedicated PostgreSQL `veetee_vubq_test`: **43/43**, lint/build/
  `openapi:check` pass.
- Manager Web: unit **93/93**, Chromium E2E **11/11**, typecheck/lint/build pass;
  runtime tools **20/20**; firmware host CTest `protocol_state` **1/1**.
- Readiness read-only: Voice `18100`, Manager API `18101`, Web `18181` đều HTTP
  200. Không restart service, không gọi Groq, không phát audio/wake harness,
  không mở microphone/speaker/serial audio, không flash/reset/erase ESP32,
  không đổi Wi-Fi/Tailscale và không mutate production `veetee_vubq`.

### Provider catalog schema-version gate (2026-08-05, host-only)

- `parseCatalog()` yêu cầu `schemaVersion === 1` trước khi validate
  installations; catalog thiếu/sai version bị từ chối sớm thay vì được diễn
  giải theo schema ngầm định.
- Regression Manager API dedicated `veetee_vubq_test`: **43/43**, lint/build/
  `openapi:check` pass. Catalog hiện tại vẫn version 1; không đổi provider
  fallback, wire protocol, runtime process hoặc production DB.
- Audio lock giữ nguyên: không phát audio, mở microphone/speaker/serial audio,
  flash/reset/erase ESP32 hoặc đổi Wi-Fi/Tailscale.

### Audio test pause và reproducible host test dependencies (2026-08-05)

- Theo yêu cầu operator, audio/physical lock tiếp tục có hiệu lực cho đến khi
  được cấp quyền mới: không `pw-play`, không wake/audio harness, không mở
  microphone/speaker hoặc serial audio, không flash/reset/erase ESP32, không đổi
  Wi-Fi/Tailscale và không dùng production database `veetee_vubq` cho test.
- Chuẩn hóa test discovery: `veetee-server` khai báo `pythonpath = ["src"]`;
  `tools/runtime/pytest.ini` khai báo `pythonpath = .`. Lệnh test canonical
  trong từng thư mục vì vậy không còn phụ thuộc `PYTHONPATH` thủ công.
- Môi trường sạch đã cho thấy VieNeu adapter cần `soxr` để resample 48 kHz →
  24 kHz, nhưng extra `test`/`local-tts` chưa khai báo dependency này. Đã bổ
  sung `soxr>=0.3,<2` và regenerate `uv.lock`; đây là packaging fix, không
  kích hoạt TTS hay phát audio.
- Evidence host-only sau thay đổi: Voice Server `./.venv/bin/pytest -q`
  **82 passed**; runtime tools `pytest -q` **20 passed**. Manager API dedicated
  `veetee_vubq_test` **43/43** và Manager Web unit **93/93** cùng
  typecheck/lint/build vẫn pass; readiness Voice/API/Web vẫn HTTP `200`.
  Không restart process đang chạy.
- Đây không đóng physical M0/M1 gates: LCD, loa, mic, PTT, wake corpus,
  acoustic barge-in và cross-peer conformance vẫn cần kiểm tra khi operator mở
  lại audio.

### M3 UDP v3 core — host-only (2026-08-05)

- Bổ sung `veetee_server.mqtt_udp` theo contract §5 của protocol spec: parse UDP
  hello, validate key/nonce, AES-128/CTR header-IV, payload ceiling 1.400 byte,
  sequence wrap guard và bounded reorder (window 4, jump 256, gap 120 ms).
- Golden vector deterministic nằm ở `tests/fixtures/mqtt_udp_v3.json`; test chỉ
  dùng bytes giả lập, không mở UDP/MQTT socket, không phát audio và không gọi
  provider. Reorder test cover contiguous release, duplicate, loss timeout,
  window overflow và jump reset.
- Voice Server suite sau slice: **91 passed**, Ruff và compileall pass. M3 vẫn
  chưa đóng: MQTT client/gateway, UDP socket, stream barrier, firmware carrier,
  hardware MCP, assets/OTA, loss/soak và transport-promotion evidence còn mở.
- Audio/physical lock vẫn giữ nguyên; WebSocket v3 vẫn là default và không có
  silent fallback sang MQTT/UDP.

### M3 MQTT/UDP ordering barrier — host-only (2026-08-05)

- `UdpTtsStreamBarrier` trong `veetee-server/src/veetee_server/mqtt_udp.py` đã
  nối semantics control/audio theo §5.6 mà không mở MQTT broker, UDP socket,
  route hoặc audio device.
- Pre-start buffer keyed theo `{session_id,audio_stream_id}` tối đa 8 packet/
  480 ms; overflow/timeout invalidates stream. `tts/start` kiểm tra boundary,
  marks unresolved prefix lost và chỉ release từ `start_sequence`. `tts/stop`
  drain chính xác tới `end_sequence`, drop packet sau end và abort/flush sau
  1.200 ms nếu chưa release đủ.
- Abort/reset/key rotation xóa mọi pre-start/active/expired state. Wrong stream,
  stale/out-of-range control hoặc packet không được đưa vào playback; metrics
  bounded nằm ở `UdpStreamMetrics`.
- Verification: Voice Server **99 passed**, Ruff và compileall pass. Không
  restart service, không gọi Groq/provider, không phát/thu audio, không mở
  serial, không flash/reset ESP32, không đổi Wi-Fi/Tailscale và không mutate
  production `veetee_vubq`.
- M3 vẫn chưa đạt DoD: MQTT client/gateway/socket, firmware transport,
  loss/reorder soak, hardware MCP, assets/OTA và promotion comparison còn mở;
  direct WebSocket v3 vẫn là default.

### M3 MQTT control boundary — host-only (2026-08-05)

- `veetee_server.mqtt_control` đã validate session config theo §5.2: endpoint
  host/port, opaque exact topics, keepalive, QoS và `retain=false`; credential
  không xuất hiện trong `repr`/redacted view.
- JSON MQTT payload có ceiling 8.192 byte, đúng một object UTF-8, finite/safe
  numbers; hello client/server và exact topic/session gate đã có fixture.
- Targeted test `tests/test_mqtt_control.py`: **20 passed**; full Voice Server
  regression sau slice: **119 passed**. Chưa có MQTT
  library, broker, socket hoặc live gateway; không restart process, không gọi
  provider/audio, không flash/reset ESP32, không đổi Wi-Fi/Tailscale và không
  mutate production `veetee_vubq`.
- M3 vẫn mở các phần carrier/gateway/firmware, loss/soak, MCP hardware,
  assets/OTA và transport-promotion; WebSocket v3 tiếp tục là default.

### M3 deterministic loss/reorder soak — host-only (2026-08-05)

- `tests/test_mqtt_udp_soak.py` dùng seed cố định để mô phỏng loss `0%`, `1%`,
  `5%`, bounded reorder/duplicate và stream 20.000 packet; packet cuối được
  giữ để kiểm tra graceful drain, còn stop-timeout đã có test riêng.
- Reorder core đã sửa invariant: không mark packet đã nằm trong slot là lost và
  không để `reorder_slots` vượt 4 trong các gap rời rạc.
- Targeted UDP + soak: **22 passed**; full Voice Server sau slice: **124
  passed**, Ruff/compileall pass. Không broker/socket/audio/provider, không
  restart runtime, không flash/reset ESP32 và không đổi mạng.
- Đây chưa đóng M3: carrier/gateway/firmware, real loss/latency comparison,
  MCP, assets/OTA và transport promotion vẫn mở; WebSocket v3 là default.

### M3 internal gateway bridge codec — host-only (2026-08-05)

- `veetee_server.mqtt_bridge` đã serialize/parse internal 16-byte gateway
  header theo §5.5; type/reserved/length/sequence/timestamp được validate và
  không bị trộn với UDP AES header.
- Golden fixture `tests/fixtures/mqtt_bridge_v3.json`, targeted test **4
  passed**; full Voice Server sau slice: **128 passed**, Ruff/compileall pass.
- Chưa có MQTT client, gateway live, UDP/WebSocket socket hoặc Opus decoder ở
  module này; audio lock, firmware/network lock và WebSocket v3 default giữ
  nguyên. Real-network transport comparison, firmware carrier, MCP, assets/OTA
  và promotion vẫn mở.

### M3 MQTT/UDP session coordinator — host-only (2026-08-05)

- `MqttUdpSession` đã ghép state `NEW → HELLO_SENT → READY → CLOSED`, client/server
  hello, per-session AES material, exact control topic/session, UDP decrypt và
  TTS stream barrier. `abort`, `goodbye` và `close` clear generation/key state.
- Test `tests/test_mqtt_session.py`: **5 passed**; full Voice Server sau slice:
  **133 passed**, Ruff/compileall pass.
- Đây chưa phải live gateway: không MQTT library/broker, UDP socket, Opus decode,
  firmware transport hoặc network side effect. Audio/ESP32/network lock vẫn giữ;
  real-network comparison, MCP, assets/OTA và transport promotion còn mở.

### M3 firmware UDP wire codec build evidence — host-only (2026-08-05)

- `veetee-firmware` host CTest: **2/2 passed**; ESP-IDF 6.0.2 `idf.py build`
  cho ESP32-S3 pass, app binary `0x1593e0`, partition còn 66%.
- Chỉ build, không flash/reset/erase, không mở socket/audio và không đổi NVS,
  Wi‑Fi hoặc Tailscale. Build log ghi nhận hai cảnh báo nền cần xử lý riêng khi
  mở carrier: component `mqtt` trong IDF tree không có `CMakeLists.txt`, và một
  số ESP-SR Kconfig default là `False` thay vì `n`.

### M3 managed MQTT dependency resolution — build-only (2026-08-05)

- Firmware khai báo `espressif/mqtt` trong `main/idf_component.yml` và
  `main/CMakeLists.txt`; `idf.py reconfigure` resolve registry version **1.1.0**
  và cập nhật `dependencies.lock`. Managed component output vẫn bị ignore, không
  vendor vào repository.
- `idf.py build` ESP32-S3 pass **1259/1259**, binary `0x1593e0`, app partition
  còn **66%**. Đây chỉ là dependency/build evidence; MQTT client, broker,
  UDP socket, encrypted carrier và runtime promotion chưa triển khai. Direct
  WebSocket v3 vẫn là default.
- Warning placeholder MQTT của IDF root và ESP-SR Kconfig `False`/`y-n` vẫn là
  warning nền, được ghi nhận để xử lý khi mở carrier; không sửa IDF trong lát cắt
  này. Audio/physical lock tiếp tục: không phát/thu audio, không serial audio,
  không flash/reset/erase, không đổi Wi‑Fi/Tailscale, không dùng production DB.

### MCP argument schema gate — host-only (2026-08-05)

- `DeviceMcpBridge.call()` validate `inputSchema` generic trước khi cấp request
  ID/send `tools/call`; required/type/range/unknown property và schema
  unsupported fail-closed bằng `TOOL_ARGUMENTS_INVALID`.
- Targeted MCP **9 passed**, full Voice Server **138 passed**, Ruff/compileall
  pass. Không đổi wire envelope, generation cancellation hay firmware-side
  authority; chưa có physical MCP acceptance.
- Audio/physical/network lock tiếp tục: không phát/thu audio, không serial audio,
  không flash/reset/erase ESP32, không đổi Wi‑Fi/Tailscale, không dùng production DB.

### Firmware build revalidation after host MCP slice (2026-08-05)

- ESP-IDF 6.0.2 incremental build pass **9/9**, binary `0x1593e0`, app partition
  còn **66%**; managed `espressif/mqtt 1.1.0` vẫn nằm trong component graph.
- Chỉ build, không flash/reset/erase, không mở carrier/socket/audio và không đổi
  Wi‑Fi/Tailscale. Kconfig warnings nền vẫn được giữ nguyên để xử lý riêng.

### Firmware MCP registry core — host/ESP-IDF build-only (2026-08-05)

- Thêm `veetee-firmware/main/veetee_mcp.[ch]`: registry descriptor/callback
  bounded, positive request-ID high-water, duplicate digest/cache 16 entry và
  session reset. Không hardcode tool/GPIO/broker/locale; cJSON/FreeRTOS/HAL
  integration còn deferred.
- Firmware host CTest **3/3**; ESP-IDF build **9/9**, binary `0x1593e0`, app
  partition **66%**. Đây chưa phải JSON-RPC/hardware MCP runtime acceptance.
- Không flash/reset/erase ESP32, không audio/carrier/socket, không đổi
  Wi‑Fi/Tailscale và không dùng production DB.

### M3 UDP sequence guard parity — host-only (2026-08-05)

- `UdpCryptoSession.decrypt()` từ chối sequence `0` ngay sau structural length
  validation, đồng nhất với firmware clear-header codec và tránh đưa packet bất
  hợp lệ vào stream barrier.
- Targeted UDP **18 passed**; full Voice Server **134 passed**, Ruff và
  compileall pass. Không mở broker/socket/carrier, không decode/play audio,
  không flash/reset ESP32 và không đổi Wi‑Fi/Tailscale.

### Local provider dependency repair và Voice recovery (2026-08-05)

- Restart Voice sau commit `8b20176` ban đầu fail vì môi trường `.venv` thiếu
  `onnxruntime`, `faster-whisper` và `vieneu`; lock cũ còn chọn `numba 0.53.1`
  không chạy trên Python 3.12. Đã regenerate `veetee-server/uv.lock` sang
  `numba 0.66.0`/`llvmlite 0.48.0`/`numpy 2.4.6` và sync đủ extras test + local.
- Import smoke và `_prepare_registry()` với Manager snapshot revision `87`
  pass; Voice transient `veetee-voice-18100.service` đã active lại. Readiness
  hiện tại: Voice `18100` revision `87`, Manager API `18101` revision `87`, Web
  `18181` HTTP `200`; `activationFailures=0`, `activeTurns=0`, metrics idle
  `protocol_errors=0`. `activeConnections` có thể thay đổi khi board tự
  reconnect và không phải physical audio acceptance.
- Voice Server regression **139 passed**, Ruff/compileall pass. Đây chỉ là
  host/runtime evidence; M0/M1 physical gates vẫn mở. Theo operator lock từ
  đây không phát audio hoặc mở serial audio cho tới khi được cấp quyền mới.

### Startup activation error boundary (2026-08-05)

- Voice runtime giờ fail-fast ngay khi activation đầu tiên không thành công,
  giữ nguyên last-known-good/cleanup semantics và báo type lỗi rõ ràng thay vì
  rơi xuống `runtime configuration is not ready` sau đó.
- Regression runtime **14 passed**, full Voice Server **140 passed**, Ruff và
  compileall pass. Source change chưa được physical/audio acceptance; khóa
  không phát audio và không mở serial audio vẫn giữ nguyên.

### MQTT control carrier adapter — host-only (2026-08-05)

- Thêm optional `aiomqtt 2.5.1` extra và `MqttControlCarrier`: connect,
  subscribe exact topic, bounded publish/incoming và cleanup cancellation; JSON
  decode/session/UDP vẫn do các primitive hiện hành xử lý.
- Fake carrier targeted **5 passed**, control/session targeted **29 passed**,
  full Voice Server **145 passed**, Ruff/compileall/lock check pass. Không kết
  nối broker, không mở UDP socket, không phát/thu audio và không đổi transport
  default (WS v3).

### Firmware transport init cleanup — build-only (2026-08-05)

- WebSocket transport giải phóng `EventGroup`/client trên mọi init error path;
  không thay đổi handshake, framing hay runtime state machine.
- Firmware host CTest **4/4 passed**; ESP-IDF 6.0.2 build pass, binary
  `0x159410`, app partition còn **66%**. Không flash/reset/erase, không serial
  audio, không phát/thu audio và không đổi Wi-Fi/Tailscale.

### Firmware MQTT/UDP AES parity — build-only (2026-08-05)

- Thêm `veetee_mqtt_udp_crypto` dùng PSA Crypto/mbedtls trên ESP-IDF và OpenSSL
  chỉ ở host oracle; clear header 16 byte được giữ nguyên và dùng làm CTR IV.
  Session reset wipe key/nonce, sequence bắt đầu từ 1 và chặn wrap/payload sai.
- Firmware host CTest **5/5 passed**; ESP-IDF 6.0.2 build pass, binary
  `0x159410`, app partition còn **66%**. Voice targeted UDP **18 passed**, full
  Voice **145 passed**; Manager API dedicated test DB **43/43**, lint/build/
  OpenAPI check pass.
- Đây chỉ là codec/golden evidence: không mở MQTT/UDP socket, không gọi provider,
  không phát/thu audio, không đọc serial audio, không flash/reset/erase ESP32,
  không đổi Wi-Fi/Tailscale và không mutate production `veetee_vubq`.

### Voice hello shape hardening — host-only (2026-08-05)

- `hello.features` hiện được kiểm tra là object khi field này được gửi; shape
  malformed bị đóng `1002` và không làm rơi exception trong event loop. Field
  vẫn optional cho peer cũ, wire hợp lệ và MCP discovery không đổi.
- Voice Server full suite **146/146**, Ruff và compileall pass. Không gọi
  provider/Groq, không phát/thu audio, không mở microphone/speaker/serial,
  không flash/reset/erase ESP32, không đổi Wi-Fi/Tailscale và không mutate
  production `veetee_vubq`.

### Audio permission reopened — bounded physical wake and interrupt checks (2026-08-05)

- Chủ dự án đã cấp lại quyền phát audio trực tiếp. Chỉ chạy hai scenario bounded,
  không flash/reset/erase và không thay đổi Wi-Fi/NVS/Tailscale:
  `wake-test.example.json` (một lượt normal) và `wake-barge-in.example.json`
  (một lượt interrupt bằng wake word).
- Normal pass: `wake detected → wake start → state=speaking → wake detector armed`;
  wake/utterance player đều exit `0`. Sau khoảng một giây Voice Server release turn;
  metrics cuối lượt `turn_admissions=1`, `turn_releases=1`, `protocol_errors=0`.
- Interrupt pass ở firmware: `wake detected → state=listening → wake interrupt →
  wake start`; player interrupt exit `0`, không có forbidden marker. Metrics cuối
  lượt `active_turns=0`, `turn_releases=3`, `protocol_errors=0`; lượt sau interrupt
  không có utterance nên `auto_no_speech_timeouts` tăng đúng theo policy.
- `barge_in_count=0` là expected cho scenario này: đó là counter server-side của
  acoustic voice-onset detector, còn evidence trên là wake-word interrupt từ
  firmware. Chưa dùng kết quả này để đóng acoustic AEC/time-to-silence gate.
- Report đã redact chỉ lưu ngoài repository tại `/tmp/veetee-wake-permission-recheck-20260805.json`
  và `/tmp/veetee-wake-barge-in-permission-20260805.json`; không lưu raw audio,
  microphone capture, transcript, serial dump hay credential.

### ws-v1 legacy sample-rate compatibility — host/build-only (2026-08-05)

- Source audit xác nhận peer cũ echo `client hello.audio_params` vào server hello;
  firmware Veetee trước đây reject 16 kHz server hello khi speaker config là
  24 kHz. Thêm helper protocol bounded: v1 chấp nhận Opus rate chuẩn khác local,
  v2/v3 vẫn strict và ws-v3 default không đổi.
- Host CTest **8/8 passed**; ESP-IDF 6.0.2 build-only pass, image `0x159600`,
  app partition còn **66%**. Không flash/reset/erase, không đọc serial/audio,
  không đổi Wi-Fi/NVS/Tailscale.
- Source-derived fixture/test kiểm tra hello, v1 raw, v2 16-byte, v3 4-byte và
  control omission: Voice Server **157 passed**, Ruff/compileall pass. Đây không
  phải real reference process/socket conformance; §11 checklist vẫn mở.

### WakeNet normal 10-repetition soak — physical (2026-08-05)

- `wake-test-10.local.json` đạt **10/10** lifecycle đầy đủ, player exit lỗi **0**,
  không có forbidden serial marker. Không flash/reset/erase, không đổi Wi-Fi/NVS/
  Tailscale hay runtime config.
- Sau khi lượt cuối drain, Voice metrics có `turn_admissions=13`,
  `turn_releases=13`, `active_turns=0`, `turn_rejections=0`,
  `protocol_errors=0`, `turn_count=12`. Đây là bằng chứng positive wake/lifecycle;
  100-repetition, acoustic AEC/voice-onset barge-in và cross-peer v1 socket vẫn mở.
- Report redact chỉ ở `/tmp/veetee-wake-10-permission-20260805.json`; không commit
  raw audio, microphone capture, transcript, serial dump hoặc credential.

### WebSocket hello timeout hardening — host-only (2026-08-05)

- Voice Server bọc lần `receive()` đầu tiên bằng timeout cấu hình
  `VEETEE_HELLO_TIMEOUT_MS` (mặc định 10.000 ms, bounded 1.000–60.000 ms).
  Peer đã upgrade nhưng không gửi client `hello` sẽ nhận close `1002`; session
  lease/provider runtime không được cấp và metric `hello_timeouts` tăng đúng một.
- Regression idle WebSocket, default/bound validation và malformed hello đều
  pass; wire shape khi hello hợp lệ không đổi.
- Đây là host-only transport hardening; không gọi provider/Groq, không phát/thu
  audio, không flash/reset/erase ESP32 và không đổi Wi-Fi/NVS/Tailscale.

### Voice runtime reload after host-only fix (2026-08-05)

- Đã kiểm tra unit `veetee-voice-18100.service` đúng checkout mới, `activeTurns=0`
  rồi graceful-restart để nạp commit `29e4783`; không restart Manager API/Web,
  không dừng PostgreSQL và không đổi listener/mạng.
- Voice readiness sau reload: HTTP `200`, revision `87`, `activationFailures=0`,
  `protocol_errors=0`, `audio_frames_in=0`, `audio_frames_out=0`; ESP32 tự
  reconnect lại với `active_connections=1` nhưng đây chỉ là presence/session
  evidence, không phải physical audio acceptance. API `18101` và Web `18181`
  tiếp tục HTTP `200`.
- Không phát audio/wake harness, không mở microphone/speaker/serial audio,
  không flash/reset/erase ESP32, không đổi Wi-Fi/Tailscale và không mutate
  production `veetee_vubq`.

### UDP datagram carrier boundary — host-only (2026-08-05)

- `veetee_server.udp_carrier.UdpDatagramCarrier` đã thêm asyncio UDP boundary
  có bind/peer config tường minh, packet ceiling theo UDP v3, queue bounded và
  lifecycle đóng/mở idempotent. Full encrypted/session/reorder semantics vẫn
  thuộc `mqtt_session`/`mqtt_udp`; Voice runtime không tự activate carrier và
  WebSocket v3 vẫn là default.
- Loopback test dùng byte giả lập để chứng minh send/receive, queue overflow,
  close sentinel và config fail-closed: carrier targeted **4/4** (lặp 5 lần),
  Voice Server **154 passed**, Ruff/compileall/`uv lock --check` pass.
- Không phát/thu audio, không mở microphone/speaker/serial audio, không flash/
  reset/erase ESP32, không đổi Wi-Fi/route/Tailscale, không mở broker và không
  mutate production database `veetee_vubq`. M3 live gateway, firmware carrier,
  real-network loss/latency và transport promotion vẫn mở.

### Firmware state-owner transition matrix — host/build-only (2026-08-05)

- Event admission trong `veetee_state.c` đã được tách khỏi target-state graph:
  stale `hello`, `listen/stop`, `abort` và `tts/stop` bị reject ở state không hợp
  lệ; không mutate state/generation. Delayed `tts/start` từ `idle` được cho phép
  theo `docs/06-firmware-design.md`; self-transition không tăng generation.
- Host test kiểm tra **5 × 10** state/event matrix; firmware CTest **8/8 passed**
  với `-Wall -Wextra -Werror -Wconversion -Wpedantic`. ESP-IDF 6.0.2 build-only
  pass, binary khoảng **1.414 MiB**, app partition còn khoảng **66%**.
- Không flash/reset/erase ESP32, không đọc serial audio, không phát/thu audio,
  không đổi Wi-Fi/NVS/route/Tailscale và không mutate production database.
  Physical M0 PTT/mic/speaker/LCD acceptance vẫn chờ operator cấp quyền.

### Audio test after hello-timeout reload — physical (2026-08-05)

- Sau khi reload `veetee-voice-18100.service` ở commit `8f769b4`, scenario
  `wake-test-normal.local.json` đạt **2/2** lượt normal wake. Mỗi lượt đủ
  `wake detected → wake start → state=speaking → wake detector armed`; wake và
  utterance player đều exit `0`, không có forbidden serial marker.
- Metrics sau khi lượt cuối drain: `active_turns=0`, `turn_admissions=2`,
  `turn_releases=2`, `protocol_errors=0`, `history_sent=2`. TTFA đo được giữa
  hai lượt là **1905 ms** và **1256 ms**; vì vậy lượt đầu vượt mục tiêu
  `<1500 ms`, chưa được coi là TTFA gate pass. Đây là measured runtime evidence,
  không phải benchmark p95.
- `wake-barge-in.example.json` đạt lifecycle interrupt: `wake detected →
  state=listening → wake interrupt → wake start`, interrupt player exit `0`,
  không forbidden marker. `barge_in_count=0` là expected vì clip thứ hai là
  wake-word interrupt phía firmware, chưa phải acoustic voice-onset barge-in.
- Sau interrupt, không phát utterance thứ hai nên `auto_no_speech_timeouts=1`
  là policy timeout đúng; cuối scenario `active_turns=0`,
  `turn_releases=4`, `protocol_errors=0`. Reports redact chỉ lưu ngoài Git:
  `/tmp/veetee-wake-normal-after-timeout-20260805.json` và
  `/tmp/veetee-wake-barge-after-timeout-20260805.json`.
- Không flash/reset/erase ESP32, không đổi Wi-Fi/NVS/NetworkManager/route/
  firewall/Tailscale và không ghi raw audio, microphone capture, transcript hay
  credential.

### Deployed handshake/no-speech verification — host + physical (2026-08-05)

- Read-only probe trên Voice Server đã reload: WebSocket idle không gửi hello
  nhận close `1002`; `hello_timeouts` tăng từ `0` lên `1`,
  `protocol_errors` giữ `0`, active connection không bị rò.
- `wake-test-no-speech.local.json` đạt lifecycle `wake detected → wake start →
  NO_SPEECH_TIMEOUT → wake detector armed`; clip im lặng exit `0`, không forbidden
  marker. Metrics sau scenario: `active_turns=0`, `turn_admissions=5`,
  `turn_releases=5`, `auto_no_speech_timeouts=2`, `protocol_errors=0`.
- Report redact ngoài Git: `/tmp/veetee-wake-no-speech-after-timeout-20260805.json`.
  Không flash/reset/erase, đổi Wi-Fi/NVS/Tailscale hoặc lưu raw audio/transcript.

### Progress acknowledgement TTS ownership — host-only (2026-08-05)

- Pipeline giữ một TTS lifecycle xuyên progress acknowledgement và answer: một
  `tts/start`, cờ ownership không bị mất, và terminal `tts/stop` vẫn phát khi LLM
  empty hoặc lỗi sau acknowledgement. Text acknowledgement và policy vẫn do
  runtime snapshot cấu hình, không hardcode provider/câu trả lời.
- Full Voice Server **163 passed**, Ruff/compileall pass; regression cover
  single-start/single-stop cho slow answer và empty LLM stream.
- Chưa reload/flash/audio trong slice này; cần graceful reload service sau commit,
  không đổi wire, Wi-Fi/NVS/Tailscale hoặc database.

### Progress acknowledgement deployment reload — host-only (2026-08-05)

- Voice service đã graceful-restart để nạp commit `4c27149`: readiness `200`,
  revision `87`, `activationFailures=0`, `activeTurns=0`; ESP32 tự reconnect,
  không reset. Manager API/Web và database không restart.
- Runtime snapshot hiện chưa publish `progress.acknowledgements`, nên không lặp
  physical audio chỉ cho ownership fix; audio gate trước đó giữ nguyên evidence.

### Progress acknowledgement owner controls — host-only (2026-08-05)

- Role Config có component `ProgressAcknowledgementSection` để owner chỉnh
  enabled/deadline/ID/message map; API giữ additive fields và validate boundary
  tương ứng. OpenAPI/generated client đã đồng bộ.
- Evidence: Manager API dedicated test DB **44/44**, Manager Web unit **95/95**,
  Chromium E2E **11/11**, typecheck/lint/build/OpenAPI pass. Không mutate
  production DB, không publish runtime, không đổi wire/provider fallback.

### Progress controls runtime reload — host-only (2026-08-05)

- API đã reload commit `b2ce1bc`, Voice reload sau đó để reset lỗi kết nối tạm
  thời; readiness API/Voice/Web đều `200`, Voice `activationFailures=0`,
  `activeTurns=0`, ESP32 tự reconnect không reset.
- Production role-config probe chỉ đọc: `progress.acknowledgements` hiện chưa
  được publish; không tự sửa DB hoặc runtime config.

### Physical wake soak re-check — quota and false-reject gates remain open (2026-08-05)

- Harness local đã đổi sang marker drain-aware (`graceful tts drain complete`
  rồi `wake detector armed model=...`) để không phát wake phrase chồng TTS;
  smoke mới đạt **2/2**.
- Production single-key soak đạt 20 lượt rồi dừng ở lượt 21 với
  `provider_error_LLM_RATE_LIMITED=1`. Fixture test-only với 4 key đạt 3 lượt,
  key ordinal 1→2→3; sau đó wake detector miss ở lượt 4, dù server/fixture
  không lỗi. Verbose fixture smoke tiếp theo đạt **2/2** và có mức mic hợp lệ.
- Kết luận: multi-key test harness hoạt động và production đã được restore, nhưng
  chưa có 100/100 wake pass. M1 vẫn mở các gate false-reject/false-accept,
  AEC/echo-only, voice-onset barge-in/time-to-silence, TTFA p95 và peer thật.
  Reports redact nằm ngoài Git tại `/tmp/veetee-wake-100-drain-aware-20260805.json`,
  `/tmp/veetee-wake-100-fixture-drain-aware-20260805.json` và
  `/tmp/veetee-wake-normal-fixture-verbose-20260805.json`.

### M0 PTT acceptance harness readiness (2026-08-05)

- PTT harness dry-run và unit suite **4/4** pass; firmware ESP-IDF build đúng
  môi trường **pass**, binary `0x159600`, app còn **66%**; firmware host CTest
  **8/8** pass.
- Harness chỉ quan sát GPIO0 qua serial monitor `--no-reset`; không mô phỏng nút,
  không gửi serial command, không đổi NVS/Wi-Fi. M0 physical DoD vẫn chờ operator
  giữ/nhả nút, nghe loa và nhìn LCD; không suy diễn build/host evidence thành
  acceptance vật lý.

### Latest real-audio run after wake pre-arm (2026-08-05)

- Dùng snapshot fixture ngoài Git + pool 4 Groq key **chỉ trong test**, sau đó đã
  restore Voice production Manager-source (không fallback/key rotation trong
  production). Scenario drain-aware normal đạt **2/2** lượt với VieNeu thật;
  report `/tmp/veetee-audio-normal-drain-multikey-20260805.json`.
- Một smoke trước đó dùng scenario không chờ playback drain: lượt 1 pass nhưng
  repetition 2 timeout ở `wake_detected` do phát wake khi TTS còn đang drain;
  report `/tmp/veetee-audio-normal-multikey-20260805.json`. Đã phân loại là
  lỗi timing của test scenario và chạy lại bằng drain-aware scenario, không đổi
  firmware hay hạ threshold.
- Mỗi lượt đạt `wake detected → wake start → state=speaking → playback drain →
  wake detector armed`; player exit `0`, không panic/stack/Opus marker. Metrics
  fixture cuối lượt: `active_turns=0`, `turn_admissions=2`,
  `turn_releases=2`, `protocol_errors=0`, `last_ttfa_ms=1461` (lượt cuối,
  chưa phải p95). Log test ghi key ordinal 1 và 2 thành công.
- Barge-in wake-word clip phát ngay sau `state=speaking` đạt
  `wake detected → state=listening → wake interrupt → wake start`; report
  `/tmp/veetee-audio-barge-immediate-multikey-20260805.json`. Đây là firmware
  wake-word control, `barge_in_count=0` đúng semantics của server acoustic
  realtime; `auto_no_speech_timeouts=1` là expected vì không có utterance sau
  interrupt.
- Production sau cleanup: Voice `18100` revision `87` ready, `active_turns=0`,
  `protocol_errors=0`, board `active_connections=1`/presence sent, API `18101`
  và Web `18181` HTTP 200. Không flash/reset/erase, đổi Wi-Fi/NVS/Tailscale,
  hoặc lưu raw audio/transcript/credential. Acoustic AEC/echo-only,
  voice-onset/time-to-silence và 100-repetition gates vẫn mở.

### Current audio permission run and harness timing guard (2026-08-05)

- Production revision `87` chạy normal wake **2/2** với audio thật qua loa máy;
  mỗi lượt đạt wake/capture/TTS/drain/re-arm, player exit `0`, không forbidden
  serial marker. Report: `/tmp/veetee-wake-audio-20260805-current-2.json`.
- Firmware wake interrupt **1/1** đạt đủ `wake detected → state=listening →
  wake interrupt → wake start`; report
  `/tmp/veetee-wake-barge-audio-20260805-current.json`. `barge_in_count=0`
  đúng semantics vì đây không phải server acoustic voice-onset; stale
  `tts/stop` warning bị barrier loại bỏ.
- Negative no-speech với monitor wait `5s` đạt wake/capture/
  `NO_SPEECH_TIMEOUT`/re-arm, report
  `/tmp/veetee-wake-no-speech-20260805-current-startup5.json`. Attempt wait
  `1s` timeout trước marker wake do monitor attach timing; không thấy
  crash/provider error. Scenario mẫu đã tăng wait lên `5s`.
- Physical harness suites `20 passed`; runtime sau cleanup: Voice/API/Web
  ready, `active_turns=0`, `protocol_errors=0`, board giữ kết nối. Không flash,
  reset, erase NVS, đổi Wi-Fi/route/Tailscale hay lưu raw audio/transcript/key.
  PTT/LCD/loa xác nhận vật lý, acoustic AEC/time-to-silence, false
  accept/reject, 100-repetition và TTFA p95 vẫn chưa đóng.

### Acoustic duplex direct voice-onset probe (2026-08-05)

- Fixture `/tmp` revision `900` bật `bargeIn.deviceDuplex=true`, dùng pool 4
  Groq key test-only, history/presence tắt. Audio thật qua loa xác nhận
  `acoustic duplex capture enabled while server is speaking` → `state=listening`
  → `acoustic barge-in committed; capture kept for new auto turn`; report
  `/tmp/veetee-acoustic-duplex-current-20260805.json`.
- Sau commit đầu, residual echo/feedback tạo loop: `barge_in_count=10`,
  `turn_admissions=11`, `turn_releases=10`, `active_turns=1`; fixture đã dừng
  ngay để không phát lặp. Đây là **fail của quality/promotion gate**, không phải
  crash; cần AEC reference alignment + echo-only corpus + rearm/loop guard
  config-driven trước khi bật acoustic duplex production.
- Đã restore Voice Manager-source revision `87`, reset board bằng
  `esptool chip-id --after hard-reset` (không flash/erase/NVS). Sau cleanup
  Voice/API/Web ready, board `activeConnections=1`, `activeTurns=0`,
  `protocol_errors=0`. M0/M1 physical PTT/LCD/loa, acoustic time-to-silence,
  false accept/reject và 100-repetition vẫn mở.

### Acoustic rearm cooldown guard (2026-08-05)

- `bargeIn.cooldownMs` đã được implement additive ở server/config, API/OpenAPI,
  Manager Web và `tts/start.barge_in.cooldown_ms`; bounded `0..5000`, default
  half-duplex `0`, duplex `2000`. ADR: [`ADR-027`](../ADR/ADR-027-acoustic-barge-in-rearm-cooldown.md).
- Regression: Voice **172 passed**, Manager API **45 (33 pass/12 PostgreSQL
  skip)** + OpenAPI check, Web **96 unit** + typecheck/lint/build pass.
- Physical A/B cooldown `2000 ms` chạy control markers và sau 25 giây đạt
  `barge_in_count=2`, `turn_admissions=3`, `turn_releases=3`,
  `active_turns=0`; baseline trước guard đã loop `10/11/10`, active turn `1`.
  Report `/tmp/veetee-acoustic-duplex-cooldown-20260805.json`. A/B `5000 ms`
  inconclusive vì wake false-reject trước stage barge.
- Production revision `87` đã restore, board `activeConnections=1`, health
  Voice/API/Web `200`, không DB/network/NVS mutation. Guard giảm loop nhưng
  acoustic voice-onset, false accept/reject, time-to-silence và production
  promotion vẫn **mở**.

### Audio permission — direct physical verification and Groq test pool (2026-08-05)

- Production audio smoke `/tmp/veetee-wake-audio-20260805.json` đã phát wake và
  utterance tới `state=speaking`; fail cuối chỉ do scenario cũ chờ marker
  `wake capture complete` thay vì marker hiện tại `wake detector armed`.
- Scenario drain-aware production `/tmp/veetee-wake-normal-audio-20260805.json`
  hoàn tất lượt 1, còn lượt 2 dừng trước `state=speaking` với
  `provider_error_LLM_RATE_LIMITED=1`; đây là single-secret quota evidence,
  không phải board/audio crash.
- Snapshot fixture ngoài Git revision `9001` với Silero VAD local, ASR/TTS
  deterministic và `VEETEE_TEST_GROQ_KEYS_FILE=secrets/groq.keys` được chạy
  physical **2/2** tại cùng port. Report
  `/tmp/veetee-wake-groq-pool-silero-20260805.json`: đầy đủ wake/capture/TTS/
  drain/re-arm, player exit `0`, không forbidden marker. Voice log xác nhận
  key ordinal `1` rồi `2` thành công; metrics cuối `turn_admissions=2`,
  `turn_releases=2`, `active_turns=0`, `protocol_errors=0`,
  `last_ttfa_ms=276` (fixture tone, không dùng làm TTFA p95).
- Một fixture thử Energy VAD trước đó giữ turn lease vì không endpoint trong
  cửa sổ harness; đã dừng và thay bằng Silero cho bài kiểm tra key-pool. Không
  sửa production snapshot/DB, không commit snapshot/key/raw audio; production
  Manager-source revision `87` đã restore và board `activeConnections=1`.
- Kiểm tra sau cleanup: Voice full suite **172 passed**, Manager Web Chromium
  E2E **11 passed**, firmware host CTest **8/8 passed**. Các gate acoustic
  echo-only/voice-onset, time-to-silence, false accept/reject, 100 repetition,
  PTT/LCD/loa physical và TTFA p95 vẫn chưa đóng.

### AEC reference alignment baseline (2026-08-05)

- Firmware có `veetee_aec_reference.c` thuần C cho resample 24k→16k, delay gate
  cấu hình `CONFIG_VEETEE_AEC_REFERENCE_DELAY_MS=80` (range `0..500`) và
  bounded ring counters. Underrun zero-fill, overrun drop-oldest; reset xóa
  depth nhưng giữ counters trong boot. Diagnostics không ghi raw PCM.
- Host firmware CTest **9/9 passed** (thêm `aec_reference`); ESP-IDF 6.0.2
  build pass, binary `0x159eb0`, app còn 66%. Image đã flash/verify hash,
  không erase NVS và không đổi Wi-Fi.
- Spec: [`2026-08-05-aec-reference-alignment-design.md`](../superpowers/specs/2026-08-05-aec-reference-alignment-design.md).
  Echo-only physical, false accept/reject, voice-onset/time-to-silence và
  acoustic production promotion vẫn chưa đóng.

### Bounded physical echo-only after AEC alignment (2026-08-05)

- Fixture revision `9001` ngoài Git (Silero VAD, ASR fixture, TTS tone, test-only
  Groq key pool) chạy **2/2** lượt với `deviceDuplex=true`; report
  `/tmp/veetee-aec-echo-only-20260805.json`, serial `/tmp/veetee-aec-echo-only-stdout.log`.
  Mỗi lượt có đủ wake/capture/TTS/drain/re-arm và thêm 5 nhịp quan sát sau re-arm.
- Không thấy echo retrigger: serial đúng 2 `wake detected`, 2 `wake start`, 2
  `state=speaking`, 0 `wake interrupt`; Voice metrics cuối fixture
  `turn_admissions=2`, `turn_releases=2`, `active_turns=0`,
  `protocol_errors=0`, `barge_in_count=0`. AEC stats có producer/consumer
  và delay `1280` samples; underrun/overrun vẫn cần sizing study.
- Có 6 cảnh báo `ws-client` lock timeout 500 ms trong duplex capture; không có
  forbidden firmware marker và không làm hỏng lifecycle, nhưng gate transport
  contention/real-ASR packet integrity vẫn mở. Đây là bounded diagnostic pass,
  **không** phải promotion cho voice-onset, time-to-silence hoặc duplex mặc định.
- Sau cleanup Voice Manager-source revision `87` ready, board
  `activeConnections=1`, `activeTurns=0`, API/Web ready; không mutate
  database/NVS/Wi-Fi/Tailscale.
