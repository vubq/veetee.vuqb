import envSchema from 'env-schema'
import { Type, type Static } from '@sinclair/typebox'

const schema = Type.Object({
  VEETEE_API_HOST: Type.String({ default: '127.0.0.1' }),
  VEETEE_API_PORT: Type.Integer({ default: 8001, minimum: 1, maximum: 65535 }),
  VEETEE_DATABASE_MODE: Type.Union([Type.Literal('memory'), Type.Literal('postgres')], { default: 'memory' }),
  VEETEE_DATABASE_URL_FILE: Type.Optional(Type.String()),
  VEETEE_INITIAL_SNAPSHOT_FILE: Type.Optional(Type.String()),
  VEETEE_PROVIDER_CATALOG_FILE: Type.String({ default: './config/provider-catalog.json' }),
  VEETEE_ALLOWED_ORIGINS: Type.String({ default: 'http://127.0.0.1:8081' }),
  VEETEE_AUTH_MODE: Type.Union([Type.Literal('disabled'), Type.Literal('local')], { default: 'disabled' }),
  VEETEE_OWNER_EMAIL: Type.Optional(Type.String()),
  VEETEE_OWNER_PASSWORD_HASH: Type.Optional(Type.String()),
  VEETEE_MACHINE_TOKEN_FILE: Type.Optional(Type.String()),
  VEETEE_LOG_LEVEL: Type.String({ default: 'info' }),
})

export type Environment = Static<typeof schema>

export function readEnvironment(): Environment {
  return envSchema<Environment>({ schema, dotenv: true })
}
