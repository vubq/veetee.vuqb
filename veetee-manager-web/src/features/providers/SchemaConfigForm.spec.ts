import { fireEvent, render } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'

import SchemaConfigForm from './SchemaConfigForm.vue'
import { decodeEnumValue, encodeEnumValue } from './schema-config'

const schema = {
  type: 'object',
  required: ['endpoint', 'maxTokens', 'enabled'],
  properties: {
    endpoint: { type: 'string', format: 'uri' },
    model: { type: 'string' },
    maxTokens: { type: 'integer', minimum: 1, maximum: 1000 },
    enabled: { type: 'boolean' },
    mode: { type: 'string', enum: ['fast', 'accurate'] },
    rules: { type: 'array', items: { type: 'object' } },
  },
}

const initial = {
  endpoint: 'https://provider.test/v1',
  model: 'baseline',
  maxTokens: 120,
  enabled: true,
  mode: 'fast',
  rules: [{ action: 'continue' }],
  unknownField: 'preserve-me',
}

function renderForm(overrides: Record<string, unknown> = {}) {
  const onUpdate = vi.fn()
  const onValidity = vi.fn()
  const view = render(SchemaConfigForm, {
    props: {
      schema,
      modelValue: initial,
      'onUpdate:modelValue': onUpdate,
      'onValidity-change': onValidity,
      ...overrides,
    },
  })
  return { view, onUpdate, onValidity }
}

function lastConfig(onUpdate: ReturnType<typeof vi.fn>) {
  const value = onUpdate.mock.lastCall?.[0]
  return value as Record<string, unknown>
}

describe('SchemaConfigForm', () => {
  it('renders primitive fields from schema without provider-specific keys', async () => {
    const { view } = renderForm()

    expect(await view.findByRole('textbox', { name: 'Địa chỉ dịch vụ' })).toBeTruthy()
    expect(view.getByRole('textbox', { name: 'Mô hình trả lời' })).toBeTruthy()
    expect(view.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Bật dịch vụ' })).toBeTruthy()
    expect(view.getByRole('combobox', { name: 'Chế độ tổng hợp' })).toBeTruthy()
    expect(view.getByRole('textbox', { name: 'Cấu hình nâng cao' })).toBeTruthy()
  })

  it('coerces numeric and enum values while preserving unknown/advanced config', async () => {
    const { view, onUpdate } = renderForm()

    await fireEvent.update(view.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' }), '240')
    const value = lastConfig(onUpdate)
    expect(value.maxTokens).toBe(240)
    expect(value.unknownField).toBe('preserve-me')
    expect(value.rules).toEqual([{ action: 'continue' }])

    expect(decodeEnumValue(encodeEnumValue('accurate'))).toBe('accurate')
  })

  it('uses VtSwitch for boolean fields and emits typed values', async () => {
    const { view, onUpdate } = renderForm()

    await fireEvent.click(view.getByRole('switch', { name: 'Bật dịch vụ' }))
    expect(lastConfig(onUpdate).enabled).toBe(false)
  })

  it('keeps the draft and reports invalid advanced JSON', async () => {
    const { view, onUpdate, onValidity } = renderForm()
    const before = onUpdate.mock.calls.length

    await fireEvent.update(view.getByRole('textbox', { name: 'Cấu hình nâng cao' }), '{')

    expect(await view.findByText('JSON nâng cao không hợp lệ; cần một object JSON.')).toBeTruthy()
    expect(onUpdate.mock.calls.length).toBe(before)
    expect(onValidity).toHaveBeenCalledWith(false)
  })

  it('validates advanced values against the schema before emitting a draft', async () => {
    const { view, onUpdate } = renderForm()
    const before = onUpdate.mock.calls.length

    await fireEvent.update(
      view.getByRole('textbox', { name: 'Cấu hình nâng cao' }),
      JSON.stringify({ rules: 'not-an-array', unknownField: 'preserve-me' }),
    )

    expect(await view.findByText(/advanced\.rules có type không hợp lệ/)).toBeTruthy()
    expect(onUpdate.mock.calls.length).toBe(before)
  })

  it('validates URI primitive fields before emitting a draft', async () => {
    const { view, onUpdate } = renderForm()
    const before = onUpdate.mock.calls.length

    await fireEvent.update(view.getByRole('textbox', { name: 'Địa chỉ dịch vụ' }), 'not-a-uri')

    expect(await view.findByText('Cần một URI hợp lệ.')).toBeTruthy()
    expect(onUpdate.mock.calls.length).toBe(before)
  })
})
