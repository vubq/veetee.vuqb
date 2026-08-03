import assert from 'node:assert/strict'
import { test } from 'node:test'
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
    assert.equal(runtime.json().tools[0].name, 'device.led.set')

    const notModified = await app.inject({ method: 'GET', url: '/internal/v1/runtime-config', headers: { 'if-none-match': runtime.headers.etag } })
    assert.equal(notModified.statusCode, 304)
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

test('OpenAPI is generated from every registered route', async () => {
  const app = await buildApp({ env })
  await app.ready()
  try {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' })
    assert.equal(response.statusCode, 200)
    const document = response.json() as {
      openapi: string
      paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>
      components?: { securitySchemes?: Record<string, unknown> }
    }
    assert.equal(document.openapi, '3.1.0')
    const requiredPaths = [
      '/health/live', '/health/ready', '/api/v1/auth/login', '/api/v1/auth/me', '/api/v1/auth/logout',
      '/api/v1/secret-references', '/api/v1/secret-references/{id}', '/api/v1/provider-installations',
      '/api/v1/provider-configs', '/api/v1/provider-configs/{id}', '/api/v1/voices', '/api/v1/assistants',
      '/api/v1/assistants/{id}', '/api/v1/assistants/{id}/role-config', '/api/v1/assistants/{id}/model-memory',
      '/api/v1/assistants/{id}/model-memory/provider', '/api/v1/assistants/{id}/model-memory/memory',
      '/api/v1/assistants/{id}/publish', '/api/v1/assistants/{id}/devices', '/api/v1/devices/pair', '/internal/v1/devices/pairing-challenges',
      '/internal/v1/runtime-config',
    ]
    for (const path of requiredPaths) assert.ok(document.paths[path], `missing OpenAPI path ${path}`)
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        assert.ok(operation.operationId, `missing operationId for ${method} ${path}`)
        assert.ok(operation.responses && Object.keys(operation.responses).length > 0, `missing responses for ${method} ${path}`)
      }
    }
    assert.ok(document.components?.securitySchemes?.veeteeSession)
    assert.ok(document.components?.securitySchemes?.machineBearer)
  } finally {
    await app.close()
  }
})
