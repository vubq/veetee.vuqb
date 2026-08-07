<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref, useAttrs } from 'vue'

import { Input } from '@/components/ui/input'

import VtIcon from './VtIcon.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: string
    icon?: Component
    invalid?: boolean
    disabled?: boolean
    readonly?: boolean
  }>(),
  { modelValue: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const attrs = useAttrs()
const inputElement = ref<HTMLInputElement>()
const inputAttrs = computed(() => {
  const next = { ...attrs }
  delete next.class
  return next
})

defineExpose({ focus: () => inputElement.value?.focus() })
</script>

<template>
  <div
    class="vt-input-shell"
    :class="[
      attrs.class,
      { 'is-invalid': props.invalid, 'is-disabled': props.disabled, 'is-readonly': props.readonly },
    ]"
  >
    <VtIcon
      v-if="props.icon"
      class="input-icon"
      :icon="props.icon"
      :size="16"
    />
    <Input
      ref="inputElement"
      v-bind="inputAttrs"
      class="vt-input"
      :model-value="props.modelValue"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :aria-invalid="props.invalid || undefined"
      @update:model-value="emit('update:modelValue', String($event))"
    />
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
  min-height: var(--vt-control-height);
  align-items: center;
  gap: 8px;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-control);
  background: var(--vt-surface);
  padding-inline: 2px 10px;
  color: var(--vt-text-muted);
  transition: border-color var(--vt-transition), box-shadow var(--vt-transition), background var(--vt-transition);
}
.vt-input-shell:hover:not(.is-disabled) { border-color: var(--vt-border-hover); }
.vt-input-shell:focus-within { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-input-shell.is-invalid { border-color: var(--vt-danger); }
.vt-input-shell.is-invalid:focus-within { box-shadow: 0 0 0 3px rgba(214, 69, 80, 0.15); }
.vt-input-shell.is-disabled { cursor: not-allowed; background: var(--vt-surface-muted); opacity: 0.7; }
.vt-input-shell.is-readonly { background: var(--vt-surface-subtle); }
.vt-input { min-width: 0; flex: 1; border: 0; background: transparent; box-shadow: none; }
.vt-input:focus-visible { border-color: transparent; box-shadow: none; }
.vt-input-icon, .input-trailing { flex: none; }
.input-trailing { display: inline-flex; align-items: center; }
</style>
