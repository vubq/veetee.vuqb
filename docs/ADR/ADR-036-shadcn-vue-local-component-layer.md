# ADR-036 — Lớp component local theo shadcn-vue cho Manager Web

- **Status:** Accepted
- **Date:** 2026-08-07
- **Decision owner:** Chủ dự án Veetee
- **Scope:** `veetee-manager-web`

## Context

Manager Web đã có primitive `Vt*` dùng Reka UI, nhưng visual rules và component
implementation cần một convention rõ hơn để AI có thể mở rộng nhiều màn hình mà
không tạo control rời rạc. Yêu cầu mới là dùng Vue 3 + Vite + TypeScript +
Tailwind CSS 4 + shadcn-vue, vẫn giữ nguyên gateway, router, i18n, mock mode,
API contract và các luồng provider/assistant/device/history.

Các lựa chọn cần cân bằng:

- shadcn-vue là mã component local được sở hữu trong repo, không phải runtime
  UI server hay package suite khóa visual;
- Reka UI vẫn cần làm behavior/accessibility layer cho dialog, menu, select,
  tabs, tooltip và disclosure;
- feature hiện tại đang import `Vt*`, nên đổi trực tiếp toàn bộ feature sẽ tạo
  rủi ro regression lớn và làm mất API props/emits đã được kiểm thử.

## Options

### Option A — Giữ primitive custom hiện tại

- Ưu: không có migration.
- Nhược: component pattern khó đồng bộ khi thêm feature; không đáp ứng yêu cầu
  shadcn-vue mới.

### Option B — Dùng package UI đóng gói runtime

- Ưu: thêm màn hình CRUD nhanh.
- Nhược: khó giữ visual identity, bundle và API behavior phụ thuộc library; dễ
  trộn nhiều primitive system trong một interaction surface.

### Option C — shadcn-vue local + Reka UI + Vt compatibility boundary

- Ưu: component source nằm trong repo, Tailwind semantic tokens kiểm soát visual,
  Reka giữ keyboard/focus/portal behavior, feature không phải sửa đồng loạt.
- Nhược: phải sở hữu và review các file generated; mỗi lần cập nhật upstream
  cần kiểm tra diff và accessibility.

## Decision

Chọn **Option C**.

1. `src/components/ui/*` là bộ component local theo shadcn-vue (style
   `reka-nova`), dùng `cn()` từ `src/lib/utils.ts` với `clsx`,
   `tailwind-merge` và `class-variance-authority`.
2. `reka-ui` là behavior layer duy nhất cho interaction primitive. Feature/view
   không import Reka trực tiếp; feature tiếp tục dùng `Vt*` wrappers.
3. `Vt*` giữ props/emits và class hooks tương thích, nhưng render qua component
   local mới. Đây là migration boundary, không phải thêm một primitive system
   thứ hai.
4. Tailwind CSS 4 dùng semantic CSS variables (`background`, `foreground`,
   `primary`, `border`, `ring`, `radius`) map vào token Veetee hiện có.
5. Control trigger phải giữ một dòng, dùng ellipsis; accessible name của option
   vẫn chứa label + mô tả đầy đủ khi listbox mở.
6. Font runtime là Be Vietnam Pro self-host; metadata `components.json` chỉ mô tả
   component convention, không được dùng để đổi font ứng dụng sang Inter.

## Consequences

### Positive

- Các control có hover/focus/disabled/loading/error và keyboard behavior đồng bộ.
- Feature cũ không phải thay toàn bộ import; regression surface nhỏ hơn.
- Component source, token và dependency versions đều review được trong repo.
- Có thể nâng cấp hoặc thay behavior layer sau này mà không sửa từng feature.

### Negative

- Tăng số file local generated và cần đồng bộ khi nâng shadcn-vue.
- Compatibility wrapper phải được test riêng cho focus, v-model, accessible name
  và event forwarding.
- Tailwind semantic token thiếu sẽ làm component hiển thị sai; build không đủ để
  phát hiện mọi vấn đề màu sắc.

## Verification

- `npm run typecheck` pass.
- `npm run lint` pass với `--max-warnings 0`.
- `npm run test:unit`: 26 test files, 120 tests pass.
- `npm run test:e2e`: 21 Chromium flows pass, gồm pairing, provider/model/voice
  CRUD, dialog focus, mobile menu và mobile overflow.
- `npm run test:a11y`: core surfaces không có violation mức serious/critical.
- `npm run build` pass; không có dependency `lucide-vue-next` deprecated.

## Related decisions

- [ADR-004 — Vue Manager Web](ADR-004-vue-manager-web.md)
- [ADR-033 — Provider control-plane screens](ADR-033-provider-control-plane-screens.md)
