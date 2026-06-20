import { ipcMain } from 'electron'
import {
  vaultDelete,
  vaultRetrieve,
  vaultStore,
} from '../services/keyVault.js'
import { audit } from '../services/auditLog.js'
import {
  summarizeVaultRequest,
  summarizeVaultResult,
} from './vaultAudit.js'
import {
  requireTrustedSender,
} from './validate.js'
import { validateVtsAuthTokenStorePayload } from './payloadSchemas.js'

const VTS_AUTH_TOKEN_SLOT = 'pet:vts-auth-token'

function summarizeStorePayload(payload) {
  const token = payload?.token
  return {
    tokenPresent: typeof token === 'string' && token.length > 0,
    tokenLength: typeof token === 'string' ? token.length : 0,
  }
}

async function runAuditedVaultAction(channel, payload, action) {
  audit('vault', 'request', {
    ...summarizeVaultRequest(channel, payload),
    ...(channel === 'vts-auth-token:store' ? summarizeStorePayload(payload) : {}),
    fixedSlot: true,
  })
  try {
    const result = await action()
    audit('vault', 'result', {
      ...summarizeVaultResult(channel, result),
      fixedSlot: true,
    })
    return result
  } catch (error) {
    audit('vault', 'result', {
      ...summarizeVaultResult(channel, undefined, error),
      fixedSlot: true,
    })
    throw error
  }
}

export function register() {
  ipcMain.handle('vts-auth-token:get', async (event) => {
    requireTrustedSender(event)
    return runAuditedVaultAction('vts-auth-token:get', {}, () => vaultRetrieve(VTS_AUTH_TOKEN_SLOT))
  })

  ipcMain.handle('vts-auth-token:store', async (event, payload) => {
    requireTrustedSender(event)
    const { token } = validateVtsAuthTokenStorePayload(payload)
    return runAuditedVaultAction('vts-auth-token:store', { token }, () => vaultStore(VTS_AUTH_TOKEN_SLOT, token))
  })

  ipcMain.handle('vts-auth-token:delete', async (event) => {
    requireTrustedSender(event)
    return runAuditedVaultAction('vts-auth-token:delete', {}, () => vaultDelete(VTS_AUTH_TOKEN_SLOT))
  })
}
