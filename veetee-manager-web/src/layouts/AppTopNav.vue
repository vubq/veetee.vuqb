<script setup lang="ts">
import { Component, LayoutGrid, LogOut, Menu, RotateCcw, Sparkles } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { prefetchRoute } from '@/app/router'
import { authSession } from '@/auth/auth-session'
import VtBrandMark from '@/components/brand/VtBrandMark.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'
import VtMenu, { type VtMenuItem } from '@/ui/primitives/VtMenu.vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const isApiMode = Boolean(import.meta.env.VITE_MANAGER_API_URL)
const logoutLoading = ref(false)
const isAuthenticated = computed(() => authSession.status.value === 'authenticated')
const aiServicesActive = computed(() => ['/ai-services', '/model-config', '/provider-management'].includes(route.path) || route.path.startsWith('/providers/'))
const mobileItems = computed<VtMenuItem[]>(() => [
  { id: 'assistants', label: 'Trợ lý' },
  { id: 'ai-services', label: 'Dịch vụ AI' },
  ...(!isApiMode ? [{ id: 'components', label: 'Thư viện giao diện' }] : []),
])

function warmRoute(path: string) {
  prefetchRoute(path)
}

function navigate(id: string) {
  if (id === 'assistants') void router.push('/assistants')
  if (id === 'ai-services') void router.push('/model-config')
  if (id === 'components') void router.push('/_preview/components')
}

onMounted(() => {
  const warm = () => warmRoute('/model-config')
  if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 2_500 })
  else globalThis.setTimeout(warm, 1_500)
})

async function logout() {
  logoutLoading.value = true
  const ok = await authSession.logout()
  logoutLoading.value = false
  if (ok) await router.replace({ name: 'login' })
}
</script>

<template>
  <header class="app-top-nav">
    <div class="top-nav-inner">
      <RouterLink
        class="brand"
        to="/assistants"
        aria-label="Veetee — trang Trợ lý"
      >
        <VtBrandMark size="sm" />
        <span class="brand-copy">
          <strong>Veetee</strong>
          <small>Không gian quản trị</small>
        </span>
      </RouterLink>

      <nav
        class="global-nav"
        aria-label="Điều hướng chính"
      >
        <RouterLink
          class="nav-link"
          to="/assistants"
          :aria-current="route.path.startsWith('/assistants') ? 'page' : undefined"
          @pointerenter="warmRoute('/assistants')"
          @focus="warmRoute('/assistants')"
          @touchstart="warmRoute('/assistants')"
        >
          <VtIcon
            :icon="LayoutGrid"
            :size="16"
          />
          <span>Trợ lý</span>
        </RouterLink>
        <RouterLink
          class="nav-link"
          to="/model-config"
          :class="{ 'is-active': aiServicesActive }"
          :aria-current="aiServicesActive ? 'page' : undefined"
          @pointerenter="warmRoute('/model-config')"
          @focus="warmRoute('/model-config')"
          @touchstart="warmRoute('/model-config')"
        >
          <VtIcon
            :icon="Sparkles"
            :size="16"
          />
          <span>Dịch vụ AI</span>
        </RouterLink>
        <RouterLink
          v-if="$router.hasRoute('component-preview')"
          class="nav-link"
          to="/_preview/components"
          :aria-current="route.name === 'component-preview' ? 'page' : undefined"
        >
          <VtIcon
            :icon="Component"
            :size="16"
          />
          <span>Thư viện giao diện</span>
        </RouterLink>
      </nav>

      <div class="top-meta">
        <VtBadge
          :tone="isApiMode ? 'success' : 'neutral'"
          class="connection-badge"
        >
          <span
            class="status-dot"
            aria-hidden="true"
          />
          {{ isApiMode ? 'Đã kết nối' : 'Bản xem trước' }}
        </VtBadge>
        <span
          v-if="isApiMode && isAuthenticated && authSession.user.value?.email"
          class="account-label"
          :title="authSession.user.value.email"
        >{{ authSession.user.value.email }}</span>
        <VtButton
          v-if="isApiMode && isAuthenticated"
          variant="ghost"
          size="sm"
          :loading="logoutLoading"
          @click="logout"
        >
          <template #leading>
            <VtIcon
              :icon="LogOut"
              :size="14"
            />
          </template>
          {{ t('auth.logout') }}
        </VtButton>
        <span
          v-else
          class="mock-marker"
        ><VtIcon
          :icon="RotateCcw"
          :size="13"
        /> Dữ liệu mẫu</span>
      </div>

      <div class="mobile-menu">
        <VtMenu
          :items="mobileItems"
          label="Mở điều hướng"
          @select="navigate"
        >
          <VtIconButton
            :icon="Menu"
            label="Mở điều hướng"
            variant="soft"
          />
        </VtMenu>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-top-nav { position: sticky; z-index: 40; top: 0; border-bottom: 1px solid var(--vt-border); background: color-mix(in srgb, var(--vt-surface) 94%, transparent); backdrop-filter: blur(14px); }
.top-nav-inner { display: flex; width: min(var(--vt-content), calc(100% - 40px)); min-height: 64px; align-items: center; gap: 28px; margin-inline: auto; }
.brand { display: inline-flex; min-width: 0; align-items: center; gap: 10px; color: var(--vt-text); text-decoration: none; }
.brand:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.brand-copy { display: grid; min-width: 0; gap: 1px; }
.brand-copy strong { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.brand-copy small { overflow: hidden; color: var(--vt-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.global-nav { display: flex; height: 100%; align-items: center; gap: 4px; }
.nav-link { position: relative; display: inline-flex; min-height: 36px; align-items: center; gap: 8px; border-radius: 8px; color: var(--vt-text-muted); padding: 0 12px; font-size: 12px; font-weight: 500; text-decoration: none; transition: background var(--vt-transition), color var(--vt-transition); }
.nav-link:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.nav-link.router-link-active, .nav-link.is-active { background: var(--vt-primary-soft); color: var(--vt-primary-text); font-weight: 650; }
.nav-link.router-link-active::after, .nav-link.is-active::after { position: absolute; right: 12px; bottom: -14px; left: 12px; height: 2px; border-radius: 999px; background: var(--vt-primary); content: ''; }
.nav-link:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.top-meta { display: flex; min-width: 0; align-items: center; gap: 10px; margin-left: auto; }
.connection-badge { gap: 6px; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.account-label { max-width: 170px; overflow: hidden; color: var(--vt-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.mock-marker { display: inline-flex; align-items: center; gap: 5px; color: var(--vt-text-faint); font-size: 10px; }
.mobile-menu { display: none; }
@media (max-width: 900px) {
  .top-nav-inner { gap: 14px; }
  .brand-copy small { display: none; }
  .top-meta { gap: 6px; }
  .account-label, .mock-marker { display: none; }
}
@media (max-width: 680px) {
  .top-nav-inner { width: calc(100% - 24px); min-height: 58px; gap: 8px; }
  .global-nav { margin-left: auto; }
  .global-nav .nav-link { min-width: 36px; justify-content: center; padding-inline: 9px; }
  .global-nav .nav-link span { display: none; }
  .nav-link.router-link-active::after, .nav-link.is-active::after { right: 8px; bottom: -11px; left: 8px; }
  .top-meta { display: none; }
  .mobile-menu { display: block; }
}
@media (max-width: 420px) { .global-nav { display: none; } .mobile-menu { margin-left: auto; } }
</style>
