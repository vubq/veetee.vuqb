<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from '@lucide/vue'
import { computed } from 'vue'

import VtIcon from './VtIcon.vue'
import { useNotifications, type NoticeTone } from './notifications'

const { notices, politeMessage, assertiveMessage, dismissNotice } = useNotifications()
const icons = computed<Record<NoticeTone, typeof Info>>(() => ({
  success: CheckCircle2,
  info: Info,
  warning: TriangleAlert,
  error: AlertCircle,
}))
</script>

<template>
  <div class="live-regions">
    <p
      class="sr-only"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ politeMessage }}
    </p>
    <p
      class="sr-only"
      aria-live="assertive"
      aria-atomic="true"
    >
      {{ assertiveMessage }}
    </p>
  </div>
  <div
    class="vt-toast-viewport"
  >
    <TransitionGroup name="toast">
      <article
        v-for="notice in notices"
        :key="notice.id"
        class="vt-toast"
        :class="`is-${notice.tone}`"
      >
        <VtIcon
          :icon="icons[notice.tone]"
          :size="18"
        />
        <div class="toast-copy">
          <strong>{{ notice.title }}</strong><p v-if="notice.message">
            {{ notice.message }}
          </p>
        </div>
        <button
          type="button"
          class="toast-close"
          aria-label="Đóng thông báo"
          @click="dismissNotice(notice.id)"
        >
          <VtIcon
            :icon="X"
            :size="15"
          />
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.vt-toast-viewport { position: fixed; z-index: 190; right: 18px; bottom: 18px; display: grid; width: min(360px, calc(100% - 24px)); gap: 8px; pointer-events: none; }
.vt-toast { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface); box-shadow: var(--vt-shadow-dropdown); padding: 12px; pointer-events: auto; }
.vt-toast > :first-child { box-sizing: content-box; flex: none; border-radius: 5px; background: var(--vt-primary-soft); color: var(--vt-primary); padding: 5px; }
.vt-toast.is-success > :first-child { background: var(--vt-success-soft); color: var(--vt-success); }
.vt-toast.is-warning > :first-child { background: var(--vt-warning-soft); color: var(--vt-warning); }
.vt-toast.is-error > :first-child { background: var(--vt-danger-soft); color: var(--vt-danger); }
.toast-copy { min-width: 0; flex: 1; color: var(--vt-text); }
.toast-copy strong { display: block; font-size: 12px; }
.toast-copy p { margin: 3px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.toast-close { display: inline-grid; width: 26px; height: 26px; flex: none; place-items: center; border: 0; border-radius: 4px; background: transparent; color: var(--vt-text-muted); }
.toast-close:hover { background: var(--vt-surface-muted); color: var(--vt-text); }
.toast-close:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.toast-enter-active, .toast-leave-active { transition: opacity var(--vt-transition), transform var(--vt-transition); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(6px); }
@media (max-width: 640px) { .vt-toast-viewport { right: 12px; bottom: 12px; } }
</style>
