import type {
  GatewayFailure,
  GatewayProblem,
  GatewayResult,
  GatewaySuccess,
  PreviewScenarioId,
  RoleConfig,
  RoleConfigDraft,
} from '@/domain'

import { ASSISTANT_IDS, PAIRING_SUCCESS_CODE, PROVIDER_CONFIG_IDS } from './fixtures'
import { MockGateway, createMockGatewayDependencies } from './mock-gateway'

function requireSuccess<T, TProblem extends GatewayProblem>(
  result: GatewayResult<T, TProblem>,
): GatewaySuccess<T> {
  if (!result.ok) {
    throw new Error(`Expected success, received ${result.problem.code}`)
  }
  return result
}

function requireFailure<T, TProblem extends GatewayProblem>(
  result: GatewayResult<T, TProblem>,
): GatewayFailure<TProblem> {
  if (result.ok) throw new Error('Expected gateway failure')
  return result
}

function toRoleDraft(role: RoleConfig): RoleConfigDraft {
  return {
    locale: role.locale,
    basePrompt: role.basePrompt,
    personalityId: role.personalityId,
    personalityName: role.personalityName,
    speech: structuredClone(role.speech),
  }
}

function immediateGateway(scenario: PreviewScenarioId = 'happy') {
  return new MockGateway({ scenario, delayMs: 0, sleep: async () => undefined })
}

describe('MockGateway deterministic happy path', () => {
  it('returns Vietnamese fixtures, normalizes search, and protects state from consumers', async () => {
    const gateway = immediateGateway()

    const initial = requireSuccess(await gateway.listAssistants())
    expect(initial.data.total).toBe(2)
    expect(initial.data.items.map(({ name }) => name)).toEqual(['Mây', 'Bình Minh'])

    const filtered = requireSuccess(await gateway.listAssistants({ search: 'may' }))
    expect(filtered.data.items).toHaveLength(1)
    expect(filtered.data.items[0]?.name).toBe('Mây')

    const firstItem = initial.data.items[0]
    if (!firstItem) throw new Error('Missing assistant fixture')
    firstItem.name = 'Đã bị sửa ngoài gateway'

    const unchanged = requireSuccess(await gateway.listAssistants())
    expect(unchanged.data.items[0]?.name).toBe('Mây')
  })

  it('creates and pairs resources with deterministic IDs, then restores fixtures', async () => {
    const gateway = immediateGateway()

    const created = requireSuccess(
      await gateway.createAssistant({ name: 'Sao Mai', locale: 'vi-VN' }),
    )
    expect(created.data.value.id).toBe('81111111-0000-4000-8000-000000000001')

    const paired = requireSuccess(
      await gateway.pairDevice({
        assistantId: created.data.value.id,
        verificationCode: PAIRING_SUCCESS_CODE,
        displayName: 'Veetee bàn học',
      }),
    )
    expect(paired.data.id).toBe('82222222-0000-4000-8000-000000000001')

    const reset = requireSuccess(await gateway.resetDemo())
    expect(reset.data).toEqual({ assistantCount: 2, deviceCount: 2 })
    expect(gateway.getScenario()).toBe('happy')

    const assistants = requireSuccess(await gateway.listAssistants())
    expect(assistants.data.items.map(({ name }) => name)).toEqual(['Mây', 'Bình Minh'])
  })

  it('increments a role revision only after a matching ETag save', async () => {
    const gateway = immediateGateway()
    const current = requireSuccess(await gateway.getRoleConfig(ASSISTANT_IDS.may))
    const roleDraft = toRoleDraft(current.data.value)
    roleDraft.basePrompt = 'Trả lời rõ ràng, ấm áp và kiểm tra lại dữ kiện quan trọng.'

    const saved = requireSuccess(
      await gateway.saveRoleConfig(
        ASSISTANT_IDS.may,
        roleDraft,
        current.data.etag,
      ),
    )
    expect(saved.data.revision).toBe(current.data.revision + 1)
    expect(saved.data.value.basePrompt).toBe(roleDraft.basePrompt)
  })
})

