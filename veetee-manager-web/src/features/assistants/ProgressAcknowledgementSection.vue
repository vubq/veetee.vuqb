<script setup lang="ts">
import { computed, watch } from 'vue'

import type { ProgressAcknowledgementSettings } from '@/domain'
import FormSection from '@/ui/patterns/FormSection.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'

const props = withDefaults(defineProps<{
  modelValue?: ProgressAcknowledgementSettings
  collapsible?: boolean
  open?: boolean
}>(), {
  collapsible: false,
  open: true,
})
const emit = defineEmits<{
  'update:modelValue': [value: ProgressAcknowledgementSettings]
  validity: [value: boolean]
  'update:open': [value: boolean]
}>()

const enabled = computed(() => props.modelValue?.enabled === true)
const deadlineMs = computed(() => readPositiveInteger(props.modelValue?.deadlineMs, 900))
const acknowledgementId = computed(() => readString(props.modelValue?.acknowledgementId, 'processing'))
const message = computed(() => {
  const acknowledgements = props.modelValue?.acknowledgements
  if (!acknowledgements || typeof acknowledgements !== 'object' || Array.isArray(acknowledgements)) return ''
  const value = acknowledgements[acknowledgementId.value]
  return typeof value === 'string' ? value : ''
})
const deadlineInvalid = computed(() => deadlineMs.value < 1 || deadlineMs.value >= 1500)
const acknowledgementIdInvalid = computed(() => !acknowledgementId.value.trim() || acknowledgementId.value.length > 64)
const messageInvalid = computed(() => message.value.length > 512)
const valid = computed(() => !deadlineInvalid.value && !acknowledgementIdInvalid.value && !messageInvalid.value)

watch(valid, (value) => emit('validity', value), { immediate: true })

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function currentPolicy(): ProgressAcknowledgementSettings {
  const acknowledgements = props.modelValue?.acknowledgements
  return {
    ...(props.modelValue ?? {}),
    enabled: enabled.value,
    deadlineMs: deadlineMs.value,
    acknowledgementId: acknowledgementId.value,
    acknowledgements: acknowledgements && typeof acknowledgements === 'object' && !Array.isArray(acknowledgements)
      ? { ...acknowledgements }
      : {},
  }
}

function updatePolicy(patch: Partial<ProgressAcknowledgementSettings>) {
  emit('update:modelValue', { ...currentPolicy(), ...patch })
}

function updateEnabled(value: boolean) {
  updatePolicy({ enabled: value })
}

function updateDeadline(value: string) {
  updatePolicy({ deadlineMs: Number(value) })
}

function updateAcknowledgementId(value: string) {
  const nextId = value
  const policy = currentPolicy()
  const acknowledgements = { ...(policy.acknowledgements ?? {}) }
  if (message.value && nextId && acknowledgements[nextId] === undefined) acknowledgements[nextId] = message.value
  updatePolicy({ acknowledgementId: nextId, acknowledgements })
}

function updateMessage(value: string) {
  const policy = currentPolicy()
  updatePolicy({ acknowledgements: { ...(policy.acknowledgements ?? {}), [acknowledgementId.value]: value } })
}
</script>

<template>
  <FormSection
    title="Phản hồi khi đang xử lý"
    description="Nói một câu đã cấu hình nếu robot cần thêm thời gian để suy nghĩ hoặc thực hiện tác vụ."
    :collapsible="props.collapsible"
    :open="props.open"
    @update:open="$emit('update:open', $event)"
  >
    <template #trailing>
      <VtSwitch
        :model-value="enabled"
        label="Bật phản hồi"
        @update:model-value="updateEnabled"
      />
    </template>
    <div class="two-columns">
      <VtFormField
        label="Thời gian chờ trước khi báo (mili giây)"
        for-id="role-progress-deadline"
        :error="deadlineInvalid ? 'Chọn giá trị từ 1 đến 1.499 mili giây.' : undefined"
        hint="Nên thấp hơn 1.500 mili giây để robot phản hồi sớm."
      >
        <VtInput
          id="role-progress-deadline"
          type="number"
          min="1"
          max="1499"
          step="1"
          inputmode="numeric"
          :model-value="String(deadlineMs)"
          name="progress-deadline-ms"
          :invalid="deadlineInvalid"
          aria-label="Thời gian chờ trước khi báo"
          @update:model-value="updateDeadline"
        />
      </VtFormField>
      <VtFormField
        label="Tên mẫu phản hồi"
        for-id="role-progress-id"
        :error="acknowledgementIdInvalid ? 'Nhập tên không trống, tối đa 64 ký tự.' : undefined"
        hint="Tên này chỉ giúp quản lý mẫu, không phải câu robot đọc."
      >
        <VtInput
          id="role-progress-id"
          :model-value="acknowledgementId"
          name="progress-acknowledgement-id"
          autocomplete="off"
          :invalid="acknowledgementIdInvalid"
          aria-label="Tên mẫu phản hồi"
          @update:model-value="updateAcknowledgementId"
        />
      </VtFormField>
    </div>
    <VtFormField
      label="Câu phản hồi"
      for-id="role-progress-message"
      :error="messageInvalid ? 'Câu phản hồi tối đa 512 ký tự.' : undefined"
      hint="Để trống nếu chỉ muốn giữ policy mà chưa phát acknowledgement."
    >
      <VtTextArea
        id="role-progress-message"
        :model-value="message"
        name="progress-acknowledgement-message"
        :rows="3"
        :invalid="messageInvalid"
        aria-label="Câu phản hồi khi đang xử lý"
        @update:model-value="updateMessage"
      />
    </VtFormField>
  </FormSection>
</template>

<style scoped>
.two-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 660px) { .two-columns { grid-template-columns: 1fr; } }
</style>
