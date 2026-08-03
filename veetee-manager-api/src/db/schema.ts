import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
})

export const providerConfigRevisionTable = managerSchema.table('provider_config_revision', {
  providerConfigId: uuid('provider_config_id').notNull(),
  revision: integer('revision').notNull(),
  config: jsonb('config').$type<JsonObject>().notNull(),
  secretRefs: jsonb('secret_refs').$type<string[]>().notNull(),
  etag: text('etag').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
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
  status: text('status').notNull(),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true, mode: 'date' }),
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
