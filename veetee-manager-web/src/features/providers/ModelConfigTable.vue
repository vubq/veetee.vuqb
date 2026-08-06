<script setup lang="ts">
import { Copy, Pencil, Trash2, Volume2 } from '@lucide/vue'

import type { ModelConfigRecord, ModelProviderRecord } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtCheckbox from '@/ui/primitives/VtCheckbox.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'

import { localizedModelName, localizedProviderName, MODEL_TYPE_SHORT_LABELS } from './model-registry-labels'

defineProps<{
  items: ModelConfigRecord[]
  providers: ModelProviderRecord[]
  selectedIds: string[]
  allSelected: boolean
  activeType: ModelConfigRecord['modelType']
  loading?: boolean
}>()

const emit = defineEmits<{
  toggleAll: []
  toggle: [id: string, selected: boolean]
  enabled: [model: ModelConfigRecord, enabled: boolean]
  default: [model: ModelConfigRecord]
  edit: [model: ModelConfigRecord]
  duplicate: [model: ModelConfigRecord]
  remove: [model: ModelConfigRecord]
  voices: [model: ModelConfigRecord]
}>()

function providerName(model: ModelConfigRecord, providers: ModelProviderRecord[]): string {
  const provider = providers.find((item) => item.modelType === model.modelType && item.providerCode === model.providerCode)
  return provider ? localizedProviderName(provider) : model.providerCode
}

function voiceValue(model: ModelConfigRecord): string {
  const value = model.configJson.voice ?? model.configJson.voice_id
  return typeof value === 'string' && value.trim() ? value : 'Quản lý âm thanh'
}
</script>

