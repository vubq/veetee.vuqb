<script setup lang="ts">
import type { Component } from 'vue'

import VtIcon from './VtIcon.vue'

withDefaults(
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
  <button
    type="button"
    class="vt-icon-button"
    :class="[`is-${size}`, `is-${variant}`, { 'is-pressed': pressed }]"
    :aria-label="label"
    :title="label"
    :aria-pressed="pressed === undefined ? undefined : pressed"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <VtIcon
      :icon="icon"
      :size="size === 'sm' ? 15 : 17"
    />
  </button>
</template>

<style scoped>
.vt-icon-button {
  display: inline-grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--vt-radius-button);
  background: transparent;
  color: var(--vt-text-muted);
  transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition);
}

.is-sm { width: 32px; height: 32px; }
.is-soft { border-color: var(--vt-border); background: var(--vt-surface); }
.is-danger { color: var(--vt-danger); }

.vt-icon-button:hover:not(:disabled),
.is-pressed {
  border-color: var(--vt-border);
  background: var(--vt-surface-muted);
  color: var(--vt-text);
}

.is-danger:hover:not(:disabled) {
  border-color: #f1c4c8;
  background: var(--vt-danger-soft);
  color: var(--vt-danger);
}

.vt-icon-button:focus-visible {
  border-color: var(--vt-primary);
  box-shadow: 0 0 0 3px var(--vt-focus);
}

.vt-icon-button:disabled {
  cursor: not-allowed;
  color: var(--vt-text-faint);
  opacity: 0.55;
}
</style>

