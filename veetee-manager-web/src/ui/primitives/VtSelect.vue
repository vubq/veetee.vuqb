<script setup lang="ts">
import { computed, useAttrs } from 'vue'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from '@/components/ui/select'

defineOptions({ inheritAttrs: false })

export interface VtSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: VtSelectOption[]
    placeholder?: string
    disabled?: boolean
    invalid?: boolean
    label: string
  }>(),
  { modelValue: '', placeholder: 'Chọn một giá trị' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const attrs = useAttrs()
const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue))
</script>

<template>
  <Select
    :model-value="props.modelValue || undefined"
    :disabled="props.disabled"
    @update:model-value="(value) => value != null && emit('update:modelValue', String(value))"
  >
    <SelectTrigger
      v-bind="attrs"
      class="vt-select-trigger w-full"
      :class="{ 'is-invalid': props.invalid }"
      :aria-label="props.label"
    >
      <SelectValue
        :placeholder="props.placeholder"
        :title="selectedOption?.label"
      >
        {{ selectedOption?.label ?? props.placeholder }}
      </SelectValue>
    </SelectTrigger>
    <SelectContent
      position="popper"
      :side-offset="5"
      :collision-padding="12"
      class="vt-select-content"
    >
      <SelectItem
        v-for="option in props.options"
        :key="option.value"
        class="vt-select-item"
        :value="option.value"
        :disabled="option.disabled"
        :description="option.description"
        :aria-label="[option.label, option.description].filter(Boolean).join(' ')"
      >
        {{ option.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>

<style>
.vt-select-trigger { min-width: 0; min-height: var(--vt-control-height); color: var(--vt-text); }
.vt-select-trigger:hover:not([data-disabled]) { border-color: var(--vt-border-hover); }
.vt-select-trigger:focus-visible,
.vt-select-trigger[data-state='open'] { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-select-trigger.is-invalid { border-color: var(--vt-danger); }
.vt-select-trigger[data-disabled] { cursor: not-allowed; background: var(--vt-surface-muted); color: var(--vt-text-faint); opacity: 0.72; }
.vt-select-trigger > [data-slot='select-value'] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-select-content { max-width: min(440px, calc(100vw - 24px)); }
.vt-select-item { min-height: 36px; }
</style>
