# ADR-012: Dùng Tailscale Serve private cho HTTPS kiểm tra

## Status

Superseded — 2026-08-05 by [ADR-029](ADR-029-public-tailscale-funnel.md).
Serve private remains the rollback option when public exposure is disabled.

## Context

Chủ dự án cần URL HTTPS dạng hostname tailnet để kiểm tra server. Ràng buộc là AI
không được thay đổi kết nối mạng Wi-Fi của máy tính và không được mở public exposure.

## Options

1. Port-forward/NAT public và tự quản lý certificate.
2. Tailscale Funnel public.
3. Tailscale Serve private trong tailnet, chỉ sau khi operator cài/enable.

## Decision

Chọn option 3. AI chỉ dùng `tailscale status`/`serve status` và `tailscale serve`
khi binary đã có, tailnet đã đăng nhập và operator đã yêu cầu expose. Không chạy
`tailscale up`, không Funnel, không đổi NetworkManager.

## Consequences

- HTTPS hostname/CA do Tailscale cấp và phải lấy từ command output, không hard-code.
- Chỉ thiết bị/peer trong tailnet truy cập được.
- Một origin duy nhất được dùng để tránh tạo hostname con không có certificate:
  `/` tới Manager Web, `/api/v1` và `/openapi.json` qua Vite tới Manager API,
  `/veetee/v1/` qua WebSocket proxy tới Voice Server. Các process vẫn bind
  loopback/LAN theo deployment port plan.
- ESP32 cần trust/certificate strategy riêng; dashboard URL không tự dùng được làm
  firmware endpoint.
- Nếu host chưa có Tailscale, deployment vẫn chạy LAN/loopback và ghi rõ block.
