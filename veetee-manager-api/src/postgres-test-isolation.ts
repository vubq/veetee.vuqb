import { afterEach, beforeEach } from 'node:test'
import { Pool, type PoolClient } from 'pg'

/**
 * PostgreSQL integration tests are deliberately destructive inside their own
 * database.  Keep the guard here (rather than in a shell script) so every test
 * entry point has the same fail-closed behavior before it can connect.
 */
const TEST_SCHEMA = 'veetee_manager'
const TEST_LOCK_KEY = 0x56455445
const TRUNCATE_SQL = `
TRUNCATE TABLE
  "${TEST_SCHEMA}"."conversation_tombstone",
  "${TEST_SCHEMA}"."retention_delete_job",
  "${TEST_SCHEMA}"."conversation_turn",
  "${TEST_SCHEMA}"."conversation",
  "${TEST_SCHEMA}"."pairing_challenge",
  "${TEST_SCHEMA}"."device",
  "${TEST_SCHEMA}"."audit_event",
  "${TEST_SCHEMA}"."manager_session",
  "${TEST_SCHEMA}"."provider_secret_binding",
  "${TEST_SCHEMA}"."runtime_publication",
  "${TEST_SCHEMA}"."assistant_revision",
  "${TEST_SCHEMA}"."assistant",
  "${TEST_SCHEMA}"."provider_config_revision",
  "${TEST_SCHEMA}"."provider_config",
  "${TEST_SCHEMA}"."secret_reference",
  "${TEST_SCHEMA}"."retention_policy"
RESTART IDENTITY CASCADE`

let databaseUrlFile: string | undefined
let lease: { client: PoolClient; pool: Pool } | undefined

export function configurePostgresTestIsolation(urlFile: string | undefined): void {
  databaseUrlFile = urlFile
  beforeEach(async () => {
    if (!databaseUrlFile) return
    const databaseUrl = await readUrlFile(databaseUrlFile)
    assertSafeTestDatabaseUrl(databaseUrl)

    const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 })
    const client = await pool.connect()
    try {
      // Serialize setup and test bodies across test files that share one DSN.
      // The session holds the advisory lock until afterEach releases it.
      await client.query('select pg_advisory_lock($1::bigint)', [TEST_LOCK_KEY])
      await resetDatabase(client)
      lease = { client, pool }
    } catch (error) {
      await client.query('rollback').catch(() => undefined)
      client.release()
      await pool.end().catch(() => undefined)
      throw error
    }
  })

  afterEach(async () => {
    const current = lease
    lease = undefined
    if (!current) return
    try {
      // Leave the dedicated database clean even when the last test in a run
      // created a seed assistant or history row.
      await resetDatabase(current.client)
      await current.client.query('select pg_advisory_unlock($1::bigint)', [TEST_LOCK_KEY])
    } finally {
      current.client.release()
      await current.pool.end()
    }
  })
}

export function assertSafeTestDatabaseUrl(databaseUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('PostgreSQL test DSN must be a valid URL')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').split('/')[0] ?? '')
  if (!databaseName.endsWith('_test') || databaseName === 'veetee_vubq') {
    throw new Error('Refusing PostgreSQL integration tests: database name must end with _test')
  }
}

async function resetDatabase(client: PoolClient): Promise<void> {
  await client.query('begin')
  try {
    await client.query(TRUNCATE_SQL)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function readUrlFile(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const value = (await readFile(path, 'utf8')).trim()
  if (!value) throw new Error(`PostgreSQL test DSN file is empty: ${path}`)
  return value
}
