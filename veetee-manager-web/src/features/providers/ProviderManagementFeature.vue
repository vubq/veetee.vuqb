<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Archive, Check, Copy, Grid2X2, KeyRound, List, Pencil, Play, Plus, Search, SlidersHorizontal } from '@lucide/vue'

import { requireInjection } from '@/app/requireInjection'
import type { ProviderConfigRecord, ProviderInstallationView, ProviderKind, ProviderProbeResult, SecretReference } from '@/domain'
import { PROVIDER_KINDS } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import { notify } from '@/ui/primitives/notifications'

import SchemaConfigForm from './SchemaConfigForm.vue'
import SecretReferencePanel from './SecretReferencePanel.vue'
import { cloneConfig, humanizeSchemaKey, isRecord } from './schema-config'
import { normalizeProviderDraft, providerEditorProfile } from './provider-editor'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const props = withDefaults(defineProps<{ initialKind?: ProviderKind }>(), { initialKind: undefined })

type WorkspaceTab = 'configured' | 'catalog' | 'secrets'
type EditorMode = 'create' | 'edit'
type EditorStep = 'provider' | 'details'

const kindLabels: Record<ProviderKind, string> = {
  vad: 'Lọc tiếng ồn',
  asr: 'Nhận dạng lời nói',
  llm: 'Bộ não trả lời',
  tts: 'Giọng nói',
  intent: 'Hiểu ý định',
  memory: 'Ghi nhớ',
}
const kindDescriptions: Record<ProviderKind, string> = {
  vad: 'Nhận biết khi bạn bắt đầu và dừng nói.',
  asr: 'Đổi giọng nói thành văn bản để AI hiểu.',
  llm: 'Sinh câu trả lời, streaming và gọi công cụ.',
  tts: 'Đọc câu trả lời thành tiếng theo thời gian thực.',
  intent: 'Nhận diện các yêu cầu thao tác đặc biệt.',
  memory: 'Giữ lại ngữ cảnh theo chính sách của bạn.',
}
const kindOptions: VtSelectOption[] = [
  { value: 'all', label: 'Tất cả loại dịch vụ' },
  ...PROVIDER_KINDS.map((kind) => ({ value: kind, label: kindLabels[kind], description: kindDescriptions[kind] })),
]
const statusOptions: VtSelectOption[] = [
  { value: 'all', label: 'Mọi trạng thái' },
  { value: 'enabled', label: 'Đang bật' },
  { value: 'disabled', label: 'Đã tắt' },
  { value: 'attention', label: 'Cần kiểm tra' },
]

const tab = ref<WorkspaceTab>('configured')
const activeKind = ref<ProviderKind | 'all'>(props.initialKind ?? 'all')
const query = ref('')
const statusFilter = ref('all')
const viewMode = ref<'table' | 'cards'>('table')
const installations = ref<ProviderInstallationView[]>([])
const configs = ref<ProviderConfigRecord[]>([])
const secrets = ref<SecretReference[]>([])
const probeResults = ref<Record<string, ProviderProbeResult | undefined>>({})
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const probingId = ref('')
const togglingId = ref('')
const archiveTargets = ref<ProviderConfigRecord[]>([])
const archiveBusy = ref(false)
const fieldTarget = ref<{ config: ProviderConfigRecord; installation: ProviderInstallationView }>()
const selectedConfigIds = ref<string[]>([])

const editorOpen = ref(false)
const editorMode = ref<EditorMode>('create')
const editorStep = ref<EditorStep>('provider')
const editorKind = ref<ProviderKind | 'all'>(props.initialKind ?? 'all')
const editorInstallationId = ref('')
const editorConfigId = ref('')
const editorName = ref('')
const editorDraft = ref<Record<string, unknown>>({})
const editorSecretIds = ref<string[]>([])
const editorValid = ref(true)
const editorError = ref('')

const installationById = computed(() => new Map(installations.value.map((item) => [item.id, item])))
const selectedInstallation = computed(() => installationById.value.get(editorInstallationId.value))
const selectedProfile = computed(() => selectedInstallation.value ? providerEditorProfile(selectedInstallation.value) : undefined)
const filteredInstallations = computed(() => installations.value.filter((item) => editorKind.value === 'all' || item.kind === editorKind.value))

const rows = computed(() => configs.value.map((config) => {
  const installation = installationById.value.get(config.installationId)
  return { config, installation }
}).filter((row): row is { config: ProviderConfigRecord; installation: ProviderInstallationView } => Boolean(row.installation)))

const visibleRows = computed(() => {
  const normalized = normalizeSearch(query.value)
  return rows.value.filter(({ config, installation }) => {
    const matchesKind = activeKind.value === 'all' || installation.kind === activeKind.value
    const status = statusFor(config)
    const matchesStatus = statusFilter.value === 'all'
      || statusFilter.value === 'enabled' && config.enabled
      || statusFilter.value === 'disabled' && !config.enabled
      || statusFilter.value === 'attention' && status === 'attention'
    const haystack = normalizeSearch(`${config.name} ${installation.displayName ?? installation.displayNameKey} ${kindLabels[installation.kind]} ${modelLabel(config, installation)}`)
    return matchesKind && matchesStatus && (!normalized || haystack.includes(normalized))
  })
})
const allVisibleSelected = computed(() => visibleRows.value.length > 0 && visibleRows.value.every(({ config }) => selectedConfigIds.value.includes(config.id)))
const selectedRows = computed(() => rows.value.filter(({ config }) => selectedConfigIds.value.includes(config.id)))

const catalogCards = computed(() => installations.value
  .filter((installation) => activeKind.value === 'all' || installation.kind === activeKind.value)
  .map((installation) => ({ installation, configCount: configs.value.filter((config) => config.installationId === installation.id).length })))

const totalEnabled = computed(() => configs.value.filter((config) => config.enabled).length)
const attentionCount = computed(() => configs.value.filter((config) => statusFor(config) === 'attention').length)
const kindCount = computed(() => new Set(configs.value.map((config) => installationById.value.get(config.installationId)?.kind).filter(Boolean)).size)

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('vi')
}

