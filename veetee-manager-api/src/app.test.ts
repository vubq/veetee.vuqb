import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildApp } from './app.js'
import type { Environment } from './config.js'

const root = resolve(import.meta.dirname, '..')
const env: Environment = {
  VEETEE_API_HOST: '127.0.0.1',
  VEETEE_API_PORT: 8001,
  VEETEE_DATABASE_MODE: 'memory',
  VEETEE_DATABASE_URL_FILE: undefined,
  VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'),
  VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
  VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081',
  VEETEE_AUTH_MODE: 'disabled',
  VEETEE_OWNER_EMAIL: undefined,
  VEETEE_OWNER_PASSWORD_HASH: undefined,
  VEETEE_MACHINE_TOKEN_FILE: undefined,
  VEETEE_LOG_LEVEL: 'silent',
}

test('manager API publishes config through immutable ETag flow', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const health = await app.inject({ method: 'GET', url: '/health/ready' })
    assert.equal(health.statusCode, 200)

    const list = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    assert.equal(list.statusCode, 200)
    const assistant = list.json().items[0] as { id: string; etag: string }
    assert.ok(assistant.id)
    assert.ok(assistant.etag)

    const role = await app.inject({ method: 'GET', url: `/api/v1/assistants/${assistant.id}/role-config` })
    const nextRole = {
      ...role.json(),
      personality: { name: 'focused', prompt: 'Use the configured style.' },
      progress: { enabled: true, acknowledgementId: 'processing', deadlineMs: 900 },
      segmentation: { minimumCharacters: 2, maximumCharacters: 120 },
      bargeIn: { minSpeechFrames: 2 },
      toolPolicy: { maxRounds: 2, timeoutMs: 5000 },
      admission: { maxActiveTurns: 1, retryAfterMs: 250 },
      tools: [{ name: 'device.led.set', description: 'Set the RGB LED.' }],
    }
    const update = await app.inject({ method: 'PATCH', url: `/api/v1/assistants/${assistant.id}/role-config`, headers: { 'if-match': role.headers.etag }, payload: nextRole })
    assert.equal(update.statusCode, 200)

    const published = await app.inject({ method: 'POST', url: `/api/v1/assistants/${assistant.id}/publish`, headers: { 'if-match': update.headers.etag } })
    assert.equal(published.statusCode, 200)
    const runtime = await app.inject({ method: 'GET', url: '/internal/v1/runtime-config' })
    assert.equal(runtime.statusCode, 200)
    assert.equal(runtime.json().personality.name, 'focused')
    assert.equal(runtime.json().progress.deadlineMs, 900)
    assert.equal(runtime.json().segmentation.maximumCharacters, 120)
    assert.equal(runtime.json().bargeIn.minSpeechFrames, 2)
    assert.equal(runtime.json().toolPolicy.maxRounds, 2)
    assert.equal(runtime.json().admission.maxActiveTurns, 1)
    assert.equal(runtime.json().admission.retryAfterMs, 250)
    assert.equal(runtime.json().tools[0].name, 'device.led.set')

    const notModified = await app.inject({ method: 'GET', url: '/internal/v1/runtime-config', headers: { 'if-none-match': runtime.headers.etag } })
    assert.equal(notModified.statusCode, 304)
  } finally {
    await app.close()
  }
})

test('role config OpenAPI response documents known policy fields while keeping additive extensions', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    type OpenApiOperation = {
      responses?: Record<string, {
        content?: Record<string, { schema?: { required?: string[]; properties?: Record<string, unknown> } }>
      }>
    }
    type OpenApiPath = { get?: OpenApiOperation; patch?: OpenApiOperation }
    const artifact = app.swagger() as { paths: Record<string, OpenApiPath> }
    const path = artifact.paths['/api/v1/assistants/{id}/role-config']
    assert.ok(path?.get && path.patch)
    for (const operation of [path.get, path.patch]) {
      const schema = operation.responses?.['200']?.content?.['application/json']?.schema
      assert.deepEqual(schema?.required, ['locale', 'basePrompt'])
      assert.ok(schema?.properties?.admission)
      assert.ok(schema?.properties?.tools)
    }
  } finally {
    await app.close()
  }
})

test('assistant search is validated and filtered by the API contract', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const filtered = await app.inject({ method: 'GET', url: '/api/v1/assistants?search=vee' })
    assert.equal(filtered.statusCode, 200)
    const body = filtered.json() as { items: Array<{ name: string }> }
    assert.ok(body.items.length > 0)
    assert.ok(body.items.every((item) => item.name.toLocaleLowerCase().includes('vee')))

    const invalid = await app.inject({ method: 'GET', url: `/api/v1/assistants?search=${'x'.repeat(121)}` })
    assert.equal(invalid.statusCode, 400)
  } finally {
    await app.close()
  }
})

