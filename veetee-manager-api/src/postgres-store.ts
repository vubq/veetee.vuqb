import { randomInt, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm'
import {
  assistantRevisionTable,
  assistantTable,
  conversationTable,
  conversationTurnTable,
  conversationTombstoneTable,
  deviceTable,
  managerSessionTable,
  pairingChallengeTable,
  providerSecretBindingTable,
  providerConfigRevisionTable,
  providerConfigTable,
  voiceProfileTable,
  runtimePublicationTable,
  retentionDeleteJobTable,
  retentionPolicyTable,
  secretReferenceTable,
  modelProviderTable,
  modelConfigTable,
  ttsVoiceTable,
} from './db/schema.js'
import { openDatabase, readDatabaseUrl, type DatabaseHandle } from './db/client.js'
import {
  etag,
  defaultRetentionPolicy,
  deviceEtag,
  DEFAULT_DEVICE_ONLINE_TTL_SECONDS,
  DEFAULT_CONVERSATION_POLICY,
  hashPairingCode,
  isPresenceFresh,
  problem,
  normalizeProviderConfig,
  validateSecretBindings,
  type Assistant,
  type ConversationDetail,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationTurn,
  type ConversationTurnInput,
  type Device,
  type DiscoverableDevice,
  type DevicePresenceInput,
  type DevicePresenceResult,
  type ManagerSession,
  type ModelMemoryView,
  type ModelConfig,
  type ModelConfigInput,
  type ModelConfigPage,
  type ModelConfigQuery,
  type ModelProvider,
  type ModelProviderInput,
  type ModelRegistrySeed,
  type ModelType,
  type PairingChallenge,
  type ProviderConfig,
  type ProviderProbeResult,
  type VoiceProfile,
  type ProviderInstallation,
  type ProviderKind,
  type RetentionPolicy,
  type RetentionDeleteJob,
  type RetentionPurgeResult,
  type RuntimePublication,
  type RuntimeSnapshot,
  type SecretReference,
  type SecretReferenceUpdate,
  type Store,
  isDeviceIdentityHash,
  roleExtras,
  roleFromSnapshot,
  validateVoiceValue,
  validateProviderSelectionShape,
} from './store.js'
import { cloneModelConfig, cloneModelProvider, modelEtag, newModelConfig, newModelProvider, normalizeModelConfigInput, normalizeModelProviderInput } from './model-registry.js'

type JsonObject = Record<string, unknown>
type AssistantRow = typeof assistantTable.$inferSelect
type AssistantRevisionRow = typeof assistantRevisionTable.$inferSelect
type ProviderConfigRow = typeof providerConfigTable.$inferSelect
type ProviderConfigRevisionRow = typeof providerConfigRevisionTable.$inferSelect
type VoiceProfileRow = typeof voiceProfileTable.$inferSelect
type ManagerSessionRow = typeof managerSessionTable.$inferSelect
type SecretReferenceRow = typeof secretReferenceTable.$inferSelect
type DeviceRow = typeof deviceTable.$inferSelect
type RetentionPolicyRow = typeof retentionPolicyTable.$inferSelect
type ConversationRow = typeof conversationTable.$inferSelect
type ConversationTurnRow = typeof conversationTurnTable.$inferSelect
type RetentionDeleteJobRow = typeof retentionDeleteJobTable.$inferSelect
type ModelProviderRow = typeof modelProviderTable.$inferSelect
type ModelConfigRow = typeof modelConfigTable.$inferSelect
type AssistantSummary = Pick<Assistant, 'deviceCount' | 'onlineDeviceCount' | 'lastConversationAt'>

export interface PostgresStoreOptions {
  catalog: ProviderInstallation[]
  initial?: RuntimeSnapshot
  modelRegistry?: ModelRegistrySeed
  databaseUrlFile: string | undefined
  presenceTtlSeconds?: number
  tombstoneTtlSeconds?: number
  now?: () => Date
}

export class PostgresStore implements Store {
  private constructor(
    private readonly handle: DatabaseHandle,
    private readonly installations: ProviderInstallation[],
    private readonly presenceTtlMs: number,
    private readonly tombstoneTtlMs: number,
    private readonly clock: () => Date,
  ) {}

  static async open(options: PostgresStoreOptions): Promise<PostgresStore> {
    const url = await readDatabaseUrl(options.databaseUrlFile)
    const handle = await openDatabase(url)
    const store = new PostgresStore(
      handle,
      options.catalog,
      (options.presenceTtlSeconds ?? DEFAULT_DEVICE_ONLINE_TTL_SECONDS) * 1000,
      Math.max(60, options.tombstoneTtlSeconds ?? 604800) * 1000,
      options.now ?? (() => new Date()),
    )
    try {
      await store.assertMigrated()
      if (options.modelRegistry) await store.seedModelRegistry(options.modelRegistry)
      if (options.initial) await store.seedIfEmpty(options.initial)
      return store
    } catch (error) {
      await handle.pool.end().catch(() => undefined)
      throw error
    }
  }

  async close(): Promise<void> {
    await this.handle.pool.end()
  }

  async listInstallations(): Promise<ProviderInstallation[]> {
    return this.installations.map((item) => structuredClone(item))
  }

  async listModelProviders(ownerId: string, query: { modelType?: ModelType; name?: string } = {}): Promise<ModelProvider[]> {
    void ownerId
    const rows = await this.handle.db.select().from(modelProviderTable).where(query.modelType ? eq(modelProviderTable.modelType, query.modelType) : undefined).orderBy(asc(modelProviderTable.modelType), asc(modelProviderTable.sort), asc(modelProviderTable.name))
    const term = query.name?.trim().toLocaleLowerCase()
    return rows.filter((row) => !term || `${row.name ?? ''} ${row.providerCode ?? ''} ${row.modelType ?? ''}`.toLocaleLowerCase().includes(term)).map((row) => cloneModelProvider(this.mapModelProvider(row)))
  }

  async createModelProvider(ownerId: string, input: ModelProviderInput): Promise<ModelProvider> {
    const item = newModelProvider(ownerId, normalizeModelProviderInput(input))
    try {
      const now = new Date()
      await this.handle.db.insert(modelProviderTable).values({ id: item.id, modelType: item.modelType, providerCode: item.providerCode, name: item.name, fields: item.fields as unknown as JsonObject[], sort: item.sort, creator: 1, createDate: now, updater: 1, updateDate: now })
    } catch (error) { if (isUniqueViolation(error)) throw problem('NAME_CONFLICT', 'Model provider already exists', 409); throw error }
    return cloneModelProvider(item)
  }

  async updateModelProvider(ownerId: string, id: string, input: Partial<ModelProviderInput>, ifMatch?: string): Promise<ModelProvider> {
    const row = await this.findModelProvider(ownerId, id)
    if (!row) throw problem('NOT_FOUND', 'Model provider not found', 404)
    const current = this.mapModelProvider(row)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model provider changed', 409)
    const normalized = normalizeModelProviderInput({ modelType: input.modelType ?? current.modelType, providerCode: input.providerCode ?? current.providerCode, name: input.name ?? current.name, fields: input.fields ?? current.fields, sort: input.sort ?? current.sort })
    const nextId = id
    if (normalized.providerCode !== current.providerCode || normalized.modelType !== current.modelType) {
      const used = await this.handle.db.select({ id: modelConfigTable.id }).from(modelConfigTable).where(and(eq(modelConfigTable.modelType, current.modelType), sql`${modelConfigTable.configJson}->>'type' = ${current.providerCode}`)).limit(1)
      if (used.length) throw problem('RESOURCE_IN_USE', 'Model provider is used by a model config', 409)
    }
    const next = { ...newModelProvider(ownerId, { ...normalized, id: nextId }, current.revision + 1), id: nextId }
    const updated = await this.handle.db.update(modelProviderTable).set({ id: nextId, modelType: next.modelType, providerCode: next.providerCode, name: next.name, fields: next.fields as unknown as JsonObject[], sort: next.sort, updater: 1, updateDate: new Date() }).where(eq(modelProviderTable.id, id)).returning()
    if (!updated.length) throw problem('REVISION_CONFLICT', 'Model provider changed', 409)
    return cloneModelProvider(next)
  }

  async deleteModelProvider(ownerId: string, id: string, ifMatch?: string): Promise<void> {
    const row = await this.findModelProvider(ownerId, id)
    if (!row) throw problem('NOT_FOUND', 'Model provider not found', 404)
    const current = this.mapModelProvider(row)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model provider changed', 409)
    const used = await this.handle.db.select({ id: modelConfigTable.id }).from(modelConfigTable).where(and(eq(modelConfigTable.modelType, current.modelType), sql`${modelConfigTable.configJson}->>'type' = ${current.providerCode}`)).limit(1)
    if (used.length) throw problem('RESOURCE_IN_USE', 'Model provider is used by a model config', 409)
    await this.handle.db.delete(modelProviderTable).where(eq(modelProviderTable.id, id))
  }

  async listModelConfigs(ownerId: string, query: ModelConfigQuery = {}): Promise<ModelConfigPage> {
    void ownerId
    const rows = await this.handle.db.select().from(modelConfigTable).where(query.modelType ? eq(modelConfigTable.modelType, query.modelType) : undefined).orderBy(asc(modelConfigTable.sort), asc(modelConfigTable.modelName))
    const term = query.modelName?.trim().toLocaleLowerCase()
    const filtered = rows.filter((row) => !term || `${row.modelName ?? ''} ${row.modelCode ?? ''} ${asJsonObject(row.configJson ?? {}).type ?? ''}`.toLocaleLowerCase().includes(term))
    const page = Math.max(1, Math.trunc(query.page ?? 1))
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 10)))
    return { items: filtered.slice((page - 1) * limit, page * limit).map((row) => cloneModelConfig(this.mapModelConfig(row))), total: filtered.length, page, limit }
  }

  async getModelConfig(ownerId: string, id: string): Promise<ModelConfig | undefined> {
    const row = await this.findModelConfig(ownerId, id)
    return row ? cloneModelConfig(this.mapModelConfig(row)) : undefined
  }

  async createModelConfig(ownerId: string, input: ModelConfigInput): Promise<ModelConfig> {
    const normalized = normalizeModelConfigInput(input)
    await this.assertModelProvider(ownerId, normalized.modelType, normalized.providerCode)
    const item = newModelConfig(ownerId, normalized)
    try {
      await this.handle.db.transaction(async (tx) => {
        if (item.isDefault) await tx.update(modelConfigTable).set({ isDefault: 0, updater: 1, updateDate: new Date() }).where(and(eq(modelConfigTable.modelType, item.modelType), eq(modelConfigTable.isDefault, 1)))
        const now = new Date()
        await tx.insert(modelConfigTable).values({ id: item.id, modelType: item.modelType, modelCode: item.modelCode, modelName: item.modelName, isDefault: item.isDefault ? 1 : 0, isEnabled: item.isEnabled ? 1 : 0, configJson: item.configJson, docLink: item.docLink, remark: item.remark, sort: item.sort, creator: 1, createDate: now, updater: 1, updateDate: now })
      })
    } catch (error) { if (isUniqueViolation(error)) throw problem('NAME_CONFLICT', 'Model config already exists', 409); throw error }
    return cloneModelConfig(item)
  }

  async updateModelConfig(ownerId: string, id: string, input: Partial<ModelConfigInput>, ifMatch?: string): Promise<ModelConfig> {
    const row = await this.findModelConfig(ownerId, id)
    if (!row) throw problem('NOT_FOUND', 'Model config not found', 404)
    const current = this.mapModelConfig(row)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model config changed', 409)
    const normalized = normalizeModelConfigInput({ modelType: input.modelType ?? current.modelType, providerCode: input.providerCode ?? current.providerCode, id, modelCode: input.modelCode ?? current.modelCode, modelName: input.modelName ?? current.modelName, isDefault: input.isDefault ?? current.isDefault, isEnabled: input.isEnabled ?? current.isEnabled, configJson: input.configJson ?? current.configJson, docLink: input.docLink ?? current.docLink, remark: input.remark ?? current.remark, sort: input.sort ?? current.sort })
    await this.assertModelProvider(ownerId, normalized.modelType, normalized.providerCode)
    const next = newModelConfig(ownerId, normalized, current.revision + 1)
    await this.handle.db.transaction(async (tx) => {
      if (next.isDefault) await tx.update(modelConfigTable).set({ isDefault: 0, updater: 1, updateDate: new Date() }).where(and(eq(modelConfigTable.modelType, next.modelType), eq(modelConfigTable.isDefault, 1), ne(modelConfigTable.id, id)))
      const updated = await tx.update(modelConfigTable).set({ modelType: next.modelType, modelCode: next.modelCode, modelName: next.modelName, isDefault: next.isDefault ? 1 : 0, isEnabled: next.isEnabled ? 1 : 0, configJson: next.configJson, docLink: next.docLink, remark: next.remark, sort: next.sort, updater: 1, updateDate: new Date() }).where(eq(modelConfigTable.id, id)).returning({ id: modelConfigTable.id })
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Model config changed', 409)
    })
    return cloneModelConfig(next)
  }

  async deleteModelConfig(ownerId: string, id: string, ifMatch?: string): Promise<void> {
    const row = await this.findModelConfig(ownerId, id)
    if (!row) throw problem('NOT_FOUND', 'Model config not found', 404)
    const current = this.mapModelConfig(row)
    if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Model config changed', 409)
    await this.handle.db.delete(modelConfigTable).where(eq(modelConfigTable.id, id))
  }

  async setModelEnabled(ownerId: string, id: string, enabled: boolean): Promise<ModelConfig> {
    const current = await this.getModelConfig(ownerId, id)
    if (current?.isDefault && !enabled) throw problem('RESOURCE_IN_USE', 'Default model cannot be disabled', 409)
    return this.updateModelConfig(ownerId, id, { isEnabled: enabled })
  }

  async setDefaultModel(ownerId: string, id: string): Promise<ModelConfig> {
    return this.updateModelConfig(ownerId, id, { isDefault: true, isEnabled: true })
  }

  async listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]> {
    const installationIds = kind === undefined ? undefined : this.installations.filter((item) => item.kind === kind).map((item) => item.id)
    if (kind !== undefined && !installationIds?.length) return []
    const conditions = [eq(providerConfigTable.ownerId, ownerId), isNull(providerConfigTable.archivedAt)]
    if (installationIds) conditions.push(inArray(providerConfigTable.installationId, installationIds))
    const identities = await this.handle.db.select().from(providerConfigTable).where(and(...conditions)).orderBy(asc(providerConfigTable.name))
    const values = await Promise.all(identities.map(async (identity) => {
      const revision = await this.findProviderRevision(identity.id, identity.currentRevision)
      return revision ? this.mapProviderConfig(identity, revision) : undefined
    }))
    return values.filter((value): value is ProviderConfig => value !== undefined)
  }

  async createProviderConfig(ownerId: string, value: { installationId: string; name: string; config: JsonObject; secretRefs?: string[] }): Promise<ProviderConfig> {
    const installation = this.findInstallation(value.installationId)
    const config = normalizeProviderConfig(installation, value.config)
    validateJsonObject(config, installation.configSchema)
    await this.assertProviderNameAvailable(ownerId, value.name)
    const secretRefs = [...(value.secretRefs ?? [])]
    validateSecretBindings(installation, secretRefs)
    await this.assertSecretRefs(ownerId, secretRefs)
    const id = randomUUID()
    const now = new Date()
    const revision = 1
    const revisionEtag = etag({ ...config, revision })
    const statusEtag = etag({ ...config, revision, enabled: true })
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(providerConfigTable).values({ id, ownerId, installationId: value.installationId, name: value.name.trim(), enabled: true, currentRevision: revision, currentEtag: statusEtag, createdAt: now, updatedAt: now, archivedAt: null })
      await tx.insert(providerConfigRevisionTable).values({ providerConfigId: id, revision, config: structuredClone(config), secretRefs, etag: revisionEtag, createdAt: now })
    })
    const identity = await this.findProviderIdentity(ownerId, id)
    const revisionRow = await this.findProviderRevision(id, revision)
    if (!identity || !revisionRow) throw new Error('provider config insert returned no row')
    return this.mapProviderConfig(identity, revisionRow)
  }

  async updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig> {
    const identity = await this.findProviderIdentity(ownerId, id)
    if (!identity) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (identity.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    const current = await this.findProviderRevision(id, identity.currentRevision)
    if (!current) throw new Error('provider config current revision is missing')
    if (identity.currentEtag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    const installation = this.findInstallation(identity.installationId)
    const config = normalizeProviderConfig(installation, value.config ?? asJsonObject(current.config))
    validateJsonObject(config, installation.configSchema)
    if (value.name !== undefined) await this.assertProviderNameAvailable(ownerId, value.name, id)
    const secretRefs = [...(value.secretRefs ?? asSecretRefs(current.secretRefs))]
    validateSecretBindings(installation, secretRefs)
    await this.assertSecretRefs(ownerId, secretRefs)
    const revision = identity.currentRevision + 1
    const nextEtag = etag({ ...config, revision })
    const nextStatusEtag = etag({ ...config, revision, enabled: identity.enabled })
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(providerConfigRevisionTable).values({ providerConfigId: id, revision, config: structuredClone(config), secretRefs, etag: nextEtag, createdAt: now })
      const updated = await tx.update(providerConfigTable).set({ name: value.name?.trim() ?? identity.name, currentRevision: revision, currentEtag: nextStatusEtag, updatedAt: now }).where(and(eq(providerConfigTable.id, id), eq(providerConfigTable.ownerId, ownerId), eq(providerConfigTable.currentRevision, identity.currentRevision), eq(providerConfigTable.currentEtag, ifMatch))).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    })
    const nextIdentity = await this.findProviderIdentity(ownerId, id)
    const nextRevision = await this.findProviderRevision(id, revision)
    if (!nextIdentity || !nextRevision) throw new Error('provider config update returned no row')
    return this.mapProviderConfig(nextIdentity, nextRevision)
  }

  async setProviderConfigEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ProviderConfig> {
    const identity = await this.findProviderIdentity(ownerId, id)
    if (!identity || identity.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (identity.currentEtag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    if (!enabled && await this.providerConfigInUse(ownerId, id)) throw problem('RESOURCE_IN_USE', 'Provider config is selected by an assistant', 409)
    const revision = await this.findProviderRevision(id, identity.currentRevision)
    if (!revision) throw new Error('provider config current revision is missing')
    const nextEtag = etag({ ...asJsonObject(revision.config), revision: identity.currentRevision, enabled })
    const updated = await this.handle.db.update(providerConfigTable)
      .set({ enabled, currentEtag: nextEtag, updatedAt: new Date() })
      .where(and(eq(providerConfigTable.id, id), eq(providerConfigTable.ownerId, ownerId), eq(providerConfigTable.currentEtag, ifMatch), isNull(providerConfigTable.archivedAt)))
      .returning()
    if (!updated.length) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    const [updatedRow] = updated
    if (!updatedRow) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    return this.mapProviderConfig(updatedRow, revision)
  }

  async deleteProviderConfig(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const identity = await this.findProviderIdentity(ownerId, id)
    if (!identity || identity.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    if (identity.currentEtag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    if (await this.providerConfigInUse(ownerId, id)) throw problem('RESOURCE_IN_USE', 'Provider config is selected by an assistant', 409)
    const now = new Date()
    const updated = await this.handle.db.update(providerConfigTable)
      .set({ archivedAt: now, updatedAt: now })
      .where(and(eq(providerConfigTable.id, id), eq(providerConfigTable.ownerId, ownerId), eq(providerConfigTable.currentEtag, ifMatch), isNull(providerConfigTable.archivedAt)))
      .returning({ id: providerConfigTable.id })
    if (!updated.length) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
  }

  async probeProviderConfig(ownerId: string, id: string): Promise<ProviderProbeResult> {
    const identity = await this.findProviderIdentity(ownerId, id)
    if (!identity || identity.archivedAt) throw problem('NOT_FOUND', 'Provider config not found', 404)
    const revision = await this.findProviderRevision(id, identity.currentRevision)
    if (!revision) throw new Error('provider config current revision is missing')
    const installation = this.findInstallation(identity.installationId)
    const started = Date.now()
    const checks: ProviderProbeResult['checks'] = []
    try {
      validateJsonObject(asJsonObject(revision.config), installation.configSchema)
      checks.push({ id: 'schema', state: 'passed', message: 'Cấu hình hợp lệ.' })
    } catch {
      checks.push({ id: 'schema', state: 'failed', message: 'Config không khớp JSON Schema.' })
    }
    const secretsReady = await this.secretRefsReady(ownerId, asSecretRefs(revision.secretRefs))
    checks.push({ id: 'secrets', state: secretsReady ? 'passed' : 'failed', message: secretsReady ? 'Khóa kết nối đã sẵn sàng.' : 'Có khóa kết nối thiếu hoặc không khả dụng.' })
    checks.push({ id: 'manifest', state: 'passed', message: 'Dịch vụ đã được nạp.' })
    return { providerConfigId: id, state: checks.some((check) => check.state === 'failed') ? 'unavailable' : 'ready', checkedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - started), checks }
  }

  async listVoiceProfiles(ownerId: string, options: { locale?: string; providerConfigId?: string } = {}): Promise<VoiceProfile[]> {
    const conditions = [eq(voiceProfileTable.ownerId, ownerId), isNull(voiceProfileTable.archivedAt)]
    if (options.locale) conditions.push(eq(voiceProfileTable.locale, options.locale))
    if (options.providerConfigId) conditions.push(eq(voiceProfileTable.providerConfigId, options.providerConfigId))
    const rows = await this.handle.db.select().from(voiceProfileTable).where(and(...conditions)).orderBy(asc(voiceProfileTable.sort), asc(voiceProfileTable.name))
    return rows.map((row) => this.mapVoiceProfile(row))
  }

  async createVoiceProfile(ownerId: string, value: Omit<VoiceProfile, 'id' | 'ownerId' | 'revision' | 'etag' | 'updatedAt' | 'archivedAt'>): Promise<VoiceProfile> {
    await this.assertTtsConfig(ownerId, value.providerConfigId)
    validateVoiceValue(value)
    const [duplicate] = await this.handle.db.select({ id: voiceProfileTable.id }).from(voiceProfileTable).where(and(eq(voiceProfileTable.ownerId, ownerId), eq(voiceProfileTable.providerConfigId, value.providerConfigId), eq(voiceProfileTable.voiceCode, value.voiceCode), isNull(voiceProfileTable.archivedAt))).limit(1)
    if (duplicate) throw problem('VOICE_DUPLICATE', 'Voice code already exists for this TTS config', 409)
    const id = randomUUID()
    const revision = 1
    const now = new Date()
    const nextEtag = etag({ ...value, revision })
    await this.handle.db.insert(voiceProfileTable).values({ id, ownerId, ...structuredClone(value), revision, etag: nextEtag, createdAt: now, updatedAt: now, archivedAt: null })
    const row = await this.findVoiceProfile(ownerId, id)
    if (!row) throw new Error('voice profile insert returned no row')
    return this.mapVoiceProfile(row)
  }

  async updateVoiceProfile(ownerId: string, id: string, value: Partial<Pick<VoiceProfile, 'name' | 'locale' | 'voiceCode' | 'description' | 'demoUrl' | 'enabled' | 'sort'>>, ifMatch: string): Promise<VoiceProfile> {
    const current = await this.findVoiceProfile(ownerId, id)
    if (!current || current.archivedAt) throw problem('NOT_FOUND', 'Voice profile not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
    const next = { ...current, ...structuredClone(value), revision: current.revision + 1 }
    validateVoiceValue(next)
    const [duplicate] = await this.handle.db.select({ id: voiceProfileTable.id }).from(voiceProfileTable).where(and(eq(voiceProfileTable.ownerId, ownerId), eq(voiceProfileTable.providerConfigId, current.providerConfigId), eq(voiceProfileTable.voiceCode, next.voiceCode), isNull(voiceProfileTable.archivedAt))).limit(1)
    if (duplicate && duplicate.id !== id) throw problem('VOICE_DUPLICATE', 'Voice code already exists for this TTS config', 409)
    const updatedAt = new Date()
    const nextEtag = etag({ ...next, revision: next.revision })
    const updated = await this.handle.db.update(voiceProfileTable).set({
      name: next.name, locale: next.locale, voiceCode: next.voiceCode, description: next.description,
      demoUrl: next.demoUrl, enabled: next.enabled, sort: next.sort, revision: next.revision,
      etag: nextEtag, updatedAt,
    }).where(and(eq(voiceProfileTable.id, id), eq(voiceProfileTable.ownerId, ownerId), eq(voiceProfileTable.etag, ifMatch), isNull(voiceProfileTable.archivedAt))).returning({ id: voiceProfileTable.id })
    if (!updated.length) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
    const row = await this.findVoiceProfile(ownerId, id)
    if (!row) throw new Error('voice profile update returned no row')
    return this.mapVoiceProfile(row)
  }

  async deleteVoiceProfile(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const current = await this.findVoiceProfile(ownerId, id)
    if (!current || current.archivedAt) throw problem('NOT_FOUND', 'Voice profile not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
    const updated = await this.handle.db.update(voiceProfileTable).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(voiceProfileTable.id, id), eq(voiceProfileTable.ownerId, ownerId), eq(voiceProfileTable.etag, ifMatch), isNull(voiceProfileTable.archivedAt))).returning({ id: voiceProfileTable.id })
    if (!updated.length) throw problem('REVISION_CONFLICT', 'Voice profile changed', 409)
  }

  async listAssistants(ownerId: string): Promise<Assistant[]> {
    const identities = await this.handle.db.select().from(assistantTable).where(eq(assistantTable.ownerId, ownerId)).orderBy(desc(assistantTable.updatedAt))
    const summaries = await this.assistantSummaries(ownerId, identities.map((identity) => identity.id))
    const values = await Promise.all(identities.map(async (identity) => {
      const revision = await this.findAssistantRevision(identity.id, identity.draftRevision)
      return revision ? this.mapAssistant(identity, revision, summaries.get(identity.id) ?? emptyAssistantSummary()) : undefined
    }))
    return values.filter((value): value is Assistant => value !== undefined)
  }

  async getAssistant(ownerId: string, id: string): Promise<Assistant | undefined> {
    const identity = await this.findAssistantIdentity(ownerId, id)
    if (!identity) return undefined
    const [revision, summaries] = await Promise.all([
      this.findAssistantRevision(id, identity.draftRevision),
      this.assistantSummaries(ownerId, [id]),
    ])
    return revision ? this.mapAssistant(identity, revision, summaries.get(id) ?? emptyAssistantSummary()) : undefined
  }

  async createAssistant(ownerId: string, name: string): Promise<Assistant> {
    const id = randomUUID()
    const now = new Date()
    const revision = 1
    const role: JsonObject = {}
    const providerSelections: Record<string, JsonObject> = {}
    const revisionEtag = etag({ name, revision, role, providerSelections })
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(assistantTable).values({ id, ownerId, name, draftRevision: revision, draftEtag: revisionEtag, publishedRevision: null, createdAt: now, updatedAt: now })
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision, role, providerSelections, etag: revisionEtag, createdAt: now })
    })
    const created = await this.getAssistant(ownerId, id)
    if (!created) throw new Error('assistant insert returned no row')
    return created
  }

  async updateRole(ownerId: string, id: string, value: JsonObject, ifMatch: string): Promise<Assistant> {
    const identity = await this.findAssistantIdentity(ownerId, id)
    if (!identity) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const current = await this.findAssistantRevision(id, identity.draftRevision)
    if (!current) throw new Error('assistant draft revision is missing')
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    const revision = identity.draftRevision + 1
    const nextEtag = etag({ ...value, revision })
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision, role: structuredClone(value), providerSelections: asProviderSelections(current.providerSelections), etag: nextEtag, createdAt: now })
      const updated = await tx.update(assistantTable).set({ draftRevision: revision, draftEtag: nextEtag, updatedAt: now }).where(and(eq(assistantTable.id, id), eq(assistantTable.ownerId, ownerId), eq(assistantTable.draftRevision, identity.draftRevision), eq(assistantTable.draftEtag, ifMatch))).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    })
    const updated = await this.getAssistant(ownerId, id)
    if (!updated) throw new Error('assistant update returned no row')
    return updated
  }

  async getModelMemory(ownerId: string, id: string): Promise<ModelMemoryView> {
    const current = await this.getAssistant(ownerId, id)
    if (!current) throw problem('NOT_FOUND', 'Assistant not found', 404)
    return this.modelMemory(current)
  }

  async updateProviderSelection(ownerId: string, id: string, value: { kind: ProviderKind; mode: 'selected' | 'disabled'; providerConfigId?: string }, ifMatch: string): Promise<ModelMemoryView> {
    const identity = await this.findAssistantIdentity(ownerId, id)
    if (!identity) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const current = await this.findAssistantRevision(id, identity.draftRevision)
    if (!current) throw new Error('assistant draft revision is missing')
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    validateProviderSelectionShape(value)
    if (value.mode === 'selected') {
      const selected = await this.findProviderIdentity(ownerId, value.providerConfigId!)
      const installation = selected ? this.installations.find((item) => item.id === selected.installationId) : undefined
      if (!selected || !installation) throw problem('CONFIG_INVALID', 'Provider config is not available for this owner', 422)
      if (installation.kind !== value.kind) throw problem('CONFIG_INVALID', 'Provider config kind does not match selection kind', 422)
      if (!selected.enabled) throw problem('CONFIG_INVALID', 'Provider config is disabled', 422)
    }
    const selections = { ...asProviderSelections(current.providerSelections), [value.kind]: value.mode === 'selected' ? { mode: value.mode, providerConfigId: value.providerConfigId } : { mode: value.mode } }
    const revision = identity.draftRevision + 1
    const nextEtag = etag({ selections, revision })
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision, role: asJsonObject(current.role), providerSelections: selections, etag: nextEtag, createdAt: now })
      const updated = await tx.update(assistantTable).set({ draftRevision: revision, draftEtag: nextEtag, updatedAt: now }).where(and(eq(assistantTable.id, id), eq(assistantTable.ownerId, ownerId), eq(assistantTable.draftRevision, identity.draftRevision), eq(assistantTable.draftEtag, ifMatch))).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    })
    const updated = await this.getAssistant(ownerId, id)
    if (!updated) throw new Error('assistant provider selection update returned no row')
    return this.modelMemory(updated)
  }

  async setMemoryEnabled(ownerId: string, id: string, enabled: boolean, ifMatch: string): Promise<ModelMemoryView> {
    const identity = await this.findAssistantIdentity(ownerId, id)
    if (!identity) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const current = await this.findAssistantRevision(id, identity.draftRevision)
    if (!current) throw new Error('assistant draft revision is missing')
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    const role = { ...asJsonObject(current.role), memoryEnabled: enabled }
    const revision = identity.draftRevision + 1
    const nextEtag = etag({ role, revision })
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision, role, providerSelections: asProviderSelections(current.providerSelections), etag: nextEtag, createdAt: now })
      const updated = await tx.update(assistantTable).set({ draftRevision: revision, draftEtag: nextEtag, updatedAt: now }).where(and(eq(assistantTable.id, id), eq(assistantTable.ownerId, ownerId), eq(assistantTable.draftRevision, identity.draftRevision), eq(assistantTable.draftEtag, ifMatch))).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
    })
    const updated = await this.getAssistant(ownerId, id)
    if (!updated) throw new Error('assistant memory update returned no row')
    return this.modelMemory(updated)
  }

  async publish(ownerId: string, id: string, ifMatch?: string): Promise<RuntimePublication> {
    return this.handle.db.transaction(async (tx) => {
      const [identity] = await tx.select().from(assistantTable).where(and(eq(assistantTable.ownerId, ownerId), eq(assistantTable.id, id))).limit(1)
      if (!identity) throw problem('NOT_FOUND', 'Assistant not found', 404)
      const [current] = await tx.select().from(assistantRevisionTable).where(and(eq(assistantRevisionTable.assistantId, id), eq(assistantRevisionTable.revision, identity.draftRevision))).limit(1)
      if (!current) throw new Error('assistant draft revision is missing')
      if (ifMatch && current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
      const role = asJsonObject(current.role)
      if (!role.locale || !role.basePrompt) throw problem('CONFIG_NOT_PUBLISHABLE', 'Role configuration is incomplete', 422)
      const resolvedProviders: Record<string, Record<string, unknown>> = {}
      for (const [kind, value] of Object.entries(asProviderSelections(current.providerSelections))) {
        if (!value || value.mode === 'disabled') {
          resolvedProviders[kind] = { mode: 'disabled' }
          continue
        }
        if (typeof value.providerId === 'string' && value.config && typeof value.config === 'object') {
          const installation = this.installations.find((item) => item.id === value.providerId)
          if (!installation) throw problem('CONFIG_NOT_PUBLISHABLE', `Provider installation is not configured: ${kind}`, 422)
          validateSecretBindings(installation, asSecretRefs(value.secretRefs), { requireComplete: true })
          resolvedProviders[kind] = structuredClone(value)
          continue
        }
        const selectedId = typeof value.providerConfigId === 'string' ? value.providerConfigId : undefined
        const [provider] = selectedId ? await tx.select().from(providerConfigTable).where(and(eq(providerConfigTable.id, selectedId), eq(providerConfigTable.ownerId, ownerId))).limit(1) : []
        const [providerRevision] = provider ? await tx.select().from(providerConfigRevisionTable).where(and(eq(providerConfigRevisionTable.providerConfigId, provider.id), eq(providerConfigRevisionTable.revision, provider.currentRevision))).limit(1) : []
        const installation = provider ? this.installations.find((item) => item.id === provider.installationId) : undefined
        if (!provider || !providerRevision || !installation) throw problem('CONFIG_NOT_PUBLISHABLE', `Provider selection is not configured: ${kind}`, 422)
        validateSecretBindings(installation, asSecretRefs(providerRevision.secretRefs), { requireComplete: true })
        resolvedProviders[kind] = { providerId: installation.id, version: installation.version, providerConfigId: provider.id, configRevision: providerRevision.revision, config: asJsonObject(providerRevision.config), secretRefs: asSecretRefs(providerRevision.secretRefs) }
      }
      const snapshot: RuntimeSnapshot = {
        ...roleExtras(role),
        schemaVersion: 1,
        revision: identity.draftRevision,
        assistantId: id,
        locale: String(role.locale),
        basePrompt: String(role.basePrompt),
        personality: asJsonObject(role.personality),
        speech: asJsonObject(role.speech),
        providers: resolvedProviders,
        wire: { profile: 'ws-v3', uplinkSampleRate: 16000, downlinkSampleRate: 24000, frameDurationMs: 60 },
        conversation: role.conversation && typeof role.conversation === 'object' && !Array.isArray(role.conversation) ? structuredClone(role.conversation) : structuredClone(DEFAULT_CONVERSATION_POLICY),
      }
      const publicationEtag = etag(snapshot)
      const conditions = [eq(assistantTable.id, id), eq(assistantTable.ownerId, ownerId), eq(assistantTable.draftRevision, identity.draftRevision)]
      if (ifMatch) conditions.push(eq(assistantTable.draftEtag, ifMatch))
      const updated = await tx.update(assistantTable).set({ publishedRevision: identity.draftRevision, updatedAt: new Date() }).where(and(...conditions)).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Assistant changed', 409)
      const now = new Date()
      await tx.insert(runtimePublicationTable).values({ assistantId: id, revision: identity.draftRevision, snapshot, etag: publicationEtag, updatedAt: now }).onConflictDoUpdate({ target: runtimePublicationTable.assistantId, set: { revision: identity.draftRevision, snapshot, etag: publicationEtag, updatedAt: now } })
      return { snapshot: structuredClone(snapshot), etag: publicationEtag, updatedAt: now.toISOString() }
    })
  }

  async runtime(assistantId?: string): Promise<RuntimePublication | undefined> {
    const rows = assistantId
      ? await this.handle.db.select().from(runtimePublicationTable).where(eq(runtimePublicationTable.assistantId, assistantId)).limit(1)
      : await this.handle.db.select().from(runtimePublicationTable).orderBy(desc(runtimePublicationTable.updatedAt)).limit(1)
    const row = rows[0]
    if (!row) return undefined
    return { snapshot: asRuntimeSnapshot(row.snapshot), etag: row.etag, updatedAt: row.updatedAt.toISOString() }
  }

  async setRuntime(publication: RuntimePublication): Promise<void> {
    const now = new Date(publication.updatedAt)
    await this.handle.db.insert(runtimePublicationTable).values({ assistantId: publication.snapshot.assistantId, revision: publication.snapshot.revision, snapshot: structuredClone(publication.snapshot), etag: publication.etag, updatedAt: now }).onConflictDoUpdate({ target: runtimePublicationTable.assistantId, set: { revision: publication.snapshot.revision, snapshot: structuredClone(publication.snapshot), etag: publication.etag, updatedAt: now } })
  }

  async createSession(ownerId: string, tokenHash: string, csrfHash: string, expiresAt: Date): Promise<ManagerSession> {
    const now = new Date()
    const [row] = await this.handle.db.insert(managerSessionTable).values({ id: randomUUID(), ownerId, tokenHash, csrfHash, expiresAt, createdAt: now, lastSeenAt: now, revokedAt: null }).returning()
    if (!row) throw new Error('session insert returned no row')
    return this.mapSession(row)
  }

  async findSession(tokenHash: string): Promise<ManagerSession | undefined> {
    const [row] = await this.handle.db.select().from(managerSessionTable).where(eq(managerSessionTable.tokenHash, tokenHash)).limit(1)
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return undefined
    const [updated] = await this.handle.db.update(managerSessionTable).set({ lastSeenAt: new Date() }).where(and(eq(managerSessionTable.id, row.id), eq(managerSessionTable.tokenHash, tokenHash), isNull(managerSessionTable.revokedAt))).returning()
    return this.mapSession(updated ?? row)
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.handle.db.update(managerSessionTable).set({ revokedAt: new Date() }).where(and(eq(managerSessionTable.tokenHash, tokenHash), isNull(managerSessionTable.revokedAt)))
  }

  async listSecretReferences(ownerId: string): Promise<SecretReference[]> {
    const rows = await this.handle.db.select().from(secretReferenceTable).where(eq(secretReferenceTable.ownerId, ownerId)).orderBy(asc(secretReferenceTable.name))
    return rows.map((row) => this.mapSecretReference(row))
  }

  async createSecretReference(ownerId: string, value: { id: string; name: string; locatorMasked: string; version: number; status: SecretReference['status'] }): Promise<SecretReference> {
    const now = new Date()
    const metadataRevision = 1
    const nextEtag = etag({ ...value, metadataRevision })
    const [row] = await this.handle.db.insert(secretReferenceTable).values({ id: value.id, ownerId, name: value.name, store: 'encrypted-local', locatorMasked: value.locatorMasked, version: value.version, metadataRevision, status: value.status, lastRotatedAt: value.status === 'available' ? now : null, etag: nextEtag, createdAt: now, updatedAt: now }).returning()
    if (!row) throw new Error('secret reference insert returned no row')
    return this.mapSecretReference(row)
  }

  async updateSecretReference(ownerId: string, id: string, value: SecretReferenceUpdate, ifMatch: string): Promise<SecretReference> {
    const [current] = await this.handle.db.select().from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.id, id))).limit(1)
    if (!current) throw problem('NOT_FOUND', 'Secret reference not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    const metadataRevision = current.metadataRevision + 1
    const name = value.name ?? current.name
    const locatorMasked = value.locatorMasked ?? current.locatorMasked
    const version = value.version ?? current.version
    const status = value.status ?? (current.status === 'available' || current.status === 'revoked' ? current.status : 'unavailable')
    const lastRotatedAt = value.lastRotatedAt === undefined
      ? current.lastRotatedAt
      : value.lastRotatedAt === null
        ? null
        : new Date(value.lastRotatedAt)
    const nextEtag = etag({ name, locatorMasked, version, status, lastRotatedAt: lastRotatedAt?.toISOString() ?? null, metadataRevision })
    const [updated] = await this.handle.db.update(secretReferenceTable).set({ name, locatorMasked, version, status, lastRotatedAt, metadataRevision, etag: nextEtag, updatedAt: new Date() }).where(and(eq(secretReferenceTable.id, id), eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.etag, ifMatch))).returning()
    if (!updated) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    return this.mapSecretReference(updated)
  }

  async deleteSecretReference(ownerId: string, id: string, ifMatch: string): Promise<void> {
    const [current] = await this.handle.db.select().from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.id, id))).limit(1)
    if (!current) throw problem('NOT_FOUND', 'Secret reference not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    const [configBinding] = await this.handle.db.select({ id: providerConfigRevisionTable.providerConfigId }).from(providerConfigRevisionTable).innerJoin(providerConfigTable, eq(providerConfigRevisionTable.providerConfigId, providerConfigTable.id)).where(and(eq(providerConfigTable.ownerId, ownerId), sql`${providerConfigRevisionTable.secretRefs} @> ${JSON.stringify([id])}::jsonb`)).limit(1)
    if (configBinding) throw problem('RESOURCE_IN_USE', 'Secret reference is still bound to a provider config revision', 409)
    const [binding] = await this.handle.db.select({ id: providerSecretBindingTable.secretReferenceId }).from(providerSecretBindingTable).where(eq(providerSecretBindingTable.secretReferenceId, id)).limit(1)
    if (binding) throw problem('RESOURCE_IN_USE', 'Secret reference is still bound to a provider config revision', 409)
    await this.handle.db.delete(secretReferenceTable).where(and(eq(secretReferenceTable.id, id), eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.etag, ifMatch)))
  }

  async listDevices(ownerId: string, assistantId: string): Promise<Device[]> {
    const rows = await this.handle.db.select().from(deviceTable).where(and(eq(deviceTable.ownerId, ownerId), eq(deviceTable.assistantId, assistantId))).orderBy(desc(deviceTable.updatedAt))
    const now = this.clock()
    return rows.map((row) => this.mapDevice(row, now))
  }

  async listDiscoverableDevices(ownerId: string): Promise<DiscoverableDevice[]> {
    void ownerId
    const now = this.clock()
    const cutoff = new Date(now.getTime() - this.presenceTtlMs)
    const devices = await this.handle.db.select().from(deviceTable).where(and(isNull(deviceTable.ownerId), isNull(deviceTable.assistantId), eq(deviceTable.onlineState, 'online'), gt(deviceTable.lastSeenAt, cutoff))).orderBy(desc(deviceTable.lastSeenAt))
    if (!devices.length) return []
    const challenges = await this.handle.db.select().from(pairingChallengeTable).where(and(inArray(pairingChallengeTable.deviceId, devices.map((device) => device.id)), eq(pairingChallengeTable.state, 'pending'), gt(pairingChallengeTable.expiresAt, now)))
    const latest = new Map<string, typeof challenges[number]>()
    for (const challenge of challenges) {
      const current = latest.get(challenge.deviceId)
      if (!current || challenge.expiresAt.getTime() > current.expiresAt.getTime()) latest.set(challenge.deviceId, challenge)
    }
    return devices.flatMap((device) => {
      const challenge = latest.get(device.id)
      if (!challenge) return []
      return [{ id: device.id, maskedMac: device.maskedMac, board: device.board, firmwareVersion: device.firmwareVersion, onlineState: 'online' as const, lastSeenAt: device.lastSeenAt.toISOString(), pairingExpiresAt: challenge.expiresAt.toISOString() }]
    })
  }

  async reportDevicePresence(value: DevicePresenceInput): Promise<DevicePresenceResult> {
    const now = new Date()
    const [existing] = await this.handle.db.select().from(deviceTable).where(and(eq(deviceTable.identityHash, value.identityHash), eq(deviceTable.clientIdHash, value.clientIdHash))).limit(1)
    const deviceId = existing?.id ?? randomUUID()
    if (existing) {
      await this.handle.db.update(deviceTable).set({
        maskedMac: value.maskedMac,
        board: value.board,
        firmwareVersion: value.firmwareVersion,
        onlineState: value.onlineState,
        lastSeenAt: now,
        updatedAt: now,
      }).where(eq(deviceTable.id, deviceId))
    } else {
      await this.handle.db.insert(deviceTable).values({
        id: deviceId,
        ownerId: null,
        assistantId: null,
        identityHash: value.identityHash,
        clientIdHash: value.clientIdHash,
        displayName: '',
        maskedMac: value.maskedMac,
        firmwareVersion: value.firmwareVersion,
        board: value.board,
        onlineState: value.onlineState,
        lastSeenAt: now,
        lastConversationAt: null,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (value.onlineState === 'online' && !existing?.ownerId && !existing?.assistantId && value.pairingCodeHash && /^[0-9a-f]{64}$/i.test(value.pairingCodeHash)) {
      const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
      const [pending] = await this.handle.db.select().from(pairingChallengeTable).where(and(eq(pairingChallengeTable.deviceId, deviceId), eq(pairingChallengeTable.state, 'pending'))).orderBy(desc(pairingChallengeTable.createdAt)).limit(1)
      if (pending) {
        await this.handle.db.update(pairingChallengeTable).set({ codeHash: value.pairingCodeHash.toLowerCase(), attempts: 0, expiresAt }).where(eq(pairingChallengeTable.id, pending.id))
      } else {
        await this.handle.db.insert(pairingChallengeTable).values({ id: randomUUID(), deviceId, codeHash: value.pairingCodeHash.toLowerCase(), state: 'pending', attempts: 0, expiresAt, createdAt: now, usedAt: null })
      }
    }
    return { id: deviceId, paired: Boolean(existing?.ownerId && existing.assistantId), onlineState: value.onlineState, lastSeenAt: now.toISOString() }
  }

  async createPairingChallenge(value: { identityHash: string; clientIdHash: string; maskedMac: string; board: string; firmwareVersion: string }): Promise<PairingChallenge> {
    const now = new Date()
    const existing = (await this.handle.db.select().from(deviceTable).where(and(eq(deviceTable.identityHash, value.identityHash), eq(deviceTable.clientIdHash, value.clientIdHash))).limit(1))[0]
    const deviceId = existing?.id ?? randomUUID()
    if (existing) {
      await this.handle.db.update(deviceTable).set({ maskedMac: value.maskedMac, board: value.board, firmwareVersion: value.firmwareVersion, onlineState: 'online', lastSeenAt: now, updatedAt: now }).where(eq(deviceTable.id, existing.id))
    } else {
      await this.handle.db.insert(deviceTable).values({ id: deviceId, ownerId: null, assistantId: null, identityHash: value.identityHash, clientIdHash: value.clientIdHash, displayName: '', maskedMac: value.maskedMac, board: value.board, firmwareVersion: value.firmwareVersion, onlineState: 'online', lastSeenAt: now, lastConversationAt: null, createdAt: now, updatedAt: now })
    }
    const id = randomUUID()
    /* The firmware renders a six-digit numeric code. Keep the challenge
       format identical across the API, LCD and dashboard; the parser still
       accepts the old VT-#### shape for already-issued compatibility codes. */
    const verificationCode = randomInt(100000, 1000000).toString()
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
    await this.handle.db.insert(pairingChallengeTable).values({ id, deviceId, codeHash: hashPairingCode(verificationCode), state: 'pending', attempts: 0, expiresAt, createdAt: now, usedAt: null })
    return { id, deviceId, verificationCode, expiresAt: expiresAt.toISOString() }
  }

  async pairDevice(ownerId: string, value: { assistantId: string; deviceId?: string; verificationCode: string; displayName?: string }): Promise<Device> {
    return this.handle.db.transaction(async (tx) => {
      const [assistant] = await tx.select({ id: assistantTable.id }).from(assistantTable).where(and(eq(assistantTable.id, value.assistantId), eq(assistantTable.ownerId, ownerId))).limit(1)
      if (!assistant) throw problem('NOT_FOUND', 'Assistant not found', 404)
      const codeHash = hashPairingCode(value.verificationCode.trim().toUpperCase())
      const challengeConditions = [eq(pairingChallengeTable.codeHash, codeHash), eq(pairingChallengeTable.state, 'pending'), lt(pairingChallengeTable.attempts, 5), gt(pairingChallengeTable.expiresAt, new Date())]
      if (value.deviceId) challengeConditions.push(eq(pairingChallengeTable.deviceId, value.deviceId))
      const [challenge] = await tx.select().from(pairingChallengeTable).where(and(...challengeConditions)).limit(1)
      if (!challenge) throw problem('PAIRING_CODE_INVALID', 'Pairing code is invalid or expired', 422)
      const [device] = await tx.select().from(deviceTable).where(eq(deviceTable.id, challenge.deviceId)).limit(1)
      if (!device || (device.ownerId && device.ownerId !== ownerId)) throw problem('PAIRING_CODE_INVALID', 'Pairing device is already owned', 422)
      const now = new Date()
      const [updated] = await tx.update(deviceTable).set({ ownerId, assistantId: value.assistantId, displayName: value.displayName?.trim() || device.displayName || `Veetee ${device.id.slice(0, 8)}`, onlineState: 'online', lastSeenAt: now, updatedAt: now }).where(eq(deviceTable.id, device.id)).returning()
      await tx.update(pairingChallengeTable).set({ state: 'used', usedAt: now }).where(and(eq(pairingChallengeTable.id, challenge.id), eq(pairingChallengeTable.state, 'pending')))
      if (!updated) throw new Error('device pairing update returned no row')
      return this.mapDevice(updated, this.clock())
    })
  }

  async unlinkDevice(ownerId: string, id: string, ifMatch: string): Promise<void> {
    await this.handle.db.transaction(async (tx) => {
      const [device] = await tx.select().from(deviceTable).where(and(eq(deviceTable.id, id), eq(deviceTable.ownerId, ownerId))).limit(1)
      if (!device) throw problem('NOT_FOUND', 'Device not found', 404)

      /* A repeated unlink is intentionally a no-op. Keep the owner check above
         so an unbound row cannot be used to probe another owner's identity. */
      if (!device.assistantId) return
      if (deviceEtag({ id: device.id, ownerId: device.ownerId, assistantId: device.assistantId, displayName: device.displayName }) !== ifMatch) {
        throw problem('REVISION_CONFLICT', 'Device binding changed', 409)
      }

      const updated = await tx.update(deviceTable)
        .set({ assistantId: null, updatedAt: new Date() })
        .where(and(eq(deviceTable.id, id), eq(deviceTable.ownerId, ownerId), eq(deviceTable.assistantId, device.assistantId)))
        .returning({ id: deviceTable.id })
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Device binding changed', 409)
    })
  }

  async getRetentionPolicy(ownerId: string): Promise<RetentionPolicy> {
    const [row] = await this.handle.db.select().from(retentionPolicyTable).where(eq(retentionPolicyTable.ownerId, ownerId)).limit(1)
    return row ? this.mapRetentionPolicy(row) : defaultRetentionPolicy(ownerId)
  }

  async updateRetentionPolicy(ownerId: string, value: Pick<RetentionPolicy, 'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'>, ifMatch: string): Promise<RetentionPolicy> {
    const current = await this.getRetentionPolicy(ownerId)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Retention policy changed', 409)
    validateRetentionPolicyInput(value)
    const revision = current.revision + 1
    const nextEtag = etag({ ...value, revision })
    const effectiveAt = new Date()
    const [updated] = await this.handle.db.insert(retentionPolicyTable).values({ ownerId, captureTranscript: value.captureTranscript, transcriptDays: value.transcriptDays, captureAudio: value.captureAudio, audioDays: value.audioDays, effectiveAt, revision, etag: nextEtag }).onConflictDoUpdate({ target: retentionPolicyTable.ownerId, set: { captureTranscript: value.captureTranscript, transcriptDays: value.transcriptDays, captureAudio: value.captureAudio, audioDays: value.audioDays, effectiveAt, revision, etag: nextEtag } }).returning()
    if (!updated) throw new Error('retention policy update returned no row')
    return this.mapRetentionPolicy(updated)
  }

  async purgeExpiredConversations(now: Date = new Date()): Promise<RetentionPurgeResult> {
    return this.handle.db.transaction(async (tx) => {
      const expired = await tx.select({ id: conversationTable.id, ownerId: conversationTable.ownerId }).from(conversationTable)
        .where(and(isNotNull(conversationTable.retentionUntil), lte(conversationTable.retentionUntil, now)))
        .for('update')
      for (const row of expired) {
        await tx.insert(conversationTombstoneTable).values({ conversationId: row.id, ownerId: row.ownerId, deletedAt: now, expiresAt: new Date(now.getTime() + this.tombstoneTtlMs), reason: 'retention_expired', deleteJobId: null }).onConflictDoNothing()
      }
      if (expired.length) await tx.delete(conversationTable).where(inArray(conversationTable.id, expired.map((row) => row.id)))
      await tx.delete(conversationTombstoneTable).where(lte(conversationTombstoneTable.expiresAt, now))
      return { conversations: expired.length }
    })
  }

  async requestConversationDelete(ownerId: string, conversationId: string): Promise<RetentionDeleteJob> {
    return this.handle.db.transaction(async (tx) => {
      const [existingJob] = await tx.select().from(retentionDeleteJobTable).where(and(eq(retentionDeleteJobTable.ownerId, ownerId), eq(retentionDeleteJobTable.conversationId, conversationId))).limit(1).for('update')
      const now = new Date()
      if (existingJob) {
        if (existingJob.status === 'failed' && existingJob.attempts < 3) {
          const [updated] = await tx.update(retentionDeleteJobTable).set({ status: 'queued', requestedAt: now, startedAt: null, completedAt: null, errorCode: null }).where(eq(retentionDeleteJobTable.id, existingJob.id)).returning()
          if (updated) return this.mapRetentionDeleteJob(updated)
        }
        return this.mapRetentionDeleteJob(existingJob)
      }
      const [conversation] = await tx.select({ id: conversationTable.id, ownerId: conversationTable.ownerId }).from(conversationTable).where(and(eq(conversationTable.id, conversationId), eq(conversationTable.ownerId, ownerId))).limit(1)
      if (!conversation) {
        const [tombstone] = await tx.select({ ownerId: conversationTombstoneTable.ownerId }).from(conversationTombstoneTable).where(and(eq(conversationTombstoneTable.conversationId, conversationId), eq(conversationTombstoneTable.ownerId, ownerId), gt(conversationTombstoneTable.expiresAt, now))).limit(1)
        if (tombstone) throw problem('RETENTION_EXPIRED', 'Conversation has already expired or been deleted', 410)
        throw problem('NOT_FOUND', 'Conversation not found', 404)
      }
      const [created] = await tx.insert(retentionDeleteJobTable).values({ id: randomUUID(), ownerId, conversationId, status: 'queued', attempts: 0, requestedAt: now, startedAt: null, completedAt: null, errorCode: null }).onConflictDoNothing().returning()
      if (created) return this.mapRetentionDeleteJob(created)
      const [raced] = await tx.select().from(retentionDeleteJobTable).where(and(eq(retentionDeleteJobTable.ownerId, ownerId), eq(retentionDeleteJobTable.conversationId, conversationId))).limit(1)
      if (!raced) throw new Error('retention delete job insert returned no row')
      return this.mapRetentionDeleteJob(raced)
    })
  }

  async runConversationDeleteJob(jobId: string): Promise<RetentionDeleteJob> {
    return this.handle.db.transaction(async (tx) => {
      const [job] = await tx.select().from(retentionDeleteJobTable).where(eq(retentionDeleteJobTable.id, jobId)).limit(1).for('update')
      if (!job) throw problem('NOT_FOUND', 'Retention delete job not found', 404)
      if (job.status === 'completed') return this.mapRetentionDeleteJob(job)
      if (job.attempts >= 3) {
        const [failed] = await tx.update(retentionDeleteJobTable).set({ status: 'failed', errorCode: 'DELETE_RETRY_LIMIT', completedAt: new Date() }).where(eq(retentionDeleteJobTable.id, job.id)).returning()
        return this.mapRetentionDeleteJob(failed ?? job)
      }
      const startedAt = new Date()
      const [running] = await tx.update(retentionDeleteJobTable).set({ status: 'running', attempts: job.attempts + 1, startedAt, completedAt: null, errorCode: null }).where(eq(retentionDeleteJobTable.id, job.id)).returning()
      const [conversation] = await tx.select({ id: conversationTable.id, ownerId: conversationTable.ownerId }).from(conversationTable).where(and(eq(conversationTable.id, job.conversationId), eq(conversationTable.ownerId, job.ownerId))).limit(1).for('update')
      if (!conversation) {
        const [tombstone] = await tx.select().from(conversationTombstoneTable).where(and(eq(conversationTombstoneTable.conversationId, job.conversationId), eq(conversationTombstoneTable.ownerId, job.ownerId))).limit(1)
        if (!tombstone) {
          const [failed] = await tx.update(retentionDeleteJobTable).set({ status: 'failed', completedAt: new Date(), errorCode: 'NOT_FOUND' }).where(eq(retentionDeleteJobTable.id, job.id)).returning()
          return this.mapRetentionDeleteJob(failed ?? running ?? job)
        }
      } else {
        const deletedAt = new Date()
        await tx.insert(conversationTombstoneTable).values({ conversationId: job.conversationId, ownerId: job.ownerId, deletedAt, expiresAt: new Date(deletedAt.getTime() + this.tombstoneTtlMs), reason: 'owner_request', deleteJobId: job.id }).onConflictDoNothing()
        await tx.delete(conversationTable).where(and(eq(conversationTable.id, job.conversationId), eq(conversationTable.ownerId, job.ownerId)))
      }
      const [completed] = await tx.update(retentionDeleteJobTable).set({ status: 'completed', completedAt: new Date(), errorCode: null }).where(eq(retentionDeleteJobTable.id, job.id)).returning()
      return this.mapRetentionDeleteJob(completed ?? running ?? job)
    })
  }

  async getRetentionDeleteJob(ownerId: string, jobId: string): Promise<RetentionDeleteJob | undefined> {
    const [job] = await this.handle.db.select().from(retentionDeleteJobTable).where(and(eq(retentionDeleteJobTable.id, jobId), eq(retentionDeleteJobTable.ownerId, ownerId))).limit(1)
    return job ? this.mapRetentionDeleteJob(job) : undefined
  }

  async ingestConversationTurn(value: ConversationTurnInput): Promise<ConversationDetail> {
    validateConversationTurnInput(value)
    const [assistant] = await this.handle.db.select({ id: assistantTable.id, ownerId: assistantTable.ownerId }).from(assistantTable).where(eq(assistantTable.id, value.assistantId)).limit(1)
    if (!assistant) throw problem('NOT_FOUND', 'Assistant not found', 404)
    const policy = await this.getRetentionPolicy(assistant.ownerId)
    const transcript = policy.captureTranscript ? structuredClone(value.transcript) : []
    const status = value.conversationStatus ?? (value.state === 'completed' ? 'completed' : value.state === 'aborted' ? 'aborted' : 'error')
    const retentionUntil = policy.captureTranscript && policy.transcriptDays !== null && status !== 'active'
      ? new Date(Date.parse(value.conversationEndedAt ?? value.endedAt) + policy.transcriptDays * 86_400_000)
      : null
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(conversationTable).values({
        id: value.conversationId, ownerId: assistant.ownerId, assistantId: value.assistantId, deviceKey: value.deviceKey ?? null,
        startedAt: new Date(value.conversationStartedAt), endedAt: value.conversationEndedAt ? new Date(value.conversationEndedAt) : null,
        locale: value.locale, configRevision: value.configRevision, status, turnCount: 0, lastTurnAt: null, aggregateTimings: {}, retentionUntil,
      }).onConflictDoNothing()
      const [current] = await tx.select().from(conversationTable).where(eq(conversationTable.id, value.conversationId)).for('update').limit(1)
      if (!current) throw new Error('conversation insert returned no row')
      if (current && (current.ownerId !== assistant.ownerId || current.assistantId !== value.assistantId)) {
        throw problem('NOT_FOUND', 'Conversation not found', 404)
      }
      const [duplicate] = await tx.select({ sequence: conversationTurnTable.sequence }).from(conversationTurnTable).where(and(eq(conversationTurnTable.conversationId, value.conversationId), eq(conversationTurnTable.turnId, value.turnId))).limit(1)
      if (duplicate) {
        if (duplicate.sequence !== value.sequence) throw problem('HISTORY_INVALID', 'conversation turn sequence conflicts with an existing turn', 422)
        return
      }
      const [sequenceConflict] = await tx.select({ turnId: conversationTurnTable.turnId }).from(conversationTurnTable).where(and(eq(conversationTurnTable.conversationId, value.conversationId), eq(conversationTurnTable.sequence, value.sequence))).limit(1)
      if (sequenceConflict) throw problem('HISTORY_INVALID', 'conversation turn sequence conflicts with an existing turn', 422)
      const inserted = await tx.insert(conversationTurnTable).values({ id: randomUUID(), conversationId: value.conversationId, turnId: value.turnId, sequence: value.sequence, state: value.state, startedAt: new Date(value.startedAt), endedAt: new Date(value.endedAt), finishReason: value.finishReason, timings: structuredClone(value.timings), transcript, toolCalls: structuredClone(value.toolCalls) }).onConflictDoNothing().returning({ id: conversationTurnTable.id })
      if (!inserted.length) {
        const [concurrent] = await tx.select({ turnId: conversationTurnTable.turnId, sequence: conversationTurnTable.sequence }).from(conversationTurnTable).where(and(eq(conversationTurnTable.conversationId, value.conversationId), or(eq(conversationTurnTable.turnId, value.turnId), eq(conversationTurnTable.sequence, value.sequence)))).limit(1)
        if (concurrent?.turnId === value.turnId && concurrent.sequence === value.sequence) return
        throw problem('HISTORY_INVALID', 'conversation turn sequence conflicts with an existing turn', 422)
      }
      const aggregateTimings = { ...asJsonObject(current.aggregateTimings), ...value.timings }
      const nextStatus = status as ConversationStatus
      await tx.update(conversationTable).set({
        deviceKey: value.deviceKey ?? current.deviceKey,
        endedAt: laterDate(current.endedAt, value.conversationEndedAt ? new Date(value.conversationEndedAt) : null),
        status: nextStatus,
        turnCount: current.turnCount + 1,
        lastTurnAt: laterDate(current.lastTurnAt, new Date(value.endedAt)),
        aggregateTimings,
        retentionUntil: laterDate(current.retentionUntil, retentionUntil),
      }).where(eq(conversationTable.id, value.conversationId))
      if (value.deviceKey && isDeviceIdentityHash(value.deviceKey)) {
        const [device] = await tx.select({ id: deviceTable.id, lastConversationAt: deviceTable.lastConversationAt }).from(deviceTable)
          .where(and(eq(deviceTable.identityHash, value.deviceKey), eq(deviceTable.ownerId, assistant.ownerId), eq(deviceTable.assistantId, value.assistantId)))
          .for('update').limit(1)
        const endedAt = new Date(value.endedAt)
        if (device && (!device.lastConversationAt || endedAt > device.lastConversationAt)) {
          await tx.update(deviceTable).set({ lastConversationAt: endedAt, updatedAt: new Date() }).where(eq(deviceTable.id, device.id))
        }
      }
    })
    const detail = await this.getConversation(assistant.ownerId, value.conversationId)
    if (!detail) throw new Error('conversation ingest returned no row')
    return detail
  }

  async listConversations(ownerId: string, assistantId: string, limit: number): Promise<ConversationSummary[]> {
    const rows = await this.handle.db.select().from(conversationTable).where(and(eq(conversationTable.ownerId, ownerId), eq(conversationTable.assistantId, assistantId), or(isNull(conversationTable.retentionUntil), gt(conversationTable.retentionUntil, new Date())))).orderBy(desc(conversationTable.startedAt)).limit(limit)
    return rows.map((row) => this.mapConversation(row))
  }

  async getConversation(ownerId: string, id: string): Promise<ConversationDetail | undefined> {
    const [conversation] = await this.handle.db.select().from(conversationTable).where(and(eq(conversationTable.ownerId, ownerId), eq(conversationTable.id, id), or(isNull(conversationTable.retentionUntil), gt(conversationTable.retentionUntil, new Date())))).limit(1)
    if (!conversation) {
      const [tombstone] = await this.handle.db.select({ ownerId: conversationTombstoneTable.ownerId }).from(conversationTombstoneTable).where(and(eq(conversationTombstoneTable.conversationId, id), eq(conversationTombstoneTable.ownerId, ownerId), gt(conversationTombstoneTable.expiresAt, new Date()))).limit(1)
      if (tombstone) throw problem('RETENTION_EXPIRED', 'Conversation has already expired or been deleted', 410)
      return undefined
    }
    const turns = await this.handle.db.select().from(conversationTurnTable).where(eq(conversationTurnTable.conversationId, id)).orderBy(asc(conversationTurnTable.sequence))
    return { summary: this.mapConversation(conversation), turns: turns.map((row) => this.mapConversationTurn(row)), retention: await this.getRetentionPolicy(ownerId) }
  }

  private async assertMigrated(): Promise<void> {
    try {
      await this.handle.db.select({ id: assistantTable.id }).from(assistantTable).limit(1)
    } catch (error) {
      throw new Error('Veetee PostgreSQL schema is not migrated; run `npm run db:migrate` first', { cause: error })
    }
  }

  private async seedIfEmpty(initial: RuntimeSnapshot): Promise<void> {
    const [existing] = await this.handle.db.select({ id: assistantTable.id }).from(assistantTable).limit(1)
    if (existing) return
    const id = isUuid(initial.assistantId) ? initial.assistantId : randomUUID()
    const snapshot = { ...structuredClone(initial), assistantId: id }
    const now = new Date()
    const role: JsonObject = roleFromSnapshot(snapshot)
    const providerSelections = asProviderSelections(snapshot.providers)
    const revisionEtag = etag(snapshot)
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(assistantTable).values({ id, ownerId: 'local-owner', name: 'Veetee', draftRevision: snapshot.revision, draftEtag: revisionEtag, publishedRevision: snapshot.revision, createdAt: now, updatedAt: now })
      for (const [kind, value] of Object.entries(providerSelections)) {
        if (!value || value.mode === 'disabled' || typeof value.providerId !== 'string' || !value.config || typeof value.config !== 'object' || Array.isArray(value.config)) continue
        const installation = this.installations.find((item) => item.id === value.providerId)
        if (!installation) continue
        const providerConfigId = randomUUID()
        const providerConfig = normalizeProviderConfig(installation, asJsonObject(value.config))
        const providerEtag = etag({ ...providerConfig, revision: 1 })
        await tx.insert(providerConfigTable).values({ id: providerConfigId, ownerId: 'local-owner', installationId: installation.id, name: `${installation.displayName ?? installation.displayNameKey} mặc định`, enabled: true, currentRevision: 1, currentEtag: etag({ ...providerConfig, revision: 1, enabled: true }), createdAt: now, updatedAt: now, archivedAt: null })
        await tx.insert(providerConfigRevisionTable).values({ providerConfigId, revision: 1, config: providerConfig, secretRefs: [], etag: providerEtag, createdAt: now })
        providerSelections[kind] = { mode: 'selected', providerConfigId }
      }
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision: snapshot.revision, role, providerSelections, etag: revisionEtag, createdAt: now })
      await tx.insert(runtimePublicationTable).values({ assistantId: id, revision: snapshot.revision, snapshot, etag: revisionEtag, updatedAt: now })
    })
  }

  private async seedModelRegistry(registry: ModelRegistrySeed): Promise<void> {
    const [existing] = await this.handle.db.select({ id: modelProviderTable.id }).from(modelProviderTable).limit(1)
    if (existing) return
    const ownerId = 'local-owner'
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      for (const provider of registry.providers) {
        const item = newModelProvider(ownerId, provider)
        await tx.insert(modelProviderTable).values({ id: item.id, modelType: item.modelType, providerCode: item.providerCode, name: item.name, fields: item.fields as unknown as JsonObject[], sort: item.sort, creator: 1, createDate: now, updater: 1, updateDate: now })
      }
      for (const config of registry.configs) {
        const item = newModelConfig(ownerId, config)
        await tx.insert(modelConfigTable).values({ id: item.id, modelType: item.modelType, modelCode: item.modelCode, modelName: item.modelName, isDefault: item.isDefault ? 1 : 0, isEnabled: item.isEnabled ? 1 : 0, configJson: item.configJson, docLink: item.docLink, remark: item.remark, sort: item.sort, creator: 1, createDate: now, updater: 1, updateDate: now })
      }
      for (const voice of registry.voices ?? []) {
        await tx.insert(ttsVoiceTable).values({
          id: voice.id,
          ttsModelId: voice.ttsModelId,
          name: voice.name,
          ttsVoice: voice.ttsVoice,
          languages: voice.languages,
          voiceDemo: voice.voiceDemo ?? null,
          remark: voice.remark ?? null,
          referenceAudio: voice.referenceAudio ?? null,
          referenceText: voice.referenceText ?? null,
          sort: voice.sort ?? 0,
          creator: 1,
          createDate: now,
          updater: 1,
          updateDate: now,
        })
      }
    })
  }

  private async findAssistantIdentity(ownerId: string, id: string): Promise<AssistantRow | undefined> {
    const [row] = await this.handle.db.select().from(assistantTable).where(and(eq(assistantTable.ownerId, ownerId), eq(assistantTable.id, id))).limit(1)
    return row
  }

  private async findAssistantRevision(id: string, revision: number): Promise<AssistantRevisionRow | undefined> {
    const [row] = await this.handle.db.select().from(assistantRevisionTable).where(and(eq(assistantRevisionTable.assistantId, id), eq(assistantRevisionTable.revision, revision))).limit(1)
    return row
  }

  private async findProviderIdentity(ownerId: string, id: string): Promise<ProviderConfigRow | undefined> {
    const [row] = await this.handle.db.select().from(providerConfigTable).where(and(eq(providerConfigTable.ownerId, ownerId), eq(providerConfigTable.id, id))).limit(1)
    return row
  }

  private async findModelProvider(ownerId: string, id: string): Promise<ModelProviderRow | undefined> {
    void ownerId
    const [row] = await this.handle.db.select().from(modelProviderTable).where(eq(modelProviderTable.id, id)).limit(1)
    return row
  }

  private async findModelConfig(ownerId: string, id: string): Promise<ModelConfigRow | undefined> {
    void ownerId
    const [row] = await this.handle.db.select().from(modelConfigTable).where(eq(modelConfigTable.id, id)).limit(1)
    return row
  }

  private async assertModelProvider(ownerId: string, modelType: ModelType, providerCode: string): Promise<void> {
    void ownerId
    const [row] = await this.handle.db.select({ id: modelProviderTable.id }).from(modelProviderTable).where(and(eq(modelProviderTable.modelType, modelType), eq(modelProviderTable.providerCode, providerCode))).limit(1)
    if (!row) throw problem('CONFIG_INVALID', 'Model provider does not exist for this category', 422)
  }

  private async assertProviderNameAvailable(ownerId: string, name: string, exceptId?: string): Promise<void> {
    const normalized = name.trim()
    if (!normalized) throw problem('CONFIG_INVALID', 'Provider config name is required', 422)
    const conditions = [eq(providerConfigTable.ownerId, ownerId), sql`lower(${providerConfigTable.name}) = lower(${normalized})`, isNull(providerConfigTable.archivedAt)]
    if (exceptId) conditions.push(ne(providerConfigTable.id, exceptId))
    const [duplicate] = await this.handle.db.select({ id: providerConfigTable.id }).from(providerConfigTable).where(and(...conditions)).limit(1)
    if (duplicate) throw problem('NAME_CONFLICT', 'A provider config with this name already exists', 409)
  }

  /**
   * Only the current draft and published revisions are active references.
   * Immutable historical revisions must remain auditable without preventing
   * an operator from archiving an actually unused provider config.
   */
  private async providerConfigInUse(ownerId: string, id: string): Promise<boolean> {
    const rows = await this.handle.db.select({ providerSelections: assistantRevisionTable.providerSelections })
      .from(assistantRevisionTable)
      .innerJoin(assistantTable, eq(assistantRevisionTable.assistantId, assistantTable.id))
      .where(and(
        eq(assistantTable.ownerId, ownerId),
        or(
          eq(assistantRevisionTable.revision, assistantTable.draftRevision),
          and(isNotNull(assistantTable.publishedRevision), eq(assistantRevisionTable.revision, assistantTable.publishedRevision)),
        ),
      ))
    return rows.some((row) => Object.values(asProviderSelections(row.providerSelections)).some((value) => value.providerConfigId === id || value.providerId === id))
  }

  private async findProviderRevision(id: string, revision: number): Promise<ProviderConfigRevisionRow | undefined> {
    const [row] = await this.handle.db.select().from(providerConfigRevisionTable).where(and(eq(providerConfigRevisionTable.providerConfigId, id), eq(providerConfigRevisionTable.revision, revision))).limit(1)
    return row
  }

  private async findVoiceProfile(ownerId: string, id: string): Promise<VoiceProfileRow | undefined> {
    const [row] = await this.handle.db.select().from(voiceProfileTable).where(and(eq(voiceProfileTable.ownerId, ownerId), eq(voiceProfileTable.id, id))).limit(1)
    return row
  }

  private async assertTtsConfig(ownerId: string, providerConfigId: string): Promise<void> {
    const config = await this.findProviderIdentity(ownerId, providerConfigId)
    const installation = config ? this.findInstallation(config.installationId) : undefined
    if (!config || config.archivedAt || installation?.kind !== 'tts') throw problem('CONFIG_INVALID', 'Voice profile requires an active TTS provider config', 422)
  }

  private async assertSecretRefs(ownerId: string, refs: string[]): Promise<void> {
    if (!refs.length) return
    const rows = await this.handle.db.select({ id: secretReferenceTable.id, status: secretReferenceTable.status }).from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), inArray(secretReferenceTable.id, refs)))
    if (rows.length !== refs.length || rows.some((row) => row.status !== 'available')) throw problem('SECRET_INVALID', 'One or more secret references are unavailable', 422)
  }

  private async secretRefsReady(ownerId: string, refs: string[]): Promise<boolean> {
    if (!refs.length) return true
    const rows = await this.handle.db.select({ id: secretReferenceTable.id, status: secretReferenceTable.status }).from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), inArray(secretReferenceTable.id, refs)))
    return rows.length === refs.length && rows.every((row) => row.status === 'available')
  }

  private findInstallation(id: string): ProviderInstallation {
    const installation = this.installations.find((item) => item.id === id)
    if (!installation) throw problem('PROVIDER_NOT_INSTALLED', 'Provider installation does not exist', 422)
    return installation
  }

  private async assistantSummaries(ownerId: string, assistantIds: readonly string[]): Promise<Map<string, AssistantSummary>> {
    const summaries = new Map<string, AssistantSummary>(assistantIds.map((id) => [id, emptyAssistantSummary()]))
    if (!assistantIds.length) return summaries
    const presenceCutoff = new Date(this.clock().getTime() - this.presenceTtlMs)

    const [devices, conversations] = await Promise.all([
      this.handle.db.select({
        assistantId: deviceTable.assistantId,
        deviceCount: sql<unknown>`count(${deviceTable.id})`,
        onlineDeviceCount: sql<unknown>`count(${deviceTable.id}) filter (where ${deviceTable.onlineState} = 'online' and ${deviceTable.lastSeenAt} >= ${presenceCutoff})`,
      }).from(deviceTable)
        .where(and(eq(deviceTable.ownerId, ownerId), inArray(deviceTable.assistantId, [...assistantIds])))
        .groupBy(deviceTable.assistantId),
      this.handle.db.select({
        assistantId: conversationTable.assistantId,
        lastConversationAt: sql<Date | string | null>`max(coalesce(${conversationTable.lastTurnAt}, ${conversationTable.endedAt}, ${conversationTable.startedAt}))`,
      }).from(conversationTable)
        .where(and(
          eq(conversationTable.ownerId, ownerId),
          inArray(conversationTable.assistantId, [...assistantIds]),
          or(isNull(conversationTable.retentionUntil), gt(conversationTable.retentionUntil, new Date())),
        ))
        .groupBy(conversationTable.assistantId),
    ])

    for (const row of devices) {
      if (!row.assistantId) continue
      const current = summaries.get(row.assistantId) ?? emptyAssistantSummary()
      summaries.set(row.assistantId, {
        ...current,
        deviceCount: asNonNegativeInteger(row.deviceCount),
        onlineDeviceCount: asNonNegativeInteger(row.onlineDeviceCount),
      })
    }
    for (const row of conversations) {
      const current = summaries.get(row.assistantId) ?? emptyAssistantSummary()
      summaries.set(row.assistantId, { ...current, lastConversationAt: asIsoTimestamp(row.lastConversationAt) })
    }
    return summaries
  }

  private mapAssistant(identity: AssistantRow, revision: AssistantRevisionRow, summary: AssistantSummary): Assistant {
    return { id: identity.id, ownerId: identity.ownerId, name: identity.name, role: asJsonObject(revision.role), providerSelections: asProviderSelections(revision.providerSelections), draftRevision: identity.draftRevision, publishedRevision: identity.publishedRevision ?? null, ...summary, etag: revision.etag, updatedAt: revision.createdAt.toISOString() }
  }

  private mapProviderConfig(identity: ProviderConfigRow, revision: ProviderConfigRevisionRow): ProviderConfig {
    return { id: identity.id, ownerId: identity.ownerId, installationId: identity.installationId, name: identity.name, enabled: identity.enabled, revision: revision.revision, config: asJsonObject(revision.config), secretRefs: asSecretRefs(revision.secretRefs), etag: identity.currentEtag, updatedAt: identity.updatedAt.toISOString(), archivedAt: identity.archivedAt?.toISOString() ?? null }
  }

  private mapModelProvider(row: ModelProviderRow): ModelProvider {
    const updatedAt = row.updateDate ?? row.createDate ?? new Date(0)
    const source = { id: row.id, modelType: row.modelType, providerCode: row.providerCode, name: row.name, fields: row.fields, sort: row.sort, creator: row.creator, createDate: row.createDate, updater: row.updater, updateDate: row.updateDate }
    return { id: row.id, ownerId: 'local-owner', modelType: (row.modelType ?? 'LLM') as ModelType, providerCode: row.providerCode ?? '', name: row.name ?? row.providerCode ?? row.id, fields: Array.isArray(row.fields) ? structuredClone(row.fields) as unknown as ModelProvider['fields'] : [], sort: row.sort ?? 0, revision: 1, etag: modelEtag(source), updatedAt: updatedAt.toISOString(), creator: row.creator ?? null, createDate: row.createDate?.toISOString() ?? null, updater: row.updater ?? null, updateDate: row.updateDate?.toISOString() ?? null }
  }

  private mapModelConfig(row: ModelConfigRow): ModelConfig {
    const configJson = asJsonObject(row.configJson ?? {})
    const updatedAt = row.updateDate ?? row.createDate ?? new Date(0)
    const source = { id: row.id, modelType: row.modelType, modelCode: row.modelCode, modelName: row.modelName, isDefault: row.isDefault, isEnabled: row.isEnabled, configJson, docLink: row.docLink, remark: row.remark, sort: row.sort, creator: row.creator, createDate: row.createDate, updater: row.updater, updateDate: row.updateDate }
    return { id: row.id, ownerId: 'local-owner', modelType: (row.modelType ?? 'LLM') as ModelType, modelCode: row.modelCode ?? row.id, modelName: row.modelName ?? row.modelCode ?? row.id, providerCode: typeof configJson.type === 'string' ? configJson.type : '', isDefault: row.isDefault === 1, isEnabled: row.isEnabled === 1, configJson, docLink: row.docLink, remark: row.remark, sort: row.sort ?? 0, revision: 1, etag: modelEtag(source), updatedAt: updatedAt.toISOString(), creator: row.creator ?? null, createDate: row.createDate?.toISOString() ?? null, updater: row.updater ?? null, updateDate: row.updateDate?.toISOString() ?? null }
  }

  private mapVoiceProfile(row: VoiceProfileRow): VoiceProfile {
    return {
      id: row.id, ownerId: row.ownerId, providerConfigId: row.providerConfigId, name: row.name,
      locale: row.locale, voiceCode: row.voiceCode, description: row.description, demoUrl: row.demoUrl,
      enabled: row.enabled, sort: row.sort, revision: row.revision, etag: row.etag,
      updatedAt: row.updatedAt.toISOString(), archivedAt: row.archivedAt?.toISOString() ?? null,
    }
  }

  private mapSession(row: ManagerSessionRow): ManagerSession {
    return { id: row.id, ownerId: row.ownerId, tokenHash: row.tokenHash, csrfHash: row.csrfHash, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null }
  }

  private mapSecretReference(row: SecretReferenceRow): SecretReference {
    return { id: row.id, ownerId: row.ownerId, name: row.name, store: 'encrypted-local', locatorMasked: row.locatorMasked, version: row.version, metadataRevision: row.metadataRevision, status: row.status === 'available' || row.status === 'revoked' ? row.status : 'unavailable', lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null, etag: row.etag, updatedAt: row.updatedAt.toISOString() }
  }

  private mapDevice(row: DeviceRow, now = this.clock()): Device {
    if (!row.ownerId || !row.assistantId) throw new Error('paired device is missing owner or assistant')
    return { id: row.id, ownerId: row.ownerId, assistantId: row.assistantId, etag: deviceEtag(row), displayName: row.displayName, maskedMac: row.maskedMac, firmwareVersion: row.firmwareVersion, board: row.board, onlineState: isPresenceFresh(row.lastSeenAt, row.onlineState === 'online' ? 'online' : 'offline', now, this.presenceTtlMs) ? 'online' : 'offline', lastSeenAt: row.lastSeenAt.toISOString(), lastConversationAt: row.lastConversationAt?.toISOString() ?? null }
  }

  private mapRetentionPolicy(row: RetentionPolicyRow): RetentionPolicy {
    return { ownerId: row.ownerId, captureTranscript: row.captureTranscript, transcriptDays: row.transcriptDays, captureAudio: row.captureAudio, audioDays: row.audioDays, effectiveAt: row.effectiveAt.toISOString(), revision: row.revision, etag: row.etag }
  }

  private mapConversation(row: ConversationRow): ConversationSummary {
    return { id: row.id, assistantId: row.assistantId, deviceKey: row.deviceKey, startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null, locale: row.locale, configRevision: row.configRevision, status: asConversationStatus(row.status), turnCount: row.turnCount, lastTurnAt: row.lastTurnAt?.toISOString() ?? null, aggregateTimings: asTimings(row.aggregateTimings), retentionUntil: row.retentionUntil?.toISOString() ?? null }
  }

  private mapConversationTurn(row: ConversationTurnRow): ConversationTurn {
    return { id: row.id, conversationId: row.conversationId, turnId: row.turnId, sequence: row.sequence, state: asTurnState(row.state), startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString(), finishReason: row.finishReason, timings: asTimings(row.timings), transcript: asTranscript(row.transcript), toolCalls: asToolCalls(row.toolCalls) }
  }

  private mapRetentionDeleteJob(row: RetentionDeleteJobRow): RetentionDeleteJob {
    return { id: row.id, conversationId: row.conversationId, status: asRetentionDeleteJobStatus(row.status), requestedAt: row.requestedAt.toISOString(), startedAt: row.startedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null, errorCode: row.errorCode ?? null }
  }

  private async modelMemory(current: Assistant): Promise<ModelMemoryView> {
    const kinds: ProviderKind[] = ['vad', 'asr', 'llm', 'tts', 'intent', 'memory']
    const selections = kinds.map((kind) => {
      const value = current.providerSelections[kind]
      const providerConfigId = typeof value?.providerConfigId === 'string' ? value.providerConfigId : typeof value?.providerId === 'string' ? value.providerId : undefined
      return providerConfigId ? { kind, mode: 'selected' as const, providerConfigId } : { kind, mode: 'disabled' as const }
    })
    const configs = await this.listProviderConfigs(current.ownerId)
    const availableConfigs = configs.map((item) => {
      const installation = this.installations.find((candidate) => candidate.id === item.installationId)
      return { id: item.id, kind: installation?.kind ?? 'memory', name: item.name, providerName: installation?.displayName ?? installation?.displayNameKey ?? item.installationId, availability: item.enabled ? 'ready' as const : 'disabled' as const, supportedLocales: Array.isArray(installation?.manifest.locales) ? installation.manifest.locales.filter((value): value is string => typeof value === 'string') : ['*'] }
    })
    return { assistantId: current.id, selections, availableConfigs, memory: { enabled: current.role.memoryEnabled !== false, itemCount: 0 }, memoryItems: [] }
  }
}

