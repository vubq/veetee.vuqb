import { fireEvent, render, waitFor } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { managerGatewayKey } from '@/gateways'
import { MockGateway } from '@/mocks/mock-gateway'

import AiServicesOverviewFeature from './AiServicesOverviewFeature.vue'

async function renderOverview() {
  const gateway = new MockGateway({ sleep: async () => undefined })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ai-services', component: AiServicesOverviewFeature },
      { path: '/model-config', component: AiServicesOverviewFeature },
      { path: '/provider-management', component: AiServicesOverviewFeature },
      { path: '/providers/tts/voices', component: AiServicesOverviewFeature },
    ],
  })
  await router.push('/ai-services')
  await router.isReady()
  return { view: render(AiServicesOverviewFeature, { global: { plugins: [router], provide: { [managerGatewayKey as symbol]: gateway } } }), router }
}

describe('AiServicesOverviewFeature', () => {
  it('summarizes the catalog and keeps tested defaults visible', async () => {
    const { view } = await renderOverview()

    expect(await view.findByRole('heading', { name: 'Dịch vụ AI' })).toBeTruthy()
    expect((await view.findAllByText('llama-3.3-70b-versatile')).length).toBeGreaterThan(0)
    expect((await view.findAllByText('PhoWhisper-small')).length).toBeGreaterThan(0)
    expect((await view.findAllByText('VieNeu-v3-turbo')).length).toBeGreaterThan(0)
    expect((await view.findAllByText('SileroVAD')).length).toBeGreaterThan(0)
    expect(view.getByText('Provider schema')).toBeTruthy()
  })

  it('navigates from the overview to model management', async () => {
    const { view, router } = await renderOverview()

    await fireEvent.click(await view.findByRole('button', { name: 'Mở Model Configuration' }))
    await waitFor(() => expect(router.currentRoute.value.path).toBe('/model-config'))
  })
})
