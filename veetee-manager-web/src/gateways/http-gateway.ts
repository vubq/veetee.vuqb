import type {
  AssistantCard,
  AssistantListQuery,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  GatewayResult,
  GatewayProblem,
  ModelMemoryWorkspace,
  Page,
  PairDeviceInput,
  PreviewScenarioDefinition,
  PreviewScenarioId,
  RoleConfig,
  RoleConfigDraft,
  UpdateProviderSelectionInput,
  Versioned,
  VoicePreview,
  VoiceProfile,
  ProviderConfigRecord,
  ProviderInstallationView,
  ValidationProblem,
} from '@/domain'
import type { GatewayDependencies, ManagerGateway, PreviewControlGateway } from './manager-gateway'

type HttpResponse = { response: Response; body: unknown }

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

  constructor(private readonly baseUrl: string) {}

  async listAssistants(query: AssistantListQuery = {}): Promise<GatewayResult<Page<AssistantCard>, never>> {
    const params = new URLSearchParams()
    if (query.search) params.set('search', query.search)
    const result = await this.request(`/api/v1/assistants?${params.toString()}`)
    if (!result.response.ok) return this.failure<Page<AssistantCard>, never>(result)
    const body = result.body as { items?: Array<Record<string, unknown>> }
    const items = (body.items ?? []).map((value) => assistantCard(value))
    return this.success({ items, total: items.length })
  }

  async createAssistant(input: CreateAssistantInput): Promise<GatewayResult<Versioned<AssistantCard>, never>> {
    const result = await this.request('/api/v1/assistants', { method: 'POST', body: JSON.stringify({ name: input.name }) })
    if (!result.response.ok) return this.failure(result)
    const value = result.body as Record<string, unknown>
    const card = assistantCard(value)
    return this.success({ value: card, revision: Number(value.draftRevision ?? 1), etag: result.response.headers.get('etag') ?? '"missing"' })
  }

  async getRoleConfig(assistantId: string): Promise<GatewayResult<Versioned<RoleConfig>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/role-config`)
    if (!result.response.ok) return this.failure(result)
    return this.success({ value: roleConfig(assistantId, result.body as Record<string, unknown>), revision: 1, etag: result.response.headers.get('etag') ?? '"missing"' })
  }

  async saveRoleConfig(assistantId: string, draft: RoleConfigDraft, expectedEtag: string): Promise<GatewayResult<Versioned<RoleConfig>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/role-config`, { method: 'PATCH', headers: { 'If-Match': expectedEtag }, body: JSON.stringify({ locale: draft.locale, basePrompt: draft.basePrompt, personality: { id: draft.personalityId, name: draft.personalityName }, speech: draft.speech }) })
    if (!result.response.ok) return this.failure(result)
    return this.success({ value: roleConfig(assistantId, result.body as Record<string, unknown>), revision: 1, etag: result.response.headers.get('etag') ?? expectedEtag })
  }

  async publishAssistant(assistantId: string, expectedEtag: string): Promise<GatewayResult<{ revision: number }, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/publish`, { method: 'POST', headers: { 'If-Match': expectedEtag } })
    if (!result.response.ok) return this.failure(result)
    const body = result.body as { snapshot?: { revision?: number } }
    return this.success({ revision: Number(body.snapshot?.revision ?? 0) })
  }

  async listProviderInstallations(): Promise<GatewayResult<ProviderInstallationView[], never>> {
    const result = await this.request('/api/v1/provider-installations')
    if (!result.response.ok) return this.failure(result)
    return this.success((result.body as { items?: ProviderInstallationView[] }).items ?? [])
  }

  async listProviderConfigs(): Promise<GatewayResult<ProviderConfigRecord[], never>> {
    const result = await this.request('/api/v1/provider-configs')
    if (!result.response.ok) return this.failure(result)
    return this.success((result.body as { items?: ProviderConfigRecord[] }).items ?? [])
  }

  async createProviderConfig(input: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>> {
    const result = await this.request('/api/v1/provider-configs', { method: 'POST', body: JSON.stringify(input) })
    if (!result.response.ok) return this.failure(result)
    return this.success(result.body as ProviderConfigRecord)
  }

  async listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>> {
    const result = await this.request(`/api/v1/voices?locale=${encodeURIComponent(locale)}`)
    if (!result.response.ok) return this.failure(result)
    return this.success(result.body as Page<VoiceProfile>)
  }

  async previewVoice(voiceId: string, transcript: string): Promise<GatewayResult<VoicePreview, never>> {
    return this.success({ voiceId, state: 'ready', durationMs: transcript.length * 60, transcript })
  }

  async getModelMemory(assistantId: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/model-memory`)
    if (!result.response.ok) return this.failure(result)
    return this.success({ value: result.body as ModelMemoryWorkspace, revision: 1, etag: result.response.headers.get('etag') ?? '"missing"' })
  }

  async updateProviderSelection(assistantId: string, input: UpdateProviderSelectionInput, expectedEtag: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/model-memory/provider`, { method: 'PATCH', headers: { 'If-Match': expectedEtag }, body: JSON.stringify(input) })
    if (!result.response.ok) return this.failure(result)
    return this.success({ value: result.body as ModelMemoryWorkspace, revision: 1, etag: result.response.headers.get('etag') ?? expectedEtag })
  }

  async setMemoryEnabled(assistantId: string, enabled: boolean, expectedEtag: string): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/model-memory/memory`, { method: 'PATCH', headers: { 'If-Match': expectedEtag }, body: JSON.stringify({ enabled }) })
    if (!result.response.ok) return this.failure(result)
    return this.success({ value: result.body as ModelMemoryWorkspace, revision: 1, etag: result.response.headers.get('etag') ?? expectedEtag })
  }

  async listDevices(assistantId: string): Promise<GatewayResult<Page<DeviceCard>, never>> {
    const result = await this.request(`/api/v1/assistants/${assistantId}/devices`)
    if (!result.response.ok) return this.failure(result)
    return this.success(result.body as Page<DeviceCard>)
  }

  async pairDevice(input: PairDeviceInput): Promise<GatewayResult<DeviceCard, never>> {
    const result = await this.request('/api/v1/devices/pair', { method: 'POST', body: JSON.stringify(input) })
    if (!result.response.ok) return this.failure(result)
    return this.success(result.body as DeviceCard)
  }

  getScenario(): PreviewScenarioId { return this.scenario }
  setScenario(scenario: PreviewScenarioId): void { this.scenario = scenario }
  listScenarios(): readonly PreviewScenarioDefinition[] { return [] }
  async resetDemo(): Promise<GatewayResult<DemoResetSummary, never>> { return this.success({ assistantCount: 0, deviceCount: 0 }) }

  private async request(path: string, init: RequestInit = {}): Promise<HttpResponse> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers, credentials: 'include' })
      const body = await response.json().catch(() => undefined)
      return { response, body }
    } catch {
      return { response: new Response(JSON.stringify({ code: 'OFFLINE_MUTATION_BLOCKED' }), { status: 503 }), body: undefined }
    }
  }

  private success<T>(data: T): GatewayResult<T, never> {
    return { ok: true, data, meta: { requestId: crypto.randomUUID(), completedAt: new Date().toISOString(), delayMs: 0, freshness: 'fresh', offline: false } }
  }

  private failure<T, P extends GatewayProblem>(result: HttpResponse): GatewayResult<T, P> {
    const body = result.body as { code?: string } | undefined
    return { ok: false, problem: { type: 'validation', code: body?.code ?? 'REQUEST_FAILED', messageKey: `problem.${body?.code ?? 'requestFailed'}`, requestId: crypto.randomUUID(), retryable: result.response.status >= 500, fieldProblems: [] } as unknown as P, meta: { requestId: crypto.randomUUID(), completedAt: new Date().toISOString(), delayMs: 0, freshness: 'fresh', offline: result.response.status >= 500 } }
  }
}

