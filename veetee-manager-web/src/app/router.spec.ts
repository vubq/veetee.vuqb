import { createMemoryHistory } from 'vue-router'
import { ref, shallowRef } from 'vue'

import type { AuthSession, AuthStatus } from '@/auth/auth-session'
import { createVeeteeRouter } from './router'

function session(status: AuthStatus, isApiMode = true): AuthSession {
  const current = ref(status)
  return {
    isApiMode,
    status: current,
    user: shallowRef(null),
    hydrate: async () => current.value,
    login: async () => ({ ok: false, failure: { code: 'TEST' } }),
    logout: async () => true,
  }
}

describe('router auth boundary', () => {
  it('redirects unauthenticated API navigation and preserves the intended path', async () => {
    const router = createVeeteeRouter(session('unauthenticated'), createMemoryHistory())

    await router.push('/assistants/assistant-1/config/role')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/assistants/assistant-1/config/role')
  })

  it('keeps preview navigation public and updates the document title', async () => {
    const router = createVeeteeRouter(session('preview', false), createMemoryHistory())

    await router.push('/providers')

    expect(router.currentRoute.value.name).toBe('providers')
    expect(document.title).toBe('Dịch vụ AI · Veetee')
  })

  it('uses only safe internal redirects after an authenticated login visit', async () => {
    const router = createVeeteeRouter(session('authenticated'), createMemoryHistory())

    await router.push({ name: 'login', query: { redirect: '//evil.example/path' } })
    expect(router.currentRoute.value.path).toBe('/assistants')

    await router.push({ name: 'login', query: { redirect: '/providers' } })
    expect(router.currentRoute.value.path).toBe('/providers')
  })
})
