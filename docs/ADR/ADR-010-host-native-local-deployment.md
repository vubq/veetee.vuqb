# ADR-010: Host-native local deployment, không dùng container

## Trạng thái

Accepted — 2026-08-03 theo quyết định của chủ dự án.

## Context

Veetee chạy trên chính máy Ubuntu 24.04 có GPU NVIDIA 4 GB. Chủ dự án yêu cầu
runtime local không dùng Docker. Bốn component vẫn phải build/release/rollback độc
lập, nhưng driver CUDA/ONNX, PostgreSQL, Node và static web đều do host quản lý.

## Decision drivers

- Không Docker/Compose trong local runtime.
- Ít lớp ảo hóa và dễ profile GPU/audio/process trực tiếp.
- Startup/restart/log/secret có lifecycle rõ, không phụ thuộc terminal mở.
- Component và data directory vẫn tách để nâng cấp/rollback độc lập.
- M0/M1 không bị control plane/PostgreSQL chặn.

## Các phương án

### A. Host-native packages + versioned environments + systemd

- Python dùng pinned virtual environment; Node dùng lockfile/build artifact;
  PostgreSQL và reverse proxy là host service.
- Ưu: đúng yêu cầu, truy cập driver trực tiếp, ít moving part, log/restart chuẩn.
- Nhược: operator phải quản lý package/version/permission trên host.

### B. Docker Compose cho control plane, voice host-native

- Ưu: đóng gói DB/API/Web dễ.
- Nhược: trái quyết định local không Docker, có hai lifecycle vận hành.

### C. Tất cả chạy foreground bằng dev command

- Ưu: bring-up rất nhanh.
- Nhược: không có restart/start order/log rotation/readiness ổn định; không phù hợp
  soak hoặc dùng hằng ngày.

## Quyết định

Chọn **A**:

1. Không tạo Dockerfile, Compose file, container image hoặc container-only runbook
   trong baseline. Muốn thay đổi phải có ADR superseding và chủ dự án duyệt.
2. M0 có thể chạy foreground bằng documented task runner để debug; acceptance/soak
   từ M1 dùng host service supervisor.
3. Voice Server dùng pinned Python 3.12 environment và host CUDA/ONNX runtime.
4. Manager API dùng current supported Node LTS, lockfile và compiled release
   artifact; không chạy TypeScript source trực tiếp trong stable service.
5. Manager Web build thành immutable static assets; host reverse proxy phục vụ
   web và proxy `/api`, không cần SSR runtime.
6. PostgreSQL chạy host-native, chỉ listen loopback; migration là one-shot command
   trước API readiness và không tự chạy cạnh tranh từ nhiều process.
7. Mỗi service có explicit env schema, absolute data/cache/config paths, read-only
   secret file/OS credential, structured journal log và graceful shutdown.
8. `voice-dev` M0/M1 dùng config fixture nên không cần Manager/PostgreSQL. Từ M2,
   control plane được bật host-native theo dependency order.

## Consequences

### Tích cực

- CUDA/VRAM/audio profiling phản ánh đúng host và không có container toolkit gap.
- Ít service abstraction hơn, phù hợp một máy cá nhân.
- systemd/journal cung cấp restart, startup order và log rotation có sẵn.

### Tiêu cực

- Cần script/runbook idempotent cho host prerequisites và permission.
- Package upgrade của host có thể gây drift nếu không pin/record manifest.
- Backup phải bao phủ PostgreSQL và data directories ngoài source tree.

### Guardrails

- Không dùng global `pip install`; Python environment riêng và lock/hash bắt buộc.
- Không dùng `npm install` tùy tiện ở stable release; dùng lockfile-clean install.
- Không bind PostgreSQL/model/metrics ra LAN.
- Service không chạy root; writable path allowlist và permission test bắt buộc.
- Upgrade runtime/driver chỉ promote sau build, contract, benchmark và soak; có
  release manifest cùng restore/rollback procedure.

## Verification

- [ ] Clean-host runbook dựng được M0 mà không gọi Docker/Podman/containerd.
- [ ] Reboot host đưa required service về healthy đúng dependency order.
- [ ] Voice process thấy đúng CUDA execution provider/VRAM và giữ TTFA gate.
- [ ] Manager Web/API/PostgreSQL chỉ expose các port đã định.
- [ ] SIGTERM graceful; không còn session/task/fd hoặc migration cạnh tranh.
- [ ] Runtime/service/package versions xuất hiện trong evidence manifest.
- [ ] Static scan không có Dockerfile/Compose/container command trong baseline.

## Liên quan

- [09-deployment.md](../09-deployment.md)
- [ADR-002](./ADR-002-hybrid-local-first.md)
- [ADR-008](./ADR-008-postgresql-without-redis-baseline.md)
