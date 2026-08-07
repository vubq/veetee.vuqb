<script setup lang="ts">
import { Card } from '@/components/ui/card'

const props = withDefaults(defineProps<{ interactive?: boolean; padding?: boolean }>(), { padding: true })
</script>

<template>
  <Card
    class="vt-card"
    :class="[
      props.padding ? 'p-4' : 'p-0',
      props.interactive ? 'is-interactive' : undefined,
    ]"
  >
    <slot />
  </Card>
</template>

<style scoped>
.vt-card { border-color: var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); }
.vt-card.is-interactive { transition: border-color var(--vt-transition), box-shadow var(--vt-transition), transform var(--vt-transition); }
.vt-card.is-interactive:hover { border-color: var(--vt-border-hover); box-shadow: var(--vt-shadow-card); transform: translateY(-1px); }
.vt-card.is-interactive:focus-within { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
</style>
