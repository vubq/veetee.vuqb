<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtTextArea from '@/ui/primitives/VtTextArea.vue'

import SchemaConfigField from './SchemaConfigField.vue'
import {
  advancedConfigValues,
  cloneConfig,
  isRecord,
  primitiveSchemaFields,
  schemaProperties,
  validatePrimitiveValue,
  type PrimitiveSchemaField,
} from './schema-config'

const props = withDefaults(
  defineProps<{
    schema: Record<string, unknown>
    modelValue: Record<string, unknown>
    disabled?: boolean
  }>(),
  { disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
  'validity-change': [valid: boolean]
}>()

const advancedJson = ref('{}')
const advancedError = ref<string>()
const primitiveDraft = ref<Record<string, unknown>>({})
const fieldValidity = reactive<Record<string, boolean>>({})

const fields = computed(() => primitiveSchemaFields(props.schema))
const primitiveKeys = computed(() => new Set(fields.value.map((field) => field.key)))
const schemaAdvancedKeys = computed(() => Object.entries(schemaProperties(props.schema))
  .filter(([key]) => !primitiveKeys.value.has(key))
  .map(([key]) => key))
const advancedKeys = computed(() => {
  const keys = new Set(schemaAdvancedKeys.value)
  Object.keys(advancedConfigValues(props.schema, props.modelValue)).forEach((key) => keys.add(key))
  return [...keys]
})
const hasAdvancedFields = computed(() => advancedKeys.value.length > 0 || fields.value.length === 0)
const formValid = computed(() => !advancedError.value && fields.value.every((field) => fieldValidity[field.key] !== false))

function requiredKeys(): string[] {
  return Array.isArray(props.schema.required)
    ? props.schema.required.filter((value): value is string => typeof value === 'string')
    : []
}

function parseAdvanced(value: string): Record<string, unknown> | undefined {
  if (!value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function stripPrimitiveKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !primitiveKeys.value.has(key)))
}

function setAdvancedError(parsed: Record<string, unknown> | undefined) {
  if (!parsed) {
    advancedError.value = 'JSON nâng cao không hợp lệ; cần một object JSON.'
    return
  }
  const missing = requiredKeys().filter((key) => !primitiveKeys.value.has(key) && !(key in parsed))
  advancedError.value = missing.length > 0 ? `Thiếu field bắt buộc: ${missing.join(', ')}.` : undefined
  if (!advancedError.value) advancedJson.value = JSON.stringify(stripPrimitiveKeys(parsed), null, 2)
}

function emitConfig() {
  const parsed = parseAdvanced(advancedJson.value)
  if (!parsed) return
  const next = { ...stripPrimitiveKeys(parsed) }
  Object.entries(primitiveDraft.value).forEach(([key, value]) => {
    if (value === undefined) delete next[key]
    else next[key] = value
  })
  emit('update:modelValue', next)
}

function updatePrimitive(field: PrimitiveSchemaField, value: unknown) {
  const next = { ...primitiveDraft.value }
  if (value === undefined) delete next[field.key]
  else next[field.key] = value
  primitiveDraft.value = next
  emitConfig()
}

function updateFieldValidity(field: PrimitiveSchemaField, valid: boolean) {
  fieldValidity[field.key] = valid
}

function updateAdvanced(value: string) {
  advancedJson.value = value
  const parsed = parseAdvanced(value)
  setAdvancedError(parsed)
  if (!advancedError.value) emitConfig()
}

function syncFromModel() {
  const config = cloneConfig(props.modelValue)
  const nextPrimitive: Record<string, unknown> = {}
  fields.value.forEach((field) => {
    const value = config[field.key] === undefined ? field.defaultValue : config[field.key]
    if (value !== undefined) nextPrimitive[field.key] = value
    fieldValidity[field.key] = validatePrimitiveValue(field, value) === undefined
  })
  primitiveDraft.value = nextPrimitive
  const advanced = advancedConfigValues(props.schema, config)
  advancedJson.value = JSON.stringify(advanced, null, 2)
  setAdvancedError(advanced)
}

watch(
  () => [props.schema, props.modelValue] as const,
  syncFromModel,
  { deep: true, immediate: true },
)

watch(formValid, (valid) => emit('validity-change', valid), { immediate: true })
</script>

<template>
  <section
    class="schema-config-form"
    aria-label="Provider configuration fields"
  >
    <div
      v-if="fields.length > 0"
      class="schema-fields"
    >
      <SchemaConfigField
        v-for="field in fields"
        :key="field.key"
        :field="field"
        :model-value="primitiveDraft[field.key]"
        :disabled="disabled"
        @update:model-value="updatePrimitive(field, $event)"
        @validity-change="updateFieldValidity(field, $event)"
      />
    </div>
    <VtFormField
      v-if="hasAdvancedFields"
      label="Advanced JSON"
      for-id="provider-config-advanced"
      :hint="`Object/array hoặc field mở rộng: ${advancedKeys.join(', ')}`"
      :error="advancedError"
    >
      <template #default="{ describedby }">
        <VtTextArea
          id="provider-config-advanced"
          :model-value="advancedJson"
          :rows="10"
          :disabled="disabled"
          :invalid="Boolean(advancedError)"
          :aria-describedby="describedby"
          spellcheck="false"
          @update:model-value="updateAdvanced"
        />
      </template>
    </VtFormField>
    <p
      v-else-if="fields.length === 0"
      class="schema-empty"
    >
      Schema chưa khai báo field primitive; cấu hình được giữ ở advanced JSON của provider.
    </p>
  </section>
</template>

<style scoped>
.schema-config-form { display: grid; gap: 14px; min-width: 0; }
.schema-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.schema-switch-field { grid-column: span 1; }
.schema-empty { margin: 0; color: var(--vt-text-muted); font-size: 11px; line-height: 1.5; }
@media (max-width: 620px) { .schema-fields { grid-template-columns: 1fr; } }
</style>
