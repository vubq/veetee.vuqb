<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { requireInjection } from '@/app/requireInjection'
import type { PreviewScenarioId } from '@/domain'
import { previewControlGatewayKey } from '@/gateways'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import { notify } from '@/ui/primitives/notifications'

const emit = defineEmits<{ change: [scenario: PreviewScenarioId]; reset: [] }>()
const gateway = requireInjection(previewControlGatewayKey, 'PreviewControlGateway')
const { t } = useI18n()

const selected = ref<PreviewScenarioId>(gateway.getScenario())
const resetting = ref(false)
const options: VtSelectOption[] = gateway.listScenarios().map((scenario) => ({
  value: scenario.id,
  label: t(scenario.labelKey),
  description: t(scenario.descriptionKey),
}))

function change(value: string) {
  selected.value = value as PreviewScenarioId
  gateway.setScenario(selected.value)
  emit('change', selected.value)
  notify('Đã đổi tình huống mô phỏng', { message: options.find((item) => item.value === value)?.label })
}

async function reset() {
  resetting.value = true
  const result = await gateway.resetDemo()
  resetting.value = false
  selected.value = gateway.getScenario()
  emit('reset')
  if (result.ok) notify('Đã đặt lại dữ liệu mẫu', { tone: 'success', message: `${result.data.assistantCount} trợ lý · ${result.data.deviceCount} thiết bị.` })
}
</script>

<template>
  <aside
    class="scenario-toolbar"
    aria-label="Điều khiển bản xem trước"
  >
    <div class="scenario-copy">
      <strong>Tình huống</strong><span>Chỉ tác động MockGateway</span>
    </div>
    <div class="scenario-select">
      <VtSelect
        :model-value="selected"
        label="Tình huống mô phỏng"
        :options="options"
        @update:model-value="change"
      />
    </div>
    <VtButton
      size="sm"
      :loading="resetting"
      @click="reset"
    >
      Đặt lại dữ liệu mẫu
    </VtButton>
  </aside>
</template>

<style scoped>
.scenario-toolbar { display: flex; min-height: 54px; align-items: center; gap: 10px; margin-bottom: 12px; border: 1px solid #cddcff; border-radius: var(--vt-radius-section); background: var(--vt-primary-soft); padding: 7px 9px 7px 12px; }
.scenario-copy { min-width: 120px; }
.scenario-copy strong { display: block; color: var(--vt-primary-text); font-size: 11px; }
.scenario-copy span { display: block; color: var(--vt-text-muted); font-size: 9px; }
.scenario-select { width: min(300px, 100%); margin-left: auto; }
.scenario-select :deep(.vt-select-trigger) { height: 36px; background: var(--vt-surface); font-size: 11px; }
@media (max-width: 620px) {
  .scenario-toolbar { align-items: stretch; flex-wrap: wrap; }
  .scenario-copy { width: 100%; }
  .scenario-select { min-width: 0; flex: 1; margin-left: 0; }
}
</style>
