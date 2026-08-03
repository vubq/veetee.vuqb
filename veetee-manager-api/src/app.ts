import { readFile } from 'node:fs/promises'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import argon2 from 'argon2'
import { readEnvironment, type Environment } from './config.js'
import { InMemoryStore, loadInitialSnapshot, parseCatalog, type ProviderKind, type Store } from './store.js'

type OwnerRequest = FastifyRequest & { ownerId?: string }

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

export async function buildApp(overrides?: { env?: Environment; store?: Store }): Promise<FastifyInstance> {
  const env = overrides?.env ?? readEnvironment()
  const store = overrides?.store ?? await createStore(env)
  const app = Fastify({
    logger: { level: env.VEETEE_LOG_LEVEL, redact: ['req.headers.authorization', '*.password', '*.secret', '*.apiKey'] },
  })
  const sessions = new Map<string, string>()
  const machineToken = env.VEETEE_MACHINE_TOKEN_FILE ? (await readFile(env.VEETEE_MACHINE_TOKEN_FILE, 'utf8')).trim() : undefined

  await app.register(sensible)
  await app.register(cookie)
  await app.register(cors, { origin: env.VEETEE_ALLOWED_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean), credentials: true })

  app.decorateRequest('ownerId', null)
  app.addHook('preHandler', async (request: OwnerRequest, reply) => {
    if (!request.url.startsWith('/api/v1/')) return
    if (request.url.startsWith('/api/v1/auth/')) return
    if (env.VEETEE_AUTH_MODE === 'disabled') {
      request.ownerId = 'local-owner'
      return
    }
    const token = request.cookies['veetee_session']
    const ownerId = token ? sessions.get(token) : undefined
    if (!ownerId) return reply.code(401).send({ type: 'about:blank', code: 'UNAUTHORIZED', title: 'Unauthorized' })
    request.ownerId = ownerId
  })

  app.get('/health/live', async () => ({ status: 'ok', service: 'veetee-manager-api' }))
  app.get('/health/ready', async (_request, reply) => {
    const publication = await store.runtime()
    if (!publication) return reply.code(503).send({ status: 'not_ready', reason: 'runtime_snapshot_unpublished' })
    return { status: 'ready', service: 'veetee-manager-api', revision: publication.snapshot.revision, etag: publication.etag }
  })

  app.post<{ Body: { email: string; password: string } }>('/api/v1/auth/login', { schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: { email: { type: 'string', minLength: 3 }, password: { type: 'string', minLength: 1 } } } } }, async (request, reply) => {
    if (env.VEETEE_AUTH_MODE === 'disabled') return { user: { id: 'local-owner', email: request.body.email } }
    if (!env.VEETEE_OWNER_EMAIL || !env.VEETEE_OWNER_PASSWORD_HASH || request.body.email !== env.VEETEE_OWNER_EMAIL || !(await argon2.verify(env.VEETEE_OWNER_PASSWORD_HASH, request.body.password))) return reply.code(401).send({ code: 'INVALID_CREDENTIALS' })
    const token = cryptoRandomToken()
    sessions.set(token, 'local-owner')
    reply.setCookie('veetee_session', token, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' })
    return { user: { id: 'local-owner', email: env.VEETEE_OWNER_EMAIL } }
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

function openApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0', info: { title: 'Veetee Manager API', version: '0.1.0' }, servers: [{ url: '{baseUrl}', variables: { baseUrl: { default: 'http://127.0.0.1:8001' } } }],
    paths: {
      '/api/v1/provider-installations': { get: { operationId: 'listProviderInstallations', responses: { '200': { description: 'Provider catalog' } } } },
      '/api/v1/provider-configs': { get: { operationId: 'listProviderConfigs', responses: { '200': { description: 'Provider configs' } } }, post: { operationId: 'createProviderConfig', responses: { '201': { description: 'Created' } } } },
      '/api/v1/assistants': { get: { operationId: 'listAssistants', responses: { '200': { description: 'Assistants' } } }, post: { operationId: 'createAssistant', responses: { '201': { description: 'Created' } } } },
      '/api/v1/assistants/{id}/role-config': { get: { operationId: 'getRoleConfig', responses: { '200': { description: 'Role config' } } }, patch: { operationId: 'patchRoleConfig', responses: { '200': { description: 'Updated' } } } },
      '/api/v1/assistants/{id}/publish': { post: { operationId: 'publishAssistant', responses: { '200': { description: 'Published' } } } },
      '/internal/v1/runtime-config': { get: { operationId: 'getRuntimeConfig', responses: { '200': { description: 'Runtime snapshot' }, '304': { description: 'Unchanged' } } } },
    },
  }
}
