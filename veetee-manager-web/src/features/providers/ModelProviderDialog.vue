<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import type { ModelProviderField, ModelProviderRecord, ModelType } from '@/domain'
import VtButton from '@/ui/primitives/VtButton.vue'
import VtDialog from '@/ui/primitives/VtDialog.vue'
import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtIcon from '@/ui/primitives/VtIcon.vue'
import VtIconButton from '@/ui/primitives/VtIconButton.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'

import { MODEL_TYPE_LABELS, MODEL_TYPE_ORDER } from './model-registry-labels'

type ProviderDraft = {
  modelType: ModelType
  providerCode: string
  name: string
  sort: string
  fields: Array<ModelProviderField & { defaultText: string }>
}

const props = withDefaults(defineProps<{
  open: boolean
  provider?: ModelProviderRecord
  saving?: boolean
}>(), { provider: undefined, saving: false })

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [value: { modelType: ModelType; providerCode: string; name: string; fields: ModelProviderField[]; sort: number }]
}>()

const draft = ref<ProviderDraft>(emptyDraft())
const formError = ref('')
const modelTypeOptions = computed<VtSelectOption[]>(() => MODEL_TYPE_ORDER.map((value) => ({ value, label: MODEL_TYPE_LABELS[value] })))
const fieldTypeOptions: VtSelectOption[] = [
  { value: 'string', label: 'Chuỗi (string)' },
  { value: 'number', label: 'Số (number)' },
  { value: 'boolean', label: 'Bật/tắt (boolean)' },
  { value: 'password', label: 'Bí mật (password)' },
  { value: 'dict', label: 'Đối tượng (dict)' },
  { value: 'array', label: 'Danh sách (array)' },
  { value: 'int', label: 'Số nguyên (int)' },
  { value: 'integer', label: 'Số nguyên (integer)' },
  { value: 'float', label: 'Số thực (float)' },
]

const editing = computed(() => Boolean(props.provider))
const title = computed(() => editing.value ? 'Sửa provider' : 'Thêm provider')
const description = computed(() => editing.value ? 'Cập nhật schema của provider. Model đã dùng provider này vẫn được giữ nguyên.' : 'Khai báo provider một lần; các model bên dưới sẽ dùng đúng schema này.')

watch(() => props.open, (open) => {
  if (open) {
    draft.value = props.provider ? fromProvider(props.provider) : emptyDraft()
    formError.value = ''
  }
}, { immediate: true })

function emptyDraft(): ProviderDraft {
  return { modelType: 'LLM', providerCode: '', name: '', sort: '0', fields: [] }
}

function fromProvider(provider: ModelProviderRecord): ProviderDraft {
  return {
    modelType: provider.modelType,
    providerCode: provider.providerCode,
    name: provider.name,
    sort: String(provider.sort),
    fields: provider.fields.map((field) => ({ ...field, defaultText: serializeDefault(field.default) })),
  }
}

function serializeDefault(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return '' }
}

function addField() {
  draft.value.fields.push({ key: '', label: '', type: 'string', defaultText: '', sensitive: false })
}

function removeField(index: number) {
  draft.value.fields.splice(index, 1)
}

function parseDefault(field: ModelProviderField & { defaultText: string }): unknown {
  if (!field.defaultText.trim()) return undefined
  if (field.type === 'number' || field.type === 'int' || field.type === 'integer' || field.type === 'float') {
    const number = Number(field.defaultText)
    return Number.isFinite(number) ? (field.type === 'int' || field.type === 'integer' ? Math.trunc(number) : number) : field.defaultText
  }
  if (field.type === 'boolean') return field.defaultText.trim().toLocaleLowerCase() === 'true'
  if (field.type === 'dict' || field.type === 'array') {
    try { return JSON.parse(field.defaultText) } catch { return field.defaultText }
  }
  return field.defaultText
}

