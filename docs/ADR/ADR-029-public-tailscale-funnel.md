# ADR-029: Public HTTPS bằng Tailscale Funnel

## Status

Accepted — 2026-08-05 theo yêu cầu mới nhất của chủ dự án. Supersedes phần
private overlay của [ADR-012](ADR-012-private-tailscale-serve.md); Serve vẫn
là phương án fallback khi không muốn public exposure.

## Context

Chủ dự án cần mở Manager Web từ trình duyệt không cài/không bật Tailscale để
kiểm tra. `tailscale serve` chỉ cho phép peer trong tailnet, vì vậy hostname
không truy cập được từ Internet. Tailscale Funnel cung cấp TLS public trên
cùng hostname `veetee.tail52a635.ts.net` và vẫn proxy vào một origin duy nhất.

## Options

1. Giữ private Serve và yêu cầu mọi client đăng nhập tailnet.
2. Port-forward/NAT tự quản lý certificate và reverse proxy.
3. Tailscale Funnel public, giữ các process Veetee bind loopback và chỉ expose
   proxy HTTPS.

## Decision

Chọn option 3:

- Funnel map `/` tới Manager Web `127.0.0.1:18181`; API và WebSocket tiếp tục đi
  qua path proxy `/api/v1`, `/openapi.json` và `/veetee/v1/`.
- Không mở trực tiếp port `18100`, `18101`, `18181` ra LAN/Internet và không đổi
  Wi-Fi, route, NetworkManager hoặc firmware endpoint.
- Manager API chạy `VEETEE_AUTH_MODE=local`; password hash chỉ đọc từ secret
  file owner-only, session dùng opaque cookie + CSRF/Origin gate.
- Vite nhận hostname qua `VEETEE_WEB_ALLOWED_HOSTS`; đổi domain chỉ sửa runtime
  config, không sửa source.
- Không dùng Funnel cho ESP32. Firmware vẫn kết nối Voice Server qua WS LAN.

## Consequences

### Tích cực

- Người dùng có thể mở `https://veetee.tail52a635.ts.net/` từ Internet mà không
  cần Tailscale client.
- Tailscale/Let's Encrypt quản lý certificate; không cần port-forward hoặc
  certificate tự ký.
- Cùng-origin path routing giữ cookie, CORS và WebSocket proxy đơn giản.

### Tiêu cực và biện pháp

- Endpoint là public; mọi request đi qua Internet và chịu giới hạn/availability
  của Funnel. Auth local là bắt buộc, không được đổi về `disabled` khi Funnel
  đang bật.
- Không lưu password/hash trong Git, log, browser storage hoặc docs. Tắt public
  exposure bằng `tailscale funnel --https=443 off` khi không cần kiểm tra.
- Các health/database/secret route không được thêm vào Vite proxy.

## Verification / rollback

```bash
tailscale funnel status --json
curl -fsSIL https://veetee.tail52a635.ts.net/
```

Rollback về private overlay: chạy `tailscale funnel --https=443 off`, sau đó
`tailscale serve --bg 18181`; giữ nguyên auth local.
