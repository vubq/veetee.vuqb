export type PrimitiveSchemaType = 'string' | 'number' | 'integer' | 'boolean'

export interface JsonSchemaNode {
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  properties?: Record<string, unknown>
  [key: string]: unknown
}

export interface PrimitiveSchemaField {
  key: string
  label: string
  type: PrimitiveSchemaType
  description?: string
  format?: string
  enumValues: unknown[]
  required: boolean
  defaultValue?: unknown
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
}

const primitiveTypes = new Set<PrimitiveSchemaType>(['string', 'number', 'integer', 'boolean'])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function schemaProperties(schema: Record<string, unknown>): Record<string, JsonSchemaNode> {
  if (!isRecord(schema.properties)) return {}
  return Object.fromEntries(
    Object.entries(schema.properties).filter(([, value]) => isRecord(value)) as [string, JsonSchemaNode][],
  )
}

function schemaType(node: JsonSchemaNode): PrimitiveSchemaType | undefined {
  if (typeof node.type === 'string' && primitiveTypes.has(node.type as PrimitiveSchemaType)) {
    return node.type as PrimitiveSchemaType
  }
  if (Array.isArray(node.type)) {
    const types = node.type.filter((value): value is PrimitiveSchemaType => typeof value === 'string' && primitiveTypes.has(value as PrimitiveSchemaType))
    if (types.length === 1 && node.type.length === 1) return types[0]
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum.filter((value) => value !== null)
    const first = values[0]
    if (typeof first === 'string' || typeof first === 'boolean') {
      if (values.every((value) => typeof value === typeof first)) return typeof first as PrimitiveSchemaType
    }
    if (typeof first === 'number' && values.every((value) => typeof value === 'number')) {
      return values.every((value) => Number.isInteger(value)) ? 'integer' : 'number'
    }
  }
  return undefined
}

export function humanizeSchemaKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (!words) return key
  const acronyms = new Set(['api', 'asr', 'cpu', 'cuda', 'gpu', 'http', 'https', 'id', 'json', 'llm', 'mcp', 'onnx', 'ram', 'tts', 'uri', 'url', 'vad', 'vram'])
  return words.split(/\s+/u).map((word, index) => {
    const normalized = word.toLocaleLowerCase('en-US')
    if (acronyms.has(normalized)) return normalized.toUpperCase()
    return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word
  }).join(' ')
}

export function primitiveSchemaFields(schema: Record<string, unknown>): PrimitiveSchemaField[] {
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [],
  )
  return Object.entries(schemaProperties(schema)).flatMap(([key, node]) => {
    const type = schemaType(node)
    if (!type) return []
    return [{
      key,
      label: typeof node.title === 'string' && node.title.trim() ? node.title : humanizeSchemaKey(key),
      type,
      description: typeof node.description === 'string' ? node.description : undefined,
      format: typeof node.format === 'string' ? node.format : undefined,
      enumValues: Array.isArray(node.enum) ? [...node.enum] : [],
      required: required.has(key),
      defaultValue: node.default,
      minimum: typeof node.minimum === 'number' ? node.minimum : undefined,
      maximum: typeof node.maximum === 'number' ? node.maximum : undefined,
      minLength: typeof node.minLength === 'number' ? node.minLength : undefined,
      maxLength: typeof node.maxLength === 'number' ? node.maxLength : undefined,
    } satisfies PrimitiveSchemaField]
  })
}

export function advancedConfigValues(schema: Record<string, unknown>, config: Record<string, unknown>): Record<string, unknown> {
  const primitiveKeys = new Set(primitiveSchemaFields(schema).map((field) => field.key))
  return Object.fromEntries(Object.entries(config).filter(([key]) => !primitiveKeys.has(key)))
}

export function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>
}

export function encodeEnumValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

