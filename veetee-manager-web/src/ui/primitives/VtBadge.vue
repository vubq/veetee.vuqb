<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }>(), { tone: 'neutral' })
</script>

<template>
  <span
    class="vt-badge"
    :class="`is-${tone}`"
  ><slot /></span>
</template>

<style scoped>
.vt-badge { display: inline-flex; min-height: 22px; align-items: center; gap: 5px; border: 1px solid var(--vt-border); border-radius: 5px; background: var(--vt-surface-muted); color: var(--vt-text-muted); padding: 2px 7px; font-size: 10px; font-weight: 600; line-height: 1.3; }
.is-primary { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.is-success { border-color: #c5eadc; background: var(--vt-success-soft); color: var(--vt-success); }
.is-warning { border-color: #f1d8a9; background: var(--vt-warning-soft); color: var(--vt-warning); }
.is-danger { border-color: #f1c4c8; background: var(--vt-danger-soft); color: var(--vt-danger); }
</style>

