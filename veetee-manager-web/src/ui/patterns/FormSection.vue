<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <section class="form-section">
    <header class="section-header">
      <div>
        <h2>{{ title }}</h2><p v-if="description">
          {{ description }}
        </p>
      </div>
      <div
        v-if="$slots.trailing"
        class="section-trailing"
      >
        <slot name="trailing" />
      </div>
    </header>
    <div class="section-body">
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="section-footer"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.form-section { overflow: visible; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); }
.section-header { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--vt-border); padding: 11px 14px; }
.section-header h2 { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.45; }
.section-header p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.section-trailing { flex: none; }
.section-body { padding: 14px; }
.section-footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vt-border); background: var(--vt-surface-subtle); padding: 11px 14px; }
</style>

