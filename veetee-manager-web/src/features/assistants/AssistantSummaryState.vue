<script setup lang="ts">
import { FileQuestion, WifiOff } from '@lucide/vue'
import { nextTick, ref, watch } from 'vue'

import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

import type { AssistantSummaryLoadState } from './useAssistantSummary'

const props = defineProps<{
  state: AssistantSummaryLoadState
  errorMessage?: string
}>()
const emit = defineEmits<{ retry: [] }>()
const heading = ref<HTMLElement | null>(null)

watch(() => props.state, async () => {
  await nextTick()
  heading.value?.focus()
}, { immediate: true })
</script>

<template>
  <main
    v-if="state === 'loading'"
    id="main-content"
    class="page-container assistant-summary-state"
    aria-busy="true"
  >
    <VtSkeleton height="76px" />
    <div class="state-gap">
      <VtSkeleton height="230px" />
    </div>
  </main>
  <main
    v-else
    id="main-content"
    class="page-container assistant-summary-state"
  >
    <VtCard
      v-if="state === 'error' || state === 'offline'"
      class="summary-error"
      role="alert"
    >
      <span class="summary-state-icon"><VtIcon
        :icon="WifiOff"
        :size="20"
      /></span>
      <h1
        ref="heading"
        tabindex="-1"
      >
        {{ state === 'offline' ? 'Máy chủ quản trị đang ngoại tuyến' : 'Không tải được thông tin trợ lý' }}
      </h1>
      <p>{{ errorMessage }}</p>
      <VtButton
        variant="secondary"
        @click="emit('retry')"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <VtEmptyState
      v-else-if="state === 'not-found'"
      :icon="FileQuestion"
      title="Không tìm thấy trợ lý"
      :description="errorMessage || 'Trợ lý không tồn tại hoặc đã bị xóa.'"
    >
      <RouterLink to="/assistants">
        <VtButton variant="primary">
          Về danh sách trợ lý
        </VtButton>
      </RouterLink>
    </VtEmptyState>
    <div
      v-else
      aria-hidden="true"
    />
  </main>
</template>

<style scoped>
.assistant-summary-state { display: grid; align-content: start; }
.state-gap { margin-top: 14px; }
.summary-error { display: grid; justify-items: center; gap: 5px; padding: 28px; text-align: center; }
.summary-state-icon { display: inline-grid; width: 42px; height: 42px; place-items: center; border-radius: 8px; background: rgba(214, 69, 80, 0.08); color: var(--vt-danger); }
.summary-error h1 { margin: 5px 0 0; color: var(--vt-text); font-size: 15px; }
.summary-error p { max-width: 460px; margin: 2px auto 9px; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
.summary-error h1:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
</style>