function localeLabel(value: string): string {
  if (!value || value === '*') return 'Đa ngôn ngữ'
  if (value === 'vi' || value === 'vi-VN') return 'Tiếng Việt'
  if (value === 'en' || value === 'en-US') return 'English'
  return value
}

function capabilityLabel(kind: ProviderKind): string {
  return kindLabels[kind]
}

function modelLabel(config: ProviderConfigRecord, installation: ProviderInstallationView): string {
  const entries = Object.entries(config.config)
  const modelEntry = entries.find(([key, value]) => /model|voice|checkpoint|artifact/i.test(key) && (typeof value === 'string' || typeof value === 'number'))
  if (modelEntry && String(modelEntry[1]).trim()) return String(modelEntry[1])
  const properties = isRecord(installation.configSchema.properties) ? installation.configSchema.properties : {}
  const schemaModel = Object.keys(properties).find((key) => /model|voice|checkpoint|artifact/i.test(key))
  return schemaModel ? 'Chưa chọn model' : 'Cấu hình theo dịch vụ'
}

function schemaFieldEntries(installation: ProviderInstallationView): Array<{ key: string; label: string; type: string; required: boolean; sensitive: boolean }> {
  const properties = isRecord(installation.configSchema.properties) ? installation.configSchema.properties : {}
  const required = new Set(Array.isArray(installation.configSchema.required) ? installation.configSchema.required.filter((value): value is string => typeof value === 'string') : [])
  return Object.entries(properties).map(([key, value]) => {
    const schema = isRecord(value) ? value : {}
    const type = typeof schema.type === 'string' ? schema.type : Array.isArray(schema.type) ? schema.type.join(' | ') : 'object'
    return { key, label: typeof schema.title === 'string' ? schema.title : humanizeSchemaKey(key), type, required: required.has(key), sensitive: /key|token|secret|password|credential/i.test(key) }
  })
}

function fieldValue(config: ProviderConfigRecord, field: { key: string; sensitive: boolean }): string {
  if (field.sensitive && field.key in config.config) return 'Được bảo vệ'
  const value = config.config[field.key]
  if (value === undefined || value === null || value === '') return 'Chưa đặt'
  if (typeof value === 'object') return 'JSON nâng cao'
  return String(value)
}

function statusFor(config: ProviderConfigRecord): 'ready' | 'disabled' | 'attention' {
  if (!config.enabled) return 'disabled'
  return probeResults.value[config.id]?.state === 'unavailable' ? 'attention' : 'ready'
}

function statusTone(config: ProviderConfigRecord): 'online' | 'neutral' | 'warning' | 'error' {
  const status = statusFor(config)
  return status === 'ready' ? 'online' : status === 'disabled' ? 'neutral' : 'warning'
}

function statusLabel(config: ProviderConfigRecord): string {
  const status = statusFor(config)
  return status === 'ready' ? 'Sẵn sàng' : status === 'disabled' ? 'Đã tắt' : 'Cần kiểm tra'
}

function capabilityFor(config: ProviderConfigRecord): ProviderKind {
  return installationById.value.get(config.installationId)?.kind ?? 'memory'
}

function capabilitiesFor(installation: ProviderInstallationView): string[] {
  return installation.capabilities.slice(0, 3).map((value) => value === 'streaming' ? 'Streaming' : value === 'tools' ? 'Gọi công cụ' : value === 'cancel' ? 'Ngắt được' : value)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [catalog, configured, secretList] = await Promise.all([
      gateway.listProviderInstallations(),
      gateway.listProviderConfigs(),
      gateway.listSecretReferences(),
    ])
    if (!catalog.ok || !configured.ok || !secretList.ok) {
      loadError.value = 'Không tải được danh sách dịch vụ. Hãy kiểm tra máy chủ quản trị rồi thử lại.'
      return
    }
    installations.value = catalog.data
    configs.value = configured.data
    secrets.value = secretList.data
    selectedConfigIds.value = selectedConfigIds.value.filter((id) => configured.data.some((item) => item.id === id))
    if (activeKind.value !== 'all' && !catalog.data.some((item) => item.kind === activeKind.value)) activeKind.value = 'all'
  } catch {
    loadError.value = 'Không kết nối được máy chủ quản trị. Hãy thử lại sau.'
  } finally {
    loading.value = false
  }
}

function replaceConfig(value: ProviderConfigRecord) {
  configs.value = [...configs.value.filter((item) => item.id !== value.id), value]
}

function toggleConfigSelected(id: string, checked: boolean) {
  selectedConfigIds.value = checked
    ? [...new Set([...selectedConfigIds.value, id])]
    : selectedConfigIds.value.filter((value) => value !== id)
}

function toggleAllVisible(checked: boolean) {
  const visibleIds = visibleRows.value.map(({ config }) => config.id)
  selectedConfigIds.value = checked
    ? [...new Set([...selectedConfigIds.value, ...visibleIds])]
    : selectedConfigIds.value.filter((id) => !visibleIds.includes(id))
}

function openCreate(installationId = '') {
  editorMode.value = 'create'
  editorStep.value = installationId ? 'details' : 'provider'
  editorKind.value = activeKind.value
  editorInstallationId.value = installationId
  editorConfigId.value = ''
  editorName.value = ''
  editorDraft.value = {}
  editorSecretIds.value = []
  editorValid.value = true
  editorError.value = ''
  editorOpen.value = true
}

function openEdit(config: ProviderConfigRecord, duplicate = false) {
  const installation = installationById.value.get(config.installationId)
  if (!installation) return
  editorMode.value = duplicate ? 'create' : 'edit'
  editorStep.value = 'details'
  editorKind.value = installation.kind
  editorInstallationId.value = installation.id
  editorConfigId.value = duplicate ? '' : config.id
  editorName.value = duplicate ? `${config.name} (bản sao)` : config.name
  editorDraft.value = normalizeProviderDraft(installation, cloneConfig(config.config))
  editorSecretIds.value = [...config.secretRefs]
  editorValid.value = true
  editorError.value = ''
  editorOpen.value = true
}

function closeEditor() {
  if (!saving.value) editorOpen.value = false
}

