import { fireEvent, render } from '@testing-library/vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import type { GatewayFailure, GatewaySuccess } from '@/domain'
import { managerGatewayKey, type ManagerGateway } from '@/gateways'
import { createAssistantCardFixtures } from '@/mocks/fixtures/assistants'

import AssistantSummaryState from './AssistantSummaryState.vue'
import { useAssistantSummary } from './useAssistantSummary'

const assistant = Object.values(createAssistantCardFixtures())[0]?.value
if (!assistant) throw new Error('assistant fixture is missing')
const assistantId = assistant.id

function meta(offline = false) {
  return {
    requestId: 'request-assistant-summary-test',
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
      requestId: 'request-assistant-summary-test',
      retryable: offline,
      ...(offline ? {} : { fieldProblems: [] }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return { listAssistants: vi.fn(async () => success({ items: [assistant], total: 1 })), ...overrides } as unknown as ManagerGateway
}

const Harness = defineComponent({
  setup() {
    return useAssistantSummary()
  },
  template: '<div><span data-testid="state">{{ loadState }}</span><span data-testid="error">{{ loadError }}</span><span v-if="assistant">{{ assistant.name }}</span><button type="button" @click="reloadAssistant">retry</button></div>',
})

async function renderHarness(managerGateway: ManagerGateway, id = assistantId) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/assistants/:id', component: Harness }] })
  await router.push(`/assistants/${id}`)
  await router.isReady()
  return render(Harness, { global: { plugins: [router], provide: { [managerGatewayKey as symbol]: managerGateway } } })
}

afterEach(() => vi.restoreAllMocks())

describe('useAssistantSummary', () => {
  it('keeps API failures distinct from a missing assistant and supports retry', async () => {
    const listAssistants = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success({ items: [assistant], total: 1 }))
    const view = await renderHarness(gateway({ listAssistants }))

    expect(await view.findByText('error', { selector: '[data-testid="state"]' })).toBeTruthy()
    expect(view.getByTestId('error').textContent).toContain('Không tải được')
    await fireEvent.click(view.getByRole('button', { name: 'retry' }))
    expect(await view.findByText('ready', { selector: '[data-testid="state"]' })).toBeTruthy()
    expect(view.getByText(assistant.name)).toBeTruthy()
    expect(listAssistants).toHaveBeenCalledTimes(2)
  })

  it('reports offline freshness and not-found as separate states', async () => {
    const offline = await renderHarness(gateway({ listAssistants: vi.fn(async () => failure(true)) }))
    expect(await offline.findByText('offline', { selector: '[data-testid="state"]' })).toBeTruthy()
    expect(offline.getByTestId('error').textContent).toContain('ngoại tuyến')
    offline.unmount()

    const missing = await renderHarness(gateway({ listAssistants: vi.fn(async () => success({ items: [], total: 0 })) }))
    expect(await missing.findByText('not-found', { selector: '[data-testid="state"]' })).toBeTruthy()
    expect(missing.getByTestId('error').textContent).toContain('không tồn tại')
  })
})

describe('AssistantSummaryState', () => {
  it('announces an error, focuses its heading and emits retry', async () => {
    const retry = vi.fn()
    const view = render(AssistantSummaryState, {
      props: { state: 'error', errorMessage: 'Không tải được thông tin trợ lý.' },
      attrs: { onRetry: retry },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })

    const heading = await view.findByRole('heading', { name: 'Không tải được thông tin trợ lý' })
    expect(document.activeElement).toBe(heading)
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
