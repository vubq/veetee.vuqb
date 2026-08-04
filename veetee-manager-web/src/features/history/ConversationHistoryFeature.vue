<script setup lang="ts">
import { History, RefreshCcw, WifiOff } from '@lucide/vue'
import { nextTick, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard, ConversationDetail, ConversationSummary, RetentionPolicy, RetentionPolicyInput } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import { notify } from '@/ui/primitives/notifications'

import ConversationExportButton from './ConversationExportButton.vue'
import ConversationDeleteDialog from './ConversationDeleteDialog.vue'
import RetentionPolicyPanel from './RetentionPolicyPanel.vue'
import { downloadJsonFile } from './conversation-export'

const props = defineProps<{ assistant: AssistantCard }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')
const conversations = ref<ConversationSummary[]>([])
const retention = ref<RetentionPolicy>()
const retentionSaving = ref(false)
const retentionSaveError = ref('')
const selected = ref<ConversationDetail>()
const selectedItem = ref<ConversationSummary>()
const exporting = ref(false)
const deleteDialogOpen = ref(false)
const deleting = ref(false)
const deleteError = ref('')
const exportError = ref('')
const loading = ref(true)
const stale = ref(false)
const detailLoading = ref(false)
const loadState = ref<'loading' | 'ready' | 'empty' | 'error' | 'offline'>('loading')
const loadError = ref('')
const detailState = ref<'idle' | 'loading' | 'ready' | 'error' | 'offline'>('idle')
const detailError = ref('')
const listStateHeading = ref<HTMLElement | null>(null)
const detailStateHeading = ref<HTMLElement | null>(null)
const exportErrorHeading = ref<HTMLElement | null>(null)
let loadGeneration = 0
let detailGeneration = 0

