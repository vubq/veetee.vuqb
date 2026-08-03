<script setup lang="ts">
import { ref, type Component } from 'vue'

import VtIcon from './VtIcon.vue'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    modelValue?: string
    icon?: Component
    invalid?: boolean
    disabled?: boolean
    readonly?: boolean
  }>(),
  { modelValue: '' },
)

defineEmits<{ 'update:modelValue': [value: string] }>()

const inputElement = ref<HTMLInputElement>()
defineExpose({ focus: () => inputElement.value?.focus() })
</script>

<template>
  <div
    class="vt-input-shell"
    :class="{ 'is-invalid': invalid, 'is-disabled': disabled, 'is-readonly': readonly }"
  >
    <VtIcon
      v-if="icon"
      class="input-icon"
      :icon="icon"
      :size="16"
    />
    <input
      ref="inputElement"
      v-bind="$attrs"
      class="vt-input"
      :value="modelValue"
      :disabled="disabled"
      :readonly="readonly"
      :aria-invalid="invalid || undefined"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <span
      v-if="$slots.trailing"
      class="input-trailing"
    ><slot name="trailing" /></span>
  </div>
</template>

<style scoped>
.vt-input-shell {
  display: flex;
  width: 100%;
  min-width: 0;
  height: var(--vt-control-height);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-control);
  background: var(--vt-surface);
  padding-inline: 11px;
  color: var(--vt-text-muted);
  transition: border-color var(--vt-transition), box-shadow var(--vt-transition), background var(--vt-transition);
}

.vt-input-shell:hover:not(.is-disabled) { border-color: var(--vt-border-hover); }
.vt-input-shell:focus-within { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-input-shell.is-invalid { border-color: var(--vt-danger); }
.vt-input-shell.is-invalid:focus-within { box-shadow: 0 0 0 3px rgba(214, 69, 80, 0.15); }
.vt-input-shell.is-disabled { cursor: not-allowed; background: var(--vt-surface-muted); opacity: 0.7; }
.vt-input-shell.is-readonly { background: var(--vt-surface-subtle); }

.vt-input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--vt-text);
  font-size: 13px;
}

.vt-input::placeholder { color: var(--vt-text-faint); }
.vt-input:disabled { cursor: not-allowed; }
.input-icon,
.input-trailing { flex: none; }
.input-trailing { display: inline-flex; align-items: center; }
</style>
