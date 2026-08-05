import { fireEvent, render, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GatewayFailure, GatewaySuccess, RoleConfigDraft } from '@/domain'
import { managerGatewayKey, type ManagerGateway } from '@/gateways'
import { createRoleConfigFixtures, createVoiceFixtures, ASSISTANT_IDS } from '@/mocks/fixtures/assistants'

import RoleConfigFeature from './RoleConfigFeature.vue'

const assistantId = ASSISTANT_IDS.may
const roleResource = createRoleConfigFixtures()[assistantId]
if (!roleResource) throw new Error('role fixture missing')
const resource = roleResource
const voices = createVoiceFixtures()

function meta(offline = false) {
  return {
    requestId: 'request-role-test',
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
      requestId: 'request-role-test',
      retryable: offline,
      ...(offline ? {} : { resource: 'assistant', resourceId: assistantId }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    getRoleConfig: vi.fn(async () => success(resource)),
    listVoices: vi.fn(async () => success({ items: voices, total: voices.length })),
    listProviderInstallations: vi.fn(async () => success([{
      id: 'preview.provider.vieneu',
      kind: 'tts',
      displayNameKey: 'VieNeu',
      version: '1.0.0',
      manifest: { locales: ['vi-VN'] },
      configSchema: {},
    }])),
    saveRoleConfig: vi.fn(async () => success(resource)),
    publishAssistant: vi.fn(async () => success({ revision: resource.revision + 1 })),
    ...overrides,
  } as unknown as ManagerGateway
}

function renderFeature(managerGateway: ManagerGateway) {
  return render(RoleConfigFeature, {
    props: { assistantId },
    global: {
      provide: { [managerGatewayKey as symbol]: managerGateway },
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('RoleConfigFeature read states', () => {
  it('shows a retryable error when role config cannot be read', async () => {
    const view = renderFeature(gateway({ getRoleConfig: vi.fn(async () => failure()) }))

    const heading = await view.findByRole('heading', { name: 'Không tải được role config' })
    expect(view.getByText('Không tải được role config từ Manager API.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('does not expose a partial form when voice catalog read fails', async () => {
    const view = renderFeature(gateway({ listVoices: vi.fn(async () => failure()) }))

    await view.findByRole('heading', { name: 'Không tải được role config' })
    expect(view.getByText('Không tải được danh sách giọng nói; form tạm thời bị khóa để tránh chọn voice chưa đồng bộ.')).toBeTruthy()
    expect(view.queryByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })).toBeNull()
  })

  it('retries a transient read failure and restores the role form', async () => {
    const getRoleConfig = vi.fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success(resource))
    const view = renderFeature(gateway({ getRoleConfig }))

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })).toBeTruthy()
    expect(getRoleConfig).toHaveBeenCalledTimes(2)
  })

})

describe('RoleConfigFeature mutations', () => {
  it('exposes resource admission settings and preserves them on save', async () => {
    const saveRoleConfig = vi.fn(async (...args: [string, RoleConfigDraft]) => {
      void args
      return success(resource)
    })
    const view = renderFeature(gateway({ saveRoleConfig }))

    const maxTurns = await view.findByRole('spinbutton', { name: 'Lượt hội thoại đồng thời' })
    const retryAfter = view.getByRole('spinbutton', { name: 'Thời gian thử lại khi bận' })
    expect((maxTurns as HTMLInputElement).value).toBe('1')
    expect((retryAfter as HTMLInputElement).value).toBe('250')

    await fireEvent.update(maxTurns, '2')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    await waitFor(() => expect(saveRoleConfig).toHaveBeenCalledTimes(1))
    expect(saveRoleConfig.mock.calls[0]?.[1].admission).toEqual({ maxActiveTurns: 2, retryAfterMs: 250 })
  })

  it('preserves additive runtime policies that this surface does not edit yet', async () => {
    const saveRoleConfig = vi.fn(async (...args: [string, RoleConfigDraft]) => {
      void args
      return success(resource)
    })
    const view = renderFeature(gateway({ saveRoleConfig }))

    const prompt = await view.findByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
    await fireEvent.update(prompt, 'Giữ nguyên các policy đã publish.')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    await waitFor(() => expect(saveRoleConfig).toHaveBeenCalledTimes(1))
    const draft = saveRoleConfig.mock.calls[0]?.[1]
    expect(draft?.progress).toEqual({ enabled: true, acknowledgementId: 'processing', deadlineMs: 900 })
    expect(draft?.segmentation).toEqual({ minimumCharacters: 2, maximumCharacters: 120 })
    expect(draft?.bargeIn).toEqual({ minSpeechFrames: 2 })
    expect(draft?.toolPolicy).toEqual({ maxRounds: 2, timeoutMs: 5000 })
    expect(draft?.tools).toEqual([{ name: 'device.led.set', description: 'Set the RGB LED.' }])
  })

  it('configures the first-speech timeout and localized alert through the role form', async () => {
    const saveRoleConfig = vi.fn(async (...args: [string, RoleConfigDraft]) => {
      void args
      return success(resource)
    })
    const view = renderFeature(gateway({ saveRoleConfig }))

    const toggle = await view.findByRole('switch', { name: 'Bật timeout' })
    await fireEvent.click(toggle)
    const timeout = view.getByRole('spinbutton', { name: 'Chờ speech tối đa' })
    const message = view.getByRole('textbox', { name: 'Thông báo khi chưa nghe thấy' })
    await fireEvent.update(timeout, '7000')
    await fireEvent.update(message, 'Mình chưa nghe thấy bạn.')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    await waitFor(() => expect(saveRoleConfig).toHaveBeenCalledTimes(1))
    expect(saveRoleConfig.mock.calls[0]?.[1].autoTurn).toEqual({
      enabled: true,
      noSpeechTimeoutMs: 7000,
      noSpeechAlert: { status: 'warning', message: 'Mình chưa nghe thấy bạn.', emotion: 'neutral' },
    })
  })

  it('configures the progress acknowledgement without dropping additive policy fields', async () => {
    const saveRoleConfig = vi.fn(async (...args: [string, RoleConfigDraft]) => {
      void args
      return success(resource)
    })
    const view = renderFeature(gateway({ saveRoleConfig }))

    const deadline = await view.findByRole('spinbutton', { name: 'Deadline trước khi phản hồi' })
    const message = view.getByRole('textbox', { name: 'Câu phản hồi khi đang xử lý' })
    await fireEvent.update(deadline, '800')
    await fireEvent.update(message, 'Mình đang xử lý yêu cầu của bạn.')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    await waitFor(() => expect(saveRoleConfig).toHaveBeenCalledTimes(1))
    const progress = saveRoleConfig.mock.calls[0]?.[1].progress
    expect(progress).toMatchObject({ enabled: true, acknowledgementId: 'processing', deadlineMs: 800 })
    expect(progress?.acknowledgements).toEqual({ processing: 'Mình đang xử lý yêu cầu của bạn.' })
  })

  it('allows enabling progress for a role that did not publish the optional policy', async () => {
    const noProgressResource = {
      ...resource,
      value: { ...resource.value, progress: undefined },
    }
    const saveRoleConfig = vi.fn(async (...args: [string, RoleConfigDraft]) => {
      void args
      return success(noProgressResource)
    })
    const view = renderFeature(gateway({ getRoleConfig: vi.fn(async () => success(noProgressResource)), saveRoleConfig }))

    const toggle = await view.findByRole('switch', { name: 'Bật phản hồi' })
    await fireEvent.click(toggle)
    await fireEvent.update(view.getByRole('textbox', { name: 'Câu phản hồi khi đang xử lý' }), 'Đang xử lý.')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    await waitFor(() => expect(saveRoleConfig).toHaveBeenCalledTimes(1))
    expect(saveRoleConfig.mock.calls[0]?.[1].progress).toMatchObject({ enabled: true, acknowledgementId: 'processing', deadlineMs: 900 })
  })

  it('keeps the draft and exposes an offline save error', async () => {
    const view = renderFeature(gateway({ saveRoleConfig: vi.fn(async () => failure(true)) }))
    const prompt = await view.findByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
    await fireEvent.update(prompt, 'Draft role phải được giữ khi offline.')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu bản nháp' }))

    expect(await view.findByText('Đang ngoại tuyến; draft vẫn được giữ trên màn hình.')).toBeTruthy()
    expect((prompt as HTMLTextAreaElement).value).toContain('Draft role')
  })

  it('surfaces a publish error without losing the loaded form', async () => {
    const view = renderFeature(gateway({ publishAssistant: vi.fn(async () => failure()) }))
    await view.findByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
    await fireEvent.click(view.getByRole('button', { name: 'Áp dụng runtime' }))

    expect(await view.findByText('Revision hiện tại không còn mới; hãy tải lại trước khi publish.')).toBeTruthy()
    expect(view.getByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })).toBeTruthy()
  })
})
