export type IsoDateTime = string
export type ETag = string

export interface Page<T> {
  items: T[]
  total: number
}

export interface Versioned<T> {
  value: T
  revision: number
  etag: ETag
}

export type AssistantConfigurationState = 'published' | 'draft' | 'needs-attention'

export interface AssistantCard {
  id: string
  name: string
  locale: string
  voiceName: string
  personalityName: string
  onlineDeviceCount: number
  deviceCount: number
  lastConversationAt: IsoDateTime | null
  publishedRevision: number | null
  configurationState: AssistantConfigurationState
}

export interface AssistantListQuery {
  search?: string
  configurationState?: AssistantConfigurationState
  online?: boolean
}

export interface CreateAssistantInput {
  name: string
  locale: string
  personalityId?: string
}

export type ResponseStyle = 'concise' | 'natural' | 'detailed'

export interface SpeechSettings {
  voiceId: string
  rate: number
  pitch: number
  style: ResponseStyle
}

export interface RoleConfig {
  assistantId: string
  locale: string
  basePrompt: string
  personalityId: string
  personalityName: string
  speech: SpeechSettings
}

export type RoleConfigDraft = Omit<RoleConfig, 'assistantId'>

export interface VoiceProfile {
  id: string
  name: string
  providerName: string
  locale: string
  description: string
  previewDurationMs: number
  available: boolean
}

export interface VoicePreview {
  voiceId: string
  state: 'ready'
  durationMs: number
  transcript: string
}

export const PROVIDER_KINDS = ['vad', 'asr', 'llm', 'tts', 'intent', 'memory'] as const

export type ProviderKind = (typeof PROVIDER_KINDS)[number]
export type ProviderAvailability = 'ready' | 'unavailable' | 'disabled'

export interface ProviderConfigSummary {
  id: string
  kind: ProviderKind
  name: string
  providerName: string
  availability: ProviderAvailability
  supportedLocales: string[]
}

export interface ProviderInstallationView {
  id: string
  kind: ProviderKind
  displayNameKey: string
  version: string
  manifest: Record<string, unknown>
  configSchema: Record<string, unknown>
}

export interface ProviderConfigRecord {
  id: string
  installationId: string
  name: string
  revision: number
  config: Record<string, unknown>
  secretRefs: string[]
  etag: string
}

export type ProviderSelection =
  | {
      kind: ProviderKind
      mode: 'selected'
      providerConfigId: string
    }
  | {
      kind: ProviderKind
      mode: 'disabled'
      providerConfigId?: never
    }

export interface UpdateProviderSelectionInput {
  kind: ProviderKind
  mode: ProviderSelection['mode']
  providerConfigId?: string
}

export type MemoryItemKind = 'preference' | 'fact' | 'instruction'

export interface MemorySettings {
  enabled: boolean
  itemCount: number
}

export interface MemoryItem {
  id: string
  kind: MemoryItemKind
  content: string
  enabled: boolean
  updatedAt: IsoDateTime
}

export interface ModelMemoryWorkspace {
  assistantId: string
  selections: ProviderSelection[]
  availableConfigs: ProviderConfigSummary[]
  memory: MemorySettings
  memoryItems: MemoryItem[]
}

export type DeviceOnlineState = 'online' | 'offline'

export interface DeviceCard {
  id: string
  assistantId: string
  displayName: string
  maskedMac: string
  firmwareVersion: string
  board: string
  onlineState: DeviceOnlineState
  lastSeenAt: IsoDateTime
  lastConversationAt: IsoDateTime | null
}

export interface PairDeviceInput {
  assistantId: string
  verificationCode: string
  displayName?: string
}

export interface DemoResetSummary {
  assistantCount: number
  deviceCount: number
}
