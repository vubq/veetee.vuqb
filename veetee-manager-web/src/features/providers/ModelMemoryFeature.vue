<script setup lang="ts">
import { BrainCircuit, Database, ShieldAlert } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import { PROVIDER_KINDS, type ModelMemoryWorkspace, type ProviderKind, type RevisionConflictProblem, type UpdateProviderSelectionInput, type Versioned } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import FormSection from '@/ui/patterns/FormSection.vue'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import { notify } from '@/ui/primitives/notifications'

import RevisionConflictDialog from '@/features/assistants/RevisionConflictDialog.vue'

const props = defineProps<{ assistantId: string }>()
const emit = defineEmits<{ revision: [revision: number] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const resource = ref<Versioned<ModelMemoryWorkspace>>()
const loading = ref(true)
const mutatingKind = ref<ProviderKind>()
const memoryLoading = ref(false)
const conflict = ref<RevisionConflictProblem<ModelMemoryWorkspace, UpdateProviderSelectionInput | { enabled: boolean }>>()
const copying = ref(false)

function cloneWorkspace(workspace: ModelMemoryWorkspace): ModelMemoryWorkspace {
  return {
    assistantId: workspace.assistantId,
    selections: workspace.selections.map((selection) => ({ ...selection })),
    availableConfigs: workspace.availableConfigs.map((config) => ({ ...config, supportedLocales: [...config.supportedLocales] })),
    memory: { ...workspace.memory },
    memoryItems: workspace.memoryItems.map((item) => ({ ...item })),
  }
}

const kindInfo: Record<ProviderKind, { label: string; description: string }> = {
  vad: { label: 'VAD', description: 'Xác định đoạn có giọng nói' },
  asr: { label: 'ASR', description: 'Chuyển giọng nói thành văn bản' },
  llm: { label: 'LLM', description: 'Suy luận, token stream và tool call' },
  tts: { label: 'TTS', description: 'Tổng hợp giọng nói streaming' },
  intent: { label: 'Intent', description: 'Phân loại ý định bổ sung' },
  memory: { label: 'Memory', description: 'Ghi nhớ qua nhiều lượt nói' },
}

function selectionValue(kind: ProviderKind) {
  const selection = resource.value?.value.selections.find((item) => item.kind === kind)
  return selection?.mode === 'selected' ? selection.providerConfigId : '__disabled__'
}

function optionsFor(kind: ProviderKind): VtSelectOption[] {
  const configs = resource.value?.value.availableConfigs.filter((item) => item.kind === kind) ?? []
  const options: VtSelectOption[] = configs.map((config) => ({
    value: config.id,
    label: config.name,
    description: `${config.providerName} · ${config.supportedLocales.join(', ')}`,
    disabled: config.availability !== 'ready',
  }))
  if (kind === 'intent' || kind === 'memory') options.unshift({ value: '__disabled__', label: 'Tắt', description: 'Không dùng provider cho loại này' })
  return options
}

function configFor(kind: ProviderKind) {
  const selected = selectionValue(kind)
  return resource.value?.value.availableConfigs.find((config) => config.id === selected)
}

async function load() {
  loading.value = true
  const result = await gateway.getModelMemory(props.assistantId)
  if (result.ok) { resource.value = result.data; emit('revision', result.data.revision) }
  loading.value = false
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
  if (result.ok) { applyResult(result.data); notify(`Đã cập nhật ${kindInfo[kind].label}`, { tone: 'success', message: 'Không có provider fallback tự động.' }); return }
  if (result.problem.type === 'revision-conflict') { conflict.value = result.problem; return }
  const message = result.problem.type === 'provider-unavailable' ? 'Provider này đang không khả dụng; selection cũ được giữ nguyên.' : result.problem.type === 'offline' ? 'Đang ngoại tuyến; thay đổi đã bị chặn.' : 'Selection không hợp lệ.'
  notify('Không thể đổi provider', { tone: 'error', message, assertive: true })
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
  notify('Đã tải revision mới', { tone: 'success' })
}

async function copyAndReload() {
  if (!conflict.value) return
  copying.value = true
  try { await navigator.clipboard.writeText(JSON.stringify(conflict.value.localDraft, null, 2)); notify('Đã sao chép thay đổi local', { tone: 'success' }); reloadConflict() }
  catch { notify('Không thể truy cập clipboard', { tone: 'error', assertive: true }) }
  finally { copying.value = false }
}

const memoryItems = computed(() => resource.value?.value.memoryItems ?? [])
onMounted(load)
</script>

<template>
  <PreviewScenarioToolbar
    @change="load"
    @reset="load"
  />
  <div
    v-if="loading"
    class="workspace-loading"
  >
    <VtSkeleton
      v-for="index in 3"
      :key="index"
      height="112px"
    />
  </div>
  <div
    v-else-if="resource"
    class="model-memory"
  >
    <FormSection
      title="Provider đang sử dụng"
      description="Mỗi loại chỉ có một selection; phiên bản hiện tại không tự fallback."
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
              :tone="configFor(kind)?.availability === 'unavailable' ? 'error' : 'online'"
              :label="configFor(kind)?.availability === 'unavailable' ? 'Không khả dụng' : selectionValue(kind) === '__disabled__' ? 'Đã tắt' : 'Sẵn sàng'"
            />
          </div>
          <VtSelect
            :model-value="selectionValue(kind)"
            :label="`Provider ${kindInfo[kind].label}`"
            :options="optionsFor(kind)"
            :disabled="mutatingKind === kind"
            @update:model-value="changeProvider(kind, $event)"
          />
          <p
            v-if="configFor(kind)?.availability === 'unavailable'"
            class="provider-error"
          >
            <VtIcon
              :icon="ShieldAlert"
              :size="14"
            /> Selection được giữ nguyên; không chuyển sang provider khác.
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
            {{ item.kind }}
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
        Chưa có memory item. Dữ liệu sẽ chỉ xuất hiện sau khi backend thật được triển khai và policy được duyệt.
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
.provider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.provider-card { min-width: 0; border-radius: 7px; padding: 12px; }
.provider-heading { display: flex; min-height: 42px; align-items: flex-start; gap: 8px; margin-bottom: 10px; }
.provider-icon { display: inline-grid; width: 30px; height: 30px; flex: none; place-items: center; border-radius: 6px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.provider-heading > div { min-width: 0; flex: 1; }
.provider-heading h3 { margin: 0; font-size: 11px; font-weight: 650; }
.provider-heading p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 9px; }
.provider-error { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: var(--vt-danger); font-size: 9px; line-height: 1.45; }
.memory-list { display: grid; gap: 8px; }
.memory-item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 9px 10px; }
.memory-item.disabled { background: var(--vt-surface-muted); }
.memory-item.disabled p { color: var(--vt-text-muted); }
.memory-item p { margin: 0; color: var(--vt-text-soft); font-size: 10px; line-height: 1.5; }
.memory-empty { margin: 0; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 18px; font-size: 10px; text-align: center; }
@media (max-width: 690px) { .provider-grid { grid-template-columns: 1fr; } .memory-item { grid-template-columns: auto 1fr; } .memory-item :deep(.vt-status) { grid-column: 2; } }
</style>
