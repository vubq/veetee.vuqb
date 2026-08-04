import type { ProviderInstallationView } from '@/domain'

export interface LocaleOption {
  value: string
  label: string
  description?: string
}

export function deriveLocaleOptions(installations: ProviderInstallationView[], currentLocale?: string): LocaleOption[] {
  const locales = new Set<string>()
  const normalizedCurrent = currentLocale?.trim()
  if (normalizedCurrent) locales.add(normalizedCurrent)
  installations
    .filter((installation) => installation.kind === 'tts')
    .forEach((installation) => {
      const values = installation.manifest.locales
      if (!Array.isArray(values)) return
      values.forEach((value) => {
        if (typeof value === 'string' && value.trim() && value.trim() !== '*') locales.add(value.trim())
      })
    })
  return [...locales].sort((left, right) => left.localeCompare(right)).map((locale) => ({
    value: locale,
    label: locale,
    description: locale === normalizedCurrent ? 'Ngôn ngữ hiện tại' : 'Từ catalog provider',
  }))
}
