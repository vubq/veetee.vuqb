<script setup lang="ts">
import { ChevronLeft, ChevronRight, ListFilter, Plus, Search, Settings2, Trash2 } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { ModelProviderRecord, ModelType } from '@/domain'
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

import ModelFieldInspector from './ModelFieldInspector.vue'
import ModelProviderDialog from './ModelProviderDialog.vue'
import ModelProviderTable from './ModelProviderTable.vue'
import { localizedProviderName, MODEL_TYPE_LABELS, MODEL_TYPE_ORDER, normalizeModelSearch } from './model-registry-labels'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const route = useRoute()
const router = useRouter()

const providers = ref<ModelProviderRecord[]>([])
const loading = ref(true)
const loadError = ref('')
const searchInput = ref('')
const query = ref('')
const category = ref<ModelType | 'all'>('all')
const page = ref(1)
const pageSize = ref('10')
const selectedIds = ref<string[]>([])
const dialogOpen = ref(false)
const editingProvider = ref<ModelProviderRecord>()
const saving = ref(false)
const inspectorOpen = ref(false)
const inspectorProvider = ref<ModelProviderRecord>()
const deleteTarget = ref<ModelProviderRecord>()
const deleting = ref(false)
let loadGeneration = 0

const categoryOptions: VtSelectOption[] = [{ value: 'all', label: 'Tất cả danh mục' }, ...MODEL_TYPE_ORDER.map((value) => ({ value, label: MODEL_TYPE_LABELS[value] }))]
const pageSizeOptions: VtSelectOption[] = [
  { value: '10', label: '10 provider / trang' },
  { value: '20', label: '20 provider / trang' },
  { value: '50', label: '50 provider / trang' },
  { value: '100', label: '100 provider / trang' },
]
const filteredProviders = computed(() => {
  const term = normalizeModelSearch(query.value)
  return providers.value.filter((provider) => {
    const byCategory = category.value === 'all' || provider.modelType === category.value
    const haystack = normalizeModelSearch(`${provider.name} ${provider.providerCode} ${provider.modelType}`)
    return byCategory && (!term || haystack.includes(term))
  })
})
const pageCount = computed(() => Math.max(1, Math.ceil(filteredProviders.value.length / Number(pageSize.value))))
const pagedProviders = computed(() => filteredProviders.value.slice((page.value - 1) * Number(pageSize.value), page.value * Number(pageSize.value)))
const rangeLabel = computed(() => {
  if (!filteredProviders.value.length) return '0 provider'
  const start = (page.value - 1) * Number(pageSize.value) + 1
  return `${start}–${Math.min(page.value * Number(pageSize.value), filteredProviders.value.length)} / ${filteredProviders.value.length} provider`
})
const allSelected = computed(() => pagedProviders.value.length > 0 && pagedProviders.value.every((provider) => selectedIds.value.includes(provider.id)))
const selectedProviders = computed(() => providers.value.filter((provider) => selectedIds.value.includes(provider.id)))

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadError.value = ''
  const result = await gateway.listModelProviders()
  if (generation !== loadGeneration) return
  if (!result.ok) {
    loadError.value = 'Không tải được danh sách provider. Kiểm tra máy chủ quản trị rồi thử lại.'
  } else {
    providers.value = result.data
    selectedIds.value = selectedIds.value.filter((id) => result.data.some((provider) => provider.id === id))
  }
  loading.value = false
}

