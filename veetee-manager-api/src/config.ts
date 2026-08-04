import envSchema from 'env-schema'
import { Type, type Static } from '@sinclair/typebox'

const schema = Type.Object({
  VEETEE_API_HOST: Type.String({ default: '127.0.0.1' }),
  VEETEE_API_PORT: Type.Integer({ default: 8001, minimum: 1, maximum: 65535 }),
  VEETEE_PUBLIC_BASE_URL: Type.Optional(Type.String({ minLength: 1 })),
  VEETEE_DATABASE_MODE: Type.Union([Type.Literal('memory'), Type.Literal('postgres')], { default: 'memory' }),
  VEETEE_DATABASE_URL_FILE: Type.Optional(Type.String()),
  VEETEE_INITIAL_SNAPSHOT_FILE: Type.Optional(Type.String()),
  VEETEE_PROVIDER_CATALOG_FILE: Type.String({ default: './config/provider-catalog.json' }),
  VEETEE_ALLOWED_ORIGINS: Type.String({ default: 'http://127.0.0.1:8081' }),
  VEETEE_AUTH_MODE: Type.Union([Type.Literal('disabled'), Type.Literal('local')], { default: 'disabled' }),
  VEETEE_OWNER_EMAIL: Type.Optional(Type.String()),
  VEETEE_OWNER_PASSWORD_HASH: Type.Optional(Type.String()),
  VEETEE_AUTH_SECRET_FILE: Type.Optional(Type.String()),
  VEETEE_ALLOW_INSECURE_LOCAL_CONFIG: Type.Optional(Type.Boolean({ default: false })),
  VEETEE_SESSION_TTL_SECONDS: Type.Optional(Type.Integer({ minimum: 300, maximum: 2592000, default: 86400 })),
  VEETEE_LOGIN_MAX_ATTEMPTS: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 5 })),
  VEETEE_LOGIN_WINDOW_SECONDS: Type.Optional(Type.Integer({ minimum: 10, maximum: 86400, default: 300 })),
  VEETEE_LOGIN_LOCKOUT_SECONDS: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400, default: 60 })),
  VEETEE_LOGIN_MAX_BUCKETS: Type.Optional(Type.Integer({ minimum: 16, maximum: 100000, default: 4096 })),
  VEETEE_DEVICE_ONLINE_TTL_SECONDS: Type.Optional(Type.Integer({ minimum: 10, maximum: 86400, default: 120 })),
  VEETEE_RETENTION_INTERVAL_SECONDS: Type.Optional(Type.Integer({ minimum: 60, maximum: 86400, default: 3600 })),
  VEETEE_SECRET_STORE_FILE: Type.Optional(Type.String()),
  VEETEE_SECRET_MASTER_KEY_FILE: Type.Optional(Type.String()),
  VEETEE_MACHINE_TOKEN_FILE: Type.Optional(Type.String()),
  VEETEE_LOG_LEVEL: Type.String({ default: 'info' }),
})

export type Environment = Static<typeof schema>

/**
 * Canonical origin advertised by the API contract. The reverse proxy/Serve
 * hostname is deployment configuration, never inferred from an untrusted Host.
 */
export function publicBaseUrl(env: Environment): string {
  const configured = env.VEETEE_PUBLIC_BASE_URL?.trim()
  const value = configured || `http://${env.VEETEE_API_HOST}:${env.VEETEE_API_PORT}`
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('VEETEE_PUBLIC_BASE_URL must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('VEETEE_PUBLIC_BASE_URL must use http or https')
  }
  return value.replace(/\/+$/, '')
}

export function readEnvironment(): Environment {
  return envSchema<Environment>({ schema, dotenv: true })
}
