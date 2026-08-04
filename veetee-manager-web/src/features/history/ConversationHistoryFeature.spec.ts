import { fireEvent, render, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantCard,
  ConversationDetail,
  GatewayFailure,
  GatewaySuccess,
  RetentionPolicy,
} from '@/domain'
import { managerGatewayKey, previewControlGatewayKey, type ManagerGateway, type PreviewControlGateway } from '@/gateways'
import { i18n } from '@/i18n'

import { HISTORY_CONVERSATIONS } from '@/mocks/fixtures/history'
import ConversationHistoryFeature from './ConversationHistoryFeature.vue'

const detail = Object.values(HISTORY_CONVERSATIONS)[0] as ConversationDetail
const assistant: AssistantCard = {
  id: detail.summary.assistantId,
  name: 'Mây',
  locale: 'vi-VN',
  voiceName: 'Minh Đức',
  personalityName: 'Người bạn đồng hành',
  onlineDeviceCount: 1,
  deviceCount: 1,
  lastConversationAt: detail.summary.endedAt,
  publishedRevision: detail.summary.configRevision,
  configurationState: 'published',
}
const retention: RetentionPolicy = detail.retention

function meta(offline = false) {
  return {
    requestId: 'request-history-test',
    completedAt: new Date(0).toISOString(),
    delayMs: 0,
    freshness: offline ? 'stale' as const : 'fresh' as const,
    offline,
  }
}

function success<T>(data: T, offline = false): GatewaySuccess<T> {
  return { ok: true, data, meta: meta(offline) }
}

