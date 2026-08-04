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

  it('round-trips additive role policies without dropping tool/runtime fields', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const role = {
      locale: 'vi-VN',
      basePrompt: 'Trợ lý có policy additive.',
      personality: { id: 'personality', name: 'Focused' },
      speech: { voiceId: 'voice', rate: 1, pitch: 0, style: 'natural' },
      progress: { enabled: true, acknowledgementId: 'processing', deadlineMs: 900 },
      segmentation: { minimumCharacters: 2, maximumCharacters: 120 },
      bargeIn: { minSpeechFrames: 2 },
      toolPolicy: { maxRounds: 2, timeoutMs: 5000 },
      tools: [{ name: 'device.led.set', description: 'Set RGB.' }],
      admission: { maxActiveTurns: 1, retryAfterMs: 250 },
      autoTurn: { enabled: false, noSpeechTimeoutMs: 5000, noSpeechAlert: { status: 'warning', message: '', emotion: 'neutral' } },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = input instanceof Request ? input.url : String(input)
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({}), { status: 200 })
      if (url.endsWith('/role-config') && (input instanceof Request ? input.method : init?.method) === 'PATCH') {
        return new Response(JSON.stringify(role), { status: 200, headers: { ETag: '"role-next"', 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(role), { status: 200, headers: { ETag: '"role-current"', 'Content-Type': 'application/json' } })
    }))

    const gateway = createHttpGatewayDependencies('https://manager.test').managerGateway
    const loaded = await gateway.getRoleConfig('assistant-test')
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return
    const saved = await gateway.saveRoleConfig('assistant-test', {
      locale: loaded.data.value.locale,
      basePrompt: loaded.data.value.basePrompt,
      personalityId: loaded.data.value.personalityId,
      personalityName: loaded.data.value.personalityName,
      speech: loaded.data.value.speech,
      admission: loaded.data.value.admission,
      autoTurn: loaded.data.value.autoTurn,
      progress: loaded.data.value.progress,
      segmentation: loaded.data.value.segmentation,
      bargeIn: loaded.data.value.bargeIn,
      toolPolicy: loaded.data.value.toolPolicy,
      tools: loaded.data.value.tools,
    }, loaded.data.etag)

    expect(saved.ok).toBe(true)
    const patchCall = calls.find(({ input, init }) => {
      const url = input instanceof Request ? input.url : String(input)
      const method = input instanceof Request ? input.method : init?.method
      return url.endsWith('/api/v1/assistants/assistant-test/role-config') && method === 'PATCH'
    })
    expect(patchCall).toBeDefined()
    const body = JSON.parse(patchCall?.input instanceof Request ? await patchCall.input.clone().text() : String(patchCall?.init?.body))
    expect(body.progress).toEqual(role.progress)
    expect(body.segmentation).toEqual(role.segmentation)
    expect(body.bargeIn).toEqual(role.bargeIn)
    expect(body.toolPolicy).toEqual(role.toolPolicy)
    expect(body.tools).toEqual(role.tools)
  })

  it('sends the retention ETag and keeps audio disabled in the typed payload', async () => {
    const calls: Request[] = []
    const policy = {
      ownerId: 'owner', captureTranscript: true, transcriptDays: 90, captureAudio: false, audioDays: null,
      effectiveAt: '2026-08-05T00:00:00.000Z', revision: 2, etag: '"retention-2"',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      calls.push(request)
      if (request.url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: { id: 'owner' }, csrfToken: 'csrf-test' }), { status: 200 })
      return new Response(JSON.stringify(policy), { status: 200, headers: { 'Content-Type': 'application/json', ETag: policy.etag } })
    }))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.updateRetentionPolicy({ captureTranscript: true, transcriptDays: 90, captureAudio: false, audioDays: null }, '"retention-1"')
    expect(result.ok).toBe(true)
    const request = calls.find((item) => item.url.endsWith('/api/v1/retention-policy'))
    expect(request?.method).toBe('PATCH')
    expect(request?.headers.get('If-Match')).toBe('"retention-1"')
    expect(request?.headers.get('X-Veetee-CSRF')).toBe('csrf-test')
    expect(JSON.parse(await request!.clone().text())).toEqual({ captureTranscript: true, transcriptDays: 90, captureAudio: false, audioDays: null })
  })

  it('maps the privacy export allow-list without reintroducing device identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      if (request.url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: { id: 'owner' }, csrfToken: 'csrf-test' }), { status: 200 })
      return new Response(JSON.stringify({
        exportVersion: 1,
        exportedAt: '2026-08-05T00:00:00.000Z',
        conversation: {
          summary: {
            id: 'conversation-1', assistantId: 'assistant-1', startedAt: '2026-08-04T00:00:00.000Z', endedAt: '2026-08-04T00:01:00.000Z',
            locale: 'vi-VN', configRevision: 4, status: 'completed', turnCount: 1, lastTurnAt: '2026-08-04T00:01:00.000Z', aggregateTimings: {}, retentionUntil: null,
          },
          turns: [],
          retention: { ownerId: 'owner', captureTranscript: true, transcriptDays: 30, captureAudio: false, audioDays: null, effectiveAt: '2026-08-01T00:00:00.000Z', revision: 1, etag: '"retention-1"' },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.exportConversation('conversation-1')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.exportVersion).toBe(1)
    expect(result.data.conversation.summary).not.toHaveProperty('deviceKey')
  })

  it('sends write-only secret create and maps metadata without exposing a value', async () => {
    const calls: Request[] = []
    const metadata = {
      id: 'secret-groq', ownerId: 'owner', name: 'Groq key', store: 'encrypted-local', locatorMasked: 'encrypted-local',
      version: 1, metadataRevision: 1, status: 'available', lastRotatedAt: '2026-08-05T00:00:00.000Z', etag: '"secret-1"', updatedAt: '2026-08-05T00:00:00.000Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      calls.push(request)
      if (request.url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: { id: 'owner' }, csrfToken: 'csrf-test' }), { status: 200 })
      return new Response(JSON.stringify(metadata), { status: 201, headers: { 'Content-Type': 'application/json', ETag: metadata.etag } })
    }))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.createSecretReference({ name: 'Groq key', secretValue: 'never-returned' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ id: metadata.id, version: 1, status: 'available' })
    expect(result.data).not.toHaveProperty('secretValue')
    const request = calls.find((item) => item.url.endsWith('/api/v1/secret-references'))
    expect(request?.method).toBe('POST')
    expect(JSON.parse(await request!.clone().text())).toMatchObject({ name: 'Groq key', store: 'encrypted-local', secretValue: 'never-returned' })
  })

  it('sends ETag on secret rotation and never persists the plaintext in gateway state', async () => {
    const calls: Request[] = []
    const metadata = {
      id: 'secret-groq', ownerId: 'owner', name: 'Groq key', store: 'encrypted-local', locatorMasked: 'encrypted-local',
      version: 2, metadataRevision: 2, status: 'available', lastRotatedAt: '2026-08-05T00:00:00.000Z', etag: '"secret-2"', updatedAt: '2026-08-05T00:00:00.000Z',
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      calls.push(request)
      if (request.url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: { id: 'owner' }, csrfToken: 'csrf-test' }), { status: 200 })
      return new Response(JSON.stringify(metadata), { status: 200, headers: { 'Content-Type': 'application/json', ETag: metadata.etag } })
    }))

    const result = await createHttpGatewayDependencies('https://manager.test').managerGateway.updateSecretReference('secret-groq', { secretValue: 'rotate-only-once' }, '"secret-1"')
    expect(result.ok).toBe(true)
    const request = calls.find((item) => item.url.endsWith('/api/v1/secret-references/secret-groq'))
    expect(request?.method).toBe('PATCH')
    expect(request?.headers.get('If-Match')).toBe('"secret-1"')
    expect(request?.headers.get('X-Veetee-CSRF')).toBe('csrf-test')
    expect(JSON.parse(await request!.clone().text())).toEqual({ secretValue: 'rotate-only-once' })
  })
})
