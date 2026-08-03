import createClient, { type Client, type Middleware } from 'openapi-fetch'

import type { paths } from './generated'

export type ManagerApiClient = Client<paths>

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Create the only browser-side HTTP client used by Manager Web.
 *
 * The OpenAPI artifact supplies path, parameter, body and response types. The
 * small middleware layer owns browser session details so feature code never
 * stores credentials or hand-writes endpoint serialization.
 */
export function createManagerApiClient(baseUrl: string): ManagerApiClient {
  let csrfToken: string | undefined
  let csrfHydration: Promise<void> | undefined

  const hydrateCsrf = async (): Promise<void> => {
    if (csrfToken) return
    if (!csrfHydration) {
      csrfHydration = fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/auth/me`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
        .then(async (response) => {
          if (!response.ok) return
          const body: unknown = await response.json().catch(() => undefined)
          if (isJsonRecord(body) && typeof body.csrfToken === 'string') csrfToken = body.csrfToken
        })
        .catch(() => undefined)
        .finally(() => { csrfHydration = undefined })
    }
    await csrfHydration
  }

  const sessionMiddleware: Middleware = {
    onRequest: async ({ request }) => {
      const pathname = new URL(request.url).pathname
      if (unsafeMethods.has(request.method) && !pathname.endsWith('/auth/login')) {
        await hydrateCsrf()
        if (csrfToken) {
          const headers = new Headers(request.headers)
          headers.set('X-Veetee-CSRF', csrfToken)
          return new Request(request, { headers })
        }
      }
      return request
    },
    onResponse: async ({ request, response }) => {
      const pathname = new URL(request.url).pathname
      if (pathname.endsWith('/auth/login') || pathname.endsWith('/auth/me')) {
        const body: unknown = await response.clone().json().catch(() => undefined)
        if (isJsonRecord(body) && typeof body.csrfToken === 'string') csrfToken = body.csrfToken
      }
      if (pathname.endsWith('/auth/logout') && response.ok) csrfToken = undefined
      return response
    },
  }

  const client = createClient<paths>({
    baseUrl: baseUrl.replace(/\/$/, ''),
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  client.use(sessionMiddleware)
  return client
}
