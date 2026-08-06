<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft } from '@lucide/vue'

import { requireInjection } from '@/app/requireInjection'
import type { ProviderConfigRecord } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import VoiceCatalogPanel from '@/features/providers/VoiceCatalogPanel.vue'
import AiServicesNav from '@/features/providers/AiServicesNav.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const configs = ref<ProviderConfigRecord[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await gateway.listProviderConfigs('tts')
    if (result.ok) configs.value = result.data
    else error.value = 'Không tải được cấu hình giọng nói. Hãy thử lại sau.'
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
          Chọn giọng có sẵn hoặc thêm một voice profile riêng cho từng cấu hình TTS.
        </p>
      </div>
    </header>
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
</style>
