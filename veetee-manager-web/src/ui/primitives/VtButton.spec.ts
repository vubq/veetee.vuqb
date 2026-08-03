import { fireEvent, render } from '@testing-library/vue'

import VtButton from './VtButton.vue'

describe('VtButton', () => {
  it('chặn double submit và thông báo loading', async () => {
    const { getByRole } = render(VtButton, {
      props: { loading: true },
      slots: { default: 'Lưu bản nháp' },
    })

    const button = getByRole('button', { name: 'Lưu bản nháp' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    await fireEvent.click(button)
  })

  it('emit click ở trạng thái sẵn sàng', async () => {
    const { emitted, getByRole } = render(VtButton, {
      slots: { default: 'Lưu' },
    })

    await fireEvent.click(getByRole('button', { name: 'Lưu' }))
    expect(emitted().click).toHaveLength(1)
  })
})
