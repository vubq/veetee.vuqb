import type {
  AssistantCard,
  AssistantListQuery,
  CreateAssistantInput,
  DemoResetSummary,
  DeviceCard,
  DiscoverableDevice,
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
  VoiceProfileInput,
  ProviderConfigRecord,
  ProviderProbeResult,
  ProviderInstallationView,
  ProviderKind,
  ModelConfigPage,
  ModelConfigRecord,
  ModelProviderRecord,
  ModelType,
  ModelProviderField,
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

export type ModelControlProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | RevisionConflictProblem<ModelConfigRecord | ModelProviderRecord, unknown>

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
  listProviderConfigs(kind?: ProviderKind): Promise<GatewayResult<ProviderConfigRecord[], never>>
  createProviderConfig(input: { installationId: string; name: string; config: Record<string, unknown>; secretRefs?: string[] }): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem>>
  updateProviderConfig(id: string, input: { name?: string; config?: Record<string, unknown>; secretRefs?: string[] }, expectedEtag: string): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>>
  setProviderConfigEnabled(id: string, enabled: boolean, expectedEtag: string): Promise<GatewayResult<ProviderConfigRecord, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>>
  deleteProviderConfig(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<ProviderConfigRecord, unknown>>>
  probeProviderConfig(id: string): Promise<GatewayResult<ProviderProbeResult, ValidationProblem | NotFoundProblem | OfflineProblem>>

  listVoices(locale: string): Promise<GatewayResult<Page<VoiceProfile>, never>>
  createVoiceProfile(input: VoiceProfileInput): Promise<GatewayResult<VoiceProfile, ValidationProblem | OfflineProblem>>
  updateVoiceProfile(id: string, input: Partial<VoiceProfileInput>, expectedEtag: string): Promise<GatewayResult<VoiceProfile, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<VoiceProfile, unknown>>>
  deleteVoiceProfile(id: string, expectedEtag: string): Promise<GatewayResult<void, ValidationProblem | NotFoundProblem | OfflineProblem | RevisionConflictProblem<VoiceProfile, unknown>>>

  previewVoice(
    voiceId: string,
    transcript: string,
  ): Promise<
    GatewayResult<
      VoicePreview,
      NotFoundProblem | OfflineProblem | ProviderUnavailableProblem
    >
  >

  listModelProviders(query?: { modelType?: ModelType; name?: string }): Promise<GatewayResult<ModelProviderRecord[], ModelControlProblem>>
  createModelProvider(input: { modelType: ModelType; providerCode: string; name: string; fields: ModelProviderField[]; sort?: number }): Promise<GatewayResult<ModelProviderRecord, ModelControlProblem>>
  updateModelProvider(id: string, input: Partial<{ modelType: ModelType; providerCode: string; name: string; fields: ModelProviderField[]; sort: number }>, expectedEtag?: string): Promise<GatewayResult<ModelProviderRecord, ModelControlProblem>>
  deleteModelProvider(id: string, expectedEtag?: string): Promise<GatewayResult<void, ModelControlProblem>>
  listModelConfigs(query?: { modelType?: ModelType; modelName?: string; page?: number; limit?: number }): Promise<GatewayResult<ModelConfigPage, ModelControlProblem>>
  getModelConfig(id: string): Promise<GatewayResult<ModelConfigRecord, ModelControlProblem>>
  createModelConfig(input: { modelType: ModelType; providerCode: string; id?: string; modelCode: string; modelName: string; isDefault?: boolean; isEnabled?: boolean; configJson: Record<string, unknown>; docLink?: string | null; remark?: string | null; sort?: number }): Promise<GatewayResult<ModelConfigRecord, ModelControlProblem>>
  updateModelConfig(id: string, input: Partial<{ modelType: ModelType; providerCode: string; modelCode: string; modelName: string; isDefault: boolean; isEnabled: boolean; configJson: Record<string, unknown>; docLink: string | null; remark: string | null; sort: number }>, expectedEtag?: string): Promise<GatewayResult<ModelConfigRecord, ModelControlProblem>>
  deleteModelConfig(id: string, expectedEtag?: string): Promise<GatewayResult<void, ModelControlProblem>>
  setModelEnabled(id: string, enabled: boolean): Promise<GatewayResult<ModelConfigRecord, ModelControlProblem>>
  setDefaultModel(id: string): Promise<GatewayResult<ModelConfigRecord, ModelControlProblem>>
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

  listDiscoverableDevices(): Promise<GatewayResult<Page<DiscoverableDevice>, OfflineProblem>>

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
