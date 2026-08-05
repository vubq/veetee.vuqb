# Host-native runtime supervisor

`veetee_runtime.py` chạy các process product theo manifest, không dùng Docker và
không nhận shell string. Manifest chỉ định command argv, cwd, dependency, env
allow-list và health URL. Supervisor dùng readiness graph, giữ process group và
graceful shutdown. Các giá trị như port/path/provider vẫn ở manifest/env, không ở
domain code.

```bash
python3 tools/runtime/veetee_runtime.py \
  --manifest tools/runtime/manifests/host-native-dev.json \
  --once
```

`--once` start + health-check rồi giữ process đến SIGINT; dùng khi muốn chạy
server xuyên suốt phiên kiểm thử. Không chạy lệnh này nếu chưa muốn mở service.

Supervisor tự bổ sung Node bin vào `PATH` cho service không tương tác: ưu tiên
`VEETEE_NODE_BIN`, sau đó Node đã có trong PATH, rồi thư mục nvm dưới
`$HOME/.nvm/versions/node/*/bin` (chọn version semantic lớn nhất có `npm`). Vì vậy
user-systemd không cần dựa vào shell profile; deployment production vẫn nên đặt
`VEETEE_NODE_BIN` rõ ràng trong unit/environment của máy.

## Bounded restart policy

Service dài hạn có thể khai báo policy explicit trong manifest:

```json
{
  "restartPolicy": {
    "maxAttempts": 3,
    "windowSeconds": 60,
    "backoffSeconds": 2
  }
}
```

`maxAttempts=0` là mặc định và giữ process chết để operator kiểm tra. Supervisor
chỉ monitor/restart khi `--once` đang giữ vòng chạy; mỗi attempt nằm trong
`windowSeconds` và chờ `backoffSeconds`. Policy bị giới hạn bounded, không nhận
shell command, và `waitForExit=true` luôn bị cấm restart để migration/seed lỗi
không bị lặp âm thầm. Exit code/restart count được đưa vào status report, không
ghi command hoặc secret.

## PostgreSQL riêng cho Veetee

Veetee không dùng PostgreSQL/data directory/port của bất kỳ project khác. Trên
Ubuntu, stage binary vào `.runtime` (không cài system service và không Docker):

```bash
python3 tools/runtime/bootstrap_postgres.py
```

Tạo material cho encrypted local secret store (không in giá trị):

```bash
python3 tools/runtime/bootstrap_manager_secrets.py
```

Manifest `host-native-postgres-dev.json` chạy instance riêng ở
`127.0.0.1:55432`, data directory `.runtime/veetee-postgres-data` và database
`veetee_vubq`. File bootstrap DSN là `secrets/manager.database-url` (owner-read,
ignored). Material `secrets/manager.secret` cũng owner-read/ignored; migration là
one-shot trước khi Manager API khởi động.

Manifest cũng chạy one-shot `veetee-machine-token`, gọi
`ensure_secret.py` để tạo `secrets/manager.machine-token` với mode `0600` nếu
chưa có. API và Voice Server dùng cùng bearer file cho internal runtime,
conversation, pairing và presence routes; giá trị token không được in hoặc
commit. Chỉ fixture/memory test mới được bật explicit
`VEETEE_ALLOW_INSECURE_LOCAL_CONFIG=true`.

```bash
python3 tools/runtime/veetee_runtime.py \
  --manifest tools/runtime/manifests/host-native-postgres-dev.json \
  --once
```

Instance này chỉ bind loopback. Không đổi route/Wi-Fi hoặc listener `5432` của
service khác.

## Realtime Lab host-only

Đo synthetic TTFA mà không phát âm thanh và không mở serial/ESP32:

```bash
PYTHONPATH=veetee-server/src \
  veetee-server/.venv/bin/python tools/runtime/realtime_lab.py \
  --url ws://127.0.0.1:18100/veetee/v1/ \
  --wav tools/physical/local-utterance-vi.wav \
  --turns 3 --warmup-turns 1 \
  --report /tmp/veetee-realtime-lab.json
```

Tool chỉ ghi event shape, số packet và timing; không ghi transcript, prompt,
credential hay raw audio vào report. `--warmup-turns` bị loại khỏi p50/p95;
default gate là warm p95 ≤ 1.500 ms và mỗi turn phải có `tts.start`, binary
packet, `tts.stop`, không có protocol error.

Lab có thể chạy explicit từng WebSocket wire profile để conformance với peer
ngoài; tool không tự sniff hoặc downgrade profile:

```bash
PYTHONPATH=veetee-server/src \
  veetee-server/.venv/bin/python tools/runtime/realtime_lab.py \
  --url ws://127.0.0.1:18100/veetee/v1/ \
  --profile 1 --turns 1 --warmup-turns 0 \
  --wav tools/physical/local-utterance-vi.wav \
  --report /tmp/veetee-conformance-v1.json
```

`--profile 1` dùng raw Opus, `2` dùng header 16-byte và `3` dùng header
4-byte; header version, hello version và `Protocol-Version` đều lấy từ cùng
tham số. Kết quả chạy với Voice Server Veetee là host evidence; chỉ được ghi
conformance hai repo sau khi endpoint thật của peer tham chiếu cũng pass cùng
fixture.
