import { afterEach, describe, expect, it, vi } from 'vitest'

import { createHttpGatewayDependencies } from './http-gateway'

afterEach(() => vi.unstubAllGlobals())

describe('HTTP gateway read failure metadata', () => {
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
})
