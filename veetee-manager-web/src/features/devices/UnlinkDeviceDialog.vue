<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { DeviceCard } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'

defineProps<{
  open: boolean
  device?: DeviceCard
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: []
}>()

const { t } = useI18n()
</script>

<template>
  <VtDialog
    :open="open"
    :title="t('devices.unlink.title')"
    :description="t('devices.unlink.description', { name: device?.displayName ?? '' })"
    width="sm"
    :prevent-close="loading"
    @update:open="emit('update:open', $event)"
  >
    <div
      class="unlink-body"
      :aria-busy="loading || undefined"
    >
      <dl
        v-if="device"
        class="unlink-summary"
      >
        <div>
          <dt>{{ t('devices.unlink.deviceLabel') }}</dt>
          <dd>{{ device.displayName }}</dd>
        </div>
        <div>
          <dt>{{ t('devices.unlink.addressLabel') }}</dt>
          <dd>{{ device.maskedMac }}</dd>
        </div>
      </dl>
      <p class="unlink-warning">
        {{ t('devices.unlink.warning') }}
      </p>
      <p
        v-if="error"
        class="unlink-error"
        role="alert"
        aria-live="assertive"
      >
        {{ error }}
      </p>
    </div>
    <template #footer>
      <VtButton
        :disabled="loading"
        @click="emit('update:open', false)"
      >
        {{ t('common.cancel') }}
      </VtButton>
      <VtButton
        variant="danger"
        :loading="loading"
        @click="emit('confirm')"
      >
        {{ t('devices.unlink.confirm') }}
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.unlink-body { display: grid; gap: 12px; color: var(--vt-text-soft); font-size: 12px; line-height: 1.55; }
.unlink-summary { display: grid; gap: 7px; margin: 0; border: 1px solid var(--vt-border); border-radius: 7px; background: var(--vt-surface-subtle); padding: 10px 11px; }
.unlink-summary div { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.unlink-summary dt { color: var(--vt-text-muted); font-size: 10px; }
.unlink-summary dd { min-width: 0; margin: 0; overflow: hidden; color: var(--vt-text); font-size: 11px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.unlink-warning { margin: 0; }
.unlink-error { margin: 0; border: 1px solid var(--vt-danger); border-radius: 6px; background: var(--vt-danger-soft); color: var(--vt-danger); padding: 8px 10px; }
</style>
