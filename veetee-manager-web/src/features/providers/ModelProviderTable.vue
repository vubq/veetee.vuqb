<script setup lang="ts">
import { Eye, Pencil, Trash2 } from '@lucide/vue'

import type { ModelProviderRecord } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'

import { MODEL_TYPE_LABELS } from './model-registry-labels'

defineProps<{
  items: ModelProviderRecord[]
  selectedIds: string[]
  allSelected: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  toggleAll: []
  toggle: [id: string, selected: boolean]
  inspect: [provider: ModelProviderRecord]
  edit: [provider: ModelProviderRecord]
  remove: [provider: ModelProviderRecord]
}>()
</script>

<template>
  <div class="provider-table-shell">
    <div
      v-if="loading"
      class="table-state"
      role="status"
    >
      Đang tải danh sách provider…
    </div>
    <div
      v-else-if="items.length === 0"
      class="table-state"
    >
      Không có provider phù hợp với bộ lọc hiện tại.
    </div>
    <div
      v-else
      class="table-scroll"
    >
      <table class="provider-table">
        <thead>
          <tr>
            <th class="selection-column">
              <VtCheckbox
                label="Chọn tất cả provider"
                aria-label="Chọn tất cả provider"
                :show-label="false"
                :model-value="allSelected"
                @update:model-value="emit('toggleAll')"
              />
            </th>
            <th>Danh mục</th>
            <th>Mã provider</th>
            <th>Tên provider</th>
            <th>Trường cấu hình</th>
            <th class="sort-column">
              Thứ tự
            </th>
            <th class="actions-column">
              Thao tác
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="provider in items"
            :key="provider.id"
          >
            <td>
              <VtCheckbox
                :label="`Chọn ${provider.name}`"
                :show-label="false"
                :model-value="selectedIds.includes(provider.id)"
                @update:model-value="emit('toggle', provider.id, $event)"
              />
            </td>
            <td>
              <VtBadge tone="primary">
                {{ MODEL_TYPE_LABELS[provider.modelType] }}
              </VtBadge>
            </td>
            <td><code class="provider-code">{{ provider.providerCode }}</code></td>
            <td>
              <div class="provider-name">
                <strong>{{ provider.name }}</strong><small>{{ provider.id }}</small>
              </div>
            </td>
            <td>
              <button
                type="button"
                class="field-count"
                @click="emit('inspect', provider)"
              >
                <Eye :size="14" />
                <span>{{ provider.fields.length }} trường</span>
              </button>
            </td>
            <td class="sort-column">
              {{ provider.sort }}
            </td>
            <td>
              <div class="row-actions">
                <VtIconButton
                  :icon="Pencil"
                  :label="`Sửa ${provider.name}`"
                  size="sm"
                  variant="soft"
                  @click="emit('edit', provider)"
                />
                <VtIconButton
                  :icon="Trash2"
                  :label="`Xóa ${provider.name}`"
                  size="sm"
                  variant="danger"
                  @click="emit('remove', provider)"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.provider-table-shell { min-width: 0; overflow: hidden; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); }
.table-scroll { overflow-x: auto; }
.provider-table { width: 100%; min-width: 900px; border-collapse: collapse; table-layout: fixed; }
.provider-table th, .provider-table td { border-bottom: 1px solid var(--vt-border); padding: 11px 12px; text-align: left; vertical-align: middle; }
.provider-table th { background: var(--vt-surface-subtle); color: var(--vt-text-muted); font-size: 10px; font-weight: 700; letter-spacing: .02em; white-space: nowrap; }
.provider-table td { color: var(--vt-text-soft); font-size: 11px; }
.provider-table tbody tr:last-child td { border-bottom: 0; }
.provider-table tbody tr:hover { background: #fbfdff; }
.provider-table th:nth-child(1), .provider-table td:nth-child(1) { width: 138px; }
.provider-table th:nth-child(2), .provider-table td:nth-child(2) { width: 175px; }
.provider-table th:nth-child(3), .provider-table td:nth-child(3) { width: 130px; }
.provider-table th:nth-child(5), .provider-table td:nth-child(5) { width: 150px; }
.provider-table .sort-column { width: 70px; text-align: center; }
.provider-table .actions-column { width: 112px; text-align: right; }
.provider-table td.actions-column { text-align: right; }
.provider-code { color: var(--vt-primary-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.provider-name { display: grid; min-width: 0; gap: 2px; }
.provider-name strong, .provider-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-name strong { color: var(--vt-text); font-size: 12px; font-weight: 600; }
.provider-name small { color: var(--vt-text-faint); font-size: 9px; }
.field-count { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; color: var(--vt-primary-text); padding: 0; font-size: 11px; font-weight: 600; }
.field-count:hover { color: var(--vt-primary); text-decoration: underline; }
.field-count:focus-visible { border-radius: 4px; box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.row-actions { display: flex; justify-content: flex-end; gap: 4px; }
.table-state { color: var(--vt-text-muted); padding: 48px 20px; text-align: center; }
@media (max-width: 700px) { .provider-table-shell { border-radius: var(--vt-radius-section); } }
</style>
