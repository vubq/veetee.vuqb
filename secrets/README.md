# Local secrets

Các secret chỉ tồn tại trên máy chạy thử, không nằm trong Git.

1. Sao chép `groq.keys.example` thành `groq.keys`.
2. Mỗi dòng đặt một Groq API key; có thể dùng `KEY=value` hoặc chỉ `KEY`.
3. Đặt quyền đọc cho owner (`chmod 600 secrets/groq.keys`).
4. Test-only Voice Server đọc file qua biến `VEETEE_TEST_GROQ_KEYS_FILE` khi
   chạy `VEETEE_CONFIG_SOURCE=fixture`; không in giá trị key.

Danh sách này chỉ để kiểm thử giới hạn free-tier. Runtime production không xoay
key và không coi danh sách này là provider fallback. Test pool chỉ thử key tiếp
theo khi request trước nhận `429` trước token đầu tiên; nếu stream đã phát một
phần thì không replay để tránh đọc trùng câu.
