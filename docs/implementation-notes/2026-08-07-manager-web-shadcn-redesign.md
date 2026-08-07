# Manager Web — shadcn-vue redesign

## Scope

Đổi lớp UI của `veetee-manager-web` sang Vue 3 + Vite + TypeScript + Tailwind
CSS 4 + shadcn-vue local components. Không đổi Manager API, Voice Server,
database, firmware, protocol, gateway contract hoặc mock scenario semantics.

## Implementation

- Khởi tạo `components.json` theo shadcn-vue `reka-nova`, base Reka UI và
  semantic Tailwind tokens.
- Thêm `src/components/ui/*` cho button, card, input, textarea, label, badge,
  checkbox, switch, select, dialog, tabs, accordion, tooltip, dropdown-menu,
  skeleton và separator.
- Thêm `src/lib/utils.ts` với `cn()` (`clsx` + `tailwind-merge`).
- Chuyển `VtButton`, `VtInput`, `VtSelect`, `VtTextArea`, `VtCard`, `VtBadge`,
  `VtCheckbox`, `VtSwitch`, `VtDialog`, `VtTabs`, `VtAccordion`, `VtMenu`,
  `VtTooltip`, `VtSkeleton`, `VtIconButton` sang render qua local shadcn
  components; giữ API props/emits và class hooks để feature không đổi.
- App shell, boot shell, page header và login dùng favicon/logo hai mắt (không
  có miệng), Be Vietnam Pro self-host và layout responsive.
- Select trigger luôn một dòng/ellipsis; listbox giữ accessible name gồm label
  và mô tả. Input component expose `focus()` để giữ focus management của dialog.

## Verification

Chạy trong `veetee-manager-web`:

```text
npm run typecheck       ✅
npm run lint            ✅ (0 warning)
npm run test:unit       ✅ 26 files / 120 tests
npm run test:e2e        ✅ 21 Chromium flows
npm run test:a11y       ✅ 1 core-surface scan, 0 serious/critical
npm run build           ✅ Vite production build
```

Đã chụp kiểm tra Chromium local ở:

- `output/playwright/assistants-desktop.png`
- `output/playwright/assistants-mobile.png`
- `output/playwright/model-config-desktop.png`
- `output/playwright/model-config-mobile.png`
- `output/playwright/assistant-role-desktop.png`
- `output/playwright/login-desktop.png`

## Regression đã xử lý

1. Migration component làm mất focus ô mã pairing sau validation lỗi; thêm
   `focus()` expose tại local shadcn Input.
2. Option voice chỉ có accessible name là label; đưa mô tả vào
   `SelectItemText` và giữ trigger chỉ hiển thị label, nên keyboard/screen-reader
   vẫn phân biệt được voice code.

## Giới hạn

- Đây là redesign UI; không phải acceptance vật lý của LCD/loa/mic ESP32.
- Không phát audio, không đổi Wi-Fi/Tailscale và không flash firmware trong lát
  cắt này.
- Các cảnh báo Vue Router trong unit test xuất phát từ feature test mount không
  cài router, không phải lỗi build/runtime; toàn bộ test vẫn pass.

## Rollback

Rollback theo commit Git của lát cắt này; không xóa database hay dữ liệu runtime.
