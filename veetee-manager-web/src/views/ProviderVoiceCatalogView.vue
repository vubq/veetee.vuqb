<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@lucide/vue'

import { requireInjection } from '@/app/requireInjection'
import type { ModelConfigRecord, ProviderConfigRecord } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VoiceCatalogPanel from '@/features/providers/VoiceCatalogPanel.vue'
import AiServicesNav from '@/features/providers/AiServicesNav.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSelect from '@/ui/primitives/VtSelect.vue'
import type { VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import { localizedModelName } from '@/features/providers/model-registry-labels'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const route = useRoute()
const router = useRouter()
const configs = ref<ProviderConfigRecord[]>([])
const models = ref<ModelConfigRecord[]>([])
const modelId = ref('')
const loading = ref(true)
const error = ref('')

const modelOptions = computed<VtSelectOption[]>(() => models.value.map((model) => ({ value: model.id, label: localizedModelName(model), description: `${model.modelCode} · ${model.providerCode}`, disabled: !model.isEnabled })))
const selectedModel = computed(() => models.value.find((model) => model.id === modelId.value))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [configResult, modelResult] = await Promise.all([
      gateway.listProviderConfigs('tts'),
      gateway.listModelConfigs({ modelType: 'TTS', page: 1, limit: 100 }),
    ])
    if (configResult.ok && modelResult.ok) {
      configs.value = configResult.data
      models.value = modelResult.data.items
      const requested = typeof route.query.modelId === 'string' ? route.query.modelId : ''
      modelId.value = models.value.some((model) => model.id === requested)
        ? requested
        : models.value.find((model) => model.isDefault)?.id ?? models.value[0]?.id ?? ''
    } else error.value = 'Không tải được cấu hình hoặc catalog TTS. Hãy thử lại sau.'
  } catch {
    error.value = 'Không kết nối được máy chủ quản trị. Hãy thử lại sau.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
watch(() => route.query.modelId, (value) => {
  if (typeof value === 'string' && models.value.some((model) => model.id === value)) modelId.value = value
})
watch(modelId, (value) => {
  if (value && route.query.modelId !== value) void router.replace({ query: { ...route.query, modelId: value } })
})
</script>

<template>
  <main
    id="main-content"
    class="page-container voice-page"
    :aria-busy="loading"
  >
    <AiServicesNav />
    <RouterLink
      class="back-link"
      to="/model-config"
    >
      <VtIcon
        :icon="ArrowLeft"
        :size="15"
      />
      <span>Tổng quan dịch vụ AI</span>
    </RouterLink>
    <header class="voice-header">
      <div>
        <p class="eyebrow">
          Giọng nói
        </p>
        <h1>Thư viện giọng đọc</h1>
        <p class="lede">
          Chọn đúng model TTS rồi tìm kiếm, nghe thử và quản lý các voice preset của model đó.
        </p>
      </div>
    </header>
    <VtCard
      v-if="!loading && !error && models.length"
      class="model-selector-card"
    >
      <VtSelect
        v-model="modelId"
        label="Model TTS đang quản lý"
        :options="modelOptions"
      />
      <p class="model-selector-help">
        Danh sách bên dưới thuộc đúng model này; thay đổi ở đây không đổi provider runtime của trợ lý cho đến khi bạn áp dụng cấu hình.
      </p>
    </VtCard>
    <VtCard
      v-if="loading"
      class="state-card"
      role="status"
    >
      Đang tải cấu hình TTS…
    </VtCard>
    <VtCard
      v-else-if="error"
      class="state-card"
      role="alert"
    >
      <p>{{ error }}</p>
      <VtButton
        variant="secondary"
        @click="load"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <VoiceCatalogPanel
      v-else
      :configs="configs"
      :models="models"
      :model-id="modelId"
      :model="selectedModel"
      :gateway="gateway"
    />
  </main>
</template>

<style scoped>
.voice-page { display: grid; gap: 14px; }
.back-link { display: inline-flex; width: fit-content; align-items: center; gap: 6px; min-height: 34px; justify-self: start; border-radius: var(--vt-radius-button); color: var(--vt-text-muted); padding: 0 8px; font-size: 11px; text-decoration: none; transition: color var(--vt-transition), background var(--vt-transition); }
.back-link:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.back-link:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.voice-header { display: flex; align-items: flex-start; justify-content: space-between; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 0; color: var(--vt-text); font-size: 22px; letter-spacing: -.02em; }
.lede { max-width: 620px; margin: 6px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.state-card { display: grid; justify-items: center; gap: 8px; color: var(--vt-text-muted); padding: 30px; text-align: center; }
.model-selector-card { display: grid; grid-template-columns: minmax(240px, 420px) minmax(0, 1fr); align-items: end; gap: 14px; }
.model-selector-help { margin: 0 0 3px; color: var(--vt-text-muted); font-size: 10px; line-height: 1.5; }
@media (max-width: 680px) { .model-selector-card { grid-template-columns: 1fr; align-items: start; } }
</style>