export function decodeEnumValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export function formatSchemaConstraint(field: PrimitiveSchemaField): string | undefined {
  const parts: string[] = []
  if (field.minimum !== undefined) parts.push(`min ${field.minimum}`)
  if (field.maximum !== undefined) parts.push(`max ${field.maximum}`)
  if (field.minLength !== undefined) parts.push(`tối thiểu ${field.minLength} ký tự`)
  if (field.maxLength !== undefined) parts.push(`tối đa ${field.maxLength} ký tự`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function valueForField(field: PrimitiveSchemaField, value: unknown): unknown {
  return value === undefined ? field.defaultValue : value
}

export function validatePrimitiveValue(field: PrimitiveSchemaField, value: unknown): string | undefined {
  const effective = valueForField(field, value)
  if (effective === undefined || effective === null) return field.required ? 'Trường này bắt buộc.' : undefined
  if (field.type === 'string') {
    if (typeof effective !== 'string') return 'Giá trị phải là chuỗi.'
    if (field.required && effective.trim().length === 0) return 'Trường này bắt buộc.'
    if (field.minLength !== undefined && effective.length < field.minLength) return `Cần ít nhất ${field.minLength} ký tự.`
    if (field.maxLength !== undefined && effective.length > field.maxLength) return `Không được quá ${field.maxLength} ký tự.`
    if (field.format === 'uri') {
      try {
        const parsed = new URL(effective)
        if (!parsed.protocol || !parsed.hostname) return 'Cần một URI hợp lệ.'
      } catch {
        return 'Cần một URI hợp lệ.'
      }
    }
  } else if (field.type === 'number' || field.type === 'integer') {
    if (typeof effective !== 'number' || !Number.isFinite(effective)) return 'Giá trị phải là số hợp lệ.'
    if (field.type === 'integer' && !Number.isInteger(effective)) return 'Giá trị phải là số nguyên.'
    if (field.minimum !== undefined && effective < field.minimum) return `Giá trị phải từ ${field.minimum} trở lên.`
    if (field.maximum !== undefined && effective > field.maximum) return `Giá trị phải không quá ${field.maximum}.`
  } else if (typeof effective !== 'boolean') {
    return 'Giá trị phải là boolean.'
  }
  if (field.enumValues.length > 0 && !field.enumValues.some((candidate) => Object.is(candidate, effective))) {
    return 'Giá trị không nằm trong danh sách cho phép.'
  }
  return undefined
}

/**
 * Validate the schema-owned advanced portion before sending it to the API.
 * This intentionally follows the catalog's JSON Schema subset instead of
 * branching on provider names, so a new provider can add fields without a Web
 * code change. The API remains the authoritative validation boundary.
 */
export function validateSchemaValue(schema: Record<string, unknown>, value: unknown, path = 'config'): string | undefined {
  const expected = schema.type
  const typeValid = typeof expected === 'string'
    ? matchesSchemaType(value, expected)
    : Array.isArray(expected)
      ? expected.some((item) => typeof item === 'string' && matchesSchemaType(value, item))
      : true
  if (!typeValid) return `${path} có type không hợp lệ.`

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonValuesEqual(candidate, value))) {
    return `${path} không nằm trong danh sách cho phép.`
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return `${path} quá ngắn.`
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return `${path} quá dài.`
    if (schema.format === 'uri') {
      try {
        const parsed = new URL(value)
        if (!parsed.protocol || !parsed.hostname) return `${path} phải là URI hợp lệ.`
      } catch {
        return `${path} phải là URI hợp lệ.`
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${path} nhỏ hơn minimum.`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${path} lớn hơn maximum.`
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `${path} thiếu item bắt buộc.`
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `${path} có quá nhiều item.`
    if (isRecord(schema.items)) {
      for (const [index, item] of value.entries()) {
        const error = validateSchemaValue(schema.items, item, `${path}[${index}]`)
        if (error) return error
      }
    }
  }
  if (!isRecord(value)) return undefined

  const properties = isRecord(schema.properties) ? schema.properties : {}
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(value, key)) return `${path}.${String(key)} là bắt buộc.`
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key]
    if (isRecord(childSchema)) {
      const error = validateSchemaValue(childSchema, child, `${path}.${key}`)
      if (error) return error
      continue
    }
    if (schema.additionalProperties === false) return `${path}.${key} không được khai báo trong schema.`
    if (isRecord(schema.additionalProperties)) {
      const error = validateSchemaValue(schema.additionalProperties, child, `${path}.${key}`)
      if (error) return error
    }
  }
  return undefined
}

function matchesSchemaType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'object': return isRecord(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  try { return JSON.stringify(left) === JSON.stringify(right) } catch { return false }
}
