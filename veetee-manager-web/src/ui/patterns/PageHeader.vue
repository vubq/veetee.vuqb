<script setup lang="ts">
import type { Component } from 'vue'

import VtIcon from '@/ui/primitives/VtIcon.vue'

defineProps<{ title: string; subtitle?: string; icon: Component }>()
</script>

<template>
  <section class="page-header">
    <span class="page-icon"><VtIcon
      :icon="icon"
      :size="19"
    /></span>
    <div class="page-heading">
      <h1>{{ title }}</h1><p v-if="subtitle">
        {{ subtitle }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="page-actions"
    >
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.page-header { display: flex; min-height: 76px; align-items: center; gap: 11px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); padding: 14px 15px; }
.page-icon { display: inline-grid; width: 36px; height: 36px; flex: none; place-items: center; border-radius: 7px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.page-heading { min-width: 150px; }
.page-heading h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.4; letter-spacing: -0.015em; }
.page-heading p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.page-actions { display: flex; min-width: 0; align-items: center; gap: 8px; margin-left: auto; }
@media (max-width: 700px) {
  .page-header { align-items: flex-start; flex-wrap: wrap; }
  .page-actions { width: 100%; margin-left: 0; padding-top: 2px; }
}
</style>

