import { render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import type { ProviderConfigRecord, ProviderInstallationView } from '@/domain'
import { managerGatewayKey, type ManagerGateway } from '@/gateways'

import ProviderOverviewFeature from './ProviderOverviewFeature.vue'

const installations: ProviderInstallationView[] = [{
  id: 'groq.chat', kind: 'llm', displayNameKey: 'provider.llm.groq', displayName: 'Groq', version: '1.0.0',
  manifest: { providerFamily: 'openai-compatible', protocol: 'chat-completions', locales: ['*'], supportsStreaming: true },
  configSchema: {}, supportedLocales: ['*'], capabilities: ['streaming'],
}]
const configs: ProviderConfigRecord[] = [{
  id: 'config-llm', installationId: 'groq.chat', name: 'Trả lời nhanh', revision: 1,
  config: {}, secretRefs: [], etag: '"config-1"',
}]

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    listProviderInstallations: vi.fn(async () => ({ ok: true, data: installations, meta: { requestId: 'overview', completedAt: '', delayMs: 0, freshness: 'fresh', offline: false } })),
    listProviderConfigs: vi.fn(async () => ({ ok: true, data: configs, meta: { requestId: 'overview', completedAt: '', delayMs: 0, freshness: 'fresh', offline: false } })),
    ...overrides,
  } as unknown as ManagerGateway
}

describe('ProviderOverviewFeature', () => {
  it('groups provider capabilities and links to a focused route', async () => {
    const view = render(ProviderOverviewFeature, {
      global: {
        provide: { [managerGatewayKey as symbol]: gateway() },
        stubs: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
      },
    })

    expect(await view.findByRole('heading', { name: 'Cấu hình từng phần một' })).toBeTruthy()
    expect((await view.findByRole('link', { name: 'Mở Bộ não trả lời' })).getAttribute('href')).toBe('/providers/llm')
    expect(await view.findByText('1 loại provider · 1 cấu hình')).toBeTruthy()
  })

  it('shows a retryable error when the catalog is unavailable', async () => {
    const unavailable = vi.fn(async () => ({ ok: false as const, problem: {}, meta: { requestId: 'overview', completedAt: '', delayMs: 0, freshness: 'stale' as const, offline: true } }))
    const view = render(ProviderOverviewFeature, {
      global: {
        provide: { [managerGatewayKey as symbol]: gateway({ listProviderInstallations: unavailable as never }) },
        stubs: { RouterLink: { template: '<a :href="to"><slot /></a>', props: ['to'] } },
      },
    })

    expect((await view.findByRole('alert')).textContent).toContain('Không tải được danh sách dịch vụ')
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
  })
})
