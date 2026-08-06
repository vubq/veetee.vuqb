<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, AudioWaveform, BrainCircuit, Database, Lightbulb, Mic, Volume2 } from '@lucide/vue'
import { useRoute } from 'vue-router'

import ProviderManagementFeature from '@/features/providers/ProviderManagementFeature.vue'
import { PROVIDER_KINDS, type ProviderKind } from '@/domain'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const route = useRoute()
const knownKinds = new Set<ProviderKind>(['vad', 'asr', 'llm', 'tts', 'intent', 'memory'])
const kind = computed<ProviderKind>(() => {
  const value = String(route.params.kind ?? '') as ProviderKind
  return knownKinds.has(value) ? value : 'vad'
})
const kindInfo: Record<ProviderKind, { label: string; description: string; icon: typeof AudioWaveform }> = {
  vad: { label: 'Lọc tiếng ồn', description: 'Nhận biết khi bạn đang nói.', icon: AudioWaveform },
  asr: { label: 'Nhận dạng lời nói', description: 'Đổi lời nói thành chữ.', icon: Mic },
  llm: { label: 'Bộ não trả lời', description: 'Sinh câu trả lời và gọi công cụ.', icon: BrainCircuit },
  tts: { label: 'Giọng nói', description: 'Đọc câu trả lời theo thời gian thực.', icon: Volume2 },
  intent: { label: 'Hiểu ý định', description: 'Xử lý yêu cầu thao tác.', icon: Lightbulb },
  memory: { label: 'Ghi nhớ', description: 'Giữ ngữ cảnh theo chính sách.', icon: Database },
}
</script>

<template>
  <div class="provider-kind-page">
    <RouterLink
      class="back-link"
      to="/providers"
    >
      <VtIcon
        :icon="ArrowLeft"
        :size="15"
      />
      <span>Tất cả dịch vụ</span>
    </RouterLink>
    <div class="provider-kind-layout">
      <aside
        class="provider-kind-nav"
        aria-label="Nhóm dịch vụ"
      >
        <p class="nav-caption">
          Nhóm dịch vụ
        </p>
        <RouterLink
          v-for="item in PROVIDER_KINDS"
          :key="item"
          :to="`/providers/${item}`"
          class="kind-nav-item"
          :class="{ active: kind === item }"
          :aria-current="kind === item ? 'page' : undefined"
        >
          <span class="kind-nav-icon"><VtIcon
            :icon="kindInfo[item].icon"
            :size="15"
          /></span>
          <span class="kind-nav-copy"><strong>{{ kindInfo[item].label }}</strong><small>{{ kindInfo[item].description }}</small></span>
        </RouterLink>
      </aside>
      <ProviderManagementFeature :initial-kind="kind" />
    </div>
  </div>
</template>

<style scoped>
.provider-kind-page { display: grid; min-width: 0; gap: 4px; }
.back-link { display: inline-flex; width: fit-content; align-items: center; gap: 6px; min-height: 34px; justify-self: start; border-radius: var(--vt-radius-button); color: var(--vt-text-muted); padding: 0 8px; font-size: 11px; text-decoration: none; transition: color var(--vt-transition), background var(--vt-transition); }
.back-link:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.back-link:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.provider-kind-layout { display: grid; width: 100%; min-width: 0; grid-template-columns: 184px minmax(0, 1fr); align-items: start; gap: 14px; }
.provider-kind-layout > .provider-management { width: 100%; min-width: 0; overflow: hidden; }
.provider-kind-nav { position: sticky; top: 12px; display: grid; gap: 4px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); padding: 8px; }
.nav-caption { margin: 3px 8px 6px; color: var(--vt-text-faint); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.kind-nav-item { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 8px; text-decoration: none; transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition); }
.kind-nav-item:hover { border-color: var(--vt-border); background: var(--vt-surface-muted); color: var(--vt-text); }
.kind-nav-item.active { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.kind-nav-item:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.kind-nav-icon { display: grid; width: 27px; height: 27px; flex: none; place-items: center; border-radius: 7px; background: var(--vt-surface-subtle); color: var(--vt-primary); }
.kind-nav-item.active .kind-nav-icon { background: white; }
.kind-nav-copy { display: grid; min-width: 0; gap: 2px; }
.kind-nav-copy strong, .kind-nav-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kind-nav-copy strong { color: inherit; font-size: 10px; font-weight: 650; }
.kind-nav-copy small { color: var(--vt-text-faint); font-size: 8px; }
@media (max-width: 920px) { .provider-kind-layout { grid-template-columns: 1fr; }.provider-kind-nav { position: static; grid-template-columns: repeat(3, minmax(0, 1fr)); }.nav-caption { grid-column: 1 / -1; }.kind-nav-item { min-width: 0; } }
@media (max-width: 560px) { .provider-kind-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