function formatTime(value: string | null) {
  if (!value) return 'Đang diễn ra'
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function statusLabel(status: ConversationSummary['status']) {
  return status === 'completed' ? 'Hoàn tất' : status === 'aborted' ? 'Đã dừng' : status === 'error' ? 'Lỗi' : 'Đang diễn ra'
}

async function load() {
  const generation = ++loadGeneration
  detailGeneration += 1
  loading.value = true
  stale.value = false
  detailLoading.value = false
  selected.value = undefined
  selectedItem.value = undefined
  exportError.value = ''
  detailState.value = 'idle'
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const [history, policy] = await Promise.all([
      gateway.listConversations(props.assistant.id),
      gateway.getRetentionPolicy(),
    ])
    if (generation !== loadGeneration) return
    if (!history.ok || !policy.ok) {
      const offline = history.meta.offline || policy.meta.offline
      loadState.value = offline ? 'offline' : 'error'
      loadError.value = !history.ok && !policy.ok
        ? 'Không tải được lịch sử và retention policy từ Manager API.'
        : !history.ok
          ? 'Không tải được lịch sử hội thoại từ Manager API.'
          : 'Không tải được retention policy; lịch sử tạm thời bị khóa để tránh hiểu sai chính sách lưu trữ.'
      await focusListState()
      return
    }
    conversations.value = history.data.items
    retention.value = policy.data
    stale.value = history.meta.freshness === 'stale' || policy.meta.freshness === 'stale' || history.meta.offline || policy.meta.offline
    loadState.value = conversations.value.length > 0 ? 'ready' : 'empty'
  } catch {
    if (generation !== loadGeneration) return
    loadState.value = 'offline'
    stale.value = false
    loadError.value = 'Không kết nối được Manager API. Kiểm tra service hoặc mạng LAN.'
    await focusListState()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function openConversation(item: ConversationSummary) {
  const generation = ++detailGeneration
  selectedItem.value = item
  selected.value = undefined
  exportError.value = ''
  detailLoading.value = true
  detailState.value = 'loading'
  detailError.value = ''
  try {
    const result = await gateway.getConversation(item.id)
    if (generation !== detailGeneration) return
    if (result.ok) {
      selected.value = result.data
      detailState.value = 'ready'
      return
    }
    detailState.value = result.meta.offline ? 'offline' : 'error'
    detailError.value = result.meta.offline
      ? 'Đang ngoại tuyến; chưa thể tải chi tiết lượt nói.'
      : 'Không tải được chi tiết lượt nói từ Manager API.'
    await focusDetailState()
  } catch {
    if (generation !== detailGeneration) return
    detailState.value = 'offline'
    detailError.value = 'Không kết nối được Manager API; hãy thử lại sau.'
    await focusDetailState()
  } finally {
    if (generation === detailGeneration) detailLoading.value = false
  }
}

async function exportSelectedConversation() {
  const conversation = selected.value
  if (!conversation || exporting.value) return
  exporting.value = true
  exportError.value = ''
  try {
    const result = await gateway.exportConversation(conversation.summary.id)
    if (!result.ok) {
      exportError.value = result.meta.offline
        ? 'Đang ngoại tuyến; chưa thể tải bản export.'
        : 'Không tải được bản export của conversation.'
      await focusExportError()
      return
    }
    downloadJsonFile(result.data, `veetee-conversation-${conversation.summary.id}.json`)
    notify('Đã tải conversation export', { tone: 'success', message: 'File JSON chỉ chứa các trường được phép export.' })
  } catch {
    exportError.value = 'Trình duyệt không thể tạo file export; dữ liệu gốc vẫn giữ nguyên.'
    await focusExportError()
  } finally {
    exporting.value = false
  }
}

function openDeleteDialog() {
  if (selectedItem.value) {
    deleteError.value = ''
    deleteDialogOpen.value = true
  }
}

async function deleteSelectedConversation() {
  const item = selectedItem.value
  if (!item || deleting.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    const result = await gateway.deleteConversation(item.id)
    if (!result.ok) {
      deleteError.value = result.meta.offline
        ? 'Đang ngoại tuyến; conversation chưa được xóa.'
        : result.problem.code === 'RETENTION_EXPIRED'
          ? 'Conversation đã được xóa hoặc hết retention.'
          : 'Không thể tạo delete job cho conversation này.'
      return
    }
    let job = result.data
    for (let attempt = 0; attempt < 20 && job.status !== 'completed' && job.status !== 'failed'; attempt += 1) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250))
      const status = await gateway.getRetentionDeleteJob(job.id)
      if (!status.ok) {
        deleteError.value = status.meta.offline ? 'Đang ngoại tuyến; chưa thể kiểm tra delete job.' : 'Không đọc được trạng thái delete job.'
        return
      }
      job = status.data
    }
    if (job.status !== 'completed') {
      deleteError.value = job.errorCode ? `Delete job kết thúc với lỗi ${job.errorCode}.` : 'Delete job chưa hoàn tất; hãy thử lại sau.'
      return
    }
    conversations.value = conversations.value.filter((conversation) => conversation.id !== item.id)
    loadState.value = conversations.value.length > 0 ? 'ready' : 'empty'
    selected.value = undefined
    selectedItem.value = undefined
    deleteDialogOpen.value = false
    notify('Đã xóa conversation', { tone: 'success', message: 'Transcript và metadata đã được đưa qua delete job.' })
  } catch {
    deleteError.value = 'Không kết nối được Manager API; conversation vẫn giữ nguyên.'
  } finally {
    deleting.value = false
  }
}

async function saveRetentionPolicy(input: RetentionPolicyInput) {
  const current = retention.value
  if (!current) return
  retentionSaving.value = true
  retentionSaveError.value = ''
  try {
    const result = await gateway.updateRetentionPolicy(input, current.etag)
    if (result.ok) {
      retention.value = result.data
      notify('Đã lưu retention policy', { tone: 'success', message: `Revision ${result.data.revision} đã được áp dụng cho các lượt mới.` })
      return
    }
    retentionSaveError.value = result.meta.offline
      ? 'Đang ngoại tuyến; retention policy chưa được thay đổi.'
      : result.problem.type === 'revision-conflict'
        ? 'Retention policy đã thay đổi ở nơi khác; hãy tải lại trước khi lưu.'
        : 'Không thể lưu retention policy; kiểm tra lại dữ liệu và thử lại.'
    notify('Không thể lưu retention policy', { tone: 'error', message: retentionSaveError.value, assertive: true })
  } catch {
    retentionSaveError.value = 'Không kết nối được Manager API; retention policy vẫn giữ nguyên.'
    notify('Không thể lưu retention policy', { tone: 'error', message: retentionSaveError.value, assertive: true })
  } finally {
    retentionSaving.value = false
  }
}

