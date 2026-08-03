<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

withDefaults(
  defineProps<{
    modelValue?: boolean
    label: string
    disabled?: boolean
  }>(),
  { modelValue: false },
)

defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="vt-switch-label"
    :class="{ 'is-disabled': disabled }"
  >
    <SwitchRoot
      class="vt-switch"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <SwitchThumb class="vt-switch-thumb" />
    </SwitchRoot>
    <span>{{ label }}</span>
  </label>
</template>

<style scoped>
.vt-switch-label { display: inline-flex; align-items: center; gap: 9px; color: var(--vt-text-soft); font-size: 12px; font-weight: 500; }
.vt-switch-label.is-disabled { color: var(--vt-text-faint); }
.vt-switch {
  position: relative;
  width: 38px;
  height: 22px;
  flex: none;
  border: 1px solid var(--vt-border-strong);
  border-radius: 11px;
  background: var(--vt-border-strong);
  padding: 2px;
  transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition);
}
.vt-switch:hover:not([data-disabled]) { border-color: var(--vt-border-hover); background: var(--vt-border-hover); }
.vt-switch[data-state='checked'] { border-color: var(--vt-primary); background: var(--vt-primary); }
.vt-switch:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-switch[data-disabled] { cursor: not-allowed; opacity: 0.55; }
.vt-switch-thumb {
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
  transition: transform var(--vt-transition);
  will-change: transform;
}
.vt-switch-thumb[data-state='checked'] { transform: translateX(16px); }
</style>

