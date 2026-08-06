<script setup lang="ts">
import { ArrowRight, Boxes, CircleAlert, Layers3, Plus, SlidersHorizontal, Volume2 } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { ModelConfigRecord, ModelProviderRecord, ModelType } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

import AiServicesNav from './AiServicesNav.vue'
import { localizedModelName, localizedProviderName, MODEL_TYPE_LABELS, MODEL_TYPE_ORDER } from './model-registry-labels'

const CORE_TYPES = ['VAD', 'ASR', 'LLM', 'TTS'] as const satisfies readonly ModelType[]

type CatalogRow = {
  type: ModelType
  label: string
  providerCount: number
  modelCount: number
  defaultModel?: ModelConfigRecord
}

const router = useRouter()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const providers = ref<ModelProviderRecord[]>([])
const configs = ref<ModelConfigRecord[]>([])
const voiceCount = ref(0)
const loading = ref(true)
const error = ref('')

const defaults = computed(() => configs.value.filter((item) => item.isDefault))
const defaultByType = computed(() => new Map(defaults.value.map((item) => [item.modelType, item])))
const catalogRows = computed<CatalogRow[]>(() => MODEL_TYPE_ORDER.map((type) => ({
  type,
  label: MODEL_TYPE_LABELS[type],
  providerCount: providers.value.filter((provider) => provider.modelType === type).length,
  modelCount: configs.value.filter((config) => config.modelType === type).length,
  defaultModel: defaultByType.value.get(type),
})).filter((row) => row.providerCount > 0 || row.modelCount > 0))
const coreRows = computed(() => catalogRows.value.filter((row) => CORE_TYPES.includes(row.type as (typeof CORE_TYPES)[number])))
const advancedRows = computed(() => catalogRows.value.filter((row) => !CORE_TYPES.includes(row.type as (typeof CORE_TYPES)[number])))
const enabledModelCount = computed(() => configs.value.filter((item) => item.isEnabled).length)
const testedDefaultsReady = computed(() => coreRows.value.filter((row) => row.defaultModel?.isEnabled).length)

function providerFor(model: ModelConfigRecord | undefined): ModelProviderRecord | undefined {
  if (!model) return undefined
  return providers.value.find((provider) => provider.modelType === model.modelType && provider.providerCode === model.providerCode)
}

function openModelConfig(type?: ModelType) {
  void router.push(type ? { path: '/model-config', query: { type } } : '/model-config')
}

