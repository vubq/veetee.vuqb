<script setup lang="ts">
import { Bot, MessageSquareText, Wifi } from '@lucide/vue'

import type { AssistantCard } from '@/domain'
import VtCard from '@/ui/primitives/VtCard.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'

const props = defineProps<{ assistants: AssistantCard[] }>()

const onlineDevices = () => props.assistants.reduce((total, assistant) => total + assistant.onlineDeviceCount, 0)
const devices = () => props.assistants.reduce((total, assistant) => total + assistant.deviceCount, 0)
const withConversation = () => props.assistants.filter((assistant) => assistant.lastConversationAt).length
</script>

<template>
  <section
    class="overview-summary"
    aria-label="Tổng quan"
  >
    <VtCard class="summary-card">
      <span class="summary-icon is-blue"><VtIcon
        :icon="Bot"
        :size="16"
      /></span>
      <span class="summary-copy"><strong>{{ assistants.length }}</strong><span>Trợ lý</span></span>
    </VtCard>
    <VtCard class="summary-card">
      <span class="summary-icon is-green"><VtIcon
        :icon="Wifi"
        :size="16"
      /></span>
      <span class="summary-copy"><strong>{{ onlineDevices() }}/{{ devices() }}</strong><span>Thiết bị đang kết nối</span></span>
    </VtCard>
    <VtCard class="summary-card">
      <span class="summary-icon is-purple"><VtIcon
        :icon="MessageSquareText"
        :size="16"
      /></span>
      <span class="summary-copy"><strong>{{ withConversation() }}</strong><span>Trợ lý đã có hội thoại</span></span>
    </VtCard>
  </section>
</template>

<style scoped>
.overview-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 15px; }
.summary-card { display: flex; min-height: 68px; align-items: center; gap: 10px; padding: 12px 13px; }
.summary-icon { display: inline-grid; width: 31px; height: 31px; flex: none; place-items: center; border: 1px solid var(--vt-border); border-radius: 8px; }
.summary-icon.is-blue { border-color: #cddcff; background: var(--vt-primary-soft); color: var(--vt-primary); }
.summary-icon.is-green { border-color: #c5eadc; background: var(--vt-success-soft); color: var(--vt-success); }
.summary-icon.is-purple { border-color: #ded2f8; background: #f4efff; color: #6c42bf; }
.summary-copy { display: grid; min-width: 0; gap: 1px; }
.summary-copy strong { color: var(--vt-text); font-size: 17px; font-weight: 650; line-height: 1.2; }
.summary-copy span { overflow: hidden; color: var(--vt-text-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 620px) { .overview-summary { grid-template-columns: 1fr; } }
</style>
