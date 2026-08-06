import { describe, expect, it } from 'vitest'

import type { ModelConfigRecord, ModelProviderField, ModelProviderRecord } from '@/domain'

import { containsCjk, localizedFieldLabel, localizedModelName, localizedProviderName } from './model-registry-labels'

describe('Vietnamese model registry presentation', () => {
  it('localizes historical CJK names without changing identifiers', () => {
    const provider: ModelProviderRecord = {
      id: 'SYSTEM_ASR_doubao', ownerId: 'local-owner', modelType: 'ASR', providerCode: 'doubao', name: '火山引擎语音识别', fields: [], sort: 1, revision: 1, etag: 'etag', updatedAt: 'now',
    }
    const model: ModelConfigRecord = {
      id: 'ASR_DoubaoASR', ownerId: 'local-owner', modelType: 'ASR', providerCode: 'doubao', modelCode: 'DoubaoASR', modelName: '豆包语音识别', isDefault: false, isEnabled: true, configJson: {}, docLink: null, remark: null, sort: 1, revision: 1, etag: 'etag', updatedAt: 'now',
    }

    expect(containsCjk(localizedProviderName(provider))).toBe(false)
    expect(containsCjk(localizedModelName(model))).toBe(false)
    expect(localizedModelName(model)).toContain('Doubao')
  })

  it('uses Vietnamese labels for schema fields while preserving keys', () => {
    const field: ModelProviderField = { key: 'base_url', label: '基础URL', type: 'string' }
    expect(localizedFieldLabel(field)).toBe('URL cơ sở')
    expect(field.key).toBe('base_url')
  })

  it('keeps the provider wire model field distinct from the catalog model name', () => {
    expect(localizedFieldLabel({ key: 'model_name', label: 'Model name' })).toBe('Model gửi tới provider')
    expect(localizedFieldLabel({ key: 'model', label: 'Model' })).toBe('Model')
  })
})
