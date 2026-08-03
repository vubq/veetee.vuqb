import type {
  AssistantCard,
  AssistantListQuery,
  ConversationDetail,
  ConversationSummary,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  GatewayProblem,
  GatewayResult,
  ModelMemoryWorkspace,
  Page,
  PairDeviceInput,
  PreviewScenarioDefinition,
  PreviewScenarioId,
  ProviderConfigRecord,
  ProviderInstallationView,
  RetentionPolicy,
  RevisionConflictProblem,
  RoleConfig,
  RoleConfigDraft,
  UpdateProviderSelectionInput,
  ValidationProblem,
  Versioned,
  VoicePreview,
  VoiceProfile,
} from '@/domain'
import type { paths } from '@/api/generated'
import type { GatewayDependencies, ManagerGateway, PreviewControlGateway } from './manager-gateway'
import type {
  CreateAssistantRequest,
  MemoryEnabledRequest,
  PairDeviceRequest,
  ProviderConfigPatchRequest,
  ProviderConfigRequest,
  ProviderSelectionRequest,
  RoleConfigRequest,
} from '@/api/contract'
import { createManagerApiClient, type ManagerApiClient } from '@/api/manager-client'

type ApiResult = { response: Response; data?: unknown; error?: unknown }
type AssistantResource = paths['/api/v1/assistants']['get']['responses'][200]['content']['application/json']['items'][number]
type ProviderInstallationResource = paths['/api/v1/provider-installations']['get']['responses'][200]['content']['application/json']['items'][number]
type ProviderConfigResource = paths['/api/v1/provider-configs']['get']['responses'][200]['content']['application/json']['items'][number]
type VoiceResource = paths['/api/v1/voices']['get']['responses'][200]['content']['application/json']['items'][number]
type ModelMemoryResource = paths['/api/v1/assistants/{id}/model-memory']['get']['responses'][200]['content']['application/json']
type DeviceResource = paths['/api/v1/assistants/{id}/devices']['get']['responses'][200]['content']['application/json']['items'][number]
type RetentionResource = paths['/api/v1/retention-policy']['get']['responses'][200]['content']['application/json']
type ConversationSummaryResource = paths['/api/v1/assistants/{id}/conversations']['get']['responses'][200]['content']['application/json']['items'][number]
type ConversationDetailResource = paths['/api/v1/conversations/{id}']['get']['responses'][200]['content']['application/json']

export function createHttpGatewayDependencies(baseUrl: string): GatewayDependencies {
  const gateway = new HttpManagerGateway(baseUrl)
  return {
    managerGateway: gateway,
    assistantGateway: gateway,
    providerGateway: gateway,
    deviceGateway: gateway,
    previewControlGateway: gateway,
  }
}

class HttpManagerGateway implements ManagerGateway, PreviewControlGateway {
  private scenario: PreviewScenarioId = 'happy'
  private readonly client: ManagerApiClient

  constructor(baseUrl: string) {
    this.client = createManagerApiClient(baseUrl)
  }

