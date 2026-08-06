import { fireEvent, render, waitFor, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  GatewayFailure,
  GatewaySuccess,
  ProviderConfigRecord,
  SecretReference,
} from '@/domain'
import { managerGatewayKey, type ManagerGateway as Gateway } from '@/gateways'

import { createProviderRegistryFixtures } from '@/mocks/fixtures/providers'
import ProviderManagementFeature from './ProviderManagementFeature.vue'

const fixture = createProviderRegistryFixtures()
const initialConfig = fixture.configs[0] as ProviderConfigRecord
const secret: SecretReference = {
  id: 'secret-preview-groq',
  name: 'Groq API key',
  store: 'encrypted-local',
  locatorMasked: 'encrypted-local',
  version: 1,
  metadataRevision: 1,
  status: 'available',
  lastRotatedAt: '2026-08-03T08:00:00.000Z',
  etag: '"secret-preview-1"',
  updatedAt: '2026-08-03T08:00:00.000Z',
}

function meta(offline = false) {
  return { requestId: 'provider-management-test', completedAt: new Date(0).toISOString(), delayMs: 0, freshness: offline ? 'stale' as const : 'fresh' as const, offline }
}

function success<T>(data: T): GatewaySuccess<T> {
  return { ok: true, data, meta: meta() }
}

function failure(offline = false): GatewayFailure<never> {
  return {
    ok: false,
    problem: { type: offline ? 'offline' : 'validation', code: offline ? 'OFFLINE_MUTATION_BLOCKED' : 'VALIDATION_ERROR', messageKey: 'problem.request.failed', requestId: 'provider-management-test', retryable: offline, ...(offline ? {} : { fieldProblems: [] }) } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    listProviderInstallations: vi.fn(async () => success(fixture.installations)),
    listProviderConfigs: vi.fn(async () => success([initialConfig])),
    listSecretReferences: vi.fn(async () => success([secret])),
    createProviderConfig: vi.fn(async (input) => success({ ...initialConfig, id: 'created-provider', name: input.name, installationId: input.installationId, config: input.config, secretRefs: input.secretRefs ?? [] })),
    updateProviderConfig: vi.fn(async (_id, input) => success({ ...initialConfig, name: input.name ?? initialConfig.name, config: input.config ?? initialConfig.config, secretRefs: input.secretRefs ?? initialConfig.secretRefs, revision: 2, etag: '"provider-2"' })),
    setProviderConfigEnabled: vi.fn(async (_id, enabled) => success({ ...initialConfig, enabled, etag: '"provider-status"' })),
    deleteProviderConfig: vi.fn(async () => success(undefined)),
    probeProviderConfig: vi.fn(async (id) => success({ providerConfigId: id, state: 'ready', checkedAt: new Date(0).toISOString(), durationMs: 2, checks: [{ id: 'schema', state: 'passed', message: 'Cấu hình hợp lệ.' }] })),
    ...overrides,
  } as unknown as Gateway
}

