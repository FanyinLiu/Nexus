export const MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION = 1

const MAX_LONG_TERM_MEMORIES = 500
const MAX_DAILY_ENTRIES = 10_000
const MAX_MEMORY_CONTENT = 2_000
const MAX_DAILY_CONTENT = 200
const MAX_MEMORY_PAYLOAD_BYTES = 20_000_000

const MEMORY_CATEGORIES = new Set([
  'profile',
  'preference',
  'goal',
  'habit',
  'manual',
  'feedback',
  'project',
  'reference',
])
const MEMORY_IMPORTANCE = new Set(['low', 'normal', 'high', 'pinned', 'reflection'])
const MEMORY_KINDS = new Set(['preference', 'fact', 'relationship', 'knowledge'])
const MEMORY_VALENCES = new Set(['positive', 'negative', 'neutral', 'mixed'])

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function normalizeRequiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`${label} is too long`)
  return normalized
}

function normalizeOptionalString(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length > maxLength) throw new Error(`${label} is too long`)
  return normalized
}

function normalizeIsoTimestamp(value, label) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`)
  return new Date(parsed).toISOString()
}

function normalizeScore(value, label, max = 1) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a number between 0 and ${max}`)
  }
  return value
}

function normalizeNonNegativeInteger(value, label) {
  if (value === undefined || value === null) return undefined
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`)
  return value
}

function normalizeRelatedIds(value, label) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} must be a short id list`)
  const ids = []
  const seen = new Set()
  for (const item of value) {
    const id = normalizeRequiredString(item, `${label} item`, 120)
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function normalizeEmotionSnapshot(value, label) {
  if (value === undefined || value === null) return undefined
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`)
  const snapshot = {}
  for (const axis of ['energy', 'warmth', 'curiosity', 'concern']) {
    const score = normalizeScore(value[axis], `${label}.${axis}`)
    if (score === undefined) throw new Error(`${label}.${axis} is required`)
    snapshot[axis] = score
  }
  return snapshot
}

export function normalizeMemoryMigrationItem(value, index = 0) {
  if (!isPlainObject(value)) throw new Error(`memory ${index} must be an object`)
  const id = normalizeRequiredString(value.id, `memory ${index} id`, 120)
  const content = normalizeRequiredString(value.content, `memory ${index} content`, MAX_MEMORY_CONTENT)
  const category = normalizeRequiredString(value.category, `memory ${index} category`, 32)
  if (!MEMORY_CATEGORIES.has(category)) throw new Error(`memory ${index} category is unsupported`)
  const source = normalizeRequiredString(value.source, `memory ${index} source`, 120)
  if (typeof value.enabled !== 'boolean') throw new Error(`memory ${index} enabled must be a boolean`)
  const memory = {
    id,
    content,
    category,
    source,
    createdAt: normalizeIsoTimestamp(value.createdAt, `memory ${index} createdAt`),
    enabled: value.enabled,
  }

  for (const field of ['kind', 'importance', 'emotionalValence']) {
    if (value[field] === undefined || value[field] === null) continue
    const normalized = normalizeRequiredString(value[field], `memory ${index} ${field}`, 32)
    const allowed = field === 'kind' ? MEMORY_KINDS : field === 'importance' ? MEMORY_IMPORTANCE : MEMORY_VALENCES
    if (!allowed.has(normalized)) throw new Error(`memory ${index} ${field} is unsupported`)
    memory[field] = normalized
  }

  const optionalStrings = [
    ['sourceRef', 240],
    ['lastUsedAt', 64],
    ['lastRecalledAt', 64],
    ['reflectionTopic', 120],
  ]
  for (const [field, maxLength] of optionalStrings) {
    const valueForField = normalizeOptionalString(value[field], `memory ${index} ${field}`, maxLength)
    if (valueForField) {
      memory[field] = field.endsWith('At')
        ? normalizeIsoTimestamp(valueForField, `memory ${index} ${field}`)
        : valueForField
    }
  }

  const importanceScore = normalizeScore(value.importanceScore, `memory ${index} importanceScore`, 2)
  const significance = normalizeScore(value.significance, `memory ${index} significance`)
  const reflectionConfidence = normalizeScore(value.reflectionConfidence, `memory ${index} reflectionConfidence`)
  const recallCount = normalizeNonNegativeInteger(value.recallCount, `memory ${index} recallCount`)
  const relatedIds = normalizeRelatedIds(value.relatedIds, `memory ${index} relatedIds`)
  const emotionSnapshot = normalizeEmotionSnapshot(value.emotionSnapshot, `memory ${index} emotionSnapshot`)
  if (importanceScore !== undefined) memory.importanceScore = importanceScore
  if (significance !== undefined) memory.significance = significance
  if (reflectionConfidence !== undefined) memory.reflectionConfidence = reflectionConfidence
  if (recallCount !== undefined) memory.recallCount = recallCount
  if (relatedIds !== undefined) memory.relatedIds = relatedIds
  if (emotionSnapshot !== undefined) memory.emotionSnapshot = emotionSnapshot
  return memory
}

function isDayKey(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
}

export function normalizeMemoryMigrationDailyEntry(value, index = 0) {
  if (!isPlainObject(value)) throw new Error(`daily memory ${index} must be an object`)
  const role = value.role === 'user' || value.role === 'assistant' ? value.role : null
  if (!role) throw new Error(`daily memory ${index} role is unsupported`)
  const day = normalizeRequiredString(value.day, `daily memory ${index} day`, 10)
  if (!isDayKey(day)) throw new Error(`daily memory ${index} day is invalid`)
  return {
    id: normalizeRequiredString(value.id, `daily memory ${index} id`, 120),
    day,
    role,
    content: normalizeRequiredString(value.content, `daily memory ${index} content`, MAX_DAILY_CONTENT),
    source: value.source === 'voice' ? 'voice' : 'chat',
    createdAt: normalizeIsoTimestamp(value.createdAt, `daily memory ${index} createdAt`),
  }
}

export function normalizeMemoryMigrationPackage(value) {
  if (!isPlainObject(value)) throw new Error('memory migration package must be an object')
  if (value.schemaVersion !== MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION) {
    throw new Error('memory migration package schemaVersion is unsupported')
  }
  if (!Array.isArray(value.longTerm)) throw new Error('memory migration package longTerm must be an array')
  if (!Array.isArray(value.daily)) throw new Error('memory migration package daily must be an array')
  if (value.longTerm.length > MAX_LONG_TERM_MEMORIES) throw new Error('memory migration package has too many long-term records')
  if (value.daily.length > MAX_DAILY_ENTRIES) throw new Error('memory migration package has too many daily records')

  const longTerm = value.longTerm.map(normalizeMemoryMigrationItem)
  const daily = value.daily.map(normalizeMemoryMigrationDailyEntry)
  const longTermIds = new Set()
  for (const memory of longTerm) {
    if (longTermIds.has(memory.id)) throw new Error('memory migration package has duplicate long-term ids')
    longTermIds.add(memory.id)
  }
  const dailyIds = new Set()
  for (const entry of daily) {
    if (dailyIds.has(entry.id)) throw new Error('memory migration package has duplicate daily ids')
    dailyIds.add(entry.id)
  }
  const source = isPlainObject(value.source) ? {
    longTermKeyPresent: value.source.longTermKeyPresent === true,
    legacyLongTermKeyPresent: value.source.legacyLongTermKeyPresent === true,
    dailyKeyPresent: value.source.dailyKeyPresent === true,
    legacyLongTermUsed: value.source.legacyLongTermUsed === true,
  } : {
    longTermKeyPresent: false,
    legacyLongTermKeyPresent: false,
    dailyKeyPresent: false,
    legacyLongTermUsed: false,
  }

  const migrationPackage = {
    schemaVersion: MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION,
    createdAt: normalizeIsoTimestamp(value.createdAt, 'memory migration package createdAt'),
    source,
    longTerm,
    daily,
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ longTerm, daily })).length
  if (payloadBytes > MAX_MEMORY_PAYLOAD_BYTES) throw new Error('memory migration package payload is too large')
  return { migrationPackage, payloadBytes }
}

export function summarizeMemoryMigrationPackage(migrationPackage, payloadBytes) {
  return {
    targetDomainIds: ['memory-long-term', 'memory-daily'],
    schemaVersion: migrationPackage.schemaVersion,
    longTermRecordCount: migrationPackage.longTerm.length,
    dailyEntryCount: migrationPackage.daily.length,
    payloadBytes,
    legacyLongTermUsed: migrationPackage.source.legacyLongTermUsed,
    requiresConfirmation: true,
    writesData: true,
  }
}
