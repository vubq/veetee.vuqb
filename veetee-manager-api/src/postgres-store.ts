import { randomInt, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNull, isNotNull, lt, lte, or, sql } from 'drizzle-orm'
import {
  assistantRevisionTable,
  assistantTable,
  conversationTable,
  conversationTurnTable,
  deviceTable,
  managerSessionTable,
  pairingChallengeTable,
  providerSecretBindingTable,
  providerConfigRevisionTable,
  providerConfigTable,
  runtimePublicationTable,
  retentionPolicyTable,
  secretReferenceTable,
} from './db/schema.js'
import { openDatabase, readDatabaseUrl, type DatabaseHandle } from './db/client.js'
import {
  etag,
  defaultRetentionPolicy,
  deviceEtag,
  DEFAULT_DEVICE_ONLINE_TTL_SECONDS,
  hashPairingCode,
  isPresenceFresh,
  problem,
  validateSecretBindings,
  type Assistant,
  type ConversationDetail,
  type ConversationStatus,
  type ConversationSummary,
  type ConversationTurn,
  type ConversationTurnInput,
  type Device,
  type DevicePresenceInput,
  type DevicePresenceResult,
  type ManagerSession,
  type ModelMemoryView,
  type PairingChallenge,
  type ProviderConfig,
  type ProviderInstallation,
  type ProviderKind,
  type RetentionPolicy,
  type RetentionPurgeResult,
  type RuntimePublication,
  type RuntimeSnapshot,
  type SecretReference,
  type Store,
  roleExtras,
  roleFromSnapshot,
} from './store.js'

type JsonObject = Record<string, unknown>
type AssistantRow = typeof assistantTable.$inferSelect
type AssistantRevisionRow = typeof assistantRevisionTable.$inferSelect
type ProviderConfigRow = typeof providerConfigTable.$inferSelect
type ProviderConfigRevisionRow = typeof providerConfigRevisionTable.$inferSelect
type ManagerSessionRow = typeof managerSessionTable.$inferSelect
type SecretReferenceRow = typeof secretReferenceTable.$inferSelect
type DeviceRow = typeof deviceTable.$inferSelect
type RetentionPolicyRow = typeof retentionPolicyTable.$inferSelect
type ConversationRow = typeof conversationTable.$inferSelect
type ConversationTurnRow = typeof conversationTurnTable.$inferSelect
type AssistantSummary = Pick<Assistant, 'deviceCount' | 'onlineDeviceCount' | 'lastConversationAt'>

export interface PostgresStoreOptions {
  catalog: ProviderInstallation[]
  initial?: RuntimeSnapshot
  databaseUrlFile: string | undefined
  presenceTtlSeconds?: number
  now?: () => Date
}

export class PostgresStore implements Store {
  private constructor(
    private readonly handle: DatabaseHandle,
    private readonly installations: ProviderInstallation[],
    private readonly presenceTtlMs: number,
    private readonly clock: () => Date,
  ) {}

  static async open(options: PostgresStoreOptions): Promise<PostgresStore> {
    const url = await readDatabaseUrl(options.databaseUrlFile)
    const handle = await openDatabase(url)
    const store = new PostgresStore(
      handle,
      options.catalog,
      (options.presenceTtlSeconds ?? DEFAULT_DEVICE_ONLINE_TTL_SECONDS) * 1000,
      options.now ?? (() => new Date()),
    )
    try {
      await store.assertMigrated()
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

  async listProviderConfigs(ownerId: string, kind?: ProviderKind): Promise<ProviderConfig[]> {
    const installationIds = kind === undefined ? undefined : this.installations.filter((item) => item.kind === kind).map((item) => item.id)
    if (kind !== undefined && !installationIds?.length) return []
    const conditions = [eq(providerConfigTable.ownerId, ownerId)]
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
    validateJsonObject(value.config, installation.configSchema)
    const secretRefs = [...(value.secretRefs ?? [])]
    validateSecretBindings(installation, secretRefs)
    await this.assertSecretRefs(ownerId, secretRefs)
    const id = randomUUID()
    const now = new Date()
    const revision = 1
    const revisionEtag = etag({ ...value.config, revision })
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(providerConfigTable).values({ id, ownerId, installationId: value.installationId, name: value.name, currentRevision: revision, currentEtag: revisionEtag, createdAt: now, updatedAt: now })
      await tx.insert(providerConfigRevisionTable).values({ providerConfigId: id, revision, config: structuredClone(value.config), secretRefs, etag: revisionEtag, createdAt: now })
    })
    const identity = await this.findProviderIdentity(ownerId, id)
    const revisionRow = await this.findProviderRevision(id, revision)
    if (!identity || !revisionRow) throw new Error('provider config insert returned no row')
    return this.mapProviderConfig(identity, revisionRow)
  }

