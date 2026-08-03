import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import argon2 from 'argon2'
import { buildApp } from './app.js'
import type { Environment } from './config.js'
import { EncryptedFileSecretStore } from './secret-store.js'

const root = resolve(import.meta.dirname, '..')
const passwordHash = await argon2.hash('unit-password')
const databaseUrlFile = process.env.VEETEE_TEST_DATABASE_URL_FILE
const baseEnv: Environment = {
  VEETEE_API_HOST: '127.0.0.1', VEETEE_API_PORT: 8013, VEETEE_DATABASE_MODE: 'memory', VEETEE_DATABASE_URL_FILE: undefined,
  VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'), VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
  VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081', VEETEE_AUTH_MODE: 'local', VEETEE_OWNER_EMAIL: 'owner@example.test', VEETEE_OWNER_PASSWORD_HASH: passwordHash,
  VEETEE_AUTH_SECRET_FILE: undefined, VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true, VEETEE_SESSION_TTL_SECONDS: 3600, VEETEE_SECRET_STORE_FILE: undefined,
  VEETEE_SECRET_MASTER_KEY_FILE: undefined, VEETEE_MACHINE_TOKEN_FILE: undefined, VEETEE_LOG_LEVEL: 'silent',
}

test('local auth uses opaque cookie, /me CSRF token and exact Origin gate', async () => {
  const app = await buildApp({ env: baseEnv, authSecret: 'unit-auth-secret' })
  await app.ready()
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@example.test', password: 'unit-password' } })
    assert.equal(login.statusCode, 200)
    assert.match(String(login.headers['set-cookie']), /HttpOnly/)
    assert.doesNotMatch(login.body, /unit-password/)
    const csrfToken = login.json().csrfToken as string
    const cookie = cookiePair(login.headers['set-cookie'])
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().csrfToken, csrfToken)
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants', headers: { cookie } })
    const assistantId = assistants.json().items[0].id as string
    const role = await app.inject({ method: 'GET', url: `/api/v1/assistants/${assistantId}/role-config`, headers: { cookie } })
    const rolePayload = { ...role.json(), personality: { name: 'auth-test' } }
    const missingOrigin = await app.inject({ method: 'PATCH', url: `/api/v1/assistants/${assistantId}/role-config`, headers: { cookie, 'if-match': role.headers.etag, 'x-veetee-csrf': csrfToken }, payload: rolePayload })
    assert.equal(missingOrigin.statusCode, 403)
    const missingCsrf = await app.inject({ method: 'PATCH', url: `/api/v1/assistants/${assistantId}/role-config`, headers: { cookie, origin: 'http://127.0.0.1:8081', 'if-match': role.headers.etag }, payload: rolePayload })
    assert.equal(missingCsrf.statusCode, 403)
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/assistants/${assistantId}/role-config`, headers: { cookie, origin: 'http://127.0.0.1:8081', 'if-match': role.headers.etag, 'x-veetee-csrf': csrfToken }, payload: rolePayload })
    assert.equal(updated.statusCode, 200)
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: 'http://127.0.0.1:8081', 'x-veetee-csrf': csrfToken } })
    assert.equal(logout.statusCode, 204)
    const afterLogout = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    assert.equal(afterLogout.statusCode, 401)
  } finally { await app.close() }
})

test('encrypted local secret store never writes plaintext', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'veetee-secret-test-'))
  const path = resolve(directory, 'secrets.json')
  const store = new EncryptedFileSecretStore(path, 'unit-master-material')
  try {
    const stored = await store.put('reference-1', 'canary-secret-value')
    assert.equal(stored.version, 1)
    assert.equal(await store.verify('reference-1'), true)
    assert.doesNotMatch(await readFile(path, 'utf8'), /canary-secret-value/)
    await Promise.all(Array.from({ length: 4 }, (_, index) => store.put(`concurrent-${index}`, `concurrent-value-${index}`)))
    for (let index = 0; index < 4; index += 1) assert.equal(await store.verify(`concurrent-${index}`), true)
    await store.delete('reference-1')
    assert.equal(await store.verify('reference-1'), false)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('secret reference API returns metadata only and supports ETag mutation', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'veetee-secret-api-test-'))
  const secretStore = new EncryptedFileSecretStore(resolve(directory, 'secrets.json'), 'unit-master-material')
  const env: Environment = { ...baseEnv, VEETEE_AUTH_MODE: 'disabled' }
  const app = await buildApp({ env, secretStore })
  await app.ready()
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v1/secret-references', payload: { name: 'Groq test', store: 'encrypted-local', secretValue: 'canary-secret-value' } })
    assert.equal(created.statusCode, 201)
    assert.doesNotMatch(created.body, /canary-secret-value/)
    const value = created.json() as { id: string; etag: string; status: string }
    assert.equal(value.status, 'available')
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/secret-references/${value.id}`, headers: { 'if-match': value.etag }, payload: { name: 'Groq renamed' } })
    assert.equal(updated.statusCode, 200)
    const stale = await app.inject({ method: 'PATCH', url: `/api/v1/secret-references/${value.id}`, headers: { 'if-match': value.etag }, payload: { name: 'stale' } })
    assert.equal(stale.statusCode, 409)
    const listed = await app.inject({ method: 'GET', url: '/api/v1/secret-references' })
    assert.equal(listed.statusCode, 200)
    assert.doesNotMatch(listed.body, /canary-secret-value/)
    const provider = await app.inject({ method: 'POST', url: '/api/v1/provider-configs', payload: {
      installationId: 'groq.chat', name: 'Groq bound', config: { endpoint: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', maxTokens: 64 }, secretRefs: [value.id],
    } })
    assert.equal(provider.statusCode, 201)
    const assistants = await app.inject({ method: 'GET', url: '/api/v1/assistants' })
    const assistant = assistants.json().items[0] as { id: string; etag: string }
    const selected = await app.inject({
      method: 'PATCH',
      url: `/api/v1/assistants/${assistant.id}/model-memory/provider`,
      headers: { 'if-match': assistant.etag },
      payload: { kind: 'llm', mode: 'selected', providerConfigId: provider.json().id },
    })
    assert.equal(selected.statusCode, 200)
    const published = await app.inject({ method: 'POST', url: `/api/v1/assistants/${assistant.id}/publish`, headers: { 'if-match': selected.headers.etag } })
    assert.equal(published.statusCode, 200)
    assert.deepEqual(published.json().snapshot.providers.llm.secretRefs, [value.id])
    const blocked = await app.inject({ method: 'DELETE', url: `/api/v1/secret-references/${value.id}`, headers: { 'if-match': updated.headers.etag } })
    assert.equal(blocked.statusCode, 409)
    const unbound = await app.inject({ method: 'PATCH', url: `/api/v1/provider-configs/${provider.json().id}`, headers: { 'if-match': provider.headers.etag }, payload: { secretRefs: [] } })
    assert.equal(unbound.statusCode, 200)
    const rejectedPublish = await app.inject({ method: 'POST', url: `/api/v1/assistants/${assistant.id}/publish` })
    assert.equal(rejectedPublish.statusCode, 422)
    const blockedByHistory = await app.inject({ method: 'DELETE', url: `/api/v1/secret-references/${value.id}`, headers: { 'if-match': updated.headers.etag } })
    assert.equal(blockedByHistory.statusCode, 409)
    const orphan = await app.inject({ method: 'POST', url: '/api/v1/secret-references', payload: { name: 'Orphan', store: 'encrypted-local', secretValue: 'orphan-secret' } })
    assert.equal(orphan.statusCode, 201)
    const deleted = await app.inject({ method: 'DELETE', url: `/api/v1/secret-references/${orphan.json().id}`, headers: { 'if-match': orphan.headers.etag } })
    assert.equal(deleted.statusCode, 204)
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('PostgreSQL-backed session survives Manager API restart', { skip: !databaseUrlFile }, async () => {
  const env: Environment = { ...baseEnv, VEETEE_DATABASE_MODE: 'postgres', VEETEE_DATABASE_URL_FILE: databaseUrlFile, VEETEE_API_PORT: 8014 }
  const first = await buildApp({ env, authSecret: 'postgres-auth-secret' })
  await first.ready()
  let cookie = ''
  let csrfToken = ''
  try {
    const login = await first.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'owner@example.test', password: 'unit-password' } })
    assert.equal(login.statusCode, 200)
    cookie = cookiePair(login.headers['set-cookie'])
    csrfToken = login.json().csrfToken
  } finally { await first.close() }
  const restarted = await buildApp({ env, authSecret: 'postgres-auth-secret' })
  await restarted.ready()
  try {
    const me = await restarted.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } })
    assert.equal(me.statusCode, 200)
    assert.equal(me.json().csrfToken, csrfToken)
    const logout = await restarted.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie, origin: 'http://127.0.0.1:8081', 'x-veetee-csrf': csrfToken } })
    assert.equal(logout.statusCode, 204)
  } finally { await restarted.close() }
})

function cookiePair(value: string | string[] | undefined): string {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const cookie = values.find((item) => item.startsWith('veetee_session='))
  assert.ok(cookie)
  return cookie.split(';', 1)[0] ?? cookie
}
