import type {
  AssistantCard,
  AssistantListQuery,
  ConversationExport,
  ConversationExportSummary,
  ConversationDetail,
  ConversationSummary,
  RetentionDeleteJob,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  DiscoverableDevice,
  GatewayProblem,
  GatewayResult,
  ModelMemoryWorkspace,
  NotFoundProblem,
  Page,
  PairDeviceInput,
  PreviewScenarioDefinition,
  PreviewScenarioId,
  ProviderConfigRecord,
  ProviderProbeResult,
  ProviderInstallationView,
  RetentionPolicy,
  RetentionPolicyInput,
  RetentionExpiredProblem,
  OfflineProblem,
  RevisionConflictProblem,
  RoleConfig,
  RoleConfigDraft,
  RolePolicyObject,
  SecretReference,
  UpdateProviderSelectionInput,
  ValidationProblem,
  Versioned,
  VoicePreview,
  VoiceProfile,
  VoiceProfileInput,
} from '@/domain'
import type { paths } from '@/api/generated'
import type { GatewayDependencies, ManagerGateway, PreviewControlGateway, RetentionMutationProblem, SecretMutationProblem } from './manager-gateway'
import type {
  CreateAssistantRequest,
  MemoryEnabledRequest,
  PairDeviceRequest,
  ProviderConfigPatchRequest,
  ProviderConfigRequest,
  VoiceProfilePatchRequest,
  VoiceProfileRequest,
  ProviderSelectionRequest,
  RetentionPolicyRequest,
  RoleConfigRequest,
} from '@/api/contract'
import { createManagerApiClient, type ManagerApiClient } from '@/api/manager-client'

