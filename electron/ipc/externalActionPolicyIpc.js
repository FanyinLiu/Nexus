import { ipcMain } from 'electron'
import { audit } from '../services/auditLog.js'
import {
  getExternalActionPolicySnapshot,
  syncExternalActionPolicy,
} from '../services/externalActionPolicy.js'
import { requireTrustedSender } from './validate.js'
import { validateExternalActionPolicySyncPayload } from './payloadSchemas.js'

function summarizePolicySyncPayload(payload = {}) {
  const policies = payload?.policies && typeof payload.policies === 'object' && !Array.isArray(payload.policies)
    ? payload.policies
    : {}
  const integrations = Object.keys(policies).filter((key) => policies[key])
  return {
    integrationCount: integrations.length,
    autoCount: integrations.filter((key) => policies[key]?.mode === 'auto').length,
    confirmCount: integrations.filter((key) => policies[key]?.mode === 'confirm').length,
    readOnlyCount: integrations.filter((key) => policies[key]?.mode === 'read-only').length,
    activeCount: integrations.filter((key) => Boolean(policies[key]?.active)).length,
  }
}

export function register() {
  ipcMain.handle('external-action-policy:get', async (event) => {
    requireTrustedSender(event)
    return getExternalActionPolicySnapshot()
  })

  ipcMain.handle('external-action-policy:sync', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateExternalActionPolicySyncPayload(payload)
    audit('external-action-policy', 'sync-request', summarizePolicySyncPayload(payload))
    return syncExternalActionPolicy(payload)
  })
}
