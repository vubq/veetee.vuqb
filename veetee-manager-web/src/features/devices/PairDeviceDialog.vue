<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard, DeviceCard, DiscoverableDevice } from '@/domain'
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
const devices = ref<DiscoverableDevice[]>([])
const devicesLoading = ref(false)
const codeInput = ref<InstanceType<typeof VtInput> | null>(null)

function assistantOptions(): VtSelectOption[] {
  return props.assistants.map((assistant) => ({ value: assistant.id, label: assistant.name, description: assistant.locale }))
}

function deviceOptions(): VtSelectOption[] {
  return devices.value.map((device) => ({
    value: device.id,
    label: `${device.board} · ${device.maskedMac}`,
    description: `Online · ${device.firmwareVersion}`,
  }))
}

async function loadDiscoverable() {
  devicesLoading.value = true
  const result = await gateway.listDiscoverableDevices()
  devicesLoading.value = false
  if (!result.ok) {
    devices.value = []
    formError.value = result.meta.offline ? 'Máy chủ quản trị đang ngoại tuyến.' : 'Không tải được danh sách robot đang chờ ghép nối.'
    return
  }
  devices.value = result.data.items
  if (!selectedDeviceId.value) selectedDeviceId.value = devices.value[0]?.id ?? ''
}

const selectedDeviceId = ref('')

watch(() => props.open, (open) => {
  if (open) {
    selectedAssistant.value = props.assistantId ?? props.assistants[0]?.id ?? ''
    code.value = ''
    displayName.value = ''
    codeError.value = ''
    formError.value = ''
    devices.value = []
    selectedDeviceId.value = ''
    void loadDiscoverable()
    void nextTick(() => codeInput.value?.focus())
  }
})

async function submit() {
  const normalizedCode = code.value.trim().toUpperCase()
  codeError.value = /^\d{6}$/.test(normalizedCode) || /^VT-\d{4}$/.test(normalizedCode) ? '' : 'Nhập đúng 6 chữ số trên robot.'
  if (!selectedAssistant.value) formError.value = 'Hãy chọn trợ lý sẽ quản lý thiết bị.'
  if (!selectedDeviceId.value) formError.value = formError.value || 'Chưa có robot nào đang chờ ghép nối.'
  if (codeError.value || formError.value) {
    void nextTick(() => codeInput.value?.focus())
    return
  }
  loading.value = true
  const result = await gateway.pairDevice({ assistantId: selectedAssistant.value, deviceId: selectedDeviceId.value || undefined, verificationCode: normalizedCode, displayName: displayName.value || undefined })
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
    description="Chọn robot đang online, sau đó nhập mã 6 chữ số đang hiển thị trên màn hình robot."
    width="sm"
    @update:open="$emit('update:open', $event)"
  >
    <form
      id="pair-device-form"
      class="dialog-form"
      @submit.prevent="submit"
    >
      <VtFormField
        label="Robot đang chờ"
        for-id="pair-device"
        :error="devicesLoading ? undefined : (devices.length === 0 ? 'Bật robot và chờ robot xuất hiện trên mạng.' : undefined)"
      >
        <VtSelect
          id="pair-device"
          v-model="selectedDeviceId"
          label="Robot đang chờ"
          :options="deviceOptions()"
          :disabled="devicesLoading || devices.length === 0"
        />
      </VtFormField>
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
        hint="Bản preview cũ dùng VT-2608; robot thật dùng 6 chữ số."
      >
        <template #default="{ describedby }">
          <VtInput
            id="pair-code"
            ref="codeInput"
            v-model="code"
            name="pair-code"
            placeholder="123456"
            autocomplete="one-time-code"
            spellcheck="false"
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
            name="display-name"
            autocomplete="off"
            placeholder="Veetee phòng làm việc…"
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
