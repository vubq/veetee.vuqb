import { createHash } from 'node:crypto'

/**
 * Source-aligned model control-plane types. These records describe what the
 * Manager can configure; they are deliberately separate from the realtime
 * provider adapter contract used by the voice session.
 */
export const MODEL_TYPES = ['ASR', 'TTS', 'LLM', 'VLLM', 'Intent', 'Memory', 'VAD', 'Plugin', 'RAG'] as const
export type ModelType = (typeof MODEL_TYPES)[number]

/** The source accepts a deliberately open field schema. Keep the common JSON
 * types plus the numeric aliases used by its older seed rows. */
export type ModelFieldType = 'string' | 'number' | 'boolean' | 'password' | 'dict' | 'array' | 'int' | 'integer' | 'float'

export interface ModelProviderField {
  key: string
  label: string
  type: ModelFieldType
  default?: unknown
  sensitive?: boolean
  dictName?: string
  [key: string]: unknown
}

export interface ModelProvider {
  id: string
  ownerId: string
  modelType: ModelType
  providerCode: string
  name: string
  fields: ModelProviderField[]
  sort: number
  revision: number
  etag: string
  updatedAt: string
  creator?: number | null
  createDate?: string | null
  updater?: number | null
  updateDate?: string | null
}

export interface ModelConfig {
  id: string
  ownerId: string
  modelType: ModelType
  modelCode: string
  modelName: string
  providerCode: string
  isDefault: boolean
  isEnabled: boolean
  configJson: Record<string, unknown>
  docLink: string | null
  remark: string | null
  sort: number
  revision: number
  etag: string
  updatedAt: string
  creator?: number | null
  createDate?: string | null
  updater?: number | null
  updateDate?: string | null
}

export interface ModelProviderInput {
  id?: string
  modelType: ModelType
  providerCode: string
  name: string
  fields: ModelProviderField[]
  sort?: number
}

export interface ModelConfigInput {
  modelType: ModelType
  providerCode: string
  id?: string
  modelCode: string
  modelName: string
  isDefault?: boolean
  isEnabled?: boolean
  configJson: Record<string, unknown>
  docLink?: string | null
  remark?: string | null
  sort?: number
}

export interface ModelConfigQuery {
  modelType?: ModelType
  modelName?: string
  page?: number
  limit?: number
}

export interface ModelConfigPage {
  items: ModelConfig[]
  total: number
  page: number
  limit: number
}

/** Source-compatible built-in voice row. This is separate from the runtime
 * voice_profile table, which stores owner-created aliases and revisions. */
export interface ModelTtsVoiceSeed {
  id: string
  ttsModelId: string
  name: string
  ttsVoice: string
  languages: string
  voiceDemo?: string | null
  remark?: string | null
  referenceAudio?: string | null
  referenceText?: string | null
  sort?: number
}

/**
 * Editable voice row belonging to one catalog TTS model.  This mirrors the
 * source manager's model-scoped voice table while keeping it separate from
 * runtime voice aliases stored in `voice_profile`.
 */
export interface ModelTtsVoice {
  id: string
  ttsModelId: string
  name: string
  ttsVoice: string
  languages: string
  voiceDemo: string | null
  remark: string | null
  referenceAudio: string | null
  referenceText: string | null
  sort: number
  etag: string
  updatedAt: string
}

export type ModelTtsVoiceInput = Omit<ModelTtsVoice, 'id' | 'etag' | 'updatedAt'> & { id?: string }

export interface ModelTtsVoicePage {
  items: ModelTtsVoice[]
  total: number
  page: number
  limit: number
}

export function modelEtag(value: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex')}"`
}

export function modelProviderId(modelType: ModelType, providerCode: string): string {
  return `SYSTEM_${modelType}_${providerCode}`.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96)
}

export function modelConfigId(modelType: ModelType, modelCode: string): string {
  return `${modelType}_${modelCode}`.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96)
}

export function cloneModelProvider(value: ModelProvider): ModelProvider {
  return structuredClone(value)
}

export function cloneModelConfig(value: ModelConfig): ModelConfig {
  return structuredClone(value)
}

export function cloneModelTtsVoice(value: ModelTtsVoice): ModelTtsVoice {
  return structuredClone(value)
}

export function newModelTtsVoice(input: ModelTtsVoiceInput, updatedAt = new Date().toISOString()): ModelTtsVoice {
  const id = input.id?.trim() || `TTS_VOICE_${createHash('sha256').update(`${input.ttsModelId}:${input.ttsVoice}:${input.name}`).digest('hex').slice(0, 20)}`
  const value = {
    id,
    ttsModelId: input.ttsModelId.trim(),
    name: input.name.trim(),
    ttsVoice: input.ttsVoice.trim(),
    languages: input.languages.trim(),
    voiceDemo: input.voiceDemo?.trim() || null,
    remark: input.remark?.trim() || null,
    referenceAudio: input.referenceAudio?.trim() || null,
    referenceText: input.referenceText?.trim() || null,
    sort: Math.max(0, Math.trunc(input.sort ?? 0)),
    updatedAt,
  }
  return { ...value, etag: modelEtag(value) }
}

