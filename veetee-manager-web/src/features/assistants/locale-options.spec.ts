import { describe, expect, it } from 'vitest'

import { deriveLocaleOptions } from './locale-options'

describe('deriveLocaleOptions', () => {
  it('uses explicit TTS manifest locales, keeps current locale and ignores wildcard', () => {
    const options = deriveLocaleOptions([
      { id: 'tts.one', kind: 'tts', displayNameKey: 'One', version: '1', manifest: { locales: [' vi-VN ', 'en-US', '*'] }, configSchema: {} },
      { id: 'asr.one', kind: 'asr', displayNameKey: 'ASR', version: '1', manifest: { locales: ['ja-JP'] }, configSchema: {} },
      { id: 'tts.two', kind: 'tts', displayNameKey: 'Two', version: '1', manifest: { locales: ['en-US', ''] }, configSchema: {} },
    ], 'fr-FR')

    expect(options.map((option) => option.value)).toEqual(['en-US', 'fr-FR', 'vi-VN'])
    expect(options.find((option) => option.value === 'fr-FR')?.description).toBe('Ngôn ngữ hiện tại')
  })
})
