import type { ProviderKind, RoleConfig, RoleConfigDraft } from './entities'

export interface FieldProblem {
  field: string
  code: string
  messageKey: string
}

interface ProblemBase {
  code: string
  messageKey: string
  requestId: string
  retryable: boolean
}

export interface ValidationProblem extends ProblemBase {
  type: 'validation'
  code: 'VALIDATION_ERROR'
  fieldProblems: FieldProblem[]
}

export interface OfflineProblem extends ProblemBase {
  type: 'offline'
  code: 'OFFLINE_MUTATION_BLOCKED'
  retryable: true
}

export interface NotFoundProblem extends ProblemBase {
  type: 'not-found'
  code: 'RESOURCE_NOT_FOUND'
  retryable: false
  resource: 'assistant' | 'device' | 'voice' | 'provider-config' | 'conversation' | 'secret'
  resourceId: string
}

export interface RetentionExpiredProblem extends ProblemBase {
  type: 'retention-expired'
  code: 'RETENTION_EXPIRED'
  retryable: false
  resource: 'conversation'
  resourceId: string
}

export interface NameConflictProblem extends ProblemBase {
  type: 'name-conflict'
  code: 'NAME_CONFLICT'
  retryable: false
  fieldProblems: FieldProblem[]
}

export interface PairingCodeProblem extends ProblemBase {
  type: 'pairing-code'
  code: 'PAIRING_CODE_INVALID'
  retryable: false
  fieldProblems: FieldProblem[]
}

export interface ProviderUnavailableProblem extends ProblemBase {
  type: 'provider-unavailable'
  code: 'PROVIDER_UNAVAILABLE'
  retryable: true
  providerKind: ProviderKind
  providerConfigId: string
}

export interface RevisionConflictProblem<TCurrent, TLocal> extends ProblemBase {
  type: 'revision-conflict'
  code: 'REVISION_CONFLICT'
  retryable: false
  currentRevision: number
  currentEtag: string
  current: TCurrent
  localDraft: TLocal
}

export type CommonGatewayProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | RetentionExpiredProblem
  | NameConflictProblem
  | PairingCodeProblem
  | ProviderUnavailableProblem

export type RoleSaveProblem =
  | ValidationProblem
  | OfflineProblem
  | NotFoundProblem
  | RevisionConflictProblem<RoleConfig, RoleConfigDraft>

export type GatewayProblem =
  | CommonGatewayProblem
  | RevisionConflictProblem<unknown, unknown>

export interface GatewayResponseMeta {
  requestId: string
  completedAt: string
  delayMs: number
  freshness: 'fresh' | 'stale'
  offline: boolean
}

export interface GatewaySuccess<T> {
  ok: true
  data: T
  meta: GatewayResponseMeta
}

export interface GatewayFailure<TProblem extends GatewayProblem = GatewayProblem> {
  ok: false
  problem: TProblem
  meta: GatewayResponseMeta
}

export type GatewayResult<
  T,
  TProblem extends GatewayProblem = GatewayProblem,
> = GatewaySuccess<T> | GatewayFailure<TProblem>
