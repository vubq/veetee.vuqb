import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard } from '@/domain'
import { managerGatewayKey } from '@/gateways'

export type AssistantSummaryLoadState = 'loading' | 'ready' | 'error' | 'offline' | 'not-found'

export function useAssistantSummary() {
  const route = useRoute()
  const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

  const assistant = ref<AssistantCard>()
  const loading = ref(true)
  const assistantId = ref(String(route.params.id ?? ''))
  const loadState = ref<AssistantSummaryLoadState>('loading')
  const loadError = ref('')
  let loadGeneration = 0

  async function load() {
    const generation = ++loadGeneration
    loading.value = true
    loadState.value = 'loading'
    loadError.value = ''
    assistant.value = undefined
    try {
      const result = await gateway.listAssistants()
      if (generation !== loadGeneration) return
      if (!result.ok) {
        loadState.value = result.meta.offline ? 'offline' : 'error'
        loadError.value = result.meta.offline
          ? 'Đang ngoại tuyến; chưa thể tải thông tin trợ lý.'
          : 'Không tải được thông tin trợ lý từ máy chủ quản trị.'
        return
      }
      assistant.value = result.data.items.find((item) => item.id === assistantId.value)
      loadState.value = assistant.value ? 'ready' : 'not-found'
      if (!assistant.value) loadError.value = 'Trợ lý không tồn tại hoặc đã bị xóa.'
    } catch {
      if (generation !== loadGeneration) return
      loadState.value = 'offline'
      loadError.value = 'Không kết nối được máy chủ quản trị. Kiểm tra service hoặc mạng LAN.'
    } finally {
      if (generation === loadGeneration) loading.value = false
    }
  }

  onMounted(load)
  watch(() => route.params.id, (value) => {
    const nextId = String(value ?? '')
    if (nextId === assistantId.value) return
    assistantId.value = nextId
    void load()
  })

  return { assistant, assistantId, loading, loadState, loadError, reloadAssistant: load }
}
