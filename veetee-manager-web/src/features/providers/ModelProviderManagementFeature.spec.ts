import { fireEvent, render } from '@testing-library/vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { managerGatewayKey } from '@/gateways'
import { MockGateway } from '@/mocks/mock-gateway'

import ModelProviderManagementFeature from './ModelProviderManagementFeature.vue'

async function renderManagement() {
  const gateway = new MockGateway({ sleep: async () => undefined })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/provider-management', component: ModelProviderManagementFeature }, { path: '/model-config', component: ModelProviderManagementFeature }] })
  await router.push('/provider-management')
  await router.isReady()
  return render(ModelProviderManagementFeature, { global: { plugins: [router], provide: { [managerGatewayKey as symbol]: gateway } } })
}

describe('ModelProviderManagementFeature', () => {
  it('paginates the full source catalog and keeps selection page-local', async () => {
    const view = await renderManagement()

    expect(await view.findByRole('heading', { name: 'Quản lý provider' })).toBeTruthy()
    expect(await view.findByText('1–10 / 63 provider')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Trang provider trước' }).getAttribute('disabled')).not.toBeNull()

    await fireEvent.click(view.getByRole('button', { name: 'Trang provider sau' }))
    expect(await view.findByText('11–20 / 63 provider')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Trang provider trước' }).getAttribute('disabled')).toBeNull()
  })

  it('applies search only when the user submits it', async () => {
    const view = await renderManagement()
    const search = view.getByRole('textbox', { name: 'Tìm provider' })

    await fireEvent.update(search, 'groq')
    expect(await view.findByText('1–10 / 63 provider')).toBeTruthy()
    await fireEvent.click(view.getByRole('button', { name: 'Tìm' }))
    expect(await view.findByText('1–1 / 1 provider')).toBeTruthy()
    expect((await view.findAllByText('Groq streaming')).length).toBeGreaterThan(0)
  })
})
