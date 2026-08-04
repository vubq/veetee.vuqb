import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpGatewayDependencies } from './http-gateway'

afterEach(() => vi.unstubAllGlobals())

describe('HTTP gateway read failure metadata', () => {
  it('maps derived assistant dashboard summary fields from the typed API response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: '11111111-1111-4111-8111-111111111111', ownerId: 'local-owner', name: 'Summary assistant',
        role: { locale: 'vi-VN', speech: { voiceId: 'An Nhiên' }, personality: { name: 'Companion' } }, providerSelections: {},
        draftRevision: 3, publishedRevision: 2, deviceCount: 33, onlineDeviceCount: 7,
        lastConversationAt: '2026-08-04T03:15:00.000Z', etag: '"summary-etag"', updatedAt: '2026-08-04T03:16:00.000Z',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.listAssistants()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.items).toHaveLength(1)
    expect(result.data.items[0]).toMatchObject({
      deviceCount: 33,
      onlineDeviceCount: 7,
      lastConversationAt: '2026-08-04T03:15:00.000Z',
    })
  })

  it('keeps server errors distinct from offline state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'INTERNAL_ERROR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/problem+json' },
    })))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.listProviderInstallations()

    expect(result.ok).toBe(false)
    expect(result.meta).toMatchObject({ freshness: 'fresh', offline: false })
  })

  it('marks a service-unavailable/network boundary as stale offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }), {
      status: 503,
      headers: { 'Content-Type': 'application/problem+json' },
    })))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.listProviderInstallations()

    expect(result.ok).toBe(false)
    expect(result.meta).toMatchObject({ freshness: 'stale', offline: true })
  })

  it('sends the device ETag with the typed unlink operation', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: { id: 'owner', email: 'owner@example.test' }, csrfToken: 'csrf-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 204 })
    }))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.unlinkDevice('device-test', '"device-etag"')

    expect(result.ok).toBe(true)
    const call = calls.find(({ input }) => (input instanceof Request ? input.url : String(input)).endsWith('/api/v1/devices/device-test/binding'))
    expect(call).toBeDefined()
    const headers = call?.input instanceof Request ? call.input.headers : new Headers(call?.init?.headers)
    const method = call?.input instanceof Request ? call.input.method : call?.init?.method
    expect(method).toBe('DELETE')
    expect(headers.get('If-Match')).toBe('"device-etag"')
    expect(headers.get('X-Veetee-CSRF')).toBe('csrf-test')
  })
})
