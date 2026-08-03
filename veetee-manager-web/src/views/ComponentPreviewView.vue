<script setup lang="ts">
import { Bell, Box, Inbox, Plus, Search, Settings2, Trash2 } from '@lucide/vue'
import { ref } from 'vue'

import PageHeader from '@/ui/patterns/PageHeader.vue'
import VtAccordion, { type VtAccordionItem } from '@/ui/primitives/VtAccordion.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtSpinner from '@/ui/primitives/VtSpinner.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import VtTabs, { type VtTabItem } from '@/ui/primitives/VtTabs.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'
import VtTooltip from '@/ui/primitives/VtTooltip.vue'
import { notify } from '@/ui/primitives/notifications'

const inputValue = ref('Xin chào, mình là Veetee')
const selectedVoice = ref('vieneu-female-1')
const switchValue = ref(true)
const checkboxValue = ref(true)
const tabValue = ref('default')
const dialogOpen = ref(false)
const longAction = ref(false)

const voiceOptions: VtSelectOption[] = [
  { value: 'vieneu-female-1', label: 'An Nhiên', description: 'Nữ · tự nhiên · vi-VN' },
  { value: 'vieneu-male-1', label: 'Minh Quân', description: 'Nam · rõ ràng · vi-VN' },
  { value: 'unavailable', label: 'Giọng đang bảo trì', description: 'Không thể chọn', disabled: true },
]

const tabs: VtTabItem[] = [
  { value: 'default', label: 'Mặc định' },
  { value: 'loading', label: 'Đang tải' },
  { value: 'error', label: 'Lỗi' },
]

const accordionItems: VtAccordionItem[] = [
  { value: 'speech', title: 'Nhịp nói', description: 'Ngắt nghỉ theo dấu câu', content: 'TTS nhận từng segment hoàn chỉnh và tiếp tục phát theo thứ tự; không chờ toàn bộ câu trả lời.' },
  { value: 'memory', title: 'Bộ nhớ', description: 'Có thể bật hoặc tắt', content: 'Bản xem trước chỉ mô phỏng trạng thái. Không có dữ liệu hội thoại thật được lưu.' },
]

async function runLongAction() {
  longAction.value = true
  await new Promise((resolve) => window.setTimeout(resolve, 1200))
  longAction.value = false
  notify('Đã hoàn tất tác vụ mẫu', { tone: 'success', message: 'Trạng thái loading chặn double-submit và giữ nguyên kích thước nút.' })
}
</script>

