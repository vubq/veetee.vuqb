import { describe, expect, it } from 'vitest'

import type { ProviderInstallationView } from '@/domain'

import { normalizeProviderDraft, providerEditorProfile } from './provider-editor'

const groq: ProviderInstallationView = {
  id: 'groq.chat',
  kind: 'llm',
  displayNameKey: 'Groq',
  displayName: 'Groq',
  version: '1.0.0',
  manifest: { providerFamily: 'openai-compatible' },
  configSchema: {},
  providerFamily: 'openai-compatible',
  protocol: 'chat-completions',
  supportedLocales: ['*'],
  capabilities: ['streaming', 'tools'],
}

describe('provider editor adapters', () => {
  it('normalizes the legacy endpoint field to the shared Base URL contract', () => {
    expect(normalizeProviderDraft(groq, { endpoint: 'https://api.groq.com/openai/v1', model: 'fixture' })).toEqual({
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'fixture',
    })
  })

  it('exposes a typed family profile without hardcoding a vendor editor', () => {
    const profile = providerEditorProfile(groq)
    expect(profile.familyLabel).toBe('OpenAI-compatible')
    expect(profile.standardFields).toContain('Base URL')
    expect(profile.summary).toContain('Groq')
  })
})
