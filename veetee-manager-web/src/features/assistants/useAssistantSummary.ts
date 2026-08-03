import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { requireInjection } from '@/app/requireInjection'
import type { AssistantCard } from '@/domain'
import { managerGatewayKey } from '@/gateways'

export function useAssistantSummary() {
  const route = useRoute()
  const gateway = requireInjection(managerGatewayKey, 'ManagerGateway')

  const assistant = ref<AssistantCard>()
  const loading = ref(true)
  const assistantId = String(route.params.id ?? '')

  async function load() {
    loading.value = true
    const result = await gateway.listAssistants()
    if (result.ok) assistant.value = result.data.items.find((item) => item.id === assistantId)
    loading.value = false
  }

  onMounted(load)
  return { assistant, assistantId, loading, reloadAssistant: load }
}
