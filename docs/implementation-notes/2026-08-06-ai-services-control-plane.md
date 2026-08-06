# AI Services control plane — 2026-08-06

## Phạm vi

Điều chỉnh Manager Web thành một khu vực `Dịch vụ AI` thống nhất, theo mental
model của source tham khảo: overview → model configuration → provider schema →
voice catalog. Thay đổi này chỉ chạm control-plane UI và tính nhất quán của
InMemory model-default mutation; không thay đổi WebSocket, audio pipeline,
provider runtime adapter, firmware hay wire protocol.

## Stack mặc định phải giữ nguyên

Các model đã kiểm thử trước đó vẫn là default và enabled:

| Capability | Row | Model code | Provider |
|---|---|---|---|
| VAD | `VAD_SileroVAD` | `SileroVAD` | `silero` |
| ASR | `ASR_PhoWhisper` | `PhoWhisper-small` | `phowhisper` |
| LLM | `LLM_Groq` | `llama-3.3-70b-versatile` | `groq` |
| TTS | `TTS_VieNeu` | `VieNeu-v3-turbo` | `vieneu` |

Nguồn cấu hình chuẩn là `veetee-manager-api/config/model-registry.json`; bản
preview web `src/mocks/fixtures/model-registry.seed.json` phải bằng byte-for-
byte với nguồn này. Không hard-code vendor/model trong component; overview đọc
catalog qua gateway và chỉ test các business invariant nói trên.

## UX đã cập nhật

- Top navigation chỉ còn một entry `Dịch vụ AI`.
- `/model-config` là màn hình trung tâm; `/ai-services` chỉ còn là alias tương
  thích cho bookmark cũ. Contextual navigation có `Cấu hình model`, `Quản lý
  provider`, `Thư viện giọng` theo đúng đường thao tác chính.
- Model Configuration mở mặc định ở `LLM`, có search submit, query category,
  empty state khi chưa có provider và link sang tạo schema.
- Provider Management tải catalog một lần, lọc client-side, phân trang, chọn
  tất cả theo trang và giữ CRUD/schema inspector hiện có.
- Overview hiển thị số liệu catalog và stack default động; không tạo catalog
  provider thứ hai cạnh runtime `provider_config`.

Lưu ý: feature overview cũ vẫn được giữ trong source để không làm mất test và
không phá import ngoài dự kiến, nhưng không còn là route mặc định nên không tạo
request hoặc dữ liệu lặp trong luồng quản trị người dùng.

## Hiệu năng cảm nhận

- Vite dev vẫn phải biên dịch route lazy lần đầu; đây là nguyên nhân chính của
  độ trễ ngắn khi click ở môi trường phát triển. Bản production build/preview
  dùng chunk đã biên dịch nên không có bước này.
- Idle prefetch được giới hạn còn model catalog sau initial paint, tránh warm
  bốn route cùng lúc tranh CPU với thao tác đầu tiên.
- Boot shell inline khi F5 chỉ còn một thanh tiến trình và skeleton tối thiểu;
  nó biến mất khi `app.mount('#app')`, không bao bọc hoặc giữ trạng thái của
  nội dung đã mount.

## Verification

Đã chạy:

```text
veetee-manager-web: typecheck, lint, 115 unit tests, production build — pass
veetee-manager-api: lint, 41 pass / 14 skip có chủ đích, build, openapi:check — pass
PostgreSQL read-only: database veetee_vubq / schema veetee_manager — bốn row trên
đều is_default=1 và is_enabled=1
```

Các test catalog kiểm tra cả API seed và preview seed không drift, đồng thời
assert bốn model đã kiểm thử vẫn được chọn. Test provider-management kiểm tra
phân trang catalog 63 provider và search chỉ áp dụng sau khi submit.
