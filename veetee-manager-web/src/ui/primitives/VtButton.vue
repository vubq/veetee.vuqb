<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

import { Button } from '@/components/ui/button'

const props = withDefaults(
  defineProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    loading?: boolean
    disabled?: boolean
    block?: boolean
  }>(),
  {
    type: 'button',
    variant: 'secondary',
    size: 'md',
  },
)

const variantMap = {
  primary: 'default',
  secondary: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
} as const
</script>

<template>
  <Button
    class="vt-button"
    :class="{ 'w-full': block }"
    :type="props.type"
    :variant="variantMap[props.variant]"
    :size="props.size === 'sm' ? 'sm' : 'default'"
    :disabled="props.disabled || props.loading"
    :aria-busy="props.loading || undefined"
  >
    <LoaderCircle
      v-if="props.loading"
      class="size-4 animate-spin"
      aria-hidden="true"
    />
    <span
      v-if="$slots.leading && !props.loading"
      class="button-icon"
    ><slot name="leading" /></span>
    <span class="button-label"><slot /></span>
    <span
      v-if="$slots.trailing"
      class="button-icon"
    ><slot name="trailing" /></span>
  </Button>
</template>

<style scoped>
.vt-button { min-width: 0; }
.button-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.button-icon { display: inline-grid; place-items: center; flex: none; }
</style>
