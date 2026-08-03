<script setup lang="ts">
defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    modelValue?: string
    invalid?: boolean
    disabled?: boolean
    readonly?: boolean
    rows?: number
  }>(),
  { modelValue: '', rows: 6 },
)

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <textarea
    v-bind="$attrs"
    class="vt-textarea"
    :class="{ 'is-invalid': invalid }"
    :value="modelValue"
    :rows="rows"
    :disabled="disabled"
    :readonly="readonly"
    :aria-invalid="invalid || undefined"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>

<style scoped>
.vt-textarea {
  display: block;
  width: 100%;
  min-height: 116px;
  resize: vertical;
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-control);
  outline: 0;
  background: var(--vt-surface);
  color: var(--vt-text);
  padding: 10px 11px;
  font-size: 13px;
  line-height: 1.65;
  transition: border-color var(--vt-transition), box-shadow var(--vt-transition), background var(--vt-transition);
}

.vt-textarea:hover:not(:disabled) { border-color: var(--vt-border-hover); }
.vt-textarea:focus-visible { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-textarea.is-invalid { border-color: var(--vt-danger); }
.vt-textarea:disabled { cursor: not-allowed; background: var(--vt-surface-muted); color: var(--vt-text-faint); }
.vt-textarea:read-only:not(:disabled) { background: var(--vt-surface-subtle); }
.vt-textarea::placeholder { color: var(--vt-text-faint); }
</style>

