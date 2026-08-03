import { fireEvent, render } from '@testing-library/vue'

import VtInput from './VtInput.vue'

describe('VtInput', () => {
  it('giữ semantic input và emit model update', async () => {
    const { emitted, getByRole } = render(VtInput, {
      attrs: { 'aria-label': 'Tên trợ lý' },
      props: { modelValue: '' },
    })

    const input = getByRole('textbox', { name: 'Tên trợ lý' })
    await fireEvent.update(input, 'Mây')
    expect(emitted()['update:modelValue']?.[0]).toEqual(['Mây'])
  })

  it('liên kết trạng thái lỗi với aria-invalid', () => {
    const { getByRole } = render(VtInput, {
      attrs: { 'aria-label': 'Mã xác thực' },
      props: { invalid: true },
    })

    expect(getByRole('textbox', { name: 'Mã xác thực' }).getAttribute('aria-invalid')).toBe('true')
  })
})
