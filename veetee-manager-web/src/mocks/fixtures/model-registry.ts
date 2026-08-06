import type { ModelConfigRecord, ModelProviderField, ModelProviderRecord, ModelType } from '@/domain'

import registrySeed from './model-registry.seed.json'

/**
 * Keep the browser preview on the same source-aligned catalog as Manager API.
 * The JSON file is copied from veetee-manager-api/config/model-registry.json
 * when the control-plane seed changes; this mapper only adds mock transport
 * metadata (owner, revision, ETag and timestamp).
 */
interface RegistrySeed {
  providers: Array<{
    id: string
    modelType: ModelType
    providerCode: string
    name: string
    fields: ModelProviderField[]
    sort?: number
  }>
  configs: Array<{
    id: string
    modelType: ModelType
    providerCode: string
    modelCode: string
    modelName: string
    isDefault?: boolean
    isEnabled?: boolean
    configJson: Record<string, unknown>
    docLink?: string | null
    remark?: string | null
    sort?: number
  }>
}

const now = '2026-08-06T09:00:00.000Z'
const etag = (id: string, revision = 1) => `"model-${id}-${revision}"`
const source = registrySeed as unknown as RegistrySeed

export function createModelRegistryFixtures(): { providers: ModelProviderRecord[]; configs: ModelConfigRecord[] } {
  const providers = source.providers.map((item) => ({
    id: item.id,
    ownerId: 'local-owner',
    modelType: item.modelType,
    providerCode: item.providerCode,
    name: item.name,
    fields: structuredClone(item.fields),
    sort: item.sort ?? 0,
    revision: 1,
    etag: etag(item.id),
    updatedAt: now,
  }))

  const configs = source.configs.map((item) => ({
    id: item.id,
    ownerId: 'local-owner',
    modelType: item.modelType,
    providerCode: item.providerCode,
    modelCode: item.modelCode,
    modelName: item.modelName,
    isDefault: item.isDefault === true,
    isEnabled: item.isEnabled !== false,
    configJson: structuredClone(item.configJson),
    docLink: item.docLink ?? null,
    remark: item.remark ?? null,
    sort: item.sort ?? 0,
    revision: 1,
    etag: etag(item.id),
    updatedAt: now,
  }))

  return { providers, configs }
}
