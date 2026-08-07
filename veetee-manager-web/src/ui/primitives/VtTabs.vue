<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface VtTabItem {
  value: string
  label: string
  disabled?: boolean
}

const props = defineProps<{ modelValue: string; items: VtTabItem[]; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <Tabs
    :model-value="props.modelValue"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <TabsList
      class="vt-tabs"
      :aria-label="props.label"
    >
      <TabsTrigger
        v-for="item in props.items"
        :key="item.value"
        class="vt-tab"
        :value="item.value"
        :disabled="item.disabled"
      >
        {{ item.label }}
      </TabsTrigger>
    </TabsList>
  </Tabs>
</template>

<style scoped>
.vt-tabs { max-width: 100%; overflow-x: auto; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-muted); padding: 3px; }
.vt-tab { min-height: 32px; color: var(--vt-text-muted); padding-inline: 11px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.vt-tab[data-state='active'] { color: var(--vt-text); }
</style>
