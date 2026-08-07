<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'

withDefaults(defineProps<{ height?: string; width?: string }>(), { height: '16px', width: '100%' })
</script>

<template>
  <Skeleton
    class="vt-skeleton"
    :style="{ height, width }"
    aria-hidden="true"
  />
</template>

<style scoped>
.vt-skeleton { max-width: 100%; border-radius: 4px; }
</style>
