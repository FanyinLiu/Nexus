function summarizeTextRef(value) {
  return {
    present: typeof value === 'string' && value.length > 0,
    length: typeof value === 'string' ? value.length : 0,
  }
}

function summarizeDataShape(value) {
  if (value === null) {
    return { kind: 'null', serializedLength: 4 }
  }
  if (Array.isArray(value)) {
    return {
      kind: 'array',
      arrayLength: value.length,
      serializedLength: serializedLength(value),
    }
  }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      keyCount: value ? Object.keys(value).length : 0,
      serializedLength: serializedLength(value),
    }
  }
  if (typeof value === 'string') {
    return {
      kind: 'string',
      stringLength: value.length,
      serializedLength: serializedLength(value),
    }
  }
  if (typeof value === 'number') {
    return { kind: 'number', serializedLength: serializedLength(value) }
  }
  if (typeof value === 'boolean') {
    return { kind: 'boolean', serializedLength: value ? 4 : 5 }
  }
  if (value === undefined) {
    return { kind: 'undefined', serializedLength: 0 }
  }
  return { kind: typeof value, serializedLength: serializedLength(value) }
}

function serializedLength(value) {
  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized.length : 0
  } catch {
    return 0
  }
}

function summarizeCommonResultFields(result) {
  const summary = {}
  for (const key of ['ok', 'accepted', 'running', 'enabled', 'approved', 'commandTrusted']) {
    if (typeof result?.[key] === 'boolean') {
      summary[key] = result[key]
    }
  }
  if (typeof result?.delivered === 'number' && Number.isFinite(result.delivered)) {
    summary.delivered = result.delivered
  }
  if (typeof result?.toolCount === 'number' && Number.isFinite(result.toolCount)) {
    summary.toolCount = result.toolCount
  }
  if (typeof result?.mcpState === 'string') {
    summary.mcpStateLength = result.mcpState.length
  }
  return summary
}

export function summarizePluginRequest(channel, payload = {}) {
  if (channel.startsWith('plugin-bus:')) {
    return {
      channel,
      serverId: summarizeTextRef(payload?.serverId),
      topic: summarizeTextRef(payload?.topic),
      data: summarizeDataShape(payload?.data),
    }
  }

  return {
    channel,
    pluginId: summarizeTextRef(payload?.id),
  }
}

export function summarizePluginResult(channel, result = {}, error = null) {
  const resultKind = error
    ? 'error'
    : Array.isArray(result)
      ? 'array'
      : result === null
        ? 'null'
        : typeof result
  const summary = {
    channel,
    ok: !error,
    resultKind,
    resultKeyCount: result && typeof result === 'object' && !Array.isArray(result)
      ? Object.keys(result).length
      : undefined,
    resultArrayLength: Array.isArray(result) ? result.length : undefined,
    ...summarizeCommonResultFields(result),
    errorName: error?.name,
    errorMessageLength: error?.message ? String(error.message).length : 0,
  }

  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value !== undefined))
}

export function pluginActionNeedsConfirmation(channel) {
  return [
    'plugin:start',
    'plugin:restart',
    'plugin:enable',
    'plugin:approve',
    'plugin:revoke',
    'plugin-bus:publish',
    'plugin-bus:subscribe',
    'plugin-bus:unsubscribe',
  ].includes(channel)
}
