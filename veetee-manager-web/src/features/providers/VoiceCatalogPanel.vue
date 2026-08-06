<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { ManagerGateway } from '@/gateways'
import type { ModelConfigRecord, ModelTtsVoice, ModelTtsVoiceInput, ProviderConfigRecord } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'
import { notify } from '@/ui/primitives/notifications'
import VoicePreviewButton from './VoicePreviewButton.vue'
import { localizedModelName } from './model-registry-labels'

const props = defineProps<{
  configs: ProviderConfigRecord[]
  models: ModelConfigRecord[]
  modelId: string
  model?: ModelConfigRecord
  gateway: ManagerGateway
}>()

const voices = ref<ModelTtsVoice[]>([])
const loading = ref(true)
const saving = ref(false)
const search = ref('')
const appliedSearch = ref('')
const selectedIds = ref<string[]>([])
const editingId = ref('')
const removeIds = ref<string[]>([])
const name = ref('')
const voiceCode = ref('')
const languages = ref('vi-VN')
const remark = ref('')
const voiceDemo = ref('')
const sort = ref('0')

const editing = computed(() => voices.value.find((voice) => voice.id === editingId.value))
const removeTargets = computed(() => voices.value.filter((voice) => removeIds.value.includes(voice.id)))
const allSelected = computed(() => voices.value.length > 0 && voices.value.every((voice) => selectedIds.value.includes(voice.id)))
const modelLabel = computed(() => props.model ? `${localizedModelName(props.model)} · ${props.model.modelCode}` : 'Chưa chọn model TTS')
const runtimeConfig = computed(() => props.configs.find((config) => {
  const type = typeof config.config.type === 'string' ? config.config.type : ''
  return type === props.model?.providerCode || config.name.toLocaleLowerCase().includes(props.model?.providerCode?.toLocaleLowerCase() ?? '')
}))

function resetForm() {
  editingId.value = ''
  name.value = ''
  voiceCode.value = ''
  languages.value = props.model?.modelType === 'TTS' && props.model.providerCode === 'vieneu' ? 'vi-VN' : ''
  remark.value = ''
  voiceDemo.value = ''
  sort.value = '0'
}

function editVoice(voice: ModelTtsVoice) {
  editingId.value = voice.id
  name.value = voice.name
  voiceCode.value = voice.ttsVoice
  languages.value = voice.languages
  remark.value = voice.remark ?? ''
  voiceDemo.value = voice.voiceDemo ?? ''
  sort.value = String(voice.sort)
}

function toggleSelected(id: string, checked: boolean) {
  selectedIds.value = checked ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter((item) => item !== id)
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : voices.value.map((voice) => voice.id)
}

async function load() {
  if (!props.modelId) {
    voices.value = []
    loading.value = false
    return
  }
  loading.value = true
  const result = await props.gateway.listModelTtsVoices(props.modelId, { name: appliedSearch.value, page: 1, limit: 100 })
  if (result.ok) {
    voices.value = result.data.items
    selectedIds.value = selectedIds.value.filter((id) => voices.value.some((voice) => voice.id === id))
  } else {
    voices.value = []
    notify('Không tải được thư viện giọng', { tone: 'error', message: 'Model TTS không khả dụng hoặc máy chủ quản trị chưa sẵn sàng.', assertive: true })
  }
  loading.value = false
}

function submitSearch() {
  appliedSearch.value = search.value.trim()
  void load()
}

function clearSearch() {
  search.value = ''
  appliedSearch.value = ''
  void load()
}