<template>
  <main
    id="main-content"
    class="page-container preview-page"
    data-ui-stable="true"
  >
    <PageHeader
      title="Thư viện giao diện"
      subtitle="Primitive Veetee · interaction states · keyboard accessible"
      :icon="Box"
    >
      <template #actions>
        <VtButton @click="notify('Dữ liệu mẫu đã được đặt lại', { tone: 'success' })">
          Đặt lại dữ liệu mẫu
        </VtButton>
      </template>
    </PageHeader>

    <section class="preview-intro">
      <div>
        <VtBadge tone="primary">
          Core slice A
        </VtBadge><h2>Control gọn, border mảnh và trạng thái rõ</h2>
      </div>
      <p>Tất cả control bên dưới là Veetee component. Hãy thử Tab, Shift+Tab, Enter, Space, Arrow keys và Escape.</p>
    </section>

    <div class="preview-grid">
      <VtCard class="preview-panel">
        <header><div><h3>Button & action</h3><p>Primary, secondary, danger, loading và icon-only.</p></div></header>
        <div class="specimen-row">
          <VtButton variant="primary">
            <template #leading>
              <VtIcon
                :icon="Plus"
                :size="15"
              />
            </template>Tạo trợ lý
          </VtButton>
          <VtButton>Lưu bản nháp</VtButton>
          <VtButton variant="ghost">
            Hủy
          </VtButton>
          <VtButton variant="danger">
            <template #leading>
              <VtIcon
                :icon="Trash2"
                :size="15"
              />
            </template>Xóa
          </VtButton>
          <VtButton
            :loading="longAction"
            @click="runLongAction"
          >
            {{ longAction ? 'Đang xử lý' : 'Tác vụ dài' }}
          </VtButton>
          <VtButton disabled>
            Đã vô hiệu
          </VtButton>
          <VtTooltip content="Cấu hình chi tiết">
            <VtIconButton
              :icon="Settings2"
              label="Cấu hình chi tiết"
              variant="soft"
            />
          </VtTooltip>
        </div>
      </VtCard>

      <VtCard class="preview-panel">
        <header><div><h3>Input & textarea</h3><p>Default, read-only và validation error.</p></div></header>
        <div class="field-grid">
          <VtFormField
            label="Tên trợ lý"
            for-id="preview-name"
            hint="Hiển thị trên thiết bị và dashboard."
          >
            <template #default="{ describedby }">
              <VtInput
                id="preview-name"
                v-model="inputValue"
                :icon="Search"
                :aria-describedby="describedby"
              />
            </template>
          </VtFormField>
          <VtFormField
            label="Mã thiết bị"
            for-id="preview-readonly"
            hint="Có thể chọn và sao chép."
          >
            <template #default="{ describedby }">
              <VtInput
                id="preview-readonly"
                model-value="VT-9D1C-A7"
                readonly
                :aria-describedby="describedby"
              />
            </template>
          </VtFormField>
          <VtFormField
            class="span-two"
            label="Base prompt"
            for-id="preview-prompt"
            error="Prompt cần ít nhất 20 ký tự."
          >
            <template #default="{ describedby }">
              <VtTextArea
                id="preview-prompt"
                model-value="Quá ngắn"
                invalid
                :aria-describedby="describedby"
              />
            </template>
          </VtFormField>
        </div>
      </VtCard>

      <VtCard class="preview-panel">
        <header><div><h3>Select, switch & checkbox</h3><p>Custom visual; behavior được headless primitive quản lý.</p></div></header>
        <div class="field-grid">
          <VtFormField
            label="Giọng nói"
            for-id="preview-voice"
          >
            <VtSelect
              id="preview-voice"
              v-model="selectedVoice"
              label="Giọng nói"
              :options="voiceOptions"
            />
          </VtFormField>
          <div class="toggle-stack">
            <VtSwitch
              v-model="switchValue"
              label="Cho phép bộ nhớ dài hạn"
            />
            <VtCheckbox
              v-model="checkboxValue"
              label="Xác nhận trước thao tác nhạy cảm"
            />
            <VtSwitch
              label="Provider không khả dụng"
              disabled
            />
          </div>
        </div>
      </VtCard>

      <VtCard class="preview-panel">
        <header><div><h3>Status & feedback</h3><p>Không dùng màu làm tín hiệu duy nhất.</p></div></header>
        <div class="specimen-row">
          <VtBadge>Nháp #8</VtBadge><VtBadge tone="primary">
            Đang cấu hình
          </VtBadge><VtBadge tone="success">
            Đã lưu
          </VtBadge><VtBadge tone="warning">
            Cần chú ý
          </VtBadge><VtBadge tone="danger">
            Có lỗi
          </VtBadge>
        </div>
        <div class="specimen-row">
          <VtStatus
            tone="online"
            label="Trực tuyến"
          /><VtStatus label="Ngoại tuyến" /><VtStatus
            tone="warning"
            label="Đang cập nhật"
          /><VtStatus
            tone="error"
            label="Mất kết nối"
          />
        </div>
        <div class="specimen-row">
          <VtButton @click="notify('Đã lưu bản nháp', { tone: 'success', message: 'Revision mới là #9.' })">
            Toast thành công
          </VtButton><VtButton @click="notify('Không thể kết nối', { tone: 'error', message: 'Dữ liệu cũ vẫn được giữ để xem.', assertive: true })">
            Toast lỗi
          </VtButton>
        </div>
      </VtCard>

      <VtCard class="preview-panel span-two">
        <header><div><h3>Tabs, accordion & dialog</h3><p>Focus management, keyboard navigation và Escape hoạt động thật.</p></div></header>
        <VtTabs
          v-model="tabValue"
          label="Trạng thái tài nguyên"
          :items="tabs"
        />
        <div class="tab-specimen">
          <p v-if="tabValue === 'default'">
            Dữ liệu sẵn sàng. Đây là panel của tab <strong>Mặc định</strong>.
          </p>
          <p v-else-if="tabValue === 'loading'">
            <VtSpinner :size="16" /> Đang đồng bộ dữ liệu mẫu…
          </p>
          <p
            v-else
            class="error-copy"
          >
            Provider đang không khả dụng. Không tự động đổi provider khác.
          </p>
        </div>
        <VtAccordion :items="accordionItems" />
        <div class="dialog-action">
          <VtButton
            variant="primary"
            @click="dialogOpen = true"
          >
            <template #leading>
              <VtIcon
                :icon="Bell"
                :size="15"
              />
            </template>Mở hộp thoại
          </VtButton>
        </div>
      </VtCard>

      <VtCard class="preview-panel">
        <header><div><h3>Loading resource</h3><p>Giữ layout ổn định trong lúc chờ.</p></div></header>
        <div class="skeleton-card">
          <VtSkeleton
            height="38px"
            width="38px"
          /><div>
            <VtSkeleton
              height="12px"
              width="132px"
            /><VtSkeleton
              height="9px"
              width="88px"
            />
          </div>
        </div>
        <VtSkeleton height="68px" />
      </VtCard>

      <VtCard class="preview-panel">
        <header><div><h3>Empty resource</h3><p>Luôn có lời giải thích và next action.</p></div></header>
        <VtEmptyState
          :icon="Inbox"
          title="Chưa có thiết bị"
          description="Ghép nối robot đầu tiên bằng mã xác thực trên màn hình."
        >
          <VtButton size="sm">
            Ghép nối thiết bị
          </VtButton>
        </VtEmptyState>
      </VtCard>
    </div>

    <VtDialog
      v-model:open="dialogOpen"
      title="Xác nhận giao diện"
      description="Hộp thoại custom giữ focus bên trong và trả focus về trigger khi đóng."
      width="sm"
    >
      <p class="dialog-copy">
        Bạn có thể đóng bằng nút, phím Escape hoặc click vùng ngoài. Action chính có trạng thái hover, focus và loading riêng.
      </p>
      <template #footer>
        <VtButton @click="dialogOpen = false">
          Hủy
        </VtButton><VtButton
          variant="primary"
          @click="dialogOpen = false; notify('Đã xác nhận', { tone: 'success' })"
        >
          Xác nhận
        </VtButton>
      </template>
    </VtDialog>
  </main>