type ApiResult = { response: Response; data?: unknown; error?: unknown }
type AssistantResource = paths['/api/v1/assistants']['get']['responses'][200]['content']['application/json']['items'][number]
type ProviderInstallationResource = paths['/api/v1/provider-installations']['get']['responses'][200]['content']['application/json']['items'][number]
type ProviderConfigResource = paths['/api/v1/provider-configs']['get']['responses'][200]['content']['application/json']['items'][number]
type ProviderProbeResource = paths['/api/v1/provider-configs/{id}/probe']['post']['responses'][200]['content']['application/json']
type VoiceResource = paths['/api/v1/voices']['get']['responses'][200]['content']['application/json']['items'][number]
type ModelMemoryResource = paths['/api/v1/assistants/{id}/model-memory']['get']['responses'][200]['content']['application/json']
type DeviceResource = paths['/api/v1/assistants/{id}/devices']['get']['responses'][200]['content']['application/json']['items'][number]
type DiscoverableDeviceResource = paths['/api/v1/devices/discoverable']['get']['responses'][200]['content']['application/json']['items'][number]
type RetentionResource = paths['/api/v1/retention-policy']['get']['responses'][200]['content']['application/json']
type ConversationSummaryResource = paths['/api/v1/assistants/{id}/conversations']['get']['responses'][200]['content']['application/json']['items'][number]
type ConversationDetailResource = paths['/api/v1/conversations/{id}']['get']['responses'][200]['content']['application/json']
type ConversationExportResource = paths['/api/v1/conversations/{id}/export']['get']['responses'][200]['content']['application/json']
type RetentionDeleteJobResource = paths['/api/v1/conversations/{id}']['delete']['responses'][202]['content']['application/json']
type RetentionDeleteJobGetResource = paths['/api/v1/retention-delete-jobs/{id}']['get']['responses'][200]['content']['application/json']
type SecretReferenceResource = paths['/api/v1/secret-references']['get']['responses'][200]['content']['application/json']['items'][number]

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
      admission: { ...draft.admission },
      autoTurn: {
        enabled: draft.autoTurn.enabled,
        noSpeechTimeoutMs: draft.autoTurn.noSpeechTimeoutMs,
        noSpeechAlert: { ...draft.autoTurn.noSpeechAlert },
      },
      ...(draft.conversation ? { conversation: cloneJson(draft.conversation) } : {}),
      ...(draft.progress ? { progress: cloneJson(draft.progress) } : {}),
      ...(draft.segmentation ? { segmentation: cloneJson(draft.segmentation) } : {}),
      ...(draft.bargeIn ? { bargeIn: cloneJson(draft.bargeIn) } : {}),
      ...(draft.toolPolicy ? { toolPolicy: cloneJson(draft.toolPolicy) } : {}),
      ...(draft.tools ? { tools: cloneJson(draft.tools) } : {}),
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

  async deleteProviderConfig(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>> {
    const result = await this.execute(() => this.client.DELETE('/api/v1/provider-configs/{id}', {
      params: { path: { id } },
      headers: { 'If-Match': expectedEtag },
    }))
    if (!result.response.ok) return this.failure(result)
    return this.success(undefined)
  }

  async probeProviderConfig(id: string): Promise<GatewayResult<ProviderProbeResult, ValidationProblem | NotFoundProblem | OfflineProblem>> {
    const result = await this.execute(() => this.client.POST('/api/v1/provider-configs/{id}/probe', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(providerProbe(result.data))
  }

  async listSecretReferences(): Promise<GatewayResult<SecretReference[], never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/secret-references'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(result.data.items.map(secretReference))
  }

  async createSecretReference(input: { name: string; secretValue: string; locator?: string }): Promise<GatewayResult<SecretReference, ValidationProblem | OfflineProblem>> {
    const result = await this.execute(() => this.client.POST('/api/v1/secret-references', {
      body: { name: input.name, store: 'encrypted-local', secretValue: input.secretValue, ...(input.locator ? { locator: input.locator } : {}) },
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(secretReference(result.data))
  }

  async updateSecretReference(id: string, input: { name?: string; locator?: string; secretValue?: string }, expectedEtag: string): Promise<GatewayResult<SecretReference, SecretMutationProblem>> {
    const result = await this.execute(() => this.client.PATCH('/api/v1/secret-references/{id}', {
      params: { path: { id } },
      headers: { 'If-Match': expectedEtag },
      body: input,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(secretReference(result.data))
  }

  async deleteSecretReference(id: string, expectedEtag: string): Promise<GatewayResult<void, SecretMutationProblem>> {
    const result = await this.execute(() => this.client.DELETE('/api/v1/secret-references/{id}', {
      params: { path: { id } },
      headers: { 'If-Match': expectedEtag },
    }))
    if (!result.response.ok) return this.failure(result)
    return this.success(undefined)
  }

  async listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/voices', { params: { query: { locale } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(voiceProfile), total: result.data.total })
  }

  async createVoiceProfile(input: VoiceProfileInput): Promise<GatewayResult<VoiceProfile, ValidationProblem | OfflineProblem>> {
    const payload: VoiceProfileRequest = input
    const result = await this.execute(() => this.client.POST('/api/v1/voices', { body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(voiceProfile(result.data))
  }

  async updateVoiceProfile(id: string, input: Partial<VoiceProfileInput>, expectedEtag: string): Promise<GatewayResult<VoiceProfile, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<VoiceProfile, unknown>>> {
    const payload: VoiceProfilePatchRequest = input
    const result = await this.execute(() => this.client.PATCH('/api/v1/voices/{id}', { params: { path: { id } }, headers: { 'If-Match': expectedEtag }, body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(voiceProfile(result.data))
  }

  async deleteVoiceProfile(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<VoiceProfile, unknown>>> {
    const result = await this.execute(() => this.client.DELETE('/api/v1/voices/{id}', { params: { path: { id } }, headers: { 'If-Match': expectedEtag } }))
    if (!result.response.ok) return this.failure(result)
    return this.success(undefined)
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

  async listDiscoverableDevices(): Promise<GatewayResult<Page<DiscoverableDevice>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/devices/discoverable'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(discoverableDevice), total: result.data.total })
  }

  async pairDevice(input: PairDeviceInput): Promise<GatewayResult<DeviceCard, never>> {
    const payload: PairDeviceRequest = input
    const result = await this.execute(() => this.client.POST('/api/v1/devices/pair', { body: payload }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(deviceCard(result.data))
  }

  async unlinkDevice(deviceId: string, expectedEtag: string): Promise<GatewayResult<void, never>> {
    const result = await this.execute(() => this.client.DELETE('/api/v1/devices/{id}/binding', {
      params: { path: { id: deviceId } },
      headers: { 'If-Match': expectedEtag },
    }))
    if (!result.response.ok) return this.failure(result)
    return this.success(undefined)
  }

  async getRetentionPolicy(): Promise<GatewayResult<RetentionPolicy, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/retention-policy'))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(retentionPolicy(result.data))
  }

  async updateRetentionPolicy(input: RetentionPolicyInput, expectedEtag: string): Promise<GatewayResult<RetentionPolicy, RetentionMutationProblem>> {
    const body: RetentionPolicyRequest = input
    const result = await this.execute(() => this.client.PATCH('/api/v1/retention-policy', {
      headers: { 'If-Match': expectedEtag },
      body,
    }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(retentionPolicy(result.data))
  }

  async listConversations(assistantId: string, limit = 20): Promise<GatewayResult<Page<ConversationSummary>, never>> {
    const result = await this.execute(() => this.client.GET('/api/v1/assistants/{id}/conversations', { params: { path: { id: assistantId }, query: { limit } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success({ items: result.data.items.map(conversationSummary), total: result.data.total })
  }

  async getConversation(id: string): Promise<GatewayResult<ConversationDetail, NotFoundProblem | RetentionExpiredProblem>> {
    const result = await this.execute(() => this.client.GET('/api/v1/conversations/{id}', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(conversationDetail(result.data))
  }

  async exportConversation(id: string): Promise<GatewayResult<ConversationExport, NotFoundProblem | RetentionExpiredProblem | OfflineProblem>> {
    const result = await this.execute(() => this.client.GET('/api/v1/conversations/{id}/export', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(conversationExport(result.data))
  }

  async deleteConversation(id: string): Promise<GatewayResult<RetentionDeleteJob, NotFoundProblem | RetentionExpiredProblem | OfflineProblem>> {
    const result = await this.execute(() => this.client.DELETE('/api/v1/conversations/{id}', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(retentionDeleteJob(result.data as RetentionDeleteJobResource))
  }

  async getRetentionDeleteJob(id: string): Promise<GatewayResult<RetentionDeleteJob, NotFoundProblem | OfflineProblem>> {
    const result = await this.execute(() => this.client.GET('/api/v1/retention-delete-jobs/{id}', { params: { path: { id } } }))
    if (!result.response.ok || result.data === undefined) return this.failure(result)
    return this.success(retentionDeleteJob(result.data as RetentionDeleteJobGetResource))
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
    const offline = result.response.status === 503 || code === 'OFFLINE_MUTATION_BLOCKED'
    const resourceId = (() => { try { return new URL(result.response.url).pathname.split('/').filter(Boolean).at(-1) ?? '' } catch { return '' } })()
    const problem = result.response.status === 410 || code === 'RETENTION_EXPIRED'
      ? { type: 'retention-expired' as const, code: 'RETENTION_EXPIRED' as const, messageKey: 'problem.RETENTION_EXPIRED', requestId: crypto.randomUUID(), retryable: false as const, resource: 'conversation' as const, resourceId }
      : { type: 'validation' as const, code, messageKey: `problem.${code}`, requestId: crypto.randomUUID(), retryable: result.response.status >= 500, fieldProblems: [] }
    return { ok: false, problem: problem as unknown as P, meta: { requestId: crypto.randomUUID(), completedAt: new Date().toISOString(), delayMs: 0, freshness: offline ? 'stale' : 'fresh', offline } }
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
    onlineDeviceCount: value.onlineDeviceCount,
    deviceCount: value.deviceCount,
    lastConversationAt: value.lastConversationAt,
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
    admission: {
      maxActiveTurns: isRecord(value.admission) && typeof value.admission.maxActiveTurns === 'number' ? value.admission.maxActiveTurns : 1,
      retryAfterMs: isRecord(value.admission) && typeof value.admission.retryAfterMs === 'number' ? value.admission.retryAfterMs : 250,
    },
    autoTurn: {
      enabled: isRecord(value.autoTurn) && value.autoTurn.enabled === true,
      noSpeechTimeoutMs: isRecord(value.autoTurn) && typeof value.autoTurn.noSpeechTimeoutMs === 'number' ? value.autoTurn.noSpeechTimeoutMs : 5000,
      noSpeechAlert: {
        status: isRecord(value.autoTurn) && isRecord(value.autoTurn.noSpeechAlert) && typeof value.autoTurn.noSpeechAlert.status === 'string' ? value.autoTurn.noSpeechAlert.status : 'warning',
        message: isRecord(value.autoTurn) && isRecord(value.autoTurn.noSpeechAlert) && typeof value.autoTurn.noSpeechAlert.message === 'string' ? value.autoTurn.noSpeechAlert.message : '',
        emotion: isRecord(value.autoTurn) && isRecord(value.autoTurn.noSpeechAlert) && typeof value.autoTurn.noSpeechAlert.emotion === 'string' ? value.autoTurn.noSpeechAlert.emotion : 'neutral',
      },
    },
    conversation: conversationSettings(value.conversation),
    progress: policyObject(value.progress),
    segmentation: policyObject(value.segmentation),
    bargeIn: policyObject(value.bargeIn),
    toolPolicy: policyObject(value.toolPolicy),
    tools: policyTools(value.tools),
  }
}

function policyObject(value: unknown): RolePolicyObject | undefined {
  return isRecord(value) ? cloneJson(value) : undefined
}

function policyTools(value: unknown): RolePolicyObject[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tools = value.filter(isRecord).map((tool) => cloneJson(tool))
  return tools.length ? tools : undefined
}

function conversationSettings(value: unknown): RoleConfig['conversation'] {
  if (!isRecord(value)) return undefined
  const alert = isRecord(value.idleAlert) ? value.idleAlert : {}
  return {
    continuous: value.continuous === true,
    idleTimeoutMs: typeof value.idleTimeoutMs === 'number' ? value.idleTimeoutMs : 180000,
    idleAlert: {
      status: typeof alert.status === 'string' ? alert.status : 'ok',
      message: typeof alert.message === 'string' ? alert.message : '',
      emotion: typeof alert.emotion === 'string' ? alert.emotion : 'neutral',
    },
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function providerInstallation(value: ProviderInstallationResource): ProviderInstallationView {
  return { id: value.id, kind: value.kind, displayNameKey: value.displayNameKey, displayName: value.displayName, version: value.version, manifest: value.manifest, configSchema: value.configSchema }
}

function providerConfig(value: ProviderConfigResource): ProviderConfigRecord {
  return { id: value.id, installationId: value.installationId, name: value.name, revision: value.revision, config: value.config, secretRefs: value.secretRefs, etag: value.etag, archivedAt: value.archivedAt }
}

function providerProbe(value: ProviderProbeResource): ProviderProbeResult {
  return { providerConfigId: value.providerConfigId, state: value.state, checkedAt: value.checkedAt, durationMs: value.durationMs, checks: value.checks }
}

function secretReference(value: SecretReferenceResource): SecretReference {
  return {
    id: value.id,
    name: value.name,
    store: value.store,
    locatorMasked: value.locatorMasked,
    version: value.version,
    metadataRevision: value.metadataRevision,
    status: value.status,
    lastRotatedAt: value.lastRotatedAt,
    etag: value.etag,
    updatedAt: value.updatedAt,
  }
}

function voiceProfile(value: VoiceResource): VoiceProfile {
  return { id: value.id, name: value.name, providerName: value.providerName, locale: value.locale, description: value.description, previewDurationMs: value.previewDurationMs, available: value.available, managed: value.managed, providerConfigId: value.providerConfigId, voiceCode: value.voiceCode, enabled: value.enabled, sort: value.sort, demoUrl: value.demoUrl, etag: value.etag, updatedAt: value.updatedAt }
}

function modelMemory(value: ModelMemoryResource): ModelMemoryWorkspace {
  return value
}

function deviceCard(value: DeviceResource): DeviceCard {
  return { id: value.id, assistantId: value.assistantId, etag: value.etag, displayName: value.displayName, maskedMac: value.maskedMac, firmwareVersion: value.firmwareVersion, board: value.board, onlineState: value.onlineState, lastSeenAt: value.lastSeenAt, lastConversationAt: value.lastConversationAt }
}

function discoverableDevice(value: DiscoverableDeviceResource): DiscoverableDevice {
  return { id: value.id, maskedMac: value.maskedMac, board: value.board, firmwareVersion: value.firmwareVersion, onlineState: value.onlineState, lastSeenAt: value.lastSeenAt, pairingExpiresAt: value.pairingExpiresAt }
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

function conversationExport(value: ConversationExportResource): ConversationExport {
  const summary: ConversationExportSummary = {
    id: value.conversation.summary.id,
    assistantId: value.conversation.summary.assistantId,
    startedAt: value.conversation.summary.startedAt,
    endedAt: value.conversation.summary.endedAt,
    locale: value.conversation.summary.locale,
    configRevision: value.conversation.summary.configRevision,
    status: value.conversation.summary.status,
    turnCount: value.conversation.summary.turnCount,
    lastTurnAt: value.conversation.summary.lastTurnAt,
    aggregateTimings: value.conversation.summary.aggregateTimings,
    retentionUntil: value.conversation.summary.retentionUntil,
  }
  return { exportVersion: 1, exportedAt: value.exportedAt, conversation: { summary, turns: value.conversation.turns, retention: retentionPolicy(value.conversation.retention) } }
}

function retentionDeleteJob(value: RetentionDeleteJobResource | RetentionDeleteJobGetResource): RetentionDeleteJob {
  return { id: value.id, conversationId: value.conversationId, status: value.status, requestedAt: value.requestedAt, startedAt: value.startedAt, completedAt: value.completedAt, errorCode: value.errorCode }
}
