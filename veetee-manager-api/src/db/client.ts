import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema.js'

export type ManagerDatabase = NodePgDatabase<typeof schema>

export interface DatabaseHandle {
  pool: Pool
  db: ManagerDatabase
}

export async function readDatabaseUrl(path: string | undefined): Promise<string> {
  if (!path) throw new Error('VEETEE_DATABASE_URL_FILE is required when VEETEE_DATABASE_MODE=postgres')
  const value = (await readFile(path, 'utf8')).trim()
  if (!value) throw new Error(`database URL file is empty: ${path}`)
  return value
}

export async function openDatabase(url: string): Promise<DatabaseHandle> {
  const pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 })
  try {
    await pool.query('select 1')
  } catch (error) {
    await pool.end().catch(() => undefined)
    throw error
  }
  return { pool, db: drizzle(pool, { schema }) }
}
