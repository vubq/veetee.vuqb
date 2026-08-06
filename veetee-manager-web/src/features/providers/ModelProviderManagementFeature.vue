<script setup lang="ts">
import { ListFilter, Plus, Search, Settings2, Trash2 } from '@lucide/vue'
import { computed, onMounted, ref, watch } from 'vue'

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
import { MODEL_TYPE_LABELS, MODEL_TYPE_ORDER, normalizeModelSearch } from './model-registry-labels'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const providers = ref<ModelProviderRecord[]>([])
const loading = ref(true)
const loadError = ref('')
const query = ref('')
const category = ref<ModelType | 'all'>('all')
const selectedIds = ref<string[]>([])
const dialogOpen = ref(false)
const editingProvider = ref<ModelProviderRecord>()
const saving = ref(false)
const inspectorOpen = ref(false)
const inspectorProvider = ref<ModelProviderRecord>()
const deleteTarget = ref<ModelProviderRecord>()
const deleting = ref(false)

const categoryOptions: VtSelectOption[] = [{ value: 'all', label: 'Tất cả danh mục' }, ...MODEL_TYPE_ORDER.map((value) => ({ value, label: MODEL_TYPE_LABELS[value] }))]
const filteredProviders = computed(() => {
  const term = normalizeModelSearch(query.value)
  return providers.value.filter((provider) => {
    const byCategory = category.value === 'all' || provider.modelType === category.value
    const haystack = normalizeModelSearch(`${provider.name} ${provider.providerCode} ${provider.modelType}`)
    return byCategory && (!term || haystack.includes(term))
  })
})
const allSelected = computed(() => filteredProviders.value.length > 0 && filteredProviders.value.every((provider) => selectedIds.value.includes(provider.id)))
const selectedProviders = computed(() => providers.value.filter((provider) => selectedIds.value.includes(provider.id)))

async function load() {
  loading.value = true
  loadError.value = ''
  const result = await gateway.listModelProviders({ modelType: category.value === 'all' ? undefined : category.value, name: query.value || undefined })
  if (!result.ok) {
    loadError.value = 'Không tải được danh sách provider. Kiểm tra máy chủ quản trị rồi thử lại.'
  } else {
    providers.value = result.data
    selectedIds.value = selectedIds.value.filter((id) => result.data.some((provider) => provider.id === id))
  }
  loading.value = false
}

function toggleAll() {
  selectedIds.value = allSelected.value
    ? selectedIds.value.filter((id) => !filteredProviders.value.some((provider) => provider.id === id))
    : [...new Set([...selectedIds.value, ...filteredProviders.value.map((provider) => provider.id)])]
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
  notify(editingProvider.value ? 'Đã cập nhật provider' : 'Đã thêm provider', { tone: 'success', message: saved.name })
}

async function deleteProvider(provider: ModelProviderRecord) {
  deleting.value = true
  const result = await gateway.deleteModelProvider(provider.id, provider.etag)
  deleting.value = false
  if (!result.ok) {
    notify('Không xóa được provider', { tone: 'error', message: 'Provider đang được model sử dụng hoặc đã thay đổi.' })
    return
  }
  providers.value = providers.value.filter((item) => item.id !== provider.id)
  selectedIds.value = selectedIds.value.filter((id) => id !== provider.id)
  deleteTarget.value = undefined
  notify('Đã xóa provider', { tone: 'success', message: provider.name })
}

async function deleteSelected() {
  const targets = [...selectedProviders.value]
  for (const provider of targets) {
    const result = await gateway.deleteModelProvider(provider.id, provider.etag)
    if (!result.ok) {
      notify('Xóa chưa hoàn tất', { tone: 'error', message: `Không thể xóa ${provider.name}.` })
      await load()
      return
    }
  }
  providers.value = providers.value.filter((provider) => !targets.some((target) => target.id === provider.id))
  selectedIds.value = []
  notify('Đã xóa provider', { tone: 'success', message: `${targets.length} provider đã được xóa.` })
}

watch([query, category], () => { void load() })
onMounted(load)
</script>

<template>
  <section class="provider-management">
    <PageHeader
      title="Quản lý provider"
      :subtitle="`${providers.length} provider · schema dùng chung cho Model Configuration`"
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
          @click="$router.push('/model-config')"
        >
          Model Configuration
        </VtButton>
      </template>
    </PageHeader>

    <VtCard class="management-card">
      <div class="operation-bar">
        <div class="search-control">
          <VtInput
            v-model="query"
            :icon="Search"
            aria-label="Tìm provider"
            placeholder="Tìm theo tên hoặc mã provider…"
          />
        </div>
        <div class="category-control">
          <VtSelect
            v-model="category"
            label="Lọc danh mục provider"
            :options="categoryOptions"
          />
        </div>
        <VtBadge tone="neutral">
          <ListFilter :size="13" />{{ filteredProviders.length }} kết quả
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
        :items="filteredProviders"
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
      :title="`Trường cấu hình · ${inspectorProvider?.name ?? 'provider'}`"
    />
    <VtDialog
      :open="Boolean(deleteTarget)"
      title="Xóa provider?"
      description="Model đang dùng provider này sẽ không bị xóa, nhưng provider không thể khôi phục sau khi xóa."
      width="sm"
      @update:open="(open) => !open && (deleteTarget = undefined)"
    >
      <p class="confirm-copy">
        Bạn chắc chắn muốn xóa <strong>{{ deleteTarget?.name }}</strong>?
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
.search-control { width: min(380px, 100%); }
.category-control { width: min(270px, 100%); }
.operation-bar .vt-badge { margin-left: auto; }
.error-state { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #f1c4c8; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 10px 12px; font-size: 11px; }
.table-footer { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 10px; border-top: 1px solid var(--vt-border); color: var(--vt-text-muted); padding: 0 15px; font-size: 11px; }
.footer-actions { display: flex; gap: 8px; }
.confirm-copy { margin: 0; color: var(--vt-text-soft); font-size: 13px; }
@media (max-width: 720px) { .operation-bar { align-items: stretch; flex-direction: column; }.search-control, .category-control { width: 100%; }.operation-bar .vt-badge { width: fit-content; margin-left: 0; }.table-footer { align-items: flex-start; flex-direction: column; padding-block: 12px; } }
</style>
