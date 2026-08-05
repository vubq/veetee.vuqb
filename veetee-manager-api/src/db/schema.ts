import { boolean, integer, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * The Manager control-plane schema is isolated from any other application
 * database.  Product-specific values remain JSONB, while ownership, revision,
 * checksums and lifecycle pointers stay relational and transaction-safe.
 */
export const managerSchema = pgSchema('veetee_manager')

type JsonObject = Record<string, unknown>

export const assistantTable = managerSchema.table('assistant', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  draftRevision: integer('draft_revision').notNull(),
  draftEtag: text('draft_etag').notNull(),
  publishedRevision: integer('published_revision'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const assistantRevisionTable = managerSchema.table('assistant_revision', {
  assistantId: uuid('assistant_id').notNull(),
  revision: integer('revision').notNull(),
  role: jsonb('role').$type<JsonObject>().notNull(),
  providerSelections: jsonb('provider_selections').$type<Record<string, JsonObject>>().notNull(),
  etag: text('etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})
export const providerConfigTable = managerSchema.table('provider_config', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  installationId: text('installation_id').notNull(),
  name: text('name').notNull(),
  currentRevision: integer('current_revision').notNull(),
  currentEtag: text('current_etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
})

export const providerConfigRevisionTable = managerSchema.table('provider_config_revision', {
  providerConfigId: uuid('provider_config_id').notNull(),
  revision: integer('revision').notNull(),
  config: jsonb('config').$type<JsonObject>().notNull(),
  secretRefs: jsonb('secret_refs').$type<string[]>().notNull(),
  etag: text('etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const voiceProfileTable = managerSchema.table('voice_profile', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  providerConfigId: uuid('provider_config_id').notNull().references(() => providerConfigTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  locale: text('locale').notNull(),
  voiceCode: text('voice_code').notNull(),
  description: text('description').notNull(),
  demoUrl: text('demo_url'),
  enabled: boolean('enabled').notNull(),
  sort: integer('sort').notNull(),
  revision: integer('revision').notNull(),
  etag: text('etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
})

export const runtimePublicationTable = managerSchema.table('runtime_publication', {
  assistantId: uuid('assistant_id').primaryKey(),
  revision: integer('revision').notNull(),
  snapshot: jsonb('snapshot').$type<JsonObject>().notNull(),
  etag: text('etag').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const secretReferenceTable = managerSchema.table('secret_reference', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  store: text('store').notNull(),
  locatorMasked: text('locator_masked').notNull(),
  version: integer('version').notNull(),
  metadataRevision: integer('metadata_revision').notNull(),
  status: text('status').notNull(),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true, mode: 'date' }),
  etag: text('etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const providerSecretBindingTable = managerSchema.table('provider_secret_binding', {
  providerConfigId: uuid('provider_config_id').notNull(),
  configRevision: integer('config_revision').notNull(),
  field: text('field').notNull(),
  secretReferenceId: uuid('secret_reference_id').notNull(),
  secretVersion: integer('secret_version').notNull(),
})

export const managerSessionTable = managerSchema.table('manager_session', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  csrfHash: text('csrf_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
})

export const auditEventTable = managerSchema.table('audit_event', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  requestId: text('request_id'),
  diff: jsonb('diff').$type<JsonObject>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
})

export const deviceTable = managerSchema.table('device', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id'),
  assistantId: uuid('assistant_id').references(() => assistantTable.id, { onDelete: 'set null' }),
  identityHash: text('identity_hash').notNull(),
  clientIdHash: text('client_id_hash').notNull(),
  displayName: text('display_name').notNull(),
  maskedMac: text('masked_mac').notNull(),
  firmwareVersion: text('firmware_version').notNull(),
  board: text('board').notNull(),
  onlineState: text('online_state').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastConversationAt: timestamp('last_conversation_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull(),
}, (table) => ({ identityUnique: uniqueIndex('device_identity_client_unique').on(table.identityHash, table.clientIdHash) }))

export const pairingChallengeTable = managerSchema.table('pairing_challenge', {
  id: uuid('id').primaryKey(),
  deviceId: uuid('device_id').notNull().references(() => deviceTable.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull(),
  state: text('state').notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'date' }),
})

type JsonArray = unknown[]

export const retentionPolicyTable = managerSchema.table('retention_policy', {
  ownerId: text('owner_id').primaryKey(),
  captureTranscript: boolean('capture_transcript').notNull(),
  transcriptDays: integer('transcript_days'),
  captureAudio: boolean('capture_audio').notNull(),
  audioDays: integer('audio_days'),
  effectiveAt: timestamp('effective_at', { withTimezone: true, mode: 'date' }).notNull(),
  revision: integer('revision').notNull(),
  etag: text('etag').notNull(),
})

export const conversationTable = managerSchema.table('conversation', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  assistantId: uuid('assistant_id').notNull().references(() => assistantTable.id, { onDelete: 'cascade' }),
  deviceKey: text('device_key'),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
  locale: text('locale').notNull(),
  configRevision: integer('config_revision').notNull(),
  status: text('status').notNull(),
  turnCount: integer('turn_count').notNull(),
  lastTurnAt: timestamp('last_turn_at', { withTimezone: true, mode: 'date' }),
  aggregateTimings: jsonb('aggregate_timings').$type<JsonObject>().notNull(),
  retentionUntil: timestamp('retention_until', { withTimezone: true, mode: 'date' }),
})

export const conversationTurnTable = managerSchema.table('conversation_turn', {
  id: uuid('id').primaryKey(),
  conversationId: uuid('conversation_id').notNull().references(() => conversationTable.id, { onDelete: 'cascade' }),
  turnId: text('turn_id').notNull(),
  sequence: integer('sequence').notNull(),
  state: text('state').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }).notNull(),
  finishReason: text('finish_reason').notNull(),
  timings: jsonb('timings').$type<JsonObject>().notNull(),
  transcript: jsonb('transcript').$type<JsonArray>().notNull(),
  toolCalls: jsonb('tool_calls').$type<JsonArray>().notNull(),
}, (table) => ({ turnUnique: uniqueIndex('conversation_turn_identity_unique').on(table.conversationId, table.turnId), sequenceUnique: uniqueIndex('conversation_turn_sequence_unique').on(table.conversationId, table.sequence) }))

export const retentionDeleteJobTable = managerSchema.table('retention_delete_job', {
  id: uuid('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  errorCode: text('error_code'),
}, (table) => ({ ownerConversationUnique: uniqueIndex('retention_delete_job_owner_conversation_unique').on(table.ownerId, table.conversationId) }))

export const conversationTombstoneTable = managerSchema.table('conversation_tombstone', {
  conversationId: uuid('conversation_id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  reason: text('reason').notNull(),
  deleteJobId: uuid('delete_job_id').references(() => retentionDeleteJobTable.id, { onDelete: 'set null' }),
})
