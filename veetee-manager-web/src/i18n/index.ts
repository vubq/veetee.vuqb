import { createI18n } from 'vue-i18n'

import viVN from './vi-VN'

export const i18n = createI18n({
  legacy: false,
  locale: 'vi-VN',
  fallbackLocale: 'vi-VN',
  messages: {
    'vi-VN': viVN,
  },
})

