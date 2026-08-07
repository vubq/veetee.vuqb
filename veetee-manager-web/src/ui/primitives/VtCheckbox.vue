<script setup lang="ts">
import { Checkbox } from '@/components/ui/checkbox'

const props = withDefaults(defineProps<{ modelValue?: boolean; label: string; ariaLabel?: string; disabled?: boolean; showLabel?: boolean }>(), { modelValue: false, showLabel: true })
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="vt-checkbox-label"
    :class="{ 'is-disabled': props.disabled }"
  >
    <Checkbox
      class="vt-checkbox size-[18px]"
      :model-value="props.modelValue"
      :disabled="props.disabled"
      :aria-label="props.ariaLabel ?? props.label"
      @update:model-value="emit('update:modelValue', $event === true)"
    />
    <span v-if="props.showLabel">{{ props.label }}</span>
  </label>
</template>

<style scoped>
.vt-checkbox-label { display: inline-flex; align-items: center; gap: 8px; color: var(--vt-text-soft); font-size: 12px; }
.vt-checkbox-label.is-disabled { color: var(--vt-text-faint); }
</style>
