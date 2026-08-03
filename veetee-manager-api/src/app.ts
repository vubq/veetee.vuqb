import { readFile } from 'node:fs/promises'
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import argon2 from 'argon2'
import { readEnvironment, type Environment } from './config.js'
import { EncryptedFileSecretStore, type SecretValueStore } from './secret-store.js'
import { InMemoryStore, loadInitialSnapshot, parseCatalog, type ProviderKind, type Store } from './store.js'

type OwnerRequest = FastifyRequest & { ownerId?: string; sessionToken?: string; csrfToken?: string; sessionExpiresAt?: string }

const assistantBodySchema = {
  type: 'object', additionalProperties: false, required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
} as const
const roleBodySchema = {
  type: 'object', additionalProperties: false, required: ['locale', 'basePrompt'],
  properties: {
    locale: { type: 'string', minLength: 2, maxLength: 35 },
    basePrompt: { type: 'string', minLength: 1, maxLength: 16000 },
    personality: { type: 'object' },
    speech: { type: 'object' },
  },
} as const
const providerBodySchema = {
  type: 'object', additionalProperties: false, required: ['installationId', 'name', 'config'],
  properties: {
    installationId: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    config: { type: 'object' },
    secretRefs: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const
const secretReferenceBodySchema = {
  type: 'object', additionalProperties: false, required: ['name', 'store'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    store: { type: 'string', enum: ['encrypted-local'] },
    locator: { type: 'string', maxLength: 256 },
    secretValue: { type: 'string', minLength: 1, maxLength: 16384 },
  },
} as const

export async function buildApp(overrides?: { env?: Environment; store?: Store; authSecret?: string; secretStore?: SecretValueStore }): Promise<FastifyInstance> {
  const env = overrides?.env ?? readEnvironment()
  const store = overrides?.store ?? await createStore(env)
  const authSecret = overrides?.authSecret ?? (env.VEETEE_AUTH_MODE === 'local' ? await readRequiredFile(env.VEETEE_AUTH_SECRET_FILE, 'VEETEE_AUTH_SECRET_FILE') : undefined)
  const secretStore = overrides?.secretStore ?? await createSecretStore(env)
  if (env.VEETEE_AUTH_MODE === 'local' && !authSecret) throw new Error('VEETEE_AUTH_SECRET_FILE is required when VEETEE_AUTH_MODE=local')
  const app = Fastify({
    logger: { level: env.VEETEE_LOG_LEVEL, redact: ['req.headers.authorization', '*.password', '*.secret', '*.apiKey'] },
  })
  const machineToken = env.VEETEE_MACHINE_TOKEN_FILE ? (await readFile(env.VEETEE_MACHINE_TOKEN_FILE, 'utf8')).trim() : undefined
  const allowedOrigins = env.VEETEE_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean)

  await app.register(sensible)
  await app.register(cookie)
  await app.register(cors, { origin: allowedOrigins, credentials: true })

  app.decorateRequest('ownerId', null)
  app.addHook('preHandler', async (request: OwnerRequest, reply) => {
    const path = request.url.split('?', 1)[0] ?? request.url
    if (!path.startsWith('/api/v1/')) return
    if (path === '/api/v1/auth/login') return
    if (env.VEETEE_AUTH_MODE === 'disabled') {
      request.ownerId = 'local-owner'
      return
    }
    const token = request.cookies['veetee_session']
    if (!token || !authSecret) return reply.code(401).send({ type: 'about:blank', code: 'UNAUTHORIZED', title: 'Unauthorized' })
    const session = await store.findSession(hashAuthValue(authSecret, token, 'session'))
    if (!session) return reply.code(401).send({ type: 'about:blank', code: 'UNAUTHORIZED', title: 'Unauthorized' })
    request.ownerId = session.ownerId
    request.sessionToken = token
    request.csrfToken = deriveCsrfToken(authSecret, token)
    request.sessionExpiresAt = session.expiresAt
    if (isUnsafe(request.method)) {
      const origin = request.headers.origin
      if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) return reply.code(403).send({ code: 'CSRF_ORIGIN_INVALID' })
      const supplied = request.headers['x-veetee-csrf']
      const suppliedValue = typeof supplied === 'string' ? supplied : undefined
      if (!suppliedValue || !safeEqual(hashAuthValue(authSecret, suppliedValue, 'csrf'), session.csrfHash)) return reply.code(403).send({ code: 'CSRF_INVALID' })
    }
  })

  app.get('/health/live', async () => ({ status: 'ok', service: 'veetee-manager-api' }))
  app.get('/health/ready', async (_request, reply) => {
    const publication = await store.runtime()
    if (!publication) return reply.code(503).send({ status: 'not_ready', reason: 'runtime_snapshot_unpublished' })
    return { status: 'ready', service: 'veetee-manager-api', revision: publication.snapshot.revision, etag: publication.etag }
  })

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', { schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', minLength: 3 }, password: { type: 'string', minLength: 1 } } } } }, async (request, reply) => {
    if (env.VEETEE_AUTH_MODE === 'disabled') return { user: { id: 'local-owner', email: request.body.email } }
    if (!env.VEETEE_OWNER_EMAIL || !env.VEETEE_OWNER_PASSWORD_HASH || !authSecret || request.body.email !== env.VEETEE_OWNER_EMAIL || !(await argon2.verify(env.VEETEE_OWNER_PASSWORD_HASH, request.body.password))) return reply.code(401).send({ code: 'INVALID_CREDENTIALS' })
    const token = cryptoRandomToken()
    const csrfToken = deriveCsrfToken(authSecret, token)
    const ttlSeconds = env.VEETEE_SESSION_TTL_SECONDS ?? 86400
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    await store.createSession('local-owner', hashAuthValue(authSecret, token, 'session'), hashAuthValue(authSecret, csrfToken, 'csrf'), expiresAt)
    reply.setCookie('veetee_session', token, { httpOnly: true, sameSite: 'lax', secure: env.VEETEE_ALLOW_INSECURE_LOCAL_CONFIG !== true, path: '/', maxAge: ttlSeconds })
    return { user: { id: 'local-owner', email: env.VEETEE_OWNER_EMAIL }, sessionExpiresAt: expiresAt.toISOString(), csrfToken }
  })
  app.get('/api/v1/auth/me', async (request, reply) => {
    const current = request as OwnerRequest
    if (env.VEETEE_AUTH_MODE === 'disabled') return { user: { id: 'local-owner', email: env.VEETEE_OWNER_EMAIL ?? '' }, sessionExpiresAt: null, csrfToken: null }
    if (!current.ownerId || !current.csrfToken || !current.sessionExpiresAt) return reply.code(401).send({ code: 'UNAUTHORIZED' })
    return { user: { id: current.ownerId, email: env.VEETEE_OWNER_EMAIL ?? '' }, sessionExpiresAt: current.sessionExpiresAt, csrfToken: current.csrfToken }
  })
  app.post('/api/v1/auth/logout', async (request, reply) => {
    const current = request as OwnerRequest
    if (current.sessionToken && authSecret) await store.revokeSession(hashAuthValue(authSecret, current.sessionToken, 'session'))
    reply.clearCookie('veetee_session', { path: '/' })
    return reply.code(204).send()
  })

  app.get('/api/v1/secret-references', async (request) => ({ items: await store.listSecretReferences(owner(request)) }))
  app.post<{ Body: { name: string; store: 'encrypted-local'; locator?: string; secretValue?: string } }>('/api/v1/secret-references', { schema: { body: secretReferenceBodySchema } }, async (request, reply) => {
    if (request.body.store !== 'encrypted-local') return reply.code(422).send({ code: 'SECRET_STORE_INVALID' })
    const id = randomUUID()
    let version = 1
    let status: 'available' | 'unavailable' = 'unavailable'
    if (request.body.secretValue !== undefined) {
      if (!secretStore) return reply.code(503).send({ code: 'SECRET_STORE_UNAVAILABLE' })
      try {
        const stored = await secretStore.put(id, request.body.secretValue)
        version = stored.version
        status = 'available'
      } catch (error) { return sendProblem(reply, error) }
    }
    try {
      const value = await store.createSecretReference(owner(request), { id, name: request.body.name, locatorMasked: 'encrypted-local', version, status })
      return reply.code(201).header('ETag', value.etag).send(value)
    } catch (error) {
      if (status === 'available') await secretStore?.delete(id).catch(() => undefined)
      return sendProblem(reply, error)
    }
  })
  app.patch<{ Params: { id: string }; Body: { name?: string; locator?: string } }>('/api/v1/secret-references/:id', { schema: { body: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, locator: { type: 'string', maxLength: 256 } } } } }, async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try {
      const value = await store.updateSecretReference(owner(request), request.params.id, { name: request.body.name, locatorMasked: request.body.locator === undefined ? undefined : 'encrypted-local' }, ifMatch)
      return reply.header('ETag', value.etag).send(value)
    } catch (error) { return sendProblem(reply, error) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/secret-references/:id', async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try {
      await store.deleteSecretReference(owner(request), request.params.id, ifMatch)
      await secretStore?.delete(request.params.id)
      return reply.code(204).send()
    } catch (error) { return sendProblem(reply, error) }
  })

  app.get('/api/v1/provider-installations', async () => ({ items: await store.listInstallations() }))
  app.get<{ Querystring: { locale?: string } }>('/api/v1/voices', async (request) => {
    const installations = await store.listInstallations()
    const tts = installations.filter((item) => item.kind === 'tts')
    return { items: tts.filter((item) => !request.query.locale || item.manifest.locales === undefined || (item.manifest.locales as unknown[]).includes('*') || (item.manifest.locales as unknown[]).includes(request.query.locale)).map((item) => ({ id: item.id, name: item.displayNameKey, providerName: item.displayNameKey, locale: request.query.locale ?? '*', description: item.displayNameKey, previewDurationMs: 0, available: true })), total: tts.length }
  })
  app.get<{ Querystring: { kind?: ProviderKind } }>('/api/v1/provider-configs', async (request: FastifyRequest<{ Querystring: { kind?: ProviderKind } }>) => ({ items: await store.listProviderConfigs(owner(request), request.query.kind) }))
  app.post<{ Body: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] } }>('/api/v1/provider-configs', { schema: { body: providerBodySchema } }, async (request, reply) => {
    try {
      const value = await store.createProviderConfig(owner(request), request.body)
      return reply.code(201).header('ETag', value.etag).send(value)
    } catch (error) { return sendProblem(reply, error) }
  })
  app.patch<{ Params: { id: string }; Body: { name?: string; config?: Record<string, unknown>; secretRefs?: string[] } }>('/api/v1/provider-configs/:id', { schema: { body: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, config: { type: 'object' }, secretRefs: { type: 'array', items: { type: 'string' } } } } } }, async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try { const value = await store.updateProviderConfig(owner(request), request.params.id, request.body, ifMatch); return reply.header('ETag', value.etag).send(value) } catch (error) { return sendProblem(reply, error) }
  })

  app.get('/api/v1/assistants', async (request) => ({ items: await store.listAssistants(owner(request)) }))
  app.post<{ Body: { name: string } }>('/api/v1/assistants', { schema: { body: assistantBodySchema } }, async (request, reply) => reply.code(201).send(await store.createAssistant(owner(request), request.body.name)))
  app.get<{ Params: { id: string } }>('/api/v1/assistants/:id', async (request, reply) => {
    const item = await store.getAssistant(owner(request), request.params.id)
    if (!item) return reply.code(404).send({ code: 'NOT_FOUND' })
    return reply.header('ETag', item.etag).send(item)
  })
  app.get<{ Params: { id: string } }>('/api/v1/assistants/:id/role-config', async (request, reply) => {
    const item = await store.getAssistant(owner(request), request.params.id)
    if (!item) return reply.code(404).send({ code: 'NOT_FOUND' })
    return reply.header('ETag', item.etag).send(item.role)
  })
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/v1/assistants/:id/role-config', { schema: { body: roleBodySchema } }, async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try { const item = await store.updateRole(owner(request), request.params.id, request.body, ifMatch); return reply.header('ETag', item.etag).send(item.role) } catch (error) { return sendProblem(reply, error) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/assistants/:id/model-memory', async (request, reply) => {
    try {
      const item = await store.getAssistant(owner(request), request.params.id)
      if (!item) return reply.code(404).send({ code: 'NOT_FOUND' })
      return reply.header('ETag', item.etag).send(await store.getModelMemory(owner(request), request.params.id))
    } catch (error) { return sendProblem(reply, error) }
  })
  app.patch<{ Params: { id: string }; Body: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string } }>('/api/v1/assistants/:id/model-memory/provider', { schema: { body: { type: 'object', additionalProperties: false, required: ['kind', 'mode'], properties: { kind: { type: 'string', enum: ['vad', 'asr', 'llm', 'tts', 'intent', 'memory'] }, mode: { type: 'string', enum: ['selected', 'disabled'] }, providerConfigId: { type: 'string' } } } } }, async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try { const value = await store.updateProviderSelection(owner(request), request.params.id, request.body, ifMatch); const assistant = await store.getAssistant(owner(request), request.params.id); return reply.header('ETag', assistant?.etag ?? '').send(value) } catch (error) { return sendProblem(reply, error) }
  })
  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/v1/assistants/:id/model-memory/memory', { schema: { body: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } }, async (request, reply) => {
    const ifMatch = request.headers['if-match']
    if (typeof ifMatch !== 'string') return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' })
    try { const value = await store.setMemoryEnabled(owner(request), request.params.id, request.body.enabled, ifMatch); const assistant = await store.getAssistant(owner(request), request.params.id); return reply.header('ETag', assistant?.etag ?? '').send(value) } catch (error) { return sendProblem(reply, error) }
  })
  app.post<{ Params: { id: string } }>('/api/v1/assistants/:id/publish', async (request, reply) => {
    try { const publication = await store.publish(owner(request), request.params.id, typeof request.headers['if-match'] === 'string' ? request.headers['if-match'] : undefined); return reply.header('ETag', publication.etag).send(publication) } catch (error) { return sendProblem(reply, error) }
  })
  app.get<{ Params: { id: string } }>('/api/v1/assistants/:id/devices', async (request, reply) => {
    if (!(await store.getAssistant(owner(request), request.params.id))) return reply.code(404).send({ code: 'NOT_FOUND' })
    return { items: [], total: 0 }
  })
  app.post('/api/v1/devices/pair', async (_request, reply) => reply.code(501).send({ code: 'DEVICE_PAIRING_NOT_READY', detail: 'Device pairing is reserved for the hardware milestone.' }))

  app.get<{ Querystring: { assistantId?: string } }>('/internal/v1/runtime-config', async (request, reply) => {
    if (!authorizeMachine(request.headers.authorization, machineToken)) return reply.code(401).send({ code: 'MACHINE_UNAUTHORIZED' })
    const publication = await store.runtime(request.query.assistantId)
    if (!publication) return reply.code(409).send({ code: 'NO_PUBLISHED_CONFIG' })
    if (request.headers['if-none-match'] === publication.etag) return reply.code(304).send()
    return reply.header('ETag', publication.etag).send(publication.snapshot)
  })

  app.get('/openapi.json', async () => openApiDocument())
  app.setErrorHandler((error, _request, reply) => {
    const value = error as { validation?: unknown; message?: string }
    if (value.validation) return reply.code(400).type('application/problem+json').send({ code: 'VALIDATION_ERROR', detail: value.message })
    app.log.error({ err: error }, 'unhandled request error')
    return reply.code(500).send({ code: 'INTERNAL_ERROR' })
  })
  if (store.close) app.addHook('onClose', async () => { await store.close?.() })
  return app
}

