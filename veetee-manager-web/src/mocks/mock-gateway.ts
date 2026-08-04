import type {
  AssistantCard,
  AssistantListQuery,
  ConversationDetail,
  ConversationSummary,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  FieldProblem,
  GatewayFailure,
  GatewayProblem,
  GatewayResponseMeta,
  GatewayResult,
  GatewaySuccess,
  ModelMemoryWorkspace,
  NameConflictProblem,
  NotFoundProblem,
  OfflineProblem,
  Page,
  PairDeviceInput,
  PairingCodeProblem,
  PreviewScenarioDefinition,
  PreviewScenarioId,
  ProviderKind,
  ProviderSelection,
  ProviderUnavailableProblem,
  RevisionConflictProblem,
  RoleConfig,
  RoleConfigDraft,
  SecretReference,
  RoleSaveProblem,
  UpdateProviderSelectionInput,
  ValidationProblem,
  Versioned,
  VoicePreview,
  VoiceProfile,
  ProviderConfigRecord,
  ProviderInstallationView,
  RetentionPolicy,
} from '@/domain'
import { PROVIDER_KINDS } from '@/domain'
import type {
  CreateAssistantProblem,
  GatewayDependencies,
  ManagerGateway,
  PairDeviceProblem,
  PreviewControlGateway,
  ProviderMutationProblem,
  SecretMutationProblem,
} from '@/gateways'

import {
  ASSISTANT_IDS,
  PAIRING_SUCCESS_CODE,
  PERSONALITY_IDS,
  PROVIDER_CONFIG_IDS,
  createInitialMockState,
  HISTORY_CONVERSATIONS,
} from './fixtures'
import type { MockState } from './fixtures'
import { MOCK_SCENARIOS, MOCK_SCENARIO_LIST } from './scenarios'

type DelayOperation = 'read' | 'mutation'
type Sleep = (delayMs: number) => Promise<void>

export interface MockGatewayOptions {
  scenario?: PreviewScenarioId
  delayMs?: number
  longActionDelayMs?: number
  sleep?: Sleep
  now?: () => string
}

interface RequestContext {
  requestId: string
  delayMs: number
}

const REQUIRED_PROVIDER_KINDS = new Set<ProviderKind>(['vad', 'asr', 'llm', 'tts'])
const FIXED_NOW = '2026-08-03T09:00:00.000Z'

const defaultSleep: Sleep = async (delayMs) => {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs)
  })
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLocaleLowerCase('vi')
}

function etag(prefix: string, revision: number): string {
  return `"${prefix}-rev-${revision}"`
}

