<script setup lang="ts">
import { computed, ref } from 'vue'

import AssistantWorkspaceShell from '@/layouts/AssistantWorkspaceShell.vue'
import RoleConfigFeature from '@/features/assistants/RoleConfigFeature.vue'
import AssistantSummaryState from '@/features/assistants/AssistantSummaryState.vue'
import { useAssistantSummary } from '@/features/assistants/useAssistantSummary'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

const { assistant, assistantId, loading, loadState, loadError, reloadAssistant } = useAssistantSummary()
const revision = ref(0)
const dirty = ref(false)
const shellAssistant = computed(() => assistant.value ? { id: assistant.value.id, name: assistant.value.name, locale: assistant.value.locale, status: assistant.value.onlineDeviceCount > 0 ? 'online' : 'offline' } : undefined)

function updateRevision(value: number, isDirty: boolean) { revision.value = value; dirty.value = isDirty }
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
    section-title="Vai trò & giọng nói"
    section-description="Prompt, tính cách và giọng nói của trợ lý"
    :revision-label="`${dirty ? 'Chưa lưu · ' : ''}Bản nháp #${revision || '—'}`"
  >
    <RoleConfigFeature
      :assistant-id="assistantId"
      @revision="updateRevision"
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