describe('MockGateway preview scenarios', () => {
  it('serves stale reads but blocks and does not queue offline mutations', async () => {
    const gateway = immediateGateway('offline')

    const read = requireSuccess(await gateway.getRoleConfig(ASSISTANT_IDS.may))
    expect(read.meta).toMatchObject({ offline: true, freshness: 'stale' })

    const draft = toRoleDraft(read.data.value)
    draft.basePrompt = 'Nội dung không được ghi khi offline.'
    const save = requireFailure(
      await gateway.saveRoleConfig(ASSISTANT_IDS.may, draft, read.data.etag),
    )
    expect(save.problem).toMatchObject({
      type: 'offline',
      code: 'OFFLINE_MUTATION_BLOCKED',
    })

    gateway.setScenario('happy')
    const unchanged = requireSuccess(await gateway.getRoleConfig(ASSISTANT_IDS.may))
    expect(unchanged.data.value.basePrompt).toBe(read.data.value.basePrompt)
    expect(unchanged.data.etag).toBe(read.data.etag)
  })

  it('returns typed current and local drafts without overwriting on revision conflict', async () => {
    const gateway = immediateGateway()
    const current = requireSuccess(await gateway.getRoleConfig(ASSISTANT_IDS.may))
    const draft = toRoleDraft(current.data.value)
    draft.basePrompt = 'Bản nháp cục bộ phải được giữ nguyên.'

    gateway.setScenario('revision-conflict')
    const save = requireFailure(
      await gateway.saveRoleConfig(ASSISTANT_IDS.may, draft, current.data.etag),
    )
    expect(save.problem.type).toBe('revision-conflict')
    if (save.problem.type !== 'revision-conflict') return
    expect(save.problem.currentRevision).toBe(current.data.revision)
    expect(save.problem.currentEtag).toBe(current.data.etag)
    expect(save.problem.current.basePrompt).toBe(current.data.value.basePrompt)
    expect(save.problem.localDraft.basePrompt).toBe(draft.basePrompt)

    gateway.setScenario('happy')
    const unchanged = requireSuccess(await gateway.getRoleConfig(ASSISTANT_IDS.may))
    expect(unchanged.data.value.basePrompt).toBe(current.data.value.basePrompt)
  })

  it('marks only the selected provider unavailable and never performs fallback', async () => {
    const gateway = immediateGateway('provider-error')
    const workspace = requireSuccess(await gateway.getModelMemory(ASSISTANT_IDS.may))

    expect(workspace.data.value.selections).toHaveLength(6)
    const llmSelection = workspace.data.value.selections.find(({ kind }) => kind === 'llm')
    expect(llmSelection).toEqual({
      kind: 'llm',
      mode: 'selected',
      providerConfigId: PROVIDER_CONFIG_IDS.llm,
    })
    expect(
      workspace.data.value.availableConfigs.find(({ kind }) => kind === 'llm')
        ?.availability,
    ).toBe('unavailable')

    const update = requireFailure(
      await gateway.updateProviderSelection(
        ASSISTANT_IDS.may,
        {
          kind: 'llm',
          mode: 'selected',
          providerConfigId: PROVIDER_CONFIG_IDS.llm,
        },
        workspace.data.etag,
      ),
    )
    expect(update.problem).toMatchObject({
      type: 'provider-unavailable',
      providerKind: 'llm',
      providerConfigId: PROVIDER_CONFIG_IDS.llm,
    })

    gateway.setScenario('happy')
    const unchanged = requireSuccess(await gateway.getModelMemory(ASSISTANT_IDS.may))
    expect(unchanged.data.value.selections.find(({ kind }) => kind === 'llm')).toEqual(
      llmSelection,
    )
  })

  it('uses an observable deterministic delay for long actions without coupling tests to timers', async () => {
    const delays: number[] = []
    const gateway = new MockGateway({
      scenario: 'long-action',
      sleep: async (delayMs) => {
        delays.push(delayMs)
      },
    })

    const paired = requireSuccess(
      await gateway.pairDevice({
        assistantId: ASSISTANT_IDS.may,
        verificationCode: PAIRING_SUCCESS_CODE,
      }),
    )
    expect(delays).toEqual([1_400])
    expect(paired.meta.delayMs).toBe(1_400)
  })
})

describe('MockGateway dependency injection', () => {
  it('exposes one stateful instance through production and preview interfaces', () => {
    const dependencies = createMockGatewayDependencies({
      delayMs: 0,
      sleep: async () => undefined,
    })

    expect(dependencies.managerGateway).toBe(dependencies.previewControlGateway)
    expect(dependencies.assistantGateway).toBe(dependencies.managerGateway)
    expect(dependencies.providerGateway).toBe(dependencies.managerGateway)
    expect(dependencies.deviceGateway).toBe(dependencies.managerGateway)
    dependencies.previewControlGateway.setScenario('offline')
    expect(dependencies.previewControlGateway.getScenario()).toBe('offline')
  })
})
