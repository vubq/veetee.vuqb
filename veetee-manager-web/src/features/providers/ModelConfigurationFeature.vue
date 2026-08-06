<script setup lang="ts">
import { ChevronRight, Plus, Search, Settings2, SlidersHorizontal, Trash2 } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { ModelConfigRecord, ModelProviderRecord, ModelType } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import PageHeader from '@/ui/patterns/PageHeader.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import { notify } from '@/ui/primitives/notifications'

import ModelConfigDialog from './ModelConfigDialog.vue'
import ModelConfigTable from './ModelConfigTable.vue'
import { localizedModelName, MODEL_CONFIG_TYPE_ORDER, MODEL_TYPE_DESCRIPTIONS, MODEL_TYPE_LABELS } from './model-registry-labels'

const router = useRouter()
const route = useRoute()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

// The source opens on the primary language-model capability. Users can still
// switch to every category from the sidebar without changing runtime state.
const activeType = ref<ModelType>('LLM')
const providers = ref<ModelProviderRecord[]>([])
const models = ref<ModelConfigRecord[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(10)
const searchInput = ref('')
const query = ref('')
const loadingProviders = ref(true)
const loadingModels = ref(true)
const providerError = ref('')
const modelError = ref('')
const selectedIds = ref<string[]>([])
const dialogOpen = ref(false)
const editingModel = ref<ModelConfigRecord>()
const duplicateMode = ref(false)
const saving = ref(false)
const deleteTarget = ref<ModelConfigRecord>()
const deleting = ref(false)
let modelLoadGeneration = 0

const categoryOptions: VtSelectOption[] = [
  { value: '10', label: '10 model / trang' },
  { value: '20', label: '20 model / trang' },
  { value: '50', label: '50 model / trang' },
]
const visibleProviders = computed(() => providers.value.filter((provider) => provider.modelType === activeType.value))
const allSelected = computed(() => models.value.length > 0 && models.value.every((model) => selectedIds.value.includes(model.id)))
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const rangeLabel = computed(() => {
  if (!total.value) return '0 model'
  const start = (page.value - 1) * limit.value + 1
  const end = Math.min(page.value * limit.value, total.value)
  return `${start}–${end} / ${total.value} model`
})
const activeLabel = computed(() => MODEL_TYPE_LABELS[activeType.value])
const error = computed(() => providerError.value || modelError.value)

async function loadProviders() {
  loadingProviders.value = true
  providerError.value = ''
  const result = await gateway.listModelProviders()
  if (result.ok) providers.value = result.data
  else providerError.value = 'Không tải được danh sách schema provider.'
  loadingProviders.value = false
}

async function loadModels() {
  const generation = ++modelLoadGeneration
  loadingModels.value = true
  modelError.value = ''
  const result = await gateway.listModelConfigs({ modelType: activeType.value, modelName: query.value || undefined, page: page.value, limit: limit.value })
  if (generation !== modelLoadGeneration) return
  if (!result.ok) {
    modelError.value = 'Không tải được danh sách model. Kiểm tra máy chủ quản trị rồi thử lại.'
  } else {
    models.value = result.data.items
    total.value = result.data.total
    page.value = result.data.page
    selectedIds.value = selectedIds.value.filter((id) => models.value.some((model) => model.id === id))
  }
  loadingModels.value = false
}

function reloadData() {
  void Promise.all([loadProviders(), loadModels()])
}

function selectType(type: ModelType) {
  if (activeType.value === type) return
  activeType.value = type
  page.value = 1
  selectedIds.value = []
  void router.replace({ query: { ...route.query, type } })
}

function applySearch() {
  query.value = searchInput.value.trim()
  page.value = 1
  void router.replace({
    query: {
      ...route.query,
      ...(query.value ? { q: query.value } : { q: undefined }),
      page: undefined,
    },
  })
}

function clearSearch() {
  searchInput.value = ''
  applySearch()
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : models.value.map((model) => model.id)
}

function toggle(id: string, selected: boolean) {
  selectedIds.value = selected ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter((value) => value !== id)
}

function openCreate() {
  editingModel.value = undefined
  duplicateMode.value = false
  dialogOpen.value = true
}

function openEdit(model: ModelConfigRecord) {
  editingModel.value = model
  duplicateMode.value = false
  dialogOpen.value = true
}

function openDuplicate(model: ModelConfigRecord) {
  editingModel.value = model
  duplicateMode.value = true
  dialogOpen.value = true
}

async function saveModel(input: { modelType: ModelType; providerCode: string; id?: string; modelCode: string; modelName: string; isDefault: boolean; isEnabled: boolean; configJson: Record<string, unknown>; docLink: string | null; remark: string | null; sort: number }) {
  saving.value = true
  const result = editingModel.value && !duplicateMode.value
    ? await gateway.updateModelConfig(editingModel.value.id, input, editingModel.value.etag)
    : await gateway.createModelConfig(input)
  saving.value = false
  if (!result.ok) {
    notify('Không lưu được model', { tone: 'error', message: 'Kiểm tra model code, provider và cấu hình JSON.' })
    return
  }
  dialogOpen.value = false
  notify(editingModel.value && !duplicateMode.value ? 'Đã cập nhật model' : 'Đã thêm model', { tone: 'success', message: localizedModelName(result.data) })
  await loadModels()
}

async function setEnabled(model: ModelConfigRecord, enabled: boolean) {
  if (model.isDefault && model.isEnabled && !enabled) return
  const result = await gateway.setModelEnabled(model.id, enabled)
  if (!result.ok) {
    notify('Không đổi được trạng thái model', { tone: 'error', message: 'Model mặc định đang được bảo vệ hoặc dữ liệu đã thay đổi.' })
    return
  }
  models.value = models.value.map((item) => item.id === result.data.id ? result.data : item)
}

async function setDefault(model: ModelConfigRecord) {
  if (model.isDefault) return
  const result = await gateway.setDefaultModel(model.id)
  if (!result.ok) {
    notify('Không đặt được model mặc định', { tone: 'error', message: 'Thử tải lại danh sách rồi thực hiện lại.' })
    return
  }
  await loadModels()
  notify('Đã đặt model mặc định', { tone: 'success', message: localizedModelName(model) })
}

function openDelete(model: ModelConfigRecord) {
  deleteTarget.value = model
}

async function deleteModel(model: ModelConfigRecord) {
  deleting.value = true
  const result = await gateway.deleteModelConfig(model.id, model.etag)
  deleting.value = false
  if (!result.ok) {
    notify('Không xóa được model', { tone: 'error', message: 'Model mặc định hoặc model đang được runtime tham chiếu.' })
    return
  }
  deleteTarget.value = undefined
  await loadModels()
  notify('Đã xóa model', { tone: 'success', message: localizedModelName(model) })
}

async function deleteSelected() {
  const targets = models.value.filter((model) => selectedIds.value.includes(model.id))
  for (const model of targets) {
    const result = await gateway.deleteModelConfig(model.id, model.etag)
    if (!result.ok) {
      notify('Xóa chưa hoàn tất', { tone: 'error', message: `Không thể xóa ${localizedModelName(model)}.` })
      await loadModels()
      return
    }
  }
  selectedIds.value = []
  await loadModels()
  notify('Đã xóa model', { tone: 'success', message: `${targets.length} model đã được xóa.` })
}

function openVoiceManagement(model: ModelConfigRecord) {
  void router.push({ path: '/providers/tts/voices', query: { modelId: model.id } })
}

function previousPage() { if (page.value > 1) { page.value -= 1 } }
function nextPage() { if (page.value < pageCount.value) { page.value += 1 } }

watch([activeType, page, limit, query], () => { void loadModels() })
watch(limit, () => { page.value = 1 })
watch(() => route.query.type, (value) => {
  if (typeof value === 'string' && MODEL_CONFIG_TYPE_ORDER.includes(value as ModelType)) {
    activeType.value = value as ModelType
    page.value = 1
  }
}, { immediate: true })
watch(() => route.query.q, (value) => {
  const next = typeof value === 'string' ? value : ''
  if (query.value === next && searchInput.value === next) return
  query.value = next
  searchInput.value = next
  page.value = 1
}, { immediate: true })
onMounted(reloadData)
</script>

<template>
  <section class="model-configuration">
    <PageHeader
      title="Cấu hình model"
      :subtitle="`${activeLabel} · ${rangeLabel}`"
      :icon="SlidersHorizontal"
    >
      <template #actions>
        <VtButton @click="void router.push('/provider-management')">
          <template #leading>
            <VtIcon
              :icon="Settings2"
              :size="14"
            />
          </template>Quản lý provider
        </VtButton>
        <VtButton
          variant="primary"
          :disabled="loadingProviders || visibleProviders.length === 0"
          @click="openCreate"
        >
          <template #leading>
            <VtIcon
              :icon="Plus"
              :size="15"
            />
          </template>Thêm model
        </VtButton>
      </template>
    </PageHeader>

    <VtCard class="configuration-card">
      <div class="configuration-layout">
        <aside
          class="category-sidebar"
          aria-label="Danh mục model"
        >
          <p class="sidebar-label">
            Danh mục
          </p>
          <button
            v-for="type in MODEL_CONFIG_TYPE_ORDER"
            :key="type"
            type="button"
            class="category-item"
            :class="{ active: activeType === type }"
            :aria-current="activeType === type ? 'page' : undefined"
            @click="selectType(type)"
          >
            <span class="category-copy"><strong>{{ MODEL_TYPE_LABELS[type] }}</strong><small>{{ MODEL_TYPE_DESCRIPTIONS[type] }}</small></span>
            <ChevronRight :size="14" />
          </button>
        </aside>
        <div class="configuration-main">
          <div class="operation-bar">
            <div class="search-control search-group">
              <VtInput
                v-model="searchInput"
                :icon="Search"
                aria-label="Tìm model"
                placeholder="Tìm theo model ID, tên hoặc provider…"
                @keyup.enter="applySearch"
              />
              <VtButton
                size="sm"
                variant="secondary"
                @click="applySearch"
              >
                Tìm
              </VtButton>
              <VtButton
                v-if="query"
                size="sm"
                variant="ghost"
                aria-label="Xóa tìm kiếm model"
                @click="clearSearch"
              >
                Xóa
              </VtButton>
            </div>
            <VtSelect
              :model-value="String(limit)"
              label="Số model mỗi trang"
              :options="categoryOptions"
              @update:model-value="limit = Number($event)"
            />
            <VtBadge tone="neutral">
              {{ rangeLabel }}
            </VtBadge>
          </div>

          <div
            v-if="error"
            class="error-state"
            role="alert"
          >
            {{ error }} <VtButton
              size="sm"
              @click="reloadData"
            >
              Thử lại
            </VtButton>
          </div>
          <div
            v-else-if="!loadingProviders && visibleProviders.length === 0"
            class="empty-provider-state"
          >
            <strong>Chưa có provider cho {{ activeLabel }}</strong>
            <span>Thêm schema provider trước, sau đó cấu hình model sẽ tự sinh trường theo schema.</span>
            <VtButton
              size="sm"
              variant="primary"
              @click="void router.push({ path: '/provider-management', query: { type: activeType } })"
            >
              <template #leading>
                <VtIcon
                  :icon="Plus"
                  :size="13"
                />
              </template>
              Thêm schema provider
            </VtButton>
          </div>
          <ModelConfigTable
            v-if="visibleProviders.length > 0 || loadingProviders"
            :items="models"
            :providers="providers"
            :selected-ids="selectedIds"
            :all-selected="allSelected"
            :active-type="activeType"
            :loading="loadingModels"
            @toggle-all="toggleAll"
            @toggle="toggle"
            @enabled="setEnabled"
            @default="setDefault"
            @edit="openEdit"
            @duplicate="openDuplicate"
            @remove="openDelete"
            @voices="openVoiceManagement"
          />
          <footer class="table-footer">
            <span v-if="selectedIds.length">Đã chọn {{ selectedIds.length }} model</span><span v-else>Model được lưu theo danh mục và provider giống source.</span>
            <div class="footer-actions">
              <VtButton
                variant="danger"
                size="sm"
                :disabled="selectedIds.length === 0"
                @click="deleteSelected"
              >
                <template #leading>
                  <VtIcon
                    :icon="Trash2"
                    :size="14"
                  />
                </template>Xóa đã chọn
              </VtButton>
              <VtButton
                size="sm"
                :disabled="page <= 1"
                @click="previousPage"
              >
                Trang trước
              </VtButton>
              <VtButton
                size="sm"
                :disabled="page >= pageCount"
                @click="nextPage"
              >
                Trang sau
              </VtButton>
            </div>
          </footer>
        </div>
      </div>
    </VtCard>

    <ModelConfigDialog
      v-model:open="dialogOpen"
      :model="editingModel"
      :duplicate="duplicateMode"
      :model-type="activeType"
      :providers="providers"
      :saving="saving"
      @save="saveModel"
    />
    <VtDialog
      :open="Boolean(deleteTarget)"
      title="Xóa model?"
      description="Model bị xóa khỏi danh mục này và không thể khôi phục bằng giao diện."
      width="sm"
      @update:open="(open) => !open && (deleteTarget = undefined)"
    >
      <p class="confirm-copy">
        Bạn chắc chắn muốn xóa <strong>{{ deleteTarget ? localizedModelName(deleteTarget) : '' }}</strong>?
      </p>
      <template #footer>
        <VtButton @click="deleteTarget = undefined">
          Hủy
        </VtButton>
        <VtButton
          variant="danger"
          :loading="deleting"
          @click="deleteTarget && deleteModel(deleteTarget)"
        >
          Xóa model
        </VtButton>
      </template>
    </VtDialog>
  </section>
</template>

<style scoped>
.model-configuration { display: grid; gap: 15px; }
.configuration-card { min-width: 0; padding: 0; }
.configuration-layout { display: grid; min-width: 0; grid-template-columns: 210px minmax(0, 1fr); }
.category-sidebar { display: grid; align-content: start; gap: 3px; border-right: 1px solid var(--vt-border); padding: 14px 10px; }
.sidebar-label { margin: 2px 8px 7px; color: var(--vt-text-faint); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.category-item { display: flex; min-width: 0; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: var(--vt-radius-control); background: transparent; color: var(--vt-text-muted); padding: 8px 9px; text-align: left; transition: background var(--vt-transition), border-color var(--vt-transition), color var(--vt-transition); }
.category-item:hover { border-color: var(--vt-border); background: var(--vt-surface-muted); color: var(--vt-text); }
.category-item.active { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.category-item:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.category-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
.category-copy strong, .category-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.category-copy strong { color: inherit; font-size: 10px; font-weight: 650; }
.category-copy small { color: var(--vt-text-faint); font-size: 8px; }
.category-item.active .category-copy small { color: var(--vt-primary-text); }
.configuration-main { display: grid; min-width: 0; gap: 13px; padding: 14px; }
.operation-bar { display: flex; min-width: 0; align-items: center; gap: 9px; }
.search-control { min-width: 220px; flex: 1; }.search-group { display: flex; min-width: 0; align-items: center; gap: 6px; }.search-group > :first-child { min-width: 0; flex: 1; }
.operation-bar > :deep(.vt-select-trigger) { width: 150px; }
.operation-bar .vt-badge { flex: none; }
.error-state { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #f1c4c8; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 10px 12px; font-size: 11px; }
.empty-provider-state { display: grid; justify-items: start; gap: 5px; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-section); background: var(--vt-surface-subtle); padding: 18px; }.empty-provider-state strong { color: var(--vt-text); font-size: 12px; }.empty-provider-state span { color: var(--vt-text-muted); font-size: 10px; }.empty-provider-state .vt-button { margin-top: 4px; }
.table-footer { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--vt-border); color: var(--vt-text-muted); padding-top: 1px; font-size: 11px; }
.footer-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.confirm-copy { margin: 0; color: var(--vt-text-soft); font-size: 13px; }
@media (max-width: 920px) { .configuration-layout { grid-template-columns: 1fr; }.category-sidebar { grid-template-columns: repeat(3, minmax(0, 1fr)); border-right: 0; border-bottom: 1px solid var(--vt-border); }.sidebar-label { grid-column: 1 / -1; }.category-item { min-width: 0; } }
@media (max-width: 650px) { .category-sidebar { grid-template-columns: repeat(2, minmax(0, 1fr)); }.operation-bar { align-items: stretch; flex-direction: column; }.search-control { min-width: 0; width: 100%; }.search-group { flex-wrap: wrap; }.search-group > :first-child { width: 100%; flex-basis: 100%; }.operation-bar > :deep(.vt-select-trigger) { width: 100%; }.operation-bar .vt-badge { width: fit-content; }.table-footer { align-items: flex-start; flex-direction: column; padding-block: 10px; }.footer-actions { justify-content: flex-start; } }
</style>
