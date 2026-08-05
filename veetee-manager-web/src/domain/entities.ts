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

export interface AdmissionSettings {
  maxActiveTurns: number
  retryAfterMs: number
}

export interface AutoTurnAlertSettings {
  status: string
  message: string
  emotion: string
}

export interface AutoTurnSettings {
  enabled: boolean
  noSpeechTimeoutMs: number
  noSpeechAlert: AutoTurnAlertSettings
}

export interface ConversationSettings {
  continuous: boolean
  idleTimeoutMs: number
  idleAlert: AutoTurnAlertSettings
}

export interface ProgressAcknowledgementSettings extends RolePolicyObject {
  enabled?: boolean
  acknowledgementId?: string
  deadlineMs?: number
  acknowledgements?: Record<string, string>
}

/**
 * Additive runtime policy payloads are preserved by the Web gateway even when
 * this UI surface does not edit every field yet. This prevents a save from
 * silently deleting server/firmware capabilities published by another tool.
 */
export type RolePolicyObject = Record<string, unknown>

export interface BargeInSettings extends RolePolicyObject {
  enabled?: boolean
  deviceDuplex?: boolean
  minSpeechFrames?: number
  cooldownMs?: number
}

export interface RoleConfig {
  assistantId: string
  locale: string
  basePrompt: string
  personalityId: string
  personalityName: string
  /** Optional owner-authored instructions for a custom personality profile. */
  personalityPrompt?: string
  speech: SpeechSettings
  admission: AdmissionSettings
  autoTurn: AutoTurnSettings
  conversation?: ConversationSettings
  progress?: ProgressAcknowledgementSettings
  segmentation?: RolePolicyObject
  bargeIn?: BargeInSettings
  toolPolicy?: RolePolicyObject
  tools?: RolePolicyObject[]
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
  managed?: boolean
  providerConfigId?: string | null
  voiceCode?: string
  enabled?: boolean
  sort?: number
  demoUrl?: string | null
  etag?: string | null
  updatedAt?: IsoDateTime | null
}

export interface VoiceProfileInput {
  providerConfigId: string
  name: string
  locale: string
  voiceCode: string
  description?: string
  demoUrl?: string | null
  enabled?: boolean
  sort?: number
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
  displayName?: string
  version: string
  manifest: Record<string, unknown>
  configSchema: Record<string, unknown>
  /** Normalized catalog metadata used by focused provider screens. */
  providerFamily?: string
  protocol?: string
  supportedLocales: string[]
  capabilities: string[]
  hasVoiceCatalog?: boolean
}

export interface ProviderConfigRecord {
  id: string
  installationId: string
  name: string
  revision: number
  config: Record<string, unknown>
  secretRefs: string[]
  etag: string
  archivedAt?: IsoDateTime | null
}

export type ProviderProbeCheckState = 'passed' | 'failed' | 'skipped'

export interface ProviderProbeResult {
  providerConfigId: string
  state: 'ready' | 'unavailable'
  checkedAt: IsoDateTime
  durationMs: number
  checks: Array<{ id: string; state: ProviderProbeCheckState; message: string }>
}

export type SecretReferenceStatus = 'available' | 'unavailable' | 'revoked'

/** Metadata only; the secret value is deliberately not part of this entity. */
export interface SecretReference {
  id: string
  name: string
  store: 'encrypted-local'
  locatorMasked: string
  version: number
  metadataRevision: number
  status: SecretReferenceStatus
  lastRotatedAt: IsoDateTime | null
  etag: ETag
  updatedAt: IsoDateTime
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
  etag: ETag
  displayName: string
  maskedMac: string
  firmwareVersion: string
  board: string
  onlineState: DeviceOnlineState
  lastSeenAt: IsoDateTime
  lastConversationAt: IsoDateTime | null
}

export type ConversationStatus = 'active' | 'completed' | 'aborted' | 'error'
export type ConversationTurnState = 'completed' | 'aborted' | 'error'

export interface RetentionPolicy {
  ownerId: string
  captureTranscript: boolean
  transcriptDays: number | null
  captureAudio: boolean
  audioDays: number | null
  effectiveAt: IsoDateTime
  revision: number
  etag: ETag
}

export type RetentionPolicyInput = Pick<
  RetentionPolicy,
  'captureTranscript' | 'transcriptDays' | 'captureAudio' | 'audioDays'
>

export interface TranscriptSegment {
  speaker: 'user' | 'assistant' | 'system'
  text: string
  locale: string
  confidence: number | null
  startedAtMs: number | null
  endedAtMs: number | null
  isFinal: boolean
}

export interface ToolCallRecord {
  toolName: string
  source: 'llm' | 'system'
  status: 'completed' | 'error' | 'cancelled'
  startedAt: IsoDateTime
  endedAt: IsoDateTime | null
  latencyMs: number | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  errorCode: string | null
}

export interface ConversationSummary {
  id: string
  assistantId: string
  deviceKey: string | null
  startedAt: IsoDateTime
  endedAt: IsoDateTime | null
  locale: string
  configRevision: number
  status: ConversationStatus
  turnCount: number
  lastTurnAt: IsoDateTime | null
  aggregateTimings: Record<string, number>
  retentionUntil: IsoDateTime | null
}

export interface ConversationTurn {
  id: string
  conversationId: string
  turnId: string
  sequence: number
  state: ConversationTurnState
  startedAt: IsoDateTime
  endedAt: IsoDateTime
  finishReason: string
  timings: Record<string, number>
  transcript: TranscriptSegment[]
  toolCalls: ToolCallRecord[]
}

export interface ConversationDetail {
  summary: ConversationSummary
  turns: ConversationTurn[]
  retention: RetentionPolicy
}

export type ConversationExportSummary = Omit<ConversationSummary, 'deviceKey'>

export interface ConversationExport {
  exportVersion: 1
  exportedAt: IsoDateTime
  conversation: {
    summary: ConversationExportSummary
    turns: ConversationTurn[]
    retention: RetentionPolicy
  }
}

export type RetentionDeleteJobStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface RetentionDeleteJob {
  id: string
  conversationId: string
  status: RetentionDeleteJobStatus
  requestedAt: IsoDateTime
  startedAt: IsoDateTime | null
  completedAt: IsoDateTime | null
  errorCode: string | null
}

export interface PairDeviceInput {
  assistantId: string
  deviceId?: string
  verificationCode: string
  displayName?: string
}

export interface DiscoverableDevice {
  id: string
  maskedMac: string
  board: string
  firmwareVersion: string
  onlineState: DeviceOnlineState
  lastSeenAt: IsoDateTime
  pairingExpiresAt: IsoDateTime | null
}

export interface DemoResetSummary {
  assistantCount: number
  deviceCount: number
}
