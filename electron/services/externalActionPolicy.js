import { BrowserWindow, app, dialog } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { audit } from './auditLog.js'
import {
  createDefaultExternalActionPolicy,
  decideExternalActionPermission,
  getExternalActionSessionGrantKey,
  normalizeExternalActionPolicySnapshot,
  planExternalActionPolicySync,
  resolveExternalActionDescriptor,
  resolveExternalActionGrantScopeFromDialogResponse,
} from './externalActionPolicyCore.js'

const POLICY_FILE_NAME = 'external-action-policy.json'

let policyCache = null
const sessionGrantKeys = new Set()

function getPolicyPath() {
  return path.join(app.getPath('userData'), POLICY_FILE_NAME)
}

function getDialogParent() {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
}

async function loadPolicy() {
  if (policyCache) return policyCache
  try {
    const raw = await fs.readFile(getPolicyPath(), 'utf8')
    policyCache = normalizeExternalActionPolicySnapshot(JSON.parse(raw))
  } catch {
    policyCache = createDefaultExternalActionPolicy()
  }
  return policyCache
}

async function savePolicy(policy) {
  policyCache = normalizeExternalActionPolicySnapshot(policy)
  await fs.writeFile(
    getPolicyPath(),
    JSON.stringify(policyCache, null, 2),
    { encoding: 'utf8', mode: 0o600 },
  )
}

function formatIntegrationLabel(integration) {
  switch (integration) {
    case 'telegram': return 'Telegram'
    case 'discord': return 'Discord'
    case 'minecraft': return 'Minecraft'
    case 'factorio': return 'Factorio'
    case 'mcp': return 'MCP'
    default: return integration
  }
}

function formatPermissionKind(kind) {
  switch (kind) {
    case 'send': return 'send messages or voice'
    case 'execute': return 'execute commands or tools'
    case 'configure': return 'change integration runtime configuration'
    default: return 'perform this action'
  }
}

function createExternalActionPolicyError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

