<script setup lang="ts">
import { computed } from 'vue'

import { useAssistantSummary } from '@/features/assistants/useAssistantSummary'
import DeviceListFeature from '@/features/devices/DeviceListFeature.vue'
import AssistantWorkspaceShell from '@/layouts/AssistantWorkspaceShell.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

const { assistant, loading, reloadAssistant } = useAssistantSummary()
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
    v-else-if="shellAssistant && assistant"
    :assistant="shellAssistant"
    section-title="Thiết bị"
    section-description="Ghép nối và theo dõi trạng thái robot"
    :revision-label="`${assistant.deviceCount} thiết bị`"
  >
    <DeviceListFeature
      :assistant="assistant"
      @changed="reloadAssistant"
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