  async listAssistants(query: AssistantListQuery = {}): Promise<GatewayResult<Page<AssistantCard>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants', {
      params: query.search ? { query: { search: query.search } } : undefined,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure<Page<AssistantCard>, never>(result)
    const items = result.data.items.map((value) => assistantCard(value))
    return this.success({ items, total: items.length })
  }

  async createAssistant(input: CreateAssistantInput): Promise<GatewayResult<Versioned<AssistantCard>, never>> {
    const payload: CreateAssistantRequest = { name: input.name }
    const result = await this.execute(() => this.client.POST('/api/v1/assistants', { body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    const card = assistantCard(result.data)
    return this.success({ value: card, revision: result.data.draftRevision, etag: this.etag(result.response) })
  }

  async getRoleConfig(assistantId: string): Promise<GatewayResult<Versioned<RoleConfig>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants/{id}/role-config', { params: { path: { id: assistantId } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ value: roleConfig(assistantId, result.data), revision: 1, etag: this.etag(result.response) })
  }

  async saveRoleConfig(assistantId: string, draft: RoleConfigDraft, expectedEtag: string): Promise<GatewayResult<Versioned<RoleConfig>, never>> {
    const payload: RoleConfigRequest = {
      locale: draft.locale,
      basePrompt: draft.basePrompt,
      personality: { id: draft.personalityId, name: draft.personalityName },
      speech: { ...draft.speech },
    }
    const result = await this.execute(() => this.client.PATCH('/api/v1/assistants/{id}/role-config', {
      params: { path: { id: assistantId } },
      headers: { 'If-Match': expectedEtag },
      body: payload,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ value: roleConfig(assistantId, result.data), revision: 1, etag: this.etag(result.response, expectedEtag) })
  }

  async publishAssistant(assistantId: string, expectedEtag: string): Promise<GatewayResult<{ revision: number }, never>> {
    const result = await this.execute(() => this.client.POST('/api/v1/assistants/{id}/publish', {
      params: { path: { id: assistantId } },
      headers: { 'If-Match': expectedEtag },
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ revision: result.data.snapshot.revision })
  }

  async listProviderInstallations(): Promise<GatewayResult<ProviderInstallationView[], never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/provider-installations'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(result.data.items.map(providerInstallation))
  }

  async listProviderConfigs(): Promise<GatewayResult<ProviderConfigRecord[], never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/provider-configs'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(result.data.items.map(providerConfig))
  }

  async createProviderConfig(input: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>> {
    const payload: ProviderConfigRequest = input
    const result = await this.execute(() => this.client.POST('/api/v1/provider-configs', { body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(providerConfig(result.data))
  }

  async updateProviderConfig(id: string, input: { name?: string; config?: Record<string, unknown>; secretRefs?: string[] }, expectedEtag: string): Promise<GatewayResult<ProviderConfigRecord, RevisionConflictProblem<ProviderConfigRecord, unknown> | ValidationProblem>> {
    const payload: ProviderConfigPatchRequest = input
    const result = await this.execute(() => this.client.PATCH('/api/v1/provider-configs/{id}', {
      params: { path: { id } },
      headers: { 'If-Match': expectedEtag },
      body: payload,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(providerConfig(result.data))
  }

  async listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/voices', { params: { query: { locale } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(voiceProfile), total: result.data.total })
  }

  async previewVoice(voiceId: string, transcript: string): Promise<GatewayResult<VoicePreview, never>> {
    return this.success({ voiceId, state: 'ready', durationMs: transcript.length * 60, transcript })
  }

  async getModelMemory(assistantId: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants/{id}/model-memory', { params: { path: { id: assistantId } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ value: modelMemory(result.data), revision: 1, etag: this.etag(result.response) })
  }

  async updateProviderSelection(assistantId: string, input: UpdateProviderSelectionInput, expectedEtag: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const payload: ProviderSelectionRequest = input
    const result = await this.execute(() => this.client.PATCH('/api/v1/assistants/{id}/model-memory/provider', {
      params: { path: { id: assistantId } },
      headers: { 'If-Match': expectedEtag },
      body: payload,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ value: modelMemory(result.data), revision: 1, etag: this.etag(result.response, expectedEtag) })
  }

  async setMemoryEnabled(assistantId: string, enabled: boolean, expectedEtag: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const payload: MemoryEnabledRequest = { enabled }
    const result = await this.execute(() => this.client.PATCH('/api/v1/assistants/{id}/model-memory/memory', {
      params: { path: { id: assistantId } },
      headers: { 'If-Match': expectedEtag },
      body: payload,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ value: modelMemory(result.data), revision: 1, etag: this.etag(result.response, expectedEtag) })
  }

  async listDevices(assistantId: string): Promise<GatewayResult<Page<DeviceCard>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants/{id}/devices', { params: { path: { id: assistantId } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(deviceCard), total: result.data.total })
  }

  async pairDevice(input: PairDeviceInput): Promise<GatewayResult<DeviceCard, never>> {
    const payload: PairDeviceRequest = input
    const result = await this.execute(() => this.client.POST('/api/v1/devices/pair', { body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(deviceCard(result.data))
  }

  async getRetentionPolicy(): Promise<GatewayResult<RetentionPolicy, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/retention-policy'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(retentionPolicy(result.data))
  }

  async listConversations(assistantId: string, limit = 20): Promise<GatewayResult<Page<ConversationSummary>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants/{id}/conversations', { params: { path: { id: assistantId }, query: { limit } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(conversationSummary), total: result.data.total })
  }

  async getConversation(id: string): Promise<GatewayResult<ConversationDetail, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/conversations/{id}', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(conversationDetail(result.data))
  }

  getScenario(): PreviewScenarioId { return this.scenario }
  setScenario(scenario: PreviewScenarioId): void { this.scenario = scenario }
  listScenarios(): readonly PreviewScenarioDefinition[] { return [] }
  async resetDemo(): Promise<GatewayResult<DemoResetSummary, never>> { return this.success({ assistantCount: 0, deviceCount: 0 }) }

  private async execute<T extends ApiResult>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch {
      return { response: new Response(JSON.stringify({ code: 'OFFLINE_MUTATION_BLOCKED' }), { status: 503 }), error: { code: 'OFFLINE_MUTATION_BLOCKED' } } as T
    }
  }

  private etag(response: Response, fallback = '"missing"'): string { return response.headers.get('etag') ?? fallback }

  private success<T>(data: T): GatewayResult<T, never> {
    return { ok: true, data, meta: { requestId: crypto.randomUUID(), completedAt: new Date().toISOString(), delayMs: 0, freshness: 'fresh', offline: false } }
  }

  private failure<T, P extends GatewayProblem>(result: ApiResult): GatewayResult<T, P> {
    const error = result.error
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : result.response.status === 503 ? 'OFFLINE_MUTATION_BLOCKED' : 'REQUEST_FAILED'
    return { ok: false, problem: { type: 'validation', code, messageKey: `problem.${code}`, requestId: crypto.randomUUID(), retryable: result.response.status >= 500, fieldProblems: [] } as unknown as P, meta: { requestId: crypto.randomUUID(), completedAt: new Date().toISOString(), delayMs: 0, freshness: 'fresh', offline: result.response.status >= 500 } }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function assistantCard(value: AssistantResource): AssistantCard {
  const role = isRecord(value.role) ? value.role : {}
  const speech = isRecord(role.speech) ? role.speech : {}
  const personality = isRecord(role.personality) ? role.personality : {}
  return {
    id: value.id,
    name: value.name,
    locale: typeof role.locale === 'string' ? role.locale : 'vi-VN',
    voiceName: typeof speech.voiceId === 'string' ? speech.voiceId : '',
    personalityName: typeof personality.name === 'string' ? personality.name : '',
    onlineDeviceCount: 0,
    deviceCount: 0,
    lastConversationAt: null,
    publishedRevision: value.publishedRevision,
    configurationState: value.publishedRevision ? 'published' : 'draft',
  }
}

function roleConfig(assistantId: string, value: Record<string, unknown>): RoleConfig {
  const personality = isRecord(value.personality) ? value.personality : {}
  const speech = isRecord(value.speech) ? value.speech : {}
  return {
    assistantId,
    locale: typeof value.locale === 'string' ? value.locale : 'vi-VN',
    basePrompt: typeof value.basePrompt === 'string' ? value.basePrompt : '',
    personalityId: typeof personality.id === 'string' ? personality.id : '',
    personalityName: typeof personality.name === 'string' ? personality.name : '',
    speech: {
      voiceId: typeof speech.voiceId === 'string' ? speech.voiceId : '',
      rate: typeof speech.rate === 'number' ? speech.rate : 1,
      pitch: typeof speech.pitch === 'number' ? speech.pitch : 0,
      style: speech.style === 'concise' || speech.style === 'detailed' ? speech.style : 'natural',
    },
  }
}

function providerInstallation(value: ProviderInstallationResource): ProviderInstallationView {
  return { id: value.id, kind: value.kind, displayNameKey: value.displayNameKey, version: value.version, manifest: value.manifest, configSchema: value.configSchema }
}

function providerConfig(value: ProviderConfigResource): ProviderConfigRecord {
  return { id: value.id, installationId: value.installationId, name: value.name, revision: value.revision, config: value.config, secretRefs: value.secretRefs, etag: value.etag }
}

function voiceProfile(value: VoiceResource): VoiceProfile {
  return { id: value.id, name: value.name, providerName: value.providerName, locale: value.locale, description: value.description, previewDurationMs: value.previewDurationMs, available: value.available }
}

function modelMemory(value: ModelMemoryResource): ModelMemoryWorkspace {
  return value
}

function deviceCard(value: DeviceResource): DeviceCard {
  return { id: value.id, assistantId: value.assistantId, displayName: value.displayName, maskedMac: value.maskedMac, firmwareVersion: value.firmwareVersion, board: value.board, onlineState: value.onlineState, lastSeenAt: value.lastSeenAt, lastConversationAt: value.lastConversationAt }
}

function retentionPolicy(value: RetentionResource): RetentionPolicy {
  return { ownerId: value.ownerId, captureTranscript: value.captureTranscript, transcriptDays: value.transcriptDays, captureAudio: value.captureAudio, audioDays: value.audioDays, effectiveAt: value.effectiveAt, revision: value.revision, etag: value.etag }
}

function conversationSummary(value: ConversationSummaryResource): ConversationSummary {
  return { id: value.id, assistantId: value.assistantId, deviceKey: value.deviceKey, startedAt: value.startedAt, endedAt: value.endedAt, locale: value.locale, configRevision: value.configRevision, status: value.status, turnCount: value.turnCount, lastTurnAt: value.lastTurnAt, aggregateTimings: value.aggregateTimings, retentionUntil: value.retentionUntil }
}

function conversationDetail(value: ConversationDetailResource): ConversationDetail {
  return { summary: conversationSummary(value.summary), turns: value.turns, retention: retentionPolicy(value.retention) }
}
