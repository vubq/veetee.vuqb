# ADR-004 — Manager Web bằng Vue 3, Vite và Tailwind CSS

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owner:** Chủ dự án Veetee
- **Scope:** `veetee-manager-web`

## Context

Veetee cần dashboard cấu hình nhiều surface: assistant, device, provider,
conversation history, speaker recognition, extension và firmware asset wizard.
UI phải nhẹ, chạy tốt khi self-host, có thể mở rộng locale và giữ contract ổn
định để AI coding workflow triển khai từng feature theo contract. Chức năng trong các ảnh tham
khảo là input về information architecture, không phải authorization để sao chép
brand, source code hoặc visual assets.

Các decision drivers:

- Stack đã được chủ dự án chọn: Vue 3, Vite và Tailwind CSS.
- TypeScript và API client phải bám OpenAPI của Manager API.
- Form cấu hình dài cần dirty-state, conflict handling và accessible validation.
- Route-level code splitting để initial load nhỏ.
- i18n là dữ liệu/config; không hardcode tiếng Việt trong business logic.
- Component phải đủ nhỏ và có props/emits contract rõ để model không tạo
  route component khổng lồ.

## Options considered

### Option A — Vue 3 SPA + Vite + Tailwind CSS

Composition API, Single-File Components và client-side routing; deploy static
assets cùng reverse proxy của API.

- Ưu: build nhanh, runtime nhẹ, phù hợp dashboard authenticated, TypeScript tốt,
  dễ chia feature và deploy trên máy local theo thứ tự.
- Nhược: phải tự đặt convention cho server state, accessibility và form conflict;
  không có SSR mặc định.

### Option B — Nuxt

- Ưu: routing/data-fetching convention và SSR/SSG tích hợp.
- Nhược: dashboard không cần SEO/SSR; thêm server runtime và convention vượt nhu
  cầu hiện tại, làm deployment và debugging phức tạp hơn.

### Option C — React + Vite

- Ưu: ecosystem rất lớn, nhiều headless component/query library.
- Nhược: trái stack đã chốt; hook/component convention khác làm tăng số lựa chọn
  và giảm tính nhất quán với đội triển khai hiện tại.

### Option D — Một UI component suite đóng gói toàn bộ visual system

- Ưu: CRUD form/table/dialog nhanh.
- Nhược: khó đạt visual identity riêng, bundle lớn và dễ khóa cấu trúc/accessibility
  vào library. Tailwind trở thành lớp override thay vì design-system source.

## Decision

Chọn **Option A: Vue 3 SPA + Vite + Tailwind CSS**, với các constraint sau:

1. Mọi component dùng TypeScript và Composition API với
   `<script setup lang="ts">`; không trộn Options API.
2. Route view chỉ orchestration và composition. Feature markup, stateful side
   effects và reusable behavior lần lượt nằm ở feature component/composable.
3. Props đi xuống, typed events đi lên. `v-model` chỉ dùng cho true two-way field
   contract; không dùng event bus toàn cục.
4. Vue Router là URL state source. Server state đi qua generated OpenAPI client
   và query cache; Pinia chỉ giữ auth session, UI preference và wizard draft cần
   dùng xuyên route, không mirror toàn bộ API resource.
5. Tailwind dùng semantic design tokens qua CSS variables. Feature component
   không hardcode raw brand color; dark mode và high-contrast state dùng cùng
   token contract.
6. Base primitives của Veetee bọc mọi dialog, menu, tabs, select, toast và form
   field. Có thể dùng headless library bên dưới, nhưng feature không import library
   đó trực tiếp.
7. Mỗi async surface phải định nghĩa loading, empty, error, unauthorized, stale
   và retry state. Mutation có pending lock; revision conflict không được ghi đè
   im lặng.
8. Locale UI và locale của assistant là hai state riêng. Copy, validation,
   progress phrase và enum label dùng translation key; payload lưu BCP-47 locale,
   không lưu chuỗi đã dịch.
9. WCAG 2.2 AA là quality gate: keyboard complete, visible focus, label/error
   association, contrast, reduced motion, non-color status và screen-reader live
   announcement cho async result.
10. Voice cloning, knowledge base và external MCP endpoint không đăng ký route
    cho đến khi có tài liệu riêng. Emoji collection và conversation background
    không thuộc Manager Web scope hiện tại.
11. Chọn **Reka UI stable major** làm headless behavior layer cho dialog, menu,
    tabs, select/listbox, popover và tooltip. Chỉ `ui/primitives` được import Reka;
    feature chỉ dùng Veetee `Vt*` wrappers. Exact version chỉ được install sau
    read-only registry/license/browser probe và phải pin trong lockfile.
12. Không dùng browser-default visual cho interactive control. Semantic HTML/ARIA
    vẫn giữ bên dưới; radius, border, hover, focus, loading, disabled và error
    đến từ Veetee tokens/primitives.
13. **Be Vietnam Pro** là UI font baseline, self-host WOFF2 với pinned
    source/version/checksum; component không tự đổi font family.

## State ownership

| State | Owner | Persistence |
|---|---|---|
| API resources và list cache | Query layer theo feature | Memory; invalidate theo mutation/revision |
| Auth identity/session metadata | `auth` Pinia store | Redacted user/expiry/CSRF trong memory; opaque session chỉ ở HttpOnly cookie |
| UI locale/theme/sidebar | `preferences` Pinia store | Local storage với versioned, non-sensitive schema |
| Form edit draft | Route feature composable | Memory; optional session storage nếu wizard dài |
| Filter/sort/page | URL query | Browser history/shareable URL |
| Firmware wizard multi-step draft | `assetWizard` store | Session storage; secret không được phép xuất hiện |
| Provider credential value | Form-local write-only field | Không cache, không devtools persistence, clear sau submit |

