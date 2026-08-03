import type { operations } from './generated'

type JsonBody<Operation extends keyof operations> = NonNullable<operations[Operation]['requestBody']>['content']['application/json']

export type CreateAssistantRequest = JsonBody<'postApiV1Assistants'>
export type RoleConfigRequest = JsonBody<'patchApiV1AssistantsByIdRoleConfig'>
export type ProviderConfigRequest = JsonBody<'postApiV1ProviderConfigs'>
export type ProviderConfigPatchRequest = JsonBody<'patchApiV1ProviderConfigsById'>
export type ProviderSelectionRequest = JsonBody<'patchApiV1AssistantsByIdModelMemoryProvider'>
export type MemoryEnabledRequest = JsonBody<'patchApiV1AssistantsByIdModelMemoryMemory'>

/** Public type boundary: feature code consumes generated OpenAPI request shapes. */
export type ManagerApiOperations = operations
