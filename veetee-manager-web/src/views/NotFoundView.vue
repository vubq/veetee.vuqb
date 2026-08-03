<script setup lang="ts">
import { FileQuestion } from '@lucide/vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
</script>
<template>
  <main
    id="main-content"
    class="page-container"
  >
    <VtEmptyState
      :icon="FileQuestion"
      title="Không tìm thấy trang"
      description="Đường dẫn này không thuộc bản xem trước giao diện."
    >
      <RouterLink to="/assistants">
        <VtButton variant="primary">
          Về danh sách trợ lý
        </VtButton>
      </RouterLink>
    </VtEmptyState>
  </main>
</template>

