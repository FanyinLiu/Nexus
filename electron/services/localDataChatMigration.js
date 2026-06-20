export const CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION = 1

const MAX_CHAT_MIGRATION_SESSIONS = 30
const MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION = 500
const MAX_CHAT_MIGRATION_TEXT = 200_000
const MAX_CHAT_MIGRATION_PAYLOAD_BYTES = 20_000_000

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function safeParseJsonObject(raw) {
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function countChatMessagesFromPayloadJson(raw) {
  const payload = safeParseJsonObject(raw)
  return Array.isArray(payload?.messages) ? payload.messages.length : 0
}

export function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length
}

function normalizeRequiredString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new Error(`${label} is too long`)
  }
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
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`)
  }
  return new Date(parsed).toISOString()
}

function parseDateInput(value, label) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`)
  }
  return parsed
}

function cloneJsonValue(value, label, maxBytes = MAX_CHAT_MIGRATION_TEXT) {
  if (value === undefined) return undefined
  const json = JSON.stringify(value)
  if (!json) throw new Error(`${label} must be JSON serializable`)
  if (byteLength(json) > maxBytes) throw new Error(`${label} is too large`)
  return JSON.parse(json)
}

function normalizeChatMigrationMessage(value, index) {
  if (!isPlainObject(value)) throw new Error(`message ${index} must be an object`)
  if (!['user', 'assistant', 'system'].includes(value.role)) {
    throw new Error(`message ${index} role is unsupported`)
  }
  const content = normalizeRequiredString(value.content, `message ${index} content`, MAX_CHAT_MIGRATION_TEXT)
  const message = {
    id: normalizeRequiredString(value.id, `message ${index} id`, 256),
    role: value.role,
    content,
    createdAt: normalizeIsoTimestamp(value.createdAt, `message ${index} createdAt`),
  }

  const tone = normalizeOptionalString(value.tone, `message ${index} tone`, 32)
  if (tone === 'neutral' || tone === 'error') message.tone = tone

  const reasoning = normalizeOptionalString(
    value.reasoning_content,
    `message ${index} reasoning_content`,
    MAX_CHAT_MIGRATION_TEXT,
  )
  if (reasoning) message.reasoning_content = reasoning

  const toolResult = cloneJsonValue(value.toolResult, `message ${index} toolResult`)
  if (toolResult !== undefined) message.toolResult = toolResult

  return message
}

export function normalizeChatMigrationSession(value, index) {
  if (!isPlainObject(value)) throw new Error(`session ${index} must be an object`)
  if (!Array.isArray(value.messages)) throw new Error(`session ${index} messages must be an array`)
  if (value.messages.length > MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION) {
    throw new Error(`session ${index} has too many messages`)
  }

  const messages = value.messages.map((message, messageIndex) => normalizeChatMigrationMessage(message, messageIndex))
  const session = {
    id: normalizeRequiredString(value.id, `session ${index} id`, 256),
    startedAt: Date.parse(normalizeIsoTimestamp(value.startedAt, `session ${index} startedAt`)),
    lastActiveAt: Date.parse(normalizeIsoTimestamp(value.lastActiveAt, `session ${index} lastActiveAt`)),
    messages,
  }
  const title = normalizeOptionalString(value.title, `session ${index} title`, 80)
  if (title) session.title = title
  return session
}

export function normalizeChatMigrationPackage(value) {
  if (!isPlainObject(value)) throw new Error('chat migration package must be an object')
  if (value.schemaVersion !== CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION) {
    throw new Error('chat migration package schemaVersion is unsupported')
  }
  if (!Array.isArray(value.sessions)) throw new Error('chat migration package sessions must be an array')
  if (value.sessions.length > MAX_CHAT_MIGRATION_SESSIONS) {
    throw new Error('chat migration package has too many sessions')
  }

  const migrationPackage = {
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    createdAt: normalizeIsoTimestamp(value.createdAt, 'chat migration package createdAt'),
    source: isPlainObject(value.source) ? {
      sessionsKeyPresent: value.source.sessionsKeyPresent === true,
      legacyFlatChatKeyPresent: value.source.legacyFlatChatKeyPresent === true,
      legacyFlatChatUsed: value.source.legacyFlatChatUsed === true,
    } : {
      sessionsKeyPresent: false,
      legacyFlatChatKeyPresent: false,
      legacyFlatChatUsed: false,
    },
    sessions: value.sessions.map(normalizeChatMigrationSession),
  }

  const payloadBytes = byteLength(JSON.stringify(migrationPackage.sessions))
  if (payloadBytes > MAX_CHAT_MIGRATION_PAYLOAD_BYTES) {
    throw new Error('chat migration package payload is too large')
  }

  return { migrationPackage, payloadBytes }
}

export function summarizeChatMigrationPackage(migrationPackage, payloadBytes, targetDomainId) {
  const messageCount = migrationPackage.sessions.reduce((sum, session) => sum + session.messages.length, 0)
  return {
    targetDomainId,
    schemaVersion: migrationPackage.schemaVersion,
    sessionCount: migrationPackage.sessions.length,
    messageCount,
    payloadBytes,
    legacyFlatChatUsed: migrationPackage.source.legacyFlatChatUsed,
    requiresConfirmation: true,
    writesData: true,
  }
}

