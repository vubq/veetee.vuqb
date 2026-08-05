<script setup lang="ts">
import { computed } from 'vue'

import type { ProviderConfigRecord, ProviderInstallationView, ProviderKind } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

const props = defineProps<{
  installations: ProviderInstallationView[]
  configs: ProviderConfigRecord[]
  selectedId: string
  kind: ProviderKind
}>()

const emit = defineEmits<{ select: [id: string] }>()

const cards = computed(() => props.installations.map((installation) => ({
  installation,
  configCount: props.configs.filter((config) => config.installationId === installation.id).length,
  family: installation.providerFamily === 'openai-compatible' ? 'OpenAI-compatible' : installation.providerFamily === 'vieneu' ? 'VieNeu' : 'Manifest schema',
})))

function localeLabel(value: string) {
  if (value === '*' || value === '') return 'Đa ngôn ngữ'
  if (value === 'vi' || value === 'vi-VN') return 'Tiếng Việt'
  if (value === 'en' || value === 'en-US') return 'English'
  return value
}
</script>

<template>
  <VtCard class="installation-card">
    <header class="installation-heading">
      <div>
        <p class="eyebrow">
          Catalog của capability
        </p>
        <h2>Provider đã sẵn sàng</h2>
        <p class="muted">
          Chọn một installation để tạo nhiều cấu hình độc lập. Installation là loại provider; cấu hình bên dưới là dữ liệu riêng của bạn.
        </p>
      </div>
      <VtBadge tone="primary">
        {{ cards.length }} installation
      </VtBadge>
    </header>
    <ul
      v-if="cards.length"
      class="installation-list"
    >
      <li
        v-for="card in cards"
        :key="card.installation.id"
        class="installation-row"
        :class="{ selected: card.installation.id === selectedId }"
      >
        <button
          class="installation-main"
          type="button"
          :aria-pressed="card.installation.id === selectedId"
          @click="emit('select', card.installation.id)"
        >
          <span class="installation-copy">
            <strong :title="card.installation.displayName ?? card.installation.displayNameKey">{{ card.installation.displayName ?? card.installation.displayNameKey }}</strong>
            <span :title="`${card.family} · v${card.installation.version}`">{{ card.family }} · v{{ card.installation.version }}</span>
            <small :title="card.installation.supportedLocales.map(localeLabel).join(', ')">
              {{ card.installation.supportedLocales.length ? card.installation.supportedLocales.map(localeLabel).join(', ') : 'Đa ngôn ngữ' }}
            </small>
          </span>
          <span class="installation-meta">
            <VtStatus
              tone="online"
              label="Đã nạp"
            />
            <VtBadge>{{ card.configCount }} config</VtBadge>
          </span>
        </button>
        <VtButton
          size="sm"
          :variant="card.installation.id === selectedId ? 'primary' : 'secondary'"
          @click="emit('select', card.installation.id)"
        >
          {{ card.installation.id === selectedId ? 'Đang chọn' : 'Chọn' }}
        </VtButton>
      </li>
    </ul>
    <p
      v-else
      class="installation-empty"
    >
      Capability này chưa có installation trong catalog.
    </p>
  </VtCard>
</template>

<style scoped>
.installation-card { display: grid; gap: 12px; }
.installation-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.installation-heading h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.eyebrow { margin: 0 0 3px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.muted { max-width: 720px; margin: 4px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.5; }
.installation-list { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
.installation-row { display: flex; min-width: 0; align-items: center; gap: 9px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); background: var(--vt-surface-subtle); padding: 7px 8px 7px 10px; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition); }
.installation-row:hover, .installation-row.selected { border-color: var(--vt-primary); background: var(--vt-primary-soft); box-shadow: 0 0 0 2px rgba(47, 107, 255, .07); }
.installation-main { display: flex; min-width: 0; flex: 1; align-items: center; justify-content: space-between; gap: 10px; border: 0; background: transparent; color: inherit; padding: 2px 0; text-align: left; }
.installation-main:focus-visible { border-radius: 4px; box-shadow: 0 0 0 3px var(--vt-focus); outline: none; }
.installation-copy { display: grid; min-width: 0; gap: 2px; }
.installation-copy strong, .installation-copy span, .installation-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.installation-copy strong { color: var(--vt-text); font-size: 11px; font-weight: 650; }
.installation-copy span { color: var(--vt-text-muted); font-size: 9px; }
.installation-copy small { color: var(--vt-text-muted); font-size: 8px; }
.installation-meta { display: flex; flex: none; align-items: center; gap: 8px; }
.installation-empty { margin: 0; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 17px; font-size: 10px; text-align: center; }
@media (max-width: 600px) { .installation-row { align-items: flex-start; flex-wrap: wrap; } .installation-main { width: 100%; } .installation-row > .vt-button { margin-left: auto; } }
</style>
