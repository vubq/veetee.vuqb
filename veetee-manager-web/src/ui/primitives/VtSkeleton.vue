<script setup lang="ts">
withDefaults(defineProps<{ height?: string; width?: string }>(), { height: '16px', width: '100%' })
</script>
<template>
  <span
    class="vt-skeleton"
    :style="{ height, width }"
    aria-hidden="true"
  />
</template>
<style scoped>.vt-skeleton { display: block; max-width: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--vt-surface-muted), #e6ecf2, var(--vt-surface-muted)); background-size: 200% 100%; animation: shimmer 1.5s ease-in-out infinite; } @keyframes shimmer { to { background-position-x: -200%; } }</style>

