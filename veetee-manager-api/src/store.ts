import { createHash, randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  MODEL_TYPES,
  cloneModelConfig,
  cloneModelProvider,
  modelConfigId,
  modelEtag,
  modelProviderId,
  newModelConfig,
  newModelProvider,
  normalizeModelConfigInput,
  normalizeModelProviderInput,
  type ModelConfig,
  type ModelConfigInput,
  type ModelConfigPage,
  type ModelConfigQuery,
  type ModelProvider,
  type ModelProviderInput,
  type ModelProviderField,
  type ModelTtsVoiceSeed,
  type ModelType,
} from './model-registry.js'

export { MODEL_TYPES }
export type { ModelConfig, ModelConfigInput, ModelConfigPage, ModelConfigQuery, ModelProvider, ModelProviderField, ModelProviderInput, ModelTtsVoiceSeed, ModelType }

export type ProviderKind = 'vad' | 'asr' | 'llm' | 'tts' | 'intent' | 'memory'

export interface ProviderInstallation {
  id: string
  kind: ProviderKind
  displayNameKey: string
  displayName?: string
  version: string
  manifest: Record<string, unknown>
  configSchema: Record<string, unknown>
}

/**
 * Normalize provider-family aliases at the persistence boundary.  The
 * OpenAI-compatible family historically called its endpoint `endpoint`; the
 * public contract now uses the standard `baseUrl`.  Keeping this conversion
 * here means every store, including PostgreSQL and the memory adapter, writes
 * one canonical shape while old clients/revisions remain readable.
 */
export function normalizeProviderConfig(installation: ProviderInstallation, value: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(value)
  const family = installation.manifest.providerFamily
  if (family === 'openai-compatible' && typeof next.baseUrl !== 'string' && typeof next.endpoint === 'string') {
    next.baseUrl = next.endpoint
    delete next.endpoint
  } else if (family === 'openai-compatible' && typeof next.baseUrl === 'string' && 'endpoint' in next) {
    delete next.endpoint
  }
  return next
}

export interface ProviderConfig {
  id: string
  ownerId: string
  installationId: string
  name: string
  enabled: boolean
  revision: number
  config: Record<string, unknown>
  secretRefs: string[]
  etag: string
  updatedAt: string
  /** Archived configs keep immutable revisions but are hidden from selection. */
  archivedAt?: string | null
}

export type ProviderProbeCheckState = 'passed' | 'failed' | 'skipped'

export interface ProviderProbeResult {
  providerConfigId: string
  state: 'ready' | 'unavailable'
  checkedAt: string
  durationMs: number
  checks: Array<{ id: string; state: ProviderProbeCheckState; message: string }>
}

/**
 * A voice profile is a user-managed TTS voice, not a provider implementation.
 * Built-in voices are exposed from an installation manifest; custom voices are
 * stored here and reference one concrete TTS provider configuration.
 */
export interface VoiceProfile {
  id: string
  ownerId: string
  providerConfigId: string
  name: string
  locale: string
  voiceCode: string
  description: string
  demoUrl: string | null
  enabled: boolean
  sort: number
  revision: number
  etag: string
  updatedAt: string
  archivedAt?: string | null
}

export interface Assistant {
  id: string
  ownerId: string
  name: string
  role: Record<string, unknown>
  providerSelections: Record<string, Record<string, unknown>>
  draftRevision: number
  publishedRevision: number | null
  deviceCount: number
  onlineDeviceCount: number
  lastConversationAt: string | null
  etag: string
  updatedAt: string
}

type AssistantRecord = Omit<Assistant, 'deviceCount' | 'onlineDeviceCount' | 'lastConversationAt'>

export interface Device {
  id: string
  ownerId: string
  assistantId: string
  etag: string
  displayName: string
  maskedMac: string
  firmwareVersion: string
  board: string
  onlineState: 'online' | 'offline'
  lastSeenAt: string
  lastConversationAt: string | null
}

export interface DevicePresenceInput {
  identityHash: string
  clientIdHash: string
  maskedMac: string
  firmwareVersion: string
  board: string
  onlineState: 'online' | 'offline'
  /** SHA-256 of the six-digit code displayed by firmware; never plaintext. */
  pairingCodeHash?: string
}

export interface DevicePresenceResult {
  id: string
  paired: boolean
  onlineState: 'online' | 'offline'
  lastSeenAt: string
}

export interface DiscoverableDevice {
  id: string
  maskedMac: string
  board: string
  firmwareVersion: string
  onlineState: 'online' | 'offline'
  lastSeenAt: string
  pairingExpiresAt: string | null
}

export const DEFAULT_DEVICE_ONLINE_TTL_SECONDS = 120

export interface PresenceStoreOptions {
  onlineTtlSeconds?: number
  tombstoneTtlSeconds?: number
  now?: () => Date
}

export function isPresenceFresh(
  lastSeenAt: string | Date,
  onlineState: 'online' | 'offline',
  now: Date,
  ttlMs: number,
): boolean {
  if (onlineState !== 'online') return false
  const lastSeen = lastSeenAt instanceof Date ? lastSeenAt.getTime() : Date.parse(lastSeenAt)
  if (!Number.isFinite(lastSeen) || !Number.isFinite(now.getTime()) || ttlMs <= 0) return false
  return lastSeen >= now.getTime() - ttlMs
}

export interface RetentionPurgeResult {
  conversations: number
}

export type RetentionDeleteJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface RetentionDeleteJob {
  id: string
  conversationId: string
  status: RetentionDeleteJobStatus
  requestedAt: string
  startedAt: string | null
  completedAt: string | null
  errorCode: string | null
}

export interface PairingChallenge {
  id: string
  deviceId: string
  verificationCode: string
  expiresAt: string
}

export type ConversationStatus = 'active' | 'completed' | 'aborted' | 'error'
export type TurnState = 'completed' | 'aborted' | 'error'

export interface RetentionPolicy {
  ownerId: string
  captureTranscript: boolean
  transcriptDays: number | null
  captureAudio: boolean
  audioDays: number | null
  effectiveAt: string
  revision: number
  etag: string
}

export interface TranscriptSegment {
  speaker: 'user' | 'assistant' | 'system'
  text: string
  locale: string
  confidence: number | null
  startedAtMs: number | null
  endedAtMs: number | null
  isFinal: boolean
}

export interface ToolCallRecord {
  toolName: string
  source: 'llm' | 'system'
  status: 'completed' | 'error' | 'cancelled'
  startedAt: string
  endedAt: string | null
  latencyMs: number | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  errorCode: string | null
}

export interface ConversationTurn {
  id: string
  conversationId: string
  turnId: string
  sequence: number
  state: TurnState
  startedAt: string
  endedAt: string
  finishReason: string
  timings: Record<string, number>
  transcript: TranscriptSegment[]
  toolCalls: ToolCallRecord[]
}

export interface ConversationSummary {
  id: string
  assistantId: string
  deviceKey: string | null
  startedAt: string
  endedAt: string | null
  locale: string
  configRevision: number
  status: ConversationStatus
  turnCount: number
  lastTurnAt: string | null
  aggregateTimings: Record<string, number>
  retentionUntil: string | null
}

export interface ConversationDetail {
  summary: ConversationSummary
  turns: ConversationTurn[]
  retention: RetentionPolicy
}

export interface ConversationTurnInput {
  conversationId: string
  assistantId: string
  deviceKey?: string
  locale: string
  configRevision: number
  conversationStartedAt: string
  conversationEndedAt?: string
  conversationStatus?: ConversationStatus
  turnId: string
  sequence: number
  state: TurnState
  startedAt: string
  endedAt: string
  finishReason: string
  timings: Record<string, number>
  transcript: TranscriptSegment[]
  toolCalls: ToolCallRecord[]
}

interface DeviceRecord extends Omit<Device, 'etag'> {
  identityHash: string
  clientIdHash: string
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

export const DEFAULT_CONVERSATION_POLICY: Record<string, unknown> = {
  continuous: false,
  idleTimeoutMs: 180000,
  idleAlert: { status: 'ok', message: '', emotion: 'neutral' },
}

/*
 * A snapshot carries both the runtime envelope and assistant-owned policy. Keep
 * the envelope keys out of `role`, but preserve every additive policy field so
 * a Manager publish cannot silently drop progress/tool/latency configuration.
 * New policy fields therefore pass through without a code change in this store;
 * the route schema remains the boundary that decides what the owner may edit.
 */
const SNAPSHOT_ENVELOPE_KEYS = new Set([
  'schemaVersion', 'revision', 'assistantId', 'locale', 'basePrompt',
  'personality', 'speech', 'providers', 'wire',
])

export function roleFromSnapshot(snapshot: RuntimeSnapshot): Record<string, unknown> {
  const extras = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !SNAPSHOT_ENVELOPE_KEYS.has(key)))
  return {
    ...extras,
    locale: snapshot.locale,
    basePrompt: snapshot.basePrompt,
    personality: structuredClone(snapshot.personality),
    speech: structuredClone(snapshot.speech),
  }
}

export function roleExtras(role: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(role).filter(([key]) => !SNAPSHOT_ENVELOPE_KEYS.has(key)))
}

export interface RuntimePublication {
  snapshot: RuntimeSnapshot
  etag: string
  updatedAt: string
}

export interface ManagerSession {
  id: string
  ownerId: string
  tokenHash: string
  csrfHash: string
  expiresAt: string
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
}

export interface SecretReference {
  id: string
  ownerId: string
  name: string
  store: 'encrypted-local'
  locatorMasked: string
  version: number
  metadataRevision: number
  status: 'available' | 'unavailable' | 'revoked'
  lastRotatedAt: string | null
  etag: string
  updatedAt: string
}

