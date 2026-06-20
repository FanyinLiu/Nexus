export const EXTERNAL_ACTION_INTEGRATIONS = ['telegram', 'discord', 'minecraft', 'factorio', 'mcp']
export const EXTERNAL_ACTION_MODES = ['read-only', 'confirm', 'auto']

const DEFAULT_MODE = 'confirm'

const CHANNEL_DESCRIPTORS = {
  'telegram:send-message': { integration: 'telegram', permissionKind: 'send' },
  'telegram:send-voice': { integration: 'telegram', permissionKind: 'send' },
  'discord:send-message': { integration: 'discord', permissionKind: 'send' },
  'discord:send-voice': { integration: 'discord', permissionKind: 'send' },
  'minecraft:send-command': { integration: 'minecraft', permissionKind: 'execute' },
  'factorio:execute': { integration: 'factorio', permissionKind: 'execute' },
  'mcp:call-tool': { integration: 'mcp', permissionKind: 'execute' },
  'mcp:sync-servers': { integration: 'mcp', permissionKind: 'configure' },
}

function isValidMode(value) {
  return EXTERNAL_ACTION_MODES.includes(value)
}

export function normalizeExternalActionMode(value, fallback = DEFAULT_MODE) {
  return isValidMode(value) ? value : fallback
}

export function createDefaultExternalActionPolicy() {
  return Object.fromEntries(EXTERNAL_ACTION_INTEGRATIONS.map((integration) => [integration, DEFAULT_MODE]))
}

export function normalizeExternalActionPolicySnapshot(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const defaults = createDefaultExternalActionPolicy()
  const output = { ...defaults }
  for (const integration of EXTERNAL_ACTION_INTEGRATIONS) {
    output[integration] = normalizeExternalActionMode(input[integration], defaults[integration])
  }
  return output
}

export function normalizeExternalActionPolicySyncPayload(payload = {}) {
  const policies = payload?.policies && typeof payload.policies === 'object' && !Array.isArray(payload.policies)
    ? payload.policies
    : {}
  const output = {}
  for (const integration of EXTERNAL_ACTION_INTEGRATIONS) {
    const item = policies[integration]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    output[integration] = {
      mode: normalizeExternalActionMode(item.mode),
      active: Boolean(item.active),
    }
  }
  return output
}

export function resolveExternalActionDescriptor(channel) {
  return CHANNEL_DESCRIPTORS[channel] ?? {
    integration: 'unknown',
    permissionKind: 'execute',
  }
}

export function decideExternalActionPermission(mode, permissionKind, confirmed = false) {
  const normalizedMode = normalizeExternalActionMode(mode)
  if (normalizedMode === 'read-only' && permissionKind !== 'read') {
    return { allowed: false, requiresConfirmation: false, reason: 'blocked' }
  }
  if (normalizedMode === 'confirm' && permissionKind !== 'read') {
    return confirmed
      ? { allowed: true, requiresConfirmation: true, reason: 'confirmed' }
      : { allowed: false, requiresConfirmation: true, reason: 'needs_confirmation' }
  }
  return { allowed: true, requiresConfirmation: false, reason: 'auto' }
}

export function planExternalActionPolicySync(currentPolicy, syncPayload) {
  const current = normalizeExternalActionPolicySnapshot(currentPolicy)
  const requested = normalizeExternalActionPolicySyncPayload(syncPayload)
  const changes = []
  const next = { ...current }

  for (const integration of EXTERNAL_ACTION_INTEGRATIONS) {
    const request = requested[integration]
    if (!request) continue
    const requestedMode = request.mode === 'auto' && !request.active ? 'confirm' : request.mode
    const currentMode = current[integration]
    if (requestedMode === currentMode) continue
    changes.push({
      integration,
      from: currentMode,
      to: requestedMode,
      active: request.active,
      requiresEscalationApproval: requestedMode === 'auto' && currentMode !== 'auto',
    })
    next[integration] = requestedMode
  }

  return { current, requested, changes, next }
}
