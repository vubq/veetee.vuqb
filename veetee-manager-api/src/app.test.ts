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