function assistantCard(value: Record<string, unknown>): AssistantCard {
  const role = (value.role as Record<string, unknown> | undefined) ?? {}
  const speech = (role.speech as Record<string, unknown> | undefined) ?? {}
  const personality = (role.personality as Record<string, unknown> | undefined) ?? {}
  return {
    id: String(value.id), name: String(value.name ?? ''), locale: String(role.locale ?? 'vi-VN'), voiceName: String(speech.voiceId ?? ''), personalityName: String(personality.name ?? ''), onlineDeviceCount: 0, deviceCount: 0, lastConversationAt: null, publishedRevision: typeof value.publishedRevision === 'number' ? value.publishedRevision : null, configurationState: value.publishedRevision ? 'published' : 'draft',
  }
}

function roleConfig(assistantId: string, value: Record<string, unknown>): RoleConfig {
  const personality = (value.personality as Record<string, unknown> | undefined) ?? {}
  const speech = (value.speech as RoleConfig['speech'] | undefined) ?? { voiceId: '', rate: 1, pitch: 0, style: 'natural' }
  return { assistantId, locale: String(value.locale ?? 'vi-VN'), basePrompt: String(value.basePrompt ?? ''), personalityId: String(personality.id ?? ''), personalityName: String(personality.name ?? ''), speech }
}
