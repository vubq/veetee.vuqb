# Veetee Manager Web — UI preview implementation plan

- **Status:** Completed cho approved mock-only visual-preview scope; automated
  gates pass và current visual foundation đã được chủ dự án duyệt. Full primitive/
  keyboard/catalog coverage cùng complete snapshot matrix được giữ làm promotion
  gates cho một Manager Web task được cấp quyền sau này.
- **Scope:** `veetee-manager-web` preview only.
- **Design source:**
  [UI preview design](../specs/2026-08-03-manager-web-ui-preview-design.md).
- **Runtime:** host-native Node/npm; không Docker/Compose.
- **Scheduling:** không gắn calendar-day estimate; progress được đánh giá bằng
  acceptance gates dưới đây.

## 1. Boundary

Plan này được phép tạo một Vue application có mock data và chạy local để review.
Nó không được tạo hoặc tích hợp:

- Manager API/PostgreSQL/auth thật;
- Voice Server, firmware, protocol hoặc provider runtime;
- production secret handling;
- voice cloning, knowledge base hoặc external MCP endpoint.

## 2. Dependency pins đã probe

Registry được kiểm tra read-only trước install. Lockfile là source of truth cuối.

| Package | Version pin | Lý do |
|---|---:|---|
| `vue` | `3.5.40` | Current stable Vue 3.5 |
| `vite` | `8.2.0` | Stable tag; Node 24 tương thích |
| `@vitejs/plugin-vue` | `6.0.8` | Peer hỗ trợ Vite 8/Vue 3 |
| `typescript` | `5.9.3` | Stable line tương thích `typescript-eslint`; không dùng TS 7 khi lint peer chưa hỗ trợ |
| `vue-tsc` | `3.3.9` | Vue SFC typecheck |
| `vue-router` | `5.2.0` | Stable tag, peer matrix khớp stack |
| `pinia` | `4.0.2` | Stable tag, peer matrix khớp router |
| `vue-i18n` | `11.4.8` | Typed locale catalog |
| `tailwindcss` / `@tailwindcss/vite` | `4.3.3` | Stable Tailwind Vite integration |
| `reka-ui` | `2.10.1` | MIT, headless behavior; chỉ primitive layer import |
| `@lucide/vue` | `1.28.0` | Pinned outline icon family; thay package cũ đã deprecated |
| `@fontsource/be-vietnam-pro` | `5.3.0` | OFL-1.1, self-host WOFF2 |
| `vitest` | `4.1.10` | Unit/component runner, Vite 8 peer |
| `@vue/test-utils` | `2.4.11` | Vue component mounting |
| `@testing-library/vue` | `8.1.0` | User-behavior tests |
| `@playwright/test` | `1.62.1` | Chromium E2E/visual regression |
| `axe-core` | `4.12.1` | Accessibility checks |
| `eslint` / `eslint-plugin-vue` | `10.8.0` / `10.10.0` | Static quality gate |
| `typescript-eslint` | `8.65.0` | ESLint 10 + TypeScript 5.9 compatible |

Install dùng exact versions và `package-lock.json`; không dùng caret/range cho
direct dependencies.

## 3. Target file map

```text
veetee-manager-web/
├── package.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.js
├── tsconfig*.json
├── index.html
├── public/
├── tests/e2e/
└── src/
    ├── app/                 boot, router, injection
    ├── assets/              global CSS, font imports
    ├── layouts/             top nav, page shell, workspace nav
    ├── ui/primitives/       Vt* controls; only Reka import boundary
    ├── ui/patterns/         shared compositions
    ├── features/assistants/
    ├── features/devices/
    ├── features/providers/
    ├── views/
    ├── mocks/               fixtures, gateways, scenarios
    ├── i18n/
    └── tests/
```

## 4. Implementation sequence

### Gate A — Scaffold và command contract

- Tạo Vue/Vite TypeScript app trong `veetee-manager-web/`.
- Pin dependencies §2 và sinh lockfile.
- Định nghĩa scripts: `dev`, `build`, `typecheck`, `lint`, `test:unit`,
  `test:e2e`, `test:a11y`, `test`.
- Cấu hình alias, Vue Router, Pinia, i18n và test environments.
- Tạo README host-native với run/test commands.

**Pass khi:** dependency tree resolve sạch; dev server boot; typecheck/build rỗng
pass; không có container file.

### Gate B — Visual foundation

- Import Be Vietnam Pro self-host weights 400/500/600/700.
- Tạo semantic CSS variables và Tailwind mapping theo design spec.
- Tạo reset chỉ loại browser-default visual trong primitive boundary, vẫn giữ
  semantic/focus/accessibility.
- Tạo `VtIcon` wrapper và Lucide sizing/stroke rules.
- Tạo application top navigation và responsive page container.

**Pass khi:** Vietnamese glyph corpus render đúng; không network font request;
tokens không bị hardcode trong feature.

### Gate C — Primitive layer

