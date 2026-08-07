<script setup lang="ts">
import { Textarea } from '@/components/ui/textarea'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: string
    invalid?: boolean
    disabled?: boolean
    readonly?: boolean
    rows?: number
  }>(),
  { modelValue: '', rows: 6 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <Textarea
    v-bind="$attrs"
    class="vt-textarea"
    :class="{ 'is-invalid': props.invalid }"
    :model-value="props.modelValue"
    :rows="props.rows"
    :disabled="props.disabled"
    :readonly="props.readonly"
    :aria-invalid="props.invalid || undefined"
    @update:model-value="emit('update:modelValue', String($event))"
  />
</template>

<style scoped>
.vt-textarea { min-height: 116px; resize: vertical; background: var(--vt-surface); color: var(--vt-text); font-size: 13px; line-height: 1.65; }
.vt-textarea:hover:not(:disabled) { border-color: var(--vt-border-hover); }
.vt-textarea:focus-visible { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-textarea.is-invalid { border-color: var(--vt-danger); }
.vt-textarea:read-only:not(:disabled) { background: var(--vt-surface-subtle); }
</style>
