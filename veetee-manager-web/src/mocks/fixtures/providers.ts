import type {
  ModelMemoryWorkspace,
  ProviderConfigSummary,
  ProviderConfigRecord,
  ProviderInstallationView,
  ProviderKind,
  ProviderSelection,
  Versioned,
} from '@/domain'

import { ASSISTANT_IDS } from './assistants'

export const PROVIDER_CONFIG_IDS: Record<ProviderKind, string> = {
  vad: '51111111-1111-4111-8111-111111111111',
  asr: '52222222-2222-4222-8222-222222222222',
  llm: '53333333-3333-4333-8333-333333333333',
  tts: '54444444-4444-4444-8444-444444444444',
  intent: '55555555-5555-4555-8555-555555555555',
  memory: '56666666-6666-4666-8666-666666666666',
}

export const PROVIDER_INSTALLATION_IDS = {
  groq: 'preview.provider.groq',
  vieneu: 'preview.provider.vieneu',
} as const

export function createProviderRegistryFixtures(): {
  installations: ProviderInstallationView[]
  configs: ProviderConfigRecord[]
} {
  const groq: ProviderInstallationView = {
    id: PROVIDER_INSTALLATION_IDS.groq,
    kind: 'llm',
    displayNameKey: 'Groq streaming (preview)',
    displayName: 'Groq — trả lời nhanh',
    version: '1.0.0',
    manifest: { locales: ['*'], supportsStreaming: true, supportsTools: true, secretFields: ['apiKey'] },
    providerFamily: 'openai-compatible',
    protocol: 'chat-completions',
    supportedLocales: ['*'],
    capabilities: ['streaming', 'tools'],
    configSchema: {
      type: 'object',
      required: ['endpoint', 'model', 'maxTokens'],
      properties: {
        endpoint: { type: 'string', format: 'uri' },
        model: { type: 'string', minLength: 1 },
        maxTokens: { type: 'integer', minimum: 1, maximum: 32768 },
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        supportsTools: { type: 'boolean' },
        toolPolicy: { type: 'object' },
      },
    },
  }
  const vieneu: ProviderInstallationView = {
    id: PROVIDER_INSTALLATION_IDS.vieneu,
    kind: 'tts',
    displayNameKey: 'VieNeu streaming (preview)',
    displayName: 'VieNeu — giọng nói tiếng Việt',
    version: '1.0.0',
    manifest: { locales: ['vi-VN'], supportsStreaming: true, supportsCancel: true },
    providerFamily: 'vieneu',
    protocol: undefined,
    supportedLocales: ['vi-VN'],
    capabilities: ['streaming', 'cancel'],
    hasVoiceCatalog: true,
    configSchema: {
      type: 'object',
      required: ['backboneRepo', 'sampleRate'],
      properties: {
        backboneRepo: { type: 'string', minLength: 1 },
        sampleRate: { type: 'integer', minimum: 1, maximum: 48000 },
        backend: { type: 'string', enum: ['onnx', 'auto'] },
        precision: { type: 'string', enum: ['int8', 'fp32'] },
        prewarm: { type: 'boolean' },
      },
    },
  }
  return {
    installations: [groq, vieneu],
    configs: [{
      id: 'preview-config-groq',
      installationId: groq.id,
      name: 'Groq test config',
      revision: 1,
      config: {
        endpoint: 'https://api.groq.com/openai/v1',
        model: 'llama-3.3-70b-versatile',
        maxTokens: 512,
        temperature: 0.2,
        supportsTools: true,
        toolPolicy: { mode: 'allow-listed' },
      },
      secretRefs: [],
      etag: '"preview-provider-groq-1"',
    }],
  }
}

function createProviderConfigs(): ProviderConfigSummary[] {
  return [
    {
      id: PROVIDER_CONFIG_IDS.vad,
      kind: 'vad',
      name: 'Phát hiện giọng nói cục bộ',
      providerName: 'Silero VAD',
      availability: 'ready',
      supportedLocales: ['*'],
    },
    {
      id: PROVIDER_CONFIG_IDS.asr,
      kind: 'asr',
      name: 'Nhận dạng tiếng Việt',
      providerName: 'PhoWhisper',
      availability: 'ready',
      supportedLocales: ['vi-VN'],
    },
    {
      id: PROVIDER_CONFIG_IDS.llm,
      kind: 'llm',
      name: 'Suy luận chính',
      providerName: 'Groq',
      availability: 'ready',
      supportedLocales: ['vi-VN', 'en-US'],
    },
    {
      id: PROVIDER_CONFIG_IDS.tts,
      kind: 'tts',
      name: 'Tổng hợp tiếng Việt',
      providerName: 'VieNeu',
      availability: 'ready',
      supportedLocales: ['vi-VN'],
    },
    {
      id: PROVIDER_CONFIG_IDS.intent,
      kind: 'intent',
      name: 'Ý định theo quy tắc',
      providerName: 'Veetee',
      availability: 'ready',
      supportedLocales: ['vi-VN'],
    },
    {
      id: PROVIDER_CONFIG_IDS.memory,
      kind: 'memory',
      name: 'Bộ nhớ cục bộ',
      providerName: 'Veetee',
      availability: 'ready',
      supportedLocales: ['*'],
    },
  ]
}

function createSelections(): ProviderSelection[] {
  return [
    { kind: 'vad', mode: 'selected', providerConfigId: PROVIDER_CONFIG_IDS.vad },
    { kind: 'asr', mode: 'selected', providerConfigId: PROVIDER_CONFIG_IDS.asr },
    { kind: 'llm', mode: 'selected', providerConfigId: PROVIDER_CONFIG_IDS.llm },
    { kind: 'tts', mode: 'selected', providerConfigId: PROVIDER_CONFIG_IDS.tts },
    { kind: 'intent', mode: 'disabled' },
    {
      kind: 'memory',
      mode: 'selected',
      providerConfigId: PROVIDER_CONFIG_IDS.memory,
    },
  ]
}

export function createModelMemoryFixtures(): Record<
  string,
  Versioned<ModelMemoryWorkspace>
> {
  const configs = createProviderConfigs()

  return {
    [ASSISTANT_IDS.may]: {
      value: {
        assistantId: ASSISTANT_IDS.may,
        selections: createSelections(),
        availableConfigs: configs,
        memory: { enabled: true, itemCount: 2 },
        memoryItems: [
          {
            id: '61111111-1111-4111-8111-111111111111',
            kind: 'preference',
            content: 'Ưu tiên câu trả lời bằng tiếng Việt, có dấu đầy đủ.',
            enabled: true,
            updatedAt: '2026-08-03T07:30:00.000Z',
          },
          {
            id: '62222222-2222-4222-8222-222222222222',
            kind: 'fact',
            content: 'Tên gọi thân mật của người dùng là Khoa.',
            enabled: false,
            updatedAt: '2026-08-02T09:20:00.000Z',
          },
        ],
      },
      revision: 7,
      etag: '"model-memory-may-rev-7"',
    },
    [ASSISTANT_IDS.binhMinh]: {
      value: {
        assistantId: ASSISTANT_IDS.binhMinh,
        selections: createSelections(),
        availableConfigs: createProviderConfigs(),
        memory: { enabled: false, itemCount: 0 },
        memoryItems: [],
      },
      revision: 2,
      etag: '"model-memory-binh-minh-rev-2"',
    },
  }
}
