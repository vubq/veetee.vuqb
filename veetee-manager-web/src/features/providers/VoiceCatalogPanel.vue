<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { ManagerGateway } from '@/gateways'
import type { ProviderConfigRecord, VoiceProfile, VoiceProfileInput } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'
import { notify } from '@/ui/primitives/notifications'

const props = defineProps<{
  configs: ProviderConfigRecord[]
  gateway: ManagerGateway
}>()

const voices = ref<VoiceProfile[]>([])
const loading = ref(true)
const saving = ref(false)
const locale = ref('vi-VN')
const editingId = ref('')
const removeId = ref('')
const providerConfigId = ref('')
const name = ref('')
const voiceCode = ref('')
const description = ref('')
const demoUrl = ref('')
const enabled = ref(true)
const sort = ref('0')

const providerOptions = computed<VtSelectOption[]>(() => props.configs.map((config) => ({ value: config.id, label: config.name, description: config.config.model ? String(config.config.model) : 'Cấu hình TTS' })))
const localeOptions: VtSelectOption[] = [
  { value: 'vi-VN', label: 'Tiếng Việt' },
  { value: 'en-US', label: 'English' },
]
const editing = computed(() => voices.value.find((voice) => voice.id === editingId.value))
const customVoices = computed(() => voices.value.filter((voice) => voice.managed === true))
const removeTarget = computed(() => customVoices.value.find((voice) => voice.id === removeId.value))

function resetForm() {
  editingId.value = ''
  providerConfigId.value = props.configs[0]?.id ?? ''
  name.value = ''
  voiceCode.value = ''
  description.value = ''
  demoUrl.value = ''
  enabled.value = true
  sort.value = '0'
}

function editVoice(voice: VoiceProfile) {
  if (voice.managed !== true) return
  editingId.value = voice.id
  providerConfigId.value = voice.providerConfigId ?? props.configs[0]?.id ?? ''
  name.value = voice.name
  voiceCode.value = voice.voiceCode ?? ''
  locale.value = voice.locale
  description.value = voice.description
  demoUrl.value = voice.demoUrl ?? ''
  enabled.value = voice.enabled !== false
  sort.value = String(voice.sort ?? 0)
}

async function load() {
  loading.value = true
  const result = await props.gateway.listVoices(locale.value)
  if (result.ok) voices.value = result.data.items
  else notify('Không tải được danh sách giọng nói', { tone: 'error', message: 'Bạn có thể thử lại sau.', assertive: true })
  loading.value = false
}

async function save() {
  if (!providerConfigId.value || !name.value.trim() || !voiceCode.value.trim() || !locale.value.trim()) return
  saving.value = true
  const payload: VoiceProfileInput = {
    providerConfigId: providerConfigId.value,
    name: name.value.trim(), locale: locale.value, voiceCode: voiceCode.value.trim(),
    description: description.value.trim(), demoUrl: demoUrl.value.trim() || null,
    enabled: enabled.value, sort: Number.parseInt(sort.value, 10) || 0,
  }
  const result = editing.value?.etag
    ? await props.gateway.updateVoiceProfile(editing.value.id, payload, editing.value.etag)
    : await props.gateway.createVoiceProfile(payload)
  saving.value = false
  if (!result.ok) {
    notify('Không thể lưu giọng nói', { tone: 'error', message: 'Kiểm tra mã giọng, cấu hình TTS và thử lại.', assertive: true })
    return
  }
  notify(editing.value ? 'Đã cập nhật giọng nói' : 'Đã thêm giọng nói', { tone: 'success' })
  await load()
  resetForm()
}

async function remove() {
  const target = removeTarget.value
  if (!target?.etag) return
  saving.value = true
  const result = await props.gateway.deleteVoiceProfile(target.id, target.etag)
  saving.value = false
  if (!result.ok) {
    notify('Không thể xóa giọng nói', { tone: 'error', message: 'Giọng nói có thể đã được thay đổi; hãy tải lại.', assertive: true })
    return
  }
  removeId.value = ''
  if (editingId.value === target.id) resetForm()
  await load()
  notify('Đã xóa giọng nói', { tone: 'success' })
}

watch(() => props.configs.map((config) => config.id).join(','), () => {
  if (!providerConfigId.value || !props.configs.some((config) => config.id === providerConfigId.value)) providerConfigId.value = props.configs[0]?.id ?? ''
})
watch(locale, () => { void load() })
onMounted(() => { resetForm(); void load() })
</script>