function deterministicUuid(namespace: 'assistant' | 'device', sequence: number): string {
  const head = namespace === 'assistant' ? '81111111' : '82222222'
  return `${head}-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

export class MockGateway implements ManagerGateway, PreviewControlGateway {
  private state: MockState
  private scenario: PreviewScenarioId
  private readonly unlinkedDevices = new Map<string, DeviceCard>()
  private requestSequence = 0
  private readonly sleep: Sleep
  private readonly now: () => string
  private readonly delayOverride: number | undefined
  private readonly longActionDelayOverride: number | undefined

  constructor(options: MockGatewayOptions = {}) {
    this.state = createInitialMockState()
    this.scenario = options.scenario ?? 'happy'
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? (() => FIXED_NOW)
    this.delayOverride = options.delayMs
    this.longActionDelayOverride = options.longActionDelayMs
  }

  getScenario(): PreviewScenarioId {
    return this.scenario
  }

  setScenario(scenario: PreviewScenarioId): void {
    this.scenario = scenario
  }

  listScenarios(): readonly PreviewScenarioDefinition[] {
    return clone(MOCK_SCENARIO_LIST)
  }

  async resetDemo(): Promise<GatewayResult<DemoResetSummary, never>> {
    const request = await this.begin('mutation')
    this.state = createInitialMockState()
    this.scenario = 'happy'
    this.unlinkedDevices.clear()

    return this.success(
      {
        assistantCount: Object.keys(this.state.assistants).length,
        deviceCount: this.state.devices.length,
      },
      request,
    )
  }

  async listAssistants(
    query: AssistantListQuery = {},
  ): Promise<GatewayResult<Page<AssistantCard>, never>> {
    const request = await this.begin('read')
    const search = normalizeSearch(query.search ?? '')
    const items = Object.values(this.state.assistants)
      .map(({ value }) => clone(value))
      .filter((assistant) => {
        if (search && !normalizeSearch(`${assistant.name} ${assistant.locale}`).includes(search)) {
          return false
        }
        if (
          query.configurationState !== undefined &&
          assistant.configurationState !== query.configurationState
        ) {
          return false
        }
        if (query.online !== undefined) {
          const online = assistant.onlineDeviceCount > 0
          if (online !== query.online) return false
        }
        return true
      })

    return this.success({ items, total: items.length }, request)
  }

  async createAssistant(
    input: CreateAssistantInput,
  ): Promise<GatewayResult<Versioned<AssistantCard>, CreateAssistantProblem>> {
    const request = await this.begin('mutation')
    const validation = this.validateCreateAssistant(input, request.requestId)
    if (validation) return this.failure(validation, request)

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)

    const name = input.name.trim()
    const duplicate = Object.values(this.state.assistants).some(
      ({ value }) => normalizeSearch(value.name) === normalizeSearch(name),
    )
    if (duplicate) {
      const problem: NameConflictProblem = {
        type: 'name-conflict',
        code: 'NAME_CONFLICT',
        messageKey: 'problem.assistant.nameConflict',
        requestId: request.requestId,
        retryable: false,
        fieldProblems: [
          {
            field: 'name',
            code: 'NAME_CONFLICT',
            messageKey: 'validation.assistant.nameConflict',
          },
        ],
      }
      return this.failure(problem, request)
    }

    const id = deterministicUuid('assistant', this.state.nextAssistantSequence++)
    const card: Versioned<AssistantCard> = {
      value: {
        id,
        name,
        locale: input.locale,
        voiceName: 'An Nhiên',
        personalityName: 'Người bạn đồng hành',
        onlineDeviceCount: 0,
        deviceCount: 0,
        lastConversationAt: null,
        publishedRevision: null,
        configurationState: 'draft',
      },
      revision: 1,
      etag: etag(`assistant-${id}`, 1),
    }

    const templateRole = this.requireRoleFixture(ASSISTANT_IDS.may)
    const templateWorkspace = this.requireModelMemoryFixture(ASSISTANT_IDS.may)
    this.state.assistants[id] = clone(card)
    this.state.roleConfigs[id] = {
      value: {
        ...clone(templateRole.value),
        assistantId: id,
        locale: input.locale,
        basePrompt: '',
        personalityId: input.personalityId ?? PERSONALITY_IDS.companion,
      },
      revision: 1,
      etag: etag(`role-${id}`, 1),
    }
    this.state.modelMemory[id] = {
      value: {
        ...clone(templateWorkspace.value),
        assistantId: id,
        memory: { enabled: false, itemCount: 0 },
        memoryItems: [],
      },
      revision: 1,
      etag: etag(`model-memory-${id}`, 1),
    }

    return this.success(clone(card), request)
  }

  async getRoleConfig(
    assistantId: string,
  ): Promise<GatewayResult<Versioned<RoleConfig>, NotFoundProblem>> {
    const request = await this.begin('read')
    const config = this.state.roleConfigs[assistantId]
    if (!config) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }
    return this.success(clone(config), request)
  }

  async saveRoleConfig(
    assistantId: string,
    draft: RoleConfigDraft,
    expectedEtag: string,
  ): Promise<GatewayResult<Versioned<RoleConfig>, RoleSaveProblem>> {
    const request = await this.begin('mutation')
    const current = this.state.roleConfigs[assistantId]
    if (!current) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }

    const validation = this.validateRoleDraft(draft, request.requestId)
    if (validation) return this.failure(validation, request)

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)

    if (
      MOCK_SCENARIOS[this.scenario].forceRoleConflict ||
      current.etag !== expectedEtag
    ) {
      const problem: RevisionConflictProblem<RoleConfig, RoleConfigDraft> = {
        type: 'revision-conflict',
        code: 'REVISION_CONFLICT',
        messageKey: 'problem.revision.conflict',
        requestId: request.requestId,
        retryable: false,
        currentRevision: current.revision,
        currentEtag: current.etag,
        current: clone(current.value),
        localDraft: clone(draft),
      }
      return this.failure(problem, request)
    }

    const revision = current.revision + 1
    const next: Versioned<RoleConfig> = {
      value: { assistantId, ...clone(draft) },
      revision,
      etag: etag(`role-${assistantId}`, revision),
    }
    this.state.roleConfigs[assistantId] = clone(next)

    const assistant = this.state.assistants[assistantId]
    if (assistant) {
      const voice = this.state.voices.find(({ id }) => id === draft.speech.voiceId)
      assistant.value.locale = draft.locale
      assistant.value.voiceName = voice?.name ?? assistant.value.voiceName
      assistant.value.personalityName = draft.personalityName
      assistant.value.configurationState = 'draft'
    }

    return this.success(clone(next), request)
  }

  async publishAssistant(
    assistantId: string,
    expectedEtag: string,
  ): Promise<GatewayResult<{ revision: number }, RoleSaveProblem>> {
    const request = await this.begin('mutation')
    const current = this.state.roleConfigs[assistantId]
    if (!current) return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    if (current.etag !== expectedEtag) {
      const problem: RevisionConflictProblem<RoleConfig, RoleConfigDraft> = {
        type: 'revision-conflict', code: 'REVISION_CONFLICT', messageKey: 'problem.revision.conflict', requestId: request.requestId, retryable: false,
        currentRevision: current.revision, currentEtag: current.etag, current: clone(current.value), localDraft: clone(current.value),
      }
      return this.failure(problem, request)
    }
    const assistant = this.state.assistants[assistantId]
    if (assistant) {
      assistant.value.configurationState = 'published'
      assistant.value.publishedRevision = current.revision
    }
    return this.success({ revision: current.revision }, request)
  }

  async listProviderInstallations(): Promise<GatewayResult<ProviderInstallationView[], never>> {
    const request = await this.begin('read')
    return this.success(clone(this.state.providerInstallations), request)
  }

  async listProviderConfigs(): Promise<GatewayResult<ProviderConfigRecord[], never>> {
    const request = await this.begin('read')
    return this.success(clone(this.state.providerConfigs), request)
  }

  async listSecretReferences(): Promise<GatewayResult<SecretReference[], never>> {
    const request = await this.begin('read')
    return this.success(clone(this.state.secretReferences), request)
  }

  async createSecretReference(input: { name: string; secretValue: string; locator?: string }): Promise<GatewayResult<SecretReference, ValidationProblem | OfflineProblem>> {
    const request = await this.begin('mutation')
    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)
    if (!input.name.trim() || !input.secretValue) {
      return this.failure({ type: 'validation', code: 'VALIDATION_ERROR', messageKey: 'problem.validation', requestId: request.requestId, retryable: false, fieldProblems: [{ field: 'name', code: 'REQUIRED', messageKey: 'validation.required' }] }, request)
    }
    const sequence = this.state.secretReferences.length + 1
    const now = this.now()
    const secret: SecretReference = { id: `secret-preview-${sequence}`, name: input.name.trim(), store: 'encrypted-local', locatorMasked: 'encrypted-local', version: 1, metadataRevision: 1, status: 'available', lastRotatedAt: now, etag: etag(`secret-${sequence}`, 1), updatedAt: now }
    this.state.secretReferences.push(secret)
    return this.success(clone(secret), request)
  }

  async updateSecretReference(id: string, input: { name?: string; locator?: string; secretValue?: string }, expectedEtag: string): Promise<GatewayResult<SecretReference, SecretMutationProblem>> {
    const request = await this.begin('mutation')
    const current = this.state.secretReferences.find((item) => item.id === id)
    if (!current) return this.failure(this.notFound('secret', id, request.requestId), request)
    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)
    if (current.etag !== expectedEtag) return this.failure({ type: 'revision-conflict', code: 'REVISION_CONFLICT', messageKey: 'problem.revision.conflict', requestId: request.requestId, retryable: false, currentRevision: current.metadataRevision, currentEtag: current.etag, current: clone(current), localDraft: input }, request)
    const rotated = input.secretValue !== undefined
    const nextRevision = current.metadataRevision + 1
    const nextVersion = rotated ? current.version + 1 : current.version
    const now = this.now()
    const next: SecretReference = { ...current, ...(input.name === undefined ? {} : { name: input.name.trim() }), ...(input.locator === undefined ? {} : { locatorMasked: 'encrypted-local' }), version: nextVersion, metadataRevision: nextRevision, ...(rotated ? { status: 'available' as const, lastRotatedAt: now } : {}), etag: etag(`secret-${id}`, nextRevision), updatedAt: now }
    this.state.secretReferences = this.state.secretReferences.map((item) => item.id === id ? next : item)
    return this.success(clone(next), request)
  }

  async deleteSecretReference(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<unknown, unknown>>> {
    const request = await this.begin('mutation')
    const current = this.state.secretReferences.find((item) => item.id === id)
    if (!current) return this.failure(this.notFound('secret', id, request.requestId), request)
    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)
    if (current.etag !== expectedEtag) return this.failure({ type: 'revision-conflict', code: 'REVISION_CONFLICT', messageKey: 'problem.revision.conflict', requestId: request.requestId, retryable: false, currentRevision: current.metadataRevision, currentEtag: current.etag, current: clone(current), localDraft: undefined }, request)
    if (this.state.providerConfigs.some((item) => item.secretRefs.includes(id))) return this.failure({ type: 'validation', code: 'VALIDATION_ERROR', messageKey: 'problem.secret.inUse', requestId: request.requestId, retryable: false, fieldProblems: [{ field: 'id', code: 'RESOURCE_IN_USE', messageKey: 'problem.secret.inUse' }] }, request)
    this.state.secretReferences = this.state.secretReferences.filter((item) => item.id !== id)
    return this.success(undefined, request)
  }

  async createProviderConfig(input: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>> {
    const request = await this.begin('mutation')
    const value: ProviderConfigRecord = { id: `${input.installationId}-${this.state.providerConfigs.length + 1}`, installationId: input.installationId, name: input.name, revision: 1, config: clone(input.config), secretRefs: input.secretRefs ?? [], etag: '"preview"' }
    this.state.providerConfigs.push(value)
    return this.success(value, request)
  }

  async updateProviderConfig(id: string, input: { name?: string; config?: Record<string, unknown>; secretRefs?: string[] }, expectedEtag: string): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>> {
    const request = await this.begin('mutation')
    const current = this.state.providerConfigs.find((item) => item.id === id)
    if (!current) return this.failure(this.validationProblem([{ field: 'id', code: 'NOT_FOUND', messageKey: 'problem.request.failed' }], request.requestId)!, request)
    if (current.etag !== expectedEtag) {
      const problem = this.validationProblem([{ field: 'etag', code: 'REVISION_CONFLICT', messageKey: 'problem.revision.conflict' }], request.requestId)
      if (problem) return this.failure(problem, request)
    }
    const next: ProviderConfigRecord = { ...current, name: input.name ?? current.name, config: clone(input.config ?? current.config), secretRefs: input.secretRefs ?? [...current.secretRefs], revision: current.revision + 1, etag: `"preview-provider-${current.revision + 1}"` }
    this.state.providerConfigs = [...this.state.providerConfigs.filter((item) => item.id !== id), next]
    return this.success(next, request)
  }

  async listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>> {
    const request = await this.begin('read')
    const items = this.state.voices
      .filter((voice) => voice.locale === locale)
      .map((voice) => clone(voice))
    return this.success({ items, total: items.length }, request)
  }

  async previewVoice(
    voiceId: string,
    transcript: string,
  ): Promise<
    GatewayResult<
      VoicePreview,
      NotFoundProblem | OfflineProblem | ProviderUnavailableProblem
    >
  > {
    const request = await this.begin('mutation')
    const voice = this.state.voices.find(({ id }) => id === voiceId)
    if (!voice) {
      return this.failure(this.notFound('voice', voiceId, request.requestId), request)
    }
    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)
    if (!voice.available) {
      return this.failure(
        this.providerUnavailable('tts', PROVIDER_CONFIG_IDS.tts, request.requestId),
        request,
      )
    }
    return this.success(
      {
        voiceId,
        state: 'ready',
        durationMs: voice.previewDurationMs,
        transcript,
      },
      request,
    )
  }

  async getModelMemory(
    assistantId: string,
  ): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, NotFoundProblem>> {
    const request = await this.begin('read')
    const workspace = this.state.modelMemory[assistantId]
    if (!workspace) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }

    const result = clone(workspace)
    const unavailableKind = MOCK_SCENARIOS[this.scenario].unavailableProviderKind
    if (unavailableKind) {
      result.value.availableConfigs = result.value.availableConfigs.map((config) =>
        config.kind === unavailableKind
          ? { ...config, availability: 'unavailable' }
          : config,
      )
    }
    return this.success(result, request)
  }

  async updateProviderSelection(
    assistantId: string,
    input: UpdateProviderSelectionInput,
    expectedEtag: string,
  ): Promise<
    GatewayResult<Versioned<ModelMemoryWorkspace>, ProviderMutationProblem>
  > {
    const request = await this.begin('mutation')
    const workspace = this.state.modelMemory[assistantId]
    if (!workspace) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)

    const validation = this.validateProviderSelection(input, request.requestId)
    if (validation) return this.failure(validation, request)

    if (workspace.etag !== expectedEtag) {
      return this.failure(
        this.workspaceConflict(workspace, input, request.requestId),
        request,
      )
    }

    let selection: ProviderSelection
    if (input.mode === 'disabled') {
      selection = { kind: input.kind, mode: 'disabled' }
    } else {
      const providerConfig = workspace.value.availableConfigs.find(
        ({ id }) => id === input.providerConfigId,
      )
      if (!providerConfig) {
        return this.failure(
          this.notFound(
            'provider-config',
            input.providerConfigId ?? '',
            request.requestId,
          ),
          request,
        )
      }
      if (providerConfig.kind !== input.kind) {
        const problem: ValidationProblem = {
          type: 'validation',
          code: 'VALIDATION_ERROR',
          messageKey: 'problem.provider.kindMismatch',
          requestId: request.requestId,
          retryable: false,
          fieldProblems: [
            {
              field: 'providerConfigId',
              code: 'KIND_MISMATCH',
              messageKey: 'validation.provider.kindMismatch',
            },
          ],
        }
        return this.failure(problem, request)
      }
      const unavailableKind = MOCK_SCENARIOS[this.scenario].unavailableProviderKind
      if (
        providerConfig.availability !== 'ready' ||
        providerConfig.kind === unavailableKind
      ) {
        return this.failure(
          this.providerUnavailable(input.kind, providerConfig.id, request.requestId),
          request,
        )
      }
      selection = {
        kind: input.kind,
        mode: 'selected',
        providerConfigId: providerConfig.id,
      }
    }

    const selectionIndex = workspace.value.selections.findIndex(
      ({ kind }) => kind === input.kind,
    )
    workspace.value.selections[selectionIndex] = selection
    this.advanceWorkspace(workspace)
    return this.success(clone(workspace), request)
  }

  async setMemoryEnabled(
    assistantId: string,
    enabled: boolean,
    expectedEtag: string,
  ): Promise<
    GatewayResult<Versioned<ModelMemoryWorkspace>, ProviderMutationProblem>
  > {
    const request = await this.begin('mutation')
    const workspace = this.state.modelMemory[assistantId]
    if (!workspace) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)

    if (workspace.etag !== expectedEtag) {
      return this.failure(
        this.workspaceConflict(workspace, { enabled }, request.requestId),
        request,
      )
    }

    const memorySelection = workspace.value.selections.find(
      ({ kind }) => kind === 'memory',
    )
    if (enabled && memorySelection?.mode !== 'selected') {
      const problem: ValidationProblem = {
        type: 'validation',
        code: 'VALIDATION_ERROR',
        messageKey: 'problem.memory.providerRequired',
        requestId: request.requestId,
        retryable: false,
        fieldProblems: [
          {
            field: 'enabled',
            code: 'MEMORY_PROVIDER_REQUIRED',
            messageKey: 'validation.memory.providerRequired',
          },
        ],
      }
      return this.failure(problem, request)
    }

    workspace.value.memory.enabled = enabled
    this.advanceWorkspace(workspace)
    return this.success(clone(workspace), request)
  }

  async listDevices(
    assistantId: string,
  ): Promise<GatewayResult<Page<DeviceCard>, NotFoundProblem>> {
    const request = await this.begin('read')
    if (!this.state.assistants[assistantId]) {
      return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    }
    const items = this.state.devices
      .filter((device) => device.assistantId === assistantId)
      .map((device) => clone(device))
    return this.success({ items, total: items.length }, request)
  }

  async pairDevice(
    input: PairDeviceInput,
  ): Promise<GatewayResult<DeviceCard, PairDeviceProblem>> {
    const request = await this.begin('mutation')
    if (!this.state.assistants[input.assistantId]) {
      return this.failure(
        this.notFound('assistant', input.assistantId, request.requestId),
        request,
      )
    }

    const verificationCode = input.verificationCode.trim().toUpperCase()
    if (!/^VT-\d{4}$/.test(verificationCode)) {
      const problem: ValidationProblem = {
        type: 'validation',
        code: 'VALIDATION_ERROR',
        messageKey: 'problem.validation',
        requestId: request.requestId,
        retryable: false,
        fieldProblems: [
          {
            field: 'verificationCode',
            code: 'PAIRING_CODE_FORMAT',
            messageKey: 'validation.pairingCode.format',
          },
        ],
      }
      return this.failure(problem, request)
    }

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)

    if (verificationCode !== PAIRING_SUCCESS_CODE) {
      const problem: PairingCodeProblem = {
        type: 'pairing-code',
        code: 'PAIRING_CODE_INVALID',
        messageKey: 'problem.pairingCode.invalid',
        requestId: request.requestId,
        retryable: false,
        fieldProblems: [
          {
            field: 'verificationCode',
            code: 'PAIRING_CODE_INVALID',
            messageKey: 'validation.pairingCode.invalid',
          },
        ],
      }
      return this.failure(problem, request)
    }

    const sequence = this.state.nextDeviceSequence++
    const device: DeviceCard = {
      id: deterministicUuid('device', sequence),
      assistantId: input.assistantId,
      etag: etag(`device-${sequence}`, 1),
      displayName: input.displayName?.trim() || `Veetee mới ${sequence}`,
      maskedMac: `A4:CF:12:••:••:${sequence.toString(16).padStart(2, '0').toUpperCase()}`,
      firmwareVersion: '0.1.0-preview.3',
      board: 'ESP32-S3 N16R8',
      onlineState: 'online',
      lastSeenAt: this.now(),
      lastConversationAt: null,
    }
    this.state.devices.push(clone(device))

    const assistant = this.state.assistants[input.assistantId]
    if (assistant) {
      assistant.value.deviceCount += 1
      assistant.value.onlineDeviceCount += 1
    }
    return this.success(device, request)
  }

  async unlinkDevice(
    deviceId: string,
    expectedEtag: string,
  ): Promise<GatewayResult<void, NotFoundProblem | OfflineProblem | RevisionConflictProblem<unknown, unknown>>> {
    const request = await this.begin('mutation')
    const current = this.state.devices.find((device) => device.id === deviceId)
    if (!current) {
      if (this.unlinkedDevices.has(deviceId)) return this.success(undefined, request)
      return this.failure(this.notFound('device', deviceId, request.requestId), request)
    }

    const offline = this.offlineProblem(request.requestId)
    if (offline) return this.failure(offline, request)
    if (current.etag !== expectedEtag) {
      const conflict: RevisionConflictProblem<DeviceCard, unknown> = {
        type: 'revision-conflict',
        code: 'REVISION_CONFLICT',
        messageKey: 'problem.revision.conflict',
        requestId: request.requestId,
        retryable: false,
        currentRevision: 1,
        currentEtag: current.etag,
        current: clone(current),
        localDraft: undefined,
      }
      return this.failure(conflict, request)
    }

    this.state.devices = this.state.devices.filter((device) => device.id !== deviceId)
    this.unlinkedDevices.set(deviceId, clone(current))
    const assistant = this.state.assistants[current.assistantId]
    if (assistant) {
      assistant.value.deviceCount = Math.max(0, assistant.value.deviceCount - 1)
      if (current.onlineState === 'online') assistant.value.onlineDeviceCount = Math.max(0, assistant.value.onlineDeviceCount - 1)
    }
    return this.success(undefined, request)
  }

  async getRetentionPolicy(): Promise<GatewayResult<RetentionPolicy, never>> {
    const request = await this.begin('read')
    return this.success({ ownerId: 'local-owner', captureTranscript: true, transcriptDays: 30, captureAudio: false, audioDays: null, effectiveAt: '1970-01-01T00:00:00.000Z', revision: 1, etag: '"baseline-transcript-30d-audio-off"' }, request)
  }

  async listConversations(assistantId: string, limit = 20): Promise<GatewayResult<Page<ConversationSummary>, NotFoundProblem>> {
    const request = await this.begin('read')
    if (!this.state.assistants[assistantId]) return this.failure(this.notFound('assistant', assistantId, request.requestId), request)
    const conversation = this.scenario === 'history' ? HISTORY_CONVERSATIONS[assistantId] : undefined
    const items: ConversationSummary[] = conversation ? [clone(conversation.summary)] : []
    return this.success({ items: items.slice(0, limit), total: items.length }, request)
  }

  async getConversation(id: string): Promise<GatewayResult<ConversationDetail, NotFoundProblem>> {
    const request = await this.begin('read')
    if (this.scenario === 'history') {
      const conversation = Object.values(HISTORY_CONVERSATIONS).find((item) => item.summary.id === id)
      if (conversation) return this.success(clone(conversation), request)
    }
    return this.failure(this.notFound('conversation', id, request.requestId), request)
  }

  private async begin(operation: DelayOperation): Promise<RequestContext> {
    this.requestSequence += 1
    const requestSequence = this.requestSequence
    const preset = MOCK_SCENARIOS[this.scenario]
    const presetDelay = operation === 'read' ? preset.readDelayMs : preset.mutationDelayMs
    const delayMs =
      this.delayOverride ??
      (this.scenario === 'long-action' && operation === 'mutation'
        ? (this.longActionDelayOverride ?? presetDelay)
        : presetDelay)
    await this.sleep(delayMs)
    return {
      requestId: `mock-request-${String(requestSequence).padStart(4, '0')}`,
      delayMs,
    }
  }

  private meta(request: RequestContext): GatewayResponseMeta {
    const offline = MOCK_SCENARIOS[this.scenario].offline
    return {
      requestId: request.requestId,
      completedAt: this.now(),
      delayMs: request.delayMs,
      freshness: offline ? 'stale' : 'fresh',
      offline,
    }
  }

  private success<T>(data: T, request: RequestContext): GatewaySuccess<T> {
    return { ok: true, data, meta: this.meta(request) }
  }

  private failure<TProblem extends GatewayProblem>(
    problem: TProblem,
    request: RequestContext,
  ): GatewayFailure<TProblem> {
    return { ok: false, problem, meta: this.meta(request) }
  }

  private offlineProblem(requestId: string): OfflineProblem | null {
    if (!MOCK_SCENARIOS[this.scenario].offline) return null
    return {
      type: 'offline',
      code: 'OFFLINE_MUTATION_BLOCKED',
      messageKey: 'problem.offline.mutationBlocked',
      requestId,
      retryable: true,
    }
  }

  private notFound(
    resource: NotFoundProblem['resource'],
    resourceId: string,
    requestId: string,
  ): NotFoundProblem {
    return {
      type: 'not-found',
      code: 'RESOURCE_NOT_FOUND',
      messageKey: `problem.${resource}.notFound`,
      requestId,
      retryable: false,
      resource,
      resourceId,
    }
  }

  private providerUnavailable(
    providerKind: ProviderKind,
    providerConfigId: string,
    requestId: string,
  ): ProviderUnavailableProblem {
    return {
      type: 'provider-unavailable',
      code: 'PROVIDER_UNAVAILABLE',
      messageKey: 'problem.provider.unavailable',
      requestId,
      retryable: true,
      providerKind,
      providerConfigId,
    }
  }

  private validateCreateAssistant(
    input: CreateAssistantInput,
    requestId: string,
  ): ValidationProblem | null {
    const fieldProblems: FieldProblem[] = []
    const name = input.name.trim()
    if (name.length < 2 || name.length > 60) {
      fieldProblems.push({
        field: 'name',
        code: 'NAME_LENGTH',
        messageKey: 'validation.assistant.nameLength',
      })
    }
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.locale)) {
      fieldProblems.push({
        field: 'locale',
        code: 'LOCALE_INVALID',
        messageKey: 'validation.locale.invalid',
      })
    }
    return this.validationProblem(fieldProblems, requestId)
  }

  private validateRoleDraft(
    draft: RoleConfigDraft,
    requestId: string,
  ): ValidationProblem | null {
    const fieldProblems: FieldProblem[] = []
    if (!draft.basePrompt.trim()) {
      fieldProblems.push({
        field: 'basePrompt',
        code: 'REQUIRED',
        messageKey: 'validation.basePrompt.required',
      })
    }
    if (draft.speech.rate < 0.5 || draft.speech.rate > 2) {
      fieldProblems.push({
        field: 'speech.rate',
        code: 'OUT_OF_RANGE',
        messageKey: 'validation.speech.rateRange',
      })
    }
    if (draft.speech.pitch < -12 || draft.speech.pitch > 12) {
      fieldProblems.push({
        field: 'speech.pitch',
        code: 'OUT_OF_RANGE',
        messageKey: 'validation.speech.pitchRange',
      })
    }
    return this.validationProblem(fieldProblems, requestId)
  }

  private validateProviderSelection(
    input: UpdateProviderSelectionInput,
    requestId: string,
  ): ValidationProblem | null {
    const fieldProblems: FieldProblem[] = []
    if (!PROVIDER_KINDS.includes(input.kind)) {
      fieldProblems.push({
        field: 'kind',
        code: 'PROVIDER_KIND_INVALID',
        messageKey: 'validation.provider.kindInvalid',
      })
    }
    if (input.mode === 'selected' && !input.providerConfigId) {
      fieldProblems.push({
        field: 'providerConfigId',
        code: 'REQUIRED',
        messageKey: 'validation.provider.configRequired',
      })
    }
    if (input.mode === 'disabled' && REQUIRED_PROVIDER_KINDS.has(input.kind)) {
      fieldProblems.push({
        field: 'mode',
        code: 'PROVIDER_REQUIRED',
        messageKey: 'validation.provider.requiredKind',
      })
    }
    return this.validationProblem(fieldProblems, requestId)
  }

  private validationProblem(
    fieldProblems: FieldProblem[],
    requestId: string,
  ): ValidationProblem | null {
    if (fieldProblems.length === 0) return null
    return {
      type: 'validation',
      code: 'VALIDATION_ERROR',
      messageKey: 'problem.validation',
      requestId,
      retryable: false,
      fieldProblems,
    }
  }

  private workspaceConflict(
    workspace: Versioned<ModelMemoryWorkspace>,
    localDraft: UpdateProviderSelectionInput | { enabled: boolean },
    requestId: string,
  ): RevisionConflictProblem<
    ModelMemoryWorkspace,
    UpdateProviderSelectionInput | { enabled: boolean }
  > {
    return {
      type: 'revision-conflict',
      code: 'REVISION_CONFLICT',
      messageKey: 'problem.revision.conflict',
      requestId,
      retryable: false,
      currentRevision: workspace.revision,
      currentEtag: workspace.etag,
      current: clone(workspace.value),
      localDraft: clone(localDraft),
    }
  }

  private advanceWorkspace(workspace: Versioned<ModelMemoryWorkspace>): void {
    workspace.revision += 1
    workspace.etag = etag(`model-memory-${workspace.value.assistantId}`, workspace.revision)
  }

  private requireRoleFixture(assistantId: string): Versioned<RoleConfig> {
    const fixture = this.state.roleConfigs[assistantId]
    if (!fixture) throw new Error(`Missing deterministic role fixture: ${assistantId}`)
    return fixture
  }

  private requireModelMemoryFixture(
    assistantId: string,
  ): Versioned<ModelMemoryWorkspace> {
    const fixture = this.state.modelMemory[assistantId]
    if (!fixture) {
      throw new Error(`Missing deterministic model/memory fixture: ${assistantId}`)
    }
    return fixture
  }
}

export function createMockGatewayDependencies(
  options: MockGatewayOptions = {},
): GatewayDependencies {
  const gateway = new MockGateway(options)
  return {
    managerGateway: gateway,
    assistantGateway: gateway,
    providerGateway: gateway,
    deviceGateway: gateway,
    previewControlGateway: gateway,
  }
}
