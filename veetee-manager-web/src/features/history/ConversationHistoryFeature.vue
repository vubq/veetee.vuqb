<script setup lang="ts">
import { History, RefreshCcw } from '@lucide/vue'
import { onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard, ConversationDetail, ConversationSummary, RetentionPolicy } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

const props = defineProps<{ assistant: AssistantCard }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const conversations = ref<ConversationSummary[]>([])
const retention = ref<RetentionPolicy>()
const selected = ref<ConversationDetail>()
const loading = ref(true)
const detailLoading = ref(false)

function formatTime(value: string | null) {
  if (!value) return 'Đang diễn ra'
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function statusLabel(status: ConversationSummary['status']) {
  return status === 'completed' ? 'Hoàn tất' : status === 'aborted' ? 'Đã dừng' : status === 'error' ? 'Lỗi' : 'Đang diễn ra'
}

async function load() {
  loading.value = true
  const [history, policy] = await Promise.all([gateway.listConversations(props.assistant.id), gateway.getRetentionPolicy()])
  if (history.ok) conversations.value = history.data.items
  if (policy.ok) retention.value = policy.data
  loading.value = false
}

async function openConversation(item: ConversationSummary) {
  detailLoading.value = true
  const result = await gateway.getConversation(item.id)
  if (result.ok) selected.value = result.data
  detailLoading.value = false
}

onMounted(load)
</script>

<template>
  <PreviewScenarioToolbar
    @change="load"
    @reset="load"
  />
  <div class="history-toolbar">
    <div><strong>Lịch sử hội thoại</strong><span>Transcript được lưu theo retention policy; audio recording đang tắt.</span></div>
    <VtButton
      size="sm"
      @click="load"
    >
      <template #leading>
        <VtIcon
          :icon="RefreshCcw"
          :size="14"
        />
      </template>Làm mới
    </VtButton>
  </div>

  <VtCard
    v-if="retention"
    class="retention-card"
  >
    <div>
      <VtStatus
        tone="online"
        label="Retention đang áp dụng"
      /><strong>{{ retention.captureTranscript ? `${retention.transcriptDays} ngày transcript` : 'Không lưu transcript' }}</strong>
    </div>
    <span>Audio: {{ retention.captureAudio ? 'đang bật' : 'tắt mặc định' }}</span>
  </VtCard>

  <div
    v-if="loading"
    class="history-list"
  >
    <VtCard
      v-for="index in 3"
      :key="index"
      class="history-skeleton"
    >
      <VtSkeleton width="180px" /><VtSkeleton width="120px" />
    </VtCard>
  </div>
  <VtEmptyState
    v-else-if="conversations.length === 0"
    :icon="History"
    title="Chưa có hội thoại"
    description="Các lượt nói qua Voice Server sẽ xuất hiện ở đây sau khi history ingest được bật."
  />
  <div
    v-else
    class="history-layout"
  >
    <div class="history-list">
      <VtCard
        v-for="item in conversations"
        :key="item.id"
        class="history-item"
        :class="{ selected: selected?.summary.id === item.id }"
        interactive
        role="button"
        tabindex="0"
        @click="openConversation(item)"
        @keydown.enter="openConversation(item)"
      >
        <header><div><strong>{{ formatTime(item.startedAt) }}</strong><span>{{ item.locale }}</span></div><VtBadge>{{ statusLabel(item.status) }}</VtBadge></header>
        <p>{{ item.turnCount }} lượt · TTFA {{ item.aggregateTimings.last_ttfa_ms ?? '—' }} ms</p>
      </VtCard>
    </div>
    <VtCard
      v-if="selected"
      class="history-detail"
    >
      <header><div><strong>Chi tiết lượt nói</strong><span>{{ formatTime(selected.summary.startedAt) }} → {{ formatTime(selected.summary.endedAt) }}</span></div><VtBadge>{{ selected.summary.configRevision }}</VtBadge></header>
      <div
        v-if="detailLoading"
        class="detail-loading"
      >
        <VtSkeleton height="70px" />
      </div>
      <ol
        v-else
        class="transcript"
      >
        <li
          v-for="(segment, index) in selected.turns.flatMap((turn) => turn.transcript)"
          :key="`${segment.speaker}-${index}`"
          :class="segment.speaker"
        >
          <span>{{ segment.speaker === 'user' ? 'Bạn' : segment.speaker === 'assistant' ? 'Veetee' : 'Hệ thống' }}</span><p>{{ segment.text }}</p>
        </li>
      </ol>
    </VtCard>
  </div>
</template>

<style scoped>
.history-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); padding: 10px 12px; }
.history-toolbar strong { display: block; font-size: 12px; }.history-toolbar span, .retention-card > span { color: var(--vt-text-muted); font-size: 9px; }
.retention-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 11px 13px; }.retention-card > div { display: flex; align-items: center; gap: 9px; }.retention-card strong { font-size: 10px; }
.history-layout { display: grid; grid-template-columns: minmax(220px, .75fr) minmax(0, 1.25fr); gap: 12px; }.history-list { display: grid; gap: 8px; }.history-item { cursor: pointer; padding: 12px; }.history-item.selected { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }.history-item header, .history-detail header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }.history-item header div, .history-detail header div { display: grid; gap: 3px; }.history-item strong, .history-detail strong { font-size: 11px; }.history-item span, .history-detail span { color: var(--vt-text-muted); font-size: 9px; }.history-item p { margin: 9px 0 0; color: var(--vt-text-soft); font-size: 9px; }.history-detail { min-height: 270px; padding: 14px; }.transcript { display: grid; gap: 9px; margin: 16px 0 0; padding: 0; list-style: none; }.transcript li { border: 1px solid var(--vt-border); border-radius: 7px; background: var(--vt-surface-subtle); padding: 9px 10px; }.transcript li.user { background: #f1f6fb; }.transcript span { font-size: 9px; font-weight: 700; }.transcript p { margin: 4px 0 0; color: var(--vt-text-soft); font-size: 10px; line-height: 1.5; }.history-skeleton { display: grid; gap: 8px; padding: 13px; }.detail-loading { margin-top: 16px; }
@media (max-width: 700px) { .history-layout { grid-template-columns: 1fr; }.retention-card, .history-toolbar { align-items: flex-start; flex-direction: column; }.history-toolbar .vt-button { width: 100%; } }
</style>
