<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, AudioWaveform, BrainCircuit, Database, Lightbulb, Mic, Volume2 } from '@lucide/vue'

import { requireInjection } from '@/app/requireInjection'
import type { ProviderConfigRecord, ProviderInstallationView, ProviderKind } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const loading = ref(true)
const error = ref('')
const installations = ref<ProviderInstallationView[]>([])
const configs = ref<ProviderConfigRecord[]>([])

const kinds: Array<{
  id: ProviderKind
  label: string
  description: string
  icon: typeof AudioWaveform
}> = [
  { id: 'vad', label: 'Lọc tiếng ồn', description: 'Giúp hệ thống biết khi nào bạn đang nói.', icon: AudioWaveform },
  { id: 'asr', label: 'Nhận dạng lời nói', description: 'Đổi giọng nói thành văn bản để AI hiểu.', icon: Mic },
  { id: 'llm', label: 'Bộ não trả lời', description: 'Suy luận, stream và gọi công cụ.', icon: BrainCircuit },
  { id: 'tts', label: 'Giọng nói', description: 'Chọn model và giọng đọc cho Veetee.', icon: Volume2 },
  { id: 'intent', label: 'Hiểu ý định', description: 'Xử lý các thao tác nhanh theo cấu hình.', icon: Lightbulb },
  { id: 'memory', label: 'Ghi nhớ', description: 'Giữ ngữ cảnh theo chính sách của bạn.', icon: Database },
]

const cards = computed(() => kinds.map((kind) => {
  const providerInstallations = installations.value.filter((item) => item.kind === kind.id)
  const providerInstallationIds = new Set(providerInstallations.map((item) => item.id))
  const providerConfigs = configs.value.filter((item) => providerInstallationIds.has(item.installationId))
  return { ...kind, installationCount: providerInstallations.length, configCount: providerConfigs.length, ready: providerInstallations.length > 0 }
}))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [catalog, configured] = await Promise.all([gateway.listProviderInstallations(), gateway.listProviderConfigs()])
    if (!catalog.ok || !configured.ok) {
      error.value = 'Không tải được danh sách dịch vụ. Hãy thử lại sau.'
    } else {
      installations.value = catalog.data
      configs.value = configured.data
    }
  } catch {
    error.value = 'Không kết nối được máy chủ quản trị. Hãy thử lại sau.'
  } finally {
    loading.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <main
    id="main-content"
    class="page-container provider-overview"
    :aria-busy="loading"
  >
    <header class="overview-header">
      <div>
        <p class="eyebrow">
          Dịch vụ AI
        </p>
        <h1>Cấu hình từng phần một</h1>
        <p class="lede">
          Mỗi nhóm có màn hình riêng để bạn dễ chọn provider, lưu nhiều cấu hình và kiểm tra kết nối.
        </p>
      </div>
      <VtBadge tone="primary">
        {{ configs.length }} cấu hình
      </VtBadge>
    </header>

    <VtCard
      v-if="loading"
      class="state-card"
      role="status"
    >
      Đang tải danh sách dịch vụ…
    </VtCard>
    <VtCard
      v-else-if="error"
      class="state-card"
      role="alert"
    >
      <h2>Chưa thể tải dịch vụ</h2>
      <p>{{ error }}</p>
      <VtButton
        variant="secondary"
        @click="load"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <section
      v-else
      class="provider-module-grid"
      aria-label="Các nhóm dịch vụ AI"
    >
      <VtCard
        v-for="card in cards"
        :key="card.id"
        class="provider-module-card"
      >
        <div class="module-icon">
          <VtIcon
            :icon="card.icon"
            :size="20"
          />
        </div>
        <div class="module-copy">
          <div class="module-title-row">
            <h2>{{ card.label }}</h2>
            <VtStatus
              :tone="card.ready ? 'online' : 'neutral'"
              :label="card.ready ? 'Có sẵn' : 'Chưa có'"
            />
          </div>
          <p>{{ card.description }}</p>
          <small>{{ card.installationCount }} loại provider · {{ card.configCount }} cấu hình</small>
        </div>
        <RouterLink
          class="module-link"
          :to="`/providers/${card.id}`"
          :aria-label="`Mở ${card.label}`"
        >
          <span>Quản lý</span>
          <VtIcon
            :icon="ArrowRight"
            :size="15"
          />
        </RouterLink>
        <RouterLink
          v-if="card.id === 'tts'"
          class="voice-link"
          to="/providers/tts/voices"
        >
          Quản lý thư viện giọng nói
        </RouterLink>
      </VtCard>
    </section>
  </main>
</template>

<style scoped>
.provider-overview { display: grid; gap: 16px; }
.overview-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.eyebrow { margin: 0 0 4px; color: var(--vt-primary); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
h1, h2, p { margin: 0; }
h1 { color: var(--vt-text); font-size: 22px; letter-spacing: -.02em; }
.lede { max-width: 620px; margin-top: 6px; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.state-card { display: grid; justify-items: center; gap: 8px; color: var(--vt-text-muted); padding: 30px; text-align: center; }
.state-card h2 { color: var(--vt-text); font-size: 14px; }
.state-card p { font-size: 11px; }
.provider-module-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.provider-module-card { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.module-icon { display: grid; width: 42px; height: 42px; place-items: center; border: 1px solid #cbdcff; border-radius: 12px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.module-copy { min-width: 0; }
.module-title-row { display: flex; align-items: center; gap: 7px; }
.module-title-row h2 { overflow: hidden; color: var(--vt-text); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.module-copy p { margin-top: 4px; color: var(--vt-text-muted); font-size: 10px; line-height: 1.45; }
.module-copy small { display: block; margin-top: 8px; color: var(--vt-text-faint); font-size: 9px; }
.module-link { display: inline-flex; align-items: center; gap: 4px; color: var(--vt-primary); font-size: 10px; font-weight: 650; text-decoration: none; }
.module-link:hover { color: var(--vt-primary-strong, #1d4ed8); text-decoration: underline; }
.module-link:focus-visible, .voice-link:focus-visible { border-radius: 4px; box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.voice-link { grid-column: 2 / -1; color: var(--vt-text-muted); font-size: 10px; text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 700px) { .provider-module-grid { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .overview-header { display: grid; } .provider-module-card { grid-template-columns: auto minmax(0, 1fr); } .module-link { grid-column: 2; } .voice-link { grid-column: 2; } }
</style>
