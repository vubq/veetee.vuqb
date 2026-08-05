import { fireEvent, render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import type { GatewayFailure, SecretReference, ValidationProblem } from '@/domain'
import { managerGatewayKey, type ManagerGateway } from '@/gateways'

import SecretReferencePanel from './SecretReferencePanel.vue'

const item: SecretReference = {
  id: 'secret-groq',
  name: 'Groq test key',
  store: 'encrypted-local',
  locatorMasked: 'encrypted-local',
  version: 1,
  metadataRevision: 1,
  status: 'available',
  lastRotatedAt: '2026-08-03T08:00:00.000Z',
  etag: '"secret-1"',
  updatedAt: '2026-08-03T08:00:00.000Z',
}

function meta(offline = false) {
  return { requestId: 'secret-test', completedAt: new Date(0).toISOString(), delayMs: 0, freshness: offline ? 'stale' as const : 'fresh' as const, offline }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    createSecretReference: vi.fn(async () => ({ ok: true as const, data: item, meta: meta() })),
    updateSecretReference: vi.fn(async () => ({ ok: true as const, data: { ...item, version: 2 }, meta: meta() })),
    deleteSecretReference: vi.fn(async () => ({ ok: true as const, data: undefined, meta: meta() })),
    ...overrides,
  } as unknown as ManagerGateway
}

function renderPanel(managerGateway: ManagerGateway, selectedIds: string[] = []) {
  return render(SecretReferencePanel, {
    props: { gateway: managerGateway, items: [item], selectedIds },
    global: { provide: { [managerGatewayKey as symbol]: managerGateway } },
  })
}

describe('SecretReferencePanel', () => {
  it('keeps secret value write-only and emits provider selection changes', async () => {
    const managerGateway = gateway()
    const view = renderPanel(managerGateway)
    const checkbox = view.getByRole('checkbox', { name: /Groq test key/ })
    await fireEvent.click(checkbox)
    const selectedEvents = view.emitted('update:selectedIds') as unknown[][] | undefined
    expect(selectedEvents?.at(-1)?.[0] as string[]).toEqual(['secret-groq'])

    const name = view.getByRole('textbox', { name: 'Tên khóa' })
    const value = view.getByLabelText('Giá trị khóa')
    await fireEvent.update(name, 'New secret')
    await fireEvent.update(value, 'do-not-render')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu khóa' }))
    expect(managerGateway.createSecretReference).toHaveBeenCalledWith({ name: 'New secret', secretValue: 'do-not-render' })
    expect(managerGateway.createSecretReference).toHaveBeenCalledTimes(1)
    expect((value as HTMLInputElement).value).toBe('')
    expect(view.queryByText('do-not-render')).toBeNull()
  })

  it('rotates a selected reference and clears the new value after success', async () => {
    const managerGateway = gateway()
    const view = renderPanel(managerGateway, ['secret-groq'])
    await fireEvent.click(view.getByRole('button', { name: 'Đổi khóa' }))
    const value = await view.findByLabelText('Giá trị khóa mới')
    await fireEvent.update(value, 'rotated-only-on-request')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu khóa mới' }))
    expect(managerGateway.updateSecretReference).toHaveBeenCalledWith('secret-groq', { secretValue: 'rotated-only-on-request' }, item.etag)
    expect((value as HTMLInputElement).value).toBe('')
  })

  it('keeps the reference when deletion is rejected by the gateway', async () => {
    const managerGateway = gateway({
      deleteSecretReference: vi.fn(async (): Promise<GatewayFailure<ValidationProblem>> => ({
        ok: false as const,
        problem: { type: 'validation', code: 'VALIDATION_ERROR', messageKey: 'problem.secret.inUse', requestId: 'secret-test', retryable: false, fieldProblems: [] },
        meta: meta(),
      })),
    })
    const view = renderPanel(managerGateway)
    await fireEvent.click(view.getByRole('button', { name: 'Xóa' }))
    await fireEvent.click(view.getByRole('button', { name: 'Xóa khóa' }))
    expect((await view.findByRole('alert')).textContent).toContain('Khóa đang được dịch vụ sử dụng')
    expect(view.getAllByText('Groq test key').length).toBeGreaterThan(0)
  })
})