async function save() {
  if (!props.modelId || !name.value.trim() || !voiceCode.value.trim() || !languages.value.trim()) return
  saving.value = true
  const payload: ModelTtsVoiceInput = {
    name: name.value.trim(),
    ttsVoice: voiceCode.value.trim(),
    languages: languages.value.trim(),
    remark: remark.value.trim() || null,
    voiceDemo: voiceDemo.value.trim() || null,
    sort: Number.parseInt(sort.value, 10) || 0,
  }
  const result = editing.value
    ? await props.gateway.updateModelTtsVoice(props.modelId, editing.value.id, payload, editing.value.etag)
    : await props.gateway.createModelTtsVoice(props.modelId, payload)
  saving.value = false
  if (!result.ok) {
    notify('Không thể lưu giọng', { tone: 'error', message: 'Kiểm tra mã giọng, ngôn ngữ và thử lại.', assertive: true })
    return
  }
  notify(editing.value ? 'Đã cập nhật giọng' : 'Đã thêm giọng', { tone: 'success', message: modelLabel.value })
  resetForm()
  await load()
}

function requestDelete(ids: string[]) {
  removeIds.value = ids.filter((id) => voices.value.some((voice) => voice.id === id))
}

async function remove() {
  if (!removeTargets.value.length) return
  saving.value = true
  for (const voice of removeTargets.value) {
    const result = await props.gateway.deleteModelTtsVoice(props.modelId, voice.id, voice.etag)
    if (!result.ok) {
      saving.value = false
      notify('Xóa chưa hoàn tất', { tone: 'error', message: `Không thể xóa ${voice.name}; dữ liệu có thể đã thay đổi.`, assertive: true })
      return
    }
  }
  saving.value = false
  const count = removeTargets.value.length
  removeIds.value = []
  selectedIds.value = selectedIds.value.filter((id) => !removeTargets.value.some((voice) => voice.id === id))
  await load()
  notify('Đã xóa giọng', { tone: 'success', message: `${count} giọng đã được xóa.` })
}

watch(() => props.modelId, () => { resetForm(); appliedSearch.value = ''; search.value = ''; selectedIds.value = []; void load() })
onMounted(() => { resetForm(); void load() })
</script>

