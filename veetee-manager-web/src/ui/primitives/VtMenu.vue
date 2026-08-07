<script setup lang="ts">
import { Check, ChevronRight } from '@lucide/vue'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface VtMenuItem {
  id: string
  label: string
  disabled?: boolean
  danger?: boolean
  selected?: boolean
  separatorBefore?: boolean
}

const props = defineProps<{ items: VtMenuItem[]; label: string; align?: 'start' | 'center' | 'end' }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      class="vt-menu-content"
      :align="props.align ?? 'end'"
      :aria-label="props.label"
    >
      <template
        v-for="item in props.items"
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
          @select="emit('select', item.id)"
        >
          <Check
            v-if="item.selected"
            :size="14"
            aria-hidden="true"
          />
          <span
            v-else
            class="menu-spacer"
          />
          <span>{{ item.label }}</span>
          <ChevronRight
            v-if="item.id === 'more'"
            class="menu-trailing"
            :size="13"
            aria-hidden="true"
          />
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style>
.vt-menu-content { min-width: 178px; }
.vt-menu-item { min-height: 34px; color: var(--vt-text-soft); font-size: 11px; }
.vt-menu-item.is-danger { color: var(--vt-danger); }
.menu-spacer { width: 14px; }
.menu-trailing { margin-left: auto; }
</style>
