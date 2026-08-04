import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { Pool } from 'pg'
import { buildApp } from './app.js'
import type { Environment } from './config.js'
import { assertSafeTestDatabaseUrl, configurePostgresTestIsolation } from './postgres-test-isolation.js'
import { EncryptedFileSecretStore } from './secret-store.js'

const databaseUrlFile = process.env.VEETEE_TEST_DATABASE_URL_FILE
const root = resolve(import.meta.dirname, '..')

configurePostgresTestIsolation(databaseUrlFile)

test('PostgreSQL test harness refuses the production database name', () => {
  assert.throws(() => assertSafeTestDatabaseUrl('postgresql://veetee@127.0.0.1:55432/veetee_vubq'), /must end with _test/)
  assert.doesNotThrow(() => assertSafeTestDatabaseUrl('postgresql://veetee@127.0.0.1:55432/veetee_vubq_test'))
})

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
    assistantId = list.json().items.find((item: { role?: { locale?: unknown }; id?: string }) => typeof item.role?.locale === 'string')?.id
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

test('PostgreSQL unlinks a device binding atomically and keeps identity for re-pairing', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8019, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const suffix = Date.now().toString(16).slice(-8)
  const identityHash = `${'c'.repeat(64 - suffix.length)}${suffix}`
  const clientIdHash = `${'d'.repeat(64 - suffix.length)}${suffix}`
  const app = await buildApp({ env })
  await app.ready()
  let assistantId = ''
  let deviceId = ''
  let deviceEtag = ''
  try {
    assistantId = (await app.inject({ method: 'GET', url: '/api/v1/assistants' })).json().items[0]?.id
    const challenge = await app.inject({ method: 'POST', url: '/internal/v1/devices/pairing-challenges', payload: {
      identityHash, clientIdHash, maskedMac: 'CC:DD:EE:••:••:19', board: 'ESP32-S3 N16R8', firmwareVersion: 'unlink-pg',
    } })
    assert.equal(challenge.statusCode, 201)
    const paired = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: challenge.json().verificationCode, displayName: 'Postgres unlink robot' } })
    assert.equal(paired.statusCode, 201)
    deviceId = paired.json().id
    deviceEtag = paired.json().etag
  } finally { await app.close() }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const listed = await restarted.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/devices` })
    assert.equal(listed.statusCode, 200)
    const persisted = listed.json().items.find((item: { id: string }) => item.id === deviceId) as { etag: string } | undefined
    assert.ok(persisted)
    assert.equal(persisted?.etag, deviceEtag)
    const stale = await restarted.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}/binding`, headers: { 'if-match': '"stale-device-etag"' } })
    assert.equal(stale.statusCode, 409)
    const removed = await restarted.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}/binding`, headers: { 'if-match': deviceEtag } })
    assert.equal(removed.statusCode, 204)
    const repeated = await restarted.inject({ method: 'DELETE', url: `/api/v1/devices/${deviceId}/binding`, headers: { 'if-match': deviceEtag } })
    assert.equal(repeated.statusCode, 204)
  } finally { await restarted.close() }

  const after = await buildApp({ env })
  await after.ready()
  try {
    const listed = await after.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/devices` })
    assert.equal(listed.statusCode, 200)
    assert.equal(listed.json().items.some((item: { id: string }) => item.id === deviceId), false)
    const presence = await after.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload: {
      identityHash, clientIdHash, maskedMac: 'CC:DD:EE:••:••:19', board: 'ESP32-S3 N16R8', firmwareVersion: 'unlink-pg', onlineState: 'online',
    } })
    assert.equal(presence.statusCode, 202)
    assert.equal(presence.json().id, deviceId)
    assert.equal(presence.json().paired, false)
  } finally { await after.close() }
})

