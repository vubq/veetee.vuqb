<script setup lang="ts">
import { Check } from '@lucide/vue'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'

withDefaults(defineProps<{ modelValue?: boolean; label: string; disabled?: boolean }>(), { modelValue: false })
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="vt-checkbox-label"
    :class="{ 'is-disabled': disabled }"
  >
    <CheckboxRoot
      class="vt-checkbox"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="$emit('update:modelValue', $event === true)"
    >
      <CheckboxIndicator class="vt-checkbox-indicator"><Check
        :size="13"
        :stroke-width="2.5"
      /></CheckboxIndicator>
    </CheckboxRoot>
    <span>{{ label }}</span>
  </label>
</template>

<style scoped>
.vt-checkbox-label { display: inline-flex; align-items: center; gap: 8px; color: var(--vt-text-soft); font-size: 12px; }
.vt-checkbox-label.is-disabled { color: var(--vt-text-faint); }
.vt-checkbox { display: inline-grid; width: 18px; height: 18px; flex: none; place-items: center; border: 1px solid var(--vt-border-strong); border-radius: 4px; background: var(--vt-surface); color: white; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition); }
.vt-checkbox:hover:not([data-disabled]) { border-color: var(--vt-primary); }
.vt-checkbox[data-state='checked'] { border-color: var(--vt-primary); background: var(--vt-primary); }
.vt-checkbox:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-checkbox[data-disabled] { cursor: not-allowed; background: var(--vt-surface-muted); opacity: 0.6; }
.vt-checkbox-indicator { display: inline-grid; place-items: center; }
</style>

