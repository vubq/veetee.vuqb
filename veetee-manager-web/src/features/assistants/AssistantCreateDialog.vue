<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import { notify } from '@/ui/primitives/notifications'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [assistant: AssistantCard] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const name = ref('')
const locale = ref('vi-VN')
const nameError = ref('')
const formError = ref('')
const loading = ref(false)
const nameInput = ref<InstanceType<typeof VtInput> | null>(null)
const locales: VtSelectOption[] = [
  { value: 'vi-VN', label: 'Tiếng Việt', description: 'Locale mặc định' },
  { value: 'en-US', label: 'English (US)', description: 'Mẫu mở rộng i18n' },
]

watch(() => props.open, (open) => {
  if (open) {
    name.value = ''
    locale.value = 'vi-VN'
    nameError.value = ''
    formError.value = ''
    void nextTick(() => nameInput.value?.focus())
  }
})

async function submit() {
  nameError.value = name.value.trim().length < 2 ? 'Tên cần ít nhất 2 ký tự.' : ''
  if (nameError.value) { nameInput.value?.focus(); return }
  loading.value = true
  formError.value = ''
  const result = await gateway.createAssistant({ name: name.value, locale: locale.value })
  loading.value = false
  if (!result.ok) {
    if ('fieldProblems' in result.problem) nameError.value = result.problem.type === 'name-conflict' ? 'Tên trợ lý đã tồn tại.' : 'Tên trợ lý chưa hợp lệ.'
    else formError.value = result.problem.type === 'offline' ? 'Đang ngoại tuyến. Không thể tạo trợ lý mới.' : 'Không thể tạo trợ lý.'
    notify('Không thể tạo trợ lý', { tone: 'error', message: nameError.value || formError.value, assertive: true })
    return
  }
  emit('created', result.data.value)
  emit('update:open', false)
  notify('Đã tạo trợ lý', { tone: 'success', message: `${result.data.value.name} đã xuất hiện trong danh sách.` })
}
</script>

<template>
  <VtDialog
    :open="open"
    title="Tạo trợ lý"
    description="Khởi tạo một profile cấu hình mới bằng dữ liệu mẫu."
    width="sm"
    @update:open="$emit('update:open', $event)"
  >
    <form
      id="create-assistant-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <VtFormField
        label="Tên trợ lý"
        for-id="assistant-name"
        :error="nameError"
        hint="Ví dụ: Mây, Bình Minh hoặc Trợ lý phòng khách."
      >
        <template #default="{ describedby }">
          <VtInput
            id="assistant-name"
            ref="nameInput"
            v-model="name"
            name="assistant-name"
            autocomplete="off"
            placeholder="Nhập tên trợ lý…"
            :invalid="Boolean(nameError)"
            :aria-describedby="describedby"
          />
        </template>
      </VtFormField>
      <VtFormField
        label="Ngôn ngữ hội thoại"
        for-id="assistant-locale"
        hint="Độc lập với ngôn ngữ của dashboard."
      >
        <VtSelect
          id="assistant-locale"
          v-model="locale"
          label="Ngôn ngữ hội thoại"
          :options="locales"
        />
      </VtFormField>
      <p
        v-if="formError"
        class="form-error"
        role="alert"
      >
        {{ formError }}
      </p>
    </form>
    <template #footer>
      <VtButton
        :disabled="loading"
        @click="$emit('update:open', false)"
      >
        Hủy
      </VtButton><VtButton
        type="submit"
        form="create-assistant-form"
        variant="primary"
        :loading="loading"
      >
        Tạo trợ lý
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.dialog-form { display: grid; gap: 15px; }
.form-error { margin: 0; border-left: 2px solid var(--vt-danger); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 8px 10px; font-size: 11px; }
</style>
