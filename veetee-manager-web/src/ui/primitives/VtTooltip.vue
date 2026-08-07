<script setup lang="ts">
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

withDefaults(defineProps<{ content: string; side?: 'top' | 'right' | 'bottom' | 'left' }>(), { side: 'top' })
</script>

<template>
  <TooltipProvider
    :delay-duration="350"
    :skip-delay-duration="100"
  >
    <Tooltip>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent
        class="vt-tooltip"
        :side="side"
        :side-offset="6"
      >
        {{ content }}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>

<style scoped>
.vt-tooltip { max-width: 260px; background: var(--vt-text); color: white; font-size: 10px; line-height: 1.45; }
</style>