<template>
  <VtCard class="voice-catalog-card">
    <header class="voice-heading">
      <div>
        <p class="eyebrow">
          TTS · {{ props.model?.providerCode ?? 'catalog' }}
        </p>
        <h2>{{ modelLabel }}</h2>
        <p class="muted">
          Quản lý voice preset của đúng model TTS đang chọn. Voice cloning và audio tham chiếu vẫn để dành cho tài liệu riêng.
        </p>
        <p
          v-if="runtimeConfig"
          class="runtime-hint"
          :title="runtimeConfig.name"
        >
          Runtime đang có: {{ runtimeConfig.name }}
        </p>
      </div>
      <VtBadge :tone="props.model?.isEnabled ? 'primary' : 'warning'">
        {{ voices.length }} giọng
      </VtBadge>
    </header>

    <div class="voice-toolbar">
      <div class="search-box">
        <VtFormField
          label="Tìm giọng"
          for-id="catalog-voice-search"
        >
          <VtInput
            id="catalog-voice-search"
            v-model="search"
            placeholder="Tên, mã giọng hoặc ngôn ngữ"
            @keyup.enter="submitSearch"
          />
        </VtFormField>
        <VtButton
          size="sm"
          variant="secondary"
          @click="submitSearch"
        >
          Tìm
        </VtButton>
        <VtButton
          v-if="appliedSearch"
          size="sm"
          variant="ghost"
          @click="clearSearch"
        >
          Xóa lọc
        </VtButton>
      </div>
      <div class="voice-toolbar-actions">
        <VtButton
          size="sm"
          variant="secondary"
          :disabled="!voices.length"
          @click="toggleAll"
        >
          {{ allSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả' }}
        </VtButton>
        <VtButton
          size="sm"
          variant="danger"
          :disabled="!selectedIds.length"
          @click="requestDelete(selectedIds)"
        >
          Xóa đã chọn<span v-if="selectedIds.length"> ({{ selectedIds.length }})</span>
        </VtButton>
        <VtButton
          size="sm"
          variant="primary"
          @click="resetForm"
        >
          Thêm giọng
        </VtButton>
      </div>
    </div>

    <div
      v-if="loading"
      class="voice-loading"
      role="status"
    >
      Đang tải voice catalog…
    </div>
    <div
      v-else-if="!props.modelId"
      class="voice-empty"
    >
      Chưa có model TTS. Hãy tạo hoặc bật một model trong Cấu hình model.
    </div>
    <div
      v-else-if="!voices.length"
      class="voice-empty"
    >
      Chưa có giọng phù hợp. Bạn có thể thêm voice preset mới ở bên dưới.
    </div>
    <div
      v-else
      class="voice-table-wrap"
    >
      <div class="voice-table-head">
        <span>Chọn</span><span>Mã giọng</span><span>Tên hiển thị</span><span>Ngôn ngữ</span><span>Nghe thử</span><span>Thao tác</span>
      </div>
      <article
        v-for="voice in voices"
        :key="voice.id"
        class="voice-row"
      >
        <VtCheckbox
          :model-value="selectedIds.includes(voice.id)"
          :label="`Chọn ${voice.name}`"
          @update:model-value="toggleSelected(voice.id, $event)"
        />
        <code :title="voice.ttsVoice">{{ voice.ttsVoice }}</code>
        <div class="voice-copy">
          <strong :title="voice.name">{{ voice.name }}</strong>
          <span :title="voice.remark || undefined">{{ voice.remark || 'Voice preset' }}</span>
        </div>
        <span
          class="voice-language"
          :title="voice.languages"
        >{{ voice.languages }}</span>
        <VoicePreviewButton
          v-if="voice.voiceDemo"
          :src="voice.voiceDemo"
        />
        <span
          v-else
          class="muted"
        >Chưa có demo</span>
        <div class="voice-actions">
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
            @click="requestDelete([voice.id])"
          >
            Xóa
          </VtButton>
        </div>
      </article>
    </div>

    <div
      class="voice-editor"
      :aria-busy="saving"
    >
      <div class="editor-heading">
        <div>
          <h3>{{ editing ? 'Sửa voice preset' : 'Thêm voice preset' }}</h3>
          <p class="muted">
            Mã giọng phải đúng với provider TTS; không cần sửa code runtime.
          </p>
        </div>
        <VtStatus
          :tone="props.model?.isEnabled ? 'online' : 'neutral'"
          :label="props.model?.isEnabled ? 'Model đang bật' : 'Model đang tắt'"
        />
      </div>
      <div class="voice-form-grid">
        <VtFormField
          label="Tên hiển thị"
          for-id="catalog-voice-name"
        >
          <VtInput
            id="catalog-voice-name"
            v-model="name"
            placeholder="Ví dụ: Minh Đức"
          />
        </VtFormField>
        <VtFormField
          label="Mã giọng"
          for-id="catalog-voice-code"
          hint="Provider TTS sẽ nhận giá trị này."
        >
          <VtInput
            id="catalog-voice-code"
            v-model="voiceCode"
            placeholder="Ví dụ: minh_duc"
          />
        </VtFormField>
        <VtFormField
          label="Ngôn ngữ"
          for-id="catalog-voice-languages"
        >
          <VtInput
            id="catalog-voice-languages"
            v-model="languages"
            placeholder="vi-VN hoặc vi-VN,en-US"
          />
        </VtFormField>
        <VtFormField
          label="Thứ tự"
          for-id="catalog-voice-sort"
        >
          <VtInput
            id="catalog-voice-sort"
            v-model="sort"
            type="number"
            min="0"
          />
        </VtFormField>
        <VtFormField
          label="Demo audio URL"
          for-id="catalog-voice-demo"
          hint="Tùy chọn; URL phải truy cập được từ trình duyệt."
        >
          <VtInput
            id="catalog-voice-demo"
            v-model="voiceDemo"
            type="url"
            placeholder="https://…/voice.mp3"
          />
        </VtFormField>
      </div>
      <VtFormField
        label="Ghi chú"
        for-id="catalog-voice-remark"
      >
        <VtTextArea
          id="catalog-voice-remark"
          v-model="remark"
          :rows="2"
          placeholder="Mô tả ngắn để người dùng chọn đúng giọng."
        />
      </VtFormField>
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
          :disabled="!name.trim() || !voiceCode.trim() || !languages.trim() || !props.modelId"
          @click="save"
        >
          {{ editing ? 'Lưu thay đổi' : 'Thêm giọng' }}
        </VtButton>
      </div>
    </div>

    <VtDialog
      :open="Boolean(removeTargets.length)"
      title="Xóa voice preset?"
      :description="removeTargets.length === 1 ? `${removeTargets[0]?.name} sẽ bị xóa khỏi model này.` : `${removeTargets.length} voice preset sẽ bị xóa khỏi model này.`"
      width="sm"
      @update:open="!$event && (removeIds = [])"
    >
      <template #footer>
        <VtButton @click="removeIds = []">
          Hủy
        </VtButton>
        <VtButton
          variant="danger"
          :loading="saving"
          @click="remove"
        >
          Xóa voice
        </VtButton>
      </template>
    </VtDialog>
  </VtCard>
</template>

<style scoped>
.voice-catalog-card { display: grid; gap: 13px; grid-column: 1 / -1; }
.voice-heading, .voice-toolbar, .editor-heading, .voice-editor-actions { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.voice-heading h2, .voice-editor h3 { margin: 0; color: var(--vt-text); font-size: 14px; }
.voice-editor h3 { font-size: 12px; }
.eyebrow { margin: 0 0 3px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.muted { margin: 4px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.45; }
.runtime-hint { overflow: hidden; max-width: 480px; margin: 5px 0 0; color: var(--vt-primary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.voice-toolbar { align-items: end; flex-wrap: wrap; border-top: 1px solid var(--vt-border); border-bottom: 1px solid var(--vt-border); padding: 10px 0; }
.search-box { display: flex; min-width: min(100%, 440px); align-items: end; gap: 7px; }
.search-box :deep(.vt-form-field) { min-width: 220px; flex: 1; }
.voice-toolbar-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.voice-loading, .voice-empty { color: var(--vt-text-muted); font-size: 10px; }
.voice-empty { border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); padding: 20px; text-align: center; }
.voice-table-wrap { display: grid; gap: 5px; min-width: 0; overflow-x: auto; }
.voice-table-head, .voice-row { display: grid; grid-template-columns: 66px minmax(120px, 1fr) minmax(150px, 1.3fr) minmax(90px, .8fr) minmax(100px, .8fr) auto; align-items: center; gap: 10px; min-width: 760px; }
.voice-table-head { color: var(--vt-text-muted); padding: 0 10px 3px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
.voice-row { border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 8px 10px; transition: border-color var(--vt-transition), background var(--vt-transition); }
.voice-row:hover { border-color: var(--vt-border-strong); background: var(--vt-surface-muted); }
.voice-row code, .voice-language { overflow: hidden; color: var(--vt-text-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.voice-copy { display: grid; min-width: 0; gap: 2px; }
.voice-copy strong, .voice-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.voice-copy strong { color: var(--vt-text); font-size: 11px; }
.voice-copy span { color: var(--vt-text-muted); font-size: 9px; }
.voice-actions { display: flex; gap: 4px; }
.voice-editor { display: grid; gap: 10px; border-top: 1px solid var(--vt-border); padding-top: 14px; }
.voice-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.voice-editor-actions { justify-content: flex-end; border-top: 1px solid var(--vt-border); padding-top: 10px; }
@media (max-width: 680px) { .voice-form-grid { grid-template-columns: 1fr; } .voice-heading, .voice-toolbar, .editor-heading { align-items: stretch; flex-direction: column; } .search-box { min-width: 0; } .voice-toolbar-actions { justify-content: flex-start; } }
</style>
