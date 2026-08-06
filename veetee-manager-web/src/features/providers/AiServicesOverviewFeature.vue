<script setup lang="ts">
import { ArrowRight, Boxes, CheckCircle2, CircleAlert, Plus, SlidersHorizontal, Volume2 } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { ModelConfigRecord, ModelProviderRecord } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

import AiServicesNav from './AiServicesNav.vue'
import { MODEL_TYPE_LABELS, MODEL_TYPE_ORDER } from './model-registry-labels'

const router = useRouter()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const providers = ref<ModelProviderRecord[]>([])
const configs = ref<ModelConfigRecord[]>([])
const voiceCount = ref(0)
const loading = ref(true)
const error = ref('')

const defaults = computed(() => configs.value.filter((item) => item.isDefault))
const enabledConfigs = computed(() => configs.value.filter((item) => item.isEnabled))
const defaultByType = computed(() => new Map(defaults.value.map((item) => [item.modelType, item])))
const typeRows = computed(() => MODEL_TYPE_ORDER.map((type) => ({
  type,
  label: MODEL_TYPE_LABELS[type],
  providerCount: providers.value.filter((provider) => provider.modelType === type).length,
  modelCount: configs.value.filter((config) => config.modelType === type).length,
  defaultModel: defaultByType.value.get(type),
})).filter((row) => row.providerCount > 0 || row.modelCount > 0))

async function load() {
  loading.value = true
  error.value = ''
  const providerResult = await gateway.listModelProviders()
  const results = await Promise.all(MODEL_TYPE_ORDER.map((modelType) => gateway.listModelConfigs({ modelType, page: 1, limit: 100 })))
  const voicesResult = await gateway.listVoices('vi-VN')
  const modelResult = results.find((result) => !result.ok)
  if (!providerResult.ok || modelResult && !modelResult.ok) {
    error.value = 'Không tải được catalog dịch vụ. Bạn vẫn có thể mở từng mục để thử lại.'
    loading.value = false
    return
  }
  providers.value = providerResult.data
  configs.value = results.flatMap((result) => result.ok ? result.data.items : [])
  voiceCount.value = voicesResult.ok ? voicesResult.data.total : 0
  loading.value = false
}

function go(path: string) {
  void router.push(path)
}

onMounted(() => { void load() })
</script>