<template>
  <div class="model-table-shell">
    <div
      v-if="loading"
      class="table-state"
      role="status"
    >
      Đang tải danh sách model…
    </div>
    <div
      v-else-if="items.length === 0"
      class="table-state"
    >
      Chưa có model trong danh mục này.
    </div>
    <div
      v-else
      class="table-content"
    >
      <div class="desktop-table">
        <p class="mobile-table-hint">
          Vuốt ngang để xem đủ cột và thao tác.
        </p>
        <div class="table-scroll">
          <table class="model-table">
            <thead>
              <tr>
                <th class="selection-column">
                  <VtCheckbox
                    label="Chọn tất cả model"
                    aria-label="Chọn tất cả model"
                    :show-label="false"
                    :model-value="allSelected"
                    @update:model-value="emit('toggleAll')"
                  />
                </th>
                <th>Model ID</th>
                <th>Tên model</th>
                <th>Provider</th>
                <th>Đang bật</th>
                <th>Mặc định</th>
                <th v-if="activeType === 'TTS'">
                  Giọng nói
                </th>
                <th class="actions-column">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="model in items"
                :key="model.id"
              >
                <td>
                  <VtCheckbox
                    :label="`Chọn ${localizedModelName(model)}`"
                    :show-label="false"
                    :model-value="selectedIds.includes(model.id)"
                    @update:model-value="emit('toggle', model.id, $event)"
                  />
                </td>
                <td><code class="model-id">{{ model.id }}</code></td>
                <td>
                  <div class="model-name">
                    <strong>{{ localizedModelName(model) }}</strong><small>{{ MODEL_TYPE_SHORT_LABELS[model.modelType] }} · {{ model.modelCode }}</small>
                  </div>
                </td>
                <td>
                  <VtBadge tone="neutral">
                    {{ providerName(model, providers) }}
                  </VtBadge>
                </td>
                <td>
                  <VtSwitch
                    :model-value="model.isEnabled"
                    :label="`Bật ${localizedModelName(model)}`"
                    :aria-label="`${model.isEnabled ? 'Tắt' : 'Bật'} ${localizedModelName(model)}`"
                    :show-label="false"
                    :disabled="model.isDefault && model.isEnabled"
                    @update:model-value="emit('enabled', model, $event)"
                  />
                </td>
                <td>
                  <button
                    type="button"
                    class="default-toggle"
                    :class="{ active: model.isDefault }"
                    :aria-pressed="model.isDefault"
                    :aria-label="`${model.isDefault ? 'Bỏ model mặc định' : 'Đặt làm model mặc định'} ${localizedModelName(model)}`"
                    @click="emit('default', model)"
                  >
                    <span class="default-dot" />{{ model.isDefault ? 'Mặc định' : 'Đặt làm mặc định' }}
                  </button>
                </td>
                <td v-if="activeType === 'TTS'">
                  <button
                    type="button"
                    class="voice-link"
                    @click="emit('voices', model)"
                  >
                    <Volume2 :size="14" />{{ voiceValue(model) }}
                  </button>
                </td>
                <td>
                  <div class="row-actions">
                    <VtIconButton
                      :icon="Pencil"
                      :label="`Sửa ${localizedModelName(model)}`"
                      size="sm"
                      variant="soft"
                      @click="emit('edit', model)"
                    />
                    <VtIconButton
                      :icon="Copy"
                      :label="`Nhân bản ${localizedModelName(model)}`"
                      size="sm"
                      variant="soft"
                      @click="emit('duplicate', model)"
                    />
                    <VtIconButton
                      :icon="Trash2"
                      :label="`Xóa ${localizedModelName(model)}`"
                      size="sm"
                      variant="danger"
                      @click="emit('remove', model)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mobile-card-list">
        <div class="mobile-list-toolbar">
          <VtCheckbox
            label="Chọn tất cả model"
            aria-label="Chọn tất cả model"
            :show-label="false"
            :model-value="allSelected"
            @update:model-value="emit('toggleAll')"
          />
          <span>Chọn tất cả</span>
        </div>
        <article
          v-for="model in items"
          :key="`mobile-${model.id}`"
          class="model-card"
        >
          <header class="mobile-card-header">
            <VtCheckbox
              :label="`Chọn ${localizedModelName(model)}`"
              :show-label="false"
              :model-value="selectedIds.includes(model.id)"
              @update:model-value="emit('toggle', model.id, $event)"
            />
            <div class="mobile-card-name">
              <strong :title="localizedModelName(model)">{{ localizedModelName(model) }}</strong>
              <code :title="model.id">{{ model.id }}</code>
            </div>
            <VtBadge :tone="model.isDefault ? 'primary' : 'neutral'">
              {{ model.isDefault ? 'Mặc định' : MODEL_TYPE_SHORT_LABELS[model.modelType] }}
            </VtBadge>
          </header>
          <dl class="mobile-card-meta">
            <div>
              <dt>Provider</dt><dd :title="providerName(model, providers)">
                {{ providerName(model, providers) }}
              </dd>
            </div>
            <div>
              <dt>Trạng thái</dt><dd>
                <VtSwitch
                  :model-value="model.isEnabled"
                  :label="`${model.isEnabled ? 'Tắt' : 'Bật'} ${localizedModelName(model)}`"
                  :show-label="false"
                  :disabled="model.isDefault && model.isEnabled"
                  @update:model-value="emit('enabled', model, $event)"
                />
              </dd>
            </div>
            <div v-if="activeType === 'TTS'">
              <dt>Giọng</dt><dd>
                <button
                  type="button"
                  class="voice-link"
                  @click="emit('voices', model)"
                >
                  <Volume2 :size="14" />{{ voiceValue(model) }}
                </button>
              </dd>
            </div>
          </dl>
          <footer class="mobile-card-actions">
            <button
              type="button"
              class="default-toggle"
              :class="{ active: model.isDefault }"
              :aria-pressed="model.isDefault"
              :aria-label="`${model.isDefault ? 'Bỏ model mặc định' : 'Đặt làm model mặc định'} ${localizedModelName(model)}`"
              @click="emit('default', model)"
            >
              <span class="default-dot" />{{ model.isDefault ? 'Mặc định' : 'Đặt làm mặc định' }}
            </button>
            <div class="row-actions">
              <VtIconButton
                :icon="Pencil"
                :label="`Sửa ${localizedModelName(model)}`"
                size="sm"
                variant="soft"
                @click="emit('edit', model)"
              />
              <VtIconButton
                :icon="Copy"
                :label="`Nhân bản ${localizedModelName(model)}`"
                size="sm"
                variant="soft"
                @click="emit('duplicate', model)"
              />
              <VtIconButton
                :icon="Trash2"
                :label="`Xóa ${localizedModelName(model)}`"
                size="sm"
                variant="danger"
                @click="emit('remove', model)"
              />
            </div>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-table-shell { min-width: 0; overflow: hidden; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); }
