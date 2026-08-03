<script setup lang="ts">
import { Check, ChevronRight } from '@lucide/vue'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'

import VtIcon from './VtIcon.vue'

export interface VtMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
  selected?: boolean
  separatorBefore?: boolean
}

defineProps<{ items: VtMenuItem[]; label: string; align?: 'start' | 'center' | 'end' }>()
defineEmits<{ select: [id: string] }>()
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        class="vt-menu-content"
        :align="align ?? 'end'"
        :side-offset="5"
        :collision-padding="10"
      >
        <template
          v-for="item in items"
          :key="item.id"
        >
          <DropdownMenuSeparator
            v-if="item.separatorBefore"
            class="vt-menu-separator"
          />
          <DropdownMenuItem
            class="vt-menu-item"
            :class="{ 'is-danger': item.danger }"
            :disabled="item.disabled"
            @select="$emit('select', item.id)"
          >
            <VtIcon
              v-if="item.selected"
              :icon="Check"
              :size="14"
            />
            <span
              v-else
              class="menu-spacer"
            />
            <span>{{ item.label }}</span>
            <VtIcon
              v-if="item.id === 'more'"
              class="menu-trailing"
              :icon="ChevronRight"
              :size="13"
            />
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>

<style>
.vt-menu-content { z-index: 125; min-width: 178px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-popover); background: var(--vt-surface); box-shadow: var(--vt-shadow-dropdown); padding: 5px; }
.vt-menu-content[data-state='open'] { animation: vt-pop-in 120ms ease-out; }
.vt-menu-item { display: flex; min-height: 34px; align-items: center; gap: 8px; border-radius: 3px; outline: none; color: var(--vt-text-soft); padding: 5px 8px; font-size: 11px; user-select: none; }
.vt-menu-item[data-highlighted] { background: var(--vt-surface-muted); color: var(--vt-text); }
.vt-menu-item[data-disabled] { opacity: 0.45; }
.vt-menu-item.is-danger { color: var(--vt-danger); }
.vt-menu-item.is-danger[data-highlighted] { background: var(--vt-danger-soft); }
.vt-menu-separator { height: 1px; margin: 4px -5px; background: var(--vt-border); }
.menu-spacer { width: 14px; }
.menu-trailing { margin-left: auto; }
</style>

