<script setup lang="ts">
withDefaults(defineProps<{ interactive?: boolean; padding?: boolean }>(), { padding: true })
</script>

<template>
  <div
    class="vt-card"
    :class="{ 'is-interactive': interactive, 'has-padding': padding }"
  >
    <slot />
  </div>
</template>

<style scoped>
.vt-card { border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); }
.vt-card.has-padding { padding: 16px; }
.vt-card.is-interactive { transition: border-color var(--vt-transition), box-shadow var(--vt-transition), transform var(--vt-transition); }
.vt-card.is-interactive:hover { border-color: var(--vt-border-hover); box-shadow: var(--vt-shadow-card); transform: translateY(-1px); }
.vt-card.is-interactive:focus-within { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
</style>

