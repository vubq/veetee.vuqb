<script setup lang="ts">
import { computed } from 'vue'

import type { ProviderConfigRecord, ProviderInstallationView, ProviderKind, ProviderProbeResult } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

const props = defineProps<{
  configs: ProviderConfigRecord[]
  installations: ProviderInstallationView[]
  selectedId: string
  probeResults: Record<string, ProviderProbeResult | undefined>
  probingId?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  probe: [id: string]
  remove: [id: string]
}>()

const query = defineModel<string>('query', { default: '' })
const kind = defineModel<ProviderKind | 'all'>('kind', { default: 'all' })

const kindOptions: VtSelectOption[] = [
  { value: 'all', label: 'Tất cả loại' },
  { value: 'vad', label: 'Lọc tiếng ồn' },
  { value: 'asr', label: 'Nhận dạng lời nói' },
  { value: 'llm', label: 'Bộ não trả lời' },
  { value: 'tts', label: 'Giọng nói' },
  { value: 'intent', label: 'Hiểu ý định' },
  { value: 'memory', label: 'Ghi nhớ' },
]

function kindLabel(kind: ProviderKind | undefined) {
  return kindOptions.find((option) => option.value === kind)?.label ?? 'Dịch vụ'
}

const filtered = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  return props.configs.filter((config) => {
    const installation = props.installations.find((item) => item.id === config.installationId)
    const matchesKind = kind.value === 'all' || installation?.kind === kind.value
    const haystack = `${config.name} ${installation?.displayNameKey ?? config.installationId} ${installation?.kind ?? ''}`.toLocaleLowerCase()
    return matchesKind && (!normalized || haystack.includes(normalized))
  })
})

function installationFor(config: ProviderConfigRecord) {
  return props.installations.find((item) => item.id === config.installationId)
}

function installationLabel(config: ProviderConfigRecord) {
  const installation = installationFor(config)
  return installation?.displayName ?? installation?.displayNameKey ?? config.installationId
}

function probeTone(result: ProviderProbeResult | undefined) {
  return result?.state === 'ready' ? 'online' : result ? 'error' : 'neutral'
}

function probeLabel(result: ProviderProbeResult | undefined) {
  return result?.state === 'ready' ? 'Sẵn sàng' : result ? 'Không khả dụng' : 'Chưa kiểm tra'
}
</script>

<template>
  <VtCard class="provider-list-card">
    <header class="list-heading">
      <div>
        <h2>Cấu hình dịch vụ</h2>
        <p>Chọn một cấu hình để chỉnh sửa. Mỗi loại dịch vụ có một lựa chọn cho từng trợ lý.</p>
      </div>
      <VtBadge tone="primary">
        {{ filtered.length }} dịch vụ
      </VtBadge>
    </header>
    <div class="list-filters">
      <VtInput
        v-model="query"
        name="provider-search"
        autocomplete="off"
        aria-label="Tìm cấu hình dịch vụ"
        placeholder="Tìm cấu hình…"
      />
      <VtSelect
        v-model="kind"
        label="Lọc theo loại dịch vụ"
        :options="kindOptions"
      />
    </div>
    <ul
      v-if="filtered.length"
      class="provider-list"
    >
      <li
        v-for="config in filtered"
        :key="config.id"
        class="provider-row"
        :class="{ selected: config.id === selectedId }"
      >
        <button
          class="provider-row-main"
          type="button"
          :aria-pressed="config.id === selectedId"
          @click="emit('select', config.id)"
        >
          <span class="provider-row-copy">
            <strong :title="config.name">{{ config.name }}</strong>
            <span :title="installationLabel(config)">
              {{ kindLabel(installationFor(config)?.kind) }} · {{ installationLabel(config) }}
            </span>
          </span>
          <VtStatus
            :tone="probeTone(probeResults[config.id])"
            :label="probeLabel(probeResults[config.id])"
          />
        </button>
        <div class="provider-row-actions">
          <VtButton
            size="sm"
            :loading="probingId === config.id"
            :aria-label="`Kiểm tra kết nối ${config.name}`"
            @click="emit('probe', config.id)"
          >
            Kiểm tra
          </VtButton>
          <VtButton
            size="sm"
            variant="ghost"
            :aria-label="`Ẩn ${config.name}`"
            @click="emit('remove', config.id)"
          >
            Ẩn
          </VtButton>
        </div>
      </li>
    </ul>
    <p
      v-else
      class="list-empty"
    >
      {{ configs.length ? 'Không có dịch vụ nào khớp bộ lọc.' : 'Chưa có dịch vụ nào. Hãy chọn một dịch vụ để bắt đầu.' }}
    </p>
  </VtCard>
</template>

<style scoped>
.provider-list-card { display: grid; gap: 12px; }
.list-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.list-heading h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.list-heading p { max-width: 650px; margin: 4px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.5; }
.list-filters { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 9px; }
.provider-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.provider-row { display: flex; min-width: 0; align-items: center; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 6px 7px 6px 10px; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition); }
.provider-row:hover, .provider-row.selected { border-color: var(--vt-primary); background: var(--vt-primary-soft); }
.provider-row.selected { box-shadow: 0 0 0 2px rgba(47, 107, 255, .08); }
.provider-row-main { display: flex; min-width: 0; flex: 1; align-items: center; gap: 10px; border: 0; background: transparent; color: inherit; padding: 3px 0; text-align: left; }
.provider-row-main:focus-visible { border-radius: 4px; box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.provider-row-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
.provider-row-copy strong, .provider-row-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-row-copy strong { color: var(--vt-text); font-size: 11px; font-weight: 600; }
.provider-row-copy span { color: var(--vt-text-muted); font-size: 9px; }
.provider-row-actions { display: flex; flex: none; gap: 5px; }
.list-empty { margin: 0; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 18px; font-size: 11px; text-align: center; }
@media (max-width: 680px) { .list-filters { grid-template-columns: 1fr; } .provider-row { align-items: flex-start; flex-wrap: wrap; } .provider-row-main { width: 100%; } .provider-row-actions { margin-left: auto; } }
</style>
