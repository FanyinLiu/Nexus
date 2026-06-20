import { BrowserWindow, ipcMain } from 'electron'
import { audit } from '../services/auditLog.js'
import { getRedactedErrorMessage } from '../services/errorRedaction.js'
import {
  connectVtsBridge,
  disconnectVtsBridge,
  getVtsBridgeStatus,
  migrateLegacyVtsAuthToken,
  onVtsBridgeStatus,
  updateVtsBridgeInput,
} from '../services/vtsBridge.js'
import {
  validateVtsBridgeConnectPayload,
  validateVtsBridgeInputPayload,
  validateVtsBridgeLegacyTokenPayload,
} from './payloadSchemas.js'
import { requireTrustedSender } from './validate.js'

function broadcastStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('vts-bridge:status', status)
  }
}

function summarizePayload(channel, payload) {
  if (channel === 'vts-bridge:connect') {
    return { port: payload?.port }
  }
  if (channel === 'vts-bridge:migrate-legacy-token') {
    const token = payload?.token
    return {
      tokenPresent: typeof token === 'string' && token.length > 0,
      tokenLength: typeof token === 'string' ? token.length : 0,
      fixedSlot: true,
    }
  }
  return {}
}

async function runAuditedVtsAction(channel, payload, action) {
  audit('vts-bridge', 'request', {
    channel,
    ...summarizePayload(channel, payload),
  })
  try {
    const result = await action()
    audit('vts-bridge', 'result', {
      channel,
      state: result?.state,
      modelNamePresent: typeof result?.modelName === 'string' && result.modelName.length > 0,
    })
    return result
  } catch (error) {
    audit('vts-bridge', 'result', {
      channel,
      error: getRedactedErrorMessage(error),
    })
    throw error
  }
}

export function register() {
  onVtsBridgeStatus(broadcastStatus)

  ipcMain.handle('vts-bridge:connect', async (event, payload) => {
    requireTrustedSender(event)
    const input = validateVtsBridgeConnectPayload(payload)
    return runAuditedVtsAction('vts-bridge:connect', input, () => connectVtsBridge(input))
  })

  ipcMain.handle('vts-bridge:disconnect', async (event) => {
    requireTrustedSender(event)
    return runAuditedVtsAction('vts-bridge:disconnect', {}, () => disconnectVtsBridge())
  })

  ipcMain.handle('vts-bridge:status', (event) => {
    requireTrustedSender(event)
    return getVtsBridgeStatus()
  })

  ipcMain.handle('vts-bridge:update-input', (event, payload) => {
    requireTrustedSender(event)
    const input = validateVtsBridgeInputPayload(payload)
    return updateVtsBridgeInput(input)
  })

  ipcMain.handle('vts-bridge:migrate-legacy-token', async (event, payload) => {
    requireTrustedSender(event)
    const input = validateVtsBridgeLegacyTokenPayload(payload)
    return runAuditedVtsAction(
      'vts-bridge:migrate-legacy-token',
      input,
      async () => {
        await migrateLegacyVtsAuthToken(input.token)
        return getVtsBridgeStatus()
      },
    )
  })
}
