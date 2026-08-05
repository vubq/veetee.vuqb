import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
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
  etag: '"device-test-etag"',
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

function revisionConflict(): GatewayFailure<never> {
  return {
    ok: false,
    problem: {
      type: 'revision-conflict',
      code: 'REVISION_CONFLICT',
      messageKey: 'problem.revision.conflict',
      requestId: 'request-device-test',
      retryable: false,
      currentRevision: 2,
      currentEtag: '"device-new-etag"',
      current: { ...device, etag: '"device-new-etag"' },
      localDraft: undefined,
    } as never,
    meta: meta(),
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
    expect(view.getByText('Không tải được danh sách thiết bị từ máy chủ quản trị.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
    expect(view.queryByRole('heading', { name: 'Chưa có thiết bị' })).toBeNull()
  })

  it('marks stale device reads as offline', async () => {
    const view = renderFeature(gateway({ listDevices: vi.fn(async () => failure(true)) }))

    expect(await view.findByRole('heading', { name: 'Máy chủ quản trị đang ngoại tuyến' })).toBeTruthy()
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

  it('requires confirmation then unlinks with the device ETag and refreshes the list', async () => {
    const listDevices = vi.fn()
      .mockResolvedValueOnce(success({ items: [device], total: 1 }))
      .mockResolvedValueOnce(success({ items: [], total: 0 }))
    const unlinkDevice = vi.fn(async () => success(undefined))
    const view = renderFeature(gateway({ listDevices, unlinkDevice }))

    const action = await view.findByRole('button', { name: 'Bỏ liên kết: Veetee bàn học' })
    await fireEvent.click(action)
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ liên kết thiết bị' })
    expect(within(dialog).getByText('Veetee bàn học')).toBeTruthy()
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ liên kết' }))

    await waitFor(() => expect(unlinkDevice).toHaveBeenCalledWith(device.id, device.etag))
    await waitFor(() => expect(view.getByText('Chưa có thiết bị')).toBeTruthy())
  })

  it('keeps the confirmation open and exposes an inline offline error when unlink is blocked', async () => {
    const unlinkDevice = vi.fn(async () => failure(true))
    const view = renderFeature(gateway({ unlinkDevice }))

    await fireEvent.click(await view.findByRole('button', { name: 'Bỏ liên kết: Veetee bàn học' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ liên kết thiết bị' })
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ liên kết' }))

    expect((await within(dialog).findByRole('alert')).textContent).toContain('Đang ngoại tuyến; chưa thể bỏ liên kết. Thiết bị vẫn giữ nguyên.')
    expect(unlinkDevice).toHaveBeenCalledWith(device.id, device.etag)
    expect(view.container.querySelector('.device-card')).not.toBeNull()
  })

  it('refreshes the confirmation target after a stale device ETag conflict', async () => {
    const refreshed = { ...device, etag: '"device-new-etag"' }
    const listDevices = vi.fn()
      .mockResolvedValueOnce(success({ items: [device], total: 1 }))
      .mockResolvedValueOnce(success({ items: [refreshed], total: 1 }))
      .mockResolvedValueOnce(success({ items: [], total: 0 }))
    const unlinkDevice = vi.fn()
      .mockResolvedValueOnce(revisionConflict())
      .mockResolvedValueOnce(success(undefined))
    const view = renderFeature(gateway({ listDevices, unlinkDevice }))

    await fireEvent.click(await view.findByRole('button', { name: 'Bỏ liên kết: Veetee bàn học' }))
    const dialog = await screen.findByRole('dialog', { name: 'Bỏ liên kết thiết bị' })
    const confirm = within(dialog).getByRole('button', { name: 'Bỏ liên kết' })
    await fireEvent.click(confirm)
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Liên kết thiết bị đã thay đổi.')

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Bỏ liên kết' }))
    await waitFor(() => expect(unlinkDevice).toHaveBeenNthCalledWith(2, device.id, refreshed.etag))
    await waitFor(() => expect(view.getByText('Chưa có thiết bị')).toBeTruthy())
  })
})