test('PostgreSQL derives assistant dashboard summaries without exposing device identity', { skip: !databaseUrlFile }, async () => {
  const env: Environment = {
    VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8020, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'disabled', VEETEE_OWNER_EMAIL: undefined, VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_LOG_LEVEL: 'silent',
  }
  const entropy = randomUUID().replaceAll('-', '')
  const hash = (prefix: string) => `${prefix.repeat(32)}${entropy}`
  const earlierEndedAt = new Date(Date.now() - 120_000).toISOString()
  const latestEndedAt = new Date(Date.now() - 60_000).toISOString()
  const app = await buildApp({ env })
  await app.ready()
  let assistantId = ''
  let staleDeviceId = ''
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/assistants', payload: { name: `PostgreSQL summary ${entropy.slice(0, 8)}` } })
    assert.equal(created.statusCode, 201)
    assistantId = created.json().id

    const pair = async (identityHash: string, clientIdHash: string, maskedMac: string) => {
      const challenge = await app.inject({ method: 'POST', url: '/internal/v1/devices/pairing-challenges', payload: { identityHash, clientIdHash, maskedMac, board: 'ESP32-S3 N16R8', firmwareVersion: 'summary-pg' } })
      assert.equal(challenge.statusCode, 201)
      const paired = await app.inject({ method: 'POST', url: '/api/v1/devices/pair', payload: { assistantId, verificationCode: challenge.json().verificationCode, displayName: `PostgreSQL summary ${maskedMac}` } })
      assert.equal(paired.statusCode, 201)
      return paired.json().id as string
    }

    const firstIdentity = hash('1')
    const firstClient = hash('2')
    await pair(firstIdentity, firstClient, 'AA:BB:CC:••:••:41')
    staleDeviceId = await pair(hash('3'), hash('4'), 'AA:BB:CC:••:••:42')
    assert.equal((await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload: { identityHash: firstIdentity, clientIdHash: firstClient, maskedMac: 'AA:BB:CC:••:••:41', board: 'ESP32-S3 N16R8', firmwareVersion: 'summary-pg', onlineState: 'offline' } })).statusCode, 202)
    assert.equal((await app.inject({ method: 'POST', url: '/internal/v1/devices/presence', payload: { identityHash: hash('5'), clientIdHash: hash('6'), maskedMac: 'AA:BB:CC:••:••:43', board: 'ESP32-S3 N16R8', firmwareVersion: 'summary-pg', onlineState: 'online' } })).statusCode, 202)

    const firstConversation = randomUUID()
    const conversationEvents: Array<[string, string]> = [[firstConversation, earlierEndedAt], [randomUUID(), latestEndedAt]]
    for (const [conversationId, endedAt] of conversationEvents) {
      const ingested = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: {
        conversationId, assistantId, locale: 'vi-VN', configRevision: 1,
        conversationStartedAt: new Date(Date.parse(endedAt) - 1_000).toISOString(), conversationEndedAt: endedAt, conversationStatus: 'completed',
        turnId: `summary-pg-${conversationId}`, sequence: 1, state: 'completed', startedAt: new Date(Date.parse(endedAt) - 500).toISOString(), endedAt, finishReason: 'complete', timings: {}, transcript: [], toolCalls: [],
      } })
      assert.equal(ingested.statusCode, 202)
    }

    const duplicateEndedAt = new Date(Date.parse(earlierEndedAt) - 1_000).toISOString()
    const duplicatePayload = {
      conversationId: randomUUID(), assistantId, locale: 'vi-VN', configRevision: 1,
      conversationStartedAt: new Date(Date.parse(duplicateEndedAt) - 1_000).toISOString(), conversationEndedAt: duplicateEndedAt, conversationStatus: 'completed' as const,
      turnId: 'summary-pg-duplicate', sequence: 1, state: 'completed' as const, startedAt: new Date(Date.parse(duplicateEndedAt) - 500).toISOString(), endedAt: duplicateEndedAt, finishReason: 'complete', timings: {}, transcript: [], toolCalls: [],
    }
    const duplicateResponses = await Promise.all([
      app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: duplicatePayload }),
      app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: duplicatePayload }),
    ])
    for (const response of duplicateResponses) assert.equal(response.statusCode, 202)
    const duplicateDetail = await app.inject({ method: 'GET', url: `/api/v1/conversations/${duplicatePayload.conversationId}` })
    assert.equal(duplicateDetail.statusCode, 200)
    assert.equal(duplicateDetail.json().summary.turnCount, 1)
    assert.equal(duplicateDetail.json().turns.length, 1)
    const sequenceConflict = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: { ...duplicatePayload, turnId: 'summary-pg-sequence-conflict' } })
    assert.equal(sequenceConflict.statusCode, 422)

    const otherAssistant = await app.inject({ method: 'POST', url: '/api/v1/assistants', payload: { name: `PostgreSQL ownership ${entropy.slice(0, 8)}` } })
    assert.equal(otherAssistant.statusCode, 201)
    const reassigned = await app.inject({ method: 'POST', url: '/internal/v1/conversations/turns', payload: {
      conversationId: firstConversation, assistantId: otherAssistant.json().id, locale: 'vi-VN', configRevision: 1,
      conversationStartedAt: new Date(Date.parse(latestEndedAt) - 1_000).toISOString(), conversationEndedAt: latestEndedAt, conversationStatus: 'completed',
      turnId: 'summary-pg-reassigned', sequence: 2, state: 'completed', startedAt: new Date(Date.parse(latestEndedAt) - 500).toISOString(), endedAt: latestEndedAt, finishReason: 'complete', timings: {}, transcript: [], toolCalls: [],
    } })
    assert.equal(reassigned.statusCode, 404)
  } finally { await app.close() }

  const pool = new Pool({ connectionString: (await readFile(databaseUrlFile!, 'utf8')).trim() })
  try {
    await pool.query("update veetee_manager.device set last_seen_at = now() - interval '5 minutes' where id = $1", [staleDeviceId])
  } finally {
    await pool.end()
  }

  const restarted = await buildApp({ env })
  await restarted.ready()
  try {
    const listed = await restarted.inject({ method: 'GET', url: '/api/v1/assistants' })
    assert.equal(listed.statusCode, 200)
    const card = listed.json().items.find((item: { id: string }) => item.id === assistantId) as Record<string, unknown> | undefined
    assert.ok(card)
    assert.equal(card?.deviceCount, 2)
    assert.equal(card?.onlineDeviceCount, 0)
    assert.equal(card?.lastConversationAt, latestEndedAt)
    assert.equal('identityHash' in (card ?? {}), false)
    assert.equal('clientIdHash' in (card ?? {}), false)
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
    /* The test harness resets the dedicated database before each test, so the
       default page is sufficient and no historical fixture can hide this row. */
    const list = await restarted.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/conversations?limit=100` })
    assert.equal(list.statusCode, 200)
    assert.ok(list.json().items.some((item: { id: string; turnCount: number }) => item.id === conversationId && item.turnCount === 1))
    const detail = await restarted.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}` })
    assert.equal(detail.statusCode, 200)
    assert.equal(detail.json().retention.transcriptDays, 30)
    assert.equal(detail.json().turns[0].transcript[0].text, 'Xin chào')
  } finally { await restarted.close() }
})
