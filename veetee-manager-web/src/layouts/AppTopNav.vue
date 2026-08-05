<script setup lang="ts">
import { Bot, Component, LayoutGrid, LogOut, Menu, Puzzle, RotateCcw } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { authSession } from '@/auth/auth-session'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'
import VtMenu, { type VtMenuItem } from '@/ui/primitives/VtMenu.vue'

const router = useRouter()
const { t } = useI18n()
const isApiMode = Boolean(import.meta.env.VITE_MANAGER_API_URL)
const logoutLoading = ref(false)
const isAuthenticated = computed(() => authSession.status.value === 'authenticated')
const mobileItems = computed<VtMenuItem[]>(() => [
  { id: 'assistants', label: 'Trợ lý' },
  ...(!isApiMode ? [{ id: 'components', label: 'Thư viện giao diện' }] : []),
  ...(!isApiMode ? [{ id: 'reset-hint', label: 'Đặt lại dữ liệu ở thanh công cụ', disabled: true, separatorBefore: true }] : []),
])

function navigate(id: string) {
  if (id === 'assistants') void router.push('/assistants')
  if (id === 'components') void router.push('/_preview/components')
}

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
        <span class="brand-mark"><VtIcon
          :icon="Bot"
          :size="19"
          :stroke-width="2"
        /></span>
        <span class="brand-copy"><strong>Veetee</strong><small>Manager</small></span>
      </RouterLink>

      <nav
        class="global-nav"
        aria-label="Điều hướng chính"
      >
        <RouterLink
          class="nav-link"
          to="/assistants"
        >
          <VtIcon
            :icon="LayoutGrid"
            :size="16"
          />
          <span>Trợ lý</span>
        </RouterLink>
        <RouterLink
          class="nav-link"
          to="/providers"
        >
          <VtIcon
            :icon="Puzzle"
            :size="16"
          />
          <span>Dịch vụ AI</span>
        </RouterLink>
        <RouterLink
          v-if="$router.hasRoute('component-preview')"
          class="nav-link"
          to="/_preview/components"
        >
          <VtIcon
            :icon="Component"
            :size="16"
          />
          <span>Thư viện giao diện</span>
        </RouterLink>
      </nav>

      <div class="top-meta">
        <VtBadge tone="primary">
          {{ isApiMode ? 'Manager API' : 'UI preview' }}
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
        >
          <VtIcon
            :icon="RotateCcw"
            :size="13"
          /> Dữ liệu mẫu
        </span>
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
.app-top-nav { position: sticky; z-index: 80; top: 0; height: 58px; border-bottom: 1px solid var(--vt-border); background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(8px); }
.top-nav-inner { display: flex; width: min(var(--vt-content), calc(100% - 40px)); height: 100%; align-items: center; gap: 26px; margin-inline: auto; }
.brand { display: inline-flex; align-items: center; gap: 9px; color: var(--vt-text); text-decoration: none; }
.brand:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); }
.brand-mark { display: inline-grid; width: 30px; height: 30px; place-items: center; border: 1px solid #bfd2ff; border-radius: 8px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.brand-copy { display: flex; align-items: baseline; gap: 5px; }
.brand-copy strong { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.brand-copy small { color: var(--vt-text-muted); font-size: 10px; font-weight: 500; }
.global-nav { display: flex; height: 100%; align-items: center; gap: 3px; }
.nav-link { display: inline-flex; height: 34px; align-items: center; gap: 7px; border-radius: var(--vt-radius-button); color: var(--vt-text-muted); padding: 0 10px; font-size: 11px; font-weight: 500; text-decoration: none; transition: background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition); }
.nav-link:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.nav-link.router-link-active { background: #e9eef3; color: var(--vt-text); font-weight: 600; }
.nav-link:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.top-meta { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.account-label { max-width: 170px; overflow: hidden; color: var(--vt-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.mock-marker { display: inline-flex; align-items: center; gap: 5px; color: var(--vt-text-faint); font-size: 10px; }
.mobile-menu { display: none; }
@media (max-width: 760px) {
  .top-nav-inner { width: calc(100% - 24px); gap: 10px; }
  .global-nav { margin-left: auto; }
  .global-nav .nav-link span { display: none; }
  .top-meta { display: none; }
}
@media (max-width: 460px) {
  .global-nav { display: none; }
  .mobile-menu { display: contents; }
  .brand-copy small { display: none; }
  .top-nav-inner { justify-content: space-between; }
}
</style>