/**
 * Metadata mutation for a secret reference. The plaintext value never crosses
 * the Store boundary; the API writes it to SecretValueStore first and passes
 * only the resulting version/status metadata here.
 */
export interface SecretReferenceUpdate {
  name?: string
  locatorMasked?: string
  version?: number
  status?: SecretReference['status']
  lastRotatedAt?: string | null
}

export interface ModelMemoryView {
  assistantId: string
  selections: Array<{ kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }>
  availableConfigs: Array<{ id: string; kind: ProviderKind; name: string; providerName: string; availability: 'ready' | 'unavailable' | 'disabled'; supportedLocales: string[] }>
  memory: { enabled: boolean; itemCount: number }
  memoryItems: Array<{ id: string; kind: string; content: string; enabled: boolean; updatedAt: string }>
}

export interface ModelRegistrySeed {
  providers: ModelProviderInput[]
  configs: ModelConfigInput[]
  voices?: ModelTtsVoiceSeed[]
}

export interface Store {
  close?(): Promise<void>
  listModelProviders(ownerId: string, query?: { modelType?: ModelType; name?: string }): Promise<ModelProvider[]>
  createModelProvider(ownerId: string, input: ModelProviderInput): Promise<ModelProvider>
  updateModelProvider(ownerId: string, id: string, input: Partial<ModelProviderInput>, ifMatch?: string): Promise<ModelProvider>
  deleteModelProvider(ownerId: string, id: string, ifMatch?: string): Promise<void>
  listModelConfigs(ownerId: string, query?: ModelConfigQuery): Promise<ModelConfigPage>
  getModelConfig(ownerId: string, id: string): Promise<ModelConfig | undefined>
  createModelConfig(ownerId: string, input: ModelConfigInput): Promise<ModelConfig>
  updateModelConfig(ownerId: string, id: string, input: Partial<ModelConfigInput>, ifMatch?: string): Promise<ModelConfig>
  deleteModelConfig(ownerId: string, id: string, ifMatch?: string): Promise<void>
  setModelEnabled(ownerId: string, id: string, enabled: boolean): Promise<ModelConfig>
  setDefaultModel(ownerId: string, id: string): Promise<ModelConfig>
  listInstallations(): Promise<ProviderInstallation[]>
  listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]>
  createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<ProviderConfig>
  updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig>
  setProviderConfigEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ProviderConfig>
  deleteProviderConfig(ownerId: string, id: string, ifMatch: string): Promise<void>
  probeProviderConfig(ownerId: string, id: string): Promise<ProviderProbeResult>
  listVoiceProfiles(ownerId: string, options?: { locale?: string; providerConfigId?: string }): Promise<VoiceProfile[]>
  createVoiceProfile(ownerId: string, value: Omit<VoiceProfile, 'id' | 'ownerId' | 'revision' | 'etag' | 'updatedAt' | 'archivedAt'>): Promise<VoiceProfile>
  updateVoiceProfile(ownerId: string, id: string, value: Partial<Pick<VoiceProfile, 'name' | 'locale' | 'voiceCode' | 'description' | 'demoUrl' | 'enabled' | 'sort'>>, ifMatch: string): Promise<VoiceProfile>
  deleteVoiceProfile(ownerId: string, id: string, ifMatch: string): Promise<void>
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
  createSession(ownerId: string, tokenHash: string, csrfHash: string, expiresAt: Date): Promise<ManagerSession>
  findSession(tokenHash: string): Promise<ManagerSession | undefined>
  revokeSession(tokenHash: string): Promise<void>
  listSecretReferences(ownerId: string): Promise<SecretReference[]>
  createSecretReference(ownerId: string, value: { id: string; name: string; locatorMasked: string; version: number; status: SecretReference['status'] }): Promise<SecretReference>
  updateSecretReference(ownerId: string, id: string, value: SecretReferenceUpdate, ifMatch: string): Promise<SecretReference>
  deleteSecretReference(ownerId: string, id: string, ifMatch: string): Promise<void>
  listDevices(ownerId: string, assistantId: string): Promise<Device[]>
  listDiscoverableDevices(ownerId: string): Promise<DiscoverableDevice[]>
  reportDevicePresence(value: DevicePresenceInput): Promise<DevicePresenceResult>
  createPairingChallenge(value: { identityHash: string; clientIdHash: string; maskedMac: string; board: string; firmwareVersion: string }): Promise<PairingChallenge>
  pairDevice(ownerId: string, value: { assistantId: string; deviceId?: string; verificationCode: string; displayName?: string }): Promise<Device>
  unlinkDevice(ownerId: string, id: string, ifMatch: string): Promise<void>
  getRetentionPolicy(ownerId: string): Promise<RetentionPolicy>
  updateRetentionPolicy(ownerId: string, value: Pick<RetentionPolicy, 'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'>, ifMatch: string): Promise<RetentionPolicy>
  purgeExpiredConversations(now?: Date): Promise<RetentionPurgeResult>
  requestConversationDelete(ownerId: string, conversationId: string): Promise<RetentionDeleteJob>
  runConversationDeleteJob(jobId: string): Promise<RetentionDeleteJob>
  getRetentionDeleteJob(ownerId: string, jobId: string): Promise<RetentionDeleteJob | undefined>
  ingestConversationTurn(value: ConversationTurnInput): Promise<ConversationDetail>
  listConversations(ownerId: string, assistantId: string, limit: number): Promise<ConversationSummary[]>
  getConversation(ownerId: string, id: string): Promise<ConversationDetail | undefined>
}

export class InMemoryStore implements Store {
  private readonly installations: ProviderInstallation[]
  private readonly modelProviders = new Map<string, ModelProvider>()
  private readonly modelConfigs = new Map<string, ModelConfig>()
  private readonly providerConfigs = new Map<string, ProviderConfig>()
  private readonly providerConfigSecretRefs = new Map<string, Set<string>>()
  private readonly voiceProfiles = new Map<string, VoiceProfile>()
  private readonly assistants = new Map<string, AssistantRecord>()
  private readonly sessions = new Map<string, ManagerSession>()
  private readonly secretReferences = new Map<string, SecretReference>()
  private readonly devices = new Map<string, DeviceRecord>()
  private readonly pairingChallenges = new Map<string, { id: string; deviceId: string; codeHash: string; expiresAt: string; attempts: number; state: 'pending' | 'used' }>()
  private readonly retentionPolicies = new Map<string, RetentionPolicy>()
  private readonly conversations = new Map<string, { ownerId: string; summary: ConversationSummary; turns: ConversationTurn[] }>()
  private readonly retentionDeleteJobs = new Map<string, { ownerId: string; conversationId: string; attempts: number; job: RetentionDeleteJob }>()
  private readonly conversationTombstones = new Map<string, { ownerId: string; deletedAt: string; expiresAt: string; reason: 'owner_request' | 'retention_expired'; jobId: string | null }>()
  private readonly presenceTtlMs: number
  private readonly tombstoneTtlMs: number
  private readonly clock: () => Date
  private publication: RuntimePublication | undefined

  constructor(installations: ProviderInstallation[], initial?: RuntimeSnapshot, options: PresenceStoreOptions = {}, registry?: ModelRegistrySeed) {
    this.installations = installations
    this.presenceTtlMs = (options.onlineTtlSeconds ?? DEFAULT_DEVICE_ONLINE_TTL_SECONDS) * 1000
    this.tombstoneTtlMs = Math.max(60, options.tombstoneTtlSeconds ?? 604800) * 1000
    this.clock = options.now ?? (() => new Date())
    if (registry) this.seedModelRegistry(registry)
    if (initial) {
      const assistant: AssistantRecord = {
        id: initial.assistantId,
        ownerId: 'local-owner',
        name: 'Veetee',
        role: roleFromSnapshot(initial),
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
        const providerConfig = normalizeProviderConfig(installation, value.config as Record<string, unknown>)
        this.providerConfigs.set(value.providerId, { id: value.providerId, ownerId: 'local-owner', installationId: value.providerId, name: installation.displayNameKey, enabled: true, revision: 1, config: providerConfig, secretRefs: [], etag: etag({ ...providerConfig, revision: 1, enabled: true }), updatedAt: assistant.updatedAt })
        this.providerConfigSecretRefs.set(value.providerId, new Set())
        void kind
      }
      this.publication = { snapshot: initial, etag: etag(initial), updatedAt: assistant.updatedAt }
    }
  }

  async listModelProviders(ownerId: string, query: { modelType?: ModelType; name?: string } = {}): Promise<ModelProvider[]> {
    const term = normalizeSearch(query.name ?? '')
    return [...this.modelProviders.values()]
      .filter((item) => item.ownerId === ownerId)
      .filter((item) => !query.modelType || item.modelType === query.modelType)
      .filter((item) => !term || normalizeSearch(`${item.name} ${item.providerCode} ${item.modelType}`).includes(term))
      .sort((left, right) => left.modelType.localeCompare(right.modelType) || left.sort - right.sort || left.name.localeCompare(right.name, 'vi'))
      .map(cloneModelProvider)
  }

  async createModelProvider(ownerId: string, input: ModelProviderInput): Promise<ModelProvider> {
    const normalized = normalizeModelProviderInput(input)
    const id = modelProviderId(normalized.modelType, normalized.providerCode)
    if ([...this.modelProviders.values()].some((item) => item.ownerId === ownerId && (item.id === id || (item.modelType === normalized.modelType && item.providerCode.toLowerCase() === normalized.providerCode.toLowerCase())))) throw problem('NAME_CONFLICT', 'Model provider already exists', 409)
    const item = newModelProvider(ownerId, normalized)
    this.modelProviders.set(id, item)
    return cloneModelProvider(item)
  }

