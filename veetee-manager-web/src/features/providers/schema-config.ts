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
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
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
