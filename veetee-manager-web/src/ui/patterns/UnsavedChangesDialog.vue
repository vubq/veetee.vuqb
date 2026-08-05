<script setup lang="ts">
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'

defineProps<{ open: boolean }>()
defineEmits<{
  stay: []
  leave: []
}>()
</script>

<template>
  <VtDialog
    :open="open"
    title="Bạn có thay đổi chưa lưu"
    description="Nếu rời trang lúc này, các thay đổi đang nhập sẽ bị bỏ."
    width="sm"
    @update:open="$event ? undefined : $emit('stay')"
  >
    <p class="unsaved-copy">
      Hãy lưu bản nháp trước khi chuyển sang màn hình khác, hoặc chọn rời trang để bỏ các thay đổi này.
    </p>
    <template #footer>
      <VtButton
        variant="ghost"
        @click="$emit('stay')"
      >
        Ở lại
      </VtButton>
      <VtButton
        variant="danger"
        @click="$emit('leave')"
      >
        Rời trang
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.unsaved-copy { margin: 0; color: var(--vt-text-muted); font-size: 12px; line-height: 1.55; }
</style>