export function normalizeModelProviderInput(input: ModelProviderInput): ModelProviderInput {
  const modelType = input.modelType
  const providerCode = input.providerCode.trim()
  const name = input.name.trim()
  if (!MODEL_TYPES.includes(modelType)) throw new Error('modelType is unsupported')
  if (!providerCode || providerCode.length > 80 || /[\u0000-\u001f\u007f]/u.test(providerCode)) throw new Error('providerCode is invalid')
  if (!name || name.length > 120) throw new Error('provider name is required')
  const fields = input.fields.map((field) => {
    const key = field.key.trim()
    const label = field.label.trim()
    if (!/^[A-Za-z0-9_.-]{1,120}$/.test(key)) throw new Error('provider field key is invalid')
    if (!label || !['string', 'number', 'boolean', 'password', 'dict', 'array', 'int', 'integer', 'float'].includes(field.type)) throw new Error('provider field is invalid')
    return { ...field, key, label }
  })
  const keys = new Set<string>()
  for (const field of fields) {
    if (keys.has(field.key)) throw new Error(`duplicate provider field: ${field.key}`)
    keys.add(field.key)
  }
  return {
    ...(input.id?.trim() ? { id: input.id.trim() } : {}),
    modelType,
    providerCode,
    name,
    fields: structuredClone(fields),
    sort: Math.max(0, Math.trunc(input.sort ?? 0)),
  }
}

export function normalizeModelConfigInput(input: ModelConfigInput): ModelConfigInput {
  if (!MODEL_TYPES.includes(input.modelType)) throw new Error('modelType is unsupported')
  const configJson = structuredClone(input.configJson)
  const inferredProviderCode = typeof configJson.type === 'string' ? configJson.type : undefined
  const providerCode = (input.providerCode || inferredProviderCode || '').trim()
  const modelCode = input.modelCode.trim()
  const modelName = input.modelName.trim()
  if (!providerCode || !modelCode || !modelName) throw new Error('model provider, code and name are required')
  // The reference control plane treats model_code as a display/configuration
  // identifier rather than a filesystem slug. Keep Unicode names from legacy
  // imports while rejecting controls and oversized values; the internal row id
  // is sanitized separately by modelConfigId().
  if (modelCode.length > 160 || /[\u0000-\u001f\u007f]/u.test(modelCode)) throw new Error('modelCode is invalid')
  if (typeof input.configJson !== 'object' || input.configJson === null || Array.isArray(input.configJson)) throw new Error('configJson must be an object')
  return {
    ...input,
    providerCode,
    modelCode,
    modelName,
    isDefault: Boolean(input.isDefault),
    isEnabled: input.isEnabled !== false,
    configJson: { ...configJson, ...(typeof configJson.type === 'string' ? {} : { type: providerCode }) },
    docLink: input.docLink?.trim() || null,
    remark: input.remark?.trim() || null,
    sort: Math.max(0, Math.trunc(input.sort ?? 0)),
  }
}

export function newModelConfig(ownerId: string, input: ModelConfigInput, revision = 1): ModelConfig {
  const normalized = normalizeModelConfigInput(input)
  const id = normalized.id?.trim() || modelConfigId(normalized.modelType, normalized.modelCode)
  const now = new Date().toISOString()
  const base = { ...normalized, id, ownerId, isDefault: normalized.isDefault ?? false, isEnabled: normalized.isEnabled !== false, sort: normalized.sort ?? 0, revision }
  return {
    id,
    ownerId,
    modelType: normalized.modelType,
    modelCode: normalized.modelCode,
    modelName: normalized.modelName,
    providerCode: normalized.providerCode,
    isDefault: normalized.isDefault ?? false,
    isEnabled: normalized.isEnabled !== false,
    configJson: structuredClone(normalized.configJson),
    docLink: normalized.docLink ?? null,
    remark: normalized.remark ?? null,
    sort: normalized.sort ?? 0,
    revision,
    etag: modelEtag(base),
    updatedAt: now,
  }
}

export function newModelProvider(ownerId: string, input: ModelProviderInput, revision = 1): ModelProvider {
  const normalized = normalizeModelProviderInput(input)
  const id = normalized.id?.trim() || modelProviderId(normalized.modelType, normalized.providerCode)
  const now = new Date().toISOString()
  const base = { id, ownerId, ...normalized, sort: normalized.sort ?? 0, revision }
  return { id, ownerId, modelType: normalized.modelType, providerCode: normalized.providerCode, name: normalized.name, fields: structuredClone(normalized.fields), sort: normalized.sort ?? 0, revision, etag: modelEtag(base), updatedAt: now }
}
