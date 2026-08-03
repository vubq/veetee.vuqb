import { inject, type InjectionKey } from 'vue'

export function requireInjection<T>(key: InjectionKey<T>, name: string): T {
  const value = inject(key)
  if (value === undefined) throw new Error(`${name} chưa được cung cấp`)
  return value
}

