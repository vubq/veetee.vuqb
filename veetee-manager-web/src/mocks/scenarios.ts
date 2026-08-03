import type { PreviewScenarioDefinition, PreviewScenarioId } from '@/domain'

export interface MockScenarioPreset extends PreviewScenarioDefinition {
  readDelayMs: number
  mutationDelayMs: number
  offline: boolean
  forceRoleConflict: boolean
  unavailableProviderKind: 'llm' | null
}

export const MOCK_SCENARIOS: Readonly<
  Record<PreviewScenarioId, MockScenarioPreset>
> = {
  happy: {
    id: 'happy',
    labelKey: 'preview.scenario.happy.label',
    descriptionKey: 'preview.scenario.happy.description',
    readDelayMs: 24,
    mutationDelayMs: 80,
    offline: false,
    forceRoleConflict: false,
    unavailableProviderKind: null,
  },
  offline: {
    id: 'offline',
    labelKey: 'preview.scenario.offline.label',
    descriptionKey: 'preview.scenario.offline.description',
    readDelayMs: 24,
    mutationDelayMs: 40,
    offline: true,
    forceRoleConflict: false,
    unavailableProviderKind: null,
  },
  'revision-conflict': {
    id: 'revision-conflict',
    labelKey: 'preview.scenario.revisionConflict.label',
    descriptionKey: 'preview.scenario.revisionConflict.description',
    readDelayMs: 24,
    mutationDelayMs: 100,
    offline: false,
    forceRoleConflict: true,
    unavailableProviderKind: null,
  },
  'provider-error': {
    id: 'provider-error',
    labelKey: 'preview.scenario.providerError.label',
    descriptionKey: 'preview.scenario.providerError.description',
    readDelayMs: 30,
    mutationDelayMs: 100,
    offline: false,
    forceRoleConflict: false,
    unavailableProviderKind: 'llm',
  },
  'long-action': {
    id: 'long-action',
    labelKey: 'preview.scenario.longAction.label',
    descriptionKey: 'preview.scenario.longAction.description',
    readDelayMs: 120,
    mutationDelayMs: 1_400,
    offline: false,
    forceRoleConflict: false,
    unavailableProviderKind: null,
  },
}

export const MOCK_SCENARIO_LIST: readonly PreviewScenarioDefinition[] =
  Object.values(MOCK_SCENARIOS).map(({ id, labelKey, descriptionKey }) => ({
    id,
    labelKey,
    descriptionKey,
  }))