function failure(offline = false): GatewayFailure<never> {
  return {
    ok: false,
    problem: {
      type: offline ? 'offline' : 'not-found',
      code: offline ? 'OFFLINE_MUTATION_BLOCKED' : 'RESOURCE_NOT_FOUND',
      messageKey: offline ? 'problem.offline.mutationBlocked' : 'problem.conversation.notFound',
      requestId: 'request-history-test',
      retryable: offline,
      ...(offline ? {} : { resource: 'conversation', resourceId: detail.summary.id }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    listConversations: vi.fn(async () => success({ items: [detail.summary], total: 1 })),
    getRetentionPolicy: vi.fn(async () => success(retention)),
    updateRetentionPolicy: vi.fn(async () => success(retention)),
    getConversation: vi.fn(async () => success(detail)),
    exportConversation: vi.fn(async () => success({
      exportVersion: 1,
      exportedAt: '2026-08-05T00:00:00.000Z',
      conversation: {
        summary: { id: detail.summary.id, assistantId: detail.summary.assistantId, startedAt: detail.summary.startedAt, endedAt: detail.summary.endedAt, locale: detail.summary.locale, configRevision: detail.summary.configRevision, status: detail.summary.status, turnCount: detail.summary.turnCount, lastTurnAt: detail.summary.lastTurnAt, aggregateTimings: detail.summary.aggregateTimings, retentionUntil: detail.summary.retentionUntil },
        turns: detail.turns,
        retention,
      },
    })),
    ...overrides,
  } as unknown as ManagerGateway
}

function renderFeature(managerGateway: ManagerGateway) {
  const previewControlGateway: PreviewControlGateway = {
    getScenario: () => 'happy',
    setScenario: () => undefined,
    listScenarios: () => [],
    resetDemo: async () => success({ assistantCount: 0, deviceCount: 0 }),
  }
  return render(ConversationHistoryFeature, {
    props: { assistant },
    global: {
      plugins: [i18n],
      provide: {
        [managerGatewayKey as symbol]: managerGateway,
        [previewControlGatewayKey as symbol]: previewControlGateway,
      },
    },
  })
}

function historyItem(view: ReturnType<typeof render>) {
  const item = view.container.querySelector('.history-item')
  if (!item) throw new Error('history item missing')
  return item as HTMLElement
}

afterEach(() => vi.restoreAllMocks())

describe('ConversationHistoryFeature list states', () => {
  it('shows a retryable list error instead of a false empty history', async () => {
    const view = renderFeature(gateway({ listConversations: vi.fn(async () => failure()) }))

    const heading = await view.findByRole('heading', { name: 'Không tải được lịch sử' })
    expect(view.getByText('Không tải được lịch sử hội thoại từ Manager API.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
  })

  it('blocks the history surface when retention policy cannot be read', async () => {
    const view = renderFeature(gateway({ getRetentionPolicy: vi.fn(async () => failure()) }))

    await view.findByRole('heading', { name: 'Không tải được lịch sử' })
    expect(view.getByText('Không tải được retention policy; lịch sử tạm thời bị khóa để tránh hiểu sai chính sách lưu trữ.')).toBeTruthy()
    expect(view.queryByText('Retention đang áp dụng')).toBeNull()
  })

  it('keeps valid empty history distinct from a failed read', async () => {
    const view = renderFeature(gateway({ listConversations: vi.fn(async () => success({ items: [], total: 0 })) }))

    expect(await view.findByText('Chưa có hội thoại', { selector: 'strong' })).toBeTruthy()
    const emptyState = view.container.querySelector('.vt-empty')
    expect(emptyState).not.toBeNull()
    expect(within(emptyState as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('marks a valid stale snapshot without presenting it as live data', async () => {
    const view = renderFeature(gateway({ getRetentionPolicy: vi.fn(async () => success(retention, true)) }))

    expect(await view.findByText('Dữ liệu ngoại tuyến')).toBeTruthy()
    expect(view.getByText(/snapshot retention\/lịch sử cũ/)).toBeTruthy()
    expect(view.getByRole('button', { name: 'Lưu retention policy' })).toBeTruthy()
  })

  it('retries a transient list failure and restores the history item', async () => {
    const listConversations = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success({ items: [detail.summary], total: 1 }))
    const view = renderFeature(gateway({ listConversations }))

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByText(/1 lượt · TTFA/)).toBeTruthy()
    expect(listConversations).toHaveBeenCalledTimes(2)
  })
})

describe('ConversationHistoryFeature detail states', () => {
  it('shows a retryable detail error and keeps the selected context', async () => {
    const view = renderFeature(gateway({ getConversation: vi.fn(async () => failure()) }))

    await view.findByText(/1 lượt · TTFA/)
    await fireEvent.click(historyItem(view))

    const detailHeading = await view.findByText('Chi tiết lượt nói', { selector: 'strong' })
    expect(await view.findByText('Không tải được chi tiết lượt nói từ Manager API.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại chi tiết' })).toBeTruthy()
    expect(document.activeElement).toBe(detailHeading)
  })

  it('retries a detail read and then renders transcript', async () => {
    const getConversation = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success(detail))
    const view = renderFeature(gateway({ getConversation }))

    await view.findByText(/1 lượt · TTFA/)
    await fireEvent.click(historyItem(view))
    await view.findByRole('button', { name: 'Thử lại chi tiết' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại chi tiết' }))

    expect(await view.findByText('Hôm nay thời tiết thế nào?')).toBeTruthy()
    expect(getConversation).toHaveBeenCalledTimes(2)
  })
})

describe('ConversationHistoryFeature retention mutation', () => {
  it('saves retention policy with the current ETag', async () => {
    const updateRetentionPolicy = vi.fn(async () => success({ ...retention, revision: 3, etag: '"retention-3"' }))
    const view = renderFeature(gateway({ updateRetentionPolicy }))

    await view.findByRole('button', { name: 'Lưu retention policy' })
    await fireEvent.click(view.getByRole('button', { name: 'Lưu retention policy' }))

    expect(updateRetentionPolicy).toHaveBeenCalledWith({ captureTranscript: true, transcriptDays: 30, captureAudio: false, audioDays: null }, retention.etag)
  })

  it('keeps the policy editor and reports an offline save failure', async () => {
    const updateRetentionPolicy = vi.fn(async () => failure(true))
    const view = renderFeature(gateway({ updateRetentionPolicy }))

    await view.findByRole('button', { name: 'Lưu retention policy' })
    await fireEvent.click(view.getByRole('button', { name: 'Lưu retention policy' }))

    expect((await view.findByRole('alert')).textContent).toContain('Đang ngoại tuyến; retention policy chưa được thay đổi.')
    expect(view.getByRole('heading', { name: 'Lưu trữ hội thoại' })).toBeTruthy()
  })
})

describe('ConversationHistoryFeature export', () => {
  it('keeps an export error local to the selected conversation', async () => {
    const view = renderFeature(gateway({ exportConversation: vi.fn(async () => failure()) }))

    await view.findByText(/1 lượt · TTFA/)
    await fireEvent.click(historyItem(view))
    await view.findByRole('button', { name: 'Tải JSON' })
    await fireEvent.click(view.getByRole('button', { name: 'Tải JSON' }))

    expect((await view.findByRole('alert')).textContent).toContain('Không tải được bản export')
    expect(view.getByText('Chi tiết lượt nói')).toBeTruthy()
  })
})
