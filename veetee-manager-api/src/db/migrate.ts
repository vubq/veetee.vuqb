import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'

const DEFAULT_SCHEMA = 'veetee_manager'

export async function runMigrations(pool: Pool, migrationsDir: string, schema = DEFAULT_SCHEMA): Promise<void> {
  const identifier = quoteIdentifier(schema)
  const files = (await readdir(migrationsDir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort()
  if (!files.length) throw new Error(`no SQL migrations found in ${migrationsDir}`)

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${identifier}`)
  await pool.query(`CREATE TABLE IF NOT EXISTS ${identifier}.schema_migrations (version integer PRIMARY KEY, filename text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)

  for (const file of files) {
    const version = Number(file.match(/^\d+/)?.[0])
    const raw = await readFile(join(migrationsDir, file), 'utf8')
    const checksum = createHash('sha256').update(raw).digest('hex')
    const existing = await pool.query<{ checksum: string; filename: string }>(`SELECT checksum, filename FROM ${identifier}.schema_migrations WHERE version = $1`, [version])
    if (existing.rowCount) {
      if (existing.rows[0]?.checksum !== checksum || existing.rows[0]?.filename !== file) throw new Error(`migration checksum mismatch for ${file}`)
      continue
    }
    const sql = raw.replaceAll('{{VEETEE_SCHEMA}}', identifier)
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query(`INSERT INTO ${identifier}.schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)`, [version, file, checksum])
      await pool.query('COMMIT')
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('invalid PostgreSQL schema identifier')
  return `"${value}"`
}