export async function createPostgresStore(options: PostgresStoreOptions): Promise<Store & { close(): Promise<void> }> {
  return PostgresStore.open(options)
}

function emptyAssistantSummary(): AssistantSummary {
  return { deviceCount: 0, onlineDeviceCount: 0, lastConversationAt: null }
}

function asNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0
}

function asIsoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function laterDate(left: Date | null, right: Date | null): Date | null {
  if (!left) return right
  if (!right) return left
  return left.getTime() >= right.getTime() ? left : right
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value as JsonObject) : {}
}

function asProviderSelections(value: unknown): Record<string, JsonObject> {
  const object = asJsonObject(value)
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, asJsonObject(item)]))
}

function asSecretRefs(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  const snapshot = asJsonObject(value)
  if (typeof snapshot.schemaVersion !== 'number' || typeof snapshot.revision !== 'number' || typeof snapshot.assistantId !== 'string' || typeof snapshot.locale !== 'string' || typeof snapshot.basePrompt !== 'string') throw new Error('invalid persisted runtime snapshot')
  return { ...snapshot, schemaVersion: snapshot.schemaVersion, revision: snapshot.revision, assistantId: snapshot.assistantId, locale: snapshot.locale, basePrompt: snapshot.basePrompt, personality: asJsonObject(snapshot.personality), speech: asJsonObject(snapshot.speech), providers: asProviderSelections(snapshot.providers), wire: asJsonObject(snapshot.wire) }
}