function chooseInstallation(id: string) {
  const installation = installationById.value.get(id)
  if (!installation) return
  editorInstallationId.value = id
  editorDraft.value = {}
  editorStep.value = 'details'
  editorValid.value = true
}

function editSecretSelection(id: string, checked: boolean) {
  const next = new Set(editorSecretIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  editorSecretIds.value = [...next]
}

async function saveEditor() {
  const installation = selectedInstallation.value
  if (!installation || !editorName.value.trim() || !editorValid.value) return
  saving.value = true
  editorError.value = ''
  const payload = { name: editorName.value.trim(), config: normalizeProviderDraft(installation, cloneConfig(editorDraft.value)), secretRefs: [...editorSecretIds.value] }
  try {
    const current = configs.value.find((item) => item.id === editorConfigId.value)
    const result = editorMode.value === 'edit' && current
      ? await gateway.updateProviderConfig(current.id, payload, current.etag)
      : await gateway.createProviderConfig({ installationId: installation.id, ...payload })
    if (!result.ok) {
      editorError.value = result.meta.offline ? 'Đang ngoại tuyến; thay đổi chưa được gửi.' : 'Không thể lưu. Hãy kiểm tra tên, khóa kết nối và các trường bắt buộc.'
      return
    }
    replaceConfig(result.data)
    editorOpen.value = false
    tab.value = 'configured'
    notify(editorMode.value === 'edit' ? 'Đã cập nhật dịch vụ' : 'Đã thêm dịch vụ', { tone: 'success', message: 'Bạn có thể chọn dịch vụ này cho từng trợ lý trong phần Mô hình & bộ nhớ.' })
  } finally {
    saving.value = false
  }
}

async function probe(config: ProviderConfigRecord) {
  probingId.value = config.id
  const result = await gateway.probeProviderConfig(config.id)
  probingId.value = ''
  if (!result.ok) {
    notify('Không thể kiểm tra dịch vụ', { tone: 'error', message: result.meta.offline ? 'Máy chủ quản trị đang ngoại tuyến.' : 'Cấu hình không còn khả dụng.', assertive: true })
    return
  }
  probeResults.value = { ...probeResults.value, [config.id]: result.data }
  notify(result.data.state === 'ready' ? 'Dịch vụ sẵn sàng' : 'Dịch vụ cần kiểm tra', { tone: result.data.state === 'ready' ? 'success' : 'warning', message: result.data.checks.map((check) => check.message).join(' · '), assertive: result.data.state !== 'ready' })
}

async function toggleEnabled(config: ProviderConfigRecord) {
  togglingId.value = config.id
  const result = await gateway.setProviderConfigEnabled(config.id, !config.enabled, config.etag)
  togglingId.value = ''
  if (!result.ok) {
    notify('Không thể đổi trạng thái', { tone: 'error', message: result.meta.offline ? 'Máy chủ quản trị đang ngoại tuyến.' : 'Dịch vụ có thể đang được một trợ lý sử dụng.', assertive: true })
    return
  }
  replaceConfig(result.data)
  notify(result.data.enabled ? 'Đã bật dịch vụ' : 'Đã tắt dịch vụ', { tone: 'success', message: result.data.enabled ? 'Dịch vụ sẵn sàng để chọn.' : 'Cấu hình được giữ lại, nhưng không còn xuất hiện trong lựa chọn mới.' })
}

async function archive() {
  const targets = archiveTargets.value.slice()
  if (!targets.length) return
  archiveBusy.value = true
  const results = await Promise.all(targets.map((target) => gateway.deleteProviderConfig(target.id, target.etag)))
  archiveBusy.value = false
  const archivedIds = targets.filter((_, index) => results[index]?.ok).map((target) => target.id)
  if (archivedIds.length) configs.value = configs.value.filter((item) => !archivedIds.includes(item.id))
  selectedConfigIds.value = selectedConfigIds.value.filter((id) => !archivedIds.includes(id))
  archiveTargets.value = []
  if (archivedIds.length !== targets.length) {
    notify('Không thể lưu trữ dịch vụ', { tone: 'error', message: 'Dịch vụ có thể đang được trợ lý sử dụng hoặc vừa thay đổi.', assertive: true })
    return
  }
  notify(targets.length === 1 ? 'Đã lưu trữ dịch vụ' : `Đã lưu trữ ${targets.length} dịch vụ`, { tone: 'success', message: 'Các revision cũ vẫn được giữ lại để truy vết.' })
}

function requestArchive(target: ProviderConfigRecord) {
  archiveTargets.value = [target]
}

function requestArchiveSelected() {
  if (selectedRows.value.length) archiveTargets.value = selectedRows.value.map(({ config }) => config)
}

function goToSecrets() {
  editorOpen.value = false
  tab.value = 'secrets'
}

function localeList(installation: ProviderInstallationView): string {
  return installation.supportedLocales.length ? installation.supportedLocales.map(localeLabel).join(', ') : 'Đa ngôn ngữ'
}

watch(() => props.initialKind, (kind) => {
  if (kind) activeKind.value = kind
})

onMounted(load)
</script>

<template>
  <main
    id="main-content"
    class="page-container provider-management"
    :aria-busy="loading"
  >
    <header class="management-header">
      <div>
        <p class="eyebrow">
          Dịch vụ AI
        </p>
        <h1>Quản lý provider và model</h1>
        <p class="lede">
          Thêm nhiều dịch vụ, lưu các model khác nhau và chọn dịch vụ phù hợp cho từng trợ lý.
        </p>
      </div>
      <VtButton
        variant="primary"
        @click="openCreate()"
      >
        <template #leading>
          <VtIcon
            :icon="Plus"
            :size="15"
          />
        </template>
        Thêm dịch vụ
      </VtButton>
    </header>

    <div
      class="summary-grid"
      aria-label="Tổng quan dịch vụ"
    >
      <VtCard class="summary-card">
        <span class="summary-value">{{ configs.length }}</span><span class="summary-label">Dịch vụ đã lưu</span>
      </VtCard>
      <VtCard class="summary-card">
        <span class="summary-value">{{ totalEnabled }}</span><span class="summary-label">Đang bật</span>
      </VtCard>
      <VtCard class="summary-card">
        <span class="summary-value">{{ kindCount }}/{{ PROVIDER_KINDS.length }}</span><span class="summary-label">Loại đã có cấu hình</span>
      </VtCard>
      <VtCard
        class="summary-card"
        :class="{ 'has-attention': attentionCount > 0 }"
      >
        <span class="summary-value">{{ attentionCount }}</span><span class="summary-label">Cần kiểm tra</span>
      </VtCard>
    </div>

    <VtCard
      v-if="loadError"
      class="state-card"
      role="alert"
    >
      <h2>Chưa thể tải dịch vụ</h2><p>{{ loadError }}</p><VtButton
        variant="secondary"
        @click="load"
      >
        Thử lại
      </VtButton>
    </VtCard>

    <template v-else>
      <nav
        class="workspace-tabs"
        aria-label="Khu vực quản lý dịch vụ"
      >
        <button
          type="button"
          :class="{ active: tab === 'configured' }"
          @click="tab = 'configured'"
        >
          <VtIcon
            :icon="List"
            :size="15"
          />Đã cấu hình <span>{{ configs.length }}</span>
        </button>
        <button
          type="button"
          :class="{ active: tab === 'catalog' }"
          @click="tab = 'catalog'"
        >
          <VtIcon
            :icon="Grid2X2"
            :size="15"
          />Thư viện provider/model <span>{{ installations.length }}</span>
        </button>
        <button
          type="button"
          :class="{ active: tab === 'secrets' }"
          @click="tab = 'secrets'"
        >
          <VtIcon
            :icon="KeyRound"
            :size="15"
          />Khóa kết nối <span>{{ secrets.length }}</span>
        </button>
      </nav>

      <section
        class="workspace-toolbar"
        aria-label="Bộ lọc dịch vụ"
      >
        <div class="kind-filter">
          <button
            type="button"
            :class="{ active: activeKind === 'all' }"
            @click="activeKind = 'all'"
          >
            Tất cả
          </button>
          <button
            v-for="kind in PROVIDER_KINDS"
            :key="kind"
            type="button"
            :class="{ active: activeKind === kind }"
            @click="activeKind = kind"
          >
            {{ kindLabels[kind] }}
          </button>
        </div>
        <div class="toolbar-actions">
          <VtInput
            v-model="query"
            :icon="Search"
            aria-label="Tìm dịch vụ"
            placeholder="Tìm theo tên, provider hoặc model…"
          />
          <VtSelect
            v-model="statusFilter"
            label="Lọc trạng thái"
            :options="statusOptions"
          />
          <div
            class="view-toggle"
            aria-label="Kiểu hiển thị"
          >
            <button
              type="button"
              :aria-pressed="viewMode === 'table'"
              aria-label="Hiển thị dạng bảng"
              @click="viewMode = 'table'"
            >
              <VtIcon
                :icon="List"
                :size="15"
              />
            </button>
            <button
              type="button"
              :aria-pressed="viewMode === 'cards'"
              aria-label="Hiển thị dạng thẻ"
              @click="viewMode = 'cards'"
            >
              <VtIcon
                :icon="Grid2X2"
                :size="15"
              />
            </button>
          </div>
        </div>
      </section>
      <div
        v-if="selectedConfigIds.length"
        class="batch-toolbar"
        role="status"
      >
        <span>Đã chọn {{ selectedConfigIds.length }} dịch vụ</span>
        <VtButton
          size="sm"
          variant="ghost"
          @click="selectedConfigIds = []"
        >
          Bỏ chọn
        </VtButton>
        <VtButton
          size="sm"
          variant="danger"
          @click="requestArchiveSelected"
        >
          Lưu trữ đã chọn
        </VtButton>
      </div>

      <section
        v-if="tab === 'configured'"
        class="configured-section"
        aria-label="Dịch vụ đã cấu hình"
      >
        <VtCard
          v-if="viewMode === 'table'"
          class="table-card"
          :padding="false"
        >
          <div class="table-wrap">
            <table class="provider-table">
              <thead>
                <tr>
                  <th class="selection-column">
                    <VtCheckbox
                      label="Chọn tất cả"
                      :model-value="allVisibleSelected"
                      @update:model-value="toggleAllVisible"
                    />
                  </th><th>Dịch vụ</th><th>Loại</th><th>Model / cấu hình</th><th>Trường cấu hình</th><th>Ngôn ngữ</th><th>Trạng thái</th><th class="action-column">
                    Thao tác
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in visibleRows"
                  :key="row.config.id"
                >
                  <td class="selection-cell">
                    <VtCheckbox
                      :label="`Chọn ${row.config.name}`"
                      :model-value="selectedConfigIds.includes(row.config.id)"
                      @update:model-value="toggleConfigSelected(row.config.id, $event)"
                    />
                  </td>
                  <td>
                    <div class="service-cell">
                      <strong :title="row.config.name">{{ row.config.name }}</strong><span :title="row.installation.displayName ?? row.installation.displayNameKey">{{ row.installation.displayName ?? row.installation.displayNameKey }}</span>
                    </div>
                  </td>
                  <td>
                    <VtBadge tone="primary">
                      {{ capabilityFor(row.config) && capabilityLabel(capabilityFor(row.config)) }}
                    </VtBadge>
                  </td>
                  <td>
                    <span
                      class="truncate"
                      :title="modelLabel(row.config, row.installation)"
                    >{{ modelLabel(row.config, row.installation) }}</span>
                  </td>
                  <td>
                    <VtButton
                      size="sm"
                      variant="ghost"
                      class="field-summary-button"
                      @click="fieldTarget = row"
                    >
                      {{ schemaFieldEntries(row.installation).length }} trường
                    </VtButton>
                  </td>
                  <td>
                    <span
                      class="truncate"
                      :title="localeList(row.installation)"
                    >{{ localeList(row.installation) }}</span>
                  </td>
                  <td>
                    <div class="status-cell">
                      <VtStatus
                        :tone="statusTone(row.config)"
                        :label="statusLabel(row.config)"
                      /><VtSwitch
                        :model-value="row.config.enabled"
                        label="Bật"
                        :aria-label="`Bật ${row.config.name}`"
                        :disabled="togglingId === row.config.id"
                        @update:model-value="toggleEnabled(row.config)"
                      />
                    </div>
                  </td>
                  <td class="action-cell">
                    <div class="action-buttons">
                      <VtButton
                        size="sm"
                        variant="ghost"
                        :aria-label="`Chỉnh sửa ${row.config.name}`"
                        :title="`Chỉnh sửa ${row.config.name}`"
                        @click="openEdit(row.config)"
                      >
                        <template #leading>
                          <VtIcon
                            :icon="Pencil"
                            :size="14"
                          />
                        </template>
                      </VtButton><VtButton
                        size="sm"
                        variant="ghost"
                        :aria-label="`Nhân bản ${row.config.name}`"
                        :title="`Nhân bản ${row.config.name}`"
                        @click="openEdit(row.config, true)"
                      >
                        <template #leading>
                          <VtIcon
                            :icon="Copy"
                            :size="14"
                          />
                        </template>
                      </VtButton><VtButton
                        size="sm"
                        variant="ghost"
                        :loading="probingId === row.config.id"
                        :aria-label="`Kiểm tra ${row.config.name}`"
                        :title="`Kiểm tra ${row.config.name}`"
                        @click="probe(row.config)"
                      >
                        <template #leading>
                          <VtIcon
                            :icon="Play"
                            :size="13"
                          />
                        </template>
                      </VtButton><VtButton
                        size="sm"
                        variant="ghost"
                        :aria-label="`Lưu trữ ${row.config.name}`"
                        :title="`Lưu trữ ${row.config.name}`"
                        @click="requestArchive(row.config)"
                      >
                        <template #leading>
                          <VtIcon
                            :icon="Archive"
                            :size="13"
                          />
                        </template>
                      </VtButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="!visibleRows.length"
              class="empty-table"
            >
              <VtIcon
                :icon="SlidersHorizontal"
                :size="20"
              /><strong>{{ configs.length ? 'Không có dịch vụ phù hợp' : 'Chưa có dịch vụ nào' }}</strong><p>{{ configs.length ? 'Thử đổi bộ lọc hoặc từ khóa tìm kiếm.' : 'Chọn Thêm dịch vụ để tạo cấu hình đầu tiên.' }}</p><VtButton
                v-if="!configs.length"
                variant="primary"
                size="sm"
                @click="openCreate()"
              >
                Thêm dịch vụ
              </VtButton>
            </div>
          </div>
        </VtCard>

        <div
          v-else
          class="config-card-grid"
        >
          <VtCard
            v-for="row in visibleRows"
            :key="row.config.id"
            class="config-tile"
            :class="{ disabled: !row.config.enabled }"
          >
            <header>
              <div class="tile-heading">
                <VtBadge tone="primary">
                  {{ capabilityLabel(capabilityFor(row.config)) }}
                </VtBadge><VtStatus
                  :tone="statusTone(row.config)"
                  :label="statusLabel(row.config)"
                />
              </div><h2 :title="row.config.name">
                {{ row.config.name }}
              </h2><p :title="row.installation.displayName ?? row.installation.displayNameKey">
                {{ row.installation.displayName ?? row.installation.displayNameKey }}
              </p>
            </header>
            <dl>
              <div>
                <dt>Model</dt><dd :title="modelLabel(row.config, row.installation)">
                  {{ modelLabel(row.config, row.installation) }}
                </dd>
              </div><div>
                <dt>Ngôn ngữ</dt><dd :title="localeList(row.installation)">
                  {{ localeList(row.installation) }}
                </dd>
              </div>
            </dl>
            <footer>
              <VtSwitch
                :model-value="row.config.enabled"
                :label="row.config.enabled ? 'Đang bật' : 'Đã tắt'"
                :disabled="togglingId === row.config.id"
                @update:model-value="toggleEnabled(row.config)"
              /><div>
                <VtButton
                  size="sm"
                  variant="ghost"
                  @click="openEdit(row.config)"
                >
                  Sửa
                </VtButton><VtButton
                  size="sm"
                  variant="ghost"
                  @click="probe(row.config)"
                >
                  Kiểm tra
                </VtButton>
              </div>
            </footer>
          </VtCard>
        </div>
      </section>

      <section
        v-else-if="tab === 'catalog'"
        class="catalog-section"
        aria-label="Thư viện provider và model"
      >
        <div class="catalog-intro">
          <div>
            <p class="eyebrow">
              Provider có sẵn
            </p><h2>Chọn nền tảng rồi tạo cấu hình riêng</h2><p>Một provider có thể có nhiều model hoặc nhiều cấu hình. Bạn không cần sửa code để thêm một cấu hình mới.</p>
          </div><VtBadge tone="primary">
            {{ catalogCards.length }} loại
          </VtBadge>
        </div>
        <div class="catalog-grid">
          <VtCard
            v-for="card in catalogCards"
            :key="card.installation.id"
            class="catalog-tile"
          >
            <div class="catalog-icon">
              <VtIcon
                :icon="Grid2X2"
                :size="19"
              />
            </div><div class="catalog-copy">
              <div class="tile-heading">
                <VtBadge tone="primary">
                  {{ kindLabels[card.installation.kind] }}
                </VtBadge><span class="catalog-count">{{ card.configCount }} cấu hình</span>
              </div><h2 :title="card.installation.displayName ?? card.installation.displayNameKey">
                {{ card.installation.displayName ?? card.installation.displayNameKey }}
              </h2><p>{{ localeList(card.installation) }}</p><div class="capability-pills">
                <span
                  v-for="capability in capabilitiesFor(card.installation)"
                  :key="capability"
                >{{ capability }}</span>
              </div>
            </div><VtButton
              size="sm"
              variant="secondary"
              @click="openCreate(card.installation.id)"
            >
              Tạo cấu hình
            </VtButton>
          </VtCard>
        </div>
        <p
          v-if="!catalogCards.length"
          class="empty-inline"
        >
          Không có provider/model cho bộ lọc này.
        </p>
      </section>

      <section
        v-else
        class="secrets-section"
        aria-label="Quản lý khóa kết nối"
      >
        <SecretReferencePanel
          :gateway="gateway"
          :items="secrets"
          :selected-ids="editorSecretIds"
          @update:selected-ids="editorSecretIds = $event"
          @changed="load"
        />
      </section>
    </template>

    <VtDialog
      :open="editorOpen"
      :title="editorMode === 'edit' ? 'Chỉnh sửa dịch vụ' : 'Thêm dịch vụ mới'"
      :description="editorStep === 'provider' ? 'Chọn loại dịch vụ và provider/model bạn muốn dùng.' : 'Đặt tên dễ nhớ và điền các thông số kết nối. Form này được tạo tự động theo dịch vụ đã chọn.'"
      width="lg"
      @update:open="!$event && closeEditor()"
    >
      <div
        v-if="editorStep === 'provider'"
        class="editor-picker"
      >
        <VtFormField
          label="Loại dịch vụ"
          for-id="provider-editor-kind"
        >
          <VtSelect
            id="provider-editor-kind"
            v-model="editorKind"
            label="Loại dịch vụ"
            :options="kindOptions"
          />
        </VtFormField>
        <div class="picker-grid">
          <button
            v-for="installation in filteredInstallations"
            :key="installation.id"
            type="button"
            class="picker-option"
            :class="{ selected: editorInstallationId === installation.id }"
            @click="chooseInstallation(installation.id)"
          >
            <span class="picker-icon"><VtIcon
              :icon="Grid2X2"
              :size="18"
            /></span><span class="picker-copy"><strong :title="installation.displayName ?? installation.displayNameKey">{{ installation.displayName ?? installation.displayNameKey }}</strong><small>{{ kindLabels[installation.kind] }} · {{ localeList(installation) }}</small></span><Check
              v-if="editorInstallationId === installation.id"
              :size="16"
              class="picker-check"
            />
          </button>
        </div>
        <p
          v-if="!filteredInstallations.length"
          class="empty-inline"
        >
          Chưa có provider/model cho loại dịch vụ này.
        </p>
      </div>
      <div
        v-else-if="selectedInstallation"
        class="editor-details"
      >
        <div class="selected-provider">
          <div class="picker-icon">
            <VtIcon
              :icon="Grid2X2"
              :size="18"
            />
          </div><div><strong>{{ selectedInstallation.displayName ?? selectedInstallation.displayNameKey }}</strong><span>{{ kindLabels[selectedInstallation.kind] }} · {{ localeList(selectedInstallation) }}</span></div><VtButton
            size="sm"
            variant="ghost"
            :disabled="saving"
            @click="editorStep = 'provider'"
          >
            Đổi
          </VtButton>
        </div>
        <div
          v-if="selectedProfile"
          class="provider-explainer"
        >
          <div class="provider-explainer-heading">
            <div>
              <strong>{{ selectedProfile.familyLabel }}</strong>
              <span>{{ selectedProfile.protocolLabel }}</span>
            </div>
            <VtBadge tone="neutral">
              {{ selectedProfile.hasVoiceCatalog ? 'Có thư viện giọng' : 'Cấu hình linh hoạt' }}
            </VtBadge>
          </div>
          <p>{{ selectedProfile.summary }}</p>
          <div class="provider-explainer-fields">
            <span
              v-for="field in selectedProfile.standardFields"
              :key="field"
            >{{ field }}</span>
          </div>
        </div>
        <VtFormField
          label="Tên hiển thị"
          for-id="provider-editor-name"
          hint="Dùng tên bạn dễ nhận ra, ví dụ: Groq nhanh hoặc VieNeu tiếng Việt."
        >
          <VtInput
            id="provider-editor-name"
            v-model="editorName"
            name="provider-editor-name"
            autocomplete="off"
            placeholder="Tên cấu hình…"
            :disabled="saving"
          />
        </VtFormField>
        <div class="form-section-heading">
          <div><h3>Thông số dịch vụ</h3><p>Các trường bên dưới được sinh từ cấu hình provider/model.</p></div>
        </div>
        <SchemaConfigForm
          :schema="selectedInstallation.configSchema"
          :model-value="editorDraft"
          :disabled="saving"
          @update:model-value="editorDraft = $event"
          @validity-change="editorValid = $event"
        />
        <div class="secret-select-block">
          <div class="form-section-heading">
            <div><h3>Khóa kết nối</h3><p>Giá trị khóa không hiển thị lại sau khi lưu.</p></div><VtButton
              size="sm"
              variant="ghost"
              @click="goToSecrets"
            >
              Quản lý khóa
            </VtButton>
          </div><div
            v-if="secrets.length"
            class="secret-options"
          >
            <div
              v-for="secret in secrets"
              :key="secret.id"
              class="secret-option"
            >
              <VtCheckbox
                :model-value="editorSecretIds.includes(secret.id)"
                :label="secret.name"
                :disabled="saving || secret.status !== 'available'"
                @update:model-value="editSecretSelection(secret.id, $event)"
              /><span class="secret-status">{{ secret.status === 'available' ? 'Sẵn sàng' : 'Chưa sẵn sàng' }}</span>
            </div>
          </div><p
            v-else
            class="empty-inline"
          >
            Chưa có khóa. Hãy tạo khóa trước khi lưu dịch vụ cần xác thực.
          </p>
        </div>
        <p
          v-if="editorError"
          class="editor-error"
          role="alert"
        >
          {{ editorError }}
        </p>
      </div>
      <template #footer>
        <VtButton
          variant="ghost"
          :disabled="saving"
          @click="closeEditor"
        >
          Hủy
        </VtButton><VtButton
          v-if="editorStep === 'details'"
          variant="primary"
          :loading="saving"
          :disabled="!editorName.trim() || !editorValid || !selectedInstallation"
          @click="saveEditor"
        >
          {{ editorMode === 'edit' ? 'Lưu thay đổi' : 'Thêm dịch vụ' }}
        </VtButton>
      </template>
    </VtDialog>

    <VtDialog
      :open="Boolean(fieldTarget)"
      :title="fieldTarget ? `Trường cấu hình · ${fieldTarget.config.name}` : 'Trường cấu hình'"
      description="Các trường được provider công bố qua JSON Schema. Giá trị nhạy cảm không hiển thị trong dashboard."
      width="sm"
      @update:open="!$event && (fieldTarget = undefined)"
    >
      <dl
        v-if="fieldTarget"
        class="schema-field-list"
      >
        <div
          v-for="field in schemaFieldEntries(fieldTarget.installation)"
          :key="field.key"
        >
          <dt>
            <span :title="field.key">{{ field.label }}</span><VtBadge
              v-if="field.required"
              tone="neutral"
            >
              Bắt buộc
            </VtBadge>
          </dt>
          <dd>
            <span>{{ field.sensitive ? 'Được bảo vệ' : fieldValue(fieldTarget.config, field) }}</span><small>{{ field.type }} · {{ field.key }}</small>
          </dd>
        </div>
      </dl>
      <p
        v-else
        class="empty-inline"
      >
        Provider chưa công bố trường cấu hình.
      </p>
      <template #footer>
        <VtButton
          variant="secondary"
          @click="fieldTarget = undefined"
        >
          Đóng
        </VtButton>
      </template>
    </VtDialog>

    <VtDialog
      :open="archiveTargets.length > 0"
      title="Lưu trữ dịch vụ?"
      :description="archiveTargets.length === 1 ? `${archiveTargets[0]?.name} sẽ không còn xuất hiện trong danh sách chọn. Các revision cũ vẫn được giữ.` : `${archiveTargets.length} dịch vụ sẽ không còn xuất hiện trong danh sách chọn. Các revision cũ vẫn được giữ.`"
      width="sm"
      @update:open="!$event && (archiveTargets = [])"
    >
      <p class="dialog-warning">
        Nếu dịch vụ đang được trợ lý sử dụng, hệ thống sẽ chặn thao tác để không làm gián đoạn cuộc trò chuyện.
      </p><template #footer>
        <VtButton
          variant="ghost"
          @click="archiveTargets = []"
        >
          Hủy
        </VtButton><VtButton
          variant="danger"
          :loading="archiveBusy"
          @click="archive"
        >
          Lưu trữ
        </VtButton>
      </template>
    </VtDialog>
  </main>
</template>

<style scoped>
.provider-management { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr); gap: 16px; }
.provider-management > * { min-width: 0; }
.management-header { display: flex; min-width: 0; align-items: flex-start; justify-content: space-between; gap: 16px; }.management-header > div { min-width: 0; }
.management-header h1, .management-header p, .catalog-intro h2, .catalog-intro p, .catalog-tile h2, .catalog-tile p, .config-tile h2, .config-tile p, .form-section-heading h3, .form-section-heading p { margin: 0; }
.eyebrow { margin: 0 0 5px; color: var(--vt-primary); font-size: 10px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
.management-header h1 { color: var(--vt-text); font-size: 23px; letter-spacing: -.025em; }
.lede { max-width: 680px; margin-top: 6px !important; color: var(--vt-text-muted); font-size: 12px; line-height: 1.5; }
.summary-grid { display: grid; width: 100%; min-width: 0; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary-card { display: grid; gap: 3px; padding: 13px 15px; }
.summary-value { color: var(--vt-text); font-size: 20px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.summary-label { color: var(--vt-text-muted); font-size: 10px; }
.summary-card.has-attention { border-color: #f1d8a9; background: var(--vt-warning-soft); }
.workspace-tabs { display: flex; width: 100%; min-width: 0; gap: 5px; overflow-x: auto; border-bottom: 1px solid var(--vt-border); }
.workspace-tabs button { display: inline-flex; min-height: 40px; align-items: center; gap: 7px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--vt-text-muted); padding: 0 11px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.workspace-tabs button:hover { color: var(--vt-text); background: var(--vt-surface-muted); }
.workspace-tabs button.active { border-bottom-color: var(--vt-primary); color: var(--vt-primary); }
.workspace-tabs span { min-width: 19px; border-radius: 99px; background: var(--vt-surface-muted); padding: 2px 5px; color: var(--vt-text-muted); font-size: 9px; text-align: center; }
.workspace-toolbar { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; }
.batch-toolbar { display: flex; align-items: center; gap: 8px; border: 1px solid #cddcff; border-radius: var(--vt-radius-control); background: var(--vt-primary-soft); padding: 7px 9px; color: var(--vt-primary-text); font-size: 10px; }
.batch-toolbar span { margin-right: auto; font-weight: 650; }
.kind-filter { display: flex; min-width: 0; gap: 4px; overflow-x: auto; }
.kind-filter button { flex: none; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--vt-text-muted); padding: 7px 8px; font-size: 10px; white-space: nowrap; }
.kind-filter button:hover { border-color: var(--vt-border); background: var(--vt-surface); color: var(--vt-text); }
.kind-filter button.active { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary-text); font-weight: 650; }
.toolbar-actions { display: flex; min-width: min(420px, 100%); align-items: center; gap: 7px; }
.toolbar-actions :deep(.vt-input-shell) { min-width: 200px; }
.toolbar-actions :deep(.vt-select-trigger) { min-width: 155px; }
.view-toggle { display: flex; flex: none; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-button); background: var(--vt-surface); padding: 2px; }
.view-toggle button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--vt-text-muted); }
.view-toggle button:hover, .view-toggle button[aria-pressed='true'] { background: var(--vt-primary-soft); color: var(--vt-primary); }
.table-card { overflow: hidden; }
.table-wrap { overflow-x: auto; }
.provider-table { width: 100%; min-width: 1060px; border-collapse: collapse; table-layout: fixed; }
.provider-table th { border-bottom: 1px solid var(--vt-border); color: var(--vt-text-muted); padding: 12px 13px; font-size: 10px; font-weight: 650; text-align: left; white-space: nowrap; }
.provider-table td { border-bottom: 1px solid var(--vt-border); color: var(--vt-text-soft); padding: 11px 13px; font-size: 11px; vertical-align: middle; }
.provider-table tr:last-child td { border-bottom: 0; }
.provider-table tr:hover td { background: var(--vt-surface-subtle); }
.provider-table th.selection-column { width: 44px; }.provider-table th:nth-child(2) { width: 19%; }.provider-table th:nth-child(3) { width: 11%; }.provider-table th:nth-child(4) { width: 15%; }.provider-table th:nth-child(5) { width: 13%; }.provider-table th:nth-child(6) { width: 12%; }.provider-table th:nth-child(7) { width: 15%; }.provider-table th.action-column { width: 150px; }
.service-cell { display: grid; min-width: 0; gap: 3px; }.service-cell strong, .service-cell span, .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.service-cell strong { color: var(--vt-text); font-size: 11px; }.service-cell span { color: var(--vt-text-muted); font-size: 9px; }
.field-summary-button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.selection-column :deep(.vt-checkbox-label), .selection-cell :deep(.vt-checkbox-label) { justify-content: center; }.selection-column :deep(.vt-checkbox-label > span), .selection-cell :deep(.vt-checkbox-label > span) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; clip-path: inset(50%); }
.status-cell { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; }.status-cell :deep(.vt-switch-label) { font-size: 9px; }.action-cell { white-space: nowrap; }.action-cell :deep(.vt-button) { width: 30px; padding-inline: 0; font-size: 10px; }.action-buttons { display: flex; align-items: center; justify-content: flex-start; gap: 2px; }
.empty-table { display: grid; min-height: 220px; place-items: center; align-content: center; gap: 7px; color: var(--vt-text-muted); text-align: center; }.empty-table strong { color: var(--vt-text); font-size: 13px; }.empty-table p { margin: 0 0 5px; font-size: 10px; }
.config-card-grid, .catalog-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }.config-tile, .catalog-tile { display: grid; min-width: 0; gap: 11px; padding: 15px; }.config-tile.disabled { background: var(--vt-surface-muted); }.config-tile header { min-width: 0; }.tile-heading { display: flex; align-items: center; justify-content: space-between; gap: 7px; }.config-tile h2, .catalog-tile h2 { overflow: hidden; color: var(--vt-text); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }.config-tile p, .catalog-tile p { overflow: hidden; color: var(--vt-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.config-tile dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; }.config-tile dl div { min-width: 0; border-radius: 5px; background: var(--vt-surface-subtle); padding: 8px; }.config-tile dt { color: var(--vt-text-faint); font-size: 9px; }.config-tile dd { overflow: hidden; margin: 3px 0 0; color: var(--vt-text-soft); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.config-tile footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--vt-border); padding-top: 9px; }.config-tile footer > div { display: flex; gap: 3px; }.config-tile footer :deep(.vt-switch-label) { font-size: 10px; }
.catalog-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.catalog-intro h2 { color: var(--vt-text); font-size: 16px; }.catalog-intro p:not(.eyebrow) { max-width: 640px; margin-top: 5px; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }.catalog-tile { grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; }.catalog-icon, .picker-icon { display: grid; width: 38px; height: 38px; flex: none; place-items: center; border: 1px solid #cddcff; border-radius: 10px; background: var(--vt-primary-soft); color: var(--vt-primary); }.catalog-copy { min-width: 0; }.catalog-count { color: var(--vt-text-faint); font-size: 9px; white-space: nowrap; }.capability-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }.capability-pills span { border: 1px solid var(--vt-border); border-radius: 99px; color: var(--vt-text-muted); padding: 2px 6px; font-size: 8px; }
.secrets-section :deep(.secret-card) { margin: 0; }.state-card { display: grid; justify-items: center; gap: 7px; padding: 30px; text-align: center; }.state-card h2, .state-card p { margin: 0; }.state-card h2 { color: var(--vt-text); font-size: 14px; }.state-card p, .empty-inline, .dialog-warning { color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }.empty-inline { margin: 0; padding: 18px; text-align: center; }
.provider-explainer { display: grid; gap: 8px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 11px; }.provider-explainer-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }.provider-explainer-heading > div { display: grid; min-width: 0; gap: 2px; }.provider-explainer-heading strong { color: var(--vt-text); font-size: 11px; }.provider-explainer-heading span { color: var(--vt-text-muted); font-size: 9px; }.provider-explainer p { margin: 0; color: var(--vt-text-soft); font-size: 10px; line-height: 1.5; }.provider-explainer-fields { display: flex; flex-wrap: wrap; gap: 4px; }.provider-explainer-fields span { border: 1px solid var(--vt-border); border-radius: 99px; color: var(--vt-text-muted); padding: 2px 6px; font-size: 8px; }
.schema-field-list { display: grid; gap: 7px; margin: 0; }.schema-field-list > div { display: grid; gap: 5px; border-bottom: 1px solid var(--vt-border); padding: 7px 0; }.schema-field-list > div:last-child { border-bottom: 0; }.schema-field-list dt { display: flex; min-width: 0; align-items: center; gap: 6px; color: var(--vt-text); font-size: 11px; font-weight: 650; }.schema-field-list dt > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.schema-field-list dd { display: grid; min-width: 0; gap: 2px; margin: 0; color: var(--vt-text-soft); font-size: 10px; }.schema-field-list dd > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.schema-field-list dd small { color: var(--vt-text-faint); font-size: 8px; }
.secret-option { display: inline-flex; min-width: 0; align-items: center; gap: 7px; }
@media (max-width: 1000px) { .workspace-toolbar { display: grid; align-items: stretch; }.toolbar-actions { min-width: 0; }.provider-table { min-width: 1020px; } }
@media (max-width: 720px) { .management-header { display: grid; }.summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.toolbar-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }.toolbar-actions :deep(.vt-input-shell) { min-width: 0; }.config-card-grid, .catalog-grid { grid-template-columns: 1fr; }.catalog-tile { grid-template-columns: auto minmax(0, 1fr); }.catalog-tile > .vt-button { grid-column: 2; justify-self: start; }.catalog-intro { display: grid; }.workspace-tabs { margin-inline: -4px; }.provider-table { min-width: 980px; } }
@media (max-width: 480px) { .toolbar-actions { grid-template-columns: 1fr; }.view-toggle { justify-self: start; }.summary-grid { gap: 7px; }.summary-card { padding: 11px; }.summary-value { font-size: 17px; } }
</style>