- Dựng button/icon button, input/search, textarea/form field.
- Dựng Reka-backed select/listbox, switch, tabs, dialog, popover/menu/tooltip.
- Dựng card, badge/status, accordion, toast/live region, skeleton/resource states.
- Bao phủ default/hover/focus/open/loading/disabled/read-only/error/success.
- Architecture rule chỉ `ui/primitives` import `reka-ui`.
- `VtToast` dùng neutral bordered surface + semantic icon/text, không accent stripe.
- `VtSelect` trigger đóng giữ một dòng với ellipsis; label dài không wrap hoặc làm
  đổi control height, option mở vẫn có full accessible label.

**Pass khi:** `/_preview/components` cho thao tác mọi state bằng mouse/keyboard;
unit + accessibility tests pass.

### Gate D — Mock domain và gateways

- Định nghĩa typed models cho Assistant, role config, provider selection, memory,
  device và revision state.
- Tạo deterministic fixtures và injectable MockGateways.
- Tạo scenario selector: loading, empty, stale/offline, conflict, provider error,
  long action, destructive confirmation.
- Tạo `Reset demo` và in-memory mutations.

**Pass khi:** feature không import fixture trực tiếp; reload/reset deterministic;
scenario tạo behavior thật.

### Gate E — Core slice A surfaces

- Assistant index: top nav, page header, search/filter, card grid.
- `AssistantCreateDialog`: validation + create mock Assistant.
- Role workspace: contextual nav, voice listbox/preview, prompt/personality/speech.
- Model & Memory workspace: exactly six provider kinds, one selection/kind,
  memory toggle/items.
- Devices workspace: device cards/list và Pair Device dialog fail/success.
- Revision conflict dialog với reload/copy draft/cancel.

**Pass khi:** mọi visible control hoạt động; không dead link/placeholder; mobile
flow không mất primary action.

### Gate F — Quality và handoff

- Unit/component/axe checks.
- Playwright core flows và scenario flows.
- Visual snapshots tại 1440×900, 1024×768, 390×844; font-ready và motion frozen.
- Browser walkthrough bằng Chromium, inspect console/network.
- Chạy production build và host preview.
- Chụp screenshot các surface chính, mở local URL cho project owner.

**Pass khi:** design acceptance checklist hoàn tất; không console error, external
font request, serious/critical accessibility violation hoặc visual overflow.

## 5. Verification commands

Chạy từ `veetee-manager-web/`:

```bash
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:e2e
```

Để project owner review:

```bash
npm run dev -- --host 0.0.0.0
```

Port/URL thực tế phải lấy từ Vite output; không hardcode trong handoff.

## 6. Completion boundary

Visual foundation của UI preview hiện tại đã được chủ dự án duyệt. Điều này không
cấp quyền bắt đầu full Veetee implementation; chỉ explicit request sau này mới mở
scope code của component khác. Yêu cầu hiện tại chỉ hoàn thiện docs/plans.

Firmware, Voice Server và Manager API vẫn design-only; preview không có
PostgreSQL, auth, generated OpenAPI client, config publication hoặc runtime thật,
vì vậy không được tính là đạt/bắt đầu M2.

## 7. Implementation evidence

Evidence host-native hiện tại của riêng `veetee-manager-web/`:

| Gate | Trạng thái | Evidence |
|---|---|---|
| A — Scaffold/commands | Pass | Exact dependency pins + lockfile; README có `npm ci`, dev, typecheck, lint, unit, build và E2E commands. |
| B — Visual foundation | Pass cho preview | Vue/Vite/Tailwind build; Be Vietnam Pro emit 8 self-host WOFF2 Latin/Vietnamese assets cho weight 400/500/600/700. |
| C — Primitive layer | Partial | Reka imports nằm trong `ui/primitives`; toast/select feedback đã implement; component gallery chưa chứng minh toàn bộ inventory/state trong design spec. |
| D — Mock domain/gateway | Partial | Typed injectable gateways, deterministic core fixtures, reset và happy/offline/conflict/provider-error/long-action behavior; một số locale/personality/speech option catalog vẫn còn local trong feature. |
| E — Core slice A | Pass | Năm route hoạt động với top nav + contextual workspace, create/save/provider/memory/device mock flows. |
| F — Automated quality | Pass phần automated | `npm test`: typecheck + lint + 12/12 unit + build; `npm run test:e2e`: 6/6 Chromium, gồm responsive overflow và axe trên năm surface. |
| F — Owner visual review | Pass cho preview foundation | Chủ dự án xác nhận UI hiện tại đạt yêu cầu; hierarchy, layout, typography, component styling và responsive direction trở thành visual foundation. |
| F — Coverage/manual | Partial | Full keyboard-only checklist, complete primitive-state inventory và snapshot matrix mọi surface × desktop/tablet/mobile chưa có đủ evidence. |

Đây là implementation evidence, không phải benchmark audio/runtime, physical
acceptance hay bằng chứng cho Manager API/M2.

Các dòng `Partial` là known promotion work, không phải planning còn thiếu và
không cấp quyền viết thêm UI/product code trong current docs-only scope.