.table-scroll { overflow-x: auto; }
.mobile-card-list { display: none; }
.model-table { width: 100%; min-width: 1040px; border-collapse: collapse; table-layout: fixed; }
.model-table th, .model-table td { border-bottom: 1px solid var(--vt-border); padding: 11px 12px; text-align: left; vertical-align: middle; }
.model-table th { background: var(--vt-surface-subtle); color: var(--vt-text-muted); font-size: 10px; font-weight: 700; white-space: nowrap; }
.model-table td { color: var(--vt-text-soft); font-size: 11px; }
.model-table tbody tr:last-child td { border-bottom: 0; }
.model-table tbody tr:hover { background: #fbfdff; }
.model-table th:nth-child(1), .model-table td:nth-child(1) { width: 135px; }
.model-table th:nth-child(2), .model-table td:nth-child(2) { width: 165px; }
.model-table th:nth-child(3), .model-table td:nth-child(3) { width: 200px; }
.model-table th:nth-child(4), .model-table td:nth-child(4) { width: 155px; }
.model-table th:nth-child(5), .model-table td:nth-child(5) { width: 100px; }
.model-table th:nth-child(6), .model-table td:nth-child(6) { width: 120px; }
.model-table th:nth-child(7), .model-table td:nth-child(7) { width: 150px; }
.model-table .actions-column { width: 122px; text-align: right; }
.model-id { color: var(--vt-primary-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.model-name { display: grid; min-width: 0; gap: 2px; }
.model-name strong, .model-name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-name strong { color: var(--vt-text); font-size: 12px; font-weight: 600; }
.model-name small { color: var(--vt-text-faint); font-size: 9px; }
.default-toggle, .voice-link { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; padding: 0; color: var(--vt-text-muted); font-size: 10px; font-weight: 600; }
.default-toggle:hover, .voice-link:hover { color: var(--vt-primary); }
.default-toggle:focus-visible, .voice-link:focus-visible { border-radius: 4px; box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.default-toggle.active { color: var(--vt-primary-text); }
.default-dot { width: 8px; height: 8px; border: 1px solid currentColor; border-radius: 50%; }
.default-toggle.active .default-dot { border-color: var(--vt-primary); background: var(--vt-primary); box-shadow: 0 0 0 2px var(--vt-primary-soft); }
.voice-link { color: var(--vt-primary-text); }
.row-actions { display: flex; justify-content: flex-end; gap: 3px; }
.table-state { color: var(--vt-text-muted); padding: 48px 20px; text-align: center; }
.mobile-table-hint { display: none; margin: 0; border-bottom: 1px solid var(--vt-border); background: var(--vt-surface-subtle); color: var(--vt-text-faint); padding: 7px 10px; font-size: 9px; }
.mobile-list-toolbar { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--vt-border); color: var(--vt-text-muted); padding: 10px 11px; font-size: 11px; }
.model-card { display: grid; gap: 11px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); padding: 12px; }
.mobile-card-header, .mobile-card-actions { display: flex; min-width: 0; align-items: center; gap: 9px; }
.mobile-card-name { display: grid; min-width: 0; flex: 1; gap: 3px; }
.mobile-card-name strong, .mobile-card-name code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-card-name strong { color: var(--vt-text); font-size: 12px; font-weight: 650; }
.mobile-card-name code { color: var(--vt-primary-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
.mobile-card-meta { display: grid; gap: 7px; margin: 0; border-top: 1px solid var(--vt-border); border-bottom: 1px solid var(--vt-border); padding: 10px 0; }
.mobile-card-meta > div { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 10px; }
.mobile-card-meta dt { color: var(--vt-text-muted); font-size: 10px; }
.mobile-card-meta dd { min-width: 0; margin: 0; color: var(--vt-text); font-size: 10px; font-weight: 600; text-align: right; }
.mobile-card-meta dd:not(:has(.vt-switch)) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mobile-card-actions { justify-content: space-between; }
@media (max-width: 820px) {
  .desktop-table { display: none; }
  .mobile-card-list { display: grid; gap: 8px; }
  .model-table-shell { border: 0; background: transparent; }
}
</style>
