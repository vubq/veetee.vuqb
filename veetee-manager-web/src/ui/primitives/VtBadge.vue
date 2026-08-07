<script setup lang="ts">
import { Badge } from '@/components/ui/badge'

const props = withDefaults(defineProps<{ tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }>(), { tone: 'neutral' })

const variantMap = {
  neutral: 'secondary',
  primary: 'default',
  success: 'outline',
  warning: 'outline',
  danger: 'destructive',
} as const
</script>

<template>
  <Badge
    class="vt-badge"
    :class="`is-${props.tone}`"
    :variant="variantMap[props.tone]"
  >
    <slot />
  </Badge>
</template>

<style scoped>
.vt-badge { min-height: 22px; padding: 2px 7px; font-size: 10px; font-weight: 600; line-height: 1.3; }
.vt-badge.is-primary { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.vt-badge.is-success { border-color: #c5eadc; background: var(--vt-success-soft); color: var(--vt-success); }
.vt-badge.is-warning { border-color: #f1d8a9; background: var(--vt-warning-soft); color: var(--vt-warning); }
.vt-badge.is-danger { border-color: #f1c4c8; background: var(--vt-danger-soft); color: var(--vt-danger); }
</style>
