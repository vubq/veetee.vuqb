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
      <span class="page-kicker">Không gian Veetee</span>
      <h1>{{ title }}</h1>
      <p v-if="subtitle">
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
.page-header { display: flex; min-height: 92px; align-items: center; gap: 13px; border-bottom: 1px solid var(--vt-border); padding: 18px 2px 16px; }
.page-icon { display: inline-grid; width: 42px; height: 42px; flex: none; place-items: center; border: 1px solid #cddcff; border-radius: 12px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.page-heading { min-width: 150px; }
.page-kicker { display: block; margin-bottom: 2px; color: var(--vt-primary-text); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.page-heading h1 { margin: 0; color: var(--vt-text); font-size: clamp(20px, 2.6vw, 26px); font-weight: 700; line-height: 1.25; letter-spacing: -0.03em; text-wrap: balance; }
.page-heading p { margin: 4px 0 0; color: var(--vt-text-muted); font-size: 11px; text-wrap: pretty; }
.page-actions { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 8px; margin-left: auto; }
@media (max-width: 700px) {
  .page-header { align-items: flex-start; flex-wrap: wrap; padding-block: 16px 14px; }
  .page-actions { width: 100%; margin-left: 0; padding-top: 4px; }
}
</style>
