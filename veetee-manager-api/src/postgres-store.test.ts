import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { buildApp } from './app.js'
import type { Environment } from './config.js'
import { EncryptedFileSecretStore } from './secret-store.js'

const databaseUrlFile = process.env.VEETEE_TEST_DATABASE_URL_FILE
const root = resolve(import.meta.dirname, '..')

test('PostgreSQL rejects malformed resource IDs as validation errors', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8010, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const app = await buildApp({ env })
  await app.ready()
  try {
    const response = await app.inject({ method: 'GET', url: '/api/v1/assistants/not-a-uuid' })
    assert.equal(response.statusCode, 400)
    assert.match(String(response.headers['content-type']), /^application\/problem\+json/)
    assert.equal(response.json().code, 'VALIDATION_ERROR')
  } finally {
    await app.close()
  }
})

test('PostgreSQL persists a published assistant across Manager API restart', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1',
    VEETEE_API_PORT: 8011,
    VEETEE_DATABASE_MODE: 'postgres',
    VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'),
    VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081',
    VEETEE_AUTH_MODE: 'disabled',
    VEETEE_OWNER_EMAIL: undefined,
    VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined,
    VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true,
    VEETEE_LOG_LEVEL: 'silent',
  }
  const marker = `postgres-restart-${Date.now()}`
  const app = await buildApp({ env })
  await app.ready()
  let assistantId = ''
  try {
    const list = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    assert.equal(list.statusCode, 200)
    assistantId = list.json().items[0]?.id
    assert.ok(assistantId)
    const role = await app.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/role-config` })
    assert.equal(role.statusCode, 200)
    const currentRole = role.json() as Record<string, unknown>
    const update = await app.inject({ method: 'PATCH', url: `/api/v1/assistants/${assistantId}/role-config`, headers: { 'if-match': role.headers.etag }, payload: { ...currentRole, personality: { name: marker } } })
    assert.equal(update.statusCode, 200)
    const published = await app.inject({ method: 'POST', url: `/api/v1/assistants/${assistantId}/publish`, headers: { 'if-match': update.headers.etag } })
    assert.equal(published.statusCode, 200)
  } finally {
    await app.close()
  }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const role = await restarted.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/role-config` })
    assert.equal(role.statusCode, 200)
    assert.equal(role.json().personality.name, marker)
    const health = await restarted.inject({ method: 'GET', url: '/health/ready' })
    assert.equal(health.statusCode, 200)
    assert.equal(health.json().status, 'ready')
  } finally {
    await restarted.close()
  }
})

test('PostgreSQL provider edits create immutable revisions and reject stale writes', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8012, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const name = `postgres-provider-${Date.now()}`
  const app = await buildApp({ env })
  await app.ready()
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/provider-configs', payload: { installationId: 'veetee.vad.energy', name, config: { speechThreshold: 0.01, releaseThreshold: 0.005, minSpeechMs: 100, minSilenceMs: 300 } } })
    assert.equal(created.statusCode, 201)
    const current = created.json() as { id: string; etag: string; revision: number; config: Record<string, unknown> }
    assert.equal(current.revision, 1)
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/provider-configs/${current.id}`, headers: { 'if-match': current.etag }, payload: { config: { ...current.config, minSilenceMs: 360 } } })
    assert.equal(updated.statusCode, 200)
    assert.equal(updated.json().revision, 2)
    const stale = await app.inject({ method: 'PATCH', url: `/api/v1/provider-configs/${current.id}`, headers: { 'if-match': current.etag }, payload: { config: current.config } })
    assert.equal(stale.statusCode, 409)
  } finally {
    await app.close()
  }
  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const list = await restarted.inject({ method: 'GET', url: '/api/v1/provider-configs?kind=vad' })
    assert.equal(list.statusCode, 200)
    const persisted = list.json().items.find((item: { name: string }) => item.name === name)
    assert.equal(persisted.revision, 2)
    assert.equal(persisted.config.minSilenceMs, 360)
  } finally {
    await restarted.close()
  }
})

test('PostgreSQL persists a paired device and consumes its challenge once', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8016, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const app = await buildApp({ env })
  await app.ready()
  let assistantId = ''
  let code = ''
  let deviceId = ''
  try {
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    assistantId = assistants.json().items[0]?.id
    const challenge = await app.inject({ method: 'POST', url: '/internal/v1/devices/pairing-challenges', payload: { identityHash: `pg-identity-${Date.now()}`, clientIdHash: `pg-client-${Date.now()}`, maskedMac: 'A4:CF:12:••:••:2B', board: 'ESP32-S3 N16R8', firmwareVersion: '0.1.0' } })
    assert.equal(challenge.statusCode, 201)
    code = challenge.json().verificationCode
    const paired = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: code, displayName: 'Postgres robot' } })
    assert.equal(paired.statusCode, 201)
    deviceId = paired.json().id
  } finally { await app.close() }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const listed = await restarted.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/devices` })
    assert.equal(listed.statusCode, 200)
    assert.ok(listed.json().items.some((item: { id: string; displayName: string }) => item.id === deviceId && item.displayName === 'Postgres robot'))
    const reused = await restarted.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: code } })
    assert.equal(reused.statusCode, 422)
  } finally { await restarted.close() }
})

