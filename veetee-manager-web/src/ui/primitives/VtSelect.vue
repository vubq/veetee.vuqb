<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport,
} from 'reka-ui'
import { computed } from 'vue'

import VtIcon from './VtIcon.vue'

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

defineEmits<{ 'update:modelValue': [value: string] }>()

const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue))
</script>

<template>
  <SelectRoot
    :model-value="modelValue || undefined"
    :disabled="disabled"
    @update:model-value="(value) => value != null && $emit('update:modelValue', String(value))"
  >
    <SelectTrigger
      v-bind="$attrs"
      class="vt-select-trigger"
      :class="{ 'is-invalid': invalid }"
      :aria-label="label"
    >
      <span
        class="vt-select-value"
        :class="{ 'is-placeholder': !selectedOption }"
        :title="selectedOption?.label"
      >{{ selectedOption?.label ?? placeholder }}</span>
      <VtIcon
        :icon="ChevronDown"
        :size="15"
      />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        class="vt-select-content"
        position="popper"
        :side-offset="5"
        :collision-padding="12"
      >
        <SelectViewport class="vt-select-viewport">
          <SelectItem
            v-for="option in options"
            :key="option.value"
            class="vt-select-item"
            :value="option.value"
            :disabled="option.disabled"
          >
            <SelectItemIndicator class="item-indicator">
              <VtIcon
                :icon="Check"
                :size="14"
                :stroke-width="2.2"
              />
            </SelectItemIndicator>
            <SelectItemText>
              <span class="item-copy">
                <span class="item-label">{{ option.label }}</span>
                <span
                  v-if="option.description"
                  class="item-description"
                >{{ option.description }}</span>
              </span>
            </SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.vt-select-trigger {
  display: inline-flex;
  width: 100%;
  min-width: 0;
  height: var(--vt-control-height);
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-control);
  background: var(--vt-surface);
  color: var(--vt-text);
  padding: 0 11px;
  font-size: 13px;
  text-align: left;
  transition: border-color var(--vt-transition), box-shadow var(--vt-transition), background var(--vt-transition);
}

.vt-select-trigger:hover:not([data-disabled]) { border-color: var(--vt-border-hover); }
.vt-select-trigger:focus-visible,
.vt-select-trigger[data-state='open'] { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-select-trigger.is-invalid { border-color: var(--vt-danger); }
.vt-select-trigger[data-disabled] { cursor: not-allowed; background: var(--vt-surface-muted); color: var(--vt-text-faint); opacity: 0.72; }
.vt-select-trigger [data-placeholder] { color: var(--vt-text-faint); }
.vt-select-value { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vt-select-value.is-placeholder { color: var(--vt-text-faint); }

.vt-select-content {
  z-index: 120;
  min-width: var(--reka-select-trigger-width);
  max-width: min(440px, calc(100vw - 24px));
  max-height: min(320px, var(--reka-select-content-available-height));
  overflow: hidden;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-popover);
  background: var(--vt-surface);
  box-shadow: var(--vt-shadow-dropdown);
  transform-origin: var(--reka-select-content-transform-origin);
}

.vt-select-content[data-state='open'] { animation: vt-pop-in 120ms ease-out; }
.vt-select-viewport { padding: 5px; }

.vt-select-item {
  position: relative;
  display: flex;
  min-height: 38px;
  align-items: center;
  border-radius: 3px;
  outline: none;
  padding: 6px 32px 6px 10px;
  color: var(--vt-text-soft);
  font-size: 12px;
  user-select: none;
}

.vt-select-item[data-highlighted] { background: var(--vt-surface-muted); color: var(--vt-text); }
.vt-select-item[data-state='checked'] { background: var(--vt-primary-soft); color: var(--vt-primary-text); }
.vt-select-item[data-disabled] { opacity: 0.48; }
.item-indicator { position: absolute; right: 10px; display: inline-grid; place-items: center; color: var(--vt-primary); }
.item-copy { display: grid; min-width: 0; gap: 1px; }
.item-label, .item-description { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-label { font-weight: 500; }
.item-description { color: var(--vt-text-muted); font-size: 10px; }

@keyframes vt-pop-in {
  from { opacity: 0; transform: translateY(-2px) scale(0.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