function openProviderManagement(type?: ModelType) {
  void router.push(type ? { path: '/provider-management', query: { type } } : '/provider-management')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, modelResult, voicesResult] = await Promise.all([
      gateway.listModelProviders(),
      // The API can return all catalog rows in one bounded page. This avoids
      // one request per category and keeps the overview fast as categories
      // are added. The management screen still owns normal pagination.
      gateway.listModelConfigs({ page: 1, limit: 100 }),
      gateway.listVoices('vi-VN'),
    ])
    if (!providerResult.ok || !modelResult.ok) {
      error.value = 'Không tải được catalog AI. Hãy thử lại hoặc mở trực tiếp phần cấu hình.'
      return
    }
    providers.value = providerResult.data
    configs.value = modelResult.data.items
    voiceCount.value = voicesResult.ok ? voicesResult.data.total : 0
  } catch {
    error.value = 'Không kết nối được máy chủ quản trị. Hãy thử lại sau.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <section class="services-overview">
    <AiServicesNav />

    <header class="page-intro">
      <div class="intro-copy">
        <p class="eyebrow">
          Thiết lập AI
        </p>
        <h1>Dịch vụ AI</h1>
        <p class="lede">
          Chọn đúng nơi cần thao tác: model, schema provider hoặc giọng đọc. Các thay đổi ở đây chỉ là cấu hình quản trị; luồng giao tiếp đã kiểm thử vẫn giữ nguyên.
        </p>
      </div>
      <div class="intro-actions">
        <VtButton
          variant="primary"
          @click="openModelConfig()"
        >
          <template #leading>
            <VtIcon
              :icon="SlidersHorizontal"
              :size="14"
            />
          </template>
          Cấu hình model
        </VtButton>
        <VtButton @click="openProviderManagement()">
          <template #leading>
            <VtIcon
              :icon="Boxes"
              :size="14"
            />
          </template>
          Quản lý provider
        </VtButton>
      </div>
    </header>

    <div
      v-if="error"
      class="load-error"
      role="alert"
    >
      <CircleAlert :size="15" />
      <span>{{ error }}</span>
      <VtButton
        size="sm"
        @click="load"
      >
        Thử lại
      </VtButton>
    </div>

    <div
      class="quick-links"
      :aria-busy="loading"
    >
      <button
        type="button"
        class="quick-link"
        @click="openModelConfig()"
      >
        <span class="quick-icon blue"><SlidersHorizontal :size="17" /></span>
        <span class="quick-copy"><strong>Cấu hình model</strong><small>{{ loading ? 'Đang tải…' : `${configs.length} model · ${enabledModelCount} đang bật` }}</small></span>
        <ArrowRight :size="15" />
      </button>
      <button
        type="button"
        class="quick-link"
        @click="openProviderManagement()"
      >
        <span class="quick-icon violet"><Boxes :size="17" /></span>
        <span class="quick-copy"><strong>Quản lý provider</strong><small>{{ loading ? 'Đang tải…' : `${providers.length} schema có thể dùng lại` }}</small></span>
        <ArrowRight :size="15" />
      </button>
      <button
        type="button"
        class="quick-link"
        @click="void router.push('/providers/tts/voices')"
      >
        <span class="quick-icon orange"><Volume2 :size="17" /></span>
        <span class="quick-copy"><strong>Thư viện giọng</strong><small>{{ loading ? 'Đang tải…' : `${voiceCount} giọng đang khả dụng` }}</small></span>
        <ArrowRight :size="15" />
      </button>
    </div>

    <VtCard class="stack-card">
      <header class="section-header">
        <div>
          <h2>Đang dùng cho hội thoại</h2>
          <p>Đây là bốn thành phần đã được chọn và kiểm thử cho luồng nói chuyện hiện tại.</p>
        </div>
        <VtBadge :tone="testedDefaultsReady === CORE_TYPES.length ? 'success' : 'warning'">
          {{ loading ? 'Đang kiểm tra' : `${testedDefaultsReady}/${CORE_TYPES.length} sẵn sàng` }}
        </VtBadge>
      </header>
      <div
        v-if="loading"
        class="state-line"
        role="status"
      >
        Đang tải lựa chọn model…
      </div>
      <div
        v-else
        class="stack-grid"
      >
        <button
          v-for="row in coreRows"
          :key="row.type"
          type="button"
          class="stack-row"
          @click="openModelConfig(row.type)"
        >
          <span class="stack-code">{{ row.type }}</span>
          <span class="stack-copy">
            <strong>{{ row.label }}</strong>
            <small v-if="row.defaultModel">
              {{ localizedModelName(row.defaultModel) }} · {{ localizedProviderName(providerFor(row.defaultModel) ?? { modelType: row.type, providerCode: row.defaultModel.providerCode, name: row.defaultModel.providerCode }) }}
            </small>
            <small v-else>Chưa đặt model mặc định</small>
          </span>
          <span
            v-if="row.defaultModel"
            class="stack-model-code"
            :title="row.defaultModel.modelCode"
          >{{ row.defaultModel.modelCode }}</span>
          <VtBadge
            v-if="row.defaultModel?.isEnabled"
            tone="success"
          >
            Đang bật
          </VtBadge>
          <VtBadge
            v-else
            tone="warning"
          >
            Kiểm tra
          </VtBadge>
          <ArrowRight :size="14" />
        </button>
      </div>
    </VtCard>

    <VtCard class="advanced-card">
      <header class="section-header">
        <div>
          <h2>Danh mục mở rộng</h2>
          <p>Thêm provider hoặc model mới theo cùng schema, không cần sửa code giao tiếp.</p>
        </div>
        <VtButton
          size="sm"
          variant="secondary"
          @click="openProviderManagement()"
        >
          <Plus :size="13" /> Thêm provider
        </VtButton>
      </header>
      <div
        v-if="loading"
        class="state-line"
      >
        Đang tải danh mục…
      </div>
      <div
        v-else-if="advancedRows.length"
        class="advanced-grid"
      >
        <button
          v-for="row in advancedRows"
          :key="row.type"
          type="button"
          class="advanced-row"
          @click="openModelConfig(row.type)"
        >
          <span class="advanced-code">{{ row.type }}</span>
          <span class="advanced-copy"><strong>{{ row.label }}</strong><small>{{ row.providerCount }} provider · {{ row.modelCount }} model</small></span>
          <span class="advanced-default">{{ row.defaultModel ? localizedModelName(row.defaultModel) : 'Chưa có mặc định' }}</span>
          <ArrowRight :size="14" />
        </button>
      </div>
      <p
        v-else
        class="state-line"
      >
        Chưa có danh mục mở rộng.
      </p>
    </VtCard>

    <div class="workflow-note">
      <Layers3 :size="16" />
      <span><strong>Thêm mới theo 3 bước:</strong> tạo schema provider → tạo cấu hình model → đặt mặc định rồi phát hành cấu hình cho trợ lý.</span>
    </div>
  </section>
</template>

<style scoped>
.services-overview { display: grid; gap: 14px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--vt-border); padding: 4px 0 15px; }
.intro-copy { max-width: 700px; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
.page-intro h1 { margin: 0; color: var(--vt-text); font-size: 24px; letter-spacing: -.03em; }
.lede { max-width: 680px; margin: 6px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.55; }
.intro-actions { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.quick-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.quick-link { display: flex; min-width: 0; align-items: center; gap: 9px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); color: var(--vt-text); padding: 12px; text-align: left; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition), transform var(--vt-transition); }
.quick-link:hover { border-color: #b9caff; background: var(--vt-primary-soft); box-shadow: 0 5px 16px rgba(43, 99, 238, .08); transform: translateY(-1px); }
.quick-link:focus-visible, .stack-row:focus-visible, .advanced-row:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.quick-link > svg, .advanced-row > svg, .stack-row > svg { flex: none; color: var(--vt-text-faint); }
.quick-icon { display: inline-grid; width: 31px; height: 31px; flex: none; place-items: center; border-radius: 8px; }.quick-icon.blue { background: #edf3ff; color: #2b63ee; }.quick-icon.violet { background: #f2edff; color: #7558ca; }.quick-icon.orange { background: #fff5e8; color: #b36a1c; }
.quick-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }.quick-copy strong, .quick-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.quick-copy strong { color: var(--vt-text); font-size: 11px; }.quick-copy small { color: var(--vt-text-muted); font-size: 9px; }
.stack-card, .advanced-card { display: grid; gap: 12px; padding: 15px; }
.section-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }.section-header h2 { margin: 0; color: var(--vt-text); font-size: 13px; }.section-header p { margin: 3px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.45; }
.section-header :deep(.vt-button) { display: inline-flex; align-items: center; gap: 5px; flex: none; }
.stack-grid, .advanced-grid { display: grid; gap: 6px; }.stack-row, .advanced-row { display: flex; min-width: 0; align-items: center; gap: 9px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); color: var(--vt-text); padding: 8px 9px; text-align: left; transition: border-color var(--vt-transition), background var(--vt-transition); }.stack-row:hover, .advanced-row:hover { border-color: #b9caff; background: #f8faff; }
.stack-code, .advanced-code { display: inline-grid; width: 38px; height: 25px; flex: none; place-items: center; border-radius: 6px; background: var(--vt-primary-soft); color: var(--vt-primary-text); font-size: 8px; font-weight: 800; }.stack-copy, .advanced-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }.stack-copy strong, .stack-copy small, .advanced-copy strong, .advanced-copy small, .advanced-default { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.stack-copy strong, .advanced-copy strong { color: var(--vt-text-soft); font-size: 10px; }.stack-copy small, .advanced-copy small { color: var(--vt-text-muted); font-size: 9px; }.stack-model-code { max-width: 185px; overflow: hidden; color: var(--vt-primary-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.advanced-default { max-width: 190px; color: var(--vt-primary-text); font-size: 9px; }
.state-line { border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 20px; font-size: 10px; text-align: center; }.load-error { display: flex; align-items: center; gap: 8px; border: 1px solid #efc2c7; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 9px 11px; font-size: 10px; }.load-error span { flex: 1; }.workflow-note { display: flex; align-items: center; gap: 8px; border: 1px solid #dce5ff; border-radius: var(--vt-radius-control); background: #f7f9ff; color: var(--vt-text-muted); padding: 10px 12px; font-size: 10px; }.workflow-note svg { flex: none; color: var(--vt-primary); }.workflow-note strong { color: var(--vt-text-soft); }
@media (max-width: 880px) { .page-intro { align-items: flex-start; flex-direction: column; }.intro-actions { justify-content: flex-start; }.quick-links { grid-template-columns: 1fr; } }
@media (max-width: 620px) {
  .section-header { align-items: flex-start; flex-direction: column; }
  .stack-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: center; }
  .stack-code { grid-row: 1 / span 2; }
  .stack-copy { grid-column: 2; min-width: 0; }
  .stack-model-code { grid-column: 2; max-width: 100%; margin: 0; }
  .stack-row > :deep(.vt-badge) { grid-column: 3; grid-row: 2; margin: 0; }
  .stack-row > svg { grid-column: 3; grid-row: 1; }
  .advanced-row { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; }
  .advanced-code { grid-row: 1 / span 2; }
  .advanced-copy { grid-column: 2; }
  .advanced-default { grid-column: 2 / 4; max-width: 100%; }
  .advanced-row > svg { grid-column: 3; grid-row: 1; }
  .workflow-note { align-items: flex-start; }
}
</style>