  async updateModelProvider(ownerId: string, id: string, input: Partial<ModelProviderInput>, ifMatch?: string): Promise<ModelProvider> {
    const current = this.modelProviders.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Model provider not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model provider changed', 409)
    const nextInput = normalizeModelProviderInput({ modelType: input.modelType ?? current.modelType, providerCode: input.providerCode ?? current.providerCode, name: input.name ?? current.name, fields: input.fields ?? current.fields, sort: input.sort ?? current.sort })
    const nextId = modelProviderId(nextInput.modelType, nextInput.providerCode)
    const duplicate = [...this.modelProviders.values()].some((item) => item.ownerId === ownerId && item.id !== id && item.id === nextId)
    if (duplicate) throw problem('NAME_CONFLICT', 'Model provider already exists', 409)
    if (nextId !== id && [...this.modelConfigs.values()].some((item) => item.ownerId === ownerId && item.providerCode === current.providerCode && item.modelType === current.modelType)) throw problem('RESOURCE_IN_USE', 'Model provider is used by a model config', 409)
    const revision = current.revision + 1
    const now = new Date().toISOString()
    const next: ModelProvider = { id: nextId, ownerId, ...nextInput, sort: nextInput.sort ?? 0, revision, etag: modelEtag({ id: nextId, ownerId, ...nextInput, sort: nextInput.sort ?? 0, revision }), updatedAt: now }
    this.modelProviders.delete(id)
    this.modelProviders.set(nextId, next)
    return cloneModelProvider(next)
  }

  async deleteModelProvider(ownerId: string, id: string, ifMatch?: string): Promise<void> {
    const current = this.modelProviders.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Model provider not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model provider changed', 409)
    if ([...this.modelConfigs.values()].some((item) => item.ownerId === ownerId && item.modelType === current.modelType && item.providerCode === current.providerCode)) throw problem('RESOURCE_IN_USE', 'Model provider is used by a model config', 409)
    this.modelProviders.delete(id)
  }

