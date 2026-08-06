import { describe, expect, it, vi } from 'vitest'

import type { ManagerApiClient } from '@/api/manager-client'

import { createAuthSession } from './auth-session'

function fakeClient() {
  const GET = vi.fn()
  const POST = vi.fn()
  return { client: { GET, POST } as unknown as ManagerApiClient, GET, POST }
}

describe('auth session', () => {
  it('uses preview status without an API client', async () => {
    const session = createAuthSession('')
    expect(session.isApiMode).toBe(false)
    expect(await session.hydrate()).toBe('preview')
    expect(session.status.value).toBe('preview')
  })

  it('hydrates a cookie session and logs out without storing credentials', async () => {
    const { client, GET, POST } = fakeClient()
    GET.mockResolvedValue({
      response: { ok: true, status: 200 },
      data: { user: { id: 'owner', email: 'owner@example.test' }, csrfToken: 'csrf' },
    })
    POST.mockResolvedValue({ response: { ok: true, status: 204 }, data: undefined })
    const session = createAuthSession('http://manager.test', client)

    expect(await session.hydrate()).toBe('authenticated')
    expect(session.user.value?.email).toBe('owner@example.test')
    expect(await session.logout()).toBe(true)
    expect(session.status.value).toBe('unauthenticated')
    expect(session.user.value).toBeNull()
  })

  it('maps throttled login and network errors to typed UI failures', async () => {
    const throttled = fakeClient()
    throttled.POST.mockResolvedValue({ response: { ok: false, status: 429 }, error: { code: 'LOGIN_THROTTLED' } })
    const first = createAuthSession('http://manager.test', throttled.client)
    expect(await first.login('owner@example.test', 'wrong')).toEqual({ ok: false, failure: { code: 'LOGIN_THROTTLED' } })

    const offline = fakeClient()
    offline.POST.mockRejectedValue(new Error('offline'))
    const second = createAuthSession('http://manager.test', offline.client)
    expect(await second.login('owner@example.test', 'wrong')).toEqual({ ok: false, failure: { code: 'NETWORK_UNAVAILABLE' } })
  })

  it('does not re-check the cookie on every route guard after hydration', async () => {
    const { client, GET } = fakeClient()
    GET.mockResolvedValue({ response: { ok: false, status: 401 }, error: { code: 'UNAUTHENTICATED' } })
    const session = createAuthSession('http://manager.test', client)

    expect(await session.hydrate()).toBe('unauthenticated')
    expect(await session.hydrate()).toBe('unauthenticated')
    expect(GET).toHaveBeenCalledTimes(1)
  })
})
