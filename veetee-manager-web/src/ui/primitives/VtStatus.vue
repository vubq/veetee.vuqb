<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'neutral' | 'online' | 'warning' | 'error'; label: string }>(), { tone: 'neutral' })
</script>

<template>
  <span
    class="vt-status"
    :class="`is-${tone}`"
  ><span
    class="status-dot"
    aria-hidden="true"
  />{{ label }}</span>
</template>

<style scoped>
.vt-status { display: inline-flex; align-items: center; gap: 6px; color: var(--vt-text-muted); font-size: 10px; font-weight: 500; }
.status-dot { width: 7px; height: 7px; border: 2px solid currentColor; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 2px var(--vt-surface); }
.is-online { color: var(--vt-success); }
.is-warning { color: var(--vt-warning); }
.is-error { color: var(--vt-danger); }
</style>

