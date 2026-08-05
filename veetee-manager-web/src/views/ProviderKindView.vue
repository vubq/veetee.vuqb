<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft } from '@lucide/vue'
import { useRoute } from 'vue-router'

import ProviderRegistryFeature from '@/features/providers/ProviderRegistryFeature.vue'
import type { ProviderKind } from '@/domain'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const route = useRoute()
const knownKinds = new Set<ProviderKind>(['vad', 'asr', 'llm', 'tts', 'intent', 'memory'])
const kind = computed<ProviderKind>(() => {
  const value = String(route.params.kind ?? '') as ProviderKind
  return knownKinds.has(value) ? value : 'vad'
})
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
    <ProviderRegistryFeature
      :initial-kind="kind"
      :show-kind-nav="false"
      :show-voice-catalog="false"
    />
  </div>
</template>

<style scoped>
.provider-kind-page { display: grid; gap: 4px; }
.back-link { display: inline-flex; width: fit-content; align-items: center; gap: 6px; min-height: 34px; justify-self: start; border-radius: var(--vt-radius-button); color: var(--vt-text-muted); padding: 0 8px; font-size: 11px; text-decoration: none; transition: color var(--vt-transition), background var(--vt-transition); }
.back-link:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.back-link:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
</style>
