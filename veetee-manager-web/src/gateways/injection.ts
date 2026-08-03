import type { InjectionKey } from 'vue'

import type {
  AssistantGateway,
  DeviceGateway,
  ManagerGateway,
  PreviewControlGateway,
  ProviderGateway,
} from './manager-gateway'

export const managerGatewayKey: InjectionKey<ManagerGateway> = Symbol(
  'veetee.manager-gateway',
)

export const assistantGatewayKey: InjectionKey<AssistantGateway> = Symbol(
  'veetee.assistant-gateway',
)

export const providerGatewayKey: InjectionKey<ProviderGateway> = Symbol(
  'veetee.provider-gateway',
)

export const deviceGatewayKey: InjectionKey<DeviceGateway> = Symbol(
  'veetee.device-gateway',
)

export const previewControlGatewayKey: InjectionKey<PreviewControlGateway> = Symbol(
  'veetee.preview-control-gateway',
)
