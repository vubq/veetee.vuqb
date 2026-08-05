import { fireEvent, render, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GatewayFailure, GatewaySuccess } from '@/domain'
import { managerGatewayKey, previewControlGatewayKey, type ManagerGateway, type PreviewControlGateway } from '@/gateways'
import { i18n } from '@/i18n'
import { createAssistantCardFixtures } from '@/mocks/fixtures/assistants'

import AssistantIndexFeature from './AssistantIndexFeature.vue'

const assistants = Object.values(createAssistantCardFixtures()).map(({ value }) => value)

function meta(offline = false) {
  return {
    requestId: 'request-assistant-index-test',
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
      type: offline ? 'offline' : 'validation',
      code: offline ? 'OFFLINE_MUTATION_BLOCKED' : 'VALIDATION_ERROR',
      messageKey: offline ? 'problem.offline.mutationBlocked' : 'problem.request.failed',
      requestId: 'request-assistant-index-test',
      retryable: offline,
      ...(offline ? {} : { fieldProblems: [] }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    listAssistants: vi.fn(async () => success({ items: assistants, total: assistants.length })),
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
  return render(AssistantIndexFeature, {
    global: {
      plugins: [i18n],
      provide: {
        [managerGatewayKey as symbol]: managerGateway,
        [previewControlGatewayKey as symbol]: previewControlGateway,
      },
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('AssistantIndexFeature data states', () => {
  it('renders the derived device and online summary returned by the gateway', async () => {
    const source = assistants[0]
    if (!source) throw new Error('assistant fixture is missing')
    const summary = {
      ...source,
      deviceCount: 33,
      onlineDeviceCount: 7,
      lastConversationAt: '2026-08-04T03:15:00.000Z',
    }
    const view = renderFeature(gateway({ listAssistants: vi.fn(async () => success({ items: [summary], total: 1 })) }))

    expect(await view.findByRole('heading', { name: 'Mây' })).toBeTruthy()
    expect(view.getByText('7 thiết bị trực tuyến')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thiết bị (33)' })).toBeTruthy()
  })

  it('shows a retryable error instead of a false empty assistant list', async () => {
    const view = renderFeature(gateway({ listAssistants: vi.fn(async () => failure()) }))

    const heading = await view.findByRole('heading', { name: 'Không tải được danh sách trợ lý' })
    expect(view.getByText('Không tải được danh sách trợ lý từ máy chủ quản trị.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
  })

  it('shows the offline state when the gateway serves stale data', async () => {
    const view = renderFeature(gateway({ listAssistants: vi.fn(async () => failure(true)) }))

    expect(await view.findByRole('heading', { name: 'Máy chủ quản trị đang ngoại tuyến' })).toBeTruthy()
    expect(view.getByText('Đang ngoại tuyến; chưa thể đồng bộ danh sách trợ lý.')).toBeTruthy()
  })

  it('retries a transient read failure and restores assistant cards', async () => {
    const listAssistants = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success({ items: assistants, total: assistants.length }))
    const view = renderFeature(gateway({ listAssistants }))

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByRole('heading', { name: 'Mây' })).toBeTruthy()
    expect(listAssistants).toHaveBeenCalledTimes(2)
  })

  it('keeps an empty successful catalog distinct from a failed read', async () => {
    const view = renderFeature(gateway({ listAssistants: vi.fn(async () => success({ items: [], total: 0 })) }))

    expect(await view.findByText('Chưa có trợ lý', { selector: 'strong' })).toBeTruthy()
    const emptyState = view.container.querySelector('.vt-empty')
    expect(emptyState).not.toBeNull()
    expect(within(emptyState as HTMLElement).getByRole('button', { name: 'Tạo trợ lý' })).toBeTruthy()
  })
})
