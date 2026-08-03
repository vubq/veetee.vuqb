<script setup lang="ts">
import { Copy, RefreshCcw } from '@lucide/vue'

import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

defineProps<{ open: boolean; currentRevision: number; copying?: boolean }>()
defineEmits<{ 'update:open': [value: boolean]; reload: []; copy: []; cancel: [] }>()
</script>

<template>
  <VtDialog
    :open="open"
    title="Cấu hình đã thay đổi ở nơi khác"
    :description="`Server đang có revision #${currentRevision}. Veetee không tự merge hoặc ghi đè draft của bạn.`"
    width="md"
    @update:open="$emit('update:open', $event)"
  >
    <div class="conflict-body">
      <p>Chọn rõ cách khôi phục:</p>
      <ul><li><strong>Tải revision mới:</strong> bỏ draft local và dùng bản mới nhất.</li><li><strong>Sao chép draft rồi tải lại:</strong> copy JSON draft vào clipboard trước khi dùng bản mới.</li><li><strong>Hủy:</strong> đóng hộp thoại và giữ nguyên draft để bạn xem lại.</li></ul>
    </div>
    <template #footer>
      <VtButton @click="$emit('cancel'); $emit('update:open', false)">
        Giữ draft
      </VtButton>
      <VtButton
        :loading="copying"
        @click="$emit('copy')"
      >
        <template #leading>
          <VtIcon
            :icon="Copy"
            :size="14"
          />
        </template>Sao chép rồi tải lại
      </VtButton>
      <VtButton
        variant="primary"
        @click="$emit('reload')"
      >
        <template #leading>
          <VtIcon
            :icon="RefreshCcw"
            :size="14"
          />
        </template>Tải revision mới
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.conflict-body { color: var(--vt-text-soft); font-size: 12px; line-height: 1.65; }
.conflict-body p { margin: 0 0 8px; }
.conflict-body ul { display: grid; gap: 6px; margin: 0; padding-left: 18px; }
.conflict-body strong { color: var(--vt-text); font-weight: 600; }
</style>

