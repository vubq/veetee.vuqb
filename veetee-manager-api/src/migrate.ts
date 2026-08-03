import { resolve } from 'node:path'
import { readDatabaseUrl, openDatabase } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { readEnvironment } from './config.js'

const env = readEnvironment()
const url = await readDatabaseUrl(env.VEETEE_DATABASE_URL_FILE)
const handle = await openDatabase(url)
try {
  await runMigrations(handle.pool, resolve(import.meta.dirname, '../migrations'))
  console.log(JSON.stringify({ status: 'migrated', schema: 'veetee_manager' }))
} finally {
  await handle.pool.end()
}
