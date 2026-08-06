<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { ModelConfigRecord, ModelProviderField, ModelProviderRecord, ModelType } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'

import { localizedFieldLabel, localizedModelName, localizedProviderName, MODEL_TYPE_LABELS } from './model-registry-labels'

type ConfigDraft = {
  id: string
  modelCode: string
  modelName: string
  providerCode: string
  isDefault: boolean
  isEnabled: boolean
  docLink: string
  remark: string
  sort: string
  config: Record<string, unknown>
  advancedText: string
}

const props = withDefaults(defineProps<{
  open: boolean
  model?: ModelConfigRecord
  duplicate?: boolean
  modelType: ModelType
  providers: ModelProviderRecord[]
  saving?: boolean
}>(), { model: undefined, duplicate: false, saving: false })

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: { modelType: ModelType; providerCode: string; id?: string; modelCode: string; modelName: string; isDefault: boolean; isEnabled: boolean; configJson: Record<string, unknown>; docLink: string | null; remark: string | null; sort: number }]
}>()

const draft = ref<ConfigDraft>(emptyDraft())
const formError = ref('')

const availableProviders = computed(() => props.providers.filter((provider) => provider.modelType === props.modelType).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)))
const providerOptions = computed<VtSelectOption[]>(() => availableProviders.value.map((provider) => ({ value: provider.providerCode, label: localizedProviderName(provider), description: provider.providerCode })))
const selectedProvider = computed(() => availableProviders.value.find((provider) => provider.providerCode === draft.value.providerCode))
const title = computed(() => props.duplicate ? 'Nhân bản model' : props.model ? 'Sửa model' : 'Thêm model')
const description = computed(() => `${MODEL_TYPE_LABELS[props.modelType]} · cấu hình theo schema provider`)

watch(() => props.open, (open) => {
  if (open) {
    draft.value = props.model ? fromModel(props.model, props.duplicate) : emptyDraft()
    if (!draft.value.providerCode && availableProviders.value[0]) draft.value.providerCode = availableProviders.value[0].providerCode
    formError.value = ''
  }
}, { immediate: true })

watch(() => draft.value.providerCode, () => {
  const provider = selectedProvider.value
  if (!provider) return
  for (const field of provider.fields) {
    if (!(field.key in draft.value.config) && field.default !== undefined) draft.value.config[field.key] = structuredClone(field.default)
  }
})

function emptyDraft(): ConfigDraft {
  return { id: '', modelCode: '', modelName: '', providerCode: '', isDefault: false, isEnabled: true, docLink: '', remark: '', sort: '0', config: {}, advancedText: '{}' }
}

function fromModel(model: ModelConfigRecord, duplicate: boolean): ConfigDraft {
  const config = structuredClone(model.configJson)
  return {
    id: duplicate ? '' : model.id,
    modelCode: duplicate ? `${model.modelCode}_copy` : model.modelCode,
    modelName: duplicate ? `${localizedModelName(model)} (bản sao)` : localizedModelName(model),
    providerCode: model.providerCode,
    isDefault: duplicate ? false : model.isDefault,
    isEnabled: model.isEnabled,
    docLink: model.docLink ?? '',
    remark: model.remark ?? '',
    sort: String(model.sort),
    config,
    advancedText: stringify(config),
  }
}

function stringify(value: Record<string, unknown>): string {
  try { return JSON.stringify(value, null, 2) } catch { return '{}' }
}

function valueFor(field: ModelProviderField): string {
  const value = draft.value.config[field.key]
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return '' }
}

function setField(field: ModelProviderField, value: string) {
  if (field.type === 'number' || field.type === 'int' || field.type === 'integer' || field.type === 'float') {
    const parsed = Number(value)
    draft.value.config[field.key] = value === '' ? undefined : Number.isFinite(parsed) ? (field.type === 'int' || field.type === 'integer' ? Math.trunc(parsed) : parsed) : value
  } else if (field.type === 'dict' || field.type === 'array') {
    try { draft.value.config[field.key] = value.trim() ? JSON.parse(value) : undefined } catch { draft.value.config[field.key] = value }
  } else {
    draft.value.config[field.key] = value
  }
}

function setBoolean(field: ModelProviderField, value: boolean) {
  draft.value.config[field.key] = value
}

function submit() {
  const value = draft.value
  if (!value.modelCode.trim() || !value.modelName.trim() || !value.providerCode) {
    formError.value = 'Vui lòng nhập model code, tên model và provider.'
    return
  }
  let advanced: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(value.advancedText || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) advanced = parsed
  } catch {
    formError.value = 'JSON nâng cao không hợp lệ.'
    return
  }
  const configJson = { ...advanced, ...Object.fromEntries(Object.entries(value.config).filter(([, fieldValue]) => fieldValue !== undefined)) }
  formError.value = ''
  emit('save', { modelType: props.modelType, providerCode: value.providerCode, ...(value.id ? { id: value.id } : {}), modelCode: value.modelCode.trim(), modelName: value.modelName.trim(), isDefault: value.isDefault, isEnabled: value.isEnabled, configJson, docLink: value.docLink.trim() || null, remark: value.remark.trim() || null, sort: Math.max(0, Number(value.sort) || 0) })
}
</script>

