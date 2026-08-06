import { readonly, ref, shallowRef, type Ref, type ShallowRef } from 'vue'

import { createManagerApiClient, type ManagerApiClient } from '@/api/manager-client'

export interface AuthUser {
  id: string
  email: string
}

export type AuthStatus = 'preview' | 'checking' | 'authenticated' | 'unauthenticated' | 'authenticating'

export interface AuthFailure {
  code: string
}

export type AuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; failure: AuthFailure }

export interface AuthSession {
  readonly isApiMode: boolean
  readonly status: Readonly<Ref<AuthStatus>>
  readonly user: Readonly<ShallowRef<AuthUser | null>>
  hydrate(): Promise<AuthStatus>
  login(email: string, password: string): Promise<AuthResult>
  logout(): Promise<boolean>
}

function responseCode(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const code = (value as Record<string, unknown>).code
    if (typeof code === 'string' && code.trim()) return code
  }
  return fallback
}

export function createAuthSession(baseUrl: string, injectedClient?: ManagerApiClient): AuthSession {
  const isApiMode = Boolean(baseUrl)
  const client = isApiMode ? (injectedClient ?? createManagerApiClient(baseUrl)) : null
  const status = ref<AuthStatus>(isApiMode ? 'checking' : 'preview')
  const user = shallowRef<AuthUser | null>(null)
  let hydration: Promise<AuthStatus> | undefined
  let hasHydrated = false

  async function hydrate(): Promise<AuthStatus> {
    if (!client) {
      status.value = 'preview'
      return status.value
    }
    if (status.value === 'authenticated') return status.value
    // Route guards can run for every click. Once the cookie has been checked,
    // reuse that result for this app lifetime instead of adding one /me round
    // trip to every navigation. Login/logout explicitly invalidate the state.
    if (hasHydrated) return status.value
    if (hydration) return hydration
    hydration = (async () => {
      status.value = 'checking'
      try {
        const result = await client.GET('/api/v1/auth/me')
        if (result.response.ok && result.data?.user) {
          user.value = result.data.user
          status.value = 'authenticated'
        } else {
          user.value = null
          status.value = 'unauthenticated'
        }
      } catch {
        user.value = null
        status.value = 'unauthenticated'
      }
      hasHydrated = true
      return status.value
    })().finally(() => { hydration = undefined })
    return hydration
  }

  async function login(email: string, password: string): Promise<AuthResult> {
    if (!client) return { ok: false, failure: { code: 'PREVIEW_MODE' } }
    hasHydrated = false
    status.value = 'authenticating'
    try {
      const result = await client.POST('/api/v1/auth/login', { body: { email, password } })
      if (result.response.ok && result.data?.user) {
        user.value = result.data.user
        status.value = 'authenticated'
        hasHydrated = true
        return { ok: true, user: result.data.user }
      }
      status.value = 'unauthenticated'
      hasHydrated = true
      return { ok: false, failure: { code: responseCode(result.error, result.response.status === 429 ? 'LOGIN_THROTTLED' : 'INVALID_CREDENTIALS') } }
    } catch {
      status.value = 'unauthenticated'
      hasHydrated = true
      return { ok: false, failure: { code: 'NETWORK_UNAVAILABLE' } }
    }
  }

  async function logout(): Promise<boolean> {
    if (!client) return true
    try {
      const result = await client.POST('/api/v1/auth/logout')
      return result.response.ok || result.response.status === 401
    } catch {
      return false
    } finally {
      user.value = null
      status.value = 'unauthenticated'
      hasHydrated = true
    }
  }

  return {
    isApiMode,
    status: readonly(status),
    user: readonly(user),
    hydrate,
    login,
    logout,
  }
}

export const authSession = createAuthSession(import.meta.env.VITE_MANAGER_API_URL ?? '')
