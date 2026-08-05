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
    description="Cấu hình đã được cập nhật ở nơi khác. Thay đổi của bạn vẫn được giữ nguyên để không bị mất."
    width="md"
    @update:open="$emit('update:open', $event)"
  >
    <div class="conflict-body">
      <p>Chọn cách bạn muốn tiếp tục:</p>
      <ul><li><strong>Dùng bản mới:</strong> bỏ thay đổi hiện tại và lấy cấu hình mới nhất.</li><li><strong>Sao chép thay đổi rồi tải lại:</strong> lưu lại nội dung đang sửa trước khi dùng bản mới.</li><li><strong>Giữ lại thay đổi:</strong> đóng hộp thoại để bạn xem lại trước khi quyết định.</li></ul>
    </div>
    <template #footer>
      <VtButton @click="$emit('cancel'); $emit('update:open', false)">
        Giữ lại thay đổi
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
        </template>Dùng bản mới
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
