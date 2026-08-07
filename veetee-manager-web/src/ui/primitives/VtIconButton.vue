<script setup lang="ts">
import type { Component } from 'vue'

import { Button } from '@/components/ui/button'

import VtIcon from './VtIcon.vue'

const props = withDefaults(
  defineProps<{
    icon: Component
    label: string
    size?: 'sm' | 'md'
    variant?: 'default' | 'soft' | 'danger'
    disabled?: boolean
    pressed?: boolean
  }>(),
  {
    size: 'md',
    variant: 'default',
  },
)

defineEmits<{ click: [event: MouseEvent] }>()
</script>

<template>
  <Button
    :variant="props.variant === 'danger' ? 'destructive' : props.variant === 'soft' ? 'outline' : 'ghost'"
    :size="props.size === 'sm' ? 'icon-sm' : 'icon'"
    :disabled="props.disabled"
    :aria-label="props.label"
    :title="props.label"
    :aria-pressed="props.pressed === undefined ? undefined : props.pressed"
    class="vt-icon-button"
    :class="{ 'is-pressed': props.pressed }"
    @click="$emit('click', $event)"
  >
    <VtIcon
      :icon="props.icon"
      :size="props.size === 'sm' ? 15 : 17"
    />
  </Button>
</template>

<style scoped>
.vt-icon-button { flex: none; }
.vt-icon-button.is-pressed { background: var(--muted); color: var(--foreground); }
</style>
