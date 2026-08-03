import { afterEach, describe, expect, it, vi } from 'vitest'

import { createManagerApiClient } from './manager-client'

describe('Manager OpenAPI client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('hydrates CSRF through /auth/me and attaches it to typed mutations', async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      requests.push(request)
      if (request.url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf-from-session' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ id: 'assistant-1', ownerId: 'owner', name: 'Mây', role: {}, providerSelections: {}, draftRevision: 1, publishedRevision: null, etag: '"a1"', updatedAt: new Date(0).toISOString() }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', ETag: '"a1"' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createManagerApiClient('https://manager.test')
    const result = await client.POST('/api/v1/assistants', { body: { name: 'Mây' } })

    expect(result.response.status).toBe(201)
    expect(result.data?.name).toBe('Mây')
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/api/v1/auth/me',
      '/api/v1/assistants',
    ])
    expect(requests[1]?.headers.get('X-Veetee-CSRF')).toBe('csrf-from-session')
    expect(requests[1]?.credentials).toBe('include')
  })

  it('updates the CSRF token after login without writing credentials to storage', async () => {
    const requests: Request[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      requests.push(request)
      if (request.url.endsWith('/api/v1/auth/login')) {
        return new Response(JSON.stringify({ user: { id: 'owner', email: 'owner@example.test' }, csrfToken: 'csrf-after-login' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createManagerApiClient('https://manager.test')
    await client.POST('/api/v1/auth/login', { body: { email: 'owner@example.test', password: 'not-stored' } })
    await client.POST('/api/v1/assistants', { body: { name: 'Mây' } })

    expect(requests).toHaveLength(2)
    expect(requests[1]?.headers.get('X-Veetee-CSRF')).toBe('csrf-after-login')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
