<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

withDefaults(defineProps<{ content: string; side?: 'top' | 'right' | 'bottom' | 'left' }>(), { side: 'top' })
</script>

<template>
  <TooltipProvider
    :delay-duration="350"
    :skip-delay-duration="100"
  >
    <TooltipRoot>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="vt-tooltip"
          :side="side"
          :side-offset="6"
        >
          {{ content }}
          <TooltipArrow
            class="vt-tooltip-arrow"
            :width="8"
            :height="4"
          />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<style>
.vt-tooltip { z-index: 180; max-width: 260px; border-radius: 4px; background: var(--vt-text); color: white; padding: 6px 8px; font-size: 10px; line-height: 1.45; box-shadow: var(--vt-shadow-dropdown); }
.vt-tooltip[data-state='delayed-open'] { animation: vt-tooltip-in 120ms ease-out; }
.vt-tooltip-arrow { fill: var(--vt-text); }
@keyframes vt-tooltip-in { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
</style>

