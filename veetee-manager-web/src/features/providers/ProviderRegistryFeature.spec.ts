import { fireEvent, render } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  GatewayFailure,
  GatewaySuccess,
  ProviderConfigRecord,
  ProviderInstallationView,
  SecretReference,
} from '@/domain'
import { managerGatewayKey, type ManagerGateway } from '@/gateways'

import ProviderRegistryFeature from './ProviderRegistryFeature.vue'

const installation: ProviderInstallationView = {
  id: 'installation-vieneu',
  kind: 'tts',
  displayNameKey: 'VieNeu TTS',
  version: '2.0.0',
  manifest: {},
  configSchema: { properties: { voice: { type: 'string' } } },
}

const config: ProviderConfigRecord = {
  id: 'config-vieneu',
  installationId: installation.id,
  name: 'VieNeu local',
  revision: 1,
  config: { voice: 'minh-duc' },
  secretRefs: [],
  etag: '"config-1"',
}

const secret: SecretReference = {
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
  return {
    requestId: 'request-provider-test',
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
      requestId: 'request-provider-test',
      retryable: offline,
      ...(offline ? {} : { fieldProblems: [] }),
    } as never,
    meta: meta(offline),
  }
}

function gateway(overrides: Partial<ManagerGateway> = {}): ManagerGateway {
  return {
    listProviderInstallations: vi.fn(async () => success([installation])),
    listProviderConfigs: vi.fn(async () => success([])),
    listSecretReferences: vi.fn(async () => success([secret])),
    createProviderConfig: vi.fn(async () => success(config)),
    updateProviderConfig: vi.fn(async () => success(config)),
    createSecretReference: vi.fn(async () => success(secret)),
    updateSecretReference: vi.fn(async () => success(secret)),
    deleteSecretReference: vi.fn(async () => success(undefined)),
    ...overrides,
  } as unknown as ManagerGateway
}

function renderFeature(managerGateway: ManagerGateway) {
  return render(ProviderRegistryFeature, {
    global: {
      provide: { [managerGatewayKey as symbol]: managerGateway },
    },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('ProviderRegistryFeature loading states', () => {
  it('shows a retryable error when the catalog request fails', async () => {
    const view = renderFeature(gateway({
      listProviderInstallations: vi.fn(async () => failure()),
    }))

    const heading = await view.findByRole('heading', { name: 'Không tải được provider registry' })
    expect(heading.textContent).toContain('Không tải được provider registry')
    expect(view.getByText('Không tải được catalog provider từ Manager API.')).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
  })

  it('names a config read failure without exposing a partial editor', async () => {
    const view = renderFeature(gateway({
      listProviderConfigs: vi.fn(async () => failure()),
    }))

    await view.findByRole('heading', { name: 'Không tải được provider registry' })
    expect(view.getByText('Không tải được các config provider từ Manager API.')).toBeTruthy()
    expect(view.queryByRole('textbox', { name: 'Tên cấu hình' })).toBeNull()
  })

  it('shows the offline state when the gateway reports stale reads', async () => {
    const view = renderFeature(gateway({
      listProviderInstallations: vi.fn(async () => failure(true)),
    }))

    expect(await view.findByRole('heading', { name: 'Manager API đang ngoại tuyến' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Thử lại' })).toBeTruthy()
  })

  it('retries a transient catalog error and then renders the editor', async () => {
    const listProviderInstallations = vi
      .fn()
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(success([installation]))
    const managerGateway = gateway({ listProviderInstallations })
    const view = renderFeature(managerGateway)

    await view.findByRole('button', { name: 'Thử lại' })
    await fireEvent.click(view.getByRole('button', { name: 'Thử lại' }))

    expect(await view.findByRole('textbox', { name: 'Tên cấu hình' })).toBeTruthy()
    expect(listProviderInstallations).toHaveBeenCalledTimes(2)
  })

  it('renders an explicit empty state when the catalog is valid but empty', async () => {
    const view = renderFeature(gateway({
      listProviderInstallations: vi.fn(async () => success([])),
    }))

    expect(await view.findByRole('heading', { name: 'Catalog provider đang trống' })).toBeTruthy()
    expect(view.getByRole('button', { name: 'Tải lại catalog' })).toBeTruthy()
    expect(view.queryByRole('textbox', { name: 'Tên cấu hình' })).toBeNull()
  })
})

describe('ProviderRegistryFeature mutations', () => {
  it('keeps the draft and shows an inline offline error when save is blocked', async () => {
    const view = renderFeature(gateway({
      createProviderConfig: vi.fn(async () => failure(true)),
    }))

    const nameInput = await view.findByRole('textbox', { name: 'Tên cấu hình' })
    await fireEvent.update(nameInput, 'Cấu hình offline')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu cấu hình' }))

    expect(await view.findByText('Đang ngoại tuyến; bản nháp vẫn được giữ trên màn hình và chưa được gửi.')).toBeTruthy()
    expect((nameInput as HTMLInputElement).value).toBe('Cấu hình offline')
  })

  it('keeps the draft and exposes a retryable mutation error', async () => {
    const view = renderFeature(gateway({
      createProviderConfig: vi.fn(async () => failure()),
    }))

    const nameInput = await view.findByRole('textbox', { name: 'Tên cấu hình' })
    await fireEvent.update(nameInput, 'Cấu hình lỗi')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu cấu hình' }))

    const error = await view.findByRole('alert')
    expect(error.textContent).toContain('bản nháp vẫn được giữ')
    expect((nameInput as HTMLInputElement).value).toBe('Cấu hình lỗi')
  })
})
