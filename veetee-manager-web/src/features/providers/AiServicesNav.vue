<script setup lang="ts">
import { Boxes, Mic2, SlidersHorizontal, Volume2 } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { prefetchRoute } from '@/app/router'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const route = useRoute()

const items = [
  { id: 'models', label: 'Cấu hình model', shortLabel: 'Model', to: '/model-config', icon: SlidersHorizontal },
  { id: 'providers', label: 'Quản lý provider', shortLabel: 'Provider', to: '/provider-management', icon: Boxes },
  { id: 'voices', label: 'Thư viện giọng', shortLabel: 'Giọng', to: '/providers/tts/voices', icon: Volume2 },
] as const

const activeId = computed(() => {
  if (route.path === '/provider-management') return 'providers'
  if (route.path.startsWith('/providers/tts/voices')) return 'voices'
  return 'models'
})

function warmRoute(path: string) {
  prefetchRoute(path)
}
</script>

<template>
  <section
    class="services-nav"
    aria-label="Khu vực dịch vụ AI"
  >
    <div class="services-nav-heading">
      <RouterLink
        class="services-nav-title"
        to="/model-config"
      >
        <span class="services-nav-mark"><VtIcon
          :icon="Mic2"
          :size="15"
        /></span>
        <strong>Dịch vụ AI</strong>
      </RouterLink>
      <VtBadge tone="neutral">
        Dùng cho trợ lý
      </VtBadge>
    </div>
    <nav
      class="services-tabs"
      aria-label="Điều hướng dịch vụ AI"
    >
      <RouterLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        class="service-tab"
        :class="{ active: activeId === item.id }"
        :aria-current="activeId === item.id ? 'page' : undefined"
        @pointerenter="warmRoute(item.to)"
        @focus="warmRoute(item.to)"
        @touchstart="warmRoute(item.to)"
      >
        <VtIcon
          :icon="item.icon"
          :size="14"
        />
        <span class="service-tab-copy"><strong class="service-label-long">{{ item.label }}</strong><strong class="service-label-short">{{ item.shortLabel }}</strong></span>
      </RouterLink>
    </nav>
  </section>
</template>

<style scoped>
.services-nav { display: grid; gap: 8px; border-bottom: 1px solid var(--vt-border); padding: 2px 0 9px; }
.services-nav-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.services-nav-title { display: inline-flex; min-width: 0; align-items: center; gap: 8px; color: var(--vt-text); text-decoration: none; }
.services-nav-title:focus-visible { border-radius: var(--vt-radius-control); box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.services-nav-title strong { color: var(--vt-text); font-size: 12px; font-weight: 700; }
.services-nav-mark { display: inline-grid; width: 27px; height: 27px; flex: none; place-items: center; border: 1px solid #cbd9ff; border-radius: 7px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.services-tabs { display: flex; min-width: 0; gap: 3px; overflow-x: auto; scrollbar-width: none; }
.services-tabs::-webkit-scrollbar { display: none; }
.service-tab { display: inline-flex; min-width: max-content; align-items: center; gap: 7px; border: 1px solid transparent; border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 7px 9px; text-decoration: none; transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition); }
.service-tab:hover { border-color: var(--vt-border); background: var(--vt-surface-muted); color: var(--vt-text); }
.service-tab:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.service-tab.active { border-color: #cbd9ff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.service-tab-copy { display: block; min-width: 0; }
.service-tab-copy strong { color: inherit; font-size: 10px; font-weight: 650; white-space: nowrap; }
.service-label-short { display: none; }
@media (max-width: 560px) { .services-nav-heading { align-items: flex-start; flex-direction: column; gap: 6px; }.services-nav-heading :deep(.vt-badge) { display: none; }.services-tabs { justify-content: space-between; overflow-x: visible; }.service-tab { flex: 1; justify-content: center; padding-inline: 5px; }.service-label-long { display: none; }.service-label-short { display: inline; } }
</style>
