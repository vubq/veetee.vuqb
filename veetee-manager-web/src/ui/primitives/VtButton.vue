<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'

import VtIcon from './VtIcon.vue'

withDefaults(
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
</script>

<template>
  <button
    class="vt-button"
    :class="[`is-${variant}`, `is-${size}`, { 'is-loading': loading, 'is-block': block }]"
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <VtIcon
      v-if="loading"
      class="spinner"
      :icon="LoaderCircle"
      :size="15"
    />
    <span
      v-if="$slots.leading && !loading"
      class="button-icon"
    ><slot name="leading" /></span>
    <span class="button-label"><slot /></span>
    <span
      v-if="$slots.trailing"
      class="button-icon"
    ><slot name="trailing" /></span>
  </button>
</template>

<style scoped>
.vt-button {
  display: inline-flex;
  min-width: 0;
  height: var(--vt-button-height);
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-button);
  background: var(--vt-surface);
  color: var(--vt-text-soft);
  padding: 0 13px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  transition: border-color var(--vt-transition), background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition);
}

.vt-button:hover:not(:disabled) {
  border-color: var(--vt-border-hover);
  background: var(--vt-surface-muted);
  color: var(--vt-text);
}

.vt-button:focus-visible {
  border-color: var(--vt-primary);
  box-shadow: 0 0 0 3px var(--vt-focus);
}

.vt-button:active:not(:disabled) {
  background: #e9eef3;
}

.is-primary {
  border-color: var(--vt-primary);
  background: var(--vt-primary);
  color: white;
}

.is-primary:hover:not(:disabled) {
  border-color: var(--vt-primary-hover);
  background: var(--vt-primary-hover);
  color: white;
}

.is-danger {
  border-color: var(--vt-danger);
  background: var(--vt-danger);
  color: white;
}

.is-danger:hover:not(:disabled) {
  border-color: var(--vt-danger-hover);
  background: var(--vt-danger-hover);
  color: white;
}

.is-ghost {
  border-color: transparent;
  background: transparent;
}

.is-sm {
  height: 34px;
  padding-inline: 11px;
  font-size: 11px;
}

.is-block {
  width: 100%;
}

.vt-button:disabled {
  cursor: not-allowed;
  border-color: var(--vt-border);
  background: var(--vt-surface-muted);
  color: var(--vt-text-faint);
  opacity: 0.72;
}

.button-icon {
  display: inline-grid;
  place-items: center;
}

.button-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.spinner {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

