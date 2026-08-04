import { fireEvent, render } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import type { RetentionPolicy } from '@/domain'

import RetentionPolicyPanel from './RetentionPolicyPanel.vue'

const policy: RetentionPolicy = {
  ownerId: 'local-owner',
  captureTranscript: true,
  transcriptDays: 30,
  captureAudio: false,
  audioDays: null,
  effectiveAt: '2026-08-03T09:00:00.000Z',
  revision: 2,
  etag: '"retention-2"',
}

describe('RetentionPolicyPanel', () => {
  it('renders the configured policy and emits a safe transcript-only payload', async () => {
    const view = render(RetentionPolicyPanel, { props: { policy } })

    expect(view.getByRole('heading', { name: 'Lưu trữ hội thoại' })).toBeTruthy()
    expect(view.getByRole('switch', { name: 'Lưu transcript' }).getAttribute('data-state')).toBe('checked')
    expect(view.getByRole('switch', { name: 'Lưu audio recording' }).getAttribute('data-disabled')).toBe('')
    await fireEvent.click(view.getByRole('button', { name: 'Lưu retention policy' }))

    expect((view.emitted('save') as unknown[][] | undefined)?.[0]?.[0]).toEqual({
      captureTranscript: true,
      transcriptDays: 30,
      captureAudio: false,
      audioDays: null,
    })
  })

  it('clears transcript days when transcript capture is disabled', async () => {
    const view = render(RetentionPolicyPanel, { props: { policy } })
    await fireEvent.click(view.getByRole('switch', { name: 'Lưu transcript' }))
    await fireEvent.click(view.getByRole('button', { name: 'Lưu retention policy' }))

    expect((view.emitted('save') as unknown[][] | undefined)?.[0]?.[0]).toEqual({
      captureTranscript: false,
      transcriptDays: null,
      captureAudio: false,
      audioDays: null,
    })
  })

  it('announces and focuses a save error', async () => {
    const view = render(RetentionPolicyPanel, { props: { policy } })
    await view.rerender({ policy, error: 'Retention policy đã thay đổi.' })
    const alert = await view.findByRole('alert')

    expect(alert.textContent).toContain('Retention policy đã thay đổi.')
    expect(document.activeElement).toBe(alert)
  })
})
