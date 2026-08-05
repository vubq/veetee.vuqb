<script setup lang="ts">
import { computed } from 'vue'

import { useAssistantSummary } from '@/features/assistants/useAssistantSummary'
import AssistantSummaryState from '@/features/assistants/AssistantSummaryState.vue'
import ModelMemoryFeature from '@/features/providers/ModelMemoryFeature.vue'
import AssistantWorkspaceShell from '@/layouts/AssistantWorkspaceShell.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

const { assistant, assistantId, loading, loadState, loadError, reloadAssistant } = useAssistantSummary()
const shellAssistant = computed(() => assistant.value ? { id: assistant.value.id, name: assistant.value.name, locale: assistant.value.locale, status: assistant.value.onlineDeviceCount > 0 ? 'online' : 'offline' } : undefined)
</script>

<template>
  <main
    v-if="loading"
    id="main-content"
    class="page-container"
  >
    <VtSkeleton height="76px" /><div class="view-gap">
      <VtSkeleton height="520px" />
    </div>
  </main>
  <AssistantWorkspaceShell
    v-else-if="loadState === 'ready' && shellAssistant"
    :assistant="shellAssistant"
    section-title="Mô hình & bộ nhớ"
    section-description="Chọn cách trợ lý nghe, hiểu, trả lời và ghi nhớ"
    revision-label="Đã lưu"
  >
    <ModelMemoryFeature
      :assistant-id="assistantId"
      @revision="void $event"
    />
  </AssistantWorkspaceShell>
  <AssistantSummaryState
    v-else
    :state="loadState"
    :error-message="loadError"
    @retry="reloadAssistant"
  />
</template>
<style scoped>.view-gap { margin-top: 14px; }</style>
