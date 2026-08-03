<script setup lang="ts">
import { Cpu, Link2, Radio, RefreshCcw, Wifi, WifiOff } from '@lucide/vue'
import { nextTick, onMounted, ref } from 'vue'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard, DeviceCard } from '@/domain'
import { managerGatewayKey } from '@/gateways'
import PreviewScenarioToolbar from '@/ui/patterns/PreviewScenarioToolbar.vue'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtEmptyState from '@/ui/primitives/VtEmptyState.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtSkeleton from '@/ui/primitives/VtSkeleton.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

import PairDeviceDialog from './PairDeviceDialog.vue'

const props = defineProps<{ assistant: AssistantCard }>()
const emit = defineEmits<{ changed: [] }>()
const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

const devices = ref<DeviceCard[]>([])
const loading = ref(true)
const pairOpen = ref(false)
const loadState = ref<'loading' | 'ready' | 'empty' | 'error' | 'offline'>('loading')
const loadError = ref('')
const stateHeading = ref<HTMLElement | null>(null)
let loadGeneration = 0

function formatTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadState.value = 'loading'
  loadError.value = ''
  try {
    const result = await gateway.listDevices(props.assistant.id)
    if (generation !== loadGeneration) return
    if (!result.ok) {
      loadState.value = result.meta.offline ? 'offline' : 'error'
      loadError.value = result.meta.offline
        ? 'Đang ngoại tuyến; chưa thể đồng bộ danh sách thiết bị.'
        : 'Không tải được danh sách thiết bị từ Manager API.'
      await focusStateHeading()
      return
    }
    devices.value = result.data.items
    loadState.value = devices.value.length > 0 ? 'ready' : 'empty'
  } catch {
    if (generation !== loadGeneration) return
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

async function onPaired() {
  await load()
  emit('changed')
}

onMounted(load)
</script>

<template>
  <section
    class="device-feature"
    :aria-busy="loading"
  >
    <PreviewScenarioToolbar
      @change="load"
      @reset="load"
    />
    <div class="device-toolbar">
      <div><strong>{{ devices.length }} thiết bị</strong><span>Ghép nối bằng mã xác thực tạm thời trên robot.</span></div><div>
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
        </VtButton><VtButton
          size="sm"
          variant="primary"
          @click="pairOpen = true"
        >
          <template #leading>
            <VtIcon
              :icon="Link2"
              :size="14"
            />
          </template>Ghép nối thiết bị
        </VtButton>
      </div>
    </div>

    <div
      v-if="loadState === 'loading'"
      class="device-grid"
      role="status"
      aria-live="polite"
      aria-label="Đang tải thiết bị"
    >
      <VtCard
        v-for="index in 2"
        :key="index"
        class="device-skeleton"
      >
        <VtSkeleton
          width="42px"
          height="42px"
        /><div>
          <VtSkeleton
            width="150px"
            height="12px"
          /><VtSkeleton
            width="110px"
            height="9px"
          />
        </div><VtSkeleton
          class="wide"
          height="72px"
        />
      </VtCard>
    </div>
    <VtCard
      v-else-if="loadState === 'error' || loadState === 'offline'"
      class="device-state device-state-error"
      role="alert"
    >
      <h2
        ref="stateHeading"
        tabindex="-1"
      >
        {{ loadState === 'offline' ? 'Manager API đang ngoại tuyến' : 'Không tải được thiết bị' }}
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
      :icon="Cpu"
      title="Chưa có thiết bị"
      description="Ghép nối robot đầu tiên để quản lý firmware và trạng thái kết nối."
    >
      <VtButton
        variant="primary"
        @click="pairOpen = true"
      >
        Ghép nối thiết bị
      </VtButton>
    </VtEmptyState>
    <div
      v-else
      class="device-grid"
      data-ui-stable="true"
    >
      <VtCard
        v-for="device in devices"
        :key="device.id"
        class="device-card"
      >
        <header class="device-heading">
          <span
            class="device-icon"
            :class="device.onlineState"
          ><VtIcon
            :icon="device.onlineState === 'online' ? Wifi : WifiOff"
            :size="19"
          /></span><div>
            <h3>{{ device.displayName }}</h3><VtStatus
              :tone="device.onlineState === 'online' ? 'online' : 'neutral'"
              :label="device.onlineState === 'online' ? 'Trực tuyến' : 'Ngoại tuyến'"
            />
          </div><VtBadge>{{ device.board }}</VtBadge>
        </header>
        <dl class="device-details">
          <div><dt>Địa chỉ</dt><dd>{{ device.maskedMac }}</dd></div><div><dt>Firmware</dt><dd>{{ device.firmwareVersion }}</dd></div><div><dt>Liên lạc gần nhất</dt><dd>{{ formatTime(device.lastSeenAt) }}</dd></div><div><dt>Hội thoại gần nhất</dt><dd>{{ device.lastConversationAt ? formatTime(device.lastConversationAt) : 'Chưa có' }}</dd></div>
        </dl>
        <footer>
          <span><VtIcon
            :icon="Radio"
            :size="13"
          /> Trạng thái được mô phỏng</span>
        </footer>
      </VtCard>
    </div>
    <PairDeviceDialog
      v-model:open="pairOpen"
      :assistants="[assistant]"
      :assistant-id="assistant.id"
      @paired="onPaired"
    />
  </section>
</template>

<style scoped>
.device-feature { display: grid; gap: 12px; }
.device-toolbar { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-section); background: var(--vt-surface); padding: 9px 11px; }
.device-toolbar strong { display: block; font-size: 12px; }
.device-toolbar span { color: var(--vt-text-muted); font-size: 9px; }
.device-toolbar > div:last-child { display: flex; gap: 7px; }
.device-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.device-state { display: grid; justify-items: center; gap: 4px; color: var(--vt-text-muted); padding: 24px; text-align: center; }
.device-state h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.device-state p { max-width: 440px; margin: 3px auto 10px; font-size: 11px; line-height: 1.5; }
.device-state h2:focus-visible { outline: 0; box-shadow: 0 0 0 3px var(--vt-focus); border-radius: 3px; }
.device-card { min-width: 0; padding: 14px; }
.device-heading { display: flex; align-items: center; gap: 10px; }
.device-icon { display: inline-grid; width: 42px; height: 42px; flex: none; place-items: center; border: 1px solid var(--vt-border); border-radius: 8px; background: var(--vt-surface-muted); color: var(--vt-text-muted); }
.device-icon.online { border-color: #c5eadc; background: var(--vt-success-soft); color: var(--vt-success); }
.device-heading > div { min-width: 0; flex: 1; }
.device-heading h3 { margin: 0 0 3px; overflow: hidden; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.device-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin: 13px 0 0; overflow: hidden; border: 1px solid var(--vt-border); border-radius: 6px; background: var(--vt-surface-subtle); }
.device-details div { min-width: 0; padding: 9px 10px; }
.device-details div:nth-child(even) { border-left: 1px solid var(--vt-border); }
.device-details div:nth-child(n+3) { border-top: 1px solid var(--vt-border); }
.device-details dt { color: var(--vt-text-muted); font-size: 9px; }
.device-details dd { margin: 3px 0 0; overflow: hidden; color: var(--vt-text-soft); font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.device-card footer { display: flex; justify-content: flex-end; margin-top: 10px; color: var(--vt-text-faint); font-size: 9px; }
.device-card footer span { display: inline-flex; align-items: center; gap: 5px; }
.device-skeleton { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 10px; }
.device-skeleton > div { display: grid; gap: 8px; }
.device-skeleton .wide { grid-column: 1 / -1; }
@media (max-width: 720px) { .device-grid { grid-template-columns: 1fr; } }
@media (max-width: 520px) { .device-toolbar { align-items: flex-start; flex-direction: column; } .device-toolbar > div:last-child { width: 100%; } .device-details { grid-template-columns: 1fr; } .device-details div:nth-child(even) { border-left: 0; } .device-details div + div { border-top: 1px solid var(--vt-border); } }
</style>
