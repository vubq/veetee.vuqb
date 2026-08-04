import type { AssistantCard, RoleConfig, Versioned, VoiceProfile } from '@/domain'

export const ASSISTANT_IDS = {
  may: '11111111-1111-4111-8111-111111111111',
  binhMinh: '22222222-2222-4222-8222-222222222222',
} as const

export const VOICE_IDS = {
  anNhien: '31111111-1111-4111-8111-111111111111',
  minhChau: '32222222-2222-4222-8222-222222222222',
} as const

export const PERSONALITY_IDS = {
  companion: '41111111-1111-4111-8111-111111111111',
  focused: '42222222-2222-4222-8222-222222222222',
} as const

export function createAssistantCardFixtures(): Record<
  string,
  Versioned<AssistantCard>
> {
  return {
    [ASSISTANT_IDS.may]: {
      value: {
        id: ASSISTANT_IDS.may,
        name: 'Mây',
        locale: 'vi-VN',
        voiceName: 'An Nhiên',
        personalityName: 'Người bạn đồng hành',
        onlineDeviceCount: 1,
        deviceCount: 2,
        lastConversationAt: '2026-08-03T08:42:00.000Z',
        publishedRevision: 7,
        configurationState: 'published',
      },
      revision: 7,
      etag: '"assistant-may-rev-7"',
    },
    [ASSISTANT_IDS.binhMinh]: {
      value: {
        id: ASSISTANT_IDS.binhMinh,
        name: 'Bình Minh',
        locale: 'vi-VN',
        voiceName: 'Minh Châu',
        personalityName: 'Trợ lý tập trung',
        onlineDeviceCount: 0,
        deviceCount: 0,
        lastConversationAt: '2026-08-02T14:15:00.000Z',
        publishedRevision: null,
        configurationState: 'draft',
      },
      revision: 2,
      etag: '"assistant-binh-minh-rev-2"',
    },
  }
}

export function createRoleConfigFixtures(): Record<
  string,
  Versioned<RoleConfig>
> {
  return {
    [ASSISTANT_IDS.may]: {
      value: {
        assistantId: ASSISTANT_IDS.may,
        locale: 'vi-VN',
        basePrompt:
          'Bạn là Mây, một trợ lý tiếng Việt điềm tĩnh, rõ ràng và luôn hỏi lại khi yêu cầu chưa đủ thông tin.',
        personalityId: PERSONALITY_IDS.companion,
        personalityName: 'Người bạn đồng hành',
        speech: {
          voiceId: VOICE_IDS.anNhien,
          rate: 1,
          pitch: 0,
          style: 'natural',
        },
        admission: {
          maxActiveTurns: 1,
          retryAfterMs: 250,
        },
        autoTurn: {
          enabled: false,
          noSpeechTimeoutMs: 5000,
          noSpeechAlert: { status: 'warning', message: '', emotion: 'neutral' },
        },
        progress: { enabled: true, acknowledgementId: 'processing', deadlineMs: 900 },
        segmentation: { minimumCharacters: 2, maximumCharacters: 120 },
        bargeIn: { minSpeechFrames: 2 },
        toolPolicy: { maxRounds: 2, timeoutMs: 5000 },
        tools: [{ name: 'device.led.set', description: 'Set the RGB LED.' }],
      },
      revision: 7,
      etag: '"role-may-rev-7"',
    },
    [ASSISTANT_IDS.binhMinh]: {
      value: {
        assistantId: ASSISTANT_IDS.binhMinh,
        locale: 'vi-VN',
        basePrompt:
          'Bạn là Bình Minh, trợ lý giúp sắp xếp công việc theo thứ tự ưu tiên và trả lời ngắn gọn.',
        personalityId: PERSONALITY_IDS.focused,
        personalityName: 'Trợ lý tập trung',
        speech: {
          voiceId: VOICE_IDS.minhChau,
          rate: 1.05,
          pitch: -1,
          style: 'concise',
        },
        admission: {
          maxActiveTurns: 1,
          retryAfterMs: 250,
        },
        autoTurn: {
          enabled: false,
          noSpeechTimeoutMs: 5000,
          noSpeechAlert: { status: 'warning', message: '', emotion: 'neutral' },
        },
      },
      revision: 2,
      etag: '"role-binh-minh-rev-2"',
    },
  }
}

export function createVoiceFixtures(): VoiceProfile[] {
  return [
    {
      id: VOICE_IDS.anNhien,
      name: 'An Nhiên',
      providerName: 'VieNeu',
      locale: 'vi-VN',
      description: 'Giọng nữ miền Bắc, nhịp tự nhiên và dấu tiếng Việt rõ.',
      previewDurationMs: 2_900,
      available: true,
    },
    {
      id: VOICE_IDS.minhChau,
      name: 'Minh Châu',
      providerName: 'VieNeu',
      locale: 'vi-VN',
      description: 'Giọng trung tính, phù hợp câu trả lời kỹ thuật ngắn.',
      previewDurationMs: 2_600,
      available: true,
    },
  ]
}