## Consequences

### Positive

- Static deployment nhỏ, startup nhanh và phù hợp dashboard self-host.
- Generated client giảm drift giữa API và UI.
- Feature folders và thin route views tạo unit triển khai rõ cho AI coding workflow.
- Wrapper primitives cho phép đổi headless library mà không sửa toàn bộ feature.
- URL-owned filter/pagination giúp reload, back/forward và chia sẻ state đúng.

### Negative

- Cần đầu tư base primitives và design tokens trước khi làm nhiều màn hình.
- Client-side SPA cần explicit loading/error boundary cho từng route.
- Query cache + Pinia đòi hỏi rule ownership rõ; dùng sai sẽ tạo hai nguồn state.
- Không có SSR; nếu sau này có public marketing/documentation surface thì nên là
  ứng dụng riêng hoặc ADR thay thế.

### Risks and mitigations

| Risk | Mitigation bắt buộc |
|---|---|
| Route component trở thành mega-component | Component map trước implementation; lint/review trigger split khi view sở hữu nhiều section độc lập. |
| Tailwind class drift | Semantic tokens, shared primitives và visual regression ở viewport chuẩn. |
| Form ghi đè config mới | Gửi `If-Match`; conflict dialog cho reload hoặc copy draft, không có force-save mặc định. |
| Secret nằm trong store/devtools | Write-only field local, `autocomplete` phù hợp, clear khi unmount/submit, E2E secret-canary. |
| i18n thiếu key | CI kiểm tra key parity; missing key hiển thị key ở test và fail build release. |
| Accessibility regressions | axe automation + keyboard/screen-reader checklist cho dialog, tabs, form, audio player và wizard. |
| Headless dependency rò vào feature | Architecture lint/test chỉ cho phép `ui/primitives` import Reka; component gallery chạy keyboard/browser smoke tests. |
| Browser-default control hoặc style drift | Primitive-only control imports, semantic token scan và visual regression trên `/_preview/components`. |

## Verification gates

- Build/typecheck hoàn tất mà không import TypeScript source nội bộ từ Manager API;
  chỉ generated client được dùng.
- Mỗi route lazy-load và có route error boundary.
- E2E hoàn thành các flow: tạo assistant, publish revision, pair/unlink device,
  chọn đúng một provider, xem transcript/audio/tool latency và build/download
  `assets.bin`.
- E2E conflict: hai browser sửa cùng assistant; browser sau thấy conflict dialog
  và không mất draft.
- E2E provider secret xác nhận response, DOM sau submit, Pinia, local/session
  storage và browser log không chứa secret canary.
- Keyboard-only chạy hết create/edit/pair/wizard; automated accessibility scan
  không có violation mức serious/critical.
- Locale switch không đổi assistant language và ngược lại.
- Architecture test chứng minh feature/view không import Reka hoặc render
  unwrapped native-default control.
- Component preview chứng minh mọi primitive có default/hover/focus/open/loading/
  disabled/error/success state và Be Vietnam Pro hiển thị Vietnamese corpus.

## Implementation evidence — mock UI preview exception

Đây là implementation note cho quyết định đã Accepted, không đổi status/rationale
của ADR và không phải bằng chứng rằng full Manager Web hoặc M2 đã hoàn thành.

Explicit preview exception trong `veetee-manager-web/` hiện chứng minh một subset:

- Vue 3 + Vite + TypeScript + Tailwind build host-native từ exact lockfile;
- Reka UI nằm sau Veetee `Vt*` wrappers; feature không import headless package;
- Be Vietnam Pro được self-host thành WOFF2 Latin/Vietnamese cho weight
  400/500/600/700;
- năm mock routes dùng typed injectable gateway và in-memory deterministic fixtures;
- `npm test` pass typecheck, lint, 12 unit tests và build;
- 6 Chromium E2E pass, gồm mobile overflow/context navigation và axe scan trên năm
  surface không có violation `serious`/`critical`.
- Chủ dự án đã duyệt visual foundation hiện tại: information hierarchy, layout,
  typography, component styling và responsive direction.

Preview không có generated OpenAPI client, Manager API, PostgreSQL, auth/session,
secret flow hoặc config publication. Các production verification gates ở section
trên vẫn giữ nguyên và chưa được coi là pass; full primitive inventory,
keyboard-only checklist, demo/catalog cleanup và complete snapshot matrix vẫn còn
mở. Visual approval hiện tại không thay các coverage gate đó. Chi tiết visual
feedback như toast không accent stripe và select single-line ellipsis thuộc
[UI preview design](../superpowers/specs/2026-08-03-manager-web-ui-preview-design.md),
không phải decision mới của ADR.

## Revisit triggers

- Xuất hiện public content cần SSR/SEO thật sự.
- Bundle hoặc route transition vượt performance budget sau khi code splitting.
- Một headless primitive đã chọn không đáp ứng WCAG hoặc browser support.
- Dashboard cần offline-first mutation queue thay vì chỉ read cache.

## Related documents

- [Manager design](../08-manager-design.md)
- [Manager Web UI preview design](../superpowers/specs/2026-08-03-manager-web-ui-preview-design.md)
- [ADR-003 — Manager API bằng Node.js, TypeScript và Fastify](ADR-003-fastify-manager-api.md)
