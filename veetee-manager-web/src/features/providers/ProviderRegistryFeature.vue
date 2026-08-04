<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

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
import VtStatus from '@/ui/primitives/VtStatus.vue'
import { notify } from '@/ui/primitives/notifications'

import SchemaConfigForm from './SchemaConfigForm.vue'
import { cloneConfig } from './schema-config'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const installations = ref<ProviderInstallationView[]>([])
const configs = ref<ProviderConfigRecord[]>([])
const selectedId = ref('')
const selectedConfigId = ref('')
const name = ref('')
const configDraft = ref<Record<string, unknown>>({})
const configValid = ref(true)
const secretRefs = ref('')
const loading = ref(true)
const saving = ref(false)
const loadState = ref<'loading' | 'ready' | 'empty' | 'error' | 'offline'>('loading')
const loadError = ref('')
const saveError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
const saveErrorHeading = ref<HTMLElement | null>(null)
let loadGeneration = 0

const options = computed<VtSelectOption[]>(() => installations.value.map((item) => ({ value: item.id, label: item.displayNameKey, description: `${item.kind.toUpperCase()} · ${item.version}` })))
const selected = computed(() => installations.value.find((item) => item.id === selectedId.value))
const schemaKeys = computed(() => Object.keys((selected.value?.configSchema.properties as Record<string, unknown> | undefined) ?? {}))

function chooseInstallation(value: string) {
  selectedId.value = value
  const item = configs.value.find((config) => config.installationId === value)
  selectedConfigId.value = item?.id ?? ''
  name.value = item?.name ?? ''
  configDraft.value = cloneConfig(item?.config ?? {})
  configValid.value = true
  secretRefs.value = item?.secretRefs.join(', ') ?? ''
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const [catalog, configured] = await Promise.all([
      gateway.listProviderInstallations(),
      gateway.listProviderConfigs(),
    ])
    if (generation !== loadGeneration) return

    const failures = [
      !catalog.ok ? 'catalog' : null,
      !configured.ok ? 'config' : null,
    ].filter((value): value is string => value !== null)
    if (failures.length > 0) {
      const offline = catalog.meta.offline || configured.meta.offline
      loadState.value = offline ? 'offline' : 'error'
      loadError.value = failures.length === 2
        ? 'Không tải được catalog và các config provider.'
        : failures[0] === 'catalog'
          ? 'Không tải được catalog provider từ Manager API.'
          : 'Không tải được các config provider từ Manager API.'
      await focusStateHeading()
      return
    }

    if (!catalog.ok || !configured.ok) return
    configs.value = configured.data
    installations.value = catalog.data
    if (!catalog.data.some((item) => item.id === selectedId.value)) {
      selectedId.value = ''
      selectedConfigId.value = ''
    }
    if (!selectedId.value && catalog.data[0]) chooseInstallation(catalog.data[0].id)
    loadState.value = catalog.data.length > 0 ? 'ready' : 'empty'
  } catch {
    if (generation !== loadGeneration) return
    loadState.value = 'offline'
    loadError.value = 'Không kết nối được Manager API. Kiểm tra service hoặc mạng LAN.'
    await focusStateHeading()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function focusStateHeading() {
  await nextTick()
  stateHeading.value?.focus()
}

async function focusSaveError() {
  await nextTick()
  saveErrorHeading.value?.focus()
}

async function save() {
  if (!selected.value || !name.value.trim() || !configValid.value) return
  saveError.value = ''
  saving.value = true
  const payload = { name: name.value.trim(), config: cloneConfig(configDraft.value), secretRefs: secretRefs.value.split(',').map((item) => item.trim()).filter(Boolean) }
  try {
    const result = selectedConfigId.value
      ? await gateway.updateProviderConfig(selectedConfigId.value, payload, configs.value.find((item) => item.id === selectedConfigId.value)?.etag ?? '"missing"')
      : await gateway.createProviderConfig({ installationId: selected.value.id, ...payload })
    if (result.ok) {
      configs.value = [...configs.value.filter((item) => item.id !== result.data.id), result.data]
      selectedConfigId.value = result.data.id
      notify('Đã lưu provider config', { tone: 'success', message: 'Revision đã được cập nhật; selection chỉ đổi sau khi bạn chọn và publish trong Assistant.' })
    } else {
      saveError.value = result.meta.offline
        ? 'Đang ngoại tuyến; bản nháp vẫn được giữ trên màn hình và chưa được gửi.'
        : 'Không thể lưu provider config; bản nháp vẫn được giữ để bạn sửa hoặc thử lại.'
      notify('Không thể lưu provider config', { tone: 'error', message: saveError.value, assertive: true })
      await focusSaveError()
    }
  } catch {
    saveError.value = 'Không kết nối được Manager API; bản nháp vẫn được giữ trên màn hình.'
    notify('Không thể lưu provider config', { tone: 'error', message: saveError.value, assertive: true })
    await focusSaveError()
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <main
    id="main-content"
    class="page-container provider-page"
    :aria-busy="loading"
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
      v-if="loadState === 'loading'"
      class="provider-state"
      role="status"
      aria-live="polite"
    >
      Đang tải catalog…
    </div>
    <VtCard
      v-else-if="loadState === 'error' || loadState === 'offline'"
      class="provider-state provider-state-error"
      role="alert"
    >
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        {{ loadState === 'offline' ? 'Manager API đang ngoại tuyến' : 'Không tải được provider registry' }}
      </h2>
      <p>{{ loadError }}</p>
      <VtButton
        variant="secondary"
        :loading="loading"
        @click="load"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <div
      v-else-if="loadState === 'ready' && selected"
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
          Field được sinh từ manifest JSON Schema; secret chỉ tham chiếu bằng secretRef và plaintext key không đi vào browser.
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
        <SchemaConfigForm
          v-model="configDraft"
          :schema="selected.configSchema"
          :disabled="saving"
          @validity-change="configValid = $event"
        />
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
          <p
            v-if="saveError"
            ref="saveErrorHeading"
            class="provider-save-error"
            role="alert"
            tabindex="-1"
          >
            {{ saveError }}
          </p>
          <VtButton
            variant="primary"
            :loading="saving"
            :disabled="!name.trim() || !configValid"
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
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        Catalog provider đang trống
      </h2>
      <p>Catalog chưa được publish hoặc API đang ở chế độ preview fixture.</p>
      <VtButton
        variant="secondary"
        :loading="loading"
        @click="load"
      >
        Tải lại catalog
      </VtButton>
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
.provider-state, .empty-card { color: var(--vt-text-muted); padding: 24px; text-align: center; }
.provider-state h2, .empty-card h2 { color: var(--vt-text); font-size: 14px; }
.provider-state p, .empty-card p { margin: 7px auto 13px; max-width: 460px; font-size: 11px; line-height: 1.5; }
.provider-state-error { display: grid; justify-items: center; gap: 4px; }
.provider-state-error h2:focus-visible, .empty-card h2:focus-visible, .provider-save-error:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.provider-save-error { flex: 1; margin: 0; color: var(--vt-danger); font-size: 11px; line-height: 1.45; }
@media (max-width: 760px) { .provider-header, .provider-layout { grid-template-columns: 1fr; display: grid; } }
</style>