  async updateProviderConfig(ownerId: string, id: string, value: Partial<Pick<ProviderConfig, 'name' | 'config' | 'secretRefs'>>, ifMatch: string): Promise<ProviderConfig> {
    const identity = await this.findProviderIdentity(ownerId, id)
    if (!identity) throw problem('NOT_FOUND', 'Provider config not found', 404)
    const current = await this.findProviderRevision(id, identity.currentRevision)
    if (!current) throw new Error('provider config current revision is missing')
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    const installation = this.findInstallation(identity.installationId)
    const config = value.config ?? asJsonObject(current.config)
    validateJsonObject(config, installation.configSchema)
    const secretRefs = [...(value.secretRefs ?? asSecretRefs(current.secretRefs))]
    validateSecretBindings(installation, secretRefs)
    await this.assertSecretRefs(ownerId, secretRefs)
    const revision = identity.currentRevision + 1
    const nextEtag = etag({ ...config, revision })
    const now = new Date()
    await this.handle.db.transaction(async (tx) => {
      await tx.insert(providerConfigRevisionTable).values({ providerConfigId: id, revision, config: structuredClone(config), secretRefs, etag: nextEtag, createdAt: now })
      const updated = await tx.update(providerConfigTable).set({ name: value.name ?? identity.name, currentRevision: revision, currentEtag: nextEtag, updatedAt: now }).where(and(eq(providerConfigTable.id, id), eq(providerConfigTable.ownerId, ownerId), eq(providerConfigTable.currentRevision, identity.currentRevision), eq(providerConfigTable.currentEtag, ifMatch))).returning()
      if (!updated.length) throw problem('REVISION_CONFLICT', 'Provider config changed', 409)
    })
    const nextIdentity = await this.findProviderIdentity(ownerId, id)
    const nextRevision = await this.findProviderRevision(id, revision)
    if (!nextIdentity || !nextRevision) throw new Error('provider config update returned no row')
    return this.mapProviderConfig(nextIdentity, nextRevision)
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
    if (value.mode === 'selected' && !value.providerConfigId) throw problem('CONFIG_INVALID', 'Selected provider requires providerConfigId', 422)
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

  async updateSecretReference(ownerId: string, id: string, value: { name?: string; locatorMasked?: string }, ifMatch: string): Promise<SecretReference> {
    const [current] = await this.handle.db.select().from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.id, id))).limit(1)
    if (!current) throw problem('NOT_FOUND', 'Secret reference not found', 404)
    if (current.etag !== ifMatch) throw problem('REVISION_CONFLICT', 'Secret reference changed', 409)
    const metadataRevision = current.metadataRevision + 1
    const name = value.name ?? current.name
    const locatorMasked = value.locatorMasked ?? current.locatorMasked
    const nextEtag = etag({ name, locatorMasked, metadataRevision })
    const [updated] = await this.handle.db.update(secretReferenceTable).set({ name, locatorMasked, metadataRevision, etag: nextEtag, updatedAt: new Date() }).where(and(eq(secretReferenceTable.id, id), eq(secretReferenceTable.ownerId, ownerId), eq(secretReferenceTable.etag, ifMatch))).returning()
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
    const verificationCode = `VT-${randomInt(0, 10000).toString().padStart(4, '0')}`
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000)
    await this.handle.db.insert(pairingChallengeTable).values({ id, deviceId, codeHash: hashPairingCode(verificationCode), state: 'pending', attempts: 0, expiresAt, createdAt: now, usedAt: null })
    return { id, deviceId, verificationCode, expiresAt: expiresAt.toISOString() }
  }

  async pairDevice(ownerId: string, value: { assistantId: string; verificationCode: string; displayName?: string }): Promise<Device> {
    return this.handle.db.transaction(async (tx) => {
      const [assistant] = await tx.select({ id: assistantTable.id }).from(assistantTable).where(and(eq(assistantTable.id, value.assistantId), eq(assistantTable.ownerId, ownerId))).limit(1)
      if (!assistant) throw problem('NOT_FOUND', 'Assistant not found', 404)
      const codeHash = hashPairingCode(value.verificationCode.trim().toUpperCase())
      const [challenge] = await tx.select().from(pairingChallengeTable).where(and(eq(pairingChallengeTable.codeHash, codeHash), eq(pairingChallengeTable.state, 'pending'), lt(pairingChallengeTable.attempts, 5), gt(pairingChallengeTable.expiresAt, new Date()))).limit(1)
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
    const deleted = await this.handle.db.delete(conversationTable)
      .where(and(isNotNull(conversationTable.retentionUntil), lte(conversationTable.retentionUntil, now)))
      .returning({ id: conversationTable.id })
    return { conversations: deleted.length }
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
    if (!conversation) return undefined
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
      await tx.insert(assistantRevisionTable).values({ assistantId: id, revision: snapshot.revision, role, providerSelections, etag: revisionEtag, createdAt: now })
      await tx.insert(runtimePublicationTable).values({ assistantId: id, revision: snapshot.revision, snapshot, etag: revisionEtag, updatedAt: now })
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

  private async findProviderRevision(id: string, revision: number): Promise<ProviderConfigRevisionRow | undefined> {
    const [row] = await this.handle.db.select().from(providerConfigRevisionTable).where(and(eq(providerConfigRevisionTable.providerConfigId, id), eq(providerConfigRevisionTable.revision, revision))).limit(1)
    return row
  }

  private async assertSecretRefs(ownerId: string, refs: string[]): Promise<void> {
    if (!refs.length) return
    const rows = await this.handle.db.select({ id: secretReferenceTable.id, status: secretReferenceTable.status }).from(secretReferenceTable).where(and(eq(secretReferenceTable.ownerId, ownerId), inArray(secretReferenceTable.id, refs)))
    if (rows.length !== refs.length || rows.some((row) => row.status !== 'available')) throw problem('SECRET_INVALID', 'One or more secret references are unavailable', 422)
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
    return { id: identity.id, ownerId: identity.ownerId, installationId: identity.installationId, name: identity.name, revision: revision.revision, config: asJsonObject(revision.config), secretRefs: asSecretRefs(revision.secretRefs), etag: revision.etag, updatedAt: revision.createdAt.toISOString() }
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
      return { id: item.id, kind: installation?.kind ?? 'memory', name: item.name, providerName: installation?.displayNameKey ?? item.installationId, availability: 'ready' as const, supportedLocales: Array.isArray(installation?.manifest.locales) ? installation.manifest.locales.filter((value): value is string => typeof value === 'string') : ['*'] }
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
