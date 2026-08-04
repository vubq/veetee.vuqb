<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import VtFormField from '@/ui/primitives/VtFormField.vue'
import VtInput from '@/ui/primitives/VtInput.vue'
import VtSelect, { type VtSelectOption } from '@/ui/primitives/VtSelect.vue'
import VtSwitch from '@/ui/primitives/VtSwitch.vue'

import {
  decodeEnumValue,
  encodeEnumValue,
  formatSchemaConstraint,
  type PrimitiveSchemaField,
  validatePrimitiveValue,
  valueForField,
} from './schema-config'

const props = withDefaults(
  defineProps<{
    field: PrimitiveSchemaField
    modelValue?: unknown
    disabled?: boolean
    idPrefix?: string
  }>(),
  { modelValue: undefined, disabled: false, idPrefix: 'provider-config' },
)

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
  'validity-change': [valid: boolean]
}>()

const inputText = ref('')
const inputError = ref<string>()
const fieldId = computed(() => `${props.idPrefix}-${props.field.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
const effectiveValue = computed(() => valueForField(props.field, props.modelValue))
const constraintHint = computed(() => formatSchemaConstraint(props.field))
const hint = computed(() => [props.field.description, constraintHint.value].filter(Boolean).join(' · ') || undefined)
const enumOptions = computed<VtSelectOption[]>(() => props.field.enumValues.map((value) => ({
  value: encodeEnumValue(value),
  label: value === null ? 'null' : String(value),
})))

function textValue(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function announceValidity(error?: string) {
  inputError.value = error
  emit('validity-change', !error)
}

function validateAndEmit(value: unknown, rawValue = value) {
  const error = validatePrimitiveValue(props.field, value)
  announceValidity(error)
  inputText.value = textValue(rawValue)
  if (!error) emit('update:modelValue', value)
}

function updateInput(value: string) {
  inputText.value = value
  if (props.field.type === 'string') {
    validateAndEmit(value, value)
    return
  }
  if (value.trim() === '') {
    if (props.field.required) {
      announceValidity('Trường này bắt buộc.')
      return
    }
    announceValidity()
    emit('update:modelValue', undefined)
    return
  }
  const parsed = Number(value)
  validateAndEmit(Number.isFinite(parsed) ? parsed : Number.NaN, value)
}

function updateSelect(value: string) {
  validateAndEmit(decodeEnumValue(value))
}

function updateSwitch(value: boolean) {
  validateAndEmit(value)
}

watch(
  () => [props.modelValue, props.field.key, props.field.defaultValue] as const,
  ([value]) => {
    inputText.value = textValue(valueForField(props.field, value))
    announceValidity(validatePrimitiveValue(props.field, value))
  },
  { immediate: true },
)
</script>

<template>
  <VtFormField
    v-if="field.type !== 'boolean'"
    :label="field.label"
    :for-id="fieldId"
    :optional="!field.required"
    :hint="hint"
    :error="inputError"
  >
    <template #default="{ describedby }">
      <VtSelect
        v-if="field.enumValues.length > 0"
        :id="fieldId"
        :model-value="effectiveValue === undefined ? '' : encodeEnumValue(effectiveValue)"
        :options="enumOptions"
        :label="field.label"
        :disabled="disabled"
        :invalid="Boolean(inputError)"
        :aria-describedby="describedby"
        @update:model-value="updateSelect"
      />
      <VtInput
        v-else
        :id="fieldId"
        :model-value="inputText"
        :type="field.type === 'string' ? (field.format === 'uri' ? 'url' : 'text') : 'number'"
        :step="field.type === 'integer' ? 1 : 'any'"
        :min="field.minimum"
        :max="field.maximum"
        :disabled="disabled"
        :invalid="Boolean(inputError)"
        :aria-describedby="describedby"
        @update:model-value="updateInput"
      />
    </template>
  </VtFormField>
  <div
    v-else
    class="schema-switch-field"
  >
    <VtSwitch
      :model-value="Boolean(effectiveValue)"
      :label="field.label"
      :disabled="disabled"
      @update:model-value="updateSwitch"
    />
    <p
      v-if="hint"
      class="schema-switch-hint"
    >
      {{ hint }}
    </p>
    <p
      v-if="inputError"
      class="schema-switch-error"
      role="alert"
    >
      {{ inputError }}
    </p>
  </div>
</template>

<style scoped>
.schema-switch-field { display: grid; gap: 5px; min-width: 0; }
.schema-switch-hint, .schema-switch-error { margin: 0 1px; color: var(--vt-text-muted); font-size: 11px; line-height: 1.45; }
.schema-switch-error { color: var(--vt-danger); }
</style>
