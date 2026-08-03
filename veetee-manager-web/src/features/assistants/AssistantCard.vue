<script setup lang="ts">
import { Bot, BrainCircuit, Cpu, MessageSquareText, Settings2, UserRound } from '@lucide/vue'

import type { AssistantCard } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

defineProps<{ assistant: AssistantCard }>()
defineEmits<{ pair: [assistant: AssistantCard] }>()

function relativeTime(value: string | null) {
  if (!value) return 'Chưa có'
  const date = new Date(value)
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<template>
  <VtCard
    class="assistant-card"
    interactive
    :padding="false"
  >
    <header class="card-header">
      <span class="assistant-avatar"><VtIcon
        :icon="Bot"
        :size="20"
      /></span>
      <div class="assistant-name">
        <h2>{{ assistant.name }}</h2>
        <VtStatus
          :tone="assistant.onlineDeviceCount > 0 ? 'online' : 'neutral'"
          :label="assistant.onlineDeviceCount > 0 ? `${assistant.onlineDeviceCount} thiết bị trực tuyến` : 'Không có thiết bị trực tuyến'"
        />
      </div>
      <span class="revision">{{ assistant.configurationState === 'published' ? `Bản #${assistant.publishedRevision}` : 'Bản nháp' }}</span>
    </header>

    <div class="metric-strip">
      <div class="metric">
        <span><VtIcon
          :icon="UserRound"
          :size="13"
        /> Tính cách</span><strong :title="assistant.personalityName">{{ assistant.personalityName }}</strong>
      </div>
      <div class="metric">
        <span><VtIcon
          :icon="BrainCircuit"
          :size="13"
        /> Giọng nói</span><strong>{{ assistant.voiceName }}</strong>
      </div>
      <div class="metric">
        <span><VtIcon
          :icon="MessageSquareText"
          :size="13"
        /> Gần nhất</span><strong>{{ relativeTime(assistant.lastConversationAt) }}</strong>
      </div>
    </div>

    <footer class="card-actions">
      <RouterLink :to="{ name: 'assistant-role', params: { id: assistant.id } }">
        <VtButton
          block
          size="sm"
        >
          <template #leading>
            <VtIcon
              :icon="Settings2"
              :size="14"
            />
          </template>Cấu hình
        </VtButton>
      </RouterLink>
      <RouterLink :to="{ name: 'assistant-devices', params: { id: assistant.id } }">
        <VtButton
          block
          size="sm"
        >
          <template #leading>
            <VtIcon
              :icon="Cpu"
              :size="14"
            />
          </template>Thiết bị ({{ assistant.deviceCount }})
        </VtButton>
      </RouterLink>
      <VtButton
        block
        size="sm"
        @click="$emit('pair', assistant)"
      >
        <template #leading>
          <VtIcon
            :icon="Cpu"
            :size="14"
          />
        </template>Ghép nối
      </VtButton>
    </footer>
  </VtCard>
</template>

<style scoped>
.assistant-card { overflow: hidden; }
.card-header { display: flex; min-height: 72px; align-items: center; gap: 10px; padding: 13px 14px; }
.assistant-avatar { display: inline-grid; width: 40px; height: 40px; flex: none; place-items: center; border: 1px solid #d9cbf8; border-radius: 9px; background: #f2ecff; color: #6c42bf; }
.assistant-name { min-width: 0; flex: 1; }
.assistant-name h2 { margin: 0 0 3px; overflow: hidden; font-size: 13px; font-weight: 650; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.revision { flex: none; border-radius: 4px; background: var(--vt-surface-muted); color: var(--vt-text-muted); padding: 3px 6px; font-size: 9px; }
.metric-strip { display: grid; height: 73px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0 13px 13px; overflow: hidden; border: 1px solid var(--vt-border); border-radius: 7px; background: #f8fbfd; }
.metric { min-width: 0; padding: 11px 9px; }
.metric + .metric { border-left: 1px solid var(--vt-border); }
.metric span { display: flex; align-items: center; gap: 5px; overflow: hidden; color: var(--vt-text-muted); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.metric strong { display: block; margin-top: 6px; overflow: hidden; color: var(--vt-text-soft); font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.card-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 7px; border-top: 1px solid var(--vt-border); padding: 10px 11px; }
.card-actions a { min-width: 0; text-decoration: none; }
@media (max-width: 420px) {
  .card-actions { grid-template-columns: 1fr 1fr; }
  .card-actions > :last-child { grid-column: 1 / -1; }
}
</style>

