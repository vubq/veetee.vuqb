import type {
  AssistantCard,
  AssistantListQuery,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  ConversationDetail,
  ConversationExport,
  RetentionDeleteJob,
  ConversationSummary,
  GatewayResult,
  ModelMemoryWorkspace,
  NameConflictProblem,
  NotFoundProblem,
  OfflineProblem,
  Page,
  PairDeviceInput,
  PairingCodeProblem,
  PreviewScenarioDefinition,
  PreviewScenarioId,
  ProviderUnavailableProblem,
  RevisionConflictProblem,
  RoleConfig,
  RoleConfigDraft,
  RoleSaveProblem,
  SecretReference,
  UpdateProviderSelectionInput,
  ValidationProblem,
  Versioned,
  VoicePreview,
  VoiceProfile,
  ProviderConfigRecord,
  ProviderProbeResult,
  ProviderInstallationView,
  RetentionPolicy,
  RetentionPolicyInput,
  RetentionExpiredProblem,
} from '@/domain'

export type CreateAssistantProblem =
  | ValidationProblem
  | OfflineProblem
  | NameConflictProblem

export type PairDeviceProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | PairingCodeProblem

export type ProviderMutationProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | ProviderUnavailableProblem
  | RevisionConflictProblem<
      ModelMemoryWorkspace,
      UpdateProviderSelectionInput | { enabled: boolean }
    >

export type SecretMutationProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | RevisionConflictProblem<SecretReference, unknown>

export type RetentionMutationProblem =
  | ValidationProblem
  | OfflineProblem
  | RevisionConflictProblem<RetentionPolicy, RetentionPolicyInput>

export interface AssistantGateway {
  listAssistants(
    query?: AssistantListQuery,
  ): Promise<GatewayResult<Page<AssistantCard>, never>>

  createAssistant(
    input: CreateAssistantInput,
  ): Promise<GatewayResult<Versioned<AssistantCard>, CreateAssistantProblem>>

  getRoleConfig(
    assistantId: string,
  ): Promise<GatewayResult<Versioned<RoleConfig>, NotFoundProblem>>

  saveRoleConfig(
    assistantId: string,
    draft: RoleConfigDraft,
    expectedEtag: string,
  ): Promise<GatewayResult<Versioned<RoleConfig>, RoleSaveProblem>>

  publishAssistant(
    assistantId: string,
    expectedEtag: string,
  ): Promise<GatewayResult<{ revision: number }, RoleSaveProblem>>

  listProviderInstallations(): Promise<GatewayResult<ProviderInstallationView[], never>>
  listProviderConfigs(): Promise<GatewayResult<ProviderConfigRecord[], never>>
  createProviderConfig(input: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>>
  updateProviderConfig(id: string, input: { name?: string; config?: Record<string, unknown>; secretRefs?: string[] }, expectedEtag: string): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>>
  deleteProviderConfig(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>>
  probeProviderConfig(id: string): Promise<GatewayResult<ProviderProbeResult, ValidationProblem | NotFoundProblem | OfflineProblem>>

  listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>>

  previewVoice(
    voiceId: string,
    transcript: string,
  ): Promise<
    GatewayResult<
      VoicePreview,
      NotFoundProblem | OfflineProblem | ProviderUnavailableProblem
    >
  >
}

export interface ProviderGateway {
  getModelMemory(
    assistantId: string,
  ): Promise<GatewayResult<Versioned<ModelMemoryWorkspace>, NotFoundProblem>>

  updateProviderSelection(
    assistantId: string,
    input: UpdateProviderSelectionInput,
    expectedEtag: string,
  ): Promise<
    GatewayResult<Versioned<ModelMemoryWorkspace>, ProviderMutationProblem>
  >

  setMemoryEnabled(
    assistantId: string,
    enabled: boolean,
    expectedEtag: string,
  ): Promise<
    GatewayResult<Versioned<ModelMemoryWorkspace>, ProviderMutationProblem>
  >
}

export interface SecretGateway {
  listSecretReferences(): Promise<GatewayResult<SecretReference[], never>>
  createSecretReference(input: { name: string; secretValue: string; locator?: string }): Promise<GatewayResult<SecretReference, ValidationProblem | OfflineProblem>>
  updateSecretReference(id: string, input: { name?: string; locator?: string; secretValue?: string }, expectedEtag: string): Promise<GatewayResult<SecretReference, SecretMutationProblem>>
  deleteSecretReference(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<unknown, unknown>>>
}

export interface DeviceGateway {
  listDevices(
    assistantId: string,
  ): Promise<GatewayResult<Page<DeviceCard>, NotFoundProblem>>

  pairDevice(
    input: PairDeviceInput,
  ): Promise<GatewayResult<DeviceCard, PairDeviceProblem>>

  unlinkDevice(
    deviceId: string,
    expectedEtag: string,
  ): Promise<GatewayResult<void, NotFoundProblem | OfflineProblem | RevisionConflictProblem<unknown, unknown>>>
}

export interface HistoryGateway {
  getRetentionPolicy(): Promise<GatewayResult<RetentionPolicy, never>>
  updateRetentionPolicy(
    input: RetentionPolicyInput,
    expectedEtag: string,
  ): Promise<GatewayResult<RetentionPolicy, RetentionMutationProblem>>
  listConversations(assistantId: string, limit?: number): Promise<GatewayResult<Page<ConversationSummary>, NotFoundProblem>>
  getConversation(id: string): Promise<GatewayResult<ConversationDetail, NotFoundProblem | RetentionExpiredProblem>>
  exportConversation(id: string): Promise<GatewayResult<ConversationExport, NotFoundProblem | RetentionExpiredProblem | OfflineProblem>>
  deleteConversation(id: string): Promise<GatewayResult<RetentionDeleteJob, NotFoundProblem | RetentionExpiredProblem | OfflineProblem>>
  getRetentionDeleteJob(id: string): Promise<GatewayResult<RetentionDeleteJob, NotFoundProblem | OfflineProblem>>
}

export interface ManagerGateway
  extends AssistantGateway,
    ProviderGateway,
    SecretGateway,
    DeviceGateway,
    HistoryGateway {}

export interface PreviewControlGateway {
  getScenario(): PreviewScenarioId
  setScenario(scenario: PreviewScenarioId): void
  listScenarios(): readonly PreviewScenarioDefinition[]
  resetDemo(): Promise<GatewayResult<DemoResetSummary, never>>
}

export interface GatewayDependencies {
  managerGateway: ManagerGateway
  assistantGateway: AssistantGateway
  providerGateway: ProviderGateway
  deviceGateway: DeviceGateway
  previewControlGateway: PreviewControlGateway
}
