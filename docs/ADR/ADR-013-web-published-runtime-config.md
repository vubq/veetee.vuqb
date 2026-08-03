# ADR-013: Web-published runtime configuration, không hard-code vận hành

## Status

Accepted

## Context

Chủ dự án cần thay provider và cấu hình robot bằng Manager Web, không chỉnh `.env`
hoặc restart mỗi lần. Code phải AI-first/config-driven: prompt, personality,
locale, voice, provider, model, endpoint và policy cần thay đổi được bằng dữ liệu
đã validate.

## Options

1. Cấu hình compile-time hoặc `.env`, đổi xong restart service.
2. Mutable global config trong memory, không revision/rollback.
3. Web → API tạo immutable revision; API probe/publish; runtime nhận snapshot và
   activate atomic tại safe boundary.

## Decision

Chọn option 3. `.env` chỉ giữ bootstrap/secret locations/bind. Manager Web dùng
JSON Schema của provider manifest để render form; API validate ownership, schema,
secretRef, capability và resource trước publish. Voice Server poll/subscribe
published revision qua machine-auth, warm provider generation rồi swap atomically.
Session đang chạy pin revision cũ; turn mới dùng revision mới. Firmware nhận
device/runtime snapshot tương tự nhưng board pin map vẫn là signed board manifest,
không phải GPIO tuỳ ý từ UI.

## Consequences

- Đổi config thường không cần restart và mọi hành động có audit/revision/ETag.
- Cần cache last-known-good, activation job, readiness và UI hiển thị trạng thái.
- Model/provider cài mới vẫn có thể cần bounded job; không tải model trong turn.
- Config activation rollback được phép; runtime provider fallback vẫn bị cấm.
