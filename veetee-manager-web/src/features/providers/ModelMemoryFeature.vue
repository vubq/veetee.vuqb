<script setup lang="ts">
import { BrainCircuit, Database, ShieldAlert } from '@lucide/vue'
import { computed, nextTick, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import { PROVIDER_KINDS, type ModelMemoryWorkspace, type ModelTtsVoice, type ModelType, type ProviderKind, type RevisionConflictProblem, type RoleConfigDraft, type UpdateProviderSelectionInput, type Versioned } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import FormSection from '@/ui/patterns/FormSection.vue'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import { notify } from '@/ui/primitives/notifications'

import RevisionConflictDialog from '@/features/assistants/RevisionConflictDialog.vue'
import { localizedModelName, localizedProviderName } from './model-registry-labels'

const props = defineProps<{ assistantId: string }>()
const emit = defineEmits<{ revision: [revision: number] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const resource = ref<Versioned<ModelMemoryWorkspace>>()
const loading = ref(true)
const mutatingKind = ref<ProviderKind>()
const memoryLoading = ref(false)
const conflict = ref<RevisionConflictProblem<ModelMemoryWorkspace, UpdateProviderSelectionInput | { enabled: boolean }>>()
const copying = ref(false)
const loadState = ref<'loading' | 'ready' | 'error' | 'offline'>('loading')
const loadError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
const ttsVoices = ref<ModelTtsVoice[]>([])
const selectedTtsVoice = ref('')
const ttsVoiceLoading = ref(false)
const ttsVoiceSaving = ref(false)
let loadGeneration = 0

function cloneWorkspace(workspace: ModelMemoryWorkspace): ModelMemoryWorkspace {
  return {
    assistantId: workspace.assistantId,
    selections: workspace.selections.map((selection) => ({ ...selection })),
    availableConfigs: workspace.availableConfigs.map((config) => ({ ...config, supportedLocales: [...config.supportedLocales], ...(config.model ? { model: { ...config.model } } : {}) })),
    memory: { ...workspace.memory },
    memoryItems: workspace.memoryItems.map((item) => ({ ...item })),
  }
}

const kindInfo: Record<ProviderKind, { label: string; description: string }> = {
  vad: { label: 'Lọc tiếng ồn', description: 'Nhận biết khi bạn đang nói' },
  asr: { label: 'Nhận dạng lời nói', description: 'Đổi lời nói thành chữ' },
  llm: { label: 'Bộ não trả lời', description: 'Suy luận và gọi công cụ' },
  tts: { label: 'Giọng nói', description: 'Đọc câu trả lời thành tiếng' },
  intent: { label: 'Hiểu ý định', description: 'Nhận biết yêu cầu đặc biệt' },
  memory: { label: 'Ghi nhớ', description: 'Giữ thông tin qua các lượt nói' },
}

function localeLabel(locale: string) {
  return locale === '*' ? 'mọi ngôn ngữ' : locale === 'vi-VN' ? 'tiếng Việt' : locale === 'en-US' ? 'tiếng Anh' : locale
}

function memoryKindLabel(kind: string) {
  return kind === 'preference' ? 'Sở thích' : kind === 'fact' ? 'Thông tin' : kind === 'instruction' ? 'Chỉ dẫn' : 'Ghi nhớ'
}

function modelTypeForKind(kind: ProviderKind): ModelType {
  return kind === 'intent' ? 'Intent' : kind === 'memory' ? 'Memory' : kind.toUpperCase() as Exclude<ModelType, 'Plugin' | 'RAG'>
}

function selectionValue(kind: ProviderKind) {
  const selection = resource.value?.value.selections.find((item) => item.kind === kind)
  return selection?.mode === 'selected' ? selection.providerConfigId : '__disabled__'
}

function selectionFor(kind: ProviderKind) {
  return resource.value?.value.selections.find((item) => item.kind === kind)
}

function optionsFor(kind: ProviderKind): VtSelectOption[] {
  const configs = resource.value?.value.availableConfigs.filter((item) => item.kind === kind) ?? []
  const options: VtSelectOption[] = configs.map((config) => ({
    value: config.id,
    label: config.model
      ? `${localizedModelName({ modelType: modelTypeForKind(kind), modelCode: config.model.code, modelName: config.model.name })} · ${config.name}`
      : config.name,
    description: `${config.model?.code ?? localizedProviderName({ modelType: modelTypeForKind(kind), providerCode: config.model?.providerCode ?? config.providerName, name: config.providerName })} · hỗ trợ ${config.supportedLocales.map(localeLabel).join(', ')}`,
    disabled: config.availability !== 'ready',
  }))
  if (kind === 'intent' || kind === 'memory') options.unshift({ value: '__disabled__', label: 'Tắt', description: 'Không dùng dịch vụ cho loại này' })
  return options
}

function configFor(kind: ProviderKind) {
  const selected = selectionValue(kind)
  return resource.value?.value.availableConfigs.find((config) => config.id === selected)
}

function modelFor(kind: ProviderKind) {
  return configFor(kind)?.model
}

function modelLabel(kind: ProviderKind): string {
  const model = modelFor(kind)
  if (!model) return ''
  return localizedModelName({ modelType: modelTypeForKind(kind), modelCode: model.code, modelName: model.name })
}

function selectionStatus(kind: ProviderKind): 'ready' | 'disabled' | 'unavailable' | 'missing' {
  const selection = selectionFor(kind)
  if (selection?.mode !== 'selected') return 'disabled'
  const config = configFor(kind)
  if (!config) return 'missing'
  return config.availability
}

function selectionStatusLabel(kind: ProviderKind): string {
  const status = selectionStatus(kind)
  if (status === 'ready') return 'Sẵn sàng'
  if (status === 'disabled') return 'Đã tắt'
  if (status === 'unavailable') return 'Không khả dụng'
  return 'Thiếu cấu hình'
}

function selectionStatusTone(kind: ProviderKind): 'online' | 'neutral' | 'warning' | 'error' {
  const status = selectionStatus(kind)
  if (status === 'ready') return 'online'
  if (status === 'unavailable') return 'error'
  if (status === 'missing') return 'warning'
  return 'neutral'
}

function selectedTtsConfig(workspace = resource.value?.value): ModelMemoryWorkspace['availableConfigs'][number] | undefined {
  if (!workspace) return undefined
  const selection = workspace.selections.find((item) => item.kind === 'tts' && item.mode === 'selected')
  return selection?.providerConfigId ? workspace.availableConfigs.find((config) => config.id === selection.providerConfigId) : undefined
}

function roleVoiceId(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const speech = (value as { speech?: unknown }).speech
  if (!speech || typeof speech !== 'object') return ''
  const voiceId = (speech as { voiceId?: unknown }).voiceId
  return typeof voiceId === 'string' ? voiceId : ''
}

async function loadTtsVoices(workspace = resource.value?.value): Promise<void> {
  const config = selectedTtsConfig(workspace)
  if (!config?.model?.id || typeof gateway.listModelTtsVoices !== 'function') {
    ttsVoices.value = []
    selectedTtsVoice.value = ''
    return
  }
  ttsVoiceLoading.value = true
  try {
    const [voiceResult, roleResult] = await Promise.all([
      gateway.listModelTtsVoices(config.model.id, { page: 1, limit: 100 }),
      typeof gateway.getRoleConfig === 'function' ? gateway.getRoleConfig(props.assistantId) : Promise.resolve(undefined),
    ])
    if (!voiceResult.ok) {
      ttsVoices.value = []
      selectedTtsVoice.value = ''
      return
    }
    ttsVoices.value = voiceResult.data.items
    const persistedVoice = roleResult?.ok ? roleVoiceId(roleResult.data.value) : ''
    const availableVoice = ttsVoices.value.find((voice) => voice.ttsVoice === persistedVoice || voice.id === persistedVoice || voice.name === persistedVoice)
    // An assistant may still reference a voice from the previous TTS model.
    // Keep that draft untouched until the user explicitly chooses a new voice,
    // but show the first catalog voice instead of an empty trigger when the
    // persisted code is not part of the selected model.
    selectedTtsVoice.value = availableVoice?.ttsVoice ?? ttsVoices.value[0]?.ttsVoice ?? persistedVoice ?? ''
  } finally {
    ttsVoiceLoading.value = false
  }
}

async function saveTtsVoice(value: string): Promise<void> {
  if (!value || ttsVoiceSaving.value || typeof gateway.getRoleConfig !== 'function' || typeof gateway.saveRoleConfig !== 'function') return
  ttsVoiceSaving.value = true
  try {
    const current = await gateway.getRoleConfig(props.assistantId)
    if (!current.ok) {
      notify('Không thể đọc cấu hình giọng', { tone: 'error', message: 'Hãy tải lại trang rồi thử lại.', assertive: true })
      return
    }
    const source = structuredClone(current.data.value)
    const { assistantId: _assistantId, ...draft } = source
    void _assistantId
    const next: RoleConfigDraft = { ...draft, speech: { ...draft.speech, voiceId: value } }
    const result = await gateway.saveRoleConfig(props.assistantId, next, current.data.etag)
    if (!result.ok) {
      notify('Không thể lưu giọng nói', { tone: 'error', message: result.problem.type === 'revision-conflict' ? 'Cấu hình vừa thay đổi ở nơi khác; hãy tải lại.' : 'Hãy kiểm tra kết nối rồi thử lại.', assertive: true })
      return
    }
    selectedTtsVoice.value = value
    notify('Đã lưu giọng nói', { tone: 'success', message: 'Giọng này sẽ được dùng cho câu trả lời của trợ lý.' })
    // Provider selection and role config share one assistant revision. Refresh
    // the workspace so the next mutation always sends the current ETag.
    await load()
  } finally {
    ttsVoiceSaving.value = false
  }
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const result = await gateway.getModelMemory(props.assistantId)
    if (generation !== loadGeneration) return
    if (!result.ok) {
      loadState.value = result.meta.offline ? 'offline' : 'error'
      loadError.value = result.meta.offline
        ? 'Đang ngoại tuyến; chưa thể đồng bộ dịch vụ và phần ghi nhớ.'
        : 'Không tải được dịch vụ và phần ghi nhớ.'
      await focusStateHeading()
      return
    }
    resource.value = result.data
    emit('revision', result.data.revision)
    await loadTtsVoices(result.data.value)
    loadState.value = 'ready'
  } catch {
    if (generation !== loadGeneration) return
    loadState.value = 'offline'
    loadError.value = 'Không kết nối được máy chủ quản trị. Kiểm tra service hoặc mạng LAN.'
    await focusStateHeading()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function focusStateHeading() {
  await nextTick()
  stateHeading.value?.focus()
}

function applyResult(next: Versioned<ModelMemoryWorkspace>) {
  resource.value = next
  emit('revision', next.revision)
}

async function changeProvider(kind: ProviderKind, value: string) {
  if (!resource.value) return
  mutatingKind.value = kind
  const input: UpdateProviderSelectionInput = value === '__disabled__' ? { kind, mode: 'disabled' } : { kind, mode: 'selected', providerConfigId: value }
  const result = await gateway.updateProviderSelection(props.assistantId, input, resource.value.etag)
  mutatingKind.value = undefined
  if (result.ok) {
    applyResult(result.data)
    if (kind === 'tts') await loadTtsVoices(result.data.value)
    notify(`Đã cập nhật ${kindInfo[kind].label}`, { tone: 'success', message: 'Veetee không tự chuyển sang dịch vụ khác.' })
    return
  }
  if (result.problem.type === 'revision-conflict') { conflict.value = result.problem; return }
  const message = result.problem.type === 'provider-unavailable' ? 'Dịch vụ này chưa sẵn sàng; lựa chọn cũ được giữ nguyên.' : result.problem.type === 'offline' ? 'Đang ngoại tuyến; thay đổi đã bị chặn.' : 'Lựa chọn chưa hợp lệ.'
  notify('Không thể đổi dịch vụ', { tone: 'error', message, assertive: true })
}

async function setMemory(enabled: boolean) {
  if (!resource.value) return
  memoryLoading.value = true
  const result = await gateway.setMemoryEnabled(props.assistantId, enabled, resource.value.etag)
  memoryLoading.value = false
  if (result.ok) { applyResult(result.data); notify(enabled ? 'Đã bật bộ nhớ' : 'Đã tắt bộ nhớ', { tone: 'success' }); return }
  if (result.problem.type === 'revision-conflict') conflict.value = result.problem
  else notify('Không thể cập nhật bộ nhớ', { tone: 'error', message: result.problem.type === 'offline' ? 'Đang ngoại tuyến; thay đổi đã bị chặn.' : 'Vui lòng thử lại.', assertive: true })
}

function reloadConflict() {
  if (!conflict.value || !resource.value) return
  resource.value = { value: cloneWorkspace(conflict.value.current), revision: conflict.value.currentRevision, etag: conflict.value.currentEtag }
  emit('revision', conflict.value.currentRevision)
  conflict.value = undefined
  notify('Đã dùng cấu hình mới nhất', { tone: 'success' })
}

async function copyAndReload() {
  if (!conflict.value) return
  copying.value = true
  try { await navigator.clipboard.writeText(JSON.stringify(conflict.value.localDraft, null, 2)); notify('Đã sao chép thay đổi local', { tone: 'success' }); reloadConflict() }
  catch { notify('Không thể truy cập clipboard', { tone: 'error', assertive: true }) }
  finally { copying.value = false }
}

const memoryItems = computed(() => resource.value?.value.memoryItems ?? [])
const ttsVoiceOptions = computed<VtSelectOption[]>(() => ttsVoices.value.map((voice) => ({
  value: voice.ttsVoice,
  label: voice.name,
  description: `${voice.ttsVoice} · ${voice.languages}`,
})))
onMounted(load)
</script>

<template>
  <PreviewScenarioToolbar
    @change="load"
    @reset="load"
  />
  <div
    v-if="loadState === 'loading'"
    class="workspace-loading"
    role="status"
    aria-live="polite"
    aria-label="Đang tải dịch vụ và phần ghi nhớ"
  >
    <VtSkeleton
      v-for="index in 3"
      :key="index"
      height="112px"
    />
  </div>
  <VtCard
    v-else-if="loadState === 'error' || loadState === 'offline'"
    class="model-state model-state-error"
    role="alert"
  >
    <h2
      ref="stateHeading"
      tabindex="-1"
    >
      {{ loadState === 'offline' ? 'Máy chủ quản trị đang ngoại tuyến' : 'Không tải được dịch vụ và phần ghi nhớ' }}
    </h2>
    <p>{{ loadError }}</p>
    <VtButton
      variant="secondary"
      :loading="loading"
      @click="load"
    >
      Thử lại
    </VtButton>
  </VtCard>
  <div
    v-else-if="loadState === 'ready' && resource"
    class="model-memory"
  >
    <FormSection
      title="Dịch vụ đang dùng"
      description="Mỗi nhóm chọn một cấu hình runtime đã tạo. Muốn dùng model khác, tạo cấu hình mới trong Dịch vụ AI rồi quay lại chọn; Veetee không tự chuyển dịch vụ."
    >
      <div class="provider-grid">
        <VtCard
          v-for="kind in PROVIDER_KINDS"
          :key="kind"
          class="provider-card"
        >
          <div class="provider-heading">
            <span class="provider-icon"><VtIcon
              :icon="kind === 'memory' ? Database : BrainCircuit"
              :size="16"
            /></span><div><h3>{{ kindInfo[kind].label }}</h3><p>{{ kindInfo[kind].description }}</p></div><VtBadge
              v-if="mutatingKind === kind"
              tone="primary"
            >
              Đang lưu
            </VtBadge><VtStatus
              v-else
              :tone="selectionStatusTone(kind)"
              :label="selectionStatusLabel(kind)"
            />
          </div>
          <VtSelect
            :model-value="selectionValue(kind)"
            :label="`Dịch vụ ${kindInfo[kind].label}`"
            :options="optionsFor(kind)"
            :disabled="mutatingKind === kind"
            @update:model-value="changeProvider(kind, $event)"
          />
          <div
            v-if="modelFor(kind)"
            class="provider-model-meta"
          >
            <span class="provider-model-label">Model đang dùng</span>
            <RouterLink
              v-if="kind === 'tts'"
              class="provider-model-link"
              :to="{ path: '/providers/tts/voices', query: { modelId: modelFor(kind)?.id } }"
              :title="`${modelLabel(kind)} (${modelFor(kind)?.code})`"
            >
              {{ modelLabel(kind) }} · {{ modelFor(kind)?.code }}
            </RouterLink>
            <span
              v-else
              class="provider-model-value"
              :title="`${modelLabel(kind)} (${modelFor(kind)?.code})`"
            >
              {{ modelLabel(kind) }} · {{ modelFor(kind)?.code }}
            </span>
            <VtBadge
              v-if="modelFor(kind)?.isDefault"
              tone="primary"
            >
              Mặc định
            </VtBadge>
          </div>
          <div
            v-if="kind === 'tts' && modelFor(kind)"
            class="tts-voice-picker"
          >
            <VtSelect
              :model-value="selectedTtsVoice"
              label="Giọng đọc của model TTS"
              :options="ttsVoiceOptions"
              :placeholder="ttsVoiceLoading ? 'Đang tải giọng…' : 'Chọn giọng đọc'"
              :disabled="ttsVoiceLoading || ttsVoiceSaving || !ttsVoiceOptions.length"
              @update:model-value="saveTtsVoice"
            />
            <span
              v-if="ttsVoiceSaving"
              class="tts-voice-state"
            >Đang lưu giọng…</span>
            <span
              v-else-if="!ttsVoiceLoading && !ttsVoiceOptions.length"
              class="tts-voice-state"
            >Model này chưa có voice catalog. Hãy thêm voice ở thư viện.</span>
            <RouterLink
              v-if="modelFor(kind)?.id"
              class="tts-voice-link"
              :to="{ path: '/providers/tts/voices', query: { modelId: modelFor(kind)?.id } }"
            >
              Quản lý thư viện giọng
            </RouterLink>
          </div>
          <div class="provider-config-link">
            <RouterLink :to="`/providers/${kind}`">
              Đổi hoặc thêm cấu hình {{ kindInfo[kind].label.toLocaleLowerCase('vi') }}
            </RouterLink>
            <RouterLink :to="{ path: '/model-config', query: { type: modelTypeForKind(kind) } }">
              Quản lý danh mục model
            </RouterLink>
          </div>
          <p
            v-if="selectionStatus(kind) === 'unavailable'"
            class="provider-error"
          >
            <VtIcon
              :icon="ShieldAlert"
              :size="14"
            /> Lựa chọn hiện tại được giữ nguyên; không tự chuyển sang dịch vụ khác.
          </p>
          <p
            v-else-if="selectionStatus(kind) === 'disabled' && configFor(kind)"
            class="provider-disabled-hint"
          >
            Cấu hình này đã tắt. Bật lại trong
            <RouterLink to="/providers">
              Dịch vụ AI
            </RouterLink> hoặc chọn cấu hình khác.
          </p>
          <p
            v-else-if="selectionStatus(kind) === 'missing'"
            class="provider-disabled-hint"
          >
            Chưa có cấu hình khả dụng cho nhóm này. Hãy tạo một dịch vụ trong
            <RouterLink to="/providers">
              Dịch vụ AI
            </RouterLink>.
          </p>
        </VtCard>
      </div>
    </FormSection>

    <FormSection
      title="Bộ nhớ hội thoại"
      description="Mock item minh họa trạng thái; preview không lưu hội thoại thật."
    >
      <template #trailing>
        <VtSwitch
          :model-value="resource.value.memory.enabled"
          :disabled="memoryLoading"
          label="Bật bộ nhớ"
          @update:model-value="setMemory"
        />
      </template>
      <div
        v-if="memoryItems.length"
        class="memory-list"
      >
        <article
          v-for="item in memoryItems"
          :key="item.id"
          class="memory-item"
          :class="{ disabled: !item.enabled }"
        >
          <VtBadge :tone="item.kind === 'instruction' ? 'primary' : 'neutral'">
            {{ memoryKindLabel(item.kind) }}
          </VtBadge><p>{{ item.content }}</p><VtStatus
            :tone="item.enabled ? 'online' : 'neutral'"
            :label="item.enabled ? 'Đang dùng' : 'Đã tắt'"
          />
        </article>
      </div>
      <p
        v-else
        class="memory-empty"
      >
        Chưa có thông tin được ghi nhớ. Nội dung sẽ xuất hiện khi tính năng này được bật.
      </p>
    </FormSection>
  </div>
  <RevisionConflictDialog
    v-if="conflict"
    :open="true"
    :current-revision="conflict.currentRevision"
    :copying="copying"
    @update:open="!$event && (conflict = undefined)"
    @reload="reloadConflict"
    @copy="copyAndReload"
    @cancel="conflict = undefined"
  />
</template>

<style scoped>
.workspace-loading, .model-memory { display: grid; gap: 14px; }
.model-state { display: grid; justify-items: center; gap: 4px; color: var(--vt-text-muted); padding: 24px; text-align: center; }
.model-state h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.model-state p { max-width: 460px; margin: 3px auto 10px; font-size: 11px; line-height: 1.5; }
.model-state h2:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.provider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.provider-card { min-width: 0; border-radius: 7px; padding: 12px; }
.provider-heading { display: flex; min-height: 42px; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
.provider-icon { display: inline-grid; width: 30px; height: 30px; flex: none; place-items: center; border-radius: 6px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.provider-heading > div { min-width: 0; flex: 1; }
.provider-heading h3 { margin: 0; font-size: 11px; font-weight: 650; }
.provider-heading p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 9px; }
.provider-error { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: var(--vt-danger); font-size: 9px; line-height: 1.45; }
.provider-disabled-hint { margin: 8px 0 0; color: var(--vt-text-muted); font-size: 9px; line-height: 1.45; }
.provider-disabled-hint a { color: var(--vt-primary); font-weight: 600; text-underline-offset: 2px; }
.provider-model-meta { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 8px; color: var(--vt-text-muted); font-size: 9px; }
.provider-model-label { flex: none; color: var(--vt-text-muted); }
.provider-model-value, .provider-model-link { min-width: 0; overflow: hidden; color: var(--vt-text-soft); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.provider-model-link { color: var(--vt-primary); text-decoration: none; text-underline-offset: 2px; }
.provider-model-link:hover { text-decoration: underline; }
.tts-voice-picker { display: grid; gap: 5px; margin-top: 10px; border-top: 1px solid var(--vt-border); padding-top: 9px; }
.tts-voice-picker :deep(.vt-select-trigger) { min-height: 34px; font-size: 11px; }
.tts-voice-state { color: var(--vt-text-muted); font-size: 9px; line-height: 1.4; }
.tts-voice-link, .provider-config-link a { color: var(--vt-primary); font-size: 9px; text-decoration: none; text-underline-offset: 2px; }
.tts-voice-link:hover, .provider-config-link a:hover { text-decoration: underline; }
.provider-config-link { display: grid; gap: 3px; margin-top: 9px; }
.provider-config-link a { color: var(--vt-text-muted); }
.memory-list { display: grid; gap: 8px; }
.memory-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 9px 10px; }
.memory-item.disabled { background: var(--vt-surface-muted); }
.memory-item.disabled p { color: var(--vt-text-muted); }
.memory-item p { margin: 0; color: var(--vt-text-soft); font-size: 10px; line-height: 1.5; }
.memory-empty { margin: 0; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 18px; font-size: 10px; text-align: center; }
@media (max-width: 690px) { .provider-grid { grid-template-columns: 1fr; } .memory-item { grid-template-columns: auto 1fr; } .memory-item :deep(.vt-status) { grid-column: 2; } }
</style>
