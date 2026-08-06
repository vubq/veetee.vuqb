import type { DeviceCard } from '@/domain'

import { ASSISTANT_IDS } from './assistants'

export const PAIRING_SUCCESS_CODE = '260812'

export function createDeviceFixtures(): DeviceCard[] {
  return [
    {
      id: '71111111-1111-4111-8111-111111111111',
      assistantId: ASSISTANT_IDS.may,
      etag: '"preview-device-1"',
      displayName: 'Veetee phòng làm việc',
      maskedMac: 'A4:CF:12:••:••:9D',
      firmwareVersion: '0.1.0-preview.3',
      board: 'ESP32-S3 N16R8',
      onlineState: 'online',
      lastSeenAt: '2026-08-03T08:44:00.000Z',
      lastConversationAt: '2026-08-03T08:42:00.000Z',
    },
    {
      id: '72222222-2222-4222-8222-222222222222',
      assistantId: ASSISTANT_IDS.may,
      etag: '"preview-device-2"',
      displayName: 'Veetee phòng khách',
      maskedMac: 'A4:CF:12:••:••:2A',
      firmwareVersion: '0.1.0-preview.2',
      board: 'ESP32-S3 N16R8',
      onlineState: 'offline',
      lastSeenAt: '2026-08-02T22:10:00.000Z',
      lastConversationAt: '2026-08-02T21:56:00.000Z',
    },
  ]
}
