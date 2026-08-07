<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    width?: 'sm' | 'md' | 'lg'
    preventClose?: boolean
  }>(),
  { width: 'md' },
)

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <Dialog
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <DialogContent
      class="vt-dialog-content"
      :class="`is-${props.width}`"
      :show-close-button="!props.preventClose"
      :aria-describedby="props.description ? undefined : null"
      @escape-key-down="props.preventClose && $event.preventDefault()"
      @pointer-down-outside="props.preventClose && $event.preventDefault()"
    >
      <DialogHeader class="vt-dialog-header">
        <DialogTitle class="dialog-title">
          {{ props.title }}
        </DialogTitle>
        <DialogDescription
          v-if="props.description"
          class="dialog-description"
        >
          {{ props.description }}
        </DialogDescription>
      </DialogHeader>
      <div class="vt-dialog-body">
        <slot />
      </div>
      <DialogFooter
        v-if="$slots.footer"
        class="vt-dialog-footer"
      >
        <slot name="footer" />
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style>
.vt-dialog-content { width: min(calc(100% - 28px), 520px); max-height: min(86dvh, 760px); overflow: auto; border-color: var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface); box-shadow: var(--vt-shadow-modal); }
.vt-dialog-content.is-sm { max-width: 430px; }
.vt-dialog-content.is-lg { max-width: 700px; }
.vt-dialog-header { border-bottom: 1px solid var(--vt-border); padding: 17px 18px 15px; text-align: left; }
.dialog-title { color: var(--vt-text); font-size: 16px; font-weight: 600; line-height: 1.45; }
.dialog-description { margin-top: 4px; color: var(--vt-text-muted); font-size: 12px; line-height: 1.55; }
.vt-dialog-body { padding: 18px; }
.vt-dialog-footer { justify-content: flex-end; gap: 8px; border-top: 1px solid var(--vt-border); background: var(--vt-surface-subtle); padding: 12px 18px; }
</style>
