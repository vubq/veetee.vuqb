<script setup lang="ts">
import { ArrowLeft, Bot, BrainCircuit, Cpu, History, UserRound } from '@lucide/vue'

import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtStatus from '@/ui/primitives/VtStatus.vue'

defineProps<{
  assistant: {
    id: string
    name: string
    locale: string
    status: string
  }
  sectionTitle: string
  sectionDescription: string
  revisionLabel?: string
}>()

const links = [
  { name: 'assistant-role', label: 'Vai trò & giọng nói', icon: UserRound },
  { name: 'assistant-model-memory', label: 'Mô hình & bộ nhớ', icon: BrainCircuit },
  { name: 'assistant-devices', label: 'Thiết bị', icon: Cpu },
  { name: 'assistant-history', label: 'Lịch sử hội thoại', icon: History },
]

function localeLabel(locale: string) {
  return locale === 'vi-VN' ? 'Tiếng Việt' : locale === 'en-US' ? 'Tiếng Anh' : locale
}
</script>

<template>
  <main
    id="main-content"
    class="page-container"
  >
    <section class="assistant-heading">
      <RouterLink
        class="back-link"
        to="/assistants"
        aria-label="Quay lại danh sách trợ lý"
      >
        <VtIcon
          :icon="ArrowLeft"
          :size="17"
        />
      </RouterLink>
      <span class="assistant-avatar"><VtIcon
        :icon="Bot"
        :size="20"
      /></span>
      <div class="assistant-identity">
        <h1>{{ assistant.name }}</h1>
        <p>
          <VtStatus
            :tone="assistant.status === 'online' ? 'online' : 'neutral'"
            :label="assistant.status === 'online' ? 'Trực tuyến' : 'Ngoại tuyến'"
          /><span aria-hidden="true">·</span>{{ localeLabel(assistant.locale) }}
        </p>
      </div>
      <div
        v-if="$slots.headingActions"
        class="heading-actions"
      >
        <slot name="headingActions" />
      </div>
    </section>

    <section class="assistant-workspace">
      <aside class="workspace-navigation">
        <p class="navigation-label">
          Cấu hình trợ lý
        </p>
        <nav aria-label="Cấu hình trợ lý">
          <RouterLink
            v-for="link in links"
            :key="link.name"
            class="workspace-link"
            :to="{ name: link.name, params: { id: assistant.id } }"
          >
            <VtIcon
              :icon="link.icon"
              :size="16"
            />
            <span>{{ link.label }}</span>
          </RouterLink>
        </nav>
      </aside>

      <section class="workspace-main">
        <header class="workspace-header">
          <div><h2>{{ sectionTitle }}</h2><p>{{ sectionDescription }}</p></div>
          <span
            v-if="revisionLabel"
            class="revision-label"
          >{{ revisionLabel }}</span>
        </header>
        <div class="workspace-content">
          <slot />
        </div>
      </section>
    </section>
  </main>
</template>

<style scoped>
.assistant-heading { display: flex; min-height: 76px; align-items: center; gap: 10px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); padding: 13px 15px; }
.back-link { display: inline-grid; width: 32px; height: 32px; flex: none; place-items: center; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-button); color: var(--vt-text-soft); text-decoration: none; transition: border-color var(--vt-transition), background var(--vt-transition), box-shadow var(--vt-transition); }
.back-link:hover { border-color: var(--vt-border-hover); background: var(--vt-surface-muted); }
.back-link:focus-visible { border-color: var(--vt-primary); box-shadow: 0 0 0 3px var(--vt-focus); }
.assistant-avatar { display: inline-grid; width: 38px; height: 38px; flex: none; place-items: center; border: 1px solid #d9cbf8; border-radius: 9px; background: #f2ecff; color: #6c42bf; }
.assistant-identity { min-width: 0; }
.assistant-identity h1 { margin: 0; overflow: hidden; font-size: 15px; font-weight: 650; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.assistant-identity p { display: flex; align-items: center; gap: 6px; margin: 3px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.heading-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.assistant-workspace { display: grid; min-height: 520px; grid-template-columns: 220px minmax(0, 1fr); overflow: hidden; margin-top: 14px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-card); background: var(--vt-surface); }
.workspace-navigation { border-right: 1px solid var(--vt-border); background: var(--vt-page); padding: 15px 11px; }
.navigation-label { margin: 3px 9px 8px; color: var(--vt-text-faint); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.workspace-navigation nav { display: grid; gap: 3px; }
.workspace-link { display: flex; min-height: 37px; align-items: center; gap: 9px; border-radius: var(--vt-radius-button); color: var(--vt-text-muted); padding: 0 10px; font-size: 11px; font-weight: 500; text-decoration: none; transition: background var(--vt-transition), color var(--vt-transition), box-shadow var(--vt-transition); }
.workspace-link:hover { background: #edf2f6; color: var(--vt-text); }
.workspace-link.router-link-active { background: #e6edf5; color: var(--vt-text); font-weight: 600; }
.workspace-link:focus-visible { box-shadow: 0 0 0 3px var(--vt-focus); }
.workspace-main { min-width: 0; background: #f8fbfd; }
.workspace-header { display: flex; min-height: 72px; align-items: center; gap: 12px; border-bottom: 1px solid var(--vt-border); background: var(--vt-surface); padding: 12px 20px; }
.workspace-header h2 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.4; }
.workspace-header p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.revision-label { margin-left: auto; border-radius: 4px; background: var(--vt-surface-muted); color: var(--vt-text-muted); padding: 4px 7px; font-size: 9px; white-space: nowrap; }
.workspace-content { max-width: 800px; padding: 18px 20px 30px; }
@media (max-width: 820px) {
  .assistant-workspace { grid-template-columns: 1fr; }
  .workspace-navigation { overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--vt-border); padding: 9px 10px; }
  .navigation-label { display: none; }
  .workspace-navigation nav { display: flex; min-width: max-content; }
  .workspace-link { min-height: 35px; }
}
@media (max-width: 600px) {
  .assistant-heading { align-items: flex-start; flex-wrap: wrap; }
  .heading-actions { width: 100%; margin-left: 0; padding-left: 42px; }
  .workspace-header { align-items: flex-start; padding: 13px 14px; }
  .workspace-content { padding: 14px 12px 24px; }
  .workspace-link { padding-inline: 8px; font-size: 10px; }
}
</style>
