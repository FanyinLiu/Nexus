// @ts-check
import { ipcMain } from 'electron'
import { audit } from '../services/auditLog.js'
import {
  getExternalActionPolicySnapshot,
  syncExternalActionPolicy,
} from '../services/externalActionPolicy.js'
import { saveDesktopContextFlags } from '../services/desktopContextPolicy.js'
import { saveExternalOpenConfirmation } from '../services/externalOpenConfirmation.js'
import { requireTrustedSender } from './validate.js'
import { validateExternalActionPolicySyncPayload } from './payloadSchemas.js'

/** @param {Record<string, unknown>} [payload] */
function summarizePolicySyncPayload(payload = {}) {
  const policies = /** @type {Record<string, { mode?: string, active?: unknown } | undefined>} */ (
    payload?.policies && typeof payload.policies === 'object' && !Array.isArray(payload.policies)
      ? payload.policies
      : {}
  )
  const integrations = Object.keys(policies).filter((key) => policies[key])
  return {
    integrationCount: integrations.length,
    autoCount: integrations.filter((key) => policies[key]?.mode === 'auto').length,
    confirmCount: integrations.filter((key) => policies[key]?.mode === 'confirm').length,
    readOnlyCount: integrations.filter((key) => policies[key]?.mode === 'read-only').length,
    activeCount: integrations.filter((key) => Boolean(policies[key]?.active)).length,
  }
}

/**
 * @param {{ mediaPermissionLifecycle?: {
 *   observeDesktopContext: (flags: unknown) => boolean,
 * } }} [options]
 */
export function register({ mediaPermissionLifecycle } = {}) {
  if (!mediaPermissionLifecycle) {
    throw new Error('mediaPermissionLifecycle is required for external action policy IPC')
  }
  ipcMain.handle('external-action-policy:get', async (event) => {
    requireTrustedSender(event)
    return getExternalActionPolicySnapshot()
  })

  ipcMain.handle('external-action-policy:sync', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateExternalActionPolicySyncPayload(payload)
    audit('external-action-policy', 'sync-request', summarizePolicySyncPayload(payload))
    // Panel-only channel. Persist the user's desktop-context flags here so
    // desktop-context:get cannot honor a pet-supplied enablement.
    if (payload?.desktopContext) {
      const saved = saveDesktopContextFlags(payload.desktopContext)
      // Only an off → on transition is a user action; the initial settings
      // hydrate is a baseline and never prompts.
      mediaPermissionLifecycle.observeDesktopContext({
        settingsRevision: payload.settingsRevision,
        screenshot: saved.screenshot,
      })
    }
    if (
      typeof payload?.toolOpenExternalRequiresConfirmation === 'boolean'
      || typeof payload?.uiLanguage === 'string'
    ) {
      saveExternalOpenConfirmation({
        requiresConfirmation: payload.toolOpenExternalRequiresConfirmation,
        uiLanguage: payload.uiLanguage,
      })
    }
    return syncExternalActionPolicy(payload)
  })
}
