import { fireEvent, render } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GatewayFailure, GatewaySuccess } from '@/domain'
import { managerGatewayKey, previewControlGatewayKey, type ManagerGateway, type PreviewControlGateway } from '@/gateways'
import { i18n } from '@/i18n'
import { createModelMemoryFixtures } from '@/mocks/fixtures/providers'
import { ASSISTANT_IDS } from '@/mocks/fixtures/assistants'

import ModelMemoryFeature from './ModelMemoryFeature.vue'

const assistantId = ASSISTANT_IDS.may
const resource = createModelMemoryFixtures()[assistantId]
if (!resource) throw new Error('model-memory fixture missing')

function meta(offline = false) {
  return {
    requestId: 'request-model-memory-test',
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
      messageKey: offline ? 'problem.offline.mutationBlocked' : 'problem.assistant.notFound',
      requestId: 'request-model-memory-test',
      retryable: offline,
      ...(offline ? {} : { resource: 'assistant', resourceId: assistantId }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    getModelMemory: vi.fn(async () => success(resource)),
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
  return render(ModelMemoryFeature, {
    props: { assistantId },
    global: {
      plugins: [i18n],
      provide: {
        [managerGatewayKey as symbol]: managerGateway,
        [previewControlGatewayKey as symbol]: previewControlGateway,
      },
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ModelMemoryFeature read states', () => {
  it('shows a retryable error when provider workspace cannot be read', async () => {
    const view = renderFeature(gateway({ getModelMemory: vi.fn(async () => failure()) }))

    const heading = await view.findByRole('heading', { name: 'Không tải được dịch vụ và phần ghi nhớ' })
    expect(view.getByText('Không tải được dịch vụ và phần ghi nhớ.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
  })

  it('shows offline without exposing stale provider controls as current', async () => {
    const view = renderFeature(gateway({ getModelMemory: vi.fn(async () => failure(true)) }))

    expect(await view.findByRole('heading', { name: 'Máy chủ quản trị đang ngoại tuyến' })).toBeTruthy()
    expect(view.queryByRole('combobox', { name: 'Dịch vụ Bộ não trả lời' })).toBeNull()
  })

  it('retries a transient workspace error and restores provider controls', async () => {
    const getModelMemory = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success(resource))
    const view = renderFeature(gateway({ getModelMemory }))

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByRole('combobox', { name: 'Dịch vụ Bộ não trả lời' })).toBeTruthy()
    expect(getModelMemory).toHaveBeenCalledTimes(2)
  })

  it('renders all configured provider kinds on a successful read', async () => {
    const view = renderFeature(gateway())

    expect(await view.findByRole('combobox', { name: 'Dịch vụ Lọc tiếng ồn' })).toBeTruthy()
    expect(view.getByRole('combobox', { name: 'Dịch vụ Giọng nói' })).toBeTruthy()
    expect(view.getByText('Bộ nhớ hội thoại')).toBeTruthy()
  })
})