async function focusListState() {
  await nextTick()
  listStateHeading.value?.focus()
}

async function focusDetailState() {
  await nextTick()
  detailStateHeading.value?.focus()
}

async function focusExportError() {
  await nextTick()
  exportErrorHeading.value?.focus()
}

onMounted(load)
</script>

<template>
  <section
    class="history-feature"
    :aria-busy="loading"
  >
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
    <div
      v-if="stale"
      class="offline-banner"
      role="status"
    >
      <VtIcon
        :icon="WifiOff"
        :size="15"
      />
      <span><strong>Dữ liệu ngoại tuyến</strong> — đang xem snapshot retention/lịch sử cũ; thay đổi sẽ bị chặn cho tới khi đồng bộ lại.</span>
    </div>

    <RetentionPolicyPanel
      v-if="retention && (loadState === 'ready' || loadState === 'empty')"
      :policy="retention"
      :saving="retentionSaving"
      :error="retentionSaveError"
      @save="saveRetentionPolicy"
    />

    <div
      v-if="loadState === 'loading'"
      class="history-list"
      role="status"
      aria-live="polite"
      aria-label="Đang tải lịch sử hội thoại"
    >
      <VtCard
        v-for="index in 3"
        :key="index"
        class="history-skeleton"
      >
        <VtSkeleton width="180px" /><VtSkeleton width="120px" />
      </VtCard>
    </div>
    <VtCard
      v-else-if="loadState === 'error' || loadState === 'offline'"
      class="history-state history-state-error"
      role="alert"
    >
      <h2
        ref="listStateHeading"
        tabindex="-1"
      >
        {{ loadState === 'offline' ? 'Manager API đang ngoại tuyến' : 'Không tải được lịch sử' }}
      </h2>
      <p>{{ loadError }}</p>
      <VtButton
        variant="secondary"
        :loading="loading"
        @click="load"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <VtEmptyState
      v-else-if="loadState === 'empty'"
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
          :class="{ selected: selectedItem?.id === item.id }"
          interactive
          role="button"
          tabindex="0"
          :aria-pressed="selectedItem?.id === item.id"
          @click="openConversation(item)"
          @keydown.enter="openConversation(item)"
          @keydown.space.prevent="openConversation(item)"
        >
          <header><div><strong>{{ formatTime(item.startedAt) }}</strong><span>{{ item.locale }}</span></div><VtBadge>{{ statusLabel(item.status) }}</VtBadge></header>
          <p>{{ item.turnCount }} lượt · TTFA {{ item.aggregateTimings.last_ttfa_ms ?? '—' }} ms</p>
        </VtCard>
      </div>
      <VtCard
        v-if="selectedItem"
        class="history-detail"
      >
        <header>
          <div>
            <strong
              ref="detailStateHeading"
              tabindex="-1"
            >Chi tiết lượt nói</strong><span>{{ formatTime(selectedItem.startedAt) }} → {{ formatTime(selectedItem.endedAt) }}</span>
          </div>
          <div class="detail-actions">
            <VtBadge>{{ selectedItem.configRevision }}</VtBadge>
            <ConversationExportButton
              v-if="detailState === 'ready'"
              :loading="exporting"
              @click="exportSelectedConversation"
            />
            <VtButton
              v-if="detailState === 'ready'"
              size="sm"
              variant="danger"
              :disabled="deleting"
              @click="openDeleteDialog"
            >
              Xóa
            </VtButton>
          </div>
        </header>
        <p
          v-if="exportError"
          ref="exportErrorHeading"
          class="export-error"
          role="alert"
          tabindex="-1"
        >
          {{ exportError }}
        </p>
        <div
          v-if="detailLoading"
          class="detail-loading"
          role="status"
          aria-live="polite"
          aria-label="Đang tải chi tiết hội thoại"
        >
          <VtSkeleton height="70px" />
        </div>
        <div
          v-else-if="detailState === 'error' || detailState === 'offline'"
          class="detail-state"
          role="alert"
        >
          <p>{{ detailError }}</p>
          <VtButton
            size="sm"
            variant="secondary"
            @click="openConversation(selectedItem!)"
          >
            Thử lại chi tiết
          </VtButton>
        </div>
        <ol
          v-else-if="selected"
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
    <ConversationDeleteDialog
      v-model:open="deleteDialogOpen"
      :conversation="selectedItem"
      :loading="deleting"
      :error="deleteError"
      @confirm="deleteSelectedConversation"
    />
  </section>
