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
  close?(): Promise<void>
  listInstallations(): Promise<ProviderInstallation[]>
  listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]>
  createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<ProviderConfig>
  updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig>
  listAssistants(ownerId: string): Promise<Assistant[]>
  getAssistant(ownerId: string, id: string): Promise<Assistant | undefined>
  createAssistant(ownerId: string, name: string): Promise<Assistant>
  updateRole(ownerId: string, id: string, value: Record<string, unknown>, ifMatch: string): Promise<Assistant>
  getModelMemory(ownerId: string, id: string): Promise<ModelMemoryView>
  updateProviderSelection(ownerId: string, id: string, value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }, ifMatch: string): Promise<ModelMemoryView>
  setMemoryEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ModelMemoryView>
  publish(ownerId: string, id: string, ifMatch?: string): Promise<RuntimePublication>
  runtime(assistantId?: string): Promise<RuntimePublication | undefined>
  setRuntime(publication: RuntimePublication): Promise<void>
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
      for (const [kind, value] of Object.entries(initial.providers)) {
        if (!value || value.mode === 'disabled' || typeof value.providerId !== 'string' || !value.config || typeof value.config !== 'object') continue
        const installation = this.installations.find((item) => item.id === value.providerId)
        if (!installation) continue
        this.providerConfigs.set(value.providerId, { id: value.providerId, ownerId: 'local-owner', installationId: value.providerId, name: installation.displayNameKey, revision: 1, config: structuredClone(value.config as Record<string, unknown>), secretRefs: [], etag: etag(value.config), updatedAt: assistant.updatedAt })
        void kind
      }
      this.publication = { snapshot: initial, etag: etag(initial), updatedAt: assistant.updatedAt }
    }
  }

  async listInstallations(): Promise<ProviderInstallation[]> { return this.installations.map((item) => structuredClone(item)) }

  async listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]> {
    return [...this.providerConfigs.values()].filter((item) => item.ownerId === ownerId && (!kind || this.kind(item.installationId) === kind)).map((item) => structuredClone(item))
  }

  async createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<ProviderConfig> {
    const installation = this.installations.find((item) => item.id === value.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    validateJsonObject(value.config, installation.configSchema)
    const now = new Date().toISOString()
    const item: ProviderConfig = { id: randomUUID(), ownerId, installationId: value.installationId, name: value.name, revision: 1, config: structuredClone(value.config), secretRefs: value.secretRefs ?? [], etag: etag({ ...value.config, revision: 1 }), updatedAt: now }
    this.providerConfigs.set(item.id, item)
    return structuredClone(item)
  }

  async updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig> {
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

  async listAssistants(ownerId: string): Promise<Assistant[]> { return [...this.assistants.values()].filter((item) => item.ownerId === ownerId).map((item) => structuredClone(item)) }
  async getAssistant(ownerId: string, id: string): Promise<Assistant | undefined> {
    const item = this.assistants.get(id)
    return item && item.ownerId === ownerId ? structuredClone(item) : undefined
  }

  async createAssistant(ownerId: string, name: string): Promise<Assistant> {
    const now = new Date().toISOString()
    const item: Assistant = { id: randomUUID(), ownerId, name, role: {}, providerSelections: {}, draftRevision: 1, publishedRevision: null, etag: etag({ name, revision: 1, role: {}, providerSelections: {} }), updatedAt: now }
    this.assistants.set(item.id, item)
    return structuredClone(item)
  }

  async updateRole(ownerId: string, id: string, value: Record<string, unknown>, ifMatch: string): Promise<Assistant> {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    const next: Assistant = { ...current, role: structuredClone(value), draftRevision: current.draftRevision + 1, etag: etag({ ...value, revision: current.draftRevision + 1 }), updatedAt: new Date().toISOString() }
    this.assistants.set(id, next)
    return structuredClone(next)
  }

  async getModelMemory(ownerId: string, id: string): Promise<ModelMemoryView> {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    return this.modelMemory(current)
  }

  async updateProviderSelection(ownerId: string, id: string, value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }, ifMatch: string): Promise<ModelMemoryView> {
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

  async setMemoryEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ModelMemoryView> {
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

  async publish(ownerId: string, id: string, ifMatch?: string): Promise<RuntimePublication> {
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    if (!current.role.locale || !current.role.basePrompt) throw problem('CONFIG_NOT_PUBLISHABLE', 'Role configuration is incomplete', 422)
    const revision = current.draftRevision
    const resolvedProviders: Record<string, Record<string, unknown>> = {}
    for (const [kind, value] of Object.entries(current.providerSelections)) {
      if (!value || value.mode === 'disabled') {
        resolvedProviders[kind] = { mode: 'disabled' }
        continue
      }
      if (typeof value.providerId === 'string' && value.config && typeof value.config === 'object') {
        resolvedProviders[kind] = value
        continue
      }
      const selectedId = typeof value.providerConfigId === 'string' ? value.providerConfigId : undefined
      const selected = selectedId ? this.providerConfigs.get(selectedId) : undefined
      const installation = selected ? this.installations.find((item) => item.id === selected.installationId) : undefined
      if (!selected || !installation) throw problem('CONFIG_NOT_PUBLISHABLE', `Provider selection is not configured: ${kind}`, 422)
      resolvedProviders[kind] = { providerId: installation.id, version: installation.version, config: selected.config }
    }
    const snapshot: RuntimeSnapshot = {
      schemaVersion: 1,
      revision,
      assistantId: current.id,
      locale: String(current.role.locale),
      basePrompt: String(current.role.basePrompt),
      personality: (current.role.personality as Record<string, unknown> | undefined) ?? {},
      speech: (current.role.speech as Record<string, unknown> | undefined) ?? {},
      providers: resolvedProviders,
      wire: { profile: 'ws-v3', uplinkSampleRate: 16000, downlinkSampleRate: 24000, frameDurationMs: 60 },
    }
    current.publishedRevision = revision
    current.updatedAt = new Date().toISOString()
    this.assistants.set(id, current)
    this.publication = { snapshot, etag: etag(snapshot), updatedAt: current.updatedAt }
    return structuredClone(this.publication)
  }

  async runtime(assistantId?: string): Promise<RuntimePublication | undefined> {
    if (assistantId && this.publication?.snapshot.assistantId !== assistantId) return undefined
    return this.publication && structuredClone(this.publication)
  }
  async setRuntime(publication: RuntimePublication): Promise<void> { this.publication = structuredClone(publication) }

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
      availableConfigs: [...this.providerConfigs.values()].filter((item) => item.ownerId === current.ownerId).map((item) => { const installation = this.installations.find((candidate) => candidate.id === item.installationId); return { id: item.id, kind: installation?.kind ?? 'memory', name: item.name, providerName: installation?.displayNameKey ?? item.installationId, availability: 'ready' as const, supportedLocales: Array.isArray(installation?.manifest.locales) ? installation.manifest.locales.filter((value): value is string => typeof value === 'string') : ['*'] } }),
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
