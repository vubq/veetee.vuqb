import { describe, expect, it, vi } from 'vitest'

import { downloadJsonFile } from './conversation-export'

describe('downloadJsonFile', () => {
  it('creates a short-lived JSON download without persisting application state', () => {
    const anchor = document.createElement('a')
    const body = { appendChild: vi.fn(), removeChild: vi.fn() } as unknown as HTMLElement
    const createElement = vi.fn(() => anchor)
    const createObjectURL = vi.fn(() => 'blob:conversation-export')
    const revokeObjectURL = vi.fn()
    vi.spyOn(anchor, 'click').mockImplementation(() => undefined)

    downloadJsonFile({ exportVersion: 1, conversation: { summary: { id: 'conversation-1' } } }, 'conversation.json', {
      documentRef: { createElement, body },
      urlApi: { createObjectURL, revokeObjectURL },
    })

    expect(createElement).toHaveBeenCalledWith('a')
    expect(anchor.download).toBe('conversation.json')
    expect(anchor.href).toContain('blob:conversation-export')
    expect(body.appendChild).toHaveBeenCalledWith(anchor)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:conversation-export')
  })
})
