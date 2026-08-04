<script setup lang="ts">
import type { ConversationSummary } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'

defineProps<{
  open: boolean
  conversation?: ConversationSummary
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()
</script>

<template>
  <VtDialog
    :open="open"
    title="Xóa conversation"
    description="Xóa transcript và metadata của conversation này khỏi Manager."
    width="sm"
    :prevent-close="loading"
    @update:open="emit('update:open', $event)"
  >
    <div
      class="delete-body"
      :aria-busy="loading || undefined"
    >
      <dl
        v-if="conversation"
        class="delete-summary"
      >
        <div>
          <dt>Bắt đầu</dt>
          <dd>{{ conversation.startedAt }}</dd>
        </div>
        <div>
          <dt>Số lượt</dt>
          <dd>{{ conversation.turnCount }}</dd>
        </div>
      </dl>
      <p class="delete-warning">
        Thao tác không thể hoàn tác. Audio recording đang tắt ở baseline; mọi dữ liệu transcript/tool hiện có sẽ được dọn bởi delete job.
      </p>
      <p
        v-if="error"
        class="delete-error"
        role="alert"
        aria-live="assertive"
      >
        {{ error }}
      </p>
    </div>
    <template #footer>
      <VtButton
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        Hủy
      </VtButton>
      <VtButton
        variant="danger"
        :loading="loading"
        @click="emit('confirm')"
      >
        Xóa conversation
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.delete-body { display: grid; gap: 12px; color: var(--vt-text-soft); font-size: 12px; line-height: 1.55; }
.delete-summary { display: grid; gap: 7px; margin: 0; border: 1px solid var(--vt-border); border-radius: 7px; background: var(--vt-surface-subtle); padding: 10px 11px; }
.delete-summary div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.delete-summary dt { color: var(--vt-text-muted); font-size: 10px; }
.delete-summary dd { min-width: 0; margin: 0; overflow: hidden; color: var(--vt-text); font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.delete-warning { margin: 0; }
.delete-error { margin: 0; border: 1px solid var(--vt-danger); border-radius: 6px; background: var(--vt-danger-soft); color: var(--vt-danger); padding: 8px 10px; }
</style>
