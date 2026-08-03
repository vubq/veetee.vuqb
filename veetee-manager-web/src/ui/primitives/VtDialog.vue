<script setup lang="ts">
import { X } from '@lucide/vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

import VtIcon from './VtIcon.vue'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    width?: 'sm' | 'md' | 'lg'
    preventClose?: boolean
  }>(),
  { width: 'md' },
)

defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <DialogPortal>
      <DialogOverlay class="vt-dialog-overlay" />
      <DialogContent
        class="vt-dialog-content"
        :class="`is-${width}`"
        :aria-describedby="description ? undefined : null"
        @escape-key-down="preventClose && $event.preventDefault()"
        @pointer-down-outside="preventClose && $event.preventDefault()"
      >
        <header class="vt-dialog-header">
          <div class="dialog-heading">
            <DialogTitle class="dialog-title">
              {{ title }}
            </DialogTitle>
            <DialogDescription
              v-if="description"
              class="dialog-description"
            >
              {{ description }}
            </DialogDescription>
          </div>
          <DialogClose
            v-if="!preventClose"
            class="dialog-close"
            aria-label="Đóng hộp thoại"
          >
            <VtIcon
              :icon="X"
              :size="17"
            />
          </DialogClose>
        </header>
        <div class="vt-dialog-body">
          <slot />
        </div>
        <footer
          v-if="$slots.footer"
          class="vt-dialog-footer"
        >
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.vt-dialog-overlay { position: fixed; z-index: 140; inset: 0; background: var(--vt-overlay); backdrop-filter: blur(1px); }
.vt-dialog-overlay[data-state='open'] { animation: vt-fade-in 130ms ease-out; }
.vt-dialog-content {
  position: fixed;
  z-index: 141;
  top: 50%;
  left: 50%;
  width: min(calc(100% - 28px), 520px);
  max-height: min(86vh, 760px);
  overflow: auto;
  transform: translate(-50%, -50%);
  border: 1px solid var(--vt-border);
  border-radius: var(--vt-radius-control);
  outline: none;
  background: var(--vt-surface);
  box-shadow: var(--vt-shadow-modal);
}
.vt-dialog-content.is-sm { max-width: 430px; }
.vt-dialog-content.is-lg { max-width: 700px; }
.vt-dialog-content[data-state='open'] { animation: vt-dialog-in 140ms ease-out; }
.vt-dialog-header { display: flex; align-items: flex-start; gap: 16px; border-bottom: 1px solid var(--vt-border); padding: 17px 18px 15px; }
.dialog-heading { min-width: 0; flex: 1; }
.dialog-title { margin: 0; color: var(--vt-text); font-size: 16px; font-weight: 600; line-height: 1.45; }
.dialog-description { margin: 4px 0 0; color: var(--vt-text-muted); font-size: 12px; line-height: 1.55; }
.dialog-close { display: inline-grid; width: 32px; height: 32px; flex: none; place-items: center; border: 1px solid transparent; border-radius: var(--vt-radius-button); background: transparent; color: var(--vt-text-muted); }
.dialog-close:hover { border-color: var(--vt-border); background: var(--vt-surface-muted); color: var(--vt-text); }
.dialog-close:focus-visible { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.vt-dialog-body { padding: 18px; }
.vt-dialog-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vt-border); background: var(--vt-surface-subtle); padding: 12px 18px; }
@keyframes vt-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes vt-dialog-in { from { opacity: 0; transform: translate(-50%, calc(-50% + 5px)) scale(0.99); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
</style>

