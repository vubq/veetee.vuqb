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
