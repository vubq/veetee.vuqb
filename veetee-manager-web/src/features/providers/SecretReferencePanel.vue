<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

import type { SecretReference } from '@/domain'
import type { ManagerGateway } from '@/gateways'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import { notify } from '@/ui/primitives/notifications'

const props = defineProps<{
  gateway: ManagerGateway
  items: SecretReference[]
  selectedIds: string[]
}>()

const emit = defineEmits<{
  'update:selectedIds': [value: string[]]
  changed: []
}>()

const name = ref('')
const secretValue = ref('')
const createError = ref('')
const saving = ref(false)
const rotateTarget = ref<SecretReference | null>(null)
const rotateValue = ref('')
const rotateError = ref('')
const rotateOpen = ref(false)
const deleteTarget = ref<SecretReference | null>(null)
const deleteError = ref('')
const deleteOpen = ref(false)
const errorHeading = ref<HTMLElement | null>(null)

const selectedSet = computed(() => new Set(props.selectedIds))

function toggle(id: string, checked: boolean) {
  const next = new Set(props.selectedIds)
  if (checked) next.add(id)
  else next.delete(id)
  emit('update:selectedIds', [...next])
}

async function create() {
  createError.value = ''
  if (!name.value.trim() || !secretValue.value) {
    createError.value = 'Nhập tên và giá trị khóa trước khi lưu.'
    await focusError()
    return
  }
  saving.value = true
  try {
    const result = await props.gateway.createSecretReference({ name: name.value.trim(), secretValue: secretValue.value })
    if (!result.ok) {
      createError.value = result.meta.offline ? 'Đang ngoại tuyến; khóa chưa được gửi.' : 'Không thể lưu khóa; dữ liệu nhập vẫn được giữ.'
      await focusError()
      return
    }
    name.value = ''
    secretValue.value = ''
    emit('changed')
    notify('Đã lưu khóa kết nối', { tone: 'success', message: 'Giá trị đã được mã hóa; màn hình chỉ giữ thông tin mô tả.' })
  } finally {
    saving.value = false
    secretValue.value = ''
  }
}

function openRotate(item: SecretReference) {
  rotateTarget.value = item
  rotateValue.value = ''
  rotateError.value = ''
  rotateOpen.value = true
}

async function rotate() {
  const target = rotateTarget.value
  if (!target) return
  rotateError.value = ''
  if (!rotateValue.value) {
    rotateError.value = 'Nhập giá trị khóa mới trước khi lưu.'
    await focusError()
    return
  }
  saving.value = true
  try {
    const result = await props.gateway.updateSecretReference(target.id, { secretValue: rotateValue.value }, target.etag)
    if (!result.ok) {
      rotateError.value = result.meta.offline ? 'Đang ngoại tuyến; khóa chưa được đổi.' : 'Cấu hình đã thay đổi hoặc nơi lưu khóa chưa sẵn sàng.'
      await focusError()
      return
    }
    rotateOpen.value = false
    rotateValue.value = ''
    emit('changed')
    notify('Đã đổi khóa kết nối', { tone: 'success', message: 'Khóa mới đã sẵn sàng để dùng.' })
  } finally {
    saving.value = false
    rotateValue.value = ''
  }
}

function openDelete(item: SecretReference) {
  deleteTarget.value = item
  deleteError.value = ''
  deleteOpen.value = true
}

async function remove() {
  const target = deleteTarget.value
  if (!target) return
  deleteError.value = ''
  saving.value = true
  try {
    const result = await props.gateway.deleteSecretReference(target.id, target.etag)
    if (!result.ok) {
      deleteError.value = result.meta.offline ? 'Đang ngoại tuyến; khóa vẫn được giữ.' : 'Khóa đang được dịch vụ sử dụng hoặc đã thay đổi.'
      await focusError()
      return
    }
    emit('update:selectedIds', props.selectedIds.filter((id) => id !== target.id))
    deleteOpen.value = false
    emit('changed')
    notify('Đã xóa khóa kết nối', { tone: 'success' })
  } finally {
    saving.value = false
  }
}

async function focusError() {
  await nextTick()
  errorHeading.value?.focus()
}
</script>

