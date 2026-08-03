export const PREVIEW_SCENARIO_IDS = [
  'happy',
  'offline',
  'revision-conflict',
  'provider-error',
  'long-action',
] as const

export type PreviewScenarioId = (typeof PREVIEW_SCENARIO_IDS)[number]

export interface PreviewScenarioDefinition {
  id: PreviewScenarioId
  labelKey: string
  descriptionKey: string
}
