<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { AccordionContent, AccordionHeader, AccordionItem, AccordionRoot, AccordionTrigger } from 'reka-ui'

import VtIcon from './VtIcon.vue'

export interface VtAccordionItem {
  value: string
  title: string
  description?: string
  content: string
}

defineProps<{ items: VtAccordionItem[] }>()
</script>

<template>
  <AccordionRoot
    class="vt-accordion"
    type="multiple"
  >
    <AccordionItem
      v-for="item in items"
      :key="item.value"
      class="vt-accordion-item"
      :value="item.value"
    >
      <AccordionHeader>
        <AccordionTrigger class="vt-accordion-trigger">
          <span><strong>{{ item.title }}</strong><small v-if="item.description">{{ item.description }}</small></span>
          <VtIcon
            class="accordion-chevron"
            :icon="ChevronDown"
            :size="16"
          />
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionContent class="vt-accordion-content">
        <div>{{ item.content }}</div>
      </AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>

<style scoped>
.vt-accordion { overflow: hidden; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); }
.vt-accordion-item + .vt-accordion-item { border-top: 1px solid var(--vt-border); }
.vt-accordion-trigger { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: space-between; gap: 12px; border: 0; background: transparent; color: var(--vt-text-soft); padding: 9px 13px; text-align: left; transition: background var(--vt-transition), box-shadow var(--vt-transition); }
.vt-accordion-trigger:hover { background: var(--vt-surface-subtle); }
.vt-accordion-trigger:focus-visible { box-shadow: inset 0 0 0 2px var(--vt-primary); }
.vt-accordion-trigger strong { display: block; font-size: 12px; font-weight: 600; }
.vt-accordion-trigger small { display: block; margin-top: 2px; color: var(--vt-text-muted); font-size: 10px; font-weight: 400; }
.accordion-chevron { transition: transform var(--vt-transition); }
.vt-accordion-trigger[data-state='open'] .accordion-chevron { transform: rotate(180deg); }
.vt-accordion-content { overflow: hidden; color: var(--vt-text-muted); font-size: 12px; line-height: 1.65; }
.vt-accordion-content[data-state='open'] { animation: accordion-down 140ms ease-out; }
.vt-accordion-content[data-state='closed'] { animation: accordion-up 140ms ease-out; }
.vt-accordion-content > div { border-top: 1px solid var(--vt-border); padding: 12px 13px; }
@keyframes accordion-down { from { height: 0; } to { height: var(--reka-accordion-content-height); } }
@keyframes accordion-up { from { height: var(--reka-accordion-content-height); } to { height: 0; } }
</style>

