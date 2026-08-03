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

## PostgreSQL riêng cho Veetee

Veetee không dùng PostgreSQL/data directory/port của bất kỳ project khác. Trên
Ubuntu, stage binary vào `.runtime` (không cài system service và không Docker):

```bash
python3 tools/runtime/bootstrap_postgres.py
```

Manifest `host-native-postgres-dev.json` chạy instance riêng ở
`127.0.0.1:55432`, data directory `.runtime/veetee-postgres-data` và database
`veetee_vubq`. File bootstrap DSN là `secrets/manager.database-url` (owner-read,
ignored); migration là one-shot trước khi Manager API khởi động.

```bash
python3 tools/runtime/veetee_runtime.py \
  --manifest tools/runtime/manifests/host-native-postgres-dev.json \
  --once
```

Instance này chỉ bind loopback. Không đổi route/Wi-Fi hoặc listener `5432` của
service khác.