function normalizeNonNegativeInteger(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function normalizeChatComparisonSourceSession(value, index) {
  if (!isPlainObject(value)) throw new Error(`comparison session ${index} must be an object`)
  return {
    id: normalizeRequiredString(value.id, `comparison session ${index} id`, 256),
    startedAt: parseDateInput(value.startedAt, `comparison session ${index} startedAt`),
    lastActiveAt: parseDateInput(value.lastActiveAt, `comparison session ${index} lastActiveAt`),
    messageCount: normalizeNonNegativeInteger(
      value.messageCount,
      `comparison session ${index} messageCount`,
      MAX_CHAT_MIGRATION_MESSAGES_PER_SESSION,
    ),
    payloadBytes: normalizeNonNegativeInteger(
      value.payloadBytes,
      `comparison session ${index} payloadBytes`,
      MAX_CHAT_MIGRATION_PAYLOAD_BYTES,
    ),
  }
}

export function normalizeChatComparisonSource(value) {
  if (!isPlainObject(value)) throw new Error('chat comparison source must be an object')
  if (value.schemaVersion !== CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION) {
    throw new Error('chat comparison source schemaVersion is unsupported')
  }
  if (!Array.isArray(value.sessions)) throw new Error('chat comparison source sessions must be an array')
  if (value.sessions.length > MAX_CHAT_MIGRATION_SESSIONS) {
    throw new Error('chat comparison source has too many sessions')
  }
  return {
    schemaVersion: CHAT_MIGRATION_PACKAGE_SCHEMA_VERSION,
    generatedAt: normalizeIsoTimestamp(value.generatedAt, 'chat comparison source generatedAt'),
    source: isPlainObject(value.source) ? {
      sessionsKeyPresent: value.source.sessionsKeyPresent === true,
      legacyFlatChatKeyPresent: value.source.legacyFlatChatKeyPresent === true,
      legacyFlatChatUsed: value.source.legacyFlatChatUsed === true,
    } : {
      sessionsKeyPresent: false,
      legacyFlatChatKeyPresent: false,
      legacyFlatChatUsed: false,
    },
    sessions: value.sessions.map(normalizeChatComparisonSourceSession),
  }
}

export function summarizeChatComparisonSessions(sessions) {
  return sessions.reduce((summary, session) => {
    summary.sessionCount += 1
    summary.messageCount += session.messageCount
    summary.payloadBytes += session.payloadBytes
    return summary
  }, {
    sessionCount: 0,
    messageCount: 0,
    payloadBytes: 0,
  })
}

export function summarizeSqliteChatComparisonSessions(sessions) {
  return summarizeChatComparisonSessions(sessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messages.length,
    payloadBytes: byteLength(JSON.stringify(session)),
  })))
}

export function compareChatSessionMetadata(sourceSessions, sqliteSessions) {
  const sourceMap = new Map(sourceSessions.map((session) => [session.id, session]))
  const sqliteMetadata = sqliteSessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    lastActiveAt: session.lastActiveAt,
    messageCount: session.messages.length,
    payloadBytes: byteLength(JSON.stringify(session)),
  }))
  const sqliteMap = new Map(sqliteMetadata.map((session) => [session.id, session]))

  let matchedRecordCount = 0
  let metadataAlignedRecordCount = 0
  let metadataMismatchCount = 0
  let missingSqliteRecordCount = 0

  for (const sourceSession of sourceSessions) {
    const sqliteSession = sqliteMap.get(sourceSession.id)
    if (!sqliteSession) {
      missingSqliteRecordCount += 1
      continue
    }
    matchedRecordCount += 1
    const aligned = sourceSession.startedAt === sqliteSession.startedAt
      && sourceSession.lastActiveAt === sqliteSession.lastActiveAt
      && sourceSession.messageCount === sqliteSession.messageCount
      && sourceSession.payloadBytes === sqliteSession.payloadBytes
    if (aligned) {
      metadataAlignedRecordCount += 1
    } else {
      metadataMismatchCount += 1
    }
  }

  let extraSqliteRecordCount = 0
  for (const sqliteSession of sqliteMetadata) {
    if (!sourceMap.has(sqliteSession.id)) extraSqliteRecordCount += 1
  }

  return {
    matchedRecordCount,
    metadataAlignedRecordCount,
    metadataMismatchCount,
    missingSqliteRecordCount,
    extraSqliteRecordCount,
  }
}

export function chatComparisonIssueCodes({
  sourceSummary,
  sqliteSummary,
  malformedRecordCount,
  metadata,
  messageCountDelta,
}) {
  const issues = []
  if (sourceSummary.sessionCount === 0 && sourceSummary.messageCount === 0) issues.push('no-source-chat-data')
  if (sqliteSummary.sessionCount === 0 && sqliteSummary.messageCount === 0) issues.push('no-sqlite-chat-records')
  if (malformedRecordCount > 0) issues.push('sqlite-malformed-records')
  if (metadata.missingSqliteRecordCount > 0) issues.push('sqlite-missing-records')
  if (metadata.extraSqliteRecordCount > 0) issues.push('sqlite-extra-records')
  if (metadata.metadataMismatchCount > 0) issues.push('sqlite-metadata-mismatch')
  if (messageCountDelta !== 0) issues.push('sqlite-message-count-delta')
  if (issues.length === 0) issues.push('comparison-aligned')
  return issues
}
