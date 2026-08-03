import type {
  AssistantCard,
  DeviceCard,
  ModelMemoryWorkspace,
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
import { createModelMemoryFixtures } from './providers'

export interface MockState {
  assistants: Record<string, Versioned<AssistantCard>>
  roleConfigs: Record<string, Versioned<RoleConfig>>
  voices: VoiceProfile[]
  modelMemory: Record<string, Versioned<ModelMemoryWorkspace>>
  devices: DeviceCard[]
  nextAssistantSequence: number
  nextDeviceSequence: number
}

export function createInitialMockState(): MockState {
  return {
    assistants: createAssistantCardFixtures(),
    roleConfigs: createRoleConfigFixtures(),
    voices: createVoiceFixtures(),
    modelMemory: createModelMemoryFixtures(),
    devices: createDeviceFixtures(),
    nextAssistantSequence: 1,
    nextDeviceSequence: 1,
  }
}
