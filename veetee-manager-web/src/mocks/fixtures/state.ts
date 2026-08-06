import type {
  AssistantCard,
  DeviceCard,
  ModelMemoryWorkspace,
  ProviderConfigRecord,
  ProviderInstallationView,
  RoleConfig,
  SecretReference,
  Versioned,
  VoiceProfile,
  ModelConfigRecord,
  ModelProviderRecord,
} from '@/domain'

import {
  createAssistantCardFixtures,
  createRoleConfigFixtures,
  createVoiceFixtures,
} from './assistants'
import { createDeviceFixtures } from './devices'
import { createModelMemoryFixtures, createProviderRegistryFixtures } from './providers'
import { createModelRegistryFixtures } from './model-registry'

export interface MockState {
  assistants: Record<string, Versioned<AssistantCard>>
  roleConfigs: Record<string, Versioned<RoleConfig>>
  voices: VoiceProfile[]
  modelMemory: Record<string, Versioned<ModelMemoryWorkspace>>
  providerInstallations: ProviderInstallationView[]
  providerConfigs: ProviderConfigRecord[]
  modelProviders: ModelProviderRecord[]
  modelConfigs: ModelConfigRecord[]
  secretReferences: SecretReference[]
  devices: DeviceCard[]
  nextAssistantSequence: number
  nextDeviceSequence: number
}

export function createInitialMockState(): MockState {
  const providerRegistry = createProviderRegistryFixtures()
  const modelRegistry = createModelRegistryFixtures()
  return {
    assistants: createAssistantCardFixtures(),
    roleConfigs: createRoleConfigFixtures(),
    voices: createVoiceFixtures(),
    modelMemory: createModelMemoryFixtures(),
    providerInstallations: providerRegistry.installations,
    providerConfigs: providerRegistry.configs,
    modelProviders: modelRegistry.providers,
    modelConfigs: modelRegistry.configs,
    secretReferences: [{
      id: 'secret-preview-groq',
      name: 'Groq test key',
      store: 'encrypted-local',
      locatorMasked: 'encrypted-local',
      version: 1,
      metadataRevision: 1,
      status: 'available',
      lastRotatedAt: '2026-08-03T08:00:00.000Z',
      etag: '"secret-preview-groq-rev-1"',
      updatedAt: '2026-08-03T08:00:00.000Z',
    }],
    devices: createDeviceFixtures(),
    nextAssistantSequence: 1,
    nextDeviceSequence: 1,
  }
}
