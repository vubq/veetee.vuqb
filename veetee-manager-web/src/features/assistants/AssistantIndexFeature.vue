<script setup lang="ts">
import { LayoutGrid, Plus, Search, WifiOff } from '@lucide/vue'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard as Assistant } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import PairDeviceDialog from '@/features/devices/PairDeviceDialog.vue'
import PageHeader from '@/ui/patterns/PageHeader.vue'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'

import AssistantCard from './AssistantCard.vue'
import AssistantCreateDialog from './AssistantCreateDialog.vue'

const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const assistants = ref<Assistant[]>([])
const search = ref('')
const loading = ref(true)
const stale = ref(false)
const createOpen = ref(false)
const pairOpen = ref(false)
const pairAssistantId = ref<string>()
const loadState = ref<'loading' | 'ready' | 'empty' | 'error' | 'offline'>('loading')
const loadError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
let searchTimer: number | undefined
let loadGeneration = 0

async function loadAssistants() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const result = await gateway.listAssistants({ search: search.value })
    if (generation !== loadGeneration) return
    if (!result.ok) {
      stale.value = false
      loadState.value = result.meta.offline ? 'offline' : 'error'
      loadError.value = result.meta.offline
        ? 'Đang ngoại tuyến; chưa thể đồng bộ danh sách trợ lý.'
        : 'Không tải được danh sách trợ lý từ Manager API.'
      await focusStateHeading()
      return
    }
    assistants.value = result.data.items
    stale.value = result.meta.freshness === 'stale' || result.meta.offline
    loadState.value = assistants.value.length > 0 ? 'ready' : 'empty'
  } catch {
    if (generation !== loadGeneration) return
    stale.value = false
    loadState.value = 'offline'
    loadError.value = 'Không kết nối được Manager API. Kiểm tra service hoặc mạng LAN.'
    await focusStateHeading()
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

async function focusStateHeading() {
  await nextTick()
  stateHeading.value?.focus()
}

function openPair(assistant?: Assistant) {
  pairAssistantId.value = assistant?.id
  pairOpen.value = true
}

function onCreated(assistant: Assistant) {
  assistants.value = [...assistants.value, assistant]
  loadState.value = 'ready'
}

watch(search, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadAssistants(), 160)
})

onMounted(loadAssistants)
onUnmounted(() => {
  if (searchTimer) window.clearTimeout(searchTimer)
})
</script>

<template>
  <section
    class="assistant-index"
    :aria-busy="loading"
  >
    <PreviewScenarioToolbar
      @change="loadAssistants"
      @reset="loadAssistants"
    />
    <PageHeader
      title="Trợ lý"
      :subtitle="`${assistants.length} trợ lý trong bản xem trước`"
      :icon="LayoutGrid"
    >
      <template #actions>
        <div class="search-control">
          <VtInput
            v-model="search"
            :icon="Search"
            name="assistant-search"
            autocomplete="off"
            aria-label="Tìm trợ lý"
            placeholder="Tìm theo tên hoặc ngôn ngữ…"
          />
        </div>
        <div class="header-actions">
          <VtButton @click="openPair()">
            Ghép nối thiết bị
          </VtButton>
          <VtButton
            variant="primary"
            @click="createOpen = true"
          >
            <template #leading>
              <VtIcon
                :icon="Plus"
                :size="15"
              />
            </template>Tạo trợ lý
          </VtButton>
        </div>
      </template>
    </PageHeader>

    <div
      v-if="stale"
      class="offline-banner"
      role="status"
    >
      <VtIcon
        :icon="WifiOff"
        :size="16"
      /><span><strong>Dữ liệu ngoại tuyến</strong> — bạn vẫn có thể xem snapshot cũ; mutation sẽ bị chặn.</span>
    </div>

    <div
      v-if="loadState === 'loading'"
      class="assistant-grid"
      role="status"
      aria-live="polite"
      aria-label="Đang tải trợ lý"
    >
      <div
        v-for="index in 3"
        :key="index"
        class="assistant-skeleton"
      >
        <div class="skeleton-heading">
          <VtSkeleton
            width="40px"
            height="40px"
          /><div>
            <VtSkeleton
              width="120px"
              height="12px"
            /><VtSkeleton
              width="90px"
              height="9px"
            />
          </div>
        </div><VtSkeleton height="73px" /><VtSkeleton height="36px" />
      </div>
    </div>
    <VtCard
      v-else-if="loadState === 'error' || loadState === 'offline'"
      class="assistant-state assistant-state-error"
      role="alert"
    >
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        {{ loadState === 'offline' ? 'Manager API đang ngoại tuyến' : 'Không tải được danh sách trợ lý' }}
      </h2>
      <p>{{ loadError }}</p>
      <VtButton
        variant="secondary"
        :loading="loading"
        @click="loadAssistants"
      >
        Thử lại
      </VtButton>
    </VtCard>
    <VtEmptyState
      v-else-if="loadState === 'empty'"
      :icon="Search"
      :title="search ? 'Không tìm thấy trợ lý' : 'Chưa có trợ lý'"
      :description="search ? `Không có kết quả phù hợp với “${search}”.` : 'Tạo trợ lý đầu tiên để bắt đầu cấu hình.'"
    >
      <VtButton
        v-if="search"
        @click="search = ''"
      >
        Xóa bộ lọc
      </VtButton><VtButton
        v-else
        variant="primary"
        @click="createOpen = true"
      >
        Tạo trợ lý
      </VtButton>
    </VtEmptyState>
    <div
      v-else
      class="assistant-grid"
      data-ui-stable="true"
    >
      <AssistantCard
        v-for="assistant in assistants"
        :key="assistant.id"
        :assistant="assistant"
        @pair="openPair"
      />
    </div>

    <AssistantCreateDialog
      v-model:open="createOpen"
      @created="onCreated"
    />
    <PairDeviceDialog
      v-model:open="pairOpen"
      :assistants="assistants"
      :assistant-id="pairAssistantId"
      @paired="loadAssistants"
    />
  </section>
</template>

<style scoped>
.assistant-index { display: grid; gap: 0; }
.search-control { width: 244px; }
.header-actions { display: flex; gap: 8px; }
.offline-banner { display: flex; align-items: center; gap: 9px; margin-top: 12px; border: 1px solid #efd39e; border-radius: var(--vt-radius-section); background: var(--vt-warning-soft); color: var(--vt-warning); padding: 9px 11px; font-size: 11px; }
.offline-banner strong { font-weight: 600; }
.assistant-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 15px; margin-top: 15px; }
.assistant-state { display: grid; justify-items: center; gap: 4px; margin-top: 15px; color: var(--vt-text-muted); padding: 24px; text-align: center; }
.assistant-state h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.assistant-state p { max-width: 460px; margin: 3px auto 10px; font-size: 11px; line-height: 1.5; }
.assistant-state h2:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.assistant-skeleton { display: grid; gap: 12px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); padding: 14px; }
.skeleton-heading { display: flex; align-items: center; gap: 10px; }
.skeleton-heading > div { display: grid; gap: 8px; }
@media (max-width: 980px) { .assistant-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) {
  .search-control { min-width: 0; flex: 1; }
  .header-actions { width: 100%; }
  .header-actions > * { flex: 1; }
}
@media (max-width: 620px) { .assistant-grid { grid-template-columns: 1fr; } }
@media (max-width: 440px) {
  :deep(.page-actions) { flex-wrap: wrap; }
  .search-control { width: 100%; flex-basis: 100%; }
  .header-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
