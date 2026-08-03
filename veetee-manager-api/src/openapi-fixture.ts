import { resolve } from 'node:path'
import type { Environment } from './config.js'

const root = resolve(import.meta.dirname, '..')

export function openApiFixtureEnvironment(): Environment {
  return {
    VEETEE_API_HOST: '127.0.0.1',
    VEETEE_API_PORT: 8001,
    VEETEE_DATABASE_MODE: 'memory',
    VEETEE_DATABASE_URL_FILE: undefined,
    VEETEE_INITIAL_SNAPSHOT_FILE: resolve(root, '../veetee-server/config/fixtures/m0.json'),
    VEETEE_PROVIDER_CATALOG_FILE: resolve(root, 'config/provider-catalog.json'),
    VEETEE_ALLOWED_ORIGINS: 'http://127.0.0.1:8081',
    VEETEE_AUTH_MODE: 'disabled',
    VEETEE_OWNER_EMAIL: undefined,
    VEETEE_OWNER_PASSWORD_HASH: undefined,
    VEETEE_AUTH_SECRET_FILE: undefined,
    VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: true,
    VEETEE_SESSION_TTL_SECONDS: 86400,
    VEETEE_SECRET_STORE_FILE: undefined,
    VEETEE_SECRET_MASTER_KEY_FILE: undefined,
    VEETEE_MACHINE_TOKEN_FILE: undefined,
    VEETEE_LOG_LEVEL: 'silent',
  }
}

export function openApiArtifactPath(): string {
  return resolve(process.env.VEETEE_OPENAPI_OUTPUT ?? resolve(root, 'openapi/manager-api.json'))
}
