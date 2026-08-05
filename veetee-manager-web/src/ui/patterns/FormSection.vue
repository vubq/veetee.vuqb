<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'

import VtIcon from '@/ui/primitives/VtIcon.vue'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  collapsible?: boolean
  open?: boolean
}>(), {
  collapsible: false,
  open: true,
})

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

function toggle() {
  if (props.collapsible) emit('update:open', !props.open)
}
</script>

<template>
  <section class="form-section">
    <header class="section-header">
      <button
        v-if="props.collapsible"
        class="section-toggle"
        type="button"
        :aria-expanded="props.open"
        @click="toggle"
      >
        <span class="section-copy">
          <span class="section-title">{{ props.title }}</span>
          <span
            v-if="props.description"
            class="section-description"
          >
            {{ props.description }}
          </span>
        </span>
        <VtIcon
          class="section-chevron"
          :class="{ 'is-open': props.open }"
          :icon="ChevronDown"
          :size="16"
        />
      </button>
      <div v-else>
        <h2>{{ props.title }}</h2><p v-if="props.description">
          {{ props.description }}
        </p>
      </div>
      <div
        v-if="$slots.trailing"
        class="section-trailing"
      >
        <slot name="trailing" />
      </div>
    </header>
    <div
      v-if="!props.collapsible || props.open"
      class="section-body"
    >
      <slot />
    </div>
    <footer
      v-if="$slots.footer"
      class="section-footer"
    >
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.form-section { overflow: visible; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); }
.section-header { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid var(--vt-border); padding: 11px 14px; }
.section-header h2, .section-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.45; }
.section-header p, .section-description { display: block; margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.section-toggle { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: space-between; gap: 12px; border: 0; background: transparent; color: inherit; padding: 0; text-align: left; }
.section-toggle:hover { color: var(--vt-text); }
.section-toggle:focus-visible { border-radius: var(--vt-radius-button); box-shadow: 0 0 0 3px var(--vt-focus); outline: 0; }
.section-copy { min-width: 0; }
.section-chevron { flex: none; color: var(--vt-text-muted); transition: transform var(--vt-transition); }
.section-chevron.is-open { transform: rotate(180deg); }
.section-trailing { flex: none; }
.section-body { padding: 14px; }
.section-footer { display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vt-border); background: var(--vt-surface-subtle); padding: 11px 14px; }
</style>
