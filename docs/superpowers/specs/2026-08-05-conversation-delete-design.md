# Conversation delete design

## Mục tiêu

Cho Owner xóa một conversation đã lưu từ Manager Web/API mà không chặn request
trên việc dọn dữ liệu. Dữ liệu transcript/tool metadata và mọi artifact tương
lai phải được xóa theo cùng một job; baseline hiện không lưu audio.

## Phạm vi

- `DELETE /api/v1/conversations/{id}` tạo hoặc trả lại một delete job theo
  `(ownerId, conversationId)`.
- `GET /api/v1/retention-delete-jobs/{jobId}` đọc trạng thái job theo owner.
- Worker trong Manager API thực thi job bounded, idempotent và không retry vô
  hạn. Job có thể được gửi lại bằng DELETE nếu lần trước ở trạng thái `failed`.
- Conversation bị xóa khỏi bảng chính trong transaction; một tombstone không
  chứa transcript/device identity được giữ trong một khoảng cấu hình để các
  read/export cũ trả `410 RETENTION_EXPIRED` thay vì mơ hồ `404`.
- Tombstone hết hạn được dọn trong retention sweep. Job record vẫn giữ metadata
  trạng thái để retry/idempotency và audit.

Không nằm trong slice này: bulk archive, legal hold, object storage, audio
recording, khôi phục conversation hoặc thay đổi wire protocol/firmware.

## Luồng

1. Browser gửi DELETE với session + CSRF hiện có.
2. Store kiểm tra owner scope. Nếu conversation còn tồn tại, tạo job `queued`
   (unique theo owner/conversation) và trả `202`.
3. API schedule một task duy nhất cho job. Task chuyển `queued → running`, rồi
   trong transaction chèn tombstone và xóa conversation (FK cascade xóa turns).
4. Task ghi `completed` hoặc `failed`; mọi lần DELETE lặp lại trả cùng job, còn
   job failed được reset về `queued` tối đa số lần retry cấu hình trong Store.
5. GET detail/export thấy tombstone còn hạn của đúng owner thì trả `410` với
   code `RETENTION_EXPIRED`; owner khác vẫn chỉ thấy `404`.

## Contract

```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "status": "queued|running|completed|failed",
  "requestedAt": "RFC3339",
  "startedAt": "RFC3339|null",
  "completedAt": "RFC3339|null",
  "errorCode": "string|null"
}
```

DELETE trả `202 RetentionDeleteJob`. GET job trả `200`; job không thuộc owner
trả `404`. Conversation detail/export trả `410 RETENTION_EXPIRED` trong
tombstone window và `404` sau khi tombstone đã dọn.

## Dữ liệu và invariants

- `retention_delete_job` có unique `(owner_id, conversation_id)` và `attempts`.
- `conversation_tombstone` có primary key `conversation_id`, chỉ lưu owner,
  deleted/expires timestamps, reason và delete job id.
- Không lưu `deviceKey`, transcript, prompt, audio hay secret vào tombstone/job.
- Delete transaction khóa job/conversation theo thứ tự cố định; nếu conversation
  đã bị retention purge thì job được hoàn tất idempotently từ tombstone hiện có.
- Tombstone TTL lấy từ `VEETEE_RETENTION_TOMBSTONE_SECONDS`, mặc định 604800 s,
  bounded bởi config schema; TTL không hard-code trong UI.

## UI

History detail có nút `Xóa conversation` dùng `VtDialog` xác nhận. Trong lúc job
đang queued/running nút bị khóa và hiển thị trạng thái. Khi completed, item bị
loại khỏi list và detail đóng; khi offline/conflict/410, lỗi được announce bằng
`role=alert`, không mất selection cho tới khi có kết quả rõ ràng.

## Kiểm thử

- API InMemory: owner scope, idempotent repeat, failed retry, tombstone 410/404,
  bounded purge.
- PostgreSQL test DB riêng: migration, FK cascade, concurrent repeat, restart
  persistence của job/tombstone.
- Web HTTP gateway + MockGateway + feature unit/E2E: confirm, loading, success,
  offline và 410/a11y.
- Không gọi Groq, không mở audio/mic/serial, không flash/reset firmware.