async function createStore(env: Environment): Promise<Store> {
  const catalog = parseCatalog(JSON.parse(await readFile(env.VEETEE_PROVIDER_CATALOG_FILE, 'utf8')))
  const initial = await loadInitialSnapshot(env.VEETEE_INITIAL_SNAPSHOT_FILE)
  if (env.VEETEE_DATABASE_MODE === 'postgres') {
    const { createPostgresStore } = await import('./postgres-store.js')
    return createPostgresStore({ catalog, initial, databaseUrlFile: env.VEETEE_DATABASE_URL_FILE })
  }
  return new InMemoryStore(catalog, initial)
}

function owner(request: FastifyRequest): string { return (request as OwnerRequest).ownerId ?? 'local-owner' }

function sendProblem(reply: FastifyReply, error: unknown): FastifyReply {
  const value = error as { code?: string; statusCode?: number; message?: string }
  return reply.code(value.statusCode ?? 500).type('application/problem+json').send({ code: value.code ?? 'INTERNAL_ERROR', detail: value.message ?? 'Request failed' })
}

function authorizeMachine(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true
  if (!header?.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

function cryptoRandomToken(): string { return randomBytes(32).toString('base64url') }

async function readRequiredFile(path: string | undefined, name: string): Promise<string> {
  if (!path) throw new Error(`${name} is required`)
  const value = (await readFile(path, 'utf8')).trim()
  if (!value) throw new Error(`${name} is empty`)
  return value
}

async function createSecretStore(env: Environment): Promise<SecretValueStore | undefined> {
  if (!env.VEETEE_SECRET_STORE_FILE && !env.VEETEE_SECRET_MASTER_KEY_FILE) return undefined
  const path = env.VEETEE_SECRET_STORE_FILE
  const masterPath = env.VEETEE_SECRET_MASTER_KEY_FILE
  if (!path || !masterPath) throw new Error('VEETEE_SECRET_STORE_FILE and VEETEE_SECRET_MASTER_KEY_FILE must be configured together')
  return new EncryptedFileSecretStore(path, await readRequiredFile(masterPath, 'VEETEE_SECRET_MASTER_KEY_FILE'))
}

function isUnsafe(method: string): boolean { return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE' }

function hashAuthValue(secret: string, value: string, purpose: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex')
}

function deriveCsrfToken(secret: string, sessionToken: string): string {
  return createHmac('sha256', secret).update(`csrf-token:${sessionToken}`).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0', info: { title: 'Veetee Manager API', version: '0.1.0' }, servers: [{ url: '{baseUrl}', variables: { baseUrl: { default: 'http://127.0.0.1:8001' } } }],
    paths: {
      '/api/v1/auth/login': { post: { operationId: 'login', responses: { '200': { description: 'Authenticated session' }, '401': { description: 'Invalid credentials' } } } },
      '/api/v1/auth/me': { get: { operationId: 'getCurrentUser', responses: { '200': { description: 'Current user and CSRF token' }, '401': { description: 'Unauthorized' } } } },
      '/api/v1/auth/logout': { post: { operationId: 'logout', responses: { '204': { description: 'Logged out' } } } },
      '/api/v1/secret-references': { get: { operationId: 'listSecretReferences', responses: { '200': { description: 'Secret metadata' } } }, post: { operationId: 'createSecretReference', responses: { '201': { description: 'Created metadata; write-only value is omitted' } } } },
      '/api/v1/secret-references/{id}': { patch: { operationId: 'updateSecretReference', responses: { '200': { description: 'Updated metadata' } } }, delete: { operationId: 'deleteSecretReference', responses: { '204': { description: 'Deleted' } } } },
      '/api/v1/provider-installations': { get: { operationId: 'listProviderInstallations', responses: { '200': { description: 'Provider catalog' } } } },
      '/api/v1/provider-configs': { get: { operationId: 'listProviderConfigs', responses: { '200': { description: 'Provider configs' } } }, post: { operationId: 'createProviderConfig', responses: { '201': { description: 'Created' } } } },
      '/api/v1/assistants': { get: { operationId: 'listAssistants', responses: { '200': { description: 'Assistants' } } }, post: { operationId: 'createAssistant', responses: { '201': { description: 'Created' } } } },
      '/api/v1/assistants/{id}/role-config': { get: { operationId: 'getRoleConfig', responses: { '200': { description: 'Role config' } } }, patch: { operationId: 'patchRoleConfig', responses: { '200': { description: 'Updated' } } } },
      '/api/v1/assistants/{id}/publish': { post: { operationId: 'publishAssistant', responses: { '200': { description: 'Published' } } } },
      '/internal/v1/runtime-config': { get: { operationId: 'getRuntimeConfig', responses: { '200': { description: 'Runtime snapshot' }, '304': { description: 'Unchanged' } } } },
    },
  }
}