function renderFeature(managerGateway: Gateway) {
  return render(ProviderManagementFeature, {
    global: { provide: { [managerGatewayKey as symbol]: managerGateway } },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ProviderManagementFeature', () => {
  it('presents the reference-style provider table with searchable fields and catalog tab', async () => {
    const view = renderFeature(gateway())

    expect(await view.findByRole('heading', { name: 'Quản lý provider và model' })).toBeTruthy()
    expect(await view.findByText('Groq test config')).toBeTruthy()
    expect(view.getByRole('columnheader', { name: 'Trường cấu hình' })).toBeTruthy()

    await fireEvent.update(view.getByRole('textbox', { name: 'Tìm dịch vụ' }), 'VieNeu')
    expect(await view.findByText('Không có dịch vụ phù hợp')).toBeTruthy()
    await fireEvent.update(view.getByRole('textbox', { name: 'Tìm dịch vụ' }), 'Groq')
    expect(await view.findByText('Groq test config')).toBeTruthy()

    await fireEvent.click(view.getByRole('button', { name: /Thư viện provider\/model/ }))
    expect(await view.findByText('Chọn nền tảng rồi tạo cấu hình riêng')).toBeTruthy()
    expect(view.getByText('Groq — trả lời nhanh')).toBeTruthy()
  })

  it('opens the schema field inspector without exposing a secret value', async () => {
    const view = renderFeature(gateway())
    await view.findByText('Groq test config')

    await fireEvent.click(view.getByRole('button', { name: '6 trường' }))
    const dialog = await view.findByRole('dialog', { name: /Trường cấu hình/ })
    expect(dialog.textContent).toContain('Base URL')
    expect(dialog.textContent).toContain('Model')
    expect(dialog.textContent).not.toContain('api-key-value')
    await fireEvent.click(view.getByRole('button', { name: 'Đóng' }))
    await waitFor(() => expect(view.queryByRole('dialog', { name: /Trường cấu hình/ })).toBeNull())
  })

  it('supports enable/disable, duplicate and probe actions through the gateway', async () => {
    const setEnabled = vi.fn(async () => success({ ...initialConfig, enabled: false, etag: '"disabled"' }))
    const probe = vi.fn(async () => success({ providerConfigId: initialConfig.id, state: 'ready' as const, checkedAt: new Date(0).toISOString(), durationMs: 1, checks: [{ id: 'schema', state: 'passed' as const, message: 'Đã kiểm tra.' }] }))
    const managerGateway = gateway({ setProviderConfigEnabled: setEnabled, probeProviderConfig: probe })
    const view = renderFeature(managerGateway)
    await view.findByText('Groq test config')

    await fireEvent.click(view.getByRole('switch', { name: 'Bật Groq test config' }))
    expect(setEnabled).toHaveBeenCalledWith(initialConfig.id, false, initialConfig.etag)
    expect(await view.findByText('Đã tắt')).toBeTruthy()

    await fireEvent.click(view.getByRole('button', { name: 'Kiểm tra Groq test config' }))
    await waitFor(() => expect(probe).toHaveBeenCalledWith(initialConfig.id))

    await fireEvent.click(view.getByRole('button', { name: 'Nhân bản Groq test config' }))
    const nameInput = await view.findByRole('textbox', { name: 'Tên hiển thị' })
    expect((nameInput as HTMLInputElement).value).toBe('Groq test config (bản sao)')
    await fireEvent.click(view.getByRole('button', { name: 'Hủy' }))
  })

  it('supports select-all and a guarded batch archive action', async () => {
    const remove = vi.fn(async () => success(undefined))
    const view = renderFeature(gateway({ deleteProviderConfig: remove }))
    await view.findByText('Groq test config')

    await fireEvent.click(view.getByRole('checkbox', { name: 'Chọn tất cả' }))
    expect(await view.findByText('Đã chọn 1 dịch vụ')).toBeTruthy()
    await fireEvent.click(view.getByRole('button', { name: 'Lưu trữ đã chọn' }))
    expect(await view.findByRole('dialog', { name: 'Lưu trữ dịch vụ?' })).toBeTruthy()
    await fireEvent.click(view.getByRole('button', { name: 'Lưu trữ' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith(initialConfig.id, initialConfig.etag))
    expect(await view.findByText('Chưa có dịch vụ nào')).toBeTruthy()
  })

  it('creates a provider with the schema-driven editor and family explanation', async () => {
    const create = vi.fn(async (input) => success({ ...initialConfig, id: 'created', name: input.name, config: input.config, secretRefs: input.secretRefs ?? [] }))
    const managerGateway = gateway({ createProviderConfig: create })
    const view = renderFeature(managerGateway)
    await view.findByRole('heading', { name: 'Quản lý provider và model' })

    await view.findByText('Groq test config')
    await fireEvent.click(view.getAllByRole('button', { name: 'Thêm dịch vụ' })[0]!)
    await fireEvent.click(view.getByRole('button', { name: /Groq — trả lời nhanh/ }))
    expect(await view.findByText('OpenAI-compatible')).toBeTruthy()
    await fireEvent.update(view.getByRole('textbox', { name: 'Tên hiển thị' }), 'Groq tốc độ cao')
    await fireEvent.update(view.getByRole('textbox', { name: 'Base URL' }), 'https://api.groq.com/openai/v1')
    await fireEvent.update(view.getByRole('textbox', { name: 'Mô hình trả lời' }), 'llama-3.3-70b-versatile')
    await fireEvent.update(view.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' }), '256')
    await fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: /^Thêm dịch vụ$/ }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ installationId: fixture.installations[0]?.id, name: 'Groq tốc độ cao' })))
  })

  it('keeps the editor draft when the manager API is offline', async () => {
    const view = renderFeature(gateway({ createProviderConfig: vi.fn(async () => failure(true)) }))
    await view.findByRole('heading', { name: 'Quản lý provider và model' })
    await view.findByText('Groq test config')
    await fireEvent.click(view.getAllByRole('button', { name: 'Thêm dịch vụ' })[0]!)
    await fireEvent.click(view.getByRole('button', { name: /Groq — trả lời nhanh/ }))
    const input = await view.findByRole('textbox', { name: 'Tên hiển thị' })
    await fireEvent.update(input, 'Cấu hình khi offline')
    await fireEvent.update(view.getByRole('textbox', { name: 'Base URL' }), 'https://api.groq.com/openai/v1')
    await fireEvent.update(view.getByRole('textbox', { name: 'Mô hình trả lời' }), 'fixture')
    await fireEvent.update(view.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' }), '128')
    await fireEvent.click(within(view.getByRole('dialog')).getByRole('button', { name: /^Thêm dịch vụ$/ }))
    expect(await view.findByText('Đang ngoại tuyến; thay đổi chưa được gửi.')).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('Cấu hình khi offline')
  })
})
