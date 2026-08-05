import type { ProviderInstallationView, ProviderKind } from '@/domain'

export interface ProviderEditorProfile {
  family: string
  familyLabel: string
  protocolLabel: string
  summary: string
  standardFields: string[]
  hasVoiceCatalog: boolean
}

const capabilityLabels: Record<ProviderKind, string> = {
  vad: 'VAD · phát hiện giọng nói',
  asr: 'ASR · nhận dạng lời nói',
  llm: 'LLM · suy luận và tool calling',
  tts: 'TTS · tổng hợp giọng nói',
  intent: 'Intent · hiểu ý định',
  memory: 'Memory · ngữ cảnh hội thoại',
}

export function providerEditorProfile(installation: ProviderInstallationView): ProviderEditorProfile {
  const family = installation.providerFamily ?? 'schema-driven'
  const protocol = installation.protocol ?? 'provider contract'
  const hasVoiceCatalog = installation.hasVoiceCatalog === true
  if (family === 'openai-compatible') {
    return {
      family,
      familyLabel: 'OpenAI-compatible',
      protocolLabel: protocol === 'chat-completions' ? 'Chat Completions · streaming' : protocol,
      summary: 'Dùng hợp đồng chung của OpenAI. Chỉ cần đổi Base URL, Model và chọn secret reference; Groq là preset của family này.',
      standardFields: ['Base URL', 'Model', 'Sampling / limits', 'Headers / options'],
      hasVoiceCatalog,
    }
  }
  if (family === 'vieneu') {
    return {
      family,
      familyLabel: 'VieNeu TTS',
      protocolLabel: protocol === 'provider contract' ? 'Streaming TTS' : protocol,
      summary: 'Cấu hình model local, backend và precision cho streaming tiếng Việt. Voice profile được quản lý ở thư viện riêng.',
      standardFields: ['Model artifact', 'Backend / precision', 'Sample rate', 'Runtime limits'],
      hasVoiceCatalog: true,
    }
  }
  return {
    family,
    familyLabel: family === 'schema-driven' ? 'Provider theo manifest' : family,
    protocolLabel: protocol,
    summary: `${capabilityLabels[installation.kind]} được mô tả bằng manifest và JSON Schema; provider mới không cần sửa UI lõi.`,
    standardFields: ['Schema fields', 'Locale', 'Runtime options'],
    hasVoiceCatalog,
  }
}

/** Keep legacy provider revisions readable while making new drafts canonical. */
export function normalizeProviderDraft(installation: ProviderInstallationView, value: Record<string, unknown>): Record<string, unknown> {
  /* Configs are JSON values and may be Vue reactive proxies at this boundary;
     JSON cloning keeps the adapter independent from the renderer runtime. */
  const next = JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  if (installation.providerFamily === 'openai-compatible') {
    if (typeof next.baseUrl !== 'string' && typeof next.endpoint === 'string') next.baseUrl = next.endpoint
    if ('endpoint' in next) delete next.endpoint
  }
  return next
}

export function displayCapability(kind: ProviderKind): string {
  return capabilityLabels[kind]
}