function submit() {
  const value = draft.value
  if (!value.providerCode.trim() || !value.name.trim()) {
    formError.value = 'Vui lòng nhập mã và tên provider.'
    return
  }
  const normalizedFields = value.fields.map(({ defaultText, ...field }) => ({
    ...field,
    key: field.key.trim(),
    label: field.label.trim(),
    ...(defaultText.trim() ? { default: parseDefault({ ...field, defaultText }) } : {}),
  }))
  if (normalizedFields.some((field) => !field.key || !field.label)) {
    formError.value = 'Mỗi trường cần có key và nhãn hiển thị.'
    return
  }
  if (new Set(normalizedFields.map((field) => field.key)).size !== normalizedFields.length) {
    formError.value = 'Key của các trường không được trùng nhau.'
    return
  }
  formError.value = ''
  emit('save', { modelType: value.modelType, providerCode: value.providerCode.trim(), name: value.name.trim(), fields: normalizedFields, sort: Math.max(0, Number(value.sort) || 0) })
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
    <div class="provider-form">
      <div class="form-grid form-grid-three">
        <VtFormField
          label="Danh mục"
          for-id="provider-model-type"
          hint="Danh mục dùng để lọc trong Model Configuration."
        >
          <VtSelect
            id="provider-model-type"
            v-model="draft.modelType"
            label="Danh mục provider"
            :options="modelTypeOptions"
          />
        </VtFormField>
        <VtFormField
          label="Mã provider"
          for-id="provider-code"
          hint="Ví dụ: groq, openai, silero."
        >
          <VtInput
            id="provider-code"
            v-model="draft.providerCode"
            name="provider-code"
            autocomplete="off"
            placeholder="provider_code"
          />
        </VtFormField>
        <VtFormField
          label="Thứ tự"
          for-id="provider-sort"
          hint="Số nhỏ được hiển thị trước."
        >
          <VtInput
            id="provider-sort"
            v-model="draft.sort"
            type="number"
            min="0"
            name="provider-sort"
          />
        </VtFormField>
      </div>

      <VtFormField
        label="Tên provider"
        for-id="provider-name"
        hint="Tên thân thiện hiển thị trong bảng model."
      >
        <VtInput
          id="provider-name"
          v-model="draft.name"
          name="provider-name"
          autocomplete="off"
          placeholder="Tên provider"
        />
      </VtFormField>

      <section class="fields-editor">
        <header class="section-heading">
          <div><h3>Danh sách trường</h3><p>Schema của source: key, label, type và giá trị mặc định.</p></div>
          <VtButton
            size="sm"
            @click="addField"
          >
            <template #leading>
              <VtIcon
                :icon="Plus"
                :size="14"
              />
            </template>Thêm trường
          </VtButton>
        </header>
        <div
          v-if="draft.fields.length === 0"
          class="fields-empty"
        >
          Provider không có trường bắt buộc. Bạn vẫn có thể lưu và cấu hình model bằng `configJson`.
        </div>
        <div
          v-for="(field, index) in draft.fields"
          :key="`${index}-${field.key}`"
          class="field-editor-row"
        >
          <VtInput
            v-model="field.key"
            :aria-label="`Key trường ${index + 1}`"
            placeholder="key"
          />
          <VtInput
            v-model="field.label"
            :aria-label="`Nhãn trường ${index + 1}`"
            placeholder="Nhãn hiển thị"
          />
          <VtSelect
            v-model="field.type"
            :label="`Kiểu trường ${index + 1}`"
            :options="fieldTypeOptions"
          />
          <VtInput
            v-model="field.defaultText"
            :aria-label="`Mặc định trường ${index + 1}`"
            placeholder="Mặc định (tuỳ chọn)"
          />
          <VtSwitch
            v-model="field.sensitive"
            :label="`Bí mật ${index + 1}`"
            aria-label="Đánh dấu trường bí mật"
          />
          <VtIconButton
            :icon="Trash2"
            :label="`Xóa trường ${field.key || index + 1}`"
            variant="danger"
            size="sm"
            @click="removeField(index)"
          />
        </div>
      </section>
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
        @click="submit"
      >
        {{ editing ? 'Lưu thay đổi' : 'Thêm provider' }}
      </VtButton>
    </template>
  </VtDialog>
</template>

<style scoped>
.provider-form { display: grid; gap: 16px; }
.form-grid { display: grid; gap: 12px; }
.form-grid-three { grid-template-columns: 1.05fr 1fr .5fr; }
.fields-editor { display: grid; gap: 10px; border-top: 1px solid var(--vt-border); padding-top: 15px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-heading h3 { margin: 0; color: var(--vt-text); font-size: 13px; }
.section-heading p { margin: 2px 0 0; color: var(--vt-text-muted); font-size: 10px; }
.fields-empty { border: 1px dashed var(--vt-border-strong); border-radius: var(--vt-radius-control); color: var(--vt-text-muted); padding: 13px; font-size: 11px; }
.field-editor-row { display: grid; grid-template-columns: 1fr 1.2fr 1fr 1fr auto 32px; align-items: center; gap: 7px; }
.form-error { margin: 0; border-radius: var(--vt-radius-control); background: var(--vt-danger-soft); color: var(--vt-danger); padding: 9px 10px; font-size: 11px; }
@media (max-width: 800px) { .form-grid-three { grid-template-columns: 1fr 1fr; }.field-editor-row { grid-template-columns: 1fr 1fr; }.field-editor-row :deep(.vt-switch-label) { justify-self: start; } }
@media (max-width: 520px) { .form-grid-three { grid-template-columns: 1fr; }.section-heading { align-items: flex-start; flex-direction: column; }.field-editor-row { grid-template-columns: 1fr; } }
</style>
