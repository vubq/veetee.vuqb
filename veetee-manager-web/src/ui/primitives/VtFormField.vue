<script setup lang="ts">
defineProps<{
  label: string
  forId: string
  hint?: string
  error?: string
  optional?: boolean
}>()
</script>

<template>
  <div
    class="vt-field"
    :class="{ 'has-error': error }"
  >
    <div class="field-heading">
      <label
        class="field-label"
        :for="forId"
      >{{ label }}</label>
      <span
        v-if="optional"
        class="field-optional"
      >Không bắt buộc</span>
    </div>
    <slot :describedby="error ? `${forId}-error` : hint ? `${forId}-hint` : undefined" />
    <p
      v-if="error"
      :id="`${forId}-error`"
      class="field-message is-error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-else-if="hint"
      :id="`${forId}-hint`"
      class="field-message"
    >
      {{ hint }}
    </p>
  </div>
</template>

<style scoped>
.vt-field { min-width: 0; }
.field-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.field-label { color: var(--vt-text-soft); font-size: 12px; font-weight: 600; }
.field-optional { color: var(--vt-text-faint); font-size: 10px; }
.field-message { margin: 6px 1px 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.45; }
.field-message.is-error { color: var(--vt-danger); }
</style>