<template>
  <VtDialog
    :open="open"
    :title="title"
    :description="description"
    width="lg"
    @update:open="emit('update:open', $event)"
  >
    <div class="model-form">
      <div class="form-grid-three">
        <VtFormField
          label="Provider"
          for-id="model-provider"
        >
          <VtSelect
            id="model-provider"
            v-model="draft.providerCode"
            label="Provider của model"
            :options="providerOptions"
            :disabled="providerOptions.length === 0"
          />
        </VtFormField>
        <VtFormField
          label="Model ID"
          for-id="model-code"
          hint="ID ổn định để runtime tham chiếu."
        >
          <VtInput
            id="model-code"
            v-model="draft.modelCode"
            name="model-code"
            placeholder="ModelCode"
          />
        </VtFormField>
        <VtFormField
          label="Thứ tự"
          for-id="model-sort"
        >
          <VtInput
            id="model-sort"
            v-model="draft.sort"
            type="number"
            min="0"
            name="model-sort"
          />
        </VtFormField>
      </div>
      <VtFormField
        label="Tên model"
        for-id="model-name"
      >
        <VtInput
          id="model-name"
          v-model="draft.modelName"
          name="model-name"
          placeholder="Tên hiển thị"
        />
      </VtFormField>
      <div class="status-row">
        <VtSwitch
          v-model="draft.isEnabled"
          label="Đang bật"
        />
        <VtSwitch
          v-model="draft.isDefault"
          label="Model mặc định"
        />
      </div>

      <section class="schema-section">
        <header>
          <div>
            <h3>Thông số provider</h3><p v-if="selectedProvider">
              {{ localizedProviderName(selectedProvider) }} · {{ selectedProvider.fields.length }} trường theo schema.
            </p><p v-else>
              Chưa có provider cho danh mục này.
            </p>
          </div>
        </header>
        <div
          v-if="selectedProvider && selectedProvider.fields.length"
          class="schema-grid"
        >
          <VtFormField
            v-for="field in selectedProvider.fields"
            :key="field.key"
            :label="localizedFieldLabel(field)"
            :for-id="`model-field-${field.key}`"
            :hint="`${field.key}${field.sensitive ? ' · giá trị bí mật' : ''}`"
          >
            <VtSwitch
              v-if="field.type === 'boolean'"
              :id="`model-field-${field.key}`"
              :model-value="Boolean(draft.config[field.key])"
              :label="localizedFieldLabel(field)"
              @update:model-value="setBoolean(field, $event)"
            />
            <VtTextArea
              v-else-if="field.type === 'dict' || field.type === 'array'"
              :id="`model-field-${field.key}`"
              :model-value="valueFor(field)"
              :rows="3"
              :placeholder="field.type === 'array' ? '[]' : '{}'"
              @update:model-value="setField(field, $event)"
            />
            <VtInput
              v-else
              :id="`model-field-${field.key}`"
              :model-value="valueFor(field)"
              :type="['number', 'int', 'integer', 'float'].includes(field.type) ? 'number' : field.type === 'password' ? 'password' : 'text'"
              :step="field.type === 'int' || field.type === 'integer' ? 1 : field.type === 'float' ? 'any' : undefined"
              :placeholder="field.sensitive ? 'Secret reference (không hiển thị giá trị)' : undefined"
              @update:model-value="setField(field, $event)"
            />
          </VtFormField>
        </div>
        <p
          v-else
          class="schema-empty"
        >
          Provider này không có trường động. Bạn có thể nhập configJson nâng cao bên dưới.
        </p>
      </section>

      <details class="advanced-section">
        <summary>Config JSON nâng cao</summary>
        <VtTextArea
          v-model="draft.advancedText"
          :rows="7"
          aria-label="Config JSON nâng cao"
          spellcheck="false"
        />
      </details>

      <div class="form-grid-two">
        <VtFormField
          label="Link tài liệu"
          for-id="model-doc-link"
          optional
        >
          <VtInput
            id="model-doc-link"
            v-model="draft.docLink"
            type="url"
            placeholder="https://…"
          />
        </VtFormField>
        <VtFormField
          label="Ghi chú"
          for-id="model-remark"
          optional
        >
          <VtInput
            id="model-remark"
            v-model="draft.remark"
            placeholder="Mô tả ngắn"
          />
        </VtFormField>
      </div>
      <p
        v-if="formError"
        class="form-error"
        role="alert"
      >
        {{ formError }}
      </p>
    </div>
    <template #footer>
      <VtButton @click="emit('update:open', false)">
        Hủy
      </VtButton>
      <VtButton
        variant="primary"
        :loading="saving"
        :disabled="providerOptions.length === 0"
        @click="submit"
      >
        {{ props.model && !duplicate ? 'Lưu thay đổi' : 'Thêm model' }}
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.model-form { display: grid; gap: 15px; }
.form-grid-three, .form-grid-two { display: grid; gap: 12px; }
.form-grid-three { grid-template-columns: 1.1fr 1fr .5fr; }
.form-grid-two { grid-template-columns: 1fr 1fr; }
.status-row { display: flex; flex-wrap: wrap; gap: 18px; border-block: 1px solid var(--vt-border); padding-block: 12px; }
.schema-section { display: grid; gap: 11px; border-top: 1px solid var(--vt-border); padding-top: 15px; }
.schema-section header h3 { margin: 0; color: var(--vt-text); font-size: 13px; }
.schema-section header p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.schema-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.schema-empty { margin: 0; border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 12px; font-size: 11px; }
.advanced-section { display: grid; gap: 9px; border: 1px solid var(--vt-border); border-radius: var(--vt-radius-control); padding: 10px 11px; }
.advanced-section summary { cursor: pointer; color: var(--vt-text-soft); font-size: 11px; font-weight: 600; }
.form-error { margin: 0; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 9px 10px; font-size: 11px; }
@media (max-width: 700px) { .form-grid-three, .form-grid-two, .schema-grid { grid-template-columns: 1fr; } }
</style>
