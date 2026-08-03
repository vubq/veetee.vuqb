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