<template>
  <section class="services-overview">
    <AiServicesNav />
    <VtCard class="overview-hero">
      <div class="hero-copy">
        <VtBadge tone="primary">
          Control plane
        </VtBadge>
        <h1>Dịch vụ AI</h1>
        <p>Quản lý provider schema và model config theo từng capability. Thay đổi ở đây chỉ tác động đến cấu hình được publish; không làm thay đổi wire protocol hay pipeline hội thoại đang chạy.</p>
        <div class="hero-actions">
          <VtButton
            variant="primary"
            @click="go('/model-config')"
          >
            <template #leading>
              <VtIcon
                :icon="SlidersHorizontal"
                :size="14"
              />
            </template>
            Mở Model Configuration
          </VtButton>
          <VtButton @click="go('/provider-management')">
            <template #leading>
              <VtIcon
                :icon="Boxes"
                :size="14"
              />
            </template>
            Quản lý provider schema
          </VtButton>
        </div>
      </div>
      <div
        class="hero-illustration"
        aria-hidden="true"
      >
        <div class="illustration-ring ring-one" />
        <div class="illustration-ring ring-two" />
        <div class="illustration-core">
          <VtIcon
            :icon="SlidersHorizontal"
            :size="28"
          />
        </div>
      </div>
    </VtCard>

    <div
      v-if="error"
      class="load-error"
      role="alert"
    >
      <CircleAlert :size="15" />{{ error }}
      <VtButton
        size="sm"
        @click="load"
      >
        Thử lại
      </VtButton>
    </div>

    <div
      class="summary-grid"
      :aria-busy="loading"
    >
      <VtCard class="summary-card">
        <span class="summary-icon blue"><Boxes :size="16" /></span><div><strong>{{ loading ? '—' : providers.length }}</strong><span>Provider schema</span></div><small>Có thể dùng lại cho nhiều model</small>
      </VtCard>
      <VtCard class="summary-card">
        <span class="summary-icon violet"><SlidersHorizontal :size="16" /></span><div><strong>{{ loading ? '—' : configs.length }}</strong><span>Model config</span></div><small>{{ enabledConfigs.length }} model đang bật</small>
      </VtCard>
      <VtCard class="summary-card">
        <span class="summary-icon green"><CheckCircle2 :size="16" /></span><div><strong>{{ loading ? '—' : defaults.length }}</strong><span>Default đang chọn</span></div><small>Mỗi capability có một lựa chọn</small>
      </VtCard>
      <VtCard class="summary-card">
        <span class="summary-icon orange"><Volume2 :size="16" /></span><div><strong>{{ loading ? '—' : voiceCount }}</strong><span>Voice khả dụng</span></div><small>Quản lý trong thư viện giọng</small>
      </VtCard>
    </div>

    <div class="overview-columns">
      <VtCard class="defaults-card">
        <header class="section-header">
          <div><h2>Stack mặc định</h2><p>Những lựa chọn được dùng khi tạo/publish cấu hình.</p></div><VtButton
            size="sm"
            variant="ghost"
            @click="go('/model-config')"
          >
            Xem tất cả <ArrowRight :size="13" />
          </VtButton>
        </header>
        <div
          v-if="loading"
          class="overview-state"
        >
          Đang tải catalog…
        </div>
        <div
          v-else
          class="default-list"
        >
          <div
            v-for="row in typeRows.filter((item) => item.defaultModel)"
            :key="row.type"
            class="default-row"
          >
            <span class="type-dot">{{ row.type.slice(0, 2) }}</span>
            <div class="default-copy">
              <strong>{{ row.label }}</strong><span>{{ row.defaultModel?.modelName }}</span>
            </div>
            <code>{{ row.defaultModel?.modelCode }}</code>
          </div>
          <div
            v-if="!defaults.length"
            class="overview-state"
          >
            Chưa có model mặc định.
          </div>
        </div>
      </VtCard>
      <VtCard class="workflow-card">
        <header class="section-header">
          <div><h2>Quản lý theo 3 bước</h2><p>Không cần sửa code khi thêm provider/model mới.</p></div>
        </header>
        <ol class="workflow-list">
          <li><span>1</span><div><strong>Khai báo provider schema</strong><small>Định nghĩa field, type, default và secret metadata.</small></div></li>
          <li><span>2</span><div><strong>Tạo model config</strong><small>Chọn provider rồi nhập thông số theo schema tự sinh.</small></div></li>
          <li><span>3</span><div><strong>Đặt default và publish</strong><small>Runtime chỉ nhận snapshot hợp lệ ở boundary hiện có.</small></div></li>
        </ol>
        <VtButton
          variant="secondary"
          size="sm"
          @click="go('/provider-management')"
        >
          <Plus :size="13" /> Thêm provider schema
        </VtButton>
      </VtCard>
    </div>

    <VtCard class="capability-card">
      <header class="section-header">
        <div><h2>Catalog theo capability</h2><p>Chọn một danh mục để xem model và thao tác quản lý chi tiết.</p></div>
      </header>
      <div class="capability-grid">
        <button
          v-for="row in typeRows"
          :key="row.type"
          type="button"
          class="capability-row"
          @click="go(`/model-config?type=${row.type}`)"
        >
          <span class="capability-code">{{ row.type }}</span>
          <span class="capability-copy"><strong>{{ row.label }}</strong><small>{{ row.providerCount }} provider · {{ row.modelCount }} model</small></span>
          <VtBadge
            v-if="row.defaultModel"
            tone="success"
          >
            {{ row.defaultModel.modelCode }}
          </VtBadge><VtBadge
            v-else
            tone="neutral"
          >
            Chưa có default
          </VtBadge>
          <ArrowRight :size="14" />
        </button>
      </div>
    </VtCard>
  </section>
</template>