  async listModelConfigs(ownerId: string, query: ModelConfigQuery = {}): Promise<ModelConfigPage> {
    const term = normalizeSearch(query.modelName ?? '')
    const all = [...this.modelConfigs.values()]
      .filter((item) => item.ownerId === ownerId)
      .filter((item) => !query.modelType || item.modelType === query.modelType)
      .filter((item) => !term || normalizeSearch(`${item.modelName} ${item.modelCode} ${item.providerCode}`).includes(term))
      .sort((left, right) => left.sort - right.sort || left.modelName.localeCompare(right.modelName, 'vi'))
    const page = Math.max(1, Math.trunc(query.page ?? 1))
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 10)))
    return { items: all.slice((page - 1) * limit, page * limit).map(cloneModelConfig), total: all.length, page, limit }
  }

  async getModelConfig(ownerId: string, id: string): Promise<ModelConfig | undefined> {
    const item = this.modelConfigs.get(id)
    return item && item.ownerId === ownerId ? cloneModelConfig(item) : undefined
  }

  async createModelConfig(ownerId: string, input: ModelConfigInput): Promise<ModelConfig> {
    const normalized = normalizeModelConfigInput(input)
    this.assertModelProvider(ownerId, normalized.modelType, normalized.providerCode)
    const id = normalized.id?.trim() || modelConfigId(normalized.modelType, normalized.modelCode)
    if (this.modelConfigs.has(id)) throw problem('NAME_CONFLICT', 'Model config already exists', 409)
    const item = newModelConfig(ownerId, { ...normalized, id })
    if (item.isDefault) this.clearDefault(ownerId, item.modelType)
    this.modelConfigs.set(item.id, item)
    return cloneModelConfig(item)
  }

  async updateModelConfig(ownerId: string, id: string, input: Partial<ModelConfigInput>, ifMatch?: string): Promise<ModelConfig> {
    const current = this.modelConfigs.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Model config not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model config changed', 409)
    const normalized = normalizeModelConfigInput({ modelType: input.modelType ?? current.modelType, providerCode: input.providerCode ?? current.providerCode, id, modelCode: input.modelCode ?? current.modelCode, modelName: input.modelName ?? current.modelName, isDefault: input.isDefault ?? current.isDefault, isEnabled: input.isEnabled ?? current.isEnabled, configJson: input.configJson ?? current.configJson, docLink: input.docLink ?? current.docLink, remark: input.remark ?? current.remark, sort: input.sort ?? current.sort })
    this.assertModelProvider(ownerId, normalized.modelType, normalized.providerCode)
    const revision = current.revision + 1
    const next = newModelConfig(ownerId, { ...normalized, id }, revision)
    if (next.isDefault) this.clearDefault(ownerId, next.modelType, id)
    this.modelConfigs.set(id, next)
    return cloneModelConfig(next)
  }

  async deleteModelConfig(ownerId: string, id: string, ifMatch?: string): Promise<void> {
    const current = this.modelConfigs.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Model config not found', 404)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model config changed', 409)
    this.modelConfigs.delete(id)
  }

  async setModelEnabled(ownerId: string, id: string, enabled: boolean): Promise<ModelConfig> {
    return this.updateModelConfig(ownerId, id, { isEnabled: enabled })
  }

  async setDefaultModel(ownerId: string, id: string): Promise<ModelConfig> {
    const current = this.modelConfigs.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Model config not found', 404)
    this.clearDefault(ownerId, current.modelType, id)
    // A disabled model cannot be a usable default. Keep this behavior aligned
    // with the PostgreSQL adapter and the source management screen.
    return this.updateModelConfig(ownerId, id, { isDefault: true, isEnabled: true })
  }

  private clearDefault(ownerId: string, modelType: ModelType, exceptId?: string): void {
    for (const [id, item] of this.modelConfigs) {
      if (item.ownerId !== ownerId || item.modelType !== modelType || id === exceptId || !item.isDefault) continue
      this.modelConfigs.set(id, { ...item, isDefault: false, revision: item.revision + 1, etag: modelEtag({ ...item, isDefault: false, revision: item.revision + 1 }), updatedAt: new Date().toISOString() })
    }
  }

  private assertModelProvider(ownerId: string, modelType: ModelType, providerCode: string): void {
    if (![...this.modelProviders.values()].some((item) => item.ownerId === ownerId && item.modelType === modelType && item.providerCode === providerCode)) throw problem('CONFIG_INVALID', 'Model provider does not exist for this category', 422)
  }

  private seedModelRegistry(registry: ModelRegistrySeed): void {
    for (const provider of registry.providers) {
      try { const item = newModelProvider('local-owner', provider); this.modelProviders.set(item.id, item) } catch { /* invalid seed is ignored; parser validates runtime files */ }
    }
    for (const config of registry.configs) {
      try {
        const item = newModelConfig('local-owner', config)
        // Source rows keep their own stable provider id (which may differ in
        // casing or naming from the generated SYSTEM_<type>_<code> id). Match
        // by the source business key, just like the relational adapter does.
        const providerExists = [...this.modelProviders.values()].some((provider) => provider.modelType === item.modelType && provider.providerCode === item.providerCode)
        if (providerExists) this.modelConfigs.set(item.id, item)
      } catch { /* invalid seed is ignored */ }
    }
  }

  async listInstallations(): Promise<ProviderInstallation[]> { return this.installations.map((item) => structuredClone(item)) }

  async listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]> {
    return [...this.providerConfigs.values()].filter((item) => item.ownerId === ownerId && !item.archivedAt && (!kind || this.kind(item.installationId) === kind)).map((item) => structuredClone(item))
  }

  async createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<ProviderConfig> {
    const installation = this.installations.find((item) => item.id === value.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    const config = normalizeProviderConfig(installation, value.config)
    validateJsonObject(config, installation.configSchema)
    this.assertProviderNameAvailable(ownerId, value.name)
    const secretRefs = [...(value.secretRefs ?? [])]
    validateSecretBindings(installation, secretRefs)
    for (const referenceId of secretRefs) if (!this.secretReferences.has(referenceId) || this.secretReferences.get(referenceId)?.ownerId !== ownerId || this.secretReferences.get(referenceId)?.status !== 'available') throw problem('SECRET_INVALID', 'One or more secret references are unavailable', 422)
    const now = new Date().toISOString()
    const item: ProviderConfig = { id: randomUUID(), ownerId, installationId: value.installationId, name: value.name.trim(), enabled: true, revision: 1, config: structuredClone(config), secretRefs, etag: etag({ ...config, revision: 1, enabled: true }), updatedAt: now, archivedAt: null }
    this.providerConfigs.set(item.id, item)
    this.providerConfigSecretRefs.set(item.id, new Set(item.secretRefs))
    return structuredClone(item)
  }

  async updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig> {
    const current = this.providerConfigs.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (current.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    const installation = this.installations.find((item) => item.id === current.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    const config = normalizeProviderConfig(installation, value.config ?? current.config)
    validateJsonObject(config, installation.configSchema)
    if (value.name !== undefined) this.assertProviderNameAvailable(ownerId, value.name, id)
    const secretRefs = [...(value.secretRefs ?? current.secretRefs)]
    validateSecretBindings(installation, secretRefs)
    for (const referenceId of secretRefs) if (!this.secretReferences.has(referenceId) || this.secretReferences.get(referenceId)?.ownerId !== ownerId || this.secretReferences.get(referenceId)?.status !== 'available') throw problem('SECRET_INVALID', 'One or more secret references are unavailable', 422)
    const nextRevision = current.revision + 1
    const next: ProviderConfig = { ...current, name: value.name?.trim() ?? current.name, config: structuredClone(config), secretRefs, revision: nextRevision, etag: etag({ ...config, revision: nextRevision, enabled: current.enabled }), updatedAt: new Date().toISOString() }
    this.providerConfigs.set(id, next)
    const historicalRefs = this.providerConfigSecretRefs.get(id) ?? new Set<string>()
    for (const referenceId of next.secretRefs) historicalRefs.add(referenceId)
    this.providerConfigSecretRefs.set(id, historicalRefs)
    return structuredClone(next)
  }

  async setProviderConfigEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ProviderConfig> {
    const current = this.providerConfigs.get(id)
    if (!current || current.ownerId !== ownerId || current.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    if (!enabled && this.providerConfigInUse(ownerId, id)) {
      throw problem('RESOURCE_IN_USE', 'Provider config is selected by an assistant', 409)
    }
    const next: ProviderConfig = { ...current, enabled, etag: etag({ ...current.config, revision: current.revision, enabled }), updatedAt: new Date().toISOString() }
    this.providerConfigs.set(id, next)
    return structuredClone(next)
  }

  async deleteProviderConfig(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const current = this.providerConfigs.get(id)
    if (!current || current.ownerId !== ownerId || current.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    if (this.providerConfigInUse(ownerId, id)) throw problem('RESOURCE_IN_USE', 'Provider config is selected by an assistant', 409)
    current.archivedAt = new Date().toISOString()
    current.updatedAt = current.archivedAt
    this.providerConfigs.set(id, current)
  }

  async probeProviderConfig(ownerId: string, id: string): Promise<ProviderProbeResult> {
    const started = Date.now()
    const current = this.providerConfigs.get(id)
    if (!current || current.ownerId !== ownerId || current.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    const installation = this.installations.find((item) => item.id === current.installationId)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    const checks: ProviderProbeResult['checks'] = []
    try {
      validateJsonObject(current.config, installation.configSchema)
      checks.push({ id: 'schema', state: 'passed', message: 'Cấu hình hợp lệ.' })
    } catch {
      checks.push({ id: 'schema', state: 'failed', message: 'Config không khớp JSON Schema.' })
    }
    const secretsReady = current.secretRefs.every((ref) => this.secretReferences.get(ref)?.ownerId === ownerId && this.secretReferences.get(ref)?.status === 'available')
    checks.push({ id: 'secrets', state: secretsReady ? 'passed' : 'failed', message: secretsReady ? 'Khóa kết nối đã sẵn sàng.' : 'Có khóa kết nối thiếu hoặc không khả dụng.' })
    checks.push({ id: 'manifest', state: 'passed', message: 'Dịch vụ đã được nạp.' })
    const state = checks.some((check) => check.state === 'failed') ? 'unavailable' : 'ready'
    return { providerConfigId: id, state, checkedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - started), checks }
  }

  async listVoiceProfiles(ownerId: string, options: { locale?: string; providerConfigId?: string } = {}): Promise<VoiceProfile[]> {
    return [...this.voiceProfiles.values()]
      .filter((item) => item.ownerId === ownerId && !item.archivedAt)
      .filter((item) => !options.locale || item.locale === options.locale)
      .filter((item) => !options.providerConfigId || item.providerConfigId === options.providerConfigId)
      .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name, 'vi'))
      .map((item) => structuredClone(item))
  }

  async createVoiceProfile(ownerId: string, value: Omit<VoiceProfile, 'id' | 'ownerId' | 'revision' | 'etag' | 'updatedAt' | 'archivedAt'>): Promise<VoiceProfile> {
    this.assertTtsConfig(ownerId, value.providerConfigId)
    validateVoiceValue(value)
    const duplicate = [...this.voiceProfiles.values()].some((item) => item.ownerId === ownerId && !item.archivedAt && item.providerConfigId === value.providerConfigId && item.voiceCode === value.voiceCode)
    if (duplicate) throw problem('VOICE_DUPLICATE', 'Voice code already exists for this TTS config', 409)
    const revision = 1
    const item: VoiceProfile = { ...structuredClone(value), id: randomUUID(), ownerId, revision, etag: etag({ ...value, revision }), updatedAt: new Date().toISOString(), archivedAt: null }
    this.voiceProfiles.set(item.id, item)
    return structuredClone(item)
  }

  async updateVoiceProfile(ownerId: string, id: string, value: Partial<Pick<VoiceProfile, 'name' | 'locale' | 'voiceCode' | 'description' | 'demoUrl' | 'enabled' | 'sort'>>, ifMatch: string): Promise<VoiceProfile> {
    const current = this.voiceProfiles.get(id)
    if (!current || current.ownerId !== ownerId || current.archivedAt) throw problem('NOT_FOUND', 'Voice profile not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
    const next = { ...current, ...structuredClone(value), revision: current.revision + 1, updatedAt: new Date().toISOString() }
    validateVoiceValue(next)
    const duplicate = [...this.voiceProfiles.values()].some((item) => item.id !== id && item.ownerId === ownerId && !item.archivedAt && item.providerConfigId === next.providerConfigId && item.voiceCode === next.voiceCode)
    if (duplicate) throw problem('VOICE_DUPLICATE', 'Voice code already exists for this TTS config', 409)
    next.etag = etag({ ...next, revision: next.revision })
    this.voiceProfiles.set(id, next)
    return structuredClone(next)
  }

  async deleteVoiceProfile(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const current = this.voiceProfiles.get(id)
    if (!current || current.ownerId !== ownerId || current.archivedAt) throw problem('NOT_FOUND', 'Voice profile not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
    current.archivedAt = new Date().toISOString()
    current.updatedAt = current.archivedAt
    this.voiceProfiles.set(id, current)
  }

  private assertTtsConfig(ownerId: string, providerConfigId: string): void {
    const config = this.providerConfigs.get(providerConfigId)
    const installation = config ? this.installations.find((item) => item.id === config.installationId) : undefined
    if (!config || config.ownerId !== ownerId || config.archivedAt || installation?.kind !== 'tts') throw problem('CONFIG_INVALID', 'Voice profile requires an active TTS provider config', 422)
  }

  async listAssistants(ownerId: string): Promise<Assistant[]> {
    await this.purgeExpiredConversations()
    return [...this.assistants.values()]
      .filter((item) => item.ownerId === ownerId)
      .map((item) => this.withAssistantSummary(item))
  }
  async getAssistant(ownerId: string, id: string): Promise<Assistant | undefined> {
    await this.purgeExpiredConversations()
    const item = this.assistants.get(id)
    return item && item.ownerId === ownerId ? this.withAssistantSummary(item) : undefined
  }

  async createAssistant(ownerId: string, name: string): Promise<Assistant> {
    const now = new Date().toISOString()
    const item: AssistantRecord = { id: randomUUID(), ownerId, name, role: {}, providerSelections: {}, draftRevision: 1, publishedRevision: null, etag: etag({ name, revision: 1, role: {}, providerSelections: {} }), updatedAt: now }
    this.assistants.set(item.id, item)
    return this.withAssistantSummary(item)
  }

  async updateRole(ownerId: string, id: string, value: Record<string, unknown>, ifMatch: string): Promise<Assistant> {
    await this.purgeExpiredConversations()
    const current = this.assistants.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    const next: AssistantRecord = { ...current, role: structuredClone(value), draftRevision: current.draftRevision + 1, etag: etag({ ...value, revision: current.draftRevision + 1 }), updatedAt: new Date().toISOString() }
    this.assistants.set(id, next)
    return this.withAssistantSummary(next)
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
    validateProviderSelectionShape(value)
    if (value.mode === 'selected') {
      const selected = this.providerConfigs.get(value.providerConfigId!)
      const installation = selected ? this.installations.find((item) => item.id === selected.installationId) : undefined
      if (!selected || selected.ownerId !== ownerId || !installation) throw problem('CONFIG_INVALID', 'Provider config is not available for this owner', 422)
      if (installation.kind !== value.kind) throw problem('CONFIG_INVALID', 'Provider config kind does not match selection kind', 422)
      if (!selected.enabled) throw problem('CONFIG_INVALID', 'Provider config is disabled', 422)
    }
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
        const installation = this.installations.find((item) => item.id === value.providerId)
        if (!installation) throw problem('CONFIG_NOT_PUBLISHABLE', `Provider installation is not configured: ${kind}`, 422)
        validateSecretBindings(installation, Array.isArray(value.secretRefs) ? value.secretRefs.filter((item): item is string => typeof item === 'string') : [], { requireComplete: true })
        resolvedProviders[kind] = value
        continue
      }
      const selectedId = typeof value.providerConfigId === 'string' ? value.providerConfigId : undefined
      const selected = selectedId ? this.providerConfigs.get(selectedId) : undefined
      const installation = selected ? this.installations.find((item) => item.id === selected.installationId) : undefined
      if (!selected || !installation) throw problem('CONFIG_NOT_PUBLISHABLE', `Provider selection is not configured: ${kind}`, 422)
      validateSecretBindings(installation, selected.secretRefs, { requireComplete: true })
      resolvedProviders[kind] = {
        providerId: installation.id,
        version: installation.version,
        providerConfigId: selected.id,
        configRevision: selected.revision,
        config: structuredClone(selected.config),
        secretRefs: [...selected.secretRefs],
      }
    }
    const snapshot: RuntimeSnapshot = {
      ...roleExtras(current.role),
      schemaVersion: 1,
      revision,
      assistantId: current.id,
      locale: String(current.role.locale),
      basePrompt: String(current.role.basePrompt),
      personality: (current.role.personality as Record<string, unknown> | undefined) ?? {},
      speech: (current.role.speech as Record<string, unknown> | undefined) ?? {},
      providers: resolvedProviders,
      wire: { profile: 'ws-v3', uplinkSampleRate: 16000, downlinkSampleRate: 24000, frameDurationMs: 60 },
      conversation: isRecord(current.role.conversation) ? structuredClone(current.role.conversation) : structuredClone(DEFAULT_CONVERSATION_POLICY),
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

  async createSession(ownerId: string, tokenHash: string, csrfHash: string, expiresAt: Date): Promise<ManagerSession> {
    const now = new Date().toISOString()
    const item: ManagerSession = { id: randomUUID(), ownerId, tokenHash, csrfHash, expiresAt: expiresAt.toISOString(), createdAt: now, lastSeenAt: now, revokedAt: null }
    this.sessions.set(tokenHash, item)
    return structuredClone(item)
  }

  async findSession(tokenHash: string): Promise<ManagerSession | undefined> {
    const item = this.sessions.get(tokenHash)
    if (!item || item.revokedAt || Date.parse(item.expiresAt) <= Date.now()) return undefined
    item.lastSeenAt = new Date().toISOString()
    return structuredClone(item)
  }

  async revokeSession(tokenHash: string): Promise<void> {
    const item = this.sessions.get(tokenHash)
    if (item) item.revokedAt = new Date().toISOString()
  }

  async listSecretReferences(ownerId: string): Promise<SecretReference[]> {
    return [...this.secretReferences.values()].filter((item) => item.ownerId === ownerId).map((item) => structuredClone(item))
  }

  async createSecretReference(ownerId: string, value: { id: string; name: string; locatorMasked: string; version: number; status: SecretReference['status'] }): Promise<SecretReference> {
    const now = new Date().toISOString()
    const item: SecretReference = { ...value, ownerId, store: 'encrypted-local', metadataRevision: 1, lastRotatedAt: value.status === 'available' ? now : null, etag: etag({ ...value, metadataRevision: 1 }), updatedAt: now }
    this.secretReferences.set(item.id, item)
    return structuredClone(item)
  }

  async updateSecretReference(ownerId: string, id: string, value: SecretReferenceUpdate, ifMatch: string): Promise<SecretReference> {
    const current = this.secretReferences.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Secret reference not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    const metadataRevision = current.metadataRevision + 1
    const next: SecretReference = {
      ...current,
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.locatorMasked === undefined ? {} : { locatorMasked: value.locatorMasked }),
      ...(value.version === undefined ? {} : { version: value.version }),
      ...(value.status === undefined ? {} : { status: value.status }),
      ...(value.lastRotatedAt === undefined ? {} : { lastRotatedAt: value.lastRotatedAt }),
      metadataRevision,
      etag: etag({
        name: value.name ?? current.name,
        locatorMasked: value.locatorMasked ?? current.locatorMasked,
        version: value.version ?? current.version,
        status: value.status ?? current.status,
        lastRotatedAt: value.lastRotatedAt ?? current.lastRotatedAt,
        metadataRevision,
      }),
      updatedAt: new Date().toISOString(),
    }
    this.secretReferences.set(id, next)
    return structuredClone(next)
  }

  async deleteSecretReference(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const current = this.secretReferences.get(id)
    if (!current || current.ownerId !== ownerId) throw problem('NOT_FOUND', 'Secret reference not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    if ([...this.providerConfigs.values()].some((item) => item.ownerId === ownerId && this.providerConfigSecretRefs.get(item.id)?.has(id))) throw problem('RESOURCE_IN_USE', 'Secret reference is still bound to a provider config revision', 409)
    this.secretReferences.delete(id)
  }

  async listDevices(ownerId: string, assistantId: string): Promise<Device[]> {
    const now = this.clock()
    return [...this.devices.values()]
      .filter((item) => item.ownerId === ownerId && item.assistantId === assistantId)
      .map((item) => publicDevice(item, now, this.presenceTtlMs))
  }

  async listDiscoverableDevices(ownerId: string): Promise<DiscoverableDevice[]> {
    void ownerId
    const now = this.clock()
    const result: DiscoverableDevice[] = []
    for (const device of this.devices.values()) {
      if (device.ownerId || device.assistantId || !isPresenceFresh(device.lastSeenAt, device.onlineState, now, this.presenceTtlMs)) continue
      const challenge = [...this.pairingChallenges.values()]
        .filter((item) => item.deviceId === device.id && item.state === 'pending' && Date.parse(item.expiresAt) > now.getTime())
        .sort((left, right) => Date.parse(right.expiresAt) - Date.parse(left.expiresAt))[0]
      if (!challenge) continue
      result.push({ id: device.id, maskedMac: device.maskedMac, board: device.board, firmwareVersion: device.firmwareVersion, onlineState: 'online', lastSeenAt: device.lastSeenAt, pairingExpiresAt: challenge.expiresAt })
    }
    return result.sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
  }

  async reportDevicePresence(value: DevicePresenceInput): Promise<DevicePresenceResult> {
    const now = this.clock().toISOString()
    const existing = [...this.devices.values()].find((item) => item.identityHash === value.identityHash && item.clientIdHash === value.clientIdHash)
    const device: DeviceRecord = existing ?? {
      id: randomUUID(), ownerId: '', assistantId: '', displayName: '', maskedMac: value.maskedMac,
      firmwareVersion: value.firmwareVersion, board: value.board, onlineState: value.onlineState,
      lastSeenAt: now, lastConversationAt: null,
      identityHash: value.identityHash, clientIdHash: value.clientIdHash,
    }
    device.maskedMac = value.maskedMac
    device.firmwareVersion = value.firmwareVersion
    device.board = value.board
    device.onlineState = value.onlineState
    device.lastSeenAt = now
    this.devices.set(device.id, device)
    if (value.onlineState === 'online' && !device.ownerId && !device.assistantId && value.pairingCodeHash && /^[0-9a-f]{64}$/i.test(value.pairingCodeHash)) {
      const expiresAt = new Date(this.clock().getTime() + 10 * 60 * 1000).toISOString()
      const pending = [...this.pairingChallenges.values()].find((item) => item.deviceId === device.id && item.state === 'pending')
      if (pending) {
        pending.codeHash = value.pairingCodeHash.toLowerCase()
        pending.expiresAt = expiresAt
        pending.attempts = 0
      } else {
        const id = randomUUID()
        this.pairingChallenges.set(id, { id, deviceId: device.id, codeHash: value.pairingCodeHash.toLowerCase(), expiresAt, attempts: 0, state: 'pending' })
      }
    }
    return { id: device.id, paired: Boolean(device.ownerId && device.assistantId), onlineState: device.onlineState, lastSeenAt: now }
  }

  async createPairingChallenge(value: { identityHash: string; clientIdHash: string; maskedMac: string; board: string; firmwareVersion: string }): Promise<PairingChallenge> {
    const now = this.clock()
    const nowIso = now.toISOString()
    const existing = [...this.devices.values()].find((item) => item.identityHash === value.identityHash && item.clientIdHash === value.clientIdHash)
    const device: DeviceRecord = existing ?? {
      id: randomUUID(), ownerId: '', assistantId: '', displayName: '', maskedMac: value.maskedMac, firmwareVersion: value.firmwareVersion, board: value.board,
      onlineState: 'online', lastSeenAt: nowIso, lastConversationAt: null, identityHash: value.identityHash, clientIdHash: value.clientIdHash,
    }
    device.maskedMac = value.maskedMac
    device.firmwareVersion = value.firmwareVersion
    device.board = value.board
    device.onlineState = 'online'
    device.lastSeenAt = nowIso
    this.devices.set(device.id, device)
    const id = randomUUID()
    /* The firmware renders a six-digit numeric code. Keep the challenge
       format identical across the API, LCD and dashboard; the parser still
       accepts the old VT-#### shape for already-issued compatibility codes. */
    const verificationCode = randomInt(100000, 1000000).toString()
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    this.pairingChallenges.set(id, { id, deviceId: device.id, codeHash: hashPairingCode(verificationCode), expiresAt, attempts: 0, state: 'pending' })
    return { id, deviceId: device.id, verificationCode, expiresAt }
  }

  async pairDevice(ownerId: string, value: { assistantId: string; deviceId?: string; verificationCode: string; displayName?: string }): Promise<Device> {
    const assistant = this.assistants.get(value.assistantId)
    if (!assistant || assistant.ownerId !== ownerId) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const codeHash = hashPairingCode(value.verificationCode.trim().toUpperCase())
    const now = this.clock().getTime()
    const challenge = [...this.pairingChallenges.values()].find((item) => item.state === 'pending' && item.attempts < 5 && Date.parse(item.expiresAt) > now && item.codeHash === codeHash && (!value.deviceId || item.deviceId === value.deviceId))
    if (!challenge) throw problem('PAIRING_CODE_INVALID', 'Pairing code is invalid or expired', 422)
    const device = this.devices.get(challenge.deviceId)
    if (!device) throw problem('PAIRING_CODE_INVALID', 'Pairing device is unavailable', 422)
    if (device.ownerId && device.ownerId !== ownerId) throw problem('PAIRING_CODE_INVALID', 'Pairing device is already owned', 422)
    device.ownerId = ownerId
    device.assistantId = value.assistantId
    device.displayName = value.displayName?.trim() || device.displayName || `Veetee ${device.id.slice(0, 8)}`
    device.onlineState = 'online'
    device.lastSeenAt = this.clock().toISOString()
    challenge.state = 'used'
    return publicDevice(device, this.clock(), this.presenceTtlMs)
  }

  async unlinkDevice(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const device = this.devices.get(id)
    if (!device || device.ownerId !== ownerId) throw problem('NOT_FOUND', 'Device not found', 404)

    /* Idempotent repeat: once the binding is gone, a retry must not resurrect
       or delete the identity. It is still owner-scoped by the check above. */
    if (!device.assistantId) return
    if (deviceEtag(device) !== ifMatch) throw problem('REVISION_CONFLICT', 'Device binding changed', 409)

    /* Keep the device row, identity and conversation history. A subsequent
       presence event can update this same row and a new pairing challenge can
       bind it again. */
    device.assistantId = ''
  }

  async getRetentionPolicy(ownerId: string): Promise<RetentionPolicy> {
    return structuredClone(this.retentionPolicies.get(ownerId) ?? defaultRetentionPolicy(ownerId))
  }

  async updateRetentionPolicy(ownerId: string, value: Pick<RetentionPolicy, 'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'>, ifMatch: string): Promise<RetentionPolicy> {
    const current = this.retentionPolicies.get(ownerId) ?? defaultRetentionPolicy(ownerId)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Retention policy changed', 409)
    validateRetentionPolicy(value)
    const next: RetentionPolicy = {
      ...current,
      ...value,
      effectiveAt: new Date().toISOString(),
      revision: current.revision + 1,
      etag: etag({ ...value, revision: current.revision + 1 }),
    }
    this.retentionPolicies.set(ownerId, next)
    return structuredClone(next)
  }

  async purgeExpiredConversations(now: Date = new Date()): Promise<RetentionPurgeResult> {
    const cutoff = now.getTime()
    let conversations = 0
    for (const [id, record] of this.conversations) {
      if (record.summary.retentionUntil && Date.parse(record.summary.retentionUntil) <= cutoff) {
        const deletedAt = now.toISOString()
        this.conversationTombstones.set(id, {
          ownerId: record.ownerId,
          deletedAt,
          expiresAt: new Date(cutoff + this.tombstoneTtlMs).toISOString(),
          reason: 'retention_expired',
          jobId: null,
        })
        this.conversations.delete(id)
        conversations += 1
      }
    }
    for (const [id, tombstone] of this.conversationTombstones) {
      if (Date.parse(tombstone.expiresAt) <= cutoff) this.conversationTombstones.delete(id)
    }
    return { conversations }
  }

  async requestConversationDelete(ownerId: string, conversationId: string): Promise<RetentionDeleteJob> {
    await this.purgeExpiredConversations()
    const now = this.clock().toISOString()
    const existingJob = [...this.retentionDeleteJobs.values()].find((item) => item.ownerId === ownerId && item.conversationId === conversationId)
    if (existingJob) {
      if (existingJob.job.status === 'failed' && existingJob.attempts < 3) {
        existingJob.job = { ...existingJob.job, status: 'queued', requestedAt: now, startedAt: null, completedAt: null, errorCode: null }
      }
      return structuredClone(existingJob.job)
    }
    const record = this.conversations.get(conversationId)
    if (!record || record.ownerId !== ownerId) {
      const tombstone = this.conversationTombstones.get(conversationId)
      if (tombstone?.ownerId === ownerId && Date.parse(tombstone.expiresAt) > Date.parse(now)) throw problem('RETENTION_EXPIRED', 'Conversation has already expired or been deleted', 410)
      throw problem('NOT_FOUND', 'Conversation not found', 404)
    }
    const job: RetentionDeleteJob = { id: randomUUID(), conversationId, status: 'queued', requestedAt: now, startedAt: null, completedAt: null, errorCode: null }
    this.retentionDeleteJobs.set(job.id, { ownerId, conversationId, attempts: 0, job })
    return structuredClone(job)
  }

  async runConversationDeleteJob(jobId: string): Promise<RetentionDeleteJob> {
    const record = this.retentionDeleteJobs.get(jobId)
    if (!record) throw problem('NOT_FOUND', 'Retention delete job not found', 404)
    if (record.job.status === 'completed') return structuredClone(record.job)
    if (record.attempts >= 3) {
      record.job = { ...record.job, status: 'failed', errorCode: 'DELETE_RETRY_LIMIT' }
      return structuredClone(record.job)
    }
    record.attempts += 1
    record.job = { ...record.job, status: 'running', startedAt: this.clock().toISOString(), completedAt: null, errorCode: null }
    try {
      const current = this.conversations.get(record.conversationId)
      if (current && current.ownerId !== record.ownerId) throw problem('NOT_FOUND', 'Conversation not found', 404)
      if (current) {
        const deletedAt = this.clock().toISOString()
        this.conversationTombstones.set(record.conversationId, { ownerId: record.ownerId, deletedAt, expiresAt: new Date(Date.parse(deletedAt) + this.tombstoneTtlMs).toISOString(), reason: 'owner_request', jobId })
        this.conversations.delete(record.conversationId)
      } else {
        const tombstone = this.conversationTombstones.get(record.conversationId)
        if (!tombstone || tombstone.ownerId !== record.ownerId) throw problem('NOT_FOUND', 'Conversation not found', 404)
      }
      record.job = { ...record.job, status: 'completed', completedAt: this.clock().toISOString(), errorCode: null }
    } catch (error) {
      const value = error as { code?: string }
      record.job = { ...record.job, status: 'failed', completedAt: this.clock().toISOString(), errorCode: value.code ?? 'DELETE_FAILED' }
    }
    return structuredClone(record.job)
  }

  async getRetentionDeleteJob(ownerId: string, jobId: string): Promise<RetentionDeleteJob | undefined> {
    const record = this.retentionDeleteJobs.get(jobId)
    if (!record || record.ownerId !== ownerId) return undefined
    return structuredClone(record.job)
  }

  async ingestConversationTurn(value: ConversationTurnInput): Promise<ConversationDetail> {
    const assistant = this.assistants.get(value.assistantId)
    if (!assistant) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const policy = await this.getRetentionPolicy(assistant.ownerId)
    validateConversationTurn(value)
    const existing = this.conversations.get(value.conversationId)
    if (existing && (existing.ownerId !== assistant.ownerId || existing.summary.assistantId !== value.assistantId)) {
      throw problem('NOT_FOUND', 'Conversation not found', 404)
    }
    const duplicate = existing?.turns.find((turn) => turn.turnId === value.turnId)
    if (duplicate && existing) {
      if (duplicate.sequence !== value.sequence) throw problem('HISTORY_INVALID', 'conversation turn sequence conflicts with an existing turn', 422)
      return this.conversationDetail(existing, policy)
    }
    if (existing?.turns.some((turn) => turn.sequence === value.sequence)) {
      throw problem('HISTORY_INVALID', 'conversation turn sequence conflicts with an existing turn', 422)
    }
    const transcript = policy.captureTranscript ? structuredClone(value.transcript) : []
    const turn: ConversationTurn = {
      id: value.turnId,
      conversationId: value.conversationId,
      turnId: value.turnId,
      sequence: value.sequence,
      state: value.state,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      finishReason: value.finishReason,
      timings: structuredClone(value.timings),
      transcript,
      toolCalls: structuredClone(value.toolCalls),
    }
    const status = value.conversationStatus ?? (value.state === 'completed' ? 'completed' : value.state === 'aborted' ? 'aborted' : 'error')
    const retentionUntil = policy.captureTranscript && policy.transcriptDays !== null && status !== 'active'
      ? new Date(Date.parse(value.conversationEndedAt ?? value.endedAt) + policy.transcriptDays * 86_400_000).toISOString()
      : null
    const summary: ConversationSummary = existing?.summary ?? {
      id: value.conversationId,
      assistantId: value.assistantId,
      deviceKey: value.deviceKey ?? null,
      startedAt: value.conversationStartedAt,
      endedAt: value.conversationEndedAt ?? null,
      locale: value.locale,
      configRevision: value.configRevision,
      status,
      turnCount: 0,
      lastTurnAt: null,
      aggregateTimings: {},
      retentionUntil,
    }
    summary.turnCount += 1
    if (!summary.lastTurnAt || Date.parse(value.endedAt) > Date.parse(summary.lastTurnAt)) summary.lastTurnAt = value.endedAt
    if (value.conversationEndedAt && (!summary.endedAt || Date.parse(value.conversationEndedAt) > Date.parse(summary.endedAt))) {
      summary.endedAt = value.conversationEndedAt
    }
    summary.status = status
    if (retentionUntil && (!summary.retentionUntil || Date.parse(retentionUntil) > Date.parse(summary.retentionUntil))) {
      summary.retentionUntil = retentionUntil
    }
    summary.aggregateTimings = { ...summary.aggregateTimings, ...value.timings }
    const record = existing ?? { ownerId: assistant.ownerId, summary, turns: [] }
    if (!existing) this.conversations.set(value.conversationId, record)
    record.summary = summary
    record.turns.push(turn)
    if (value.deviceKey && isDeviceIdentityHash(value.deviceKey)) {
      const device = [...this.devices.values()].find((item) => item.ownerId === assistant.ownerId && item.assistantId === value.assistantId && item.identityHash === value.deviceKey)
      if (device && (!device.lastConversationAt || Date.parse(value.endedAt) > Date.parse(device.lastConversationAt))) device.lastConversationAt = value.endedAt
    }
    return this.conversationDetail(record, policy)
  }

  async listConversations(ownerId: string, assistantId: string, limit: number): Promise<ConversationSummary[]> {
    await this.purgeExpiredConversations()
    return [...this.conversations.values()]
      .filter((item) => item.ownerId === ownerId && item.summary.assistantId === assistantId)
      .sort((left, right) => Date.parse(right.summary.startedAt) - Date.parse(left.summary.startedAt))
      .slice(0, limit)
      .map((item) => structuredClone(item.summary))
  }

  async getConversation(ownerId: string, id: string): Promise<ConversationDetail | undefined> {
    await this.purgeExpiredConversations()
    const record = this.conversations.get(id)
    if (!record || record.ownerId !== ownerId) {
      const tombstone = this.conversationTombstones.get(id)
      if (tombstone?.ownerId === ownerId && Date.parse(tombstone.expiresAt) > this.clock().getTime()) throw problem('RETENTION_EXPIRED', 'Conversation has already expired or been deleted', 410)
      return undefined
    }
    return this.conversationDetail(record, await this.getRetentionPolicy(ownerId))
  }

  private conversationDetail(record: { ownerId: string; summary: ConversationSummary; turns: ConversationTurn[] }, policy: RetentionPolicy): ConversationDetail {
    return { summary: structuredClone(record.summary), turns: structuredClone(record.turns).sort((left, right) => left.sequence - right.sequence), retention: structuredClone(policy) }
  }

  private kind(id: string): ProviderKind | undefined { return this.installations.find((item) => item.id === id)?.kind }

  /**
   * A config remains in use while it is referenced by the current draft or by
   * the published runtime snapshot. Older immutable revisions alone do not
   * keep a config locked forever.
   */
  private providerConfigInUse(ownerId: string, id: string): boolean {
    for (const assistant of this.assistants.values()) {
      if (assistant.ownerId !== ownerId) continue
      if (Object.values(assistant.providerSelections).some((value) => value?.providerConfigId === id || value?.providerId === id)) return true
      if (assistant.publishedRevision !== null && this.publication?.snapshot.assistantId === assistant.id
        && Object.values(this.publication.snapshot.providers).some((value) => value?.providerConfigId === id || value?.providerId === id)) return true
    }
    return false
  }

  private assertProviderNameAvailable(ownerId: string, name: string, exceptId?: string): void {
    const normalized = name.trim().toLocaleLowerCase()
    if (!normalized) throw problem('CONFIG_INVALID', 'Provider config name is required', 422)
    const duplicate = [...this.providerConfigs.values()].some((item) => item.ownerId === ownerId && !item.archivedAt && item.id !== exceptId && item.name.trim().toLocaleLowerCase() === normalized)
    if (duplicate) throw problem('NAME_CONFLICT', 'A provider config with this name already exists', 409)
  }

  private withAssistantSummary(current: AssistantRecord): Assistant {
    const devices = [...this.devices.values()].filter((device) => device.ownerId === current.ownerId && device.assistantId === current.id)
    const now = this.clock()
    let lastConversationAt: string | null = null
    for (const record of this.conversations.values()) {
      if (record.ownerId !== current.ownerId || record.summary.assistantId !== current.id) continue
      const candidate = record.summary.lastTurnAt ?? record.summary.endedAt ?? record.summary.startedAt
      if (!lastConversationAt || Date.parse(candidate) > Date.parse(lastConversationAt)) lastConversationAt = candidate
    }
    return {
      ...structuredClone(current),
      deviceCount: devices.length,
      onlineDeviceCount: devices.filter((device) => isPresenceFresh(device.lastSeenAt, device.onlineState, now, this.presenceTtlMs)).length,
      lastConversationAt,
    }
  }

  private modelMemory(current: AssistantRecord | Assistant): ModelMemoryView {
    const kinds: ProviderKind[] = ['vad', 'asr', 'llm', 'tts', 'intent', 'memory']
    const selections = kinds.map((kind) => {
      const value = current.providerSelections[kind]
      const providerConfigId = typeof value?.providerConfigId === 'string' ? value.providerConfigId : typeof value?.providerId === 'string' ? value.providerId : undefined
      return providerConfigId ? { kind, mode: 'selected' as const, providerConfigId } : { kind, mode: 'disabled' as const }
    })
    return {
      assistantId: current.id,
      selections,
      availableConfigs: [...this.providerConfigs.values()].filter((item) => item.ownerId === current.ownerId && !item.archivedAt).map((item) => { const installation = this.installations.find((candidate) => candidate.id === item.installationId); return { id: item.id, kind: installation?.kind ?? 'memory', name: item.name, providerName: installation?.displayName ?? installation?.displayNameKey ?? item.installationId, availability: item.enabled ? 'ready' as const : 'disabled' as const, supportedLocales: Array.isArray(installation?.manifest.locales) ? installation.manifest.locales.filter((value): value is string => typeof value === 'string') : ['*'] } }),
      memory: { enabled: current.role.memoryEnabled !== false, itemCount: 0 },
      memoryItems: [],
    }
  }
}

export function etag(value: unknown): string { return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"` }

export function deviceEtag(value: { id: string; ownerId: string | null; assistantId: string | null; displayName: string }): string {
  return etag({ id: value.id, ownerId: value.ownerId ?? '', assistantId: value.assistantId ?? '', displayName: value.displayName })
}

export function parseCatalog(raw: unknown): ProviderInstallation[] {
  if (!isRecord(raw) || !Array.isArray(raw.installations)) throw new Error('provider catalog must contain installations')
  if (raw.schemaVersion !== 1) throw new Error('provider catalog schemaVersion must be 1')
  const ids = new Set<string>()
  return raw.installations.map((value, index) => {
    if (!isRecord(value)) throw new Error(`provider catalog installation[${index}] must be an object`)
    const id = catalogString(value.id, `provider catalog installation[${index}].id`)
    if (ids.has(id)) throw new Error(`provider catalog contains duplicate installation id: ${id}`)
    ids.add(id)
    const kindValue = catalogString(value.kind, `provider catalog installation[${index}].kind`)
    if (!providerKinds.has(kindValue as ProviderKind)) throw new Error(`provider catalog installation[${index}].kind is unsupported: ${kindValue}`)
    const displayNameKey = catalogString(value.displayNameKey, `provider catalog installation[${index}].displayNameKey`)
    const displayName = value.displayName === undefined ? undefined : catalogString(value.displayName, `provider catalog installation[${index}].displayName`)
    const version = catalogString(value.version, `provider catalog installation[${index}].version`)
    const manifest = value.manifest == null ? {} : value.manifest
    const configSchema = value.configSchema == null ? {} : value.configSchema
    if (!isRecord(manifest)) throw new Error(`provider catalog installation[${index}].manifest must be an object`)
    if (!isRecord(configSchema)) throw new Error(`provider catalog installation[${index}].configSchema must be an object`)
    return { id, kind: kindValue as ProviderKind, displayNameKey, ...(displayName ? { displayName } : {}), version, manifest: normalizeCatalogManifest(manifest, index), configSchema }
  })
}

export function parseModelRegistry(raw: unknown): ModelRegistrySeed {
  if (!isRecord(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.providers) || !Array.isArray(raw.configs)) throw new Error('model registry must contain schemaVersion 1, providers and configs')
  const providers = raw.providers.map((value, index) => {
    if (!isRecord(value)) throw new Error(`model registry provider[${index}] must be an object`)
    const fieldsRaw = Array.isArray(value.fields) ? value.fields : []
    const fields = fieldsRaw.map((field, fieldIndex) => {
      if (!isRecord(field)) throw new Error(`model registry provider[${index}].fields[${fieldIndex}] must be an object`)
      return {
        ...structuredClone(field),
        key: catalogString(field.key, `model registry provider[${index}].fields[${fieldIndex}].key`),
        label: catalogString(field.label, `model registry provider[${index}].fields[${fieldIndex}].label`),
        type: catalogString(field.type, `model registry provider[${index}].fields[${fieldIndex}].type`) as ModelProviderField['type'],
      }
    })
    return normalizeModelProviderInput({ ...(typeof value.id === 'string' ? { id: value.id } : {}), modelType: catalogString(value.modelType, `model registry provider[${index}].modelType`) as ModelType, providerCode: catalogString(value.providerCode, `model registry provider[${index}].providerCode`), name: catalogString(value.name, `model registry provider[${index}].name`), fields, sort: typeof value.sort === 'number' ? value.sort : 0 })
  })
  const configs = raw.configs.map((value, index) => {
    if (!isRecord(value)) throw new Error(`model registry config[${index}] must be an object`)
    const configJson = isRecord(value.configJson) ? value.configJson : {}
    return normalizeModelConfigInput({ modelType: catalogString(value.modelType, `model registry config[${index}].modelType`) as ModelType, providerCode: catalogString(value.providerCode, `model registry config[${index}].providerCode`), ...(typeof value.id === 'string' ? { id: value.id } : {}), modelCode: catalogString(value.modelCode, `model registry config[${index}].modelCode`), modelName: catalogString(value.modelName, `model registry config[${index}].modelName`), isDefault: value.isDefault === true, isEnabled: value.isEnabled !== false, configJson, docLink: typeof value.docLink === 'string' ? value.docLink : null, remark: typeof value.remark === 'string' ? value.remark : null, sort: typeof value.sort === 'number' ? value.sort : 0 })
  })
  const providerKeys = new Set(providers.map((item) => `${item.modelType}:${item.providerCode}`))
  for (const config of configs) if (!providerKeys.has(`${config.modelType}:${config.providerCode}`)) throw new Error(`model registry config references missing provider: ${config.modelType}/${config.providerCode}`)
  const voices = Array.isArray(raw.voices) ? raw.voices.map((value, index) => {
    if (!isRecord(value)) throw new Error(`model registry voice[${index}] must be an object`)
    const text = (key: string): string => typeof value[key] === 'string' ? value[key] as string : ''
    const id = catalogString(value.id, `model registry voice[${index}].id`)
    const ttsModelId = catalogString(value.ttsModelId, `model registry voice[${index}].ttsModelId`)
    const name = text('name').trim()
    const ttsVoice = text('ttsVoice').trim()
    const languages = text('languages').trim()
    if (!name || !languages) throw new Error(`model registry voice[${index}] requires name and languages`)
    return {
      id,
      ttsModelId,
      name,
      ttsVoice,
      languages,
      voiceDemo: typeof value.voiceDemo === 'string' ? value.voiceDemo : null,
      remark: typeof value.remark === 'string' ? value.remark : null,
      referenceAudio: typeof value.referenceAudio === 'string' ? value.referenceAudio : null,
      referenceText: typeof value.referenceText === 'string' ? value.referenceText : null,
      sort: typeof value.sort === 'number' ? Math.max(0, Math.trunc(value.sort)) : 0,
    }
  }) : []
  const configIds = new Set(configs.map((item) => item.id).filter((id): id is string => typeof id === 'string'))
  for (const voice of voices) if (!configIds.has(voice.ttsModelId)) throw new Error(`model registry voice references missing TTS model: ${voice.ttsModelId}`)
  return { providers, configs, voices }
}

const providerKinds = new Set<ProviderKind>(['vad', 'asr', 'llm', 'tts', 'intent', 'memory'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('vi')
}

function catalogString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

function normalizeCatalogManifest(value: Record<string, unknown>, index: number): Record<string, unknown> {
  const manifest = structuredClone(value)
  for (const field of ['locales', 'secretFields'] as const) {
    if (!(field in manifest)) continue
    const values = manifest[field]
    if (!Array.isArray(values)) throw new Error(`provider catalog installation[${index}].manifest.${field} must be an array`)
    manifest[field] = values.map((item, valueIndex) => catalogString(item, `provider catalog installation[${index}].manifest.${field}[${valueIndex}]`))
  }
  return manifest
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

export function validateProviderSelectionShape(value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }): void {
  if (value.mode === 'selected' && (!value.providerConfigId || value.providerConfigId.trim().length === 0)) throw problem('CONFIG_INVALID', 'Selected provider requires providerConfigId', 422)
  if (value.mode === 'disabled' && value.providerConfigId !== undefined) throw problem('CONFIG_INVALID', 'Disabled provider selection must not include providerConfigId', 422)
}

export function isDeviceIdentityHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

export function hashPairingCode(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function defaultRetentionPolicy(ownerId: string): RetentionPolicy {
  const value = { ownerId, captureTranscript: true, transcriptDays: 30, captureAudio: false, audioDays: null, revision: 1 }
  return { ...value, effectiveAt: new Date(0).toISOString(), etag: ownerId === 'local-owner' ? '"baseline-transcript-30d-audio-off"' : etag(value) }
}

function validateRetentionPolicy(value: Pick<RetentionPolicy, 'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'>): void {
  if (value.captureAudio || value.audioDays !== null) throw problem('AUDIO_RETENTION_UNSUPPORTED', 'Audio recording is not enabled in this baseline', 422)
  if (value.captureTranscript && (!Number.isInteger(value.transcriptDays) || (value.transcriptDays ?? 0) < 1 || (value.transcriptDays ?? 0) > 3650)) throw problem('RETENTION_INVALID', 'transcriptDays must be between 1 and 3650', 422)
  if (!value.captureTranscript && value.transcriptDays !== null) throw problem('RETENTION_INVALID', 'transcriptDays must be null when transcript capture is disabled', 422)
}

function validateConversationTurn(value: ConversationTurnInput): void {
  if (!/^[0-9a-f-]{36}$/i.test(value.conversationId)) throw problem('HISTORY_INVALID', 'conversationId must be a UUID', 422)
  if (!value.assistantId || !value.turnId || !value.locale || !Number.isInteger(value.configRevision) || value.configRevision < 1 || !Number.isInteger(value.sequence) || value.sequence < 1) throw problem('HISTORY_INVALID', 'conversation turn identity is invalid', 422)
  if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt))) throw problem('HISTORY_INVALID', 'conversation turn timestamps are invalid', 422)
  if (value.transcript.length > 128 || value.toolCalls.length > 64) throw problem('HISTORY_LIMIT_EXCEEDED', 'conversation event is too large', 413)
}

function publicDevice(value: DeviceRecord, now: Date, presenceTtlMs: number): Device {
  return {
    id: value.id,
    ownerId: value.ownerId,
    assistantId: value.assistantId,
    etag: deviceEtag(value),
    displayName: value.displayName,
    maskedMac: value.maskedMac,
    firmwareVersion: value.firmwareVersion,
    board: value.board,
    onlineState: isPresenceFresh(value.lastSeenAt, value.onlineState, now, presenceTtlMs) ? 'online' : 'offline',
    lastSeenAt: value.lastSeenAt,
    lastConversationAt: value.lastConversationAt,
  }
}

function validateJsonObject(value: Record<string, unknown>, schema: Record<string, unknown>): void {
  if (!isRecord(value)) throw problem('CONFIG_INVALID', 'Provider config must be an object', 422)
  // An empty catalog schema is treated as an intentionally closed object. This
  // keeps a missing provider schema fail-closed instead of silently accepting
  // arbitrary config keys, while normal JSON Schema objects keep their own
  // `additionalProperties` policy.
  const rootSchema = schema.type === undefined ? { ...schema, type: 'object', additionalProperties: false } : schema
  validateJsonValue(value, rootSchema, 'config')
}

function validateJsonValue(value: unknown, schema: Record<string, unknown>, path: string): void {
  const expectedType = schema.type
  const validType = typeof expectedType === 'string'
    ? matchesJsonType(value, expectedType)
    : Array.isArray(expectedType)
      ? expectedType.some((item): item is string => typeof item === 'string' && matchesJsonType(value, item))
      : true
  if (!validType) throw problem('CONFIG_INVALID', `${path} has an invalid type`, 422)

  const enumValues = schema.enum
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => jsonValuesEqual(candidate, value))) {
    throw problem('CONFIG_INVALID', `${path} must be one of the configured values`, 422)
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) throw problem('CONFIG_INVALID', `${path} is shorter than the configured minimum`, 422)
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) throw problem('CONFIG_INVALID', `${path} is longer than the configured maximum`, 422)
    if (schema.format === 'uri') {
      try {
        const parsed = new URL(value)
        if (!parsed.protocol || !parsed.hostname) throw new Error('invalid uri')
      } catch {
        throw problem('CONFIG_INVALID', `${path} must be a valid URI`, 422)
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) throw problem('CONFIG_INVALID', `${path} is below the configured minimum`, 422)
    if (typeof schema.maximum === 'number' && value > schema.maximum) throw problem('CONFIG_INVALID', `${path} is above the configured maximum`, 422)
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) throw problem('CONFIG_INVALID', `${path} has fewer items than configured`, 422)
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) throw problem('CONFIG_INVALID', `${path} has more items than configured`, 422)
    if (isRecord(schema.items)) value.forEach((item, index) => validateJsonValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`))
  }
  if (!isRecord(value)) return

  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = schema.required
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(value, key)) {
        throw problem('CONFIG_INVALID', `${path}.${String(key)} is required`, 422)
      }
    }
  }
  const additionalProperties = schema.additionalProperties
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key]
    if (isRecord(childSchema)) {
      validateJsonValue(child, childSchema, `${path}.${key}`)
      continue
    }
    if (additionalProperties === false) throw problem('CONFIG_INVALID', `Unknown provider field: ${key}`, 422)
    if (isRecord(additionalProperties)) validateJsonValue(child, additionalProperties, `${path}.${key}`)
  }
}

function matchesJsonType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'object': return isRecord(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
}

export function validateSecretBindings(installation: ProviderInstallation, refs: string[], options: { requireComplete?: boolean } = {}): void {
  const fields = Array.isArray(installation.manifest.secretFields) ? installation.manifest.secretFields : []
  const uniqueRefs = new Set(refs)
  if (uniqueRefs.size !== refs.length) throw problem('SECRET_INVALID', `${installation.id} cannot bind the same secretRef more than once`, 422)
  if (fields.length === 0) {
    if (refs.length > 0) throw problem('SECRET_INVALID', `${installation.id} does not declare secret fields`, 422)
    return
  }
  if (refs.length > fields.length || (options.requireComplete === true && refs.length !== fields.length)) {
    const qualifier = options.requireComplete === true ? 'exactly' : 'at most'
    throw problem('SECRET_INVALID', `${installation.id} requires ${qualifier} ${fields.length} secretRef`, 422)
  }
}

export function validateVoiceValue(value: Pick<VoiceProfile, 'providerConfigId' | 'name' | 'locale' | 'voiceCode' | 'description' | 'demoUrl' | 'enabled' | 'sort'>): void {
  if (!value.providerConfigId || !value.name.trim() || !value.locale.trim() || !value.voiceCode.trim()) throw problem('VOICE_INVALID', 'Voice name, locale and voice code are required', 422)
  if (value.name.length > 120 || value.locale.length > 35 || value.voiceCode.length > 160 || value.description.length > 512) throw problem('VOICE_INVALID', 'Voice metadata exceeds the allowed length', 422)
  if (value.demoUrl !== null && value.demoUrl !== undefined) {
    try { const parsed = new URL(value.demoUrl); if (!parsed.protocol || !parsed.hostname) throw new Error('invalid url') } catch { throw problem('VOICE_INVALID', 'Voice demo URL must be a valid URL', 422) }
  }
  if (!Number.isInteger(value.sort) || value.sort < 0 || value.sort > 100000) throw problem('VOICE_INVALID', 'Voice sort must be a non-negative integer', 422)
}
