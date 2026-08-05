<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import type { RetentionPolicy, RetentionPolicyInput } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'

const props = withDefaults(defineProps<{
  policy: RetentionPolicy
  saving?: boolean
  error?: string
}>(), { saving: false, error: '' })

const emit = defineEmits<{
  save: [value: RetentionPolicyInput]
}>()

const transcriptEnabled = ref(props.policy.captureTranscript)
const transcriptDays = ref(String(props.policy.transcriptDays ?? 30))
const errorHeading = ref<HTMLElement | null>(null)

const transcriptDaysValid = computed(() => {
  if (!transcriptEnabled.value) return true
  const value = Number(transcriptDays.value)
  return Number.isInteger(value) && value >= 1 && value <= 3650
})

const effectiveAtLabel = computed(() => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(props.policy.effectiveAt)))

watch(() => props.policy, (policy) => {
  transcriptEnabled.value = policy.captureTranscript
  transcriptDays.value = String(policy.transcriptDays ?? 30)
}, { deep: true })

watch(() => props.error, async (error) => {
  if (!error) return
  await nextTick()
  errorHeading.value?.focus()
})

function save() {
  if (!transcriptDaysValid.value || props.saving) return
  emit('save', {
    captureTranscript: transcriptEnabled.value,
    transcriptDays: transcriptEnabled.value ? Number(transcriptDays.value) : null,
    captureAudio: false,
    audioDays: null,
  })
}
</script>

<template>
  <VtCard class="retention-panel">
    <header class="retention-header">
      <div>
        <p class="eyebrow">
          Riêng tư & thời hạn lưu
        </p>
        <h2>Lưu trữ hội thoại</h2>
        <p class="muted">
          Thay đổi áp dụng cho các lượt nói mới; bản ghi âm đang tắt để bảo vệ riêng tư.
        </p>
      </div>
      <VtStatus
        tone="neutral"
        label="Đang áp dụng"
      />
    </header>
    <div class="retention-summary">
      <strong>{{ policy.captureTranscript ? `${policy.transcriptDays} ngày nội dung` : 'Không lưu nội dung' }}</strong>
      <span>Thiết lập hiện tại</span>
    </div>

    <div class="retention-controls">
      <div class="retention-toggle">
        <VtSwitch
          v-model="transcriptEnabled"
          label="Lưu nội dung trò chuyện"
          :disabled="saving"
        />
        <span>Cho phép xem lại nội dung đã nhận dạng trong thời hạn bên cạnh.</span>
      </div>
      <div class="retention-duration">
        <label
          class="control-label"
          for="retention-transcript-days"
        >Thời hạn lưu</label>
        <VtInput
          id="retention-transcript-days"
          v-model="transcriptDays"
          name="retention-transcript-days"
          type="number"
          min="1"
          max="3650"
          step="1"
          inputmode="numeric"
          :disabled="saving || !transcriptEnabled"
          :invalid="!transcriptDaysValid"
          :aria-invalid="!transcriptDaysValid"
          :aria-describedby="transcriptDaysValid ? 'retention-days-hint' : 'retention-days-error'"
        />
        <p
          id="retention-days-hint"
          class="control-hint"
        >
          Tối đa 3.650 ngày khi bật lưu nội dung.
        </p>
      </div>
      <div class="retention-audio">
        <VtSwitch
          :model-value="false"
          label="Lưu bản ghi âm"
          disabled
        />
        <span>Đang tắt để bảo vệ riêng tư; tính năng này chưa được bật.</span>
      </div>
    </div>

    <p
      v-if="!transcriptDaysValid"
      id="retention-days-error"
      class="field-error"
      role="alert"
    >
      Thời hạn lưu phải là số nguyên từ 1 đến 3.650 ngày.
    </p>
    <p
      v-if="error"
      ref="errorHeading"
      class="save-error"
      role="alert"
      tabindex="-1"
    >
      {{ error }}
    </p>

    <footer class="retention-footer">
      <span class="effective-at">Đang áp dụng từ {{ effectiveAtLabel }}</span>
      <VtButton
        variant="primary"
        :loading="saving"
        :disabled="!transcriptDaysValid"
        @click="save"
      >
        Lưu thời hạn
      </VtButton>
    </footer>
  </VtCard>
</template>

<style scoped>
.retention-panel { display: grid; gap: 14px; }
.retention-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.muted { max-width: 620px; margin: 6px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.5; }
.retention-summary { display: flex; align-items: baseline; gap: 8px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 9px 10px; }
.retention-summary strong { color: var(--vt-text); font-size: 11px; }.retention-summary span { color: var(--vt-text-muted); font-size: 9px; }
.retention-controls { display: grid; grid-template-columns: minmax(210px, 1fr) minmax(160px, .65fr) minmax(210px, 1fr); gap: 12px; }
.retention-toggle, .retention-audio { display: grid; align-content: start; gap: 6px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 11px; }
.retention-toggle > span, .retention-audio > span, .control-hint, .effective-at { color: var(--vt-text-muted); font-size: 9px; line-height: 1.45; }
.retention-duration { min-width: 0; }
.control-label { display: block; margin-bottom: 7px; color: var(--vt-text-soft); font-size: 12px; font-weight: 600; }
.control-hint { margin: 6px 1px 0; }
.field-error, .save-error { margin: 0; border: 1px solid rgba(214, 69, 80, .28); border-radius: var(--vt-radius-control); background: rgba(214, 69, 80, .06); color: var(--vt-danger); padding: 9px 10px; font-size: 10px; line-height: 1.45; }
.save-error:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); }
.retention-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--vt-border); padding-top: 12px; }
@media (max-width: 780px) { .retention-controls { grid-template-columns: 1fr; }.retention-footer { align-items: stretch; flex-direction: column; }.retention-footer .vt-button { width: 100%; } }
</style>
