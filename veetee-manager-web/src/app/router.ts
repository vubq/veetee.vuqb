import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import AssistantIndexView from '@/views/AssistantIndexView.vue'
import AssistantModelMemoryView from '@/views/AssistantModelMemoryView.vue'
import AssistantRoleView from '@/views/AssistantRoleView.vue'
import AssistantDevicesView from '@/views/AssistantDevicesView.vue'
import AssistantHistoryView from '@/views/AssistantHistoryView.vue'
import NotFoundView from '@/views/NotFoundView.vue'
import ProviderRegistryView from '@/views/ProviderRegistryView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/assistants' },
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
  { path: '/providers', name: 'providers', component: ProviderRegistryView, meta: { title: 'Provider registry' } },
]

if (import.meta.env.DEV) {
  routes.push({
    path: '/_preview/components',
    name: 'component-preview',
    component: () => import('@/views/ComponentPreviewView.vue'),
    meta: { title: 'Thư viện giao diện' },
  })
}

routes.push({ path: '/:pathMatch(.*)*', component: NotFoundView })

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : 'Bảng điều khiển'
  document.title = `${title} · Veetee`
})
