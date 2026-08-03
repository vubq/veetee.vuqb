import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { buildApp } from './app.js'
import type { Environment } from './config.js'

const databaseUrlFile = process.env.VEETEE_TEST_DATABASE_URL_FILE
const root = resolve(import.meta.dirname, '..')

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
    VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_LOG_LEVEL: 'silent',
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
