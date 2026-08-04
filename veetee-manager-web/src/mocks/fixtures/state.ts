import type {
  AssistantCard,
  DeviceCard,
  ModelMemoryWorkspace,
  ProviderConfigRecord,
  ProviderInstallationView,
  RoleConfig,
  Versioned,
  VoiceProfile,
} from '@/domain'

import {
  createAssistantCardFixtures,
  createRoleConfigFixtures,
  createVoiceFixtures,
} from './assistants'
import { createDeviceFixtures } from './devices'
import { createModelMemoryFixtures, createProviderRegistryFixtures } from './providers'

export interface MockState {
  assistants: Record<string, Versioned<AssistantCard>>
  roleConfigs: Record<string, Versioned<RoleConfig>>
  voices: VoiceProfile[]
  modelMemory: Record<string, Versioned<ModelMemoryWorkspace>>
  providerInstallations: ProviderInstallationView[]
  providerConfigs: ProviderConfigRecord[]
  devices: DeviceCard[]
  nextAssistantSequence: number
  nextDeviceSequence: number
}

export function createInitialMockState(): MockState {
  const providerRegistry = createProviderRegistryFixtures()
  return {
    assistants: createAssistantCardFixtures(),
    roleConfigs: createRoleConfigFixtures(),
    voices: createVoiceFixtures(),
    modelMemory: createModelMemoryFixtures(),
    providerInstallations: providerRegistry.installations,
    providerConfigs: providerRegistry.configs,
    devices: createDeviceFixtures(),
    nextAssistantSequence: 1,
    nextDeviceSequence: 1,
  }
}
