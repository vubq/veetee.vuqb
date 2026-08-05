import { createRouter, createWebHistory, type RouteRecordRaw, type RouterHistory } from 'vue-router'

import { authSession, type AuthSession } from '@/auth/auth-session'
import LoginView from '@/views/LoginView.vue'
import NotFoundView from '@/views/NotFoundView.vue'

const AssistantIndexView = () => import('@/views/AssistantIndexView.vue')
const AssistantModelMemoryView = () => import('@/views/AssistantModelMemoryView.vue')
const AssistantRoleView = () => import('@/views/AssistantRoleView.vue')
const AssistantDevicesView = () => import('@/views/AssistantDevicesView.vue')
const AssistantHistoryView = () => import('@/views/AssistantHistoryView.vue')
const ProviderRegistryView = () => import('@/views/ProviderRegistryView.vue')

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/assistants' },
  { path: '/login', name: 'login', component: LoginView, meta: { title: 'Đăng nhập', public: true } },
  {
    path: '/assistants',
    name: 'assistants',
    component: AssistantIndexView,
    meta: { title: 'Trợ lý' },
  },
  {
    path: '/assistants/:id/config/role',
    name: 'assistant-role',
    component: AssistantRoleView,
    meta: { title: 'Vai trò & giọng nói' },
  },
  {
    path: '/assistants/:id/config/model-memory',
    name: 'assistant-model-memory',
    component: AssistantModelMemoryView,
    meta: { title: 'Mô hình & bộ nhớ' },
  },
  {
    path: '/assistants/:id/devices',
    name: 'assistant-devices',
    component: AssistantDevicesView,
    meta: { title: 'Thiết bị' },
  },
  {
    path: '/assistants/:id/history',
    name: 'assistant-history',
    component: AssistantHistoryView,
    meta: { title: 'Lịch sử hội thoại' },
  },
  { path: '/providers', name: 'providers', component: ProviderRegistryView, meta: { title: 'Dịch vụ AI' } },
]

if (import.meta.env.DEV && !import.meta.env.VITE_MANAGER_API_URL) {
  routes.push({
    path: '/_preview/components',
    name: 'component-preview',
    component: () => import('@/views/ComponentPreviewView.vue'),
    meta: { title: 'Thư viện giao diện' },
  })
}

routes.push({ path: '/:pathMatch(.*)*', component: NotFoundView })

/**
 * Create an isolated router for the application or a memory-history test.
 * Keeping the session and history injectable makes the auth boundary
 * deterministic without mutating the singleton used by the browser app.
 */
export function createVeeteeRouter(
  session: AuthSession = authSession,
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
) {
  const instance = createRouter({
    history,
    routes,
    scrollBehavior: () => ({ top: 0 }),
  })

  instance.beforeEach(async (to) => {
    const publicRoute = to.meta.public === true || to.name === 'login'
    const status = await session.hydrate()
    if (publicRoute) {
      if (to.name === 'login' && status === 'authenticated') return { path: safeRedirect(to.query.redirect) }
      return true
    }
    if (!session.isApiMode || status === 'authenticated' || status === 'preview') return true
    return { name: 'login', query: { redirect: to.fullPath } }
  })

  instance.afterEach((to) => {
    const title = typeof to.meta.title === 'string' ? to.meta.title : 'Bảng điều khiển'
    document.title = `${title} · Veetee`
  })

  return instance
}

export const router = createVeeteeRouter()

function safeRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/assistants'
}
