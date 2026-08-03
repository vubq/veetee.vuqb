<script setup lang="ts">
import { computed, ref } from 'vue'

import { useAssistantSummary } from '@/features/assistants/useAssistantSummary'
import ModelMemoryFeature from '@/features/providers/ModelMemoryFeature.vue'
import AssistantWorkspaceShell from '@/layouts/AssistantWorkspaceShell.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

const { assistant, assistantId, loading } = useAssistantSummary()
const revision = ref(0)
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
    v-else-if="shellAssistant"
    :assistant="shellAssistant"
    section-title="Mô hình & bộ nhớ"
    section-description="Provider selection và memory policy"
    :revision-label="`Revision #${revision || '—'}`"
  >
    <ModelMemoryFeature
      :assistant-id="assistantId"
      @revision="revision = $event"
    />
  </AssistantWorkspaceShell>
  <main
    v-else
    id="main-content"
    class="page-container"
  >
    <p>Không tìm thấy trợ lý.</p>
  </main>
</template>
<style scoped>.view-gap { margin-top: 14px; }</style>