<template>
  <VtCard class="voice-catalog-card">
    <header class="voice-heading">
      <div>
        <p class="eyebrow">
          TTS
        </p>
        <h2>Thư viện giọng nói</h2>
        <p class="muted">
          Giọng có sẵn đến từ provider. Giọng bạn thêm được lưu riêng để chọn cho từng trợ lý.
        </p>
      </div>
      <VtBadge tone="primary">
        {{ customVoices.length }} giọng tùy chỉnh
      </VtBadge>
    </header>
    <div class="voice-toolbar">
      <VtSelect
        v-model="locale"
        label="Ngôn ngữ"
        :options="localeOptions"
      />
      <VtButton
        size="sm"
        variant="secondary"
        @click="resetForm"
      >
        Thêm giọng nói
      </VtButton>
    </div>
    <div
      v-if="loading"
      class="voice-loading"
      role="status"
    >
      Đang tải thư viện giọng nói…
    </div>
    <ul
      v-else
      class="voice-list"
    >
      <li
        v-for="voice in voices"
        :key="voice.id"
        class="voice-row"
      >
        <div class="voice-copy">
          <strong :title="voice.name">{{ voice.name }}</strong>
          <span :title="voice.description || voice.providerName">{{ voice.providerName }} · {{ voice.voiceCode || 'mặc định' }}</span>
        </div>
        <VtStatus
          :tone="voice.available ? 'online' : 'neutral'"
          :label="voice.available ? 'Sẵn sàng' : 'Đã tắt'"
        />
        <div
          v-if="voice.managed"
          class="voice-actions"
        >
          <VtButton
            size="sm"
            variant="ghost"
            @click="editVoice(voice)"
          >
            Sửa
          </VtButton>
          <VtButton
            size="sm"
            variant="ghost"
            @click="removeId = voice.id"
          >
            Xóa
          </VtButton>
        </div>
      </li>
      <li
        v-if="!voices.length"
        class="voice-empty"
      >
        Chưa có giọng cho ngôn ngữ này.
      </li>
    </ul>
    <div
      class="voice-editor"
      :aria-busy="saving"
    >
      <h3>{{ editing ? 'Sửa giọng nói' : 'Thêm giọng nói' }}</h3>
      <div class="voice-form-grid">
        <VtFormField
          label="Cấu hình TTS"
          for-id="voice-provider"
        >
          <VtSelect
            id="voice-provider"
            v-model="providerConfigId"
            label="Cấu hình TTS"
            :options="providerOptions"
            :disabled="Boolean(editing)"
          />
        </VtFormField>
        <VtFormField
          label="Ngôn ngữ"
          for-id="voice-locale"
        >
          <VtSelect
            id="voice-locale"
            v-model="locale"
            label="Ngôn ngữ"
            :options="localeOptions"
          />
        </VtFormField>
        <VtFormField
          label="Tên hiển thị"
          for-id="voice-name"
        >
          <VtInput
            id="voice-name"
            v-model="name"
            placeholder="Ví dụ: Tự nhiên"
          />
        </VtFormField>
        <VtFormField
          label="Mã giọng"
          for-id="voice-code"
          hint="Mã được provider TTS hiểu."
        >
          <VtInput
            id="voice-code"
            v-model="voiceCode"
            placeholder="Ví dụ: tu_nhien"
          />
        </VtFormField>
        <VtFormField
          label="Thứ tự"
          for-id="voice-sort"
        >
          <VtInput
            id="voice-sort"
            v-model="sort"
            type="number"
            min="0"
          />
        </VtFormField>
        <VtFormField
          label="Demo URL"
          for-id="voice-demo"
        >
          <VtInput
            id="voice-demo"
            v-model="demoUrl"
            type="url"
            placeholder="https://…"
          />
        </VtFormField>
      </div>
      <VtFormField
        label="Mô tả"
        for-id="voice-description"
      >
        <VtTextArea
          id="voice-description"
          v-model="description"
          :rows="2"
          placeholder="Mô tả ngắn để người dùng chọn đúng giọng."
        />
      </VtFormField>
      <div class="voice-flags">
        <VtCheckbox
          v-model="enabled"
          label="Cho phép chọn giọng này"
        />
      </div>
      <div class="voice-editor-actions">
        <VtButton
          v-if="editing"
          variant="ghost"
          @click="resetForm"
        >
          Hủy sửa
        </VtButton>
        <VtButton
          variant="primary"
          :loading="saving"
          :disabled="!providerConfigId || !name.trim() || !voiceCode.trim()"
          @click="save"
        >
          {{ editing ? 'Lưu thay đổi' : 'Thêm giọng' }}
        </VtButton>
      </div>
    </div>
    <VtDialog
      :open="Boolean(removeTarget)"
      title="Xóa giọng nói?"
      :description="removeTarget ? `${removeTarget.name} sẽ không còn xuất hiện khi chọn giọng.` : undefined"
      width="sm"
      @update:open="!$event && (removeId = '')"
    >
      <template #footer>
        <VtButton @click="removeId = ''">
          Hủy
        </VtButton>
        <VtButton
          variant="danger"
          :loading="saving"
          @click="remove"
        >
          Xóa giọng
        </VtButton>
      </template>
    </VtDialog>
  </VtCard>
</template>

<style scoped>
.voice-catalog-card { display: grid; gap: 12px; grid-column: 1 / -1; }
.voice-heading, .voice-toolbar, .voice-row, .voice-editor-actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.voice-heading h2, .voice-editor h3 { margin: 0; color: var(--vt-text); font-size: 14px; }
.voice-editor h3 { font-size: 12px; }
.eyebrow { margin: 0 0 3px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.muted { margin: 4px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.45; }
.voice-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.voice-row { min-width: 0; align-items: center; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 8px 10px; }
.voice-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
.voice-copy strong, .voice-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.voice-copy strong { color: var(--vt-text); font-size: 11px; }
.voice-copy span { color: var(--vt-text-muted); font-size: 9px; }
.voice-actions { display: flex; flex: none; gap: 4px; }
.voice-loading, .voice-empty { color: var(--vt-text-muted); font-size: 10px; }
.voice-editor { display: grid; gap: 10px; border-top: 1px solid var(--vt-border); padding-top: 14px; }
.voice-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.voice-flags { display: flex; flex-wrap: wrap; gap: 14px; }
.voice-editor-actions { justify-content: flex-end; border-top: 1px solid var(--vt-border); padding-top: 10px; }
@media (max-width: 620px) { .voice-form-grid { grid-template-columns: 1fr; } .voice-row { align-items: flex-start; flex-wrap: wrap; } .voice-row > :deep(.vt-status) { order: 3; } .voice-actions { margin-left: auto; } }
</style>
