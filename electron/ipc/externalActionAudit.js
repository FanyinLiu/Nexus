let externalActionAuditSequence = 0

function textLength(value) {
  return typeof value === 'string' ? value.length : 0
}

function hasText(value) {
  return textLength(value) > 0
}

function valueKind(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function plainObjectKeyCount(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  return Object.keys(value).length
}

function nextExternalActionAuditId(nowMs = Date.now()) {
  externalActionAuditSequence = (externalActionAuditSequence + 1) % Number.MAX_SAFE_INTEGER
  return `external-action-${Math.max(0, Math.trunc(nowMs)).toString(36)}-${externalActionAuditSequence.toString(36)}`
}

function sanitizeFailureCode(value) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null
  return normalized.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80) || null
}

export function resolveExternalActionFailureCode(error) {
  if (!error || typeof error !== 'object') return 'unknown'
  return sanitizeFailureCode(error.code)
    ?? sanitizeFailureCode(error.name)
    ?? 'unknown'
}

function summarizeTarget(payload = {}, targetKey) {
  const value = payload?.[targetKey]
  return {
    kind: targetKey,
    present: value !== undefined && value !== null && String(value).length > 0,
    idLength: value === undefined || value === null ? 0 : String(value).length,
  }
}

function summarizeReply(payload = {}) {
  const replyTo = payload?.replyToMessageId
  return {
    present: replyTo !== undefined && replyTo !== null && String(replyTo).length > 0,
    idLength: replyTo === undefined || replyTo === null ? 0 : String(replyTo).length,
  }
}

function summarizeTextPayload(payload = {}) {
  return {
    textLength: textLength(payload?.text),
    parseModePresent: hasText(payload?.parseMode),
    parseModeLength: textLength(payload?.parseMode),
    replyTo: summarizeReply(payload),
  }
}

function summarizeAudioPayload(payload = {}) {
  return {
    audioBase64Length: textLength(payload?.audioBase64),
    mimeTypeLength: textLength(payload?.mimeType),
    replyTo: summarizeReply(payload),
  }
}

function summarizeGamePayload(payload = {}) {
  return {
    commandLength: textLength(payload?.command),
  }
}

function summarizeMcpCallPayload(payload = {}) {
  return {
    serverIdPresent: hasText(payload?.serverId),
    serverIdLength: textLength(payload?.serverId),
    toolNameLength: textLength(payload?.name),
    argumentsKind: valueKind(payload?.arguments),
    argumentsKeyCount: plainObjectKeyCount(payload?.arguments),
  }
}

function summarizeMcpSyncPayload(payload = {}) {
  const servers = Array.isArray(payload?.servers) ? payload.servers : []
  return {
    serverCount: servers.length,
    enabledCount: servers.filter((server) => Boolean(server?.enabled)).length,
    commandCount: servers.filter((server) => hasText(server?.command)).length,
    commandTextTotalLength: servers.reduce((total, server) => total + textLength(server?.command), 0),
    argsTextTotalLength: servers.reduce((total, server) => total + textLength(server?.args), 0),
  }
}

export function summarizeExternalActionRequest(channel, payload = {}) {
  switch (channel) {
    case 'telegram:send-message':
      return {
        channel,
        integration: 'telegram',
        actionKind: 'send-message',
        target: summarizeTarget(payload, 'chatId'),
        content: summarizeTextPayload(payload),
      }
    case 'telegram:send-voice':
      return {
        channel,
        integration: 'telegram',
        actionKind: 'send-voice',
        target: summarizeTarget(payload, 'chatId'),
        content: summarizeAudioPayload(payload),
      }
    case 'discord:send-message':
      return {
        channel,
        integration: 'discord',
        actionKind: 'send-message',
        target: summarizeTarget(payload, 'channelId'),
        content: summarizeTextPayload(payload),
      }
    case 'discord:send-voice':
      return {
        channel,
        integration: 'discord',
        actionKind: 'send-voice',
        target: summarizeTarget(payload, 'channelId'),
        content: summarizeAudioPayload(payload),
      }
    case 'minecraft:send-command':
      return {
        channel,
        integration: 'minecraft',
        actionKind: 'execute-command',
        command: summarizeGamePayload(payload),
      }
    case 'factorio:execute':
      return {
        channel,
        integration: 'factorio',
        actionKind: 'execute-command',
        command: summarizeGamePayload(payload),
      }
    case 'mcp:call-tool':
      return {
        channel,
        integration: 'mcp',
        actionKind: 'call-tool',
        tool: summarizeMcpCallPayload(payload),
      }
    case 'mcp:sync-servers':
      return {
        channel,
        integration: 'mcp',
        actionKind: 'sync-servers',
        servers: summarizeMcpSyncPayload(payload),
      }
    default:
      return {
        channel,
        integration: 'unknown',
        actionKind: 'unknown',
      }
  }
}

export function summarizeExternalActionResult(channel, result = {}, error = null) {
  const failed = Boolean(error)
  return {
    channel,
    ok: !failed,
    resultKind: failed ? 'error' : valueKind(result),
    resultKeyCount: failed ? 0 : plainObjectKeyCount(result),
    responseLength: failed ? 0 : textLength(result?.response),
    errorName: failed && error instanceof Error ? error.name : undefined,
    errorMessageLength: failed && error instanceof Error ? textLength(error.message) : 0,
  }
}

export function summarizeExternalActionStart(actionId, channel, payload = {}) {
  const input = summarizeExternalActionRequest(channel, payload)
  return {
    actionId,
    phase: 'start',
    channel: input.channel,
    integration: input.integration,
    type: input.actionKind,
    input,
  }
}

export function summarizeExternalActionFinish(actionId, channel, startedAtMs, finishedAtMs, result = {}, error = null) {
  const output = summarizeExternalActionResult(channel, result, error)
  return {
    actionId,
    phase: 'finish',
    channel: output.channel,
    ok: output.ok,
    durationMs: Math.max(0, Math.round(finishedAtMs - startedAtMs)),
    failureCode: output.ok ? null : resolveExternalActionFailureCode(error),
    result: output,
  }
}

async function getDefaultAuditWriter() {
  const module = await import('../services/auditLog.js')
  return module.audit
}

async function getDefaultPermissionCheck() {
  const module = await import('../services/externalActionPolicy.js')
  return module.requireExternalActionPermission
}

export async function runAuditedExternalAction(channel, payload, action, options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const auditWriter = typeof options.audit === 'function'
    ? options.audit
    : await getDefaultAuditWriter()
  const permissionCheck = typeof options.requirePermission === 'function'
    ? options.requirePermission
    : await getDefaultPermissionCheck()
  const startedAtMs = now()
  const actionId = options.actionId || nextExternalActionAuditId(startedAtMs)

  auditWriter('external-action', 'start', summarizeExternalActionStart(actionId, channel, payload))

  try {
    await permissionCheck(channel)
    const result = await action()
    auditWriter('external-action', 'finish', summarizeExternalActionFinish(
      actionId,
      channel,
      startedAtMs,
      now(),
      result,
    ))
    return result
  } catch (error) {
    auditWriter('external-action', 'finish', summarizeExternalActionFinish(
      actionId,
      channel,
      startedAtMs,
      now(),
      {},
      error,
    ))
    throw error
  }
}
