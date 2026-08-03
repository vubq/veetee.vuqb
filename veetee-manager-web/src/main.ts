import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import {
  assistantGatewayKey,
  deviceGatewayKey,
  managerGatewayKey,
  previewControlGatewayKey,
  providerGatewayKey,
} from './gateways'
import { i18n } from './i18n'
import { createMockGatewayDependencies } from './mocks'
import { router } from './app/router'
import './assets/main.css'

const app = createApp(App)
const gateways = createMockGatewayDependencies()

app.use(createPinia())
app.use(router)
app.use(i18n)
app.provide(managerGatewayKey, gateways.managerGateway)
app.provide(assistantGatewayKey, gateways.assistantGateway)
app.provide(providerGatewayKey, gateways.providerGateway)
app.provide(deviceGatewayKey, gateways.deviceGateway)
app.provide(previewControlGatewayKey, gateways.previewControlGateway)
app.mount('#app')
