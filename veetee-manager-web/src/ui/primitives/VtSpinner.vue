<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import VtIcon from './VtIcon.vue'
withDefaults(defineProps<{ label?: string; size?: number }>(), { label: 'Đang tải', size: 20 })
</script>
<template>
  <span
    class="vt-spinner"
    role="status"
  ><VtIcon
    :icon="LoaderCircle"
    :size="size"
  /><span class="sr-only">{{ label }}</span></span>
</template>
<style scoped>.vt-spinner { display: inline-grid; place-items: center; color: var(--vt-primary); animation: spin .8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }</style>

