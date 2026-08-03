<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

export interface VtTabItem {
  value: string
  label: string
  disabled?: boolean
}

defineProps<{ modelValue: string; items: VtTabItem[]; label: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <TabsRoot
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', String($event))"
  >
    <TabsList
      class="vt-tabs"
      :aria-label="label"
    >
      <TabsTrigger
        v-for="item in items"
        :key="item.value"
        class="vt-tab"
        :value="item.value"
        :disabled="item.disabled"
      >
        {{ item.label }}
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>

<style scoped>
.vt-tabs { display: inline-flex; max-width: 100%; gap: 2px; overflow-x: auto; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-muted); padding: 3px; }
.vt-tab { min-height: 32px; border: 0; border-radius: 4px; background: transparent; color: var(--vt-text-muted); padding: 0 11px; font-size: 11px; font-weight: 600; white-space: nowrap; transition: background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition); }
.vt-tab:hover:not(:disabled) { color: var(--vt-text); }
.vt-tab[data-state='active'] { background: var(--vt-surface); color: var(--vt-text); box-shadow: 0 1px 2px rgba(31, 41, 55, 0.1); }
.vt-tab:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-tab:disabled { cursor: not-allowed; opacity: 0.5; }
</style>

