<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ icon: Component; title: string; description: string }>()
</script>
<template>
  <div class="vt-empty">
    <span class="empty-icon"><component
      :is="icon"
      :size="22"
      :stroke-width="1.7"
    /></span><strong>{{ title }}</strong><p>{{ description }}</p><div
      v-if="$slots.default"
      class="empty-action"
    >
      <slot />
    </div>
  </div>
</template>
<style scoped>.vt-empty { display: grid; min-height: 230px; place-items: center; align-content: center; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-section); background: var(--vt-surface-subtle); padding: 28px; text-align: center; }.empty-icon { display: inline-grid; width: 42px; height: 42px; place-items: center; border-radius: 8px; background: var(--vt-primary-soft); color: var(--vt-primary); }.vt-empty strong { margin-top: 11px; font-size: 13px; }.vt-empty p { max-width: 390px; margin: 4px 0 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.55; }.empty-action { margin-top: 14px; }</style>