function applyFilter() {
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

function clearFilter() {
  searchInput.value = ''
  applyFilter()
}

function toggleAll() {
  selectedIds.value = allSelected.value
    ? selectedIds.value.filter((id) => !pagedProviders.value.some((provider) => provider.id === id))
    : [...new Set([...selectedIds.value, ...pagedProviders.value.map((provider) => provider.id)])]
}

function toggle(id: string, selected: boolean) {
  selectedIds.value = selected ? [...new Set([...selectedIds.value, id])] : selectedIds.value.filter((value) => value !== id)
}

function openCreate() {
  editingProvider.value = undefined
  dialogOpen.value = true
}

function openEdit(provider: ModelProviderRecord) {
  editingProvider.value = provider
  dialogOpen.value = true
}

function openDelete(provider: ModelProviderRecord) {
  deleteTarget.value = provider
}

function openInspector(provider: ModelProviderRecord) {
  inspectorProvider.value = provider
  inspectorOpen.value = true
}

async function saveProvider(input: { modelType: ModelType; providerCode: string; name: string; fields: ModelProviderRecord['fields']; sort: number }) {
  saving.value = true
  const result = editingProvider.value
    ? await gateway.updateModelProvider(editingProvider.value.id, input, editingProvider.value.etag)
    : await gateway.createModelProvider(input)
  saving.value = false
  if (!result.ok) {
    notify('Không lưu được provider', { tone: 'error', message: 'Mã provider có thể đã tồn tại hoặc dữ liệu chưa hợp lệ.' })
    return
  }
  const saved = result.data
  providers.value = editingProvider.value ? providers.value.map((provider) => provider.id === saved.id ? saved : provider) : [...providers.value, saved]
  dialogOpen.value = false
  notify(editingProvider.value ? 'Đã cập nhật provider' : 'Đã thêm provider', { tone: 'success', message: localizedProviderName(saved) })
}

async function deleteProvider(provider: ModelProviderRecord) {
  deleting.value = true
  const result = await gateway.deleteModelProvider(provider.id, provider.etag)
  deleting.value = false
  if (!result.ok) {
    notify('Không xóa được provider', { tone: 'error', message: 'Provider đang được model sử dụng hoặc dữ liệu đã thay đổi.' })
    return
  }
  providers.value = providers.value.filter((item) => item.id !== provider.id)
  selectedIds.value = selectedIds.value.filter((id) => id !== provider.id)
  page.value = Math.min(page.value, pageCount.value)
  deleteTarget.value = undefined
  notify('Đã xóa provider', { tone: 'success', message: localizedProviderName(provider) })
}

async function deleteSelected() {
  const targets = [...selectedProviders.value]
  for (const provider of targets) {
    const result = await gateway.deleteModelProvider(provider.id, provider.etag)
    if (!result.ok) {
      notify('Xóa chưa hoàn tất', { tone: 'error', message: `Không thể xóa ${localizedProviderName(provider)}.` })
      await load()
      return
    }
  }
  providers.value = providers.value.filter((provider) => !targets.some((target) => target.id === provider.id))
  selectedIds.value = []
  page.value = Math.min(page.value, pageCount.value)
  notify('Đã xóa provider', { tone: 'success', message: `${targets.length} provider đã được xóa.` })
}

function previousPage() { if (page.value > 1) page.value -= 1 }
function nextPage() { if (page.value < pageCount.value) page.value += 1 }

watch([category, pageSize], () => { page.value = 1 })
watch(category, (value) => {
  const query = { ...route.query }
  if (value === 'all') delete query.type
  else query.type = value
  void router.replace({ query })
})
watch(() => route.query.type, (value) => {
  if (typeof value === 'string' && MODEL_TYPE_ORDER.includes(value as ModelType)) category.value = value as ModelType
}, { immediate: true })
watch(() => route.query.q, (value) => {
  const next = typeof value === 'string' ? value : ''
  if (query.value === next && searchInput.value === next) return
  query.value = next
  searchInput.value = next
  page.value = 1
}, { immediate: true })
onMounted(load)
</script>

<template>
  <section class="provider-management">
    <PageHeader
      title="Quản lý provider"
      :subtitle="`${providers.length} provider · schema dùng chung cho cấu hình model`"
      :icon="Settings2"
    >
      <template #actions>
        <VtButton @click="openCreate">
          <template #leading>
            <VtIcon
              :icon="Plus"
              :size="15"
            />
          </template>Thêm provider
        </VtButton>
        <VtButton
          variant="primary"
          @click="router.push('/model-config')"
        >
          Cấu hình model
        </VtButton>
      </template>
    </PageHeader>

    <VtCard class="management-card">
      <div class="operation-bar">
        <div class="search-control search-group">
          <VtInput
            v-model="searchInput"
            :icon="Search"
            aria-label="Tìm provider"
            placeholder="Tìm theo tên hoặc mã provider…"
            @keyup.enter="applyFilter"
          />
          <VtButton
            size="sm"
            @click="applyFilter"
          >
            Tìm
          </VtButton>
          <VtButton
            v-if="query"
            size="sm"
            variant="ghost"
            aria-label="Xóa tìm kiếm provider"
            @click="clearFilter"
          >
            Xóa
          </VtButton>
        </div>
        <div class="category-control">
          <VtSelect
            v-model="category"
            label="Lọc danh mục provider"
            :options="categoryOptions"
          />
        </div>
        <VtSelect
          v-model="pageSize"
          label="Số provider mỗi trang"
          :options="pageSizeOptions"
        />
        <VtBadge tone="neutral">
          <ListFilter :size="13" />{{ rangeLabel }}
        </VtBadge>
      </div>

      <div
        v-if="loadError"
        class="error-state"
        role="alert"
      >
        {{ loadError }} <VtButton
          size="sm"
          @click="load"
        >
          Thử lại
        </VtButton>
      </div>
      <ModelProviderTable
        :items="pagedProviders"
        :selected-ids="selectedIds"
        :all-selected="allSelected"
        :loading="loading"
        @toggle-all="toggleAll"
        @toggle="toggle"
        @inspect="openInspector"
        @edit="openEdit"
        @remove="openDelete"
      />

      <footer class="table-footer">
        <span v-if="selectedIds.length">Đã chọn {{ selectedIds.length }} provider</span><span v-else>Provider có thể được dùng lại cho nhiều model.</span>
        <div class="footer-actions">
          <VtButton
            :disabled="selectedIds.length === 0"
            variant="danger"
            size="sm"
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
            aria-label="Trang provider trước"
            @click="previousPage"
          >
            <ChevronLeft :size="14" /> Trước
          </VtButton>
          <VtButton
            size="sm"
            :disabled="page >= pageCount"
            aria-label="Trang provider sau"
            @click="nextPage"
          >
            Sau <ChevronRight :size="14" />
          </VtButton>
        </div>
      </footer>
    </VtCard>

    <ModelProviderDialog
      v-model:open="dialogOpen"
      :provider="editingProvider"
      :saving="saving"
      @save="saveProvider"
    />
    <ModelFieldInspector
      v-model:open="inspectorOpen"
      :fields="inspectorProvider?.fields ?? []"
      :title="`Trường cấu hình · ${inspectorProvider ? localizedProviderName(inspectorProvider) : 'provider'}`"
    />
    <VtDialog
      :open="Boolean(deleteTarget)"
      title="Xóa provider?"
      description="Model đang dùng provider này sẽ không bị xóa, nhưng provider không thể khôi phục sau khi xóa."
      width="sm"
      @update:open="(open) => !open && (deleteTarget = undefined)"
    >
      <p class="confirm-copy">
        Bạn chắc chắn muốn xóa <strong>{{ deleteTarget ? localizedProviderName(deleteTarget) : '' }}</strong>?
      </p>
      <template #footer>
        <VtButton @click="deleteTarget = undefined">
          Hủy
        </VtButton>
        <VtButton
          variant="danger"
          :loading="deleting"
          @click="deleteTarget && deleteProvider(deleteTarget)"
        >
          Xóa provider
        </VtButton>
      </template>
    </VtDialog>
  </section>
</template>

<style scoped>
.provider-management { display: grid; gap: 15px; }
.management-card { display: grid; gap: 13px; padding: 0; }
.operation-bar { display: flex; min-width: 0; align-items: center; gap: 9px; padding: 14px 15px 0; }
.search-control { width: min(420px, 100%); }
.search-group { display: flex; align-items: center; gap: 6px; }
.search-group > :first-child { min-width: 0; flex: 1; }
.category-control { width: min(230px, 100%); }
.operation-bar > :deep(.vt-select-trigger) { width: 190px; }
.operation-bar .vt-badge { margin-left: auto; }
.error-state { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #f1c4c8; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 10px 12px; font-size: 11px; }
.table-footer { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--vt-border); color: var(--vt-text-muted); padding: 0 15px; font-size: 11px; }
.footer-actions { display: flex; gap: 8px; }
.confirm-copy { margin: 0; color: var(--vt-text-soft); font-size: 13px; }
@media (max-width: 900px) { .operation-bar { align-items: stretch; flex-wrap: wrap; }.search-control { width: 100%; }.category-control { width: min(260px, 100%); }.operation-bar > :deep(.vt-select-trigger) { width: 100%; }.operation-bar .vt-badge { margin-left: auto; } }
@media (max-width: 720px) { .operation-bar { flex-direction: column; }.search-control, .category-control { width: 100%; }.search-group { flex-wrap: wrap; }.search-group > :first-child { flex-basis: 100%; width: 100%; }.operation-bar .vt-badge { width: fit-content; margin-left: 0; }.table-footer { align-items: flex-start; flex-direction: column; padding-block: 12px; } }
</style>
