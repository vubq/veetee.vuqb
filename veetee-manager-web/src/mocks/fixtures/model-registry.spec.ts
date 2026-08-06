import { describe, expect, it } from 'vitest'

import { createModelRegistryFixtures } from './model-registry'
import previewRegistrySeed from './model-registry.seed.json'
import apiRegistrySeed from '../../../../veetee-manager-api/config/model-registry.json'

describe('source-aligned model registry preview', () => {
  it('keeps the tested Vietnamese stack as the default selection', () => {
    const registry = createModelRegistryFixtures()
    const defaults = new Map(registry.configs.filter((item) => item.isDefault).map((item) => [item.modelType, item]))

    expect(registry.providers).toHaveLength(63)
    expect(registry.configs).toHaveLength(67)
    expect(defaults.get('ASR')).toMatchObject({ id: 'ASR_PhoWhisper', modelCode: 'PhoWhisper-small', providerCode: 'phowhisper', isEnabled: true })
    expect(defaults.get('LLM')).toMatchObject({ id: 'LLM_Groq', modelCode: 'llama-3.3-70b-versatile', providerCode: 'groq', isEnabled: true })
    expect(defaults.get('TTS')).toMatchObject({ id: 'TTS_VieNeu', modelCode: 'VieNeu-v3-turbo', providerCode: 'vieneu', isEnabled: true })
  })

  it('does not let the preview catalog drift from the API seed', () => {
    expect(previewRegistrySeed).toEqual(apiRegistrySeed)
  })
})