</template>

<style scoped>
.preview-page { max-width: 1160px; }
.preview-intro { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 25px 3px 13px; }
.preview-intro h2 { margin: 8px 0 0; font-size: 18px; font-weight: 650; letter-spacing: -0.015em; }
.preview-intro p { max-width: 510px; margin: 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.6; text-align: right; }
.preview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.preview-panel { min-width: 0; }
.preview-panel > header { display: flex; align-items: start; justify-content: space-between; gap: 12px; margin: -16px -16px 15px; border-bottom: 1px solid var(--vt-border); padding: 13px 15px 11px; }
.preview-panel h3 { margin: 0; font-size: 13px; font-weight: 600; }
.preview-panel header p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.span-two { grid-column: 1 / -1; }
.specimen-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.specimen-row + .specimen-row { margin-top: 13px; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.toggle-stack { display: grid; align-content: center; gap: 13px; padding: 4px 2px; }
.tab-specimen { min-height: 48px; margin: 10px 0 13px; border-left: 2px solid var(--vt-primary); background: var(--vt-primary-soft); padding: 10px 12px; }
.tab-specimen p { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--vt-text-soft); font-size: 11px; }
.tab-specimen .error-copy { color: var(--vt-danger); }
.dialog-action { display: flex; justify-content: flex-end; margin-top: 13px; }
.dialog-copy { margin: 0; color: var(--vt-text-soft); font-size: 12px; line-height: 1.65; }
.skeleton-card { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.skeleton-card > div { display: grid; gap: 8px; }
@media (max-width: 760px) {
  .preview-grid, .field-grid { grid-template-columns: 1fr; }
  .span-two { grid-column: auto; }
  .preview-intro { display: block; }
  .preview-intro p { margin-top: 8px; text-align: left; }
}
</style>

