import type { ConversationDetail } from '@/domain'

import { ASSISTANT_IDS } from './assistants'

export const HISTORY_CONVERSATIONS: Readonly<Record<string, ConversationDetail>> = {
  [ASSISTANT_IDS.may]: {
    summary: {
      id: '91111111-1111-4111-8111-111111111111',
      assistantId: ASSISTANT_IDS.may,
      deviceKey: 'device-preview-1',
      startedAt: '2026-08-03T08:40:00.000Z',
      endedAt: '2026-08-03T08:42:00.000Z',
      locale: 'vi-VN',
      configRevision: 7,
      status: 'completed',
      turnCount: 1,
      lastTurnAt: '2026-08-03T08:42:00.000Z',
      aggregateTimings: { last_ttfa_ms: 1180, last_llm_first_token_ms: 360 },
      retentionUntil: '2026-09-02T08:42:00.000Z',
    },
    turns: [{
      id: '92222222-2222-4222-8222-222222222222',
      conversationId: '91111111-1111-4111-8111-111111111111',
      turnId: 'turn-preview-1',
      sequence: 1,
      state: 'completed',
      startedAt: '2026-08-03T08:40:12.000Z',
      endedAt: '2026-08-03T08:42:00.000Z',
      finishReason: 'completed',
      timings: { asr_finalize_ms: 220, llm_first_token_ms: 360, ttfa_ms: 1180 },
      transcript: [
        { speaker: 'user', text: 'Hôm nay thời tiết thế nào?', locale: 'vi-VN', confidence: 0.98, startedAtMs: 0, endedAtMs: 900, isFinal: true },
        { speaker: 'assistant', text: 'Mình chưa có dữ liệu thời tiết trực tiếp trong bản xem trước.', locale: 'vi-VN', confidence: null, startedAtMs: 1180, endedAtMs: 4200, isFinal: true },
      ],
      toolCalls: [],
    }],
    retention: {
      ownerId: 'local-owner',
      captureTranscript: true,
      transcriptDays: 30,
      captureAudio: false,
      audioDays: null,
      effectiveAt: '1970-01-01T00:00:00.000Z',
      revision: 1,
      etag: '"baseline-transcript-30d-audio-off"',
    },
  },
}