test('provider config is schema-driven and rejects unknown fields', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/provider-configs', payload: { installationId: 'veetee.vad.energy', name: 'bad', config: { noSuchField: true } } })
    assert.equal(invalid.statusCode, 422)
    const valid = await app.inject({ method: 'POST', url: '/api/v1/provider-configs', payload: { installationId: 'veetee.vad.energy', name: 'default', config: { speechThreshold: 0.01, releaseThreshold: 0.005, minSpeechMs: 100, minSilenceMs: 300 } } })
    assert.equal(valid.statusCode, 201)
  } finally {
    await app.close()
  }
})

test('device pairing challenge is single-use and binds a device to an assistant', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    const assistantId = assistants.json().items[0].id as string
    const challenge = await app.inject({
      method: 'POST',
      url: '/internal/v1/devices/pairing-challenges',
      payload: { identityHash: 'identity-hash-0123456789', clientIdHash: 'client-hash-0123456789', maskedMac: 'A4:CF:12:••:••:9D', board: 'ESP32-S3 N16R8', firmwareVersion: '0.1.0' },
    })
    assert.equal(challenge.statusCode, 201)
    const code = challenge.json().verificationCode as string
    assert.match(code, /^VT-\d{4}$/)

    const invalid = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: 'VT-9999' } })
    assert.equal(invalid.statusCode, 422)
    const paired = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: code, displayName: 'Veetee phòng làm việc' } })
    assert.equal(paired.statusCode, 201)
    assert.equal(paired.json().displayName, 'Veetee phòng làm việc')
    assert.equal(paired.json().maskedMac, 'A4:CF:12:••:••:9D')

    const listed = await app.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/devices` })
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.json().total, 1)
    assert.equal(listed.json().items[0].id, paired.json().id)
    const reused = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: code } })
    assert.equal(reused.statusCode, 422)
  } finally {
    await app.close()
  }
})

test('conversation history ingest is idempotent and respects transcript retention policy', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    const assistantId = assistants.json().items[0].id as string
    const policy = await app.inject({ method: 'GET', url: '/api/v1/retention-policy' })
    assert.equal(policy.statusCode, 200)
    assert.equal(policy.json().captureTranscript, true)
    assert.equal(policy.json().transcriptDays, 30)
    assert.equal(policy.json().captureAudio, false)

    const payload = {
      conversationId: '11111111-1111-4111-8111-111111111111', assistantId, deviceKey: 'device-test', locale: 'vi-VN', configRevision: 7,
      conversationStartedAt: '2026-08-04T01:00:00.000Z', conversationEndedAt: '2026-08-04T01:00:05.000Z', conversationStatus: 'completed',
      turnId: 'turn-1', sequence: 1, state: 'completed', startedAt: '2026-08-04T01:00:01.000Z', endedAt: '2026-08-04T01:00:05.000Z', finishReason: 'complete',
      timings: { last_ttfa_ms: 840 }, transcript: [{ speaker: 'user', text: 'Xin chào', locale: 'vi-VN', confidence: 0.98, startedAtMs: 0, endedAtMs: 900, isFinal: true }, { speaker: 'assistant', text: 'Chào bạn', locale: 'vi-VN', confidence: null, startedAtMs: 0, endedAtMs: 900, isFinal: true }], toolCalls: [],
    }
    const ingested = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload })
    assert.equal(ingested.statusCode, 202)
    const duplicate = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload })
    assert.equal(duplicate.statusCode, 202)

    const list = await app.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/conversations` })
    assert.equal(list.statusCode, 200)
    assert.equal(list.json().total, 1)
    assert.equal(list.json().items[0].turnCount, 1)
    const detail = await app.inject({ method: 'GET', url: '/api/v1/conversations/11111111-1111-4111-8111-111111111111' })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json().turns.length, 1)
    assert.equal(detail.json().turns[0].transcript[0].text, 'Xin chào')

    const invalidAudio = await app.inject({ method: 'PATCH', url: '/api/v1/retention-policy', headers: { 'if-match': policy.headers.etag }, payload: { captureTranscript: true, transcriptDays: 30, captureAudio: true, audioDays: 1 } })
    assert.equal(invalidAudio.statusCode, 422)
    const disabled = await app.inject({ method: 'PATCH', url: '/api/v1/retention-policy', headers: { 'if-match': policy.headers.etag }, payload: { captureTranscript: false, transcriptDays: null, captureAudio: false, audioDays: null } })
    assert.equal(disabled.statusCode, 200)
  } finally {
    await app.close()
  }
})

