<script setup lang="ts">
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

export interface VtAccordionItem {
  value: string
  title: string
  description?: string
  content: string
}

const props = defineProps<{ items: VtAccordionItem[] }>()
</script>

<template>
  <Accordion
    class="vt-accordion"
    type="multiple"
  >
    <AccordionItem
      v-for="item in props.items"
      :key="item.value"
      class="vt-accordion-item"
      :value="item.value"
    >
      <AccordionTrigger class="vt-accordion-trigger">
        <span>
          <strong>{{ item.title }}</strong>
          <small v-if="item.description">{{ item.description }}</small>
        </span>
      </AccordionTrigger>
      <AccordionContent class="vt-accordion-content">
        <div>{{ item.content }}</div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>

<style scoped>
.vt-accordion { overflow: hidden; border-color: var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); }
.vt-accordion-trigger { min-height: 48px; color: var(--vt-text-soft); padding: 9px 13px; text-align: left; }
.vt-accordion-trigger strong { display: block; font-size: 12px; font-weight: 600; }
.vt-accordion-trigger small { display: block; margin-top: 2px; color: var(--vt-text-muted); font-size: 10px; font-weight: 400; }
.vt-accordion-content { color: var(--vt-text-muted); font-size: 12px; line-height: 1.65; }
.vt-accordion-content > div { border-top: 1px solid var(--vt-border); padding: 12px 13px; }
</style>
