<script setup lang="ts">
import { Switch } from '@/components/ui/switch'

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    label: string
    ariaLabel?: string
    disabled?: boolean
    showLabel?: boolean
  }>(),
  { modelValue: false, showLabel: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label
    class="vt-switch-label"
    :class="{ 'is-disabled': props.disabled }"
  >
    <Switch
      class="vt-switch"
      :model-value="props.modelValue"
      :disabled="props.disabled"
      :aria-label="props.ariaLabel ?? props.label"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <span v-if="props.showLabel">{{ props.label }}</span>
  </label>
</template>

<style scoped>
.vt-switch-label { display: inline-flex; align-items: center; gap: 9px; color: var(--vt-text-soft); font-size: 12px; font-weight: 500; }
.vt-switch-label.is-disabled { color: var(--vt-text-faint); }
.vt-switch { flex: none; }
</style>