test('device presence stores hashed identity and updates paired device state', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const online = await app.inject({
      method: 'POST',
      url: '/internal/v1/devices/presence',
      payload: {
        identityHash: 'a'.repeat(64), clientIdHash: 'b'.repeat(64), maskedMac: 'AA:BB:CC:••:••:FF',
        board: 'ESP32-S3 N16R8', firmwareVersion: 'presence-test', onlineState: 'online',
      },
    })
    assert.equal(online.statusCode, 202)
    assert.equal(online.json().paired, false)
    assert.equal(online.json().onlineState, 'online')

    const offline = await app.inject({
      method: 'POST',
      url: '/internal/v1/devices/presence',
      payload: {
        identityHash: 'a'.repeat(64), clientIdHash: 'b'.repeat(64), maskedMac: 'AA:BB:CC:••:••:FF',
        board: 'ESP32-S3 N16R8', firmwareVersion: 'presence-test', onlineState: 'offline',
      },
    })
    assert.equal(offline.statusCode, 202)
    assert.equal(offline.json().id, online.json().id)
    assert.equal(offline.json().onlineState, 'offline')
  } finally {
    await app.close()
  }
})

test('configured machine bearer is required for internal endpoints', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'veetee-machine-auth-'))
  const tokenPath = resolve(directory, 'machine.token')
  await writeFile(tokenPath, 'machine-test-token\n', { mode: 0o600 })
  const app = await buildApp({ env: { ...env, VEETEE_MACHINE_TOKEN_FILE: tokenPath } })
  await app.ready()
  try {
    const payload = {
      identityHash: 'c'.repeat(64), clientIdHash: 'd'.repeat(64), maskedMac: 'CC:DD:EE:••:••:11',
      board: 'ESP32-S3 N16R8', firmwareVersion: 'auth-test', onlineState: 'online',
    }
    assert.equal((await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', headers: { authorization: 'Bearer wrong' }, payload })).statusCode, 401)
    const accepted = await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', headers: { authorization: 'Bearer machine-test-token' }, payload })
    assert.equal(accepted.statusCode, 202)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('retention purge job removes expired conversation data', async () => {
  const app = await buildApp({ env: { ...env, VEETEE_RETENTION_INTERVAL_SECONDS: 60 } })
  await app.ready()
  try {
    const assistantId = (await app.inject({ method: 'GET', url: '/api/v1/assistants' })).json().items[0].id as string
    const conversationId = '33333333-3333-4333-8333-333333333333'
    const ingested = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: {
      conversationId, assistantId, locale: 'vi-VN', configRevision: 1,
      conversationStartedAt: '2020-01-01T00:00:00.000Z', conversationEndedAt: '2020-01-01T00:00:03.000Z', conversationStatus: 'completed',
      turnId: 'expired-turn', sequence: 1, state: 'completed', startedAt: '2020-01-01T00:00:01.000Z', endedAt: '2020-01-01T00:00:03.000Z', finishReason: 'complete',
      timings: {}, transcript: [], toolCalls: [],
    } })
    assert.equal(ingested.statusCode, 202)
    const purge = await app.inject({ method: 'POST', url: '/internal/v1/retention/purge' })
    assert.equal(purge.statusCode, 202)
    assert.equal(purge.json().purgedConversations, 1)
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}` })).statusCode, 404)
  } finally {
    await app.close()
  }
})

test('problem responses keep a stable media type and machine-readable code', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const checks = [
      { response: await app.inject({ method: 'GET', url: '/api/v1/assistants/00000000-0000-4000-8000-000000000000' }), status: 404, code: 'NOT_FOUND' },
      { response: await app.inject({ method: 'PATCH', url: '/api/v1/retention-policy', payload: { captureTranscript: true, transcriptDays: 30, captureAudio: false, audioDays: null } }), status: 428, code: 'IF_MATCH_REQUIRED' },
      { response: await app.inject({ method: 'GET', url: '/api/v1/assistants?search=' + 'x'.repeat(121) }), status: 400, code: 'VALIDATION_ERROR' },
    ]
    for (const check of checks) {
      assert.equal(check.response.statusCode, check.status)
      assert.match(String(check.response.headers['content-type']), /^application\/problem\+json/)
      assert.equal(check.response.json().code, check.code)
      assert.equal(typeof check.response.json().detail, 'string')
    }
  } finally {
    await app.close()
  }
})

test('OpenAPI is generated from every registered route', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    assert.equal(response.statusCode, 200)
    const document = response.json() as {
      openapi: string
      paths: Record<string, Record<string, {
        operationId?: string
        responses?: Record<string, {
          content?: Record<string, { examples?: Record<string, { value?: Record<string, unknown> }> }>
        }>
      }>>
      components?: { securitySchemes?: Record<string, unknown> }
    }
    assert.equal(document.openapi, '3.1.0')
    const requiredPaths = [
      '/health/live', '/health/ready', '/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/logout',
      '/api/v1/secret-references', '/api/v1/secret-references/{id}', '/api/v1/provider-installations',
      '/api/v1/provider-configs', '/api/v1/provider-configs/{id}', '/api/v1/voices', '/api/v1/assistants',
      '/api/v1/assistants/{id}', '/api/v1/assistants/{id}/role-config', '/api/v1/assistants/{id}/model-memory',
      '/api/v1/assistants/{id}/model-memory/provider', '/api/v1/assistants/{id}/model-memory/memory',
      '/api/v1/assistants/{id}/publish', '/api/v1/assistants/{id}/devices', '/api/v1/devices/pair', '/internal/v1/devices/pairing-challenges', '/internal/v1/devices/presence', '/internal/v1/retention/purge',
      '/internal/v1/runtime-config',
    ]
    for (const path of requiredPaths) assert.ok(document.paths[path], `missing OpenAPI path ${path}`)
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        assert.ok(operation.operationId, `missing operationId for ${method} ${path}`)
        assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `missing responses for ${method} ${path}`)
        assert.ok(operation.responses?.['400'], `missing validation response for ${method} ${path}`)
        assert.ok(operation.responses?.['500'], `missing server-error response for ${method} ${path}`)
        const secured = !path.startsWith('/health/') && path !== '/openapi.json' && path !== '/api/v1/auth/login'
        if (secured) {
          assert.ok(operation.responses?.['401'], `missing auth response for ${method} ${path}`)
          assert.ok(operation.responses?.['403'], `missing forbidden response for ${method} ${path}`)
          for (const status of ['404', '409', '422', '428', '503']) {
            assert.ok(operation.responses?.[status], `missing domain-error response ${status} for ${method} ${path}`)
          }
        }
        for (const [status, problemResponse] of Object.entries(operation.responses ?? {})) {
          if (!new Set(['400', '401', '403', '404', '409', '413', '422', '428', '429', '500', '503']).has(status)) continue
          if (path === '/health/ready' && status === '503') continue
          const media = problemResponse.content?.['application/problem+json']
          assert.ok(media, `missing problem media type for ${status} ${method} ${path}`)
          if (!media) continue
          const examples = media.examples
          assert.ok(examples && Object.keys(examples).length > 0, `missing problem example for ${status} ${method} ${path}`)
          if (!examples) continue
          for (const [name, example] of Object.entries(examples)) {
            assert.equal(typeof example.value?.code, 'string', `missing problem code in ${name} ${status} ${method} ${path}`)
            assert.equal(typeof example.value?.detail, 'string', `missing problem detail in ${name} ${status} ${method} ${path}`)
          }
        }
      }
    }
    const representativeCases = [
      { path: '/api/v1/auth/login', method: 'post', status: '401', code: 'INVALID_CREDENTIALS' },
      { path: '/api/v1/auth/login', method: 'post', status: '429', code: 'LOGIN_THROTTLED' },
      { path: '/internal/v1/devices/presence', method: 'post', status: '401', code: 'MACHINE_UNAUTHORIZED' },
      { path: '/api/v1/retention-policy', method: 'patch', status: '428', code: 'IF_MATCH_REQUIRED' },
      { path: '/api/v1/assistants/{id}', method: 'get', status: '404', code: 'NOT_FOUND' },
      { path: '/internal/v1/runtime-config', method: 'get', status: '409', code: 'NO_PUBLISHED_CONFIG' },
      { path: '/internal/v1/conversations/turns', method: 'post', status: '413', code: 'HISTORY_LIMIT_EXCEEDED' },
    ] as const
    for (const item of representativeCases) {
      const operation = document.paths[item.path]?.[item.method]
      const media = operation?.responses?.[item.status]?.content?.['application/problem+json']
      const value = media?.examples?.representative?.value
      assert.equal(value?.code, item.code, `unexpected representative code for ${item.method} ${item.path} ${item.status}`)
    }
    assert.ok(document.components?.securitySchemes?.veeteeSession)
    assert.ok(document.components?.securitySchemes?.machineBearer)
  } finally {
    await app.close()
  }
})
