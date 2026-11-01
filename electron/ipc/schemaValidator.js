// @ts-check
/**
 * Descriptor accepted by `validateIpcPayload`. Payload schema modules build
 * these as plain object literals, so `type`/`unknown` stay wide strings.
 *
 * @typedef {Object} IpcFieldSchema
 * @property {string} [type]
 * @property {boolean} [optional]
 * @property {unknown} [default]
 * @property {boolean} [trim]
 * @property {boolean} [allowEmpty]
 * @property {number} [maxLength]
 * @property {boolean} [clamp]
 * @property {RegExp} [pattern]
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} [integer]
 * @property {number} [maxItems]
 * @property {IpcFieldSchema} [items]
 * @property {Record<string, IpcFieldSchema>} [fields]
 * @property {string} [unknown]
 * @property {readonly unknown[]} [values]
 * @property {boolean} [keepUndefined]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** @param {string} path */
function formatSchemaPath(path) {
  return path || 'payload'
}

/**
 * @param {string} path
 * @param {string} message
 */
function schemaError(path, message) {
  return new Error(`${formatSchemaPath(path)} ${message}`)
}

/**
 * @param {unknown} value
 * @param {PropertyKey} key
 */
function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** @param {IpcFieldSchema} schema */
function defaultFor(schema) {
  return hasOwn(schema, 'default') ? schema.default : undefined
}

/**
 * @param {unknown} value
 * @param {IpcFieldSchema} schema
 * @param {string} path
 */
function validateStringSchema(value, schema, path) {
  if (typeof value !== 'string') {
    throw schemaError(path, 'must be a string')
  }
  const nextValue = schema.trim ? value.trim() : value
  if (schema.allowEmpty === false && !nextValue) {
    throw schemaError(path, 'must be a non-empty string')
  }
  const maxLength = schema.maxLength
  if (typeof maxLength === 'number' && Number.isInteger(maxLength) && nextValue.length > maxLength) {
    if (schema.clamp) {
      return nextValue.slice(0, maxLength)
    }
    throw schemaError(path, `must be at most ${maxLength} characters`)
  }
  if (schema.pattern && !schema.pattern.test(nextValue)) {
    throw schemaError(path, 'has an invalid format')
  }
  return nextValue
}

/**
 * @param {unknown} value
 * @param {IpcFieldSchema} schema
 * @param {string} path
 */
function validateNumberSchema(value, schema, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw schemaError(path, 'must be a finite number')
  }
  if (schema.integer && !Number.isInteger(value)) {
    throw schemaError(path, 'must be an integer')
  }
  if (schema.min !== undefined && value < schema.min) {
    throw schemaError(path, `must be >= ${schema.min}`)
  }
  if (schema.max !== undefined && value > schema.max) {
    throw schemaError(path, `must be <= ${schema.max}`)
  }
  return value
}

/**
 * @param {unknown} value
 * @param {IpcFieldSchema} schema
 * @param {string} path
 * @returns {unknown[]}
 */
function validateArraySchema(value, schema, path) {
  if (!Array.isArray(value)) {
    throw schemaError(path, 'must be an array')
  }
  const maxItems = schema.maxItems
  if (typeof maxItems === 'number' && Number.isInteger(maxItems) && value.length > maxItems) {
    throw schemaError(path, `must contain at most ${maxItems} items`)
  }
  const items = schema.items
  if (!items) return [...value]
  return value.map((item, index) => validateSchemaValue(item, items, `${path}[${index}]`))
}

/**
 * @param {unknown} value
 * @param {IpcFieldSchema} schema
 * @param {string} path
 * @returns {Record<string, unknown>}
 */
function validateObjectSchema(value, schema, path) {
  if (!isPlainObject(value)) {
    throw schemaError(path, 'must be a plain object')
  }

  const fields = schema.fields ?? {}
  /** @type {Record<string, unknown>} */
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

/**
 * @param {unknown} value
 * @param {IpcFieldSchema} schema
 * @param {string} path
 * @returns {unknown}
 */
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
 * @param {IpcFieldSchema} schema
 * @returns {unknown}
 */
export function validateIpcPayload(channel, value, schema) {
  try {
    return validateSchemaValue(value, schema, 'payload')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid IPC payload for ${channel}: ${reason}`, { cause: error })
  }
}
