import { ipcMain } from 'electron'
import * as mcpHost from '../services/mcpHost.js'
import { requireString, requireObject, requireTrustedSender } from './validate.js'
import {
  validateMcpCallToolPayload,
  validateMcpIdPayload,
  validateMcpSyncServersPayload,
} from './payloadSchemas.js'

// Only the MCP Host (multi-server) read/invoke handlers are live — lifecycle
// handlers (start/stop/restart) are driven through plugin:* in pluginIpc.js.
// The old stdio client (mcp-client:*) had no renderer callers and was removed
// along with electron/services/mcpClient.js.

export function register() {
  ipcMain.handle('mcp:status', (event, payload) => {
    requireTrustedSender(event)
    payload = validateMcpIdPayload('mcp:status', payload)
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.getStatus(id) : mcpHost.getAllStatuses()
  })

  ipcMain.handle('mcp:list-tools', (event, payload) => {
    requireTrustedSender(event)
    payload = validateMcpIdPayload('mcp:list-tools', payload)
    const id = payload?.id ? String(payload.id).trim() : null
    return id ? mcpHost.listTools(id) : mcpHost.listAllTools()
  })

  ipcMain.handle('mcp:call-tool', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMcpCallToolPayload(payload)
    requireObject(payload, 'payload')
    const name = requireString(payload.name, 'name')
    const toolArgs = payload.arguments ?? {}
    const id = payload.serverId ? String(payload.serverId).trim() : null
    return id
      ? mcpHost.callTool(id, name, toolArgs)
      : mcpHost.callToolByName(name, toolArgs)
  })

  ipcMain.handle('mcp:sync-servers', async (event, payload) => {
    requireTrustedSender(event)
    payload = validateMcpSyncServersPayload(payload)
    const desired = Array.isArray(payload?.servers) ? payload.servers : []
    return mcpHost.syncFromSettings(desired)
  })
}
