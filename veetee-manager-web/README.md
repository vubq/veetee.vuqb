# Veetee Manager Web

UI có hai chế độ. Không đặt `VITE_MANAGER_API_URL` thì giữ preview fixture để
review visual; đặt biến này khi chạy cùng Manager API thì các form assistant,
role, provider/model-memory và voice đọc/ghi qua HTTP API với ETag. UI không truy
cập database, giữ secret hoặc chứa business prompt/provider vendor trong source.

## Yêu cầu

- Node.js `>=22.12`
- npm `>=11`
- Ubuntu host-native; không cần và không dùng container

## Chạy để xem

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

Production-like local API mode:

```bash
VITE_MANAGER_API_URL=http://127.0.0.1:18101 npm run dev -- --host 0.0.0.0
```

Khi chạy qua runtime canonical, mở `https://veetee.tail52a635.ts.net/`; Web
dùng cùng origin cho `/api/v1` và `/veetee/v1` (WebSocket), không cần hostname
cũ hoặc cổng public riêng.

Hostname HTTPS được truyền qua `VEETEE_WEB_ALLOWED_HOSTS` (danh sách phân tách
bằng dấu phẩy). Runtime manifest canonical đã khai báo hostname hiện tại; khi
đổi origin chỉ cần cập nhật deployment config, không sửa Vite source.

Vite sẽ in URL local và LAN thực tế. Các route chính:

- `/assistants`
- `/assistants/:id/config/role`
- `/assistants/:id/config/model-memory`
- `/assistants/:id/devices`
- `/_preview/components` (chỉ có trong development)

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

Khi không có API, mọi mutation trong preview chỉ tồn tại trong memory. Dùng nút
**Đặt lại dữ liệu mẫu** để khôi phục fixtures xác định. Khi có API, save/publish
đi qua config revision; đổi provider/model/prompt không cần sửa `.env` hoặc restart
Voice Server.
