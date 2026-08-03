# ADR-011: Host-native runtime supervisor cho toàn bộ server stack

## Status

Accepted

## Context

Veetee chạy trên một máy Ubuntu cá nhân và cần được kiểm tra xuyên suốt quá trình
thực hiện. Voice Server, Manager API, Manager Web và PostgreSQL phải có trạng thái
readiness rõ ràng; local baseline không dùng Docker/Compose.

## Options

1. Chạy từng lệnh thủ công trong nhiều terminal.
2. Dùng manifest + supervisor host-native, giữ process group, dependency,
   readiness và graceful shutdown.
3. Thêm container/orchestrator.

## Decision

Chọn option 2. Supervisor đọc manifest/config do operator cung cấp, khởi động
dependency theo thứ tự, poll health endpoint, restart bounded theo policy và tạo
redacted runtime report. Không tự fallback provider/model; không nhận shell command
do UI sinh ra.

## Consequences

- M0 có health contract của toàn stack trong khi audio critical path độc lập.
- Cần test signal, log redaction và graceful shutdown của supervisor.
- PostgreSQL thiếu thì Manager API báo `not_ready`, không tự tạo container hoặc
  silently chuyển sang SQLite.
