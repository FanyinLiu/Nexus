/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function formatSchemaPath(path) {
  return path || 'payload'
}

function schemaError(path, message) {
  return new Error(`${formatSchemaPath(path)} ${message}`)
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function defaultFor(schema) {
  return hasOwn(schema, 'default') ? schema.default : undefined
}

function validateStringSchema(value, schema, path) {
  if (typeof value !== 'string') {
    throw schemaError(path, 'must be a string')
  }
  const nextValue = schema.trim ? value.trim() : value
  if (schema.allowEmpty === false && !nextValue) {
    throw schemaError(path, 'must be a non-empty string')
  }
  if (Number.isInteger(schema.maxLength) && nextValue.length > schema.maxLength) {
    if (schema.clamp) {
      return nextValue.slice(0, schema.maxLength)
    }
    throw schemaError(path, `must be at most ${schema.maxLength} characters`)
  }
  if (schema.pattern && !schema.pattern.test(nextValue)) {
    throw schemaError(path, 'has an invalid format')
  }
  return nextValue
}

function validateNumberSchema(value, schema, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw schemaError(path, 'must be a finite number')
  }
  if (schema.min !== undefined && value < schema.min) {
    throw schemaError(path, `must be >= ${schema.min}`)
  }
  if (schema.max !== undefined && value > schema.max) {
    throw schemaError(path, `must be <= ${schema.max}`)
  }
  return value
}

function validateArraySchema(value, schema, path) {
  if (!Array.isArray(value)) {
    throw schemaError(path, 'must be an array')
  }
  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
    throw schemaError(path, `must contain at most ${schema.maxItems} items`)
  }
  if (!schema.items) return [...value]
  return value.map((item, index) => validateSchemaValue(item, schema.items, `${path}[${index}]`))
}

function validateObjectSchema(value, schema, path) {
  if (!isPlainObject(value)) {
    throw schemaError(path, 'must be a plain object')
  }

  const fields = schema.fields ?? {}
  const output = {}

  for (const [key, fieldSchema] of Object.entries(fields)) {
    const fieldPath = `${path}.${key}`
    if (!hasOwn(value, key)) {
      if (fieldSchema.optional) {
        const defaultValue = defaultFor(fieldSchema)
        if (defaultValue !== undefined) output[key] = defaultValue
        continue
      }
      throw schemaError(fieldPath, 'is required')
    }

    const nextValue = validateSchemaValue(value[key], fieldSchema, fieldPath)
    if (nextValue !== undefined || fieldSchema.keepUndefined) {
      output[key] = nextValue
    }
  }

  if (schema.unknown === 'preserve') {
    for (const key of Object.keys(value)) {
      if (!hasOwn(fields, key)) {
        output[key] = value[key]
      }
    }
  } else if (schema.unknown === 'reject') {
    for (const key of Object.keys(value)) {
      if (!hasOwn(fields, key)) {
        throw schemaError(`${path}.${key}`, 'is not allowed')
      }
    }
  }

  return output
}

function validateSchemaValue(value, schema, path) {
  if (!schema || typeof schema !== 'object') {
    throw new Error('IPC schema descriptor missing')
  }

  if (value === undefined || value === null) {
    if (schema.optional) return defaultFor(schema)
    throw schemaError(path, 'is required')
  }

  switch (schema.type) {
    case 'any':
      return value
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw schemaError(path, 'must be a boolean')
      }
      return value
    case 'enum':
      if (!Array.isArray(schema.values) || !schema.values.includes(value)) {
        throw schemaError(path, `must be one of: ${(schema.values ?? []).join(', ')}`)
      }
      return value
    case 'number':
      return validateNumberSchema(value, schema, path)
    case 'string':
      return validateStringSchema(value, schema, path)
    case 'array':
      return validateArraySchema(value, schema, path)
    case 'object':
      return validateObjectSchema(value, schema, path)
    default:
      throw new Error(`Unsupported IPC schema type: ${schema.type}`)
  }
}

/**
 * Validate renderer-provided IPC payloads before handlers use them.
 * Unknown object fields are stripped unless the schema opts into rejection.
 *
 * @param {string} channel
 * @param {unknown} value
 * @param {Record<string, unknown>} schema
 * @returns {unknown}
 */
export function validateIpcPayload(channel, value, schema) {
  try {
    return validateSchemaValue(value, schema, 'payload')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid IPC payload for ${channel}: ${reason}`)
  }
}
