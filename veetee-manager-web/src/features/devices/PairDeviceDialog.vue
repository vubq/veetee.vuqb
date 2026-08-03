<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard, DeviceCard } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import { notify } from '@/ui/primitives/notifications'

const props = defineProps<{ open: boolean; assistants: AssistantCard[]; assistantId?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; paired: [device: DeviceCard] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const selectedAssistant = ref('')
const code = ref('')
const displayName = ref('')
const codeError = ref('')
const formError = ref('')
const loading = ref(false)
const codeInput = ref<InstanceType<typeof VtInput> | null>(null)

function assistantOptions(): VtSelectOption[] {
  return props.assistants.map((assistant) => ({ value: assistant.id, label: assistant.name, description: assistant.locale }))
}

watch(() => props.open, (open) => {
  if (open) {
    selectedAssistant.value = props.assistantId ?? props.assistants[0]?.id ?? ''
    code.value = ''
    displayName.value = ''
    codeError.value = ''
    formError.value = ''
    void nextTick(() => codeInput.value?.focus())
  }
})

async function submit() {
  codeError.value = code.value.trim().length < 6 ? 'Mã xác thực cần ít nhất 6 ký tự.' : ''
  if (!selectedAssistant.value) formError.value = 'Hãy chọn trợ lý sẽ quản lý thiết bị.'
  if (codeError.value || formError.value) {
    void nextTick(() => codeInput.value?.focus())
    return
  }
  loading.value = true
  const result = await gateway.pairDevice({ assistantId: selectedAssistant.value, verificationCode: code.value, displayName: displayName.value || undefined })
  loading.value = false
  if (!result.ok) {
    if (result.problem.type === 'pairing-code' || result.problem.type === 'validation') codeError.value = 'Mã không đúng hoặc đã hết hạn. Trong preview, dùng VT-2608.'
    else formError.value = result.problem.type === 'offline' ? 'Đang ngoại tuyến. Ghép nối đã bị chặn.' : 'Không thể ghép nối thiết bị.'
    notify('Ghép nối chưa thành công', { tone: 'error', message: codeError.value || formError.value, assertive: true })
    if (codeError.value) void nextTick(() => codeInput.value?.focus())
    return
  }
  emit('paired', result.data)
  emit('update:open', false)
  notify('Đã ghép nối thiết bị', { tone: 'success', message: `${result.data.displayName} đã được thêm vào trợ lý.` })
}
</script>

<template>
  <VtDialog
    :open="open"
    title="Ghép nối thiết bị"
    description="Nhập mã xác thực đang hiển thị trên robot. Bản preview dùng mã VT-2608."
    width="sm"
    @update:open="$emit('update:open', $event)"
  >
    <form
      id="pair-device-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <VtFormField
        label="Trợ lý"
        for-id="pair-assistant"
      >
        <VtSelect
          id="pair-assistant"
          v-model="selectedAssistant"
          label="Trợ lý"
          :options="assistantOptions()"
          :disabled="Boolean(assistantId)"
        />
      </VtFormField>
      <VtFormField
        label="Mã xác thực"
        for-id="pair-code"
        :error="codeError"
        hint="Mã mẫu: VT-2608"
      >
        <template #default="{ describedby }">
          <VtInput
            id="pair-code"
            ref="codeInput"
            v-model="code"
            placeholder="VT-0000"
            autocomplete="one-time-code"
            :invalid="Boolean(codeError)"
            :aria-describedby="describedby"
          />
        </template>
      </VtFormField>
      <VtFormField
        label="Tên hiển thị"
        for-id="pair-name"
        optional
        hint="Có thể đổi lại sau."
      >
        <template #default="{ describedby }">
          <VtInput
            id="pair-name"
            v-model="displayName"
            placeholder="Veetee phòng làm việc"
            :aria-describedby="describedby"
          />
        </template>
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
        variant="primary"
        :loading="loading"
        @click="submit"
      >
        Ghép nối
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.dialog-form { display: grid; gap: 15px; }
.form-error { margin: 0; border-left: 2px solid var(--vt-danger); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 8px 10px; font-size: 11px; }
</style>