test('PostgreSQL persists device presence across API restart', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8018, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const identityHash = `a${'1'.repeat(63)}`
  const clientIdHash = `b${'2'.repeat(63)}`
  const app = await buildApp({ env })
  await app.ready()
  let deviceId = ''
  try {
    const online = await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload: {
      identityHash, clientIdHash, maskedMac: 'AA:BB:CC:••:••:FF', board: 'ESP32-S3 N16R8', firmwareVersion: 'presence-pg', onlineState: 'online',
    } })
    assert.equal(online.statusCode, 202)
    deviceId = online.json().id
  } finally { await app.close() }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const offline = await restarted.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload: {
      identityHash, clientIdHash, maskedMac: 'AA:BB:CC:••:••:FF', board: 'ESP32-S3 N16R8', firmwareVersion: 'presence-pg', onlineState: 'offline',
    } })
    assert.equal(offline.statusCode, 202)
    assert.equal(offline.json().id, deviceId)
    assert.equal(offline.json().onlineState, 'offline')
  } finally { await restarted.close() }
})

test('PostgreSQL keeps secret references that occur in immutable provider history', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8015, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const directory = await mkdtemp(resolve(tmpdir(), 'veetee-postgres-secret-test-'))
  const secretStore = new EncryptedFileSecretStore(resolve(directory, 'secrets.json'), 'postgres-secret-test-master')
  const app = await buildApp({ env, secretStore })
  await app.ready()
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/secret-references', payload: { name: `Postgres bound ${Date.now()}`, store: 'encrypted-local', secretValue: 'postgres-canary' } })
    assert.equal(created.statusCode, 201)
    const secret = created.json() as { id: string; etag: string }
    const provider = await app.inject({ method: 'POST', url: '/api/v1/provider-configs', payload: {
      installationId: 'groq.chat', name: `Postgres secret binding ${Date.now()}`, config: { endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', maxTokens: 64 }, secretRefs: [secret.id],
    } })
    assert.equal(provider.statusCode, 201)
    const providerValue = provider.json() as { id: string; etag: string }
    const blocked = await app.inject({ method: 'DELETE', url: `/api/v1/secret-references/${secret.id}`, headers: { 'if-match': secret.etag } })
    assert.equal(blocked.statusCode, 409)
    const unbound = await app.inject({ method: 'PATCH', url: `/api/v1/provider-configs/${providerValue.id}`, headers: { 'if-match': providerValue.etag }, payload: { secretRefs: [] } })
    assert.equal(unbound.statusCode, 200)
    const blockedByHistory = await app.inject({ method: 'DELETE', url: `/api/v1/secret-references/${secret.id}`, headers: { 'if-match': secret.etag } })
    assert.equal(blockedByHistory.statusCode, 409)
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('PostgreSQL persists conversation turns and retention policy across restart', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8017, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const conversationId = `22222222-2222-4222-8222-${String(Date.now()).slice(-12)}`
  const app = await buildApp({ env })
  await app.ready()
  let assistantId = ''
  try {
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    assistantId = assistants.json().items[0]?.id
    assert.match(assistantId, /^[0-9a-f-]{36}$/i)
    const event = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: {
      conversationId, assistantId, locale: 'vi-VN', configRevision: 1, conversationStartedAt: '2026-08-04T01:00:00.000Z', conversationEndedAt: '2026-08-04T01:00:03.000Z', conversationStatus: 'completed', turnId: `pg-turn-${Date.now()}`, sequence: 1, state: 'completed', startedAt: '2026-08-04T01:00:01.000Z', endedAt: '2026-08-04T01:00:03.000Z', finishReason: 'complete', timings: { last_ttfa_ms: 900 }, transcript: [{ speaker: 'user', text: 'Xin chào', locale: 'vi-VN', confidence: 1, startedAtMs: 0, endedAtMs: 400, isFinal: true }], toolCalls: [],
    } })
    assert.equal(event.statusCode, 202)
  } finally { await app.close() }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const list = await restarted.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/conversations` })
    assert.equal(list.statusCode, 200)
    assert.ok(list.json().items.some((item: { id: string; turnCount: number }) => item.id === conversationId && item.turnCount === 1))
    const detail = await restarted.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}` })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json().retention.transcriptDays, 30)
    assert.equal(detail.json().turns[0].transcript[0].text, 'Xin chào')
  } finally { await restarted.close() }
})
