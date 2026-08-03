import { readonly, ref } from 'vue'

export type NoticeTone = 'success' | 'info' | 'warning' | 'error'

export interface ToastNotice {
  id: number
  title: string
  message?: string
  tone: NoticeTone
}

const notices = ref<ToastNotice[]>([])
const politeMessage = ref('')
const assertiveMessage = ref('')
let nextId = 1

export function notify(title: string, options: { message?: string; tone?: NoticeTone; assertive?: boolean; duration?: number } = {}) {
  const notice: ToastNotice = { id: nextId++, title, message: options.message, tone: options.tone ?? 'info' }
  notices.value.push(notice)
  if (options.assertive) assertiveMessage.value = `${title}. ${options.message ?? ''}`
  else politeMessage.value = `${title}. ${options.message ?? ''}`

  window.setTimeout(() => dismissNotice(notice.id), options.duration ?? 4200)
  return notice.id
}

export function announce(message: string, assertive = false) {
  if (assertive) assertiveMessage.value = message
  else politeMessage.value = message
}

export function dismissNotice(id: number) {
  notices.value = notices.value.filter((notice) => notice.id !== id)
}

export function useNotifications() {
  return {
    notices: readonly(notices),
    politeMessage: readonly(politeMessage),
    assertiveMessage: readonly(assertiveMessage),
    notify,
    announce,
    dismissNotice,
  }
}

