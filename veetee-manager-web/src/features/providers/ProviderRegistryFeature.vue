<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { ProviderConfigRecord, ProviderInstallationView } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import FormSection from '@/ui/patterns/FormSection.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'
import { notify } from '@/ui/primitives/notifications'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const installations = ref<ProviderInstallationView[]>([])
const configs = ref<ProviderConfigRecord[]>([])
const selectedId = ref('')
const name = ref('')
const jsonConfig = ref('{}')
const secretRefs = ref('')
const loading = ref(true)
const saving = ref(false)

const options = computed<VtSelectOption[]>(() => installations.value.map((item) => ({ value: item.id, label: item.displayNameKey, description: `${item.kind.toUpperCase()} · ${item.version}` })))
const selected = computed(() => installations.value.find((item) => item.id === selectedId.value))
const schemaKeys = computed(() => Object.keys((selected.value?.configSchema.properties as Record<string, unknown> | undefined) ?? {}))

function chooseInstallation(value: string) {
  selectedId.value = value
  const item = configs.value.find((config) => config.installationId === value)
  name.value = item?.name ?? ''
  jsonConfig.value = JSON.stringify(item?.config ?? {}, null, 2)
  secretRefs.value = item?.secretRefs.join(', ') ?? ''
}

async function load() {
  loading.value = true
  const [catalog, configured] = await Promise.all([gateway.listProviderInstallations(), gateway.listProviderConfigs()])
  if (catalog.ok) {
    installations.value = catalog.data
    if (!selectedId.value && catalog.data[0]) chooseInstallation(catalog.data[0].id)
  }
  if (configured.ok) configs.value = configured.data
  loading.value = false
}

async function save() {
  if (!selected.value || !name.value.trim()) return
  let parsed: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(jsonConfig.value)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object')
    parsed = value as Record<string, unknown>
  } catch {
    notify('Cấu hình JSON không hợp lệ', { tone: 'error', assertive: true })
    return
  }
  saving.value = true
  const result = await gateway.createProviderConfig({ installationId: selected.value.id, name: name.value.trim(), config: parsed, secretRefs: secretRefs.value.split(',').map((item) => item.trim()).filter(Boolean) })
  saving.value = false
  if (result.ok) {
    configs.value = [...configs.value.filter((item) => item.id !== result.data.id), result.data]
    notify('Đã lưu provider config', { tone: 'success', message: 'Selection chỉ đổi sau khi bạn chọn và publish trong Assistant.' })
  } else {
    notify('Không thể lưu provider config', { tone: 'error', message: 'Schema provider từ chối giá trị; kiểm tra các field bắt buộc.', assertive: true })
  }
}

onMounted(load)
</script>

<template>
  <main
    id="main-content"
    class="page-container provider-page"
  >
    <header class="provider-header">
      <div>
        <p class="eyebrow">
          Control plane
        </p><h1>Provider registry</h1><p class="lede">
          Cài đặt và cấu hình VAD, ASR, LLM, TTS, Intent, Memory bằng manifest/schema; không sửa source provider.
        </p>
      </div>
      <VtBadge tone="primary">
        Config-driven
      </VtBadge>
    </header>
    <div
      v-if="loading"
      class="provider-loading"
    >
      Đang tải catalog…
    </div>
    <div
      v-else-if="selected"
      class="provider-layout"
    >
      <FormSection
        title="Provider installation"
        description="Catalog do server publish; field form không hardcode theo vendor."
      >
        <VtFormField
          label="Installation"
          for-id="provider-installation"
        >
          <VtSelect
            id="provider-installation"
            :model-value="selectedId"
            label="Installation"
            :options="options"
            @update:model-value="chooseInstallation"
          />
        </VtFormField>
        <div class="provider-meta">
          <VtStatus
            tone="online"
            :label="selected.kind.toUpperCase()"
          /><span>manifest v{{ selected.version }}</span><span>schema fields: {{ schemaKeys.length }}</span>
        </div>
      </FormSection>
      <VtCard class="config-card">
        <h2>Config revision</h2>
        <p class="muted">
          Secret chỉ tham chiếu bằng secretRef; plaintext key không đi vào browser.
        </p>
        <VtFormField
          label="Tên cấu hình"
          for-id="provider-name"
        >
          <VtInput
            id="provider-name"
            v-model="name"
            placeholder="Tên hiển thị"
          />
        </VtFormField>
        <VtFormField
          label="Config JSON"
          for-id="provider-json"
          :hint="schemaKeys.length ? `Fields: ${schemaKeys.join(', ')}` : 'Schema không có field hiển thị.'"
        >
          <VtTextArea
            id="provider-json"
            v-model="jsonConfig"
            :rows="12"
          />
        </VtFormField>
        <VtFormField
          label="Secret references"
          for-id="provider-secrets"
          hint="Phân tách bằng dấu phẩy; giá trị secret được giữ ngoài API response."
        >
          <VtInput
            id="provider-secrets"
            v-model="secretRefs"
            placeholder="secretRef.groq"
          />
        </VtFormField>
        <div class="actions">
          <VtButton
            variant="primary"
            :loading="saving"
            :disabled="!name.trim()"
            @click="save"
          >
            Lưu config revision
          </VtButton>
        </div>
      </VtCard>
    </div>
    <VtCard
      v-else
      class="empty-card"
    >
      Catalog chưa được publish hoặc API đang ở chế độ preview fixture.
    </VtCard>
  </main>
</template>

<style scoped>
.provider-page { display: grid; gap: 16px; }
.provider-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1, h2 { margin: 0; color: var(--vt-text); }
h1 { font-size: 22px; letter-spacing: -.02em; }
h2 { margin-bottom: 6px; font-size: 14px; }
.lede, .muted { margin: 6px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.provider-layout { display: grid; grid-template-columns: minmax(240px, .8fr) minmax(0, 1.2fr); gap: 14px; align-items: start; }
.provider-meta { display: flex; align-items: center; gap: 10px; margin-top: 12px; color: var(--vt-text-muted); font-size: 10px; }
.config-card { display: grid; gap: 12px; }
.actions { display: flex; justify-content: flex-end; border-top: 1px solid var(--vt-border); padding-top: 12px; }
.empty-card, .provider-loading { color: var(--vt-text-muted); padding: 24px; text-align: center; }
@media (max-width: 760px) { .provider-header, .provider-layout { grid-template-columns: 1fr; display: grid; } }
</style>