<style scoped>
.services-overview { display: grid; gap: 14px; }
.overview-hero { display: flex; min-height: 190px; align-items: center; justify-content: space-between; gap: 24px; overflow: hidden; padding: 22px 25px; }
.hero-copy { max-width: 690px; }
.hero-copy h1 { margin: 9px 0 4px; color: var(--vt-text); font-size: 25px; letter-spacing: -.03em; }
.hero-copy p { max-width: 650px; margin: 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.65; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 17px; }
.hero-illustration { position: relative; width: 170px; height: 150px; flex: none; }
.illustration-ring { position: absolute; border: 1px solid #cad8ff; border-radius: 50%; background: rgba(237, 243, 255, .38); }
.ring-one { inset: 8px 0 0 24px; transform: rotate(18deg); }
.ring-two { inset: 0 25px 14px 0; transform: rotate(-22deg); }
.illustration-core { position: absolute; inset: 45px; display: grid; place-items: center; border: 1px solid #a9c0ff; border-radius: 14px; background: var(--vt-primary); color: white; box-shadow: 0 10px 24px rgba(43, 99, 238, .23); }
.load-error { display: flex; align-items: center; gap: 8px; border: 1px solid #efc2c7; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 9px 11px; font-size: 10px; }
.load-error .vt-button { margin-left: auto; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary-card { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 9px; row-gap: 2px; padding: 13px; }
.summary-icon { display: inline-grid; width: 31px; height: 31px; place-items: center; border-radius: 8px; }.summary-icon.blue { background: #edf3ff; color: #2b63ee; }.summary-icon.violet { background: #f2edff; color: #7558ca; }.summary-icon.green { background: #e8f7f1; color: #147a5a; }.summary-icon.orange { background: #fff5e8; color: #b36a1c; }
.summary-card > div { display: grid; min-width: 0; gap: 1px; }.summary-card strong { color: var(--vt-text); font-size: 19px; line-height: 1.1; }.summary-card span:not(.summary-icon) { color: var(--vt-text-soft); font-size: 10px; font-weight: 650; }.summary-card small { grid-column: 1 / -1; color: var(--vt-text-faint); font-size: 9px; }
.overview-columns { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(330px, .9fr); gap: 12px; }.defaults-card, .workflow-card, .capability-card { display: grid; gap: 12px; padding: 15px; }
.section-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }.section-header h2 { margin: 0; color: var(--vt-text); font-size: 13px; }.section-header p { margin: 3px 0 0; color: var(--vt-text-muted); font-size: 10px; }.section-header .vt-button { display: inline-flex; align-items: center; gap: 4px; }
.default-list { display: grid; gap: 6px; }.default-row { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 8px 9px; }.type-dot { display: inline-grid; width: 30px; height: 24px; flex: none; place-items: center; border-radius: 6px; background: var(--vt-primary-soft); color: var(--vt-primary-text); font-size: 8px; font-weight: 800; }.default-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }.default-copy strong, .default-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.default-copy strong { color: var(--vt-text-soft); font-size: 10px; }.default-copy span { color: var(--vt-text-muted); font-size: 9px; }.default-row code { max-width: 180px; overflow: hidden; color: var(--vt-primary-text); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.workflow-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }.workflow-list li { display: flex; align-items: flex-start; gap: 8px; }.workflow-list li > span { display: inline-grid; width: 22px; height: 22px; flex: none; place-items: center; border-radius: 50%; background: var(--vt-primary-soft); color: var(--vt-primary-text); font-size: 10px; font-weight: 700; }.workflow-list div { display: grid; gap: 2px; }.workflow-list strong { color: var(--vt-text-soft); font-size: 10px; }.workflow-list small { color: var(--vt-text-muted); font-size: 9px; line-height: 1.4; }.workflow-card > .vt-button { justify-self: start; display: inline-flex; align-items: center; gap: 5px; }
.capability-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }.capability-row { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); color: var(--vt-text-soft); padding: 9px; text-align: left; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition); }.capability-row:hover { border-color: #b8caff; background: var(--vt-primary-soft); box-shadow: 0 2px 8px rgba(43, 99, 238, .08); }.capability-row:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }.capability-code { display: inline-grid; width: 39px; height: 25px; flex: none; place-items: center; border-radius: 5px; background: var(--vt-surface-muted); color: var(--vt-primary-text); font-size: 9px; font-weight: 800; }.capability-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }.capability-copy strong, .capability-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.capability-copy strong { color: var(--vt-text); font-size: 10px; }.capability-copy small { color: var(--vt-text-muted); font-size: 8px; }.capability-row > .vt-badge { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.capability-row > svg { flex: none; color: var(--vt-text-faint); }
.overview-state { color: var(--vt-text-muted); padding: 19px; font-size: 10px; text-align: center; }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.overview-columns { grid-template-columns: 1fr; } }
@media (max-width: 650px) { .overview-hero { align-items: flex-start; padding: 17px; }.hero-illustration { display: none; }.capability-grid { grid-template-columns: 1fr; } }
@media (max-width: 430px) { .summary-grid { grid-template-columns: 1fr; }.summary-card { grid-template-columns: auto minmax(0, 1fr); } }
</style>