</template>

<style scoped>
.history-feature { display: grid; gap: 12px; }
.history-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); padding: 10px 12px; }
.history-toolbar strong { display: block; font-size: 12px; }.history-toolbar span { color: var(--vt-text-muted); font-size: 9px; }
.offline-banner { display: flex; align-items: center; gap: 8px; border: 1px solid #efd39e; border-radius: var(--vt-radius-section); background: var(--vt-warning-soft); color: var(--vt-warning); padding: 9px 11px; font-size: 10px; line-height: 1.45; }.offline-banner strong { font-weight: 700; }
.history-layout { display: grid; grid-template-columns: minmax(220px, .75fr) minmax(0, 1.25fr); gap: 12px; }.history-list { display: grid; gap: 8px; }.history-item { cursor: pointer; padding: 12px; }.history-item.selected { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }.history-item header, .history-detail header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }.history-item header div, .history-detail header div { display: grid; gap: 3px; }.history-detail .detail-actions { display: flex; align-items: center; gap: 7px; }.history-item strong, .history-detail strong { font-size: 11px; }.history-item span, .history-detail span { color: var(--vt-text-muted); font-size: 9px; }.history-item p { margin: 9px 0 0; color: var(--vt-text-soft); font-size: 9px; }.history-detail { min-height: 270px; padding: 14px; }.export-error { margin: 12px 0 0; border: 1px solid rgba(214, 69, 80, .28); border-radius: var(--vt-radius-control); background: rgba(214, 69, 80, .06); color: var(--vt-danger); padding: 8px 9px; font-size: 10px; line-height: 1.45; }.export-error:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); }.transcript { display: grid; gap: 9px; margin: 16px 0 0; padding: 0; list-style: none; }.transcript li { border: 1px solid var(--vt-border); border-radius: 7px; background: var(--vt-surface-subtle); padding: 9px 10px; }.transcript li.user { background: #f1f6fb; }.transcript span { font-size: 9px; font-weight: 700; }.transcript p { margin: 4px 0 0; color: var(--vt-text-soft); font-size: 10px; line-height: 1.5; }.history-skeleton { display: grid; gap: 8px; padding: 13px; }.detail-loading { margin-top: 16px; }
.history-state { display: grid; justify-items: center; gap: 4px; color: var(--vt-text-muted); padding: 24px; text-align: center; }
.history-state h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.history-state p { max-width: 460px; margin: 3px auto 10px; font-size: 11px; line-height: 1.5; }
.history-state h2:focus-visible, .history-detail strong:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.detail-state { display: grid; justify-items: start; gap: 6px; margin-top: 16px; color: var(--vt-danger); font-size: 11px; line-height: 1.5; }
.detail-state p { margin: 0; }
@media (max-width: 700px) { .history-layout { grid-template-columns: 1fr; }.history-toolbar { align-items: flex-start; flex-direction: column; }.history-toolbar .vt-button { width: 100%; } }
</style>
