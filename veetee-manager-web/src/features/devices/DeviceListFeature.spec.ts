import { fireEvent, render, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantCard, DeviceCard, GatewayFailure, GatewaySuccess } from '@/domain'
import { i18n } from '@/i18n'
import { managerGatewayKey, previewControlGatewayKey, type ManagerGateway, type PreviewControlGateway } from '@/gateways'

import DeviceListFeature from './DeviceListFeature.vue'

const assistant: AssistantCard = {
  id: 'assistant-device-test',
  name: 'Mây',
  locale: 'vi-VN',
  voiceName: 'Minh Đức',
  personalityName: 'Người bạn đồng hành',
  onlineDeviceCount: 1,
  deviceCount: 1,
  lastConversationAt: null,
  publishedRevision: 1,
  configurationState: 'published',
}

const device: DeviceCard = {
  id: 'device-test',
  assistantId: assistant.id,
  displayName: 'Veetee bàn học',
  maskedMac: 'AA:BB:••:••:12:34',
  firmwareVersion: '0.1.0',
  board: 'ESP32-S3',
  onlineState: 'online',
  lastSeenAt: new Date(0).toISOString(),
  lastConversationAt: null,
}

function meta(offline = false) {
  return {
    requestId: 'request-device-test',
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
      requestId: 'request-device-test',
      retryable: offline,
      ...(offline ? {} : { resource: 'assistant', resourceId: assistant.id }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    listDevices: vi.fn(async () => success({ items: [device], total: 1 })),
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
  return render(DeviceListFeature, {
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

afterEach(() => vi.restoreAllMocks())

describe('DeviceListFeature data states', () => {
  it('shows a retryable error instead of a misleading empty state', async () => {
    const view = renderFeature(gateway({ listDevices: vi.fn(async () => failure()) }))

    const heading = await view.findByRole('heading', { name: 'Không tải được thiết bị' })
    expect(view.getByText('Không tải được danh sách thiết bị từ Manager API.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
    expect(view.queryByRole('heading', { name: 'Chưa có thiết bị' })).toBeNull()
  })

  it('marks stale device reads as offline', async () => {
    const view = renderFeature(gateway({ listDevices: vi.fn(async () => failure(true)) }))

    expect(await view.findByRole('heading', { name: 'Manager API đang ngoại tuyến' })).toBeTruthy()
    expect(view.getByText('Đang ngoại tuyến; chưa thể đồng bộ danh sách thiết bị.')).toBeTruthy()
  })

  it('retries and renders the device after a transient read failure', async () => {
    const listDevices = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success({ items: [device], total: 1 }))
    const view = renderFeature(gateway({ listDevices }))

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByRole('heading', { name: 'Veetee bàn học' })).toBeTruthy()
    expect(listDevices).toHaveBeenCalledTimes(2)
  })

  it('keeps a valid empty catalog distinct from a failed read', async () => {
    const view = renderFeature(gateway({ listDevices: vi.fn(async () => success({ items: [], total: 0 })) }))

    expect(await view.findByText('Chưa có thiết bị', { selector: 'strong' })).toBeTruthy()
    const emptyState = view.container.querySelector('.vt-empty')
    expect(emptyState).not.toBeNull()
    expect(within(emptyState as HTMLElement).getByRole('button', { name: 'Ghép nối thiết bị' })).toBeTruthy()
  })
})