function validateJsonObject(value: JsonObject, schema: Record<string, unknown>): void {
  if (schema.type !== 'object' || schema.additionalProperties === false) {
    const properties = schema.properties as Record<string, unknown> | undefined
    const allowed = new Set(Object.keys(properties ?? {}))
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw problem('CONFIG_INVALID', `Unknown provider field: ${key}`, 422)
  }
  for (const required of (schema.required as string[] | undefined) ?? []) if (!(required in value)) throw problem('CONFIG_INVALID', `Missing provider field: ${required}`, 422)
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function asConversationStatus(value: string): ConversationStatus {
  return value === 'active' || value === 'completed' || value === 'aborted' ? value : 'error'
}

function asRetentionDeleteJobStatus(value: string): RetentionDeleteJob['status'] {
  return value === 'queued' || value === 'running' || value === 'completed' || value === 'failed' ? value : 'failed'
}

function asTurnState(value: string): ConversationTurn['state'] {
  return value === 'completed' || value === 'aborted' ? value : 'error'
}

function asTranscript(value: unknown): ConversationTurn['transcript'] {
  return Array.isArray(value) ? value.filter((item): item is ConversationTurn['transcript'][number] => Boolean(item && typeof item === 'object' && typeof (item as { speaker?: unknown }).speaker === 'string' && typeof (item as { text?: unknown }).text === 'string')).map((item) => structuredClone(item)) : []
}

function asTimings(value: unknown): Record<string, number> {
  return Object.fromEntries(Object.entries(asJsonObject(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

function asToolCalls(value: unknown): ConversationTurn['toolCalls'] {
  return Array.isArray(value) ? value.filter((item): item is ConversationTurn['toolCalls'][number] => Boolean(item && typeof item === 'object' && typeof (item as { toolName?: unknown }).toolName === 'string')).map((item) => structuredClone(item)) : []
}

function validateRetentionPolicyInput(value: Pick<RetentionPolicy, 'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'>): void {
  if (value.captureAudio || value.audioDays !== null) throw problem('AUDIO_RETENTION_UNSUPPORTED', 'Audio recording is not enabled in this baseline', 422)
  if (value.captureTranscript && (!Number.isInteger(value.transcriptDays) || (value.transcriptDays ?? 0) < 1 || (value.transcriptDays ?? 0) > 3650)) throw problem('RETENTION_INVALID', 'transcriptDays must be between 1 and 3650', 422)
  if (!value.captureTranscript && value.transcriptDays !== null) throw problem('RETENTION_INVALID', 'transcriptDays must be null when transcript capture is disabled', 422)
}

function validateConversationTurnInput(value: ConversationTurnInput): void {
  if (!isUuid(value.conversationId)) throw problem('HISTORY_INVALID', 'conversationId must be a UUID', 422)
  if (!isUuid(value.assistantId)) throw problem('HISTORY_INVALID', 'assistantId must be a UUID', 422)
  if (!value.turnId || !value.locale || !Number.isInteger(value.configRevision) || value.configRevision < 1 || !Number.isInteger(value.sequence) || value.sequence < 1) throw problem('HISTORY_INVALID', 'conversation turn identity is invalid', 422)
  if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt)) || !Number.isFinite(Date.parse(value.conversationStartedAt))) throw problem('HISTORY_INVALID', 'conversation turn timestamps are invalid', 422)
  if (value.transcript.length > 128 || value.toolCalls.length > 64) throw problem('HISTORY_LIMIT_EXCEEDED', 'conversation event is too large', 413)
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505')
}
