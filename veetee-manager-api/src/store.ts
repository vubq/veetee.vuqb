import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export type ProviderKind = 'vad' | 'asr' | 'llm' | 'tts' | 'intent' | 'memory'

export interface ProviderInstallation {
  id: string
  kind: ProviderKind
  displayNameKey: string
  version: string
  manifest: Record<string, unknown>
  configSchema: Record<string, unknown>
}

export interface ProviderConfig {
  id: string
  ownerId: string
  installationId: string
  name: string
  revision: number
  config: Record<string, unknown>
  secretRefs: string[]
  etag: string
  updatedAt: string
}

export interface Assistant {
  id: string
  ownerId: string
  name: string
  role: Record<string, unknown>
  providerSelections: Record<string, Record<string, unknown>>
  draftRevision: number
  publishedRevision: number | null
  etag: string
  updatedAt: string
}

export interface RuntimeSnapshot {
  schemaVersion: number
  revision: number
  assistantId: string
  locale: string
  basePrompt: string
  personality: Record<string, unknown>
  speech: Record<string, unknown>
  providers: Record<string, Record<string, unknown>>
  wire: Record<string, unknown>
  [key: string]: unknown
}

export interface RuntimePublication {
  snapshot: RuntimeSnapshot
  etag: string
  updatedAt: string
}

export interface ModelMemoryView {
  assistantId: string
  selections: Array<{ kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }>
  availableConfigs: Array<{ id: string; kind: ProviderKind; name: string; providerName: string; availability: 'ready' | 'unavailable' | 'disabled'; supportedLocales: string[] }>
  memory: { enabled: boolean; itemCount: number }
  memoryItems: Array<{ id: string; kind: string; content: string; enabled: boolean; updatedAt: string }>
}

export interface Store {
  listInstallations(): ProviderInstallation[]
  listProviderConfigs(ownerId: string, kind?: ProviderKind): ProviderConfig[]
  createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): ProviderConfig
  updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): ProviderConfig
  listAssistants(ownerId: string): Assistant[]
  getAssistant(ownerId: string, id: string): Assistant | undefined
  createAssistant(ownerId: string, name: string): Assistant
  updateRole(ownerId: string, id: string, value: Record<string, unknown>, ifMatch: string): Assistant
  getModelMemory(ownerId: string, id: string): ModelMemoryView
  updateProviderSelection(ownerId: string, id: string, value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }, ifMatch: string): ModelMemoryView
  setMemoryEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): ModelMemoryView
  publish(ownerId: string, id: string, ifMatch?: string): RuntimePublication
  runtime(): RuntimePublication | undefined
  setRuntime(publication: RuntimePublication): void
}

export class InMemoryStore implements Store {
  private readonly installations: ProviderInstallation[]
  private readonly providerConfigs = new Map<string, ProviderConfig>()
  private readonly assistants = new Map<string, Assistant>()
  private publication: RuntimePublication | undefined

  constructor(installations: ProviderInstallation[], initial?: RuntimeSnapshot) {
    this.installations = installations
    if (initial) {
      const assistant: Assistant = {
        id: initial.assistantId,
        ownerId: 'local-owner',
        name: 'Veetee',
        role: {
          locale: initial.locale,
          basePrompt: initial.basePrompt,
          personality: initial.personality,
          speech: initial.speech,
        },
        providerSelections: initial.providers,
        draftRevision: initial.revision,
        publishedRevision: initial.revision,
        etag: etag(initial),
        updatedAt: new Date().toISOString(),
      }
      this.assistants.set(assistant.id, assistant)
      this.publication = { snapshot: initial, etag: etag(initial), updatedAt: assistant.updatedAt }
    }
  }

  listInstallations(): ProviderInstallation[] { return this.installations.map((item) => structuredClone(item)) }

  listProviderConfigs(ownerId: string, kind?: ProviderKind): ProviderConfig[] {
    return [...this.providerConfigs.values()].filter((item) => item.ownerId === ownerId && (!kind || this.kind(item.installationId) === kind)).map((item) => structuredClone(item))
  }

  createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): ProviderConfig {
    const installation = this.installations.find((item) => item.id === value.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    validateJsonObject(value.config, installation.configSchema)
    const now = new Date().toISOString()
    const item: ProviderConfig = { id: randomUUID(), ownerId, installationId: value.installationId, name: value.name, revision: 1, config: structuredClone(value.config), secretRefs: value.secretRefs ?? [], etag: etag(value.config), updatedAt: now }
    this.providerConfigs.set(item.id, item)
    return structuredClone(item)
  }

  updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): ProviderConfig {
    const current = this.providerConfigs.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    const installation = this.installations.find((item) => item.id === current.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    const config = value.config ?? current.config
    validateJsonObject(config, installation.configSchema)
    const next: ProviderConfig = { ...current, ...value, config: structuredClone(config), revision: current.revision + 1, etag: etag({ ...config, revision: current.revision + 1 }), updatedAt: new Date().toISOString() }
    this.providerConfigs.set(id, next)
    return structuredClone(next)
  }

  listAssistants(ownerId: string): Assistant[] { return [...this.assistants.values()].filter((item) => item.ownerId === ownerId).map((item) => structuredClone(item)) }
  getAssistant(ownerId: string, id: string): Assistant | undefined {
    const item = this.assistants.get(id)
    return item && item.ownerId === ownerId ? structuredClone(item) : undefined
  }

  createAssistant(ownerId: string, name: string): Assistant {
    const now = new Date().toISOString()
    const item: Assistant = { id: randomUUID(), ownerId, name, role: {}, providerSelections: {}, draftRevision: 1, publishedRevision: null, etag: etag({ name, now }), updatedAt: now }
    this.assistants.set(item.id, item)
    return structuredClone(item)
  }

  updateRole(ownerId: string, id: string, value: Record<string, unknown>, ifMatch: string): Assistant {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    const next: Assistant = { ...current, role: structuredClone(value), draftRevision: current.draftRevision + 1, etag: etag({ ...value, revision: current.draftRevision + 1 }), updatedAt: new Date().toISOString() }
    this.assistants.set(id, next)
    return structuredClone(next)
  }

  getModelMemory(ownerId: string, id: string): ModelMemoryView {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    return this.modelMemory(current)
  }

  updateProviderSelection(ownerId: string, id: string, value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }, ifMatch: string): ModelMemoryView {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    if (value.mode === 'selected' && !value.providerConfigId) throw problem('CONFIG_INVALID', 'Selected provider requires providerConfigId', 422)
    current.providerSelections = { ...current.providerSelections, [value.kind]: value.mode === 'selected' ? { mode: value.mode, providerConfigId: value.providerConfigId } : { mode: value.mode } }
    current.draftRevision += 1
    current.etag = etag({ selections: current.providerSelections, revision: current.draftRevision })
    current.updatedAt = new Date().toISOString()
    this.assistants.set(id, current)
    return this.modelMemory(current)
  }

  setMemoryEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): ModelMemoryView {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    current.role = { ...current.role, memoryEnabled: enabled }
    current.draftRevision += 1
    current.etag = etag({ role: current.role, revision: current.draftRevision })
    current.updatedAt = new Date().toISOString()
    this.assistants.set(id, current)
    return this.modelMemory(current)
  }

  publish(ownerId: string, id: string, ifMatch?: string): RuntimePublication {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    if (!current.role.locale || !current.role.basePrompt) throw problem('CONFIG_NOT_PUBLISHABLE', 'Role configuration is incomplete', 422)
    const revision = (current.publishedRevision ?? 0) + 1
    const snapshot: RuntimeSnapshot = {
      schemaVersion: 1,
      revision,
      assistantId: current.id,
      locale: String(current.role.locale),
      basePrompt: String(current.role.basePrompt),
      personality: (current.role.personality as Record<string, unknown> | undefined) ?? {},
      speech: (current.role.speech as Record<string, unknown> | undefined) ?? {},
      providers: current.providerSelections,
      wire: { profile: 'ws-v3', uplinkSampleRate: 16000, downlinkSampleRate: 24000, frameDurationMs: 60 },
    }
    current.publishedRevision = revision
    current.etag = etag(snapshot)
    current.updatedAt = new Date().toISOString()
    this.assistants.set(id, current)
    this.publication = { snapshot, etag: etag(snapshot), updatedAt: current.updatedAt }
    return structuredClone(this.publication)
  }

  runtime(): RuntimePublication | undefined { return this.publication && structuredClone(this.publication) }
  setRuntime(publication: RuntimePublication): void { this.publication = structuredClone(publication) }

  private kind(id: string): ProviderKind | undefined { return this.installations.find((item) => item.id === id)?.kind }

  private modelMemory(current: Assistant): ModelMemoryView {
    const kinds: ProviderKind[] = ['vad', 'asr', 'llm', 'tts', 'intent', 'memory']
    const selections = kinds.map((kind) => {
      const value = current.providerSelections[kind]
      const providerConfigId = typeof value?.providerConfigId === 'string' ? value.providerConfigId : typeof value?.providerId === 'string' ? value.providerId : undefined
      return providerConfigId ? { kind, mode: 'selected' as const, providerConfigId } : { kind, mode: 'disabled' as const }
    })
    return {
      assistantId: current.id,
      selections,
      availableConfigs: this.installations.map((item) => ({ id: item.id, kind: item.kind, name: item.displayNameKey, providerName: item.displayNameKey, availability: 'ready' as const, supportedLocales: Array.isArray(item.manifest.locales) ? item.manifest.locales.filter((value): value is string => typeof value === 'string') : ['*'] })),
      memory: { enabled: current.role.memoryEnabled !== false, itemCount: 0 },
      memoryItems: [],
    }
  }
}

export function etag(value: unknown): string { return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"` }

export function parseCatalog(raw: unknown): ProviderInstallation[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { installations?: unknown }).installations)) throw new Error('provider catalog must contain installations')
  return (raw as { installations: ProviderInstallation[] }).installations.map((item) => ({ ...item, manifest: item.manifest ?? {}, configSchema: item.configSchema ?? {} }))
}

export async function loadInitialSnapshot(path: string | undefined): Promise<RuntimeSnapshot | undefined> {
  if (!path) return undefined
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || typeof (value as { revision?: unknown }).revision !== 'number') throw new Error('invalid initial snapshot')
  return value as RuntimeSnapshot
}

export function problem(code: string, message: string, statusCode: number): Error & { code: string; statusCode: number } {
  const error = new Error(message) as Error & { code: string; statusCode: number }
  error.code = code
  error.statusCode = statusCode
  return error
}

function validateJsonObject(value: Record<string, unknown>, schema: Record<string, unknown>): void {
  if (schema.type !== 'object' || schema.additionalProperties === false) {
    const properties = schema.properties as Record<string, unknown> | undefined
    const allowed = new Set(Object.keys(properties ?? {}))
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw problem('CONFIG_INVALID', `Unknown provider field: ${key}`, 422)
  }
  for (const required of (schema.required as string[] | undefined) ?? []) if (!(required in value)) throw problem('CONFIG_INVALID', `Missing provider field: ${required}`, 422)
}
