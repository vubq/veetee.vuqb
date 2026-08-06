<script setup lang="ts">
import { Boxes, LayoutDashboard, Mic2, SlidersHorizontal, Volume2 } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const route = useRoute()

const items = [
  { id: 'overview', label: 'Tổng quan', description: 'Nhìn nhanh hệ thống', to: '/ai-services', icon: LayoutDashboard },
  { id: 'models', label: 'Model Configuration', description: 'Model và default', to: '/model-config', icon: SlidersHorizontal },
  { id: 'providers', label: 'Provider Management', description: 'Schema provider', to: '/provider-management', icon: Boxes },
  { id: 'voices', label: 'Thư viện giọng', description: 'Voice của TTS', to: '/providers/tts/voices', icon: Volume2 },
] as const

const activeId = computed(() => {
  if (route.path === '/ai-services') return 'overview'
  if (route.path === '/provider-management') return 'providers'
  if (route.path.startsWith('/providers/tts/voices')) return 'voices'
  return 'models'
})
</script>

<template>
  <section
    class="services-nav"
    aria-label="Khu vực dịch vụ AI"
  >
    <div class="services-nav-heading">
      <div class="services-nav-title">
        <span class="services-nav-mark"><VtIcon
          :icon="Mic2"
          :size="16"
        /></span>
        <div>
          <strong>Dịch vụ AI</strong>
          <p>Quản lý model, provider schema và voice trong một khu vực.</p>
        </div>
      </div>
      <VtBadge tone="success">
        Luồng realtime không đổi
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
      >
        <VtIcon
          :icon="item.icon"
          :size="15"
        />
        <span class="service-tab-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
      </RouterLink>
    </nav>
  </section>
</template>

<style scoped>
.services-nav { display: grid; gap: 12px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); padding: 12px; }
.services-nav-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.services-nav-title { display: flex; min-width: 0; align-items: center; gap: 9px; }
.services-nav-mark { display: inline-grid; width: 32px; height: 32px; flex: none; place-items: center; border: 1px solid #cbd9ff; border-radius: 8px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.services-nav-title strong { color: var(--vt-text); font-size: 13px; font-weight: 700; }
.services-nav-title p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.4; }
.services-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.service-tab { display: flex; min-width: 0; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 8px 9px; text-decoration: none; transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition); }
.service-tab:hover { border-color: var(--vt-border); background: var(--vt-surface-muted); color: var(--vt-text); }
.service-tab:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.service-tab.active { border-color: #cbd9ff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.service-tab-copy { display: grid; min-width: 0; gap: 1px; }
.service-tab-copy strong, .service-tab-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.service-tab-copy strong { color: inherit; font-size: 10px; font-weight: 650; }
.service-tab-copy small { color: var(--vt-text-faint); font-size: 8px; }
@media (max-width: 760px) { .services-nav-heading { align-items: flex-start; flex-direction: column; }.services-tabs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 450px) { .services-tabs { grid-template-columns: 1fr; }.service-tab-copy small { display: none; } }
</style>
