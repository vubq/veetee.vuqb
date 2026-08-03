<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    size?: number
    strokeWidth?: number
    decorative?: boolean
  }>(),
  {
    size: 17,
    strokeWidth: 1.8,
    decorative: true,
  },
)
</script>

<template>
  <component
    :is="icon"
    class="vt-icon"
    :size="size"
    :stroke-width="strokeWidth"
    :aria-hidden="decorative ? 'true' : undefined"
  />
</template>

<style scoped>
.vt-icon {
  display: block;
  flex: none;
}
</style>

