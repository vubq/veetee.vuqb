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
  retention bằng typed ETag mutation. Tắt transcript tự gửi `transcriptDays=null`;
  audio recording luôn disabled và payload bị khóa ở `captureAudio=false`,
  `audioDays=null` cho tới khi artifact audio được hỗ trợ/promote.
- Offline, stale revision và validation không làm mất draft; lỗi được focus,
  announce bằng `role=alert` và toast. Preview `MockGateway` lưu policy/revision
  riêng, không chạm API/database thật.
- Web verification: typecheck, lint, production build, unit **79/79** và
  Chromium E2E **9/9**; axe serious/critical gate pass. Không gọi Groq, không
  phát audio, không mở microphone/speaker, không flash/reset firmware, không đổi
  Wi-Fi/Tailscale hoặc mutate `veetee_vubq`.
