<script setup lang="ts">
import { KeyRound, ShieldCheck } from '@lucide/vue'

import type { ModelProviderField } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

import { formatFieldType, localizedFieldLabel } from './model-registry-labels'

const props = withDefaults(defineProps<{
  fields: ModelProviderField[]
  open?: boolean
  title?: string
}>(), { open: false, title: 'Trường cấu hình' })

const emit = defineEmits<{ 'update:open': [value: boolean] }>()
</script>

<template>
  <VtDialog
    :open="props.open"
    :title="props.title"
    description="Schema này quyết định các trường xuất hiện khi tạo model. Giá trị bí mật chỉ được lưu dưới dạng tham chiếu an toàn."
    width="md"
    @update:open="emit('update:open', $event)"
  >
    <div class="field-inspector">
      <div
        v-if="fields.length === 0"
        class="field-empty"
      >
        Provider này không yêu cầu trường cấu hình.
      </div>
      <div
        v-for="field in fields"
        :key="field.key"
        class="field-row"
      >
        <span class="field-icon"><VtIcon
          :icon="field.sensitive ? ShieldCheck : KeyRound"
          :size="15"
        /></span>
        <span class="field-copy">
          <strong>{{ localizedFieldLabel(field) }}</strong>
          <small><code>{{ field.key }}</code> · {{ formatFieldType(field.type) }}</small>
        </span>
        <VtBadge
          v-if="field.sensitive"
          tone="warning"
        >
          Bí mật
        </VtBadge>
        <VtBadge
          v-else-if="field.default !== undefined"
          tone="neutral"
        >
          Có mặc định
        </VtBadge>
      </div>
    </div>
    <template #footer>
      <VtButton @click="emit('update:open', false)">
        Đóng
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.field-inspector { display: grid; gap: 6px; }
.field-row { display: flex; min-width: 0; align-items: center; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 9px 10px; }
.field-icon { display: inline-grid; width: 28px; height: 28px; flex: none; place-items: center; border-radius: 6px; background: var(--vt-primary-soft); color: var(--vt-primary); }
.field-copy { display: grid; min-width: 0; flex: 1; gap: 2px; }
.field-copy strong { overflow: hidden; color: var(--vt-text); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.field-copy small { overflow: hidden; color: var(--vt-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.field-copy code { color: var(--vt-primary-text); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.field-empty { border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 24px; text-align: center; }
</style>
