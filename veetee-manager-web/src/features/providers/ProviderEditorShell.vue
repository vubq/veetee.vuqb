<script setup lang="ts">
import { computed } from 'vue'

import type { ProviderInstallationView } from '@/domain'
import VtBadge from '@/ui/primitives/VtBadge.vue'
import VtCard from '@/ui/primitives/VtCard.vue'

import SchemaConfigForm from './SchemaConfigForm.vue'
import { providerEditorProfile } from './provider-editor'

const props = defineProps<{
  installation: ProviderInstallationView
  modelValue: Record<string, unknown>
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  'validity-change': [valid: boolean]
}>()

const profile = computed(() => providerEditorProfile(props.installation))
const supportsTools = computed(() => props.installation.capabilities.some((item) => item.toLowerCase().includes('tool')))
</script>

<template>
  <section
    class="editor-shell"
    aria-label="Bộ chỉnh cấu hình provider"
  >
    <header class="editor-heading">
      <div class="editor-heading-copy">
        <p class="eyebrow">
          {{ profile.familyLabel }}
        </p>
        <h2>{{ installation.displayName ?? installation.displayNameKey }}</h2>
        <p class="muted">
          {{ profile.summary }}
        </p>
      </div>
      <div class="editor-badges">
        <VtBadge tone="primary">
          {{ profile.protocolLabel }}
        </VtBadge>
        <VtBadge
          v-if="supportsTools"
          tone="success"
        >
          Tool calling
        </VtBadge>
        <VtBadge
          v-if="profile.hasVoiceCatalog"
          tone="success"
        >
          Voice catalog
        </VtBadge>
      </div>
    </header>
    <div class="standard-contract">
      <span class="contract-label">Hợp đồng chuẩn</span>
      <span
        v-for="field in profile.standardFields"
        :key="field"
        class="contract-item"
      >
        {{ field }}
      </span>
    </div>
    <VtCard
      v-if="profile.family === 'openai-compatible'"
      class="family-note"
      :padding="false"
    >
      <strong>OpenAI-compatible</strong>
      <span>Groq, gateway nội bộ và provider tương thích dùng cùng editor. API key nằm trong Secret reference, không lưu trong config JSON.</span>
    </VtCard>
    <VtCard
      v-else-if="profile.family === 'vieneu'"
      class="family-note"
      :padding="false"
    >
      <strong>VieNeu streaming</strong>
      <span>Giữ model local và voice profile tách riêng để có thể đổi giọng mà không tạo lại installation.</span>
    </VtCard>
    <SchemaConfigForm
      :schema="installation.configSchema"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="emit('update:modelValue', $event)"
      @validity-change="emit('validity-change', $event)"
    />
  </section>
</template>

<style scoped>
.editor-shell { display: grid; gap: 12px; }
.editor-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.editor-heading-copy { min-width: 0; }
.editor-heading h2 { margin: 0; color: var(--vt-text); font-size: 14px; }
.eyebrow { margin: 0 0 3px; color: var(--vt-primary); font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.muted { max-width: 620px; margin: 4px 0 0; color: var(--vt-text-muted); font-size: 10px; line-height: 1.5; }
.editor-badges { display: flex; flex: none; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.standard-contract { display: flex; min-width: 0; align-items: center; flex-wrap: wrap; gap: 5px; border-top: 1px solid var(--vt-border); border-bottom: 1px solid var(--vt-border); padding: 8px 0; }
.contract-label { margin-right: 2px; color: var(--vt-text-muted); font-size: 9px; font-weight: 650; }
.contract-item { overflow: hidden; max-width: 180px; border: 1px solid var(--vt-border); border-radius: 999px; color: var(--vt-text-muted); padding: 3px 7px; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.family-note { display: flex; align-items: flex-start; gap: 8px; border-color: var(--vt-primary); background: var(--vt-primary-soft); padding: 9px 10px; }
.family-note strong { flex: none; color: var(--vt-primary-text); font-size: 10px; }
.family-note span { color: var(--vt-text-muted); font-size: 9px; line-height: 1.45; }
@media (max-width: 620px) { .editor-heading { display: grid; } .editor-badges { justify-content: flex-start; } .family-note { display: grid; } }
</style>