async function promptPolicyEscalation(change) {
  const parent = getDialogParent()
  const label = formatIntegrationLabel(change.integration)
  const result = await dialog.showMessageBox(parent ?? undefined, {
    type: 'warning',
    title: `Allow automatic ${label} actions?`,
    message: `Allow Nexus to run ${label} actions without asking each time?`,
    detail:
      `This changes ${label} from "${change.from}" to "auto". `
      + 'Auto mode can send messages, execute commands, or configure external runtimes without a per-action confirmation dialog. '
      + 'Only approve this if you intentionally trust this integration.',
    buttons: ['Keep confirmation', 'Allow auto'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return result.response === 1
}

async function promptExternalActionConfirmation({ channel, integration, permissionKind }) {
  const parent = getDialogParent()
  const label = formatIntegrationLabel(integration)
  const result = await dialog.showMessageBox(parent ?? undefined, {
    type: 'warning',
    title: `Confirm ${label} action`,
    message: `Allow Nexus to ${formatPermissionKind(permissionKind)}?`,
    detail:
      `Channel: ${channel}\n`
      + `Integration: ${label}\n\n`
      + 'This confirmation is enforced in the main process before the action is executed. '
      + 'The audit log records metadata only, not message text, commands, target IDs, or tool arguments.',
    buttons: ['Cancel', 'Allow once', 'Allow this session', 'Always allow'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return resolveExternalActionGrantScopeFromDialogResponse(result.response)
}

export async function getExternalActionPolicySnapshot() {
  return { ...(await loadPolicy()) }
}

export async function syncExternalActionPolicy(payload) {
  const current = await loadPolicy()
  const plan = planExternalActionPolicySync(current, payload)
  if (plan.changes.length === 0) {
    return { policy: { ...plan.current }, changes: [], rejected: [] }
  }

  const acceptedPolicy = { ...plan.current }
  const acceptedChanges = []
  const rejected = []

  for (const change of plan.changes) {
    if (change.requiresEscalationApproval) {
      audit('external-action-policy', 'escalation-request', {
        integration: change.integration,
        from: change.from,
        to: change.to,
      })
      const approved = await promptPolicyEscalation(change)
      audit('external-action-policy', approved ? 'escalation-approved' : 'escalation-rejected', {
        integration: change.integration,
        from: change.from,
        to: change.to,
      })
      if (!approved) {
        rejected.push(change)
        continue
      }
    }
    acceptedPolicy[change.integration] = change.to
    acceptedChanges.push(change)
  }

  if (acceptedChanges.length > 0) {
    await savePolicy(acceptedPolicy)
    audit('external-action-policy', 'sync', {
      changedCount: acceptedChanges.length,
      rejectedCount: rejected.length,
      integrations: acceptedChanges.map((change) => change.integration),
    })
  }

  return {
    policy: { ...acceptedPolicy },
    changes: acceptedChanges,
    rejected,
  }
}

export async function requireExternalActionPermission(channel) {
  const descriptor = resolveExternalActionDescriptor(channel)
  const policy = await loadPolicy()
  const mode = policy[descriptor.integration] ?? 'confirm'
  const sessionGrantKey = getExternalActionSessionGrantKey(channel)
  if (mode === 'confirm' && sessionGrantKey && sessionGrantKeys.has(sessionGrantKey)) {
    audit('external-action-policy', 'allow', {
      channel,
      integration: descriptor.integration,
      permissionKind: descriptor.permissionKind,
      mode,
      reason: 'session-grant',
      grantScope: 'session',
    })
    return true
  }

  const initialDecision = decideExternalActionPermission(mode, descriptor.permissionKind)

  if (initialDecision.allowed) {
    audit('external-action-policy', 'allow', {
      channel,
      integration: descriptor.integration,
      permissionKind: descriptor.permissionKind,
      mode,
      reason: initialDecision.reason,
    })
    return true
  }

  if (!initialDecision.requiresConfirmation) {
    audit('external-action-policy', 'deny', {
      channel,
      integration: descriptor.integration,
      permissionKind: descriptor.permissionKind,
      mode,
      reason: initialDecision.reason,
    })
    throw createExternalActionPolicyError(
      `${formatIntegrationLabel(descriptor.integration)} is in read-only mode`,
      'external_action_read_only',
    )
  }

  audit('external-action-policy', 'confirmation-request', {
    channel,
    integration: descriptor.integration,
    permissionKind: descriptor.permissionKind,
    mode,
  })
  const grantScope = await promptExternalActionConfirmation({
    channel,
    integration: descriptor.integration,
    permissionKind: descriptor.permissionKind,
  })
  const confirmed = Boolean(grantScope)
  const finalDecision = decideExternalActionPermission(mode, descriptor.permissionKind, confirmed)
  audit('external-action-policy', finalDecision.allowed ? 'confirmation-approved' : 'confirmation-rejected', {
    channel,
    integration: descriptor.integration,
    permissionKind: descriptor.permissionKind,
    mode,
    grantScope: grantScope ?? 'none',
  })

  if (!finalDecision.allowed) {
    throw createExternalActionPolicyError(
      `${formatIntegrationLabel(descriptor.integration)} action was rejected by the user`,
      'external_action_rejected',
    )
  }

  if (grantScope === 'session' && sessionGrantKey) {
    sessionGrantKeys.add(sessionGrantKey)
    audit('external-action-policy', 'session-grant', {
      channel,
      integration: descriptor.integration,
      permissionKind: descriptor.permissionKind,
      mode,
    })
  } else if (grantScope === 'always' && descriptor.integration !== 'unknown') {
    await savePolicy({
      ...policy,
      [descriptor.integration]: 'auto',
    })
    audit('external-action-policy', 'persistent-grant', {
      channel,
      integration: descriptor.integration,
      permissionKind: descriptor.permissionKind,
      from: mode,
      to: 'auto',
    })
  }

  return true
}

export function __resetExternalActionPolicyForTests() {
  policyCache = null
  sessionGrantKeys.clear()
}