<template>
  <VtCard class="secret-card">
    <header class="secret-header">
      <div>
        <h2>Khóa kết nối</h2>
        <p class="muted">
          Khóa được mã hóa khi lưu. Sau khi lưu, bạn không thể xem lại giá trị trên màn hình.
        </p>
      </div>
      <VtStatus
        tone="neutral"
        :label="`${items.length} khóa`"
      />
    </header>

    <form
      class="secret-create"
      @submit.prevent="create"
    >
      <VtFormField
        label="Tên khóa"
        for-id="secret-reference-name"
      >
        <VtInput
          id="secret-reference-name"
          v-model="name"
          name="secret-reference-name"
          autocomplete="off"
          placeholder="Tên dễ nhớ…"
          :disabled="saving"
        />
      </VtFormField>
      <VtFormField
        label="Giá trị khóa"
        for-id="secret-reference-value"
        hint="Sau khi lưu, giá trị không thể xem lại."
      >
        <VtInput
          id="secret-reference-value"
          v-model="secretValue"
          name="secret-reference-value"
          type="password"
          aria-label="Giá trị khóa"
          autocomplete="new-password"
          spellcheck="false"
          placeholder="Dán key vào đây…"
          :disabled="saving"
          @keydown.enter.prevent="create"
        />
      </VtFormField>
      <VtButton
        type="submit"
        variant="secondary"
        :loading="saving"
        :disabled="!name.trim() || !secretValue"
      >
        Lưu khóa
      </VtButton>
    </form>
    <p
      v-if="createError"
      ref="errorHeading"
      class="secret-error"
      role="alert"
      tabindex="-1"
    >
      {{ createError }}
    </p>

    <div
      v-if="items.length"
      class="secret-list"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="secret-row"
      >
        <VtCheckbox
          :model-value="selectedSet.has(item.id)"
          :label="item.name"
          @update:model-value="toggle(item.id, $event)"
        />
        <span class="secret-meta">{{ item.status === 'available' ? 'Sẵn sàng' : item.status === 'unavailable' ? 'Chưa sẵn sàng' : 'Đang kiểm tra' }} · lưu an toàn</span>
        <div class="secret-actions">
          <VtButton
            variant="ghost"
            size="sm"
            aria-label="Đổi khóa"
            :disabled="saving"
            @click="openRotate(item)"
          >
            Đổi khóa
          </VtButton>
          <VtButton
            variant="ghost"
            size="sm"
            :disabled="saving"
            @click="openDelete(item)"
          >
            Xóa
          </VtButton>
        </div>
      </div>
    </div>
    <p
      v-else
      class="secret-empty"
    >
      Chưa có khóa kết nối. Tạo khóa đầu tiên ở form trên.
    </p>
  </VtCard>

  <VtDialog
    v-model:open="rotateOpen"
    title="Đổi khóa kết nối"
    description="Giá trị cũ sẽ được thay bằng khóa mới sau khi lưu thành công."
    width="sm"
  >
    <VtFormField
      label="Giá trị khóa mới"
      for-id="secret-rotate-value"
    >
      <VtInput
        id="secret-rotate-value"
        v-model="rotateValue"
        name="secret-rotate-value"
        type="password"
        aria-label="Giá trị khóa mới"
        autocomplete="new-password"
        spellcheck="false"
        :disabled="saving"
        @keydown.enter.prevent="rotate"
      />
    </VtFormField>
    <p
      v-if="rotateError"
      ref="errorHeading"
      class="secret-error"
      role="alert"
      tabindex="-1"
    >
      {{ rotateError }}
    </p>
    <template #footer>
      <VtButton
        variant="ghost"
        :disabled="saving"
        @click="rotateOpen = false"
      >
        Hủy
      </VtButton>
      <VtButton
        variant="primary"
        :loading="saving"
        :disabled="!rotateValue"
        aria-label="Lưu khóa mới"
        @click="rotate"
      >
        Lưu khóa mới
      </VtButton>
    </template>
  </VtDialog>

  <VtDialog
    v-model:open="deleteOpen"
    title="Xóa khóa kết nối?"
    description="Chỉ xóa được khóa chưa được dùng trong cấu hình dịch vụ."
    width="sm"
  >
    <p class="delete-copy">
      {{ deleteTarget?.name }}
    </p>
    <p
      v-if="deleteError"
      ref="errorHeading"
      class="secret-error"
      role="alert"
      tabindex="-1"
    >
      {{ deleteError }}
    </p>
    <template #footer>
      <VtButton
        variant="ghost"
        :disabled="saving"
        @click="deleteOpen = false"
      >
        Hủy
      </VtButton>
      <VtButton
        variant="danger"
        :loading="saving"
        aria-label="Xóa khóa"
        @click="remove"
      >
        Xóa khóa
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.secret-card { display: grid; gap: 14px; }
.secret-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.secret-header h2 { margin: 0 0 5px; font-size: 14px; }
.muted { margin: 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.55; }
.secret-create { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(220px, 1.2fr) auto; align-items: start; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 11px; }
.secret-create .vt-button { min-height: 36px; align-self: end; white-space: nowrap; }
.secret-error { margin: 0; border: 1px solid rgba(214, 69, 80, .28); border-radius: var(--vt-radius-control); background: rgba(214, 69, 80, .06); color: var(--vt-danger); padding: 9px 10px; font-size: 10px; line-height: 1.45; }
.secret-list { display: grid; gap: 6px; }
.secret-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; border-bottom: 1px solid var(--vt-border); padding: 8px 0; }
.secret-row:last-child { border-bottom: 0; }
.secret-meta { color: var(--vt-text-muted); font-size: 9px; white-space: nowrap; }
.secret-actions { display: flex; gap: 2px; }
.secret-empty { margin: 0; color: var(--vt-text-muted); font-size: 10px; }
.delete-copy { margin: 0; color: var(--vt-text); font-size: 13px; font-weight: 600; }
@media (max-width: 700px) { .secret-create { grid-template-columns: 1fr; }.secret-row { grid-template-columns: 1fr; align-items: flex-start; }.secret-meta { padding-left: 26px; }.secret-actions { padding-left: 18px; } }
</style>
