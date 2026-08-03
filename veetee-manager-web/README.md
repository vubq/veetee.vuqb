# Veetee Manager Web — UI preview

Đây là bản xem trước giao diện chạy hoàn toàn bằng mock data. Ứng dụng chưa gọi
Manager API, Voice Server, database hoặc firmware.

## Yêu cầu

- Node.js `>=22.12`
- npm `>=11`
- Ubuntu host-native; không cần và không dùng container

## Chạy để xem

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

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

Mọi mutation trong preview chỉ tồn tại trong memory. Dùng nút **Đặt lại dữ liệu
mẫu** để khôi phục fixtures xác định.

